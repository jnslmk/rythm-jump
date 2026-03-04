export type RuntimeMode = 'browser-attached' | 'headless';

type ModeSelectorProps = {
  value: RuntimeMode;
  onChange: (mode: RuntimeMode) => void;
};

export function ModeSelector({ value, onChange }: ModeSelectorProps) {
  return (
    <label>
      Runtime mode
      <select
        aria-label="Runtime mode"
        value={value}
        onChange={(event) => onChange(event.target.value as RuntimeMode)}
      >
        <option value="browser-attached">browser-attached</option>
        <option value="headless">headless</option>
      </select>
    </label>
  );
}
