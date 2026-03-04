import { describe, expect, it } from 'vitest';

import { computeSideBarLayout } from './VisualizerCanvas';

describe('computeSideBarLayout', () => {
  it('maps left lane level only to left-side bar', () => {
    const neutral = computeSideBarLayout([0, 0], 420, 140);
    const leftPulse = computeSideBarLayout([1, 0], 420, 140);

    expect(leftPulse.left.height).toBeGreaterThan(neutral.left.height);
    expect(leftPulse.right.height).toBe(neutral.right.height);
  });

  it('maps right lane level only to right-side bar', () => {
    const neutral = computeSideBarLayout([0, 0], 420, 140);
    const rightPulse = computeSideBarLayout([0, 1], 420, 140);

    expect(rightPulse.right.height).toBeGreaterThan(neutral.right.height);
    expect(rightPulse.left.height).toBe(neutral.left.height);
  });
});
