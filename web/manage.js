const apiBaseUrl = '/api';
const MANAGE_SELECTED_SONG_KEY = 'manage:selectedSongId';
const MIN_SPECTRAL_RMS = window.SpectralWaveform?.MIN_SPECTRAL_RMS || 0.001;
const WAVEFORM_ZOOM_MIN = 1;
const MAX_VISIBLE_BEATS = 16;
const SUBDIVISIONS_PER_BEAT = 2;
const BEAT_GRID_OVERSCAN_SUBDIVISIONS = 96;

let wavesurfer = null;
let wsRegions = null;
let currentSongId = '';
let beatGridWindowRenderRafId = 0;
let lastRenderedBeatGridRange = { startIndex: -1, endIndex: -1 };
let manageWaveformController = null;
let state = {
  songs: [],
  bpm: 120,
  offset: 0,
  left: [],
  right: [],
  audioAnalysis: null,
  chartDurationMs: 1,
  spectralRmsMax: 1,
  waveformZoom: 1,
  beats: [],
  subdivisions: [],
  beatIntervalMs: 500,
  subdivisionIntervalMs: 250,
  beatSelections: {
    left: new Set(),
    right: new Set()
  },
  chartBaselineSignature: '',
  hasUnsavedChartChanges: false
};

function sortObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortObjectKeys(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(sortObjectKeys(value));
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeTimingArray(values) {
  return Array.from(new Set((values || []).map((value) => Math.round(normalizeNumber(value, 0)))))
    .sort((a, b) => a - b);
}

function buildCurrentChartPayload() {
  const bpmInput = document.getElementById('song-bpm');
  const offsetInput = document.getElementById('global-offset');
  return {
    song_id: currentSongId,
    travel_time_ms: 1200, // Should probably be configurable per song
    global_offset_ms: Math.round(normalizeNumber(offsetInput?.value, state.offset)),
    judgement_windows_ms: { perfect: 50, good: 100 },
    left: normalizeTimingArray(state.left),
    right: normalizeTimingArray(state.right),
    bpm: normalizeNumber(bpmInput?.value, state.bpm),
    audio_analysis: state.audioAnalysis || null
  };
}

function refreshChartDirtyState() {
  if (!currentSongId) {
    state.hasUnsavedChartChanges = false;
    updateControlStates();
    return;
  }
  const currentSignature = stableStringify(buildCurrentChartPayload());
  state.hasUnsavedChartChanges = state.chartBaselineSignature !== currentSignature;
  updateControlStates();
}

function setChartDirtyBaseline() {
  if (!currentSongId) {
    state.chartBaselineSignature = '';
    state.hasUnsavedChartChanges = false;
    updateControlStates();
    return;
  }
  state.chartBaselineSignature = stableStringify(buildCurrentChartPayload());
  state.hasUnsavedChartChanges = false;
  updateControlStates();
}

function buildBeatTimeline(duration, bpm, offsetSeconds) {
  const beatInterval = 60 / bpm;
  const subdivisionInterval = beatInterval / SUBDIVISIONS_PER_BEAT;
  const beats = [];
  const subdivisions = [];
  const startSubdivisionIndex = Math.ceil(-offsetSeconds / subdivisionInterval);
  let safety = 0;

  for (let i = startSubdivisionIndex; ; i++) {
    if (safety++ > 60000) break;
    const time = offsetSeconds + (i * subdivisionInterval);
    if (time > duration) break;
    if (time < 0) continue;

    const subdivisionInBeat = ((i % SUBDIVISIONS_PER_BEAT) + SUBDIVISIONS_PER_BEAT) % SUBDIVISIONS_PER_BEAT;
    const beatIndex = Math.floor(i / SUBDIVISIONS_PER_BEAT);
    const slot = {
      index: i,
      time,
      timeMs: Math.max(0, Math.round(time * 1000)),
      subdivisionInBeat,
      beatIndex,
      isBeatStart: subdivisionInBeat === 0
    };
    subdivisions.push(slot);
    if (slot.isBeatStart) {
      beats.push({
        index: beatIndex,
        time,
        timeMs: slot.timeMs,
        isBar: ((beatIndex % 4) + 4) % 4 === 0
      });
    }
  }

  return {
    beats,
    subdivisions,
    beatInterval,
    subdivisionInterval
  };
}

function findClosestSubdivisionIndex(timeMs, toleranceMs) {
  if (!state.subdivisions.length) return -1;

  let bestIdx = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < state.subdivisions.length; i++) {
    const diff = Math.abs(state.subdivisions[i].timeMs - timeMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    } else if (state.subdivisions[i].timeMs > timeMs && diff > bestDiff) {
      break;
    }
  }

  return bestDiff <= toleranceMs ? bestIdx : -1;
}

