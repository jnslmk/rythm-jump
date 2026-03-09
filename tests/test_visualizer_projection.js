const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getAnimatedBarProgressMs,
  getPlaybackAlignedBarProgressMs,
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

test('playback-aligned progress matches the audio clock', () => {
  assert.equal(getPlaybackAlignedBarProgressMs(1000, 400, 600, 0), 0);
  assert.equal(getPlaybackAlignedBarProgressMs(1000, 400, 850, 0), 250);
  assert.equal(getPlaybackAlignedBarProgressMs(1000, 400, 1200, 0), 400);
});

test('playback-aligned progress falls back to server progress without audio time', () => {
  assert.equal(getPlaybackAlignedBarProgressMs(1000, 400, Number.NaN, 125), 125);
});

test('animated bar progress advances from the last backend progress anchor', () => {
  assert.equal(getAnimatedBarProgressMs(250, 1000, 1125, 400), 375);
});

test('animated bar progress falls back to backend progress without playback anchor', () => {
  assert.equal(getAnimatedBarProgressMs(250, Number.NaN, 1125, 400), 250);
});
