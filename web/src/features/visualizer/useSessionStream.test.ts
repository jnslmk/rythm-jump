import { describe, expect, it } from 'vitest';

import {
  buildSessionStreamUrl,
  reduceStreamLevels,
  resetStreamLevels,
  type VisualizerLevels
} from './useSessionStream';

describe('buildSessionStreamUrl', () => {
  it('includes session id in websocket path', () => {
    const url = buildSessionStreamUrl('session-42', {
      protocol: 'https:',
      host: 'example.com'
    });

    expect(url).toBe('wss://example.com/ws/session/session-42');
  });
});

describe('reduceStreamLevels', () => {
  it('pulses left lane on lane_event', () => {
    const next = reduceStreamLevels([0, 0], {
      type: 'lane_event',
      lane: 'left',
      session_id: 'abc'
    });

    expect(next).toEqual<VisualizerLevels>([1, 0]);
  });

  it('pulses right lane on lane_event', () => {
    const next = reduceStreamLevels([0.3, 0], {
      type: 'lane_event',
      lane: 'right',
      session_id: 'abc'
    });

    expect(next).toEqual<VisualizerLevels>([0.3, 1]);
  });

  it('decays both levels on clock_tick', () => {
    const next = reduceStreamLevels([1, 0.5], {
      type: 'clock_tick',
      tick: 4,
      session_id: 'abc'
    });

    expect(next).toEqual<VisualizerLevels>([0.85, 0.425]);
  });

  it('ignores unknown events without throwing', () => {
    expect(() =>
      reduceStreamLevels([0.2, 0.4], {
        type: 'not_real',
        session_id: 'abc'
      })
    ).not.toThrow();

    expect(
      reduceStreamLevels([0.2, 0.4], {
        type: 'not_real',
        session_id: 'abc'
      })
    ).toEqual<VisualizerLevels>([0.2, 0.4]);
  });
});

describe('resetStreamLevels', () => {
  it('resets levels to defaults for session changes', () => {
    expect(resetStreamLevels([1, 1])).toEqual<VisualizerLevels>([0, 0]);
  });
});