function ensureManageWaveformController() {
  if (manageWaveformController || !window.SpectralWaveform) {
    return manageWaveformController;
  }

  manageWaveformController = window.SpectralWaveform.createController({
    canvas: '#manage-spectral-waveform',
    scrollContainer: '#spectral-waveform-scroll',
    overviewCanvas: '#manage-spectral-waveform-overview',
    emptyMessage: 'Run Analyze Song to render a colored waveform.',
    getAnalysis: () => state.audioAnalysis,
    getBarBeats: () => state.beats.filter((beat) => beat.isBar),
    getBeatTimesMs: () => (state.beats.length
      ? state.beats.map((beat) => beat.timeMs)
      : (state.audioAnalysis?.beat_times_ms || [])),
    getDurationMs: resolveManageWaveformDurationMs,
    getProgressMs: () => (wavesurfer?.getCurrentTime?.() || 0) * 1000,
    getRmsMax: () => state.spectralRmsMax,
    getZoom: () => state.waveformZoom || 1,
    onScroll: () => {
      scheduleBeatGridWindowRender();
    },
    onVisibleWindowChange: () => {
      scheduleBeatGridWindowRender();
    },
    shouldAutoFollow: () => isWavePlaying
  });
  manageWaveformController.attach();
  return manageWaveformController;
}

function buildBeatSelectionSets() {
  const sets = {
    left: new Set(),
    right: new Set()
  };

  if (!state.subdivisions.length) {
    state.beatSelections = sets;
    return sets;
  }

  const toleranceMs = Math.max((state.subdivisionIntervalMs || 0) * 0.45, 20);

  for (const lane of ['left', 'right']) {
    const quantized = [];
    for (const timing of state[lane]) {
      const idx = findClosestSubdivisionIndex(timing, toleranceMs);
      if (idx >= 0) {
        sets[lane].add(idx);
        quantized.push(state.subdivisions[idx].timeMs);
      }
    }
    state[lane] = Array.from(new Set(quantized)).sort((a, b) => a - b);
  }

  state.beatSelections = sets;
  return sets;
}

