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

export function shouldIgnoreKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  const interactiveSelector =
    'input, textarea, select, button, a, [role="button"], [role="link"]';

  const tagName = target.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }

  if (tagName === 'button' || tagName === 'a') {
    return true;
  }

  if (target.closest(interactiveSelector) !== null) {
    return true;
  }

  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }

  if (target.getAttribute('contenteditable') === 'true') {
    return true;
  }

  return target.closest('[contenteditable="true"]') !== null;
}

export function useKeyboardInput(onAction: (action: KeyboardAction) => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (shouldIgnoreKeyboardTarget(event.target)) {
        return;
      }

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
