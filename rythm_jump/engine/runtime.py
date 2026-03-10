"""Runtime orchestration for playback, input handling, and LED outputs."""

from __future__ import annotations

import asyncio
import inspect
from contextlib import suppress
from typing import TYPE_CHECKING, Protocol

from rythm_jump.engine.led_frames import (
    DEFAULT_STRIP_LEN,
    InputPulse,
    LedFrame,
    build_led_frame,
)
from rythm_jump.engine.session import GameSession, State
from rythm_jump.hw.audio_playback import AudioPlayer, NoOpAudioPlayer

if TYPE_CHECKING:
    from pathlib import Path

    from rythm_jump.engine.types import Lane
    from rythm_jump.models.chart import Chart

EventPayload = dict[str, object]

TICK_INTERVAL_S = 1 / 60


class EventSink(Protocol):
    """Protocol for async runtime event subscribers."""

    async def publish(self, event: EventPayload) -> None:
        """Publish one runtime event."""


class LedOutput(Protocol):
    """Protocol for LED frame consumers."""

    def write_frame(self, frame: LedFrame) -> object:
        """Write the current LED frame."""


async def _maybe_await(result: object) -> None:
    """Await async-compatible callbacks and ignore plain return values."""
    if inspect.isawaitable(result):
        await result


class GameRuntime:
    """Own the session, playback loop, input processing, and output delivery."""

    def __init__(
        self,
        *,
        session: GameSession | None = None,
        strip_len: int = DEFAULT_STRIP_LEN,
        audio_player: AudioPlayer | None = None,
    ) -> None:
        """Initialize the runtime with session state and optional outputs."""
        self.session = session or GameSession()
        self.strip_len = strip_len
        self.progress_ms = 0
        self.song_id = ""
        self.chart: Chart | None = None
        self.audio_path: Path | None = None
        self.duration_ms = 0
        self._playback_task: asyncio.Task[None] | None = None
        self._event_sinks: set[EventSink] = set()
        self._led_outputs: dict[str, LedOutput] = {}
        self._lane_pulses: list[InputPulse] = []
        self._lock = asyncio.Lock()
        self._audio_player = audio_player or NoOpAudioPlayer()

    async def add_event_sink(self, sink: EventSink) -> None:
        """Register an event sink and send the current session state."""
        self._event_sinks.add(sink)
        await sink.publish(self.session_state_event())

    def remove_event_sink(self, sink: EventSink) -> None:
        """Remove a previously registered event sink."""
        self._event_sinks.discard(sink)

    def set_led_output(self, name: str, output: LedOutput | None) -> None:
        """Register or clear an LED output."""
        if output is None:
            self._led_outputs.pop(name, None)
            return
        self._led_outputs[name] = output

    def session_state_event(self) -> EventPayload:
        """Return the current session state payload."""
        event: EventPayload = {
            "type": "session_state",
            "state": self.session.state,
        }
        if self.progress_ms > 0:
            event["progress_ms"] = self.progress_ms
        if self.song_id:
            event["song_id"] = self.song_id
        return event

    async def start(
        self,
        *,
        song_id: str,
        chart: Chart,
        duration_ms: int,
        audio_path: Path | None = None,
    ) -> bool:
        """Start playback for the provided chart."""
        async with self._lock:
            await self._cancel_playback_task()
            self.chart = chart
            self.audio_path = audio_path
            self.duration_ms = duration_ms
            self.song_id = song_id
            self.progress_ms = 0
            self._lane_pulses = []
            self.session.stop()
            self.session.start()
            await self._play_audio(start_ms=0)
            await self._broadcast(self.session_state_event())
            self._playback_task = asyncio.create_task(self._run_playback())
            return True

    async def stop(self) -> None:
        """Stop playback and reset progress."""
        async with self._lock:
            self.session.stop()
            await self._cancel_playback_task()
            await self._stop_audio()
            self.progress_ms = 0
            self._lane_pulses = []
            await self._emit_current_led_frame()
            await self._broadcast(self.session_state_event())

    async def pause(self) -> bool:
        """Pause playback without discarding the current chart."""
        async with self._lock:
            changed = self.session.pause()
            if changed:
                await self._pause_audio()
                await self._broadcast(self.session_state_event())
            return changed

    async def resume(self) -> bool:
        """Resume playback after a pause."""
        async with self._lock:
            changed = self.session.resume()
            if changed:
                await self._play_audio(start_ms=self.progress_ms)
                await self._broadcast(self.session_state_event())
            return changed

    async def submit_lane_input(self, lane: Lane, *, source: str) -> None:
        """Deliver a lane press to the engine."""
        progress_ms = self.progress_ms
        self._lane_pulses.append(InputPulse(lane=lane, started_ms=progress_ms))
        await self._broadcast(
            {
                "type": "lane_event",
                "lane": lane,
                "source": source,
                "progress_ms": progress_ms,
            },
        )
        await self._emit_current_led_frame()

    async def close(self) -> None:
        """Tear down runtime tasks cleanly."""
        await self.stop()
        await _maybe_await(self._audio_player.close())

    async def _cancel_playback_task(self) -> None:
        if self._playback_task is None:
            return
        self._playback_task.cancel()
        with suppress(asyncio.CancelledError):
            await self._playback_task
        self._playback_task = None

    async def _run_playback(self) -> None:
        chart = self.chart
        if chart is None:
            message = "playback started without a chart"
            raise RuntimeError(message)
        started_at = asyncio.get_running_loop().time()
        paused_started_at: float | None = None
        paused_duration_s = 0.0

        try:
            while self.session.state != State.IDLE:
                if self.session.state == State.PAUSED:
                    if paused_started_at is None:
                        paused_started_at = asyncio.get_running_loop().time()
                    await asyncio.sleep(TICK_INTERVAL_S)
                    continue

                now = asyncio.get_running_loop().time()
                if paused_started_at is not None:
                    paused_duration_s += now - paused_started_at
                    paused_started_at = None

                elapsed_s = max(now - started_at - paused_duration_s, 0.0)
                self.progress_ms = min(round(elapsed_s * 1000), self.duration_ms)

                await self._emit_bar_frames(chart)
                await self._emit_current_led_frame()

                if self.progress_ms >= self.duration_ms:
                    break
                await asyncio.sleep(TICK_INTERVAL_S)
        finally:
            await self._stop_audio()
            self.session.stop()
            self.progress_ms = 0
            self._lane_pulses = []
            await self._emit_current_led_frame()
            await self._broadcast(self.session_state_event())

    async def _emit_bar_frames(self, chart: Chart) -> None:
        remaining_ms = max(self.duration_ms - self.progress_ms, 0)
        for lane in ("left", "right"):
            for hit_time_ms in getattr(chart, lane):
                spawn_ms = max(hit_time_ms - chart.travel_time_ms, 0)
                if self.progress_ms < spawn_ms or self.progress_ms > hit_time_ms:
                    continue
                await self._broadcast(
                    {
                        "type": "bar_frame",
                        "lane": lane,
                        "hit_time_ms": hit_time_ms,
                        "travel_time_ms": chart.travel_time_ms,
                        "progress_ms": self.progress_ms - spawn_ms,
                        "remaining_ms": remaining_ms,
                    },
                )

    async def _emit_current_led_frame(self) -> None:
        frame = self._build_led_frame()
        await self._write_led_frame(frame)
        await self._broadcast(frame.as_event_payload())

    def _build_led_frame(self) -> LedFrame:
        if self.chart is None:
            return build_led_frame(
                strip_len=self.strip_len,
                travel_time_ms=1,
                progress_ms=self.progress_ms,
                left_hit_times=[],
                right_hit_times=[],
                input_pulses=self._lane_pulses,
            )

        if self.session.state == State.IDLE:
            return build_led_frame(
                strip_len=self.strip_len,
                travel_time_ms=self.chart.travel_time_ms,
                progress_ms=self.progress_ms,
                left_hit_times=[],
                right_hit_times=[],
                input_pulses=self._lane_pulses,
            )

        return build_led_frame(
            strip_len=self.strip_len,
            travel_time_ms=self.chart.travel_time_ms,
            progress_ms=self.progress_ms,
            left_hit_times=self.chart.left,
            right_hit_times=self.chart.right,
            input_pulses=self._lane_pulses,
        )

    async def _play_audio(self, *, start_ms: int) -> None:
        if self.audio_path is None:
            return
        await _maybe_await(self._audio_player.play(self.audio_path, start_ms=start_ms))

    async def _pause_audio(self) -> None:
        await _maybe_await(self._audio_player.pause())

    async def _stop_audio(self) -> None:
        await _maybe_await(self._audio_player.stop())

    async def _write_led_frame(self, frame: LedFrame) -> None:
        for output in tuple(self._led_outputs.values()):
            await _maybe_await(output.write_frame(frame))

    async def _broadcast(self, event: EventPayload) -> None:
        for sink in tuple(self._event_sinks):
            try:
                await sink.publish(event)
            except Exception:  # noqa: BLE001
                self._event_sinks.discard(sink)
