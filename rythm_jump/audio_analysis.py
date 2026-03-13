"""Audio analysis and playback-duration helpers."""

from __future__ import annotations

import importlib
import warnings
from typing import TYPE_CHECKING, Final

import numpy as np

from rythm_jump.models.chart import (
    AudioAnalysis,
    BeatSpectralDescriptor,
    Chart,
    SpectralBandEnergy,
)
from rythm_jump.presentation import dominant_band_color

if TYPE_CHECKING:
    from pathlib import Path
    from types import ModuleType

_MIN_BPM: Final[int] = 60
_MAX_BPM: Final[int] = 180
_ANALYSIS_HOP_LENGTH: Final[int] = 512
_ANALYSIS_N_FFT: Final[int] = 2048
_MIN_BEAT_COUNT: Final[int] = 2
_LOW_BAND_MIN_HZ: Final[float] = 20.0
_LOW_BAND_MAX_HZ: Final[float] = 250.0
_MID_BAND_MAX_HZ: Final[float] = 2000.0
_AUTO_PATTERN_MIN_NOTES: Final[int] = 8
_AUTO_PATTERN_MIN_DENSITY: Final[float] = 0.32
_AUTO_PATTERN_MAX_DENSITY: Final[float] = 0.55
_AUTO_PATTERN_DOUBLE_NOTE_RATIO: Final[float] = 0.12
_AUTO_PATTERN_DOUBLE_NOTE_MIN_GAP: Final[int] = 2
_AUTO_PATTERN_DOUBLE_NOTE_LOW_BAND_THRESHOLD: Final[float] = 0.55


def _load_librosa() -> ModuleType:
    try:
        return importlib.import_module("librosa")
    except ModuleNotFoundError as exc:  # pragma: no cover - environment dependent
        message = "librosa_not_available"
        raise RuntimeError(message) from exc


def _normalize_bpm(bpm_candidate: float) -> float:
    while bpm_candidate < _MIN_BPM:
        bpm_candidate *= 2
    while bpm_candidate > _MAX_BPM:
        bpm_candidate /= 2
    return round(bpm_candidate, 1)


def _safe_sample(series: np.ndarray, index: int) -> float:
    if series.size == 0:
        return 0.0
    clamped_index = int(np.clip(index, 0, series.size - 1))
    return float(series[clamped_index])


