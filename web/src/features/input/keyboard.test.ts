import { describe, expect, it } from 'vitest';

import { mapKeyboardKey } from './useKeyboardInput';

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