function renderBeatGrid() {
  const beatGrid = document.getElementById('zoom-beat-grid');
  if (!beatGrid) return;

  beatGrid.innerHTML = '';
  beatGrid.style.gridTemplateColumns = '1fr';

  if (!state.subdivisions.length) {
    beatGrid.innerHTML = '<p class="beat-grid-empty">Beat grid will appear after a song loads.</p>';
    state.beatSelections = {
      left: new Set(),
      right: new Set()
    };
    lastRenderedBeatGridRange = { startIndex: -1, endIndex: -1 };
    return;
  }

  const selections = buildBeatSelectionSets();
  const fragment = document.createDocumentFragment();
  const durationMs = Math.max(resolveManageWaveformDurationMs(), 1);
  const subdivisionMs = Math.max(state.subdivisionIntervalMs || 0, 1);
  const visibleWindow = getVisibleWaveformWindowRatios();
  const visibleStartMs = Math.max(0, visibleWindow.start * durationMs);
  const visibleEndMs = Math.max(visibleStartMs, visibleWindow.end * durationMs);
  const overscanMs = subdivisionMs * BEAT_GRID_OVERSCAN_SUBDIVISIONS;
  const renderStartMs = Math.max(0, visibleStartMs - overscanMs);
  const renderEndMs = Math.min(durationMs, visibleEndMs + overscanMs);
  const startIndex = lowerBoundSubdivisionIndex(renderStartMs);
  const endIndex = upperBoundSubdivisionIndex(renderEndMs);
  const clampedStart = Math.max(0, Math.min(startIndex, state.subdivisions.length - 1));
  const clampedEnd = Math.max(clampedStart, Math.min(endIndex, state.subdivisions.length - 1));
  const firstRenderedMs = state.subdivisions[clampedStart]?.timeMs || 0;
  const lastRenderedMs = state.subdivisions[clampedEnd]?.timeMs || firstRenderedMs;
  const tailMs = Math.max(durationMs - (lastRenderedMs + subdivisionMs), 0);
  const leadUnits = Math.max(firstRenderedMs / subdivisionMs, 0);
  const tailUnits = Math.max(tailMs / subdivisionMs, 0);
  const visibleCount = Math.max(clampedEnd - clampedStart + 1, 1);
  const startTrack = leadUnits > 0.0001 ? `minmax(0, ${leadUnits}fr) ` : '';
  const endTrack = tailUnits > 0.0001 ? ` minmax(0, ${tailUnits}fr)` : '';
  beatGrid.style.gridTemplateColumns = `${startTrack}repeat(${visibleCount}, minmax(0, 1fr))${endTrack}`;

  if (leadUnits > 0.0001) {
    const leadSpacer = document.createElement('div');
    leadSpacer.className = 'beat-grid-spacer';
    leadSpacer.setAttribute('aria-hidden', 'true');
    fragment.appendChild(leadSpacer);
  }

  for (let index = clampedStart; index <= clampedEnd; index += 1) {
    const slot = state.subdivisions[index];
    const column = document.createElement('div');
    column.className = slot.isBeatStart ? 'beat-column beat-start' : 'beat-column';
    if (slot.isBeatStart && ((slot.beatIndex % 4) + 4) % 4 === 0) {
      column.classList.add('bar');
    }
    column.dataset.beatIndex = String(index);

    const leftBtn = document.createElement('button');
    leftBtn.type = 'button';
    leftBtn.className = 'beat-cell';
    leftBtn.dataset.beatIndex = String(index);
    leftBtn.dataset.lane = 'left';
    leftBtn.textContent = 'L';
    leftBtn.setAttribute('title', `Left note at ${slot.timeMs} ms`);
    leftBtn.setAttribute('aria-pressed', selections.left.has(index));
    if (selections.left.has(index)) leftBtn.classList.add('active');

    const rightBtn = document.createElement('button');
    rightBtn.type = 'button';
    rightBtn.className = 'beat-cell';
    rightBtn.dataset.beatIndex = String(index);
    rightBtn.dataset.lane = 'right';
    rightBtn.textContent = 'R';
    rightBtn.setAttribute('title', `Right note at ${slot.timeMs} ms`);
    rightBtn.setAttribute('aria-pressed', selections.right.has(index));
    if (selections.right.has(index)) rightBtn.classList.add('active');

    column.appendChild(leftBtn);
    column.appendChild(rightBtn);
    fragment.appendChild(column);
  }

  if (tailUnits > 0.0001) {
    const tailSpacer = document.createElement('div');
    tailSpacer.className = 'beat-grid-spacer';
    tailSpacer.setAttribute('aria-hidden', 'true');
    fragment.appendChild(tailSpacer);
  }

  beatGrid.appendChild(fragment);
  lastRenderedBeatGridRange = { startIndex: clampedStart, endIndex: clampedEnd };
}

