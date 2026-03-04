import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ChartEditor } from './ChartEditor';

describe('ChartEditor', () => {
  it('saves independent left/right arrays in payload', () => {
    const onSave = vi.fn();

    render(
      createElement(ChartEditor, {
        songId: 'demo',
        travelTimeMs: 1200,
        globalOffsetMs: 0,
        onSave
      })
    );

    fireEvent.change(screen.getByLabelText('Left lane timings (ms)'), {
      target: { value: '100, 200, 300' }
    });
    fireEvent.change(screen.getByLabelText('Right lane timings (ms)'), {
      target: { value: '150, 250' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save chart' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      song_id: 'demo',
      travel_time_ms: 1200,
      global_offset_ms: 0,
      judgement_windows_ms: {
        perfect: 50,
        good: 100
      },
      left: [100, 200, 300],
      right: [150, 250]
    });
  });
});
