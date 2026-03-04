import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChartEditor } from './ChartEditor';

afterEach(() => {
  cleanup();
});

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

  it('shows save failed when onSave rejects', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('network fail'));

    render(
      createElement(ChartEditor, {
        songId: 'demo',
        travelTimeMs: 1200,
        globalOffsetMs: 0,
        onSave
      })
    );

    fireEvent.change(screen.getByLabelText('Left lane timings (ms)'), {
      target: { value: '100,200' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save chart' }));

    await waitFor(() => {
      expect(screen.getByText('Chart status: Save failed')).toBeInTheDocument();
    });
  });

  it('blocks save when timing inputs contain invalid entries', async () => {
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
      target: { value: '100, abc, 200' }
    });
    fireEvent.change(screen.getByLabelText('Right lane timings (ms)'), {
      target: { value: '-20, 300' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save chart' }));

    await waitFor(() => {
      expect(screen.getByText('Chart status: Invalid timings')).toBeInTheDocument();
    });
    expect(onSave).not.toHaveBeenCalled();
  });
});