function lowerBoundSubdivisionIndex(targetMs) {
  if (!state.subdivisions.length) {
    return 0;
  }
  let low = 0;
  let high = state.subdivisions.length - 1;
  let answer = state.subdivisions.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if ((state.subdivisions[mid]?.timeMs || 0) >= targetMs) {
      answer = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return answer;
}

function upperBoundSubdivisionIndex(targetMs) {
  if (!state.subdivisions.length) {
    return 0;
  }
  let low = 0;
  let high = state.subdivisions.length - 1;
  let answer = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if ((state.subdivisions[mid]?.timeMs || 0) <= targetMs) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return answer;
}

function scheduleBeatGridWindowRender() {
  if (!state.subdivisions.length) {
    return;
  }
  if (beatGridWindowRenderRafId) {
    return;
  }
  beatGridWindowRenderRafId = window.requestAnimationFrame(() => {
    beatGridWindowRenderRafId = 0;
    const durationMs = Math.max(resolveManageWaveformDurationMs(), 1);
    const visibleWindow = getVisibleWaveformWindowRatios();
    const visibleStartMs = Math.max(0, visibleWindow.start * durationMs);
    const visibleEndMs = Math.max(visibleStartMs, visibleWindow.end * durationMs);
    const subdivisionMs = Math.max(state.subdivisionIntervalMs || 0, 1);
    const overscanMs = subdivisionMs * BEAT_GRID_OVERSCAN_SUBDIVISIONS;
    const startIndex = lowerBoundSubdivisionIndex(Math.max(0, visibleStartMs - overscanMs));
    const endIndex = upperBoundSubdivisionIndex(Math.min(durationMs, visibleEndMs + overscanMs));
    const clampedStart = Math.max(0, Math.min(startIndex, state.subdivisions.length - 1));
    const clampedEnd = Math.max(clampedStart, Math.min(endIndex, state.subdivisions.length - 1));
    if (
      lastRenderedBeatGridRange.startIndex === clampedStart
      && lastRenderedBeatGridRange.endIndex === clampedEnd
    ) {
      return;
    }
    renderBeatGrid();
  });
}

function handleBeatGridClick(event) {
  const button = event.target.closest('button[data-lane]');
  if (!button) return;

  const lane = button.dataset.lane;
  const beatIndex = Number(button.dataset.beatIndex);
  toggleBeatSelection(beatIndex, lane);
}

function toggleBeatSelection(beatIndex, lane) {
  if (!state.subdivisions[beatIndex]) return;

  const laneArray = state[lane];
  const beatMs = state.subdivisions[beatIndex].timeMs;
  const currentlySelected = state.beatSelections?.[lane]?.has(beatIndex) ?? false;

  if (currentlySelected) {
    const removeIdx = laneArray.findIndex((value) => Math.abs(value - beatMs) < 2);
    if (removeIdx >= 0) {
      laneArray.splice(removeIdx, 1);
    }
  } else {
    laneArray.push(beatMs);
    laneArray.sort((a, b) => a - b);
  }

  renderBeatGrid();
  refreshChartDirtyState();
}

function resolveManageWaveformDurationMs() {
  const waveDurationMs = (wavesurfer?.getDuration?.() || 0) * 1000;
  if (Number.isFinite(waveDurationMs) && waveDurationMs > 0) {
    return waveDurationMs;
  }
  if (state.chartDurationMs > 0) {
    return state.chartDurationMs;
  }
  const descriptors = state.audioAnalysis?.beat_descriptors;
  if (Array.isArray(descriptors) && descriptors.length > 0) {
    return Math.max(...descriptors.map((descriptor) => Number(descriptor.time_ms) || 0), 1);
  }
  return 1;
}

function getMaxWaveformZoom() {
  const durationMs = resolveManageWaveformDurationMs();
  const beatIntervalMs = state.beatIntervalMs > 0
    ? state.beatIntervalMs
    : (state.bpm > 0 ? 60000 / state.bpm : 500);
  const targetVisibleWindowMs = beatIntervalMs * MAX_VISIBLE_BEATS;
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(targetVisibleWindowMs) || targetVisibleWindowMs <= 0) {
    return WAVEFORM_ZOOM_MIN;
  }
  return Math.max(WAVEFORM_ZOOM_MIN, durationMs / targetVisibleWindowMs);
}

function clampWaveformZoom(zoom) {
  void zoom;
  return getMaxWaveformZoom();
}

function applyWaveformZoom() {
  ensureManageWaveformController();
  const spectralWaveform = document.getElementById('manage-spectral-waveform');
  const beatGrid = document.getElementById('zoom-beat-grid');
  if (!spectralWaveform) {
    return;
  }

  const zoom = clampWaveformZoom(state.waveformZoom);
  state.waveformZoom = zoom;
  const widthPercent = `${Math.max(zoom * 100, 100)}%`;
  spectralWaveform.style.width = widthPercent;
  if (beatGrid) {
    beatGrid.style.width = widthPercent;
  }

  // WaveSurfer zoom is in pixels/second and 0 is fully zoomed out.
  if (wavesurfer?.zoom) {
    wavesurfer.zoom(zoom <= 1 ? 0 : Math.round((zoom - 1) * 90));
  }

  renderManageSpectralWaveform((wavesurfer?.getCurrentTime?.() || 0) * 1000);
}

function getVisibleWaveformWindowRatios() {
  const controller = ensureManageWaveformController();
  return controller ? controller.getVisibleWindowRatios() : { start: 0, end: 1 };
}

function updateVisibleWaveformWindowRatios(scrollContainer) {
  const controller = ensureManageWaveformController();
  return controller ? controller.updateVisibleWindowRatios(scrollContainer) : { start: 0, end: 1 };
}

function renderManageSpectralWaveform(progressMs = 0) {
  ensureManageWaveformController()?.renderMain(progressMs);
}

function renderManageOverviewWaveform(progressMs = 0) {
  ensureManageWaveformController()?.renderOverview(progressMs);
}

