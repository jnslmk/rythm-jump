type CalibrationPanelProps = {
  travelTimeMs: number;
  globalOffsetMs: number;
  onTravelTimeChange: (value: number) => void;
  onGlobalOffsetChange: (value: number) => void;
};

function parseIntegerInput(value: string): number | null {
  if (!/^-?\d+$/.test(value.trim())) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function CalibrationPanel({
  travelTimeMs,
  globalOffsetMs,
  onTravelTimeChange,
  onGlobalOffsetChange
}: CalibrationPanelProps) {
  return (
    <fieldset>
      <legend>Calibration</legend>
      <label>
        Travel time (ms)
        <input
          aria-label="Travel time (ms)"
          type="number"
          value={travelTimeMs}
          onChange={(event) => {
            const value = parseIntegerInput(event.target.value);
            if (value !== null && value > 0) {
              onTravelTimeChange(value);
            }
          }}
        />
      </label>
      <p>Travel time must be greater than 0 ms.</p>
      <label>
        Global offset (ms)
        <input
          aria-label="Global offset (ms)"
          type="number"
          value={globalOffsetMs}
          onChange={(event) => {
            const value = parseIntegerInput(event.target.value);
            if (value !== null) {
              onGlobalOffsetChange(value);
            }
          }}
        />
      </label>
    </fieldset>
  );
}
