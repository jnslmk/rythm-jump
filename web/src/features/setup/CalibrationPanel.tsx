type CalibrationPanelProps = {
  travelTimeMs: number;
  globalOffsetMs: number;
  onTravelTimeChange: (value: number) => void;
  onGlobalOffsetChange: (value: number) => void;
};

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
          onChange={(event) => onTravelTimeChange(Number(event.target.value))}
        />
      </label>
      <label>
        Global offset (ms)
        <input
          aria-label="Global offset (ms)"
          type="number"
          value={globalOffsetMs}
          onChange={(event) => onGlobalOffsetChange(Number(event.target.value))}
        />
      </label>
    </fieldset>
  );
}
