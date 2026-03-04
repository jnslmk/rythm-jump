import { useCallback, useMemo, useState } from 'react';

import { ChartEditor } from './features/chart/ChartEditor';
import { useKeyboardInput, type KeyboardAction } from './features/input/useKeyboardInput';
import { SetupPanel } from './features/setup/SetupPanel';
import type { RuntimeMode } from './features/setup/ModeSelector';
import { VisualizerCanvas } from './features/visualizer/VisualizerCanvas';
import { useSessionStream } from './features/visualizer/useSessionStream';
import { saveChart } from './lib/api';

const AVAILABLE_SONGS = ['demo'];

export default function App() {
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>('browser-attached');
  const [songId, setSongId] = useState<string>(AVAILABLE_SONGS[0]);
  const [travelTimeMs, setTravelTimeMs] = useState<number>(1200);
  const [globalOffsetMs, setGlobalOffsetMs] = useState<number>(0);
  const [lastAction, setLastAction] = useState<KeyboardAction | 'none'>('none');
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'stopped'>('idle');

  const levels = useSessionStream(songId);

  const handleAction = useCallback((action: KeyboardAction) => {
    setLastAction(action);
  }, []);

  const handleStart = useCallback(() => {
    setRunStatus('running');
  }, []);

  const handleStop = useCallback(() => {
    setRunStatus('stopped');
  }, []);

  const handleSaveChart = useCallback(
    async (payload: Parameters<typeof saveChart>[1]) => {
      await saveChart(songId, payload);
    },
    [songId]
  );

  const runSummary = useMemo(
    () => `${runtimeMode} | ${songId} | ${runStatus}`,
    [runtimeMode, songId, runStatus]
  );

  useKeyboardInput(handleAction);

  return (
    <main>
      <h1>Rhythm Jump Setup</h1>
      <p>Keyboard mode: left (A, Space), right (L, Enter)</p>
      <p>Last action: {lastAction}</p>
      <p>Run status: {runSummary}</p>

      <SetupPanel
        runtimeMode={runtimeMode}
        songId={songId}
        songs={AVAILABLE_SONGS}
        travelTimeMs={travelTimeMs}
        globalOffsetMs={globalOffsetMs}
        onRuntimeModeChange={setRuntimeMode}
        onSongChange={setSongId}
        onTravelTimeChange={setTravelTimeMs}
        onGlobalOffsetChange={setGlobalOffsetMs}
        onStart={handleStart}
        onStop={handleStop}
      />

      <ChartEditor
        songId={songId}
        travelTimeMs={travelTimeMs}
        globalOffsetMs={globalOffsetMs}
        onSave={handleSaveChart}
      />

      <VisualizerCanvas levels={levels} />
    </main>
  );
}
