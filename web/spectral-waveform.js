(function initSpectralWaveform(global) {
  const MIN_SPECTRAL_RMS = 0.001;
  const DEFAULT_BAND_LAYERS = [
    { alpha: 0.78, color: 'rgba(249, 115, 22, 0.72)', gain: 1.15 },
    { alpha: 0.78, color: 'rgba(16, 185, 129, 0.72)', gain: 1.0 },
    { alpha: 0.82, color: 'rgba(14, 165, 233, 0.74)', gain: 1.25 }
  ];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  function getElement(target) {
    if (!target) {
      return null;
    }
    if (typeof target === 'string') {
      return document.querySelector(target);
    }
    return target;
  }

  function sampleEnvelopeValue(series, x, width) {
    if (!Array.isArray(series) || series.length === 0 || width <= 0) {
      return 0;
    }
    const seriesLen = series.length;
    const start = Math.floor((x / width) * seriesLen);
    let end = Math.floor(((x + 1) / width) * seriesLen);
    if (end <= start) {
      end = start + 1;
    }

    let maxValue = 0;
    for (let i = start; i < end && i < seriesLen; i += 1) {
      const value = Number(series[i]) || 0;
      if (value > maxValue) {
        maxValue = value;
      }
    }
    return clamp(maxValue, 0, 1);
  }

  function drawDecodedWaveform(ctx, width, centerY, maxAmplitude, analysis, bandLayers) {
    const lowSeries = analysis?.waveform_band_low;
    const midSeries = analysis?.waveform_band_mid;
    const highSeries = analysis?.waveform_band_high;
    if (!Array.isArray(lowSeries) || !Array.isArray(midSeries) || !Array.isArray(highSeries)) {
      return false;
    }
    if (!lowSeries.length || !midSeries.length || !highSeries.length) {
      return false;
    }

    for (let x = 0; x < width; x += 1) {
      const bandValues = [
        sampleEnvelopeValue(lowSeries, x, width),
        sampleEnvelopeValue(midSeries, x, width),
        sampleEnvelopeValue(highSeries, x, width)
      ];

      for (let i = 0; i < bandLayers.length; i += 1) {
        const layer = bandLayers[i];
        const amplitude = Math.max(1, bandValues[i] * layer.gain * maxAmplitude);
        const top = Math.max(0, centerY - amplitude);
        const bottom = Math.min(centerY * 2, centerY + amplitude);
        const barHeight = Math.max(1, bottom - top);
        ctx.globalAlpha = layer.alpha;
        ctx.fillStyle = layer.color;
        ctx.fillRect(x, top, 1, barHeight);
      }
    }

    ctx.globalAlpha = 1;
    return true;
  }

  function drawBeatMarkers(ctx, width, axisY, durationMs, beatTimesMs, isBarStart) {
    if (!Array.isArray(beatTimesMs) || beatTimesMs.length === 0 || durationMs <= 0) {
      return;
    }
    for (let i = 0; i < beatTimesMs.length; i += 1) {
      const beatMs = Number(beatTimesMs[i]) || 0;
      const x = (beatMs / durationMs) * width;
      const barStart = isBarStart(i, beatMs);
      ctx.strokeStyle = barStart ? 'rgba(246, 208, 63, 0.95)' : 'rgba(45, 212, 191, 0.6)';
      ctx.lineWidth = barStart ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 2);
      ctx.lineTo(x, axisY);
      ctx.stroke();
    }
  }

  function drawBarBeatLabels(ctx, width, durationMs, barBeats) {
    if (!Array.isArray(barBeats) || barBeats.length === 0 || durationMs <= 0) {
      return;
    }
    ctx.fillStyle = 'rgba(248, 250, 252, 0.9)';
    ctx.font = "10px 'Space Grotesk', sans-serif";
    for (const barBeat of barBeats) {
      const timeMs = Number(barBeat?.timeMs) || 0;
      const label = Number(barBeat?.index) || 0;
      const x = Math.max(0, Math.min((timeMs / durationMs) * width, width - 1));
      ctx.fillText(String(label + 1), Math.min(x + 3, width - 16), 12);
    }
  }

  function drawTimeAxis(ctx, width, height, durationMs) {
    const axisY = height - 16;
    const labelY = height - 4;
    const tickCount = 8;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, axisY);
    ctx.lineTo(width, axisY);
    ctx.stroke();

    ctx.fillStyle = 'rgba(203, 213, 225, 0.9)';
    ctx.font = "10px 'Space Grotesk', sans-serif";
    for (let i = 0; i <= tickCount; i += 1) {
      const ratio = i / tickCount;
      const x = ratio * width;
      const seconds = ((durationMs * ratio) / 1000).toFixed(1);
      ctx.beginPath();
      ctx.moveTo(x, axisY);
      ctx.lineTo(x, axisY + 4);
      ctx.stroke();
      ctx.fillText(`${seconds}s`, Math.min(x + 2, width - 26), labelY);
    }
  }

  function drawHighlightAndProgress(ctx, width, axisY, durationMs, progressMs, highlightWindowRatios) {
    if (highlightWindowRatios) {
      const startRatio = clamp(Number(highlightWindowRatios.start) || 0, 0, 1);
      const endRatio = clamp(Number(highlightWindowRatios.end) || 1, startRatio, 1);
      const highlightX = startRatio * width;
      const highlightW = Math.max(1, (endRatio - startRatio) * width);
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(highlightX, 0, highlightW, axisY);
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(highlightX, 0.75, highlightW, Math.max(axisY - 1.5, 1));
    }

    const progressX = Math.max(0, Math.min((progressMs / durationMs) * width, width));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(progressX, 0);
    ctx.lineTo(progressX, axisY);
    ctx.stroke();
  }

  function renderCanvas(canvas, config) {
    if (!canvas) {
      return;
    }

    const width = Math.max(canvas.clientWidth || canvas.width || 0, 1);
    const height = Math.max(canvas.clientHeight || canvas.height || 0, 1);
    if (width < 2 || height < 2) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (canvas.width !== width) {
      canvas.width = width;
    }
    if (canvas.height !== height) {
      canvas.height = height;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, width, height);

    const durationMs = Math.max(Number(config.durationMs) || 0, 1);
    const axisPadding = config.showTimeAxis ? 16 : 2;
    const axisY = height - axisPadding;
    const centerY = axisY / 2;
    const maxAmplitude = Math.max(Math.floor((axisY - 4) * 0.45), 8);
    const analysis = config.analysis || null;
    const bandLayers = Array.isArray(config.bandLayers) && config.bandLayers.length
      ? config.bandLayers
      : DEFAULT_BAND_LAYERS;
    const hasDetailedWaveform = drawDecodedWaveform(
      ctx,
      width,
      centerY,
      maxAmplitude,
      analysis,
      bandLayers
    );

    if (config.showBeatMarkers !== false) {
      drawBeatMarkers(
        ctx,
        width,
        axisY,
        durationMs,
        config.beatTimesMs || [],
        config.isBarStart || ((index) => index % 4 === 0)
      );
    }

    if (config.showBarLabels !== false) {
      drawBarBeatLabels(ctx, width, durationMs, config.barBeats || []);
    }

    const descriptors = analysis?.beat_descriptors;
    if (config.showDescriptors !== false && Array.isArray(descriptors) && descriptors.length > 0) {
      const rmsMax = Math.max(Number(config.rmsMax) || 0, MIN_SPECTRAL_RMS);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (const descriptor of descriptors) {
        const timeMs = Number(descriptor.time_ms) || 0;
        const x = (timeMs / durationMs) * width;
        const amplitude = Math.max((Number(descriptor.rms) || 0) / rmsMax, 0) * maxAmplitude;
        ctx.strokeStyle = descriptor.color_hint || '#22d3ee';
        ctx.globalAlpha = 0.82;
        ctx.beginPath();
        ctx.moveTo(x, centerY - amplitude);
        ctx.lineTo(x, centerY + amplitude);
        ctx.stroke();
      }
    } else if (!hasDetailedWaveform) {
      ctx.fillStyle = 'rgba(156, 163, 175, 0.9)';
      ctx.font = "12px 'Space Grotesk', sans-serif";
      ctx.fillText(config.emptyMessage || 'Waveform data unavailable.', 16, 24);
      return;
    }

    const progressMs = Math.max(Number(config.progressMs) || 0, 0);
    drawHighlightAndProgress(
      ctx,
      width,
      axisY,
      durationMs,
      progressMs,
      config.highlightWindowRatios || null
    );

    if (config.showTimeAxis) {
      drawTimeAxis(ctx, width, height, durationMs);
    }
  }

  function createController(config) {
    const controllerState = {
      isScrollDragging: false,
      dragStartX: 0,
      dragStartLeft: 0,
      dragTargetLeft: 0,
      dragRafId: 0,
      isOverviewDragging: false,
      overviewDragOffsetRatio: 0,
      overviewRenderRafId: 0,
      pendingOverviewProgressMs: 0,
      overviewBaseCacheCanvas: null,
      overviewBaseCacheWidth: 0,
      overviewBaseCacheHeight: 0,
      overviewBaseCacheAnalysisRef: null,
      visibleWindowRatios: { start: 0, end: 1 },
      detachFns: []
    };

    function getAnalysis() {
      return config.getAnalysis?.() || null;
    }

    function getDurationMs() {
      return Math.max(Number(config.getDurationMs?.()) || 0, 1);
    }

    function getProgressMs() {
      return Math.max(Number(config.getProgressMs?.()) || 0, 0);
    }

    function getRmsMax() {
      return Math.max(Number(config.getRmsMax?.()) || 0, MIN_SPECTRAL_RMS);
    }

    function getBeatTimesMs() {
      const values = config.getBeatTimesMs?.();
      if (!Array.isArray(values)) {
        return [];
      }
      return values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0);
    }

    function getBarBeats() {
      const values = config.getBarBeats?.();
      if (Array.isArray(values)) {
        return values
          .map((value, index) => {
            const timeMs = Number(value?.timeMs);
            if (!Number.isFinite(timeMs) || timeMs < 0) {
              return null;
            }
            const labelIndex = Number.isFinite(Number(value?.index)) ? Number(value.index) : index;
            return { timeMs, index: labelIndex };
          })
          .filter(Boolean);
      }

      const beatTimesMs = getBeatTimesMs();
      const barBeats = [];
      for (let i = 0; i < beatTimesMs.length; i += 4) {
        barBeats.push({ timeMs: beatTimesMs[i], index: Math.floor(i / 4) });
      }
      return barBeats;
    }

    function getRenderConfig(progressMs, options = {}) {
      return {
        analysis: getAnalysis(),
        bandLayers: config.bandLayers,
        beatTimesMs: getBeatTimesMs(),
        barBeats: getBarBeats(),
        durationMs: getDurationMs(),
        emptyMessage: config.emptyMessage,
        highlightWindowRatios: options.highlightWindowRatios || null,
        isBarStart: config.isBarStart,
        progressMs,
        rmsMax: getRmsMax(),
        showBarLabels: options.showBarLabels,
        showBeatMarkers: options.showBeatMarkers,
        showDescriptors: options.showDescriptors,
        showTimeAxis: options.showTimeAxis ?? config.showTimeAxis === true
      };
    }

    function notifyVisibleWindowChange() {
      config.onVisibleWindowChange?.(controllerState.visibleWindowRatios);
    }

    function updateVisibleWindowRatios(scrollContainer = getElement(config.scrollContainer)) {
      if (!scrollContainer) {
        controllerState.visibleWindowRatios = { start: 0, end: 1 };
        notifyVisibleWindowChange();
        return controllerState.visibleWindowRatios;
      }
      const totalWidth = Math.max(scrollContainer.scrollWidth, 1);
      const viewportWidth = Math.max(scrollContainer.clientWidth, 1);
      const maxLeft = Math.max(totalWidth - viewportWidth, 0);
      const left = clamp(scrollContainer.scrollLeft, 0, maxLeft);
      const right = Math.max(left, Math.min(left + viewportWidth, totalWidth));
      controllerState.visibleWindowRatios = {
        start: left / totalWidth,
        end: right / totalWidth
      };
      notifyVisibleWindowChange();
      return controllerState.visibleWindowRatios;
    }

    function getVisibleWindowRatios() {
      return controllerState.visibleWindowRatios;
    }

    function setVisibleWindowStart(startRatio) {
      const scrollContainer = getElement(config.scrollContainer);
      const zoomedCanvas = getElement(config.canvas);
      if (!scrollContainer || !zoomedCanvas) {
        return;
      }
      const totalWidth = Math.max(zoomedCanvas.clientWidth, 1);
      const viewportWidth = Math.max(scrollContainer.clientWidth, 1);
      const maxStartRatio = Math.max(1 - (viewportWidth / totalWidth), 0);
      const normalizedStartRatio = clamp(startRatio, 0, maxStartRatio);
      const maxLeft = Math.max(totalWidth - viewportWidth, 0);
      scrollContainer.scrollLeft = clamp(normalizedStartRatio * totalWidth, 0, maxLeft);
      updateVisibleWindowRatios(scrollContainer);
      scheduleOverviewRender(getProgressMs());
    }

    function renderMain(progressMs = getProgressMs()) {
      const canvas = getElement(config.canvas);
      renderCanvas(canvas, getRenderConfig(progressMs));

      const scrollContainer = getElement(config.scrollContainer);
      if (
        config.shouldAutoFollow?.() === true
        && !controllerState.isScrollDragging
        && scrollContainer
        && (config.getZoom?.() || 1) > 1
      ) {
        const durationMs = getDurationMs();
        const width = Math.max(canvas?.clientWidth || 1, 1);
        const progressX = Math.max(0, Math.min((progressMs / durationMs) * width, width));
        const leftTarget = progressX - (scrollContainer.clientWidth * 0.5);
        const maxLeft = Math.max(scrollContainer.scrollWidth - scrollContainer.clientWidth, 0);
        scrollContainer.scrollLeft = clamp(leftTarget, 0, maxLeft);
        updateVisibleWindowRatios(scrollContainer);
      }

      scheduleOverviewRender(progressMs);
    }

    function getOverviewBaseCanvas(width, height) {
      const analysisRef = getAnalysis();
      if (
        controllerState.overviewBaseCacheCanvas
        && controllerState.overviewBaseCacheWidth === width
        && controllerState.overviewBaseCacheHeight === height
        && controllerState.overviewBaseCacheAnalysisRef === analysisRef
      ) {
        return controllerState.overviewBaseCacheCanvas;
      }

      controllerState.overviewBaseCacheCanvas = document.createElement('canvas');
      controllerState.overviewBaseCacheCanvas.width = width;
      controllerState.overviewBaseCacheCanvas.height = height;
      controllerState.overviewBaseCacheWidth = width;
      controllerState.overviewBaseCacheHeight = height;
      controllerState.overviewBaseCacheAnalysisRef = analysisRef;
      renderCanvas(
        controllerState.overviewBaseCacheCanvas,
        getRenderConfig(0, {
          showBarLabels: false,
          showBeatMarkers: false,
          showDescriptors: false,
          showTimeAxis: false
        })
      );
      return controllerState.overviewBaseCacheCanvas;
    }

    function renderOverview(progressMs = getProgressMs()) {
      const canvas = getElement(config.overviewCanvas);
      if (!canvas) {
        return;
      }
      if (canvas.clientWidth < 2 || canvas.clientHeight < 2) {
        return;
      }

      const ctx = canvas.getContext('2d');
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      if (canvas.width !== width) {
        canvas.width = width;
      }
      if (canvas.height !== height) {
        canvas.height = height;
      }

      const baseCanvas = getOverviewBaseCanvas(width, height);
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(baseCanvas, 0, 0);
      drawHighlightAndProgress(
        ctx,
        width,
        height - 2,
        getDurationMs(),
        progressMs,
        getVisibleWindowRatios()
      );
    }

    function scheduleOverviewRender(progressMs = getProgressMs()) {
      if (!config.overviewCanvas) {
        return;
      }
      controllerState.pendingOverviewProgressMs = progressMs;
      if (controllerState.overviewRenderRafId) {
        return;
      }
      controllerState.overviewRenderRafId = global.requestAnimationFrame(() => {
        controllerState.overviewRenderRafId = 0;
        renderOverview(controllerState.pendingOverviewProgressMs);
      });
    }

    function invalidateOverviewCache() {
      controllerState.overviewBaseCacheCanvas = null;
      controllerState.overviewBaseCacheWidth = 0;
      controllerState.overviewBaseCacheHeight = 0;
      controllerState.overviewBaseCacheAnalysisRef = null;
    }

    function startScrollDrag(event) {
      if (event.button !== 0) {
        return;
      }
      const scrollContainer = getElement(config.scrollContainer);
      if (!scrollContainer || scrollContainer.scrollWidth <= scrollContainer.clientWidth) {
        return;
      }
      controllerState.isScrollDragging = true;
      controllerState.dragStartX = event.clientX;
      controllerState.dragStartLeft = scrollContainer.scrollLeft;
      scrollContainer.classList.add('dragging');
      event.preventDefault();
    }

    function handleScrollDragMove(event) {
      if (!controllerState.isScrollDragging) {
        return;
      }
      const scrollContainer = getElement(config.scrollContainer);
      if (!scrollContainer) {
        return;
      }
      const dragDelta = event.clientX - controllerState.dragStartX;
      controllerState.dragTargetLeft = controllerState.dragStartLeft - dragDelta;
      if (controllerState.dragRafId) {
        return;
      }
      controllerState.dragRafId = global.requestAnimationFrame(() => {
        controllerState.dragRafId = 0;
        scrollContainer.scrollLeft = controllerState.dragTargetLeft;
        updateVisibleWindowRatios(scrollContainer);
        scheduleOverviewRender(getProgressMs());
      });
    }

    function stopScrollDrag() {
      if (!controllerState.isScrollDragging) {
        return;
      }
      controllerState.isScrollDragging = false;
      if (controllerState.dragRafId) {
        global.cancelAnimationFrame(controllerState.dragRafId);
        controllerState.dragRafId = 0;
      }
      const scrollContainer = getElement(config.scrollContainer);
      if (scrollContainer) {
        scrollContainer.classList.remove('dragging');
      }
      scheduleOverviewRender(getProgressMs());
    }

    function getOverviewPointerRatio(event) {
      const canvas = getElement(config.overviewCanvas);
      if (!canvas) {
        return null;
      }
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0) {
        return null;
      }
      return clamp((event.clientX - rect.left) / rect.width, 0, 1);
    }

    function startOverviewDrag(event) {
      if (event.button !== 0) {
        return;
      }
      const canvas = getElement(config.overviewCanvas);
      if (!canvas) {
        return;
      }
      const pointerRatio = getOverviewPointerRatio(event);
      if (pointerRatio === null) {
        return;
      }
      const visibleWindow = getVisibleWindowRatios();
      const windowWidthRatio = Math.max(visibleWindow.end - visibleWindow.start, 0);
      if (windowWidthRatio >= 1) {
        return;
      }

      if (pointerRatio >= visibleWindow.start && pointerRatio <= visibleWindow.end) {
        controllerState.overviewDragOffsetRatio = pointerRatio - visibleWindow.start;
      } else {
        controllerState.overviewDragOffsetRatio = windowWidthRatio * 0.5;
        setVisibleWindowStart(pointerRatio - controllerState.overviewDragOffsetRatio);
      }

      controllerState.isOverviewDragging = true;
      canvas.classList.add('dragging');
      event.preventDefault();
    }

    function handleOverviewDragMove(event) {
      if (!controllerState.isOverviewDragging) {
        return;
      }
      const pointerRatio = getOverviewPointerRatio(event);
      if (pointerRatio === null) {
        return;
      }
      setVisibleWindowStart(pointerRatio - controllerState.overviewDragOffsetRatio);
    }

    function stopOverviewDrag() {
      if (!controllerState.isOverviewDragging) {
        return;
      }
      controllerState.isOverviewDragging = false;
      const canvas = getElement(config.overviewCanvas);
      if (canvas) {
        canvas.classList.remove('dragging');
      }
    }

    function attach() {
      detach();

      const scrollContainer = getElement(config.scrollContainer);
      if (scrollContainer) {
        const onScroll = () => {
          updateVisibleWindowRatios(scrollContainer);
          config.onScroll?.();
          scheduleOverviewRender(getProgressMs());
        };
        const onMouseDown = (event) => startScrollDrag(event);
        scrollContainer.addEventListener('scroll', onScroll, { passive: true });
        scrollContainer.addEventListener('mousedown', onMouseDown);
        controllerState.detachFns.push(() => {
          scrollContainer.removeEventListener('scroll', onScroll);
          scrollContainer.removeEventListener('mousedown', onMouseDown);
        });
      }

      const overviewCanvas = getElement(config.overviewCanvas);
      if (overviewCanvas) {
        const onOverviewMouseDown = (event) => startOverviewDrag(event);
        overviewCanvas.addEventListener('mousedown', onOverviewMouseDown);
        controllerState.detachFns.push(() => {
          overviewCanvas.removeEventListener('mousedown', onOverviewMouseDown);
        });
      }

      const onWindowMouseMove = (event) => {
        handleScrollDragMove(event);
        handleOverviewDragMove(event);
      };
      const onWindowMouseUp = () => {
        stopScrollDrag();
        stopOverviewDrag();
      };
      global.addEventListener('mousemove', onWindowMouseMove);
      global.addEventListener('mouseup', onWindowMouseUp);
      controllerState.detachFns.push(() => {
        global.removeEventListener('mousemove', onWindowMouseMove);
        global.removeEventListener('mouseup', onWindowMouseUp);
      });

      updateVisibleWindowRatios(scrollContainer);
      scheduleOverviewRender(getProgressMs());
    }

    function detach() {
      stopScrollDrag();
      stopOverviewDrag();
      while (controllerState.detachFns.length) {
        const fn = controllerState.detachFns.pop();
        fn();
      }
    }

    return {
      attach,
      detach,
      getVisibleWindowRatios,
      invalidateOverviewCache,
      renderMain,
      renderOverview,
      scheduleOverviewRender,
      setVisibleWindowStart,
      stopOverviewDrag,
      stopScrollDrag,
      updateVisibleWindowRatios
    };
  }

  global.SpectralWaveform = {
    DEFAULT_BAND_LAYERS,
    MIN_SPECTRAL_RMS,
    createController,
    renderCanvas
  };
})(window);