function scheduleManageOverviewWaveformRender(progressMs = 0) {
  ensureManageWaveformController()?.scheduleOverviewRender(progressMs);
}

async function fetchSongs() {
  const response = await fetch(`${apiBaseUrl}/songs`);
  state.songs = await response.json();
  const select = document.getElementById('song-edit-select');
  select.innerHTML = '<option value="">Select a song to edit</option>' + 
    state.songs.map(s => `<option value="${s}">${s}</option>`).join('');

  const persistedSongId = window.localStorage.getItem(MANAGE_SELECTED_SONG_KEY) || '';
  if (persistedSongId && state.songs.includes(persistedSongId)) {
    select.value = persistedSongId;
    await loadSong(persistedSongId);
  } else if (persistedSongId) {
    window.localStorage.removeItem(MANAGE_SELECTED_SONG_KEY);
  }
}

async function loadSong(songId) {
  currentSongId = songId;
  isWavePlaying = false;
  ensureManageWaveformController()?.setVisibleWindowStart(0);
  state.chartBaselineSignature = '';
  state.hasUnsavedChartChanges = false;
  updateControlStates();
  const response = await fetch(`${apiBaseUrl}/charts/${encodeURIComponent(songId)}`);
  const chart = await response.json();
  
  state.bpm = chart.bpm || 120; // Default if not in chart
  state.offset = chart.global_offset_ms || 0;
  state.left = (chart.left || []).slice().sort((a, b) => a - b);
  state.right = (chart.right || []).slice().sort((a, b) => a - b);
  state.audioAnalysis = chart.audio_analysis || null;
  const leftMax = state.left.length ? Math.max(...state.left) : 0;
  const rightMax = state.right.length ? Math.max(...state.right) : 0;
  state.chartDurationMs = Math.max(leftMax, rightMax) + 1200;
  const descriptors = state.audioAnalysis?.beat_descriptors;
  if (Array.isArray(descriptors) && descriptors.length > 0) {
    state.spectralRmsMax = Math.max(
      ...descriptors.map((descriptor) => Number(descriptor.rms) || 0),
      MIN_SPECTRAL_RMS
    );
  } else {
    state.spectralRmsMax = 1;
  }
  state.beats = [];
  state.beatIntervalMs = 500;
  state.subdivisions = [];
  state.subdivisionIntervalMs = 250;
  state.beatSelections = {
    left: new Set(),
    right: new Set()
  };
  renderBeatGrid();
  
  document.getElementById('song-bpm').value = state.bpm;
  document.getElementById('global-offset').value = state.offset;
  setChartDirtyBaseline();
  
  document.getElementById('editor-title').textContent = 'Editing';
  const editor = document.getElementById('song-editor');
  editor.classList.remove('hidden');
  editor.setAttribute('aria-hidden', 'false');
  
  if (wavesurfer) wavesurfer.destroy();
  
  wavesurfer = WaveSurfer.create({
    container: '#waveform',
    waveColor: '#4f46e5',
    progressColor: '#3b82f6',
    cursorColor: '#f43f5e',
    barWidth: 2,
    barRadius: 3,
    height: 128,
    url: `${apiBaseUrl}/songs/${encodeURIComponent(songId)}/audio`
  });
  requestAnimationFrame(() => {
    applyWaveformZoom();
  });
  
  // WaveSurfer 7 Plugin access varies by load method; check common locations
  const Timeline = window.TimelinePlugin || WaveSurfer.Timeline || (WaveSurfer.plugins && WaveSurfer.plugins.Timeline);
  const Regions = window.RegionsPlugin || WaveSurfer.Regions || (WaveSurfer.plugins && WaveSurfer.plugins.Regions);

  if (Timeline) {
    wavesurfer.registerPlugin(Timeline.create({ container: '#timeline' }));
  }
  
  if (Regions) {
    wsRegions = wavesurfer.registerPlugin(Regions.create());
  }
  
  wavesurfer.on('audioprocess', (time) => {
    document.getElementById('audio-time').textContent = 
      `${formatTime(time)} / ${formatTime(wavesurfer.getDuration())}`;
    renderManageSpectralWaveform(time * 1000);
  });
  
  wavesurfer.on('ready', () => {
    isWavePlaying = false;
    document.getElementById('audio-time').textContent = 
      `0:00 / ${formatTime(wavesurfer.getDuration())}`;
    updateBeatGrid();
    setChartDirtyBaseline();
    state.waveformZoom = getMaxWaveformZoom();
    applyWaveformZoom();
    updateControlStates();
  });

  wavesurfer.on('play', () => {
    isWavePlaying = true;
    updateControlStates();
    renderManageSpectralWaveform(wavesurfer.getCurrentTime() * 1000);
  });

  wavesurfer.on('pause', () => {
    isWavePlaying = false;
    updateControlStates();
    renderManageSpectralWaveform(wavesurfer.getCurrentTime() * 1000);
  });

  wavesurfer.on('finish', () => {
    isWavePlaying = false;
    updateControlStates();
    renderManageSpectralWaveform(state.chartDurationMs);
  });
}

