import { useEffect, useState } from 'react';

const DEFAULT_LEVELS = [0, 0] as const;
const CLOCK_DECAY = 0.85;
const DEFAULT_SESSION_ID = 'default-session';

type SessionEvent = {
  type?: unknown;
  lane?: unknown;
  session_id?: unknown;
  tick?: unknown;
  [key: string]: unknown;
};

type LocationInfo = {
  protocol: string;
  host: string;
};

export type VisualizerLevels = [number, number];

export function buildSessionStreamUrl(sessionId: string, location: LocationInfo): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws/session/${encodeURIComponent(sessionId)}`;
}

export function resetStreamLevels(_: VisualizerLevels): VisualizerLevels {
  return [...DEFAULT_LEVELS];
}

function clampLevel(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function reduceStreamLevels(
  levels: VisualizerLevels,
  event: SessionEvent
): VisualizerLevels {
  if (event.type === 'lane_event') {
    if (event.lane === 'left') {
      return [1, levels[1]];
    }

    if (event.lane === 'right') {
      return [levels[0], 1];
    }

    return levels;
  }

  if (event.type === 'clock_tick') {
    return [clampLevel(levels[0] * CLOCK_DECAY), clampLevel(levels[1] * CLOCK_DECAY)];
  }

  return levels;
}

export function useSessionStream(sessionId = DEFAULT_SESSION_ID) {
  const [levels, setLevels] = useState<VisualizerLevels>(resetStreamLevels([0, 0]));

  useEffect(() => {
    setLevels((previous) => resetStreamLevels(previous));

    if (typeof WebSocket === 'undefined') {
      return;
    }

    const socket = new WebSocket(
      buildSessionStreamUrl(sessionId, {
        protocol: window.location.protocol,
        host: window.location.host
      })
    );

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as SessionEvent;
        if (!payload || typeof payload !== 'object') {
          return;
        }

        setLevels((previous) => reduceStreamLevels(previous, payload));
      } catch {
        // Ignore malformed events and keep the last known levels.
      }
    };

    return () => socket.close();
  }, [sessionId]);

  return levels;
}
