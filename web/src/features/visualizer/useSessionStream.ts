import { useEffect, useState } from 'react';

const DEFAULT_LEVELS = [0, 0, 0, 0, 0, 0, 0, 0];

type SessionStreamMessage = {
  levels?: unknown;
};

function normalizeLevels(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const levels = value
    .map((entry) => {
      if (typeof entry !== 'number' || Number.isNaN(entry)) {
        return null;
      }

      return Math.max(0, Math.min(1, entry));
    })
    .filter((entry): entry is number => entry !== null);

  return levels.length > 0 ? levels : null;
}

export function useSessionStream() {
  const [levels, setLevels] = useState<number[]>(DEFAULT_LEVELS);

  useEffect(() => {
    if (typeof WebSocket === 'undefined') {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/session`);

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as SessionStreamMessage;
        const parsed = normalizeLevels(payload.levels);
        if (parsed) {
          setLevels(parsed);
        }
      } catch {
        // Ignore malformed events and keep the last known levels.
      }
    };

    return () => socket.close();
  }, []);

  return levels;
}
