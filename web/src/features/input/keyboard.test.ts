import { describe, expect, it } from 'vitest';

import { mapKeyboardKey, shouldIgnoreKeyboardTarget } from './useKeyboardInput';

describe('mapKeyboardKey', () => {
  it('maps left actions', () => {
    expect(mapKeyboardKey('A')).toBe('left');
    expect(mapKeyboardKey('a')).toBe('left');
    expect(mapKeyboardKey(' ')).toBe('left');
    expect(mapKeyboardKey('Space')).toBe('left');
  });

  it('maps right actions', () => {
    expect(mapKeyboardKey('L')).toBe('right');
    expect(mapKeyboardKey('l')).toBe('right');
    expect(mapKeyboardKey('Enter')).toBe('right');
  });

  it('returns null for unrelated keys', () => {
    expect(mapKeyboardKey('ArrowLeft')).toBeNull();
    expect(mapKeyboardKey('x')).toBeNull();
  });
});

describe('shouldIgnoreKeyboardTarget', () => {
  it('ignores form controls', () => {
    expect(shouldIgnoreKeyboardTarget(document.createElement('input'))).toBe(true);
    expect(shouldIgnoreKeyboardTarget(document.createElement('textarea'))).toBe(true);
    expect(shouldIgnoreKeyboardTarget(document.createElement('select'))).toBe(true);
  });

  it('ignores contenteditable elements', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');

    expect(shouldIgnoreKeyboardTarget(editable)).toBe(true);
  });

  it('does not ignore regular elements', () => {
    expect(shouldIgnoreKeyboardTarget(document.createElement('div'))).toBe(false);
  });
});
