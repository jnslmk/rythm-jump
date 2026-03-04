import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { mapKeyboardKey, shouldIgnoreKeyboardTarget, useKeyboardInput } from './useKeyboardInput';

function KeyboardHookHarness(props: { onAction: (action: 'left' | 'right') => void }) {
  useKeyboardInput(props.onAction);
  return null;
}

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

  it('ignores buttons, links, and role-based controls', () => {
    const roleButton = document.createElement('div');
    roleButton.setAttribute('role', 'button');

    const roleLink = document.createElement('div');
    roleLink.setAttribute('role', 'link');

    expect(shouldIgnoreKeyboardTarget(document.createElement('button'))).toBe(true);
    expect(shouldIgnoreKeyboardTarget(document.createElement('a'))).toBe(true);
    expect(shouldIgnoreKeyboardTarget(roleButton)).toBe(true);
    expect(shouldIgnoreKeyboardTarget(roleLink)).toBe(true);
  });

  it('does not ignore regular elements', () => {
    expect(shouldIgnoreKeyboardTarget(document.createElement('div'))).toBe(false);
  });
});

describe('useKeyboardInput', () => {
  it('ignores Enter on a focused button target', () => {
    const onAction = vi.fn();
    render(createElement(KeyboardHookHarness, { onAction }));

    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onAction).not.toHaveBeenCalled();
    button.remove();
  });

  it('ignores Enter on a focused link target', () => {
    const onAction = vi.fn();
    render(createElement(KeyboardHookHarness, { onAction }));

    const link = document.createElement('a');
    link.href = '#';
    document.body.appendChild(link);
    link.focus();
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onAction).not.toHaveBeenCalled();
    link.remove();
  });
});
