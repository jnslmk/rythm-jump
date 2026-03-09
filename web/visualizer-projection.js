(function initVisualizerProjection(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.VisualizerProjection = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function validateStripLength(stripLen) {
    if (!Number.isInteger(stripLen)) {
      throw new TypeError('strip_len must be an int');
    }
    if (stripLen < 2) {
      throw new RangeError('strip_len must be >= 2');
    }
    if (stripLen % 2 !== 0) {
      throw new RangeError('strip_len must be even');
    }
  }

  function validateSide(side) {
    if (side !== 'left' && side !== 'right') {
      throw new RangeError("side must be 'left' or 'right'");
    }
  }

  function validateProgress(progress) {
    if (!Number.isFinite(progress)) {
      throw new RangeError('progress must be finite');
    }
  }

  function projectBarHeadIndex(stripLen, progress, side) {
    validateStripLength(stripLen);
    validateSide(side);
    validateProgress(progress);

    const half = stripLen / 2;
    const clippedProgress = Math.min(Math.max(progress, 0), 1);

    if (side === 'left') {
      return Math.round((half - 1) * (1 - clippedProgress));
    }
    return half + Math.round((half - 1) * clippedProgress);
  }

  function getRenderedBarRange(stripLen, progress, side, span) {
    validateStripLength(stripLen);
    validateSide(side);
    validateProgress(progress);
    if (!Number.isInteger(span) || span < 1) {
      throw new RangeError('span must be a positive int');
    }

    if (progress >= 1) {
      return null;
    }

    const headIndex = projectBarHeadIndex(stripLen, progress, side);
    if (side === 'left') {
      return {
        startIndex: Math.max(0, headIndex - span + 1),
        endIndex: Math.min(stripLen - 1, headIndex),
      };
    }

    return {
      startIndex: Math.min(stripLen - 1, headIndex),
      endIndex: Math.min(stripLen - 1, headIndex + span - 1),
    };
  }

  return {
    getRenderedBarRange,
    projectBarHeadIndex,
  };
}));
