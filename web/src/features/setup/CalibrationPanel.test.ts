import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CalibrationPanel } from './CalibrationPanel';

afterEach(() => {
  cleanup();
});

describe('CalibrationPanel', () => {
  it('ignores invalid numeric input', () => {
    const onTravelTimeChange = vi.fn();
    const onGlobalOffsetChange = vi.fn();

    render(
      createElement(CalibrationPanel, {
        travelTimeMs: 1200,
        globalOffsetMs: 0,
        onTravelTimeChange,
        onGlobalOffsetChange
      })
    );

    fireEvent.change(screen.getByLabelText('Travel time (ms)'), {
      target: { value: 'abc' }
    });

    expect(onTravelTimeChange).not.toHaveBeenCalled();
  });

  it('ignores non-positive travel time updates', () => {
    const onTravelTimeChange = vi.fn();
    const onGlobalOffsetChange = vi.fn();

    render(
      createElement(CalibrationPanel, {
        travelTimeMs: 1200,
        globalOffsetMs: 0,
        onTravelTimeChange,
        onGlobalOffsetChange
      })
    );

    fireEvent.change(screen.getByLabelText('Travel time (ms)'), {
      target: { value: '0' }
    });
    fireEvent.change(screen.getByLabelText('Travel time (ms)'), {
      target: { value: '-10' }
    });

    expect(onTravelTimeChange).not.toHaveBeenCalled();
  });

  it('emits valid positive travel time updates', () => {
    const onTravelTimeChange = vi.fn();
    const onGlobalOffsetChange = vi.fn();

    render(
      createElement(CalibrationPanel, {
        travelTimeMs: 1200,
        globalOffsetMs: 0,
        onTravelTimeChange,
        onGlobalOffsetChange
      })
    );

    fireEvent.change(screen.getByLabelText('Travel time (ms)'), {
      target: { value: '1400' }
    });

    expect(onTravelTimeChange).toHaveBeenCalledWith(1400);
  });
});