def _smooth_non_negative_series(series: np.ndarray, window_size: int) -> np.ndarray:
    if series.size == 0:
        return series
    if window_size <= 1:
        return np.maximum(series, 0.0)
    kernel = np.ones(window_size, dtype=np.float64) / float(window_size)
    padded = np.pad(series, (window_size // 2,), mode="edge")
    smoothed = np.convolve(padded, kernel, mode="valid")
    return np.maximum(smoothed[: series.size], 0.0)


def _normalize_series_to_unit(series: np.ndarray) -> np.ndarray:
    if series.size == 0:
        return series
    max_value = float(np.max(series))
    if max_value <= 0:
        return np.zeros_like(series, dtype=np.float64)
    return np.clip(series / max_value, 0.0, 1.0)


def _normalize_feature(values: np.ndarray) -> np.ndarray:
    if values.size == 0:
        return values
    lower = float(np.percentile(values, 10))
    upper = float(np.percentile(values, 90))
    if upper <= lower:
        return np.clip(values, 0.0, 1.0)
    return np.clip((values - lower) / (upper - lower), 0.0, 1.0)


def generate_auto_pattern_from_analysis(  # noqa: PLR0915
    analysis: AudioAnalysis,
) -> tuple[list[int], list[int]]:
    """Generate a beat-balanced note layout from analysis metadata."""
    beat_count = min(len(analysis.beat_times_ms), len(analysis.beat_descriptors))
    if beat_count == 0:
        return [], []

    beat_times = np.asarray(analysis.beat_times_ms[:beat_count], dtype=np.int64)
    descriptors = analysis.beat_descriptors[:beat_count]
    onset_values = np.asarray(
        [descriptor.onset_strength for descriptor in descriptors],
        dtype=np.float64,
    )
    rms_values = np.asarray(
        [descriptor.rms for descriptor in descriptors],
        dtype=np.float64,
    )
    low_band_values = np.asarray(
        [descriptor.band_energy.low for descriptor in descriptors],
        dtype=np.float64,
    )
    dominant_low_values = np.asarray(
        [
            1.0 if descriptor.dominant_band == "low" else 0.0
            for descriptor in descriptors
        ],
        dtype=np.float64,
    )
    bar_start_values = np.asarray(
        [1.0 if index % 4 == 0 else 0.0 for index in range(beat_count)],
        dtype=np.float64,
    )

    onset_scores = _normalize_feature(onset_values)
    rms_scores = _normalize_feature(rms_values)
    low_band_scores = np.clip(low_band_values, 0.0, 1.0)
    note_scores = (
        (onset_scores * 0.4)
        + (rms_scores * 0.25)
        + (low_band_scores * 0.25)
        + (dominant_low_values * 0.05)
        + (bar_start_values * 0.05)
    )

    mean_score = float(np.mean(note_scores))
    target_density = float(
        np.clip(
            _AUTO_PATTERN_MIN_DENSITY + (mean_score * 0.18),
            _AUTO_PATTERN_MIN_DENSITY,
            _AUTO_PATTERN_MAX_DENSITY,
        ),
    )
    target_note_count = min(
        beat_count,
        max(_AUTO_PATTERN_MIN_NOTES, round(beat_count * target_density)),
    )
    ranked_indexes = np.argsort(note_scores)[::-1]
    selected_indexes = sorted(
        int(index) for index in ranked_indexes[:target_note_count]
    )
    selected_scores = np.asarray(
        [note_scores[index] for index in selected_indexes],
        dtype=np.float64,
    )
    double_note_threshold = float(np.percentile(selected_scores, 90))
    remaining_double_notes = max(
        1,
        round(target_note_count * _AUTO_PATTERN_DOUBLE_NOTE_RATIO),
    )

    left_notes: list[int] = []
    right_notes: list[int] = []
    next_lane = "left"
    left_count = 0
    right_count = 0
    last_double_index = -_AUTO_PATTERN_DOUBLE_NOTE_MIN_GAP - 1

    for index in selected_indexes:
        beat_time_ms = int(beat_times[index])
        is_double_note = (
            remaining_double_notes > 0
            and note_scores[index] >= double_note_threshold
            and low_band_scores[index] >= _AUTO_PATTERN_DOUBLE_NOTE_LOW_BAND_THRESHOLD
            and (index - last_double_index) > _AUTO_PATTERN_DOUBLE_NOTE_MIN_GAP
        )
        if is_double_note:
            left_notes.append(beat_time_ms)
            right_notes.append(beat_time_ms)
            left_count += 1
            right_count += 1
            remaining_double_notes -= 1
            last_double_index = index
            continue

        if left_count < right_count:
            lane = "left"
        elif right_count < left_count:
            lane = "right"
        else:
            lane = next_lane

        if lane == "left":
            left_notes.append(beat_time_ms)
            left_count += 1
            next_lane = "right"
        else:
            right_notes.append(beat_time_ms)
            right_count += 1
            next_lane = "left"

    return sorted(left_notes), sorted(right_notes)


def _estimate_bpm_from_intervals(beat_times_sec: np.ndarray) -> float:
    if beat_times_sec.size < _MIN_BEAT_COUNT:
        return 0.0
    intervals = np.diff(beat_times_sec)
    positive_intervals = intervals[intervals > 0]
    if positive_intervals.size == 0:
        return 0.0
    return float(60.0 / np.median(positive_intervals))


def estimate_global_offset_ms(beat_times_ms: list[int], tempo_bpm: float) -> int:
    """Estimate the global beat-grid offset from analyzed beat times."""
    if tempo_bpm <= 0 or not beat_times_ms:
        return 0

    beat_interval_ms = 60_000.0 / tempo_bpm
    if beat_interval_ms <= 0:
        return 0

    beat_times = np.asarray(beat_times_ms, dtype=np.float64)
    phases = np.mod(beat_times, beat_interval_ms)
    phase_angles = (2 * np.pi * phases) / beat_interval_ms
    sin_mean = float(np.mean(np.sin(phase_angles)))
    cos_mean = float(np.mean(np.cos(phase_angles)))

    if np.isclose(sin_mean, 0.0) and np.isclose(cos_mean, 0.0):
        phase_ms = float(np.median(phases))
    else:
        mean_angle = np.arctan2(sin_mean, cos_mean)
        phase_ms = float((mean_angle % (2 * np.pi)) * beat_interval_ms / (2 * np.pi))

    candidates = np.array(
        [phase_ms - beat_interval_ms, phase_ms, phase_ms + beat_interval_ms],
        dtype=np.float64,
    )
    best_offset = candidates[0]
    best_error = float("inf")
    for candidate in candidates:
        nearest = (
            candidate
            + np.round((beat_times - candidate) / beat_interval_ms) * beat_interval_ms
        )
        mean_abs_error = float(np.mean(np.abs(beat_times - nearest)))
        if mean_abs_error < best_error:
            best_error = mean_abs_error
            best_offset = candidate
        elif np.isclose(mean_abs_error, best_error) and abs(candidate) < abs(
            best_offset,
        ):
            best_offset = candidate

    return round(best_offset)


def analyze_audio_with_librosa(audio_path: Path) -> AudioAnalysis:  # noqa: PLR0915
    """Analyze audio timing and spectral features with librosa."""
    librosa = _load_librosa()
    samples, sample_rate_hz = librosa.load(
        str(audio_path),
        sr=22050,
        mono=True,
    )
    if samples.size == 0:
        message = "empty_audio"
        raise ValueError(message)

    stft_magnitude = np.abs(
        librosa.stft(
            y=samples,
            n_fft=_ANALYSIS_N_FFT,
            hop_length=_ANALYSIS_HOP_LENGTH,
        ),
    )
    frame_count = stft_magnitude.shape[1]
    if frame_count == 0:
        message = "no_spectral_frames"
        raise ValueError(message)

    onset_envelope = librosa.onset.onset_strength(
        y=samples,
        sr=sample_rate_hz,
        hop_length=_ANALYSIS_HOP_LENGTH,
    )
    tempo_result = librosa.beat.beat_track(
        onset_envelope=onset_envelope,
        sr=sample_rate_hz,
        hop_length=_ANALYSIS_HOP_LENGTH,
    )
    detected_tempo = float(np.atleast_1d(tempo_result[0])[0])
    beat_frames = np.asarray(tempo_result[1], dtype=np.int64)
    if beat_frames.size == 0:
        beat_frames = librosa.onset.onset_detect(
            onset_envelope=onset_envelope,
            sr=sample_rate_hz,
            hop_length=_ANALYSIS_HOP_LENGTH,
            units="frames",
        ).astype(np.int64)
    if beat_frames.size == 0:
        message = "no_beats_detected"
        raise ValueError(message)

    beat_frames = np.unique(np.clip(beat_frames, 0, frame_count - 1))
    beat_times_sec = librosa.frames_to_time(
        beat_frames,
        sr=sample_rate_hz,
        hop_length=_ANALYSIS_HOP_LENGTH,
    )

    if detected_tempo <= 0:
        detected_tempo = _estimate_bpm_from_intervals(beat_times_sec)
    if detected_tempo <= 0:
        message = "no_tempo_detected"
        raise ValueError(message)
    tempo_bpm = _normalize_bpm(detected_tempo)

    spectral_centroid = librosa.feature.spectral_centroid(
        S=stft_magnitude,
        sr=sample_rate_hz,
    )[0]
    spectral_bandwidth = librosa.feature.spectral_bandwidth(
        S=stft_magnitude,
        sr=sample_rate_hz,
    )[0]
    spectral_rolloff = librosa.feature.spectral_rolloff(
        S=stft_magnitude,
        sr=sample_rate_hz,
    )[0]
    rms = librosa.feature.rms(S=stft_magnitude)[0]
    frequencies = librosa.fft_frequencies(
        sr=sample_rate_hz,
        n_fft=_ANALYSIS_N_FFT,
    )
    low_mask = (frequencies >= _LOW_BAND_MIN_HZ) & (frequencies < _LOW_BAND_MAX_HZ)
    mid_mask = (frequencies >= _LOW_BAND_MAX_HZ) & (frequencies < _MID_BAND_MAX_HZ)
    high_mask = frequencies >= _MID_BAND_MAX_HZ

    stft_power = stft_magnitude**2
    low_band_frames = (
        np.mean(stft_power[low_mask], axis=0)
        if np.any(low_mask)
        else np.zeros(frame_count)
    )
    mid_band_frames = (
        np.mean(stft_power[mid_mask], axis=0)
        if np.any(mid_mask)
        else np.zeros(frame_count)
    )
    high_band_frames = (
        np.mean(stft_power[high_mask], axis=0)
        if np.any(high_mask)
        else np.zeros(frame_count)
    )

    smoothing_window = min(max(frame_count // 120, 3), 15)
    if smoothing_window % 2 == 0:
        smoothing_window += 1
    low_waveform = _normalize_series_to_unit(
        _smooth_non_negative_series(low_band_frames, smoothing_window),
    )
    mid_waveform = _normalize_series_to_unit(
        _smooth_non_negative_series(mid_band_frames, smoothing_window),
    )
    high_waveform = _normalize_series_to_unit(
        _smooth_non_negative_series(high_band_frames, smoothing_window),
    )

    descriptors: list[BeatSpectralDescriptor] = []
    beat_times_ms: list[int] = []
    for beat_frame, beat_time_sec in zip(beat_frames, beat_times_sec, strict=True):
        low_energy = float(np.mean(stft_magnitude[low_mask, beat_frame]))
        mid_energy = float(np.mean(stft_magnitude[mid_mask, beat_frame]))
        high_energy = float(np.mean(stft_magnitude[high_mask, beat_frame]))
        energy_vector = np.array(
            [low_energy, mid_energy, high_energy],
            dtype=np.float64,
        )
        energy_sum = float(np.sum(energy_vector))
        if energy_sum > 0:
            normalized_energy = energy_vector / energy_sum
        else:
            normalized_energy = np.zeros(3, dtype=np.float64)

        dominant_band_index = int(np.argmax(normalized_energy))
        dominant_band = ("low", "mid", "high")[dominant_band_index]
        beat_time_ms = max(round(beat_time_sec * 1000), 0)
        beat_times_ms.append(beat_time_ms)

        descriptors.append(
            BeatSpectralDescriptor(
                time_ms=beat_time_ms,
                onset_strength=max(_safe_sample(onset_envelope, int(beat_frame)), 0.0),
                spectral_centroid_hz=max(
                    _safe_sample(spectral_centroid, int(beat_frame)),
                    0.0,
                ),
                spectral_bandwidth_hz=max(
                    _safe_sample(spectral_bandwidth, int(beat_frame)),
                    0.0,
                ),
                spectral_rolloff_hz=max(
                    _safe_sample(spectral_rolloff, int(beat_frame)),
                    0.0,
                ),
                rms=max(_safe_sample(rms, int(beat_frame)), 0.0),
                band_energy=SpectralBandEnergy(
                    low=float(normalized_energy[0]),
                    mid=float(normalized_energy[1]),
                    high=float(normalized_energy[2]),
                ),
                dominant_band=dominant_band,
                color_hint=dominant_band_color(dominant_band),
            ),
        )

    frame_length_ms = round((_ANALYSIS_HOP_LENGTH / sample_rate_hz) * 1000)
    duration_ms = round(librosa.get_duration(y=samples, sr=sample_rate_hz) * 1000)
    return AudioAnalysis(
        duration_ms=max(duration_ms, 1),
        sample_rate_hz=sample_rate_hz,
        hop_length=_ANALYSIS_HOP_LENGTH,
        frame_length_ms=max(frame_length_ms, 1),
        tempo_bpm=tempo_bpm,
        beat_times_ms=beat_times_ms,
        beat_descriptors=descriptors,
        waveform_band_low=low_waveform.astype(float).tolist(),
        waveform_band_mid=mid_waveform.astype(float).tolist(),
        waveform_band_high=high_waveform.astype(float).tolist(),
    )


def chart_duration_ms(chart: Chart) -> int:
    """Return the chart span in milliseconds."""
    left_max = max(chart.left, default=0)
    right_max = max(chart.right, default=0)
    return max(left_max, right_max) + chart.travel_time_ms


def analysis_duration_ms(chart: Chart) -> int:
    """Return the analyzed duration when available."""
    analysis = chart.audio_analysis
    if analysis is None:
        return 0
    if analysis.duration_ms is not None:
        return int(analysis.duration_ms)

    beat_max = max(analysis.beat_times_ms, default=0)
    descriptor_max = max(
        (descriptor.time_ms for descriptor in analysis.beat_descriptors),
        default=0,
    )
    return max(beat_max, descriptor_max)


def audio_duration_ms(audio_path: Path) -> int:
    """Return audio file duration using librosa metadata probing."""
    try:
        librosa = importlib.import_module("librosa")
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", FutureWarning)
            warnings.simplefilter("ignore", DeprecationWarning)
            duration_s = float(librosa.get_duration(path=str(audio_path)))
    except (EOFError, ImportError, OSError, TypeError, ValueError):  # pragma: no cover
        return 0

    return max(round(duration_s * 1000), 0)


def resolve_playback_duration_ms(chart: Chart, audio_path: Path) -> int:
    """Resolve playback duration from audio, then analysis, then chart shape."""
    current_audio_duration_ms = audio_duration_ms(audio_path)
    if current_audio_duration_ms > 0:
        return current_audio_duration_ms

    current_analysis_duration_ms = analysis_duration_ms(chart)
    if current_analysis_duration_ms > 0:
        return current_analysis_duration_ms

    return chart_duration_ms(chart)
