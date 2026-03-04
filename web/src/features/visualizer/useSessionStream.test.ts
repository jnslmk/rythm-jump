import { describe, expect, it } from 'vitest';

import {
  buildSessionStreamUrl,
  reduceStreamLevels,
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
