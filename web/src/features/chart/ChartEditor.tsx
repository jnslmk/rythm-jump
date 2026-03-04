import { useState } from 'react';

export type ChartSavePayload = {
  song_id: string;
  travel_time_ms: number;
  global_offset_ms: number;
  judgement_windows_ms: {
    perfect: number;
    good: number;
  };
  left: number[];
  right: number[];
};

type ChartEditorProps = {
  songId: string;
  travelTimeMs: number;
  globalOffsetMs: number;
  onSave: (payload: ChartSavePayload) => void | Promise<void>;
};

type ParseResult = {
  ok: true;
  values: number[];
};

type ParseFailure = {
  ok: false;
};

function parseTimings(value: string): ParseResult | ParseFailure {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const values: number[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      return { ok: false };
    }

    values.push(Number.parseInt(entry, 10));
  }

  return { ok: true, values };
}

export function ChartEditor({ songId, travelTimeMs, globalOffsetMs, onSave }: ChartEditorProps) {
  const [leftInput, setLeftInput] = useState('');
  const [rightInput, setRightInput] = useState('');
  const [status, setStatus] = useState<string>('idle');

  const handleSave = async () => {
    const left = parseTimings(leftInput);
    const right = parseTimings(rightInput);
    if (!left.ok || !right.ok) {
      setStatus('Invalid timings');
      return;
    }

    const payload: ChartSavePayload = {
      song_id: songId,
      travel_time_ms: travelTimeMs,
      global_offset_ms: globalOffsetMs,
      judgement_windows_ms: {
        perfect: 50,
        good: 100
      },
      left: left.values,
      right: right.values
    };

    try {
      await onSave(payload);
      setStatus('Saved');
    } catch {
      setStatus('Save failed');
    }
  };

  return (
    <section>
      <h2>Chart editor</h2>
      <label>
        Left lane timings (ms)
        <textarea
          aria-label="Left lane timings (ms)"
          value={leftInput}
          onChange={(event) => setLeftInput(event.target.value)}
        />
      </label>
      <label>
        Right lane timings (ms)
        <textarea
          aria-label="Right lane timings (ms)"
          value={rightInput}
          onChange={(event) => setRightInput(event.target.value)}
        />
      </label>
      <button type="button" onClick={() => void handleSave()}>
        Save chart
      </button>
      <p>Chart status: {status}</p>
    </section>
  );
}
