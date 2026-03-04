import { useEffect } from 'react';

export type KeyboardAction = 'left' | 'right';

const KEY_MAPPING: Record<string, KeyboardAction> = {
  a: 'left',
  ' ': 'left',
  Space: 'left',
  Spacebar: 'left',
  l: 'right',
  Enter: 'right'
};

export function mapKeyboardKey(key: string): KeyboardAction | null {
  if (key.length === 1 && /[A-Za-z]/.test(key)) {
    return KEY_MAPPING[key.toLowerCase()] ?? null;
  }

  return KEY_MAPPING[key] ?? null;
}

export function useKeyboardInput(onAction: (action: KeyboardAction) => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const action = mapKeyboardKey(event.key);
      if (!action) {
        return;
      }

      event.preventDefault();
      onAction(action);
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onAction]);
}
