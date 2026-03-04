import { CalibrationPanel } from './CalibrationPanel';
import { ModeSelector, type RuntimeMode } from './ModeSelector';
import { SongSelector } from './SongSelector';

type SetupPanelProps = {
  runtimeMode: RuntimeMode;
  songId: string;
  songs: string[];
  travelTimeMs: number;
  globalOffsetMs: number;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  onSongChange: (songId: string) => void;
  onTravelTimeChange: (value: number) => void;
  onGlobalOffsetChange: (value: number) => void;
  onStart: () => void;
  onStop: () => void;
};

export function SetupPanel({
  runtimeMode,
  songId,
  songs,
  travelTimeMs,
  globalOffsetMs,
  onRuntimeModeChange,
  onSongChange,
  onTravelTimeChange,
  onGlobalOffsetChange,
  onStart,
  onStop
}: SetupPanelProps) {
  return (
    <section>
      <h2>Setup</h2>
      <ModeSelector value={runtimeMode} onChange={onRuntimeModeChange} />
      <SongSelector songs={songs} value={songId} onChange={onSongChange} />
      <CalibrationPanel
        travelTimeMs={travelTimeMs}
        globalOffsetMs={globalOffsetMs}
        onTravelTimeChange={onTravelTimeChange}
        onGlobalOffsetChange={onGlobalOffsetChange}
      />
      <div>
        <button type="button" onClick={onStart}>
          Start
        </button>
        <button type="button" onClick={onStop}>
          Stop
        </button>
      </div>
    </section>
  );
}
