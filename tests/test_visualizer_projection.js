const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getRenderedBarRange,
  projectBarHeadIndex,
} = require('../web/visualizer-projection.js');

test('left lane reaches the first LED at full progress', () => {
  assert.equal(projectBarHeadIndex(70, 1, 'left'), 0);
});

test('right lane reaches the last LED at full progress', () => {
  assert.equal(projectBarHeadIndex(70, 1, 'right'), 69);
});

test('zero progress starts on the center-adjacent LEDs', () => {
  assert.equal(projectBarHeadIndex(70, 0, 'left'), 34);
  assert.equal(projectBarHeadIndex(70, 0, 'right'), 35);
});

test('progress is clipped before projection', () => {
  assert.equal(projectBarHeadIndex(70, -1, 'left'), 34);
  assert.equal(projectBarHeadIndex(70, 2, 'right'), 69);
});

test('completed bars no longer leave an edge pixel lit', () => {
  assert.equal(getRenderedBarRange(70, 1, 'left', 4), null);
  assert.equal(getRenderedBarRange(70, 1, 'right', 4), null);
});