function updateBeatGrid() {
  if (!wavesurfer || !wsRegions) {
    state.beats = [];
    state.subdivisions = [];
    state.beatIntervalMs = 0;
    state.subdivisionIntervalMs = 0;
    renderBeatGrid();
    return;
  }

  wsRegions.clearRegions();

  const bpm = parseFloat(document.getElementById('song-bpm').value) || 120;
  const offsetMs = parseFloat(document.getElementById('global-offset').value) || 0;
  const offset = offsetMs / 1000;
  const duration = wavesurfer.getDuration();

  if (bpm <= 0 || !duration) {
    state.beats = [];
    state.subdivisions = [];
    state.beatIntervalMs = 0;
    state.subdivisionIntervalMs = 0;
    renderBeatGrid();
    return;
  }

  const { beats, subdivisions, beatInterval, subdivisionInterval } = buildBeatTimeline(duration, bpm, offset);
  state.beats = beats;
  state.subdivisions = subdivisions;
  state.beatIntervalMs = beatInterval * 1000;
  state.subdivisionIntervalMs = subdivisionInterval * 1000;
  state.waveformZoom = clampWaveformZoom(state.waveformZoom);
  applyWaveformZoom();
  renderBeatGrid();

  beats.forEach((beat) => {
    wsRegions.addRegion({
      start: beat.time,
      end: beat.time + 0.01,
      color: beat.isBar ? '#f6d03f' : 'rgba(255, 255, 255, 0.4)',
      drag: false,
      resize: false,
      content: beat.isBar ? 'BAR' : ''
    });
  });
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

let tapTimes = [];
let isWavePlaying = false;

function setControlEnabled(id, enabled) {
  const element = document.getElementById(id);
  if (!element) return;
  element.disabled = !enabled;
}

function updatePlayPauseButtonLabel() {
  const button = document.getElementById('btn-play-pause');
  if (!button) return;
  button.textContent = isWavePlaying ? 'Pause' : 'Play';
  button.setAttribute('aria-label', isWavePlaying ? 'Pause audio' : 'Play audio');
}

function updateControlStates() {
  const hasSong = Boolean(currentSongId);
  const hasWave = Boolean(wavesurfer);
  const canEdit = hasSong && hasWave;
  const canStop = canEdit && ((wavesurfer?.getCurrentTime?.() || 0) > 0 || isWavePlaying);

  setControlEnabled('btn-play-pause', canEdit);
  setControlEnabled('btn-stop-playback', canStop);
  setControlEnabled('btn-tap-bpm', canEdit);
  setControlEnabled('btn-auto-pattern', hasSong);
  setControlEnabled('btn-analyze-audio', hasSong);
  setControlEnabled('btn-save-chart', hasSong && state.hasUnsavedChartChanges);
  updatePlayPauseButtonLabel();
}

function stopManagePlayback() {
  if (!wavesurfer) {
    return;
  }
  wavesurfer.pause();
  wavesurfer.setTime(0);
  isWavePlaying = false;
  document.getElementById('audio-time').textContent =
    `0:00 / ${formatTime(wavesurfer.getDuration())}`;
  renderManageSpectralWaveform(0);
  updateControlStates();
}

function tapBpm() {
  const now = performance.now();
  tapTimes.push(now);
  if (tapTimes.length > 10) tapTimes.shift();
  
  if (tapTimes.length > 1) {
    const diffs = [];
    for (let i = 1; i < tapTimes.length; i++) {
      diffs.push(tapTimes[i] - tapTimes[i-1]);
    }
    const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const bpm = Math.round((60000 / avgDiff) * 10) / 10;
    document.getElementById('song-bpm').value = bpm;
    state.bpm = bpm;
  }
}

async function saveChart() {
  if (!state.hasUnsavedChartChanges) return;
  const payload = buildCurrentChartPayload();
  
  const status = document.getElementById('save-status');
  status.textContent = 'Saving...';
  setControlEnabled('btn-save-chart', false);
  
  try {
    const res = await fetch(`${apiBaseUrl}/charts/${encodeURIComponent(currentSongId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      status.textContent = 'Saved successfully!';
      setChartDirtyBaseline();
      setTimeout(() => { status.textContent = ''; }, 3000);
    } else {
      throw new Error('Save failed');
    }
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
  } finally {
    updateControlStates();
  }
}

async function analyzeAudioMetadata() {
  const status = document.getElementById('save-status');
  if (!currentSongId) {
    status.textContent = 'Select a song before analyzing';
    return;
  }

  status.textContent = 'Analyzing audio features...';
  setControlEnabled('btn-analyze-audio', false);

  try {
    const response = await fetch(
      `${apiBaseUrl}/charts/${encodeURIComponent(currentSongId)}/analysis`,
      { method: 'POST' }
    );
    if (!response.ok) {
      const detail = (await response.text()) || response.statusText;
      throw new Error(detail || 'Audio analysis failed');
    }

    const payload = await response.json();
    state.audioAnalysis = payload.analysis || null;
    ensureManageWaveformController()?.invalidateOverviewCache();
    const analyzedOffset = Number(payload?.global_offset_ms);
    if (Number.isFinite(analyzedOffset)) {
      state.offset = Math.round(analyzedOffset);
      document.getElementById('global-offset').value = String(state.offset);
    }
    const descriptors = state.audioAnalysis?.beat_descriptors;
    if (Array.isArray(descriptors) && descriptors.length > 0) {
      state.spectralRmsMax = Math.max(
        ...descriptors.map((descriptor) => Number(descriptor.rms) || 0),
        MIN_SPECTRAL_RMS
      );
    } else {
      state.spectralRmsMax = 1;
    }
    let didUpdateBeatGrid = false;
    const bpm = parseFloat(payload?.bpm);
    if (Number.isFinite(bpm) && bpm > 0) {
      state.bpm = bpm;
      document.getElementById('song-bpm').value = String(bpm);
      updateBeatGrid();
      didUpdateBeatGrid = true;
    }
    if (!didUpdateBeatGrid && Number.isFinite(analyzedOffset)) {
      updateBeatGrid();
    }
    status.textContent = 'Tempo and spectral analysis saved';
    renderManageSpectralWaveform((wavesurfer?.getCurrentTime?.() || 0) * 1000);
    refreshChartDirtyState();
    setTimeout(() => {
      status.textContent = '';
    }, 3000);
  } catch (e) {
    console.error(e);
    status.textContent = e instanceof Error ? e.message : 'Audio analysis failed';
  } finally {
    updateControlStates();
  }
}

async function autoGeneratePattern() {
  const status = document.getElementById('save-status');
  if (!currentSongId) {
    status.textContent = 'Select a song before generating a pattern';
    return;
  }

  status.textContent = 'Generating jump pattern...';
  setControlEnabled('btn-auto-pattern', false);

  try {
    const response = await fetch(
      `${apiBaseUrl}/charts/${encodeURIComponent(currentSongId)}/auto-pattern`,
      { method: 'POST' }
    );
    if (!response.ok) {
      const detail = (await response.text()) || response.statusText;
      throw new Error(detail || 'Pattern generation failed');
    }

    const payload = await response.json();
    state.left = (payload.left || []).slice().sort((a, b) => a - b);
    state.right = (payload.right || []).slice().sort((a, b) => a - b);
    state.audioAnalysis = payload.analysis || state.audioAnalysis;
    ensureManageWaveformController()?.invalidateOverviewCache();

    const generatedOffset = Number(payload.global_offset_ms);
    if (Number.isFinite(generatedOffset)) {
      state.offset = Math.round(generatedOffset);
      document.getElementById('global-offset').value = String(state.offset);
    }
    const generatedBpm = Number(payload.bpm);
    if (Number.isFinite(generatedBpm) && generatedBpm > 0) {
      state.bpm = generatedBpm;
      document.getElementById('song-bpm').value = String(generatedBpm);
    }
    const descriptors = state.audioAnalysis?.beat_descriptors;
    if (Array.isArray(descriptors) && descriptors.length > 0) {
      state.spectralRmsMax = Math.max(
        ...descriptors.map((descriptor) => Number(descriptor.rms) || 0),
        MIN_SPECTRAL_RMS
      );
    } else {
      state.spectralRmsMax = 1;
    }

    updateBeatGrid();
    renderManageSpectralWaveform((wavesurfer?.getCurrentTime?.() || 0) * 1000);
    setChartDirtyBaseline();
    status.textContent = 'Generated beat-balanced jump pattern';
    setTimeout(() => {
      status.textContent = '';
    }, 3000);
  } catch (e) {
    console.error(e);
    status.textContent = e instanceof Error ? e.message : 'Pattern generation failed';
  } finally {
    updateControlStates();
  }
}

function init() {
  document.getElementById('song-edit-select').addEventListener('change', (e) => {
    if (e.target.value) {
      window.localStorage.setItem(MANAGE_SELECTED_SONG_KEY, e.target.value);
      loadSong(e.target.value);
    } else {
      window.localStorage.removeItem(MANAGE_SELECTED_SONG_KEY);
      const editor = document.getElementById('song-editor');
      editor.classList.add('hidden');
      editor.setAttribute('aria-hidden', 'true');
      currentSongId = '';
      isWavePlaying = false;
      ensureManageWaveformController()?.stopScrollDrag();
      ensureManageWaveformController()?.stopOverviewDrag();
      state.audioAnalysis = null;
      state.spectralRmsMax = 1;
      ensureManageWaveformController()?.invalidateOverviewCache();
      ensureManageWaveformController()?.updateVisibleWindowRatios();
      state.chartBaselineSignature = '';
      state.hasUnsavedChartChanges = false;
      if (wavesurfer) {
        wavesurfer.destroy();
        wavesurfer = null;
      }
      renderManageSpectralWaveform(0);
      updateControlStates();
    }
  });
  
  document.getElementById('upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const songId = document.getElementById('new-song-id').value;
    const audioFile = document.getElementById('new-song-audio').files[0];
    const status = document.getElementById('upload-status');
    
    if (!songId || !audioFile) return;
    
    status.textContent = 'Uploading...';
    const uploadBtn = e.target.querySelector('button[type="submit"]');
    if (uploadBtn) uploadBtn.disabled = true;
    
    const formData = new FormData();
    formData.append('song_id', songId);
    formData.append('audio', audioFile);
    
    try {
      const res = await fetch(`${apiBaseUrl}/songs`, {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        status.textContent = 'Upload complete!';
        window.localStorage.setItem(MANAGE_SELECTED_SONG_KEY, songId);
        await fetchSongs();
      } else {
        throw new Error('Upload failed');
      }
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
    } finally {
      if (uploadBtn) uploadBtn.disabled = false;
    }
  });
  
  document.getElementById('btn-play-pause').addEventListener('click', () => {
    if (wavesurfer) wavesurfer.playPause();
  });

  document.getElementById('btn-stop-playback').addEventListener('click', () => {
    stopManagePlayback();
  });
  
  document.getElementById('btn-tap-bpm').addEventListener('click', () => {
    tapBpm();
    updateBeatGrid();
    refreshChartDirtyState();
  });
  document.getElementById('btn-auto-pattern').addEventListener('click', autoGeneratePattern);
  
  document.getElementById('btn-analyze-audio').addEventListener('click', analyzeAudioMetadata);
  
  document.getElementById('song-bpm').addEventListener('input', updateBeatGrid);
  document.getElementById('song-bpm').addEventListener('input', refreshChartDirtyState);
  document.getElementById('global-offset').addEventListener('input', updateBeatGrid);
  document.getElementById('global-offset').addEventListener('input', refreshChartDirtyState);
  document.getElementById('zoom-beat-grid').addEventListener('click', handleBeatGridClick);
  ensureManageWaveformController();
  
  document.getElementById('btn-save-chart').addEventListener('click', saveChart);
  window.addEventListener('resize', () => {
    renderManageSpectralWaveform((wavesurfer?.getCurrentTime?.() || 0) * 1000);
  });
  
  applyWaveformZoom();
  renderBeatGrid();
  renderManageSpectralWaveform(0);
  updateControlStates();
  fetchSongs();
}

window.loadSong = loadSong;
window.renderManageOverviewWaveform = renderManageOverviewWaveform;
window.scheduleManageOverviewWaveformRender = scheduleManageOverviewWaveformRender;
window.updateVisibleWaveformWindowRatios = updateVisibleWaveformWindowRatios;

document.addEventListener('DOMContentLoaded', init);
