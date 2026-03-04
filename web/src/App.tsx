import { useCallback, useState } from 'react';

import { useKeyboardInput, type KeyboardAction } from './features/input/useKeyboardInput';
import { VisualizerCanvas } from './features/visualizer/VisualizerCanvas';
import { useSessionStream } from './features/visualizer/useSessionStream';

export default function App() {
  const [lastAction, setLastAction] = useState<KeyboardAction | 'none'>('none');
  const levels = useSessionStream();

  const handleAction = useCallback((action: KeyboardAction) => {
    setLastAction(action);
  }, []);

  useKeyboardInput(handleAction);

  return (
    <main>
      <h1>Rhythm Jump Setup</h1>
      <p>Keyboard mode: left (A, Space), right (L, Enter)</p>
      <p>Last action: {lastAction}</p>
      <VisualizerCanvas levels={levels} />
    </main>
  );
}
