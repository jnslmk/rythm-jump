const apiBaseUrl = '/api';
const theme = window.RhythmJumpTheme || {};
const ui = window.RhythmJumpUi || {};
const WAVE_SURFER_THEME = theme.waveSurfer || {};
const WAVE_SURFER_COLORS = theme.colors?.waveform || {};
const DEFAULT_SESSION_ID = 'default-session';
const GAME_WAVEFORM_ZOOM_STORAGE_KEY = 'rhythmJumpGameWaveformZoom';
const MAX_TIMELINE_ENTRIES = 12;
const MIN_SPECTRAL_RMS = window.SpectralWaveform?.MIN_SPECTRAL_RMS || 0.001;
const GAME_WAVEFORM_ZOOM_MIN = 1;
const GAME_WAVEFORM_TARGET_WINDOW_MS = 12000;
const GAME_NOTE_SNAP_MAX_MS = 180;
const GAME_BEAT_GRID_OVERSCAN_SLOTS = 96;
const ACTIVE_BAR_SPAN = 4;
const ACTIVE_BAR_FLASH_WINDOW_MS = 260;
const ACTIVE_BAR_COLORS = theme.colors?.activeBars || {
  left: 'rgba(90, 210, 255, 0.9)',
  right: 'rgba(255, 105, 160, 0.9)',
  perfect: 'rgba(253, 224, 71, 0.98)',
  good: 'rgba(134, 239, 172, 0.96)',
  miss: 'rgba(248, 113, 113, 0.96)',
  fallback: '#f8fafc',
};

const KEY_MAPPING = {
  a: 'left',
  ' ': 'left',
  Space: 'left',
  l: 'right',
  Enter: 'right'
};

function loadStoredGameWaveformZoom() {
  const stored = Number(localStorage.getItem(GAME_WAVEFORM_ZOOM_STORAGE_KEY));
  if (!Number.isFinite(stored) || stored < GAME_WAVEFORM_ZOOM_MIN) {
    return GAME_WAVEFORM_ZOOM_MIN;
  }
  return stored;
}

function createLaneNoteResults() {
  return { left: new Map(), right: new Map() };
}

let state = {
  songId: '',
  runStatus: 'idle',
  levels: [0, 0],
  ledPixels: [],
  songs: [],
  activeBars: {},
  triggerTimeline: { left: [], right: [] },
  pressTimeline: { left: [], right: [] },
  remainingMs: 0,
  sessionProgressMs: 0,
  pendingStartSongId: null,
  chart: null,
  chartDurationMs: 0,
  spectralRmsMax: 1,
  sessionStartMs: null,
  waveformZoom: loadStoredGameWaveformZoom(),
  visibleWaveformWindowRatios: { start: 0, end: 1 },
  gameBeatSlots: [],
  gameBeatSlotTimesMs: [],
  gameBeatSlotBaseGapMs: 1,
  gameNoteSlotSets: { left: new Set(), right: new Set() },
  noteHitResults: createLaneNoteResults(),
};

let gameWaveSurfer = null;
let gameWaveformController = null;
let gameWaveformRenderRafId = 0;
let gamePlaybackRenderRafId = 0;
let gameUiRenderRafId = 0;
let pendingGameWaveformProgressMs = 0;
let pendingGameUiProgressMs = 0;
let gameBeatGridWindowRenderRafId = 0;
let lastRenderedGameBeatGridRange = { startIndex: -1, endIndex: -1 };
let visualizerBackgroundCanvas = null;
let visualizerBackgroundCacheWidth = 0;
let visualizerBackgroundCacheHeight = 0;
let ledBeatFeedbackSignature = '';
let ledBeatFeedbackMarkerRefs = { left: [], right: [] };

function getElement(id) {
  return ui.byId ? ui.byId(id) : document.getElementById(id);
}

async function requestJson(url, options, errorMessage) {
  if (ui.fetchJson) {
    return ui.fetchJson(url, options, errorMessage);
  }
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(errorMessage || response.statusText || 'Request failed');
  }
  return response.json();
}

function populateSelectOptions(select, values, options = {}) {
  if (ui.populateSelect) {
    ui.populateSelect(select, values, options);
    return;
  }
  if (!select) {
    return;
  }
  const { placeholder = '', emptyLabel = placeholder } = options;
  const fragment = document.createDocumentFragment();
  const initialOption = document.createElement('option');
  initialOption.value = '';
  initialOption.textContent = values.length ? placeholder : emptyLabel;
  fragment.appendChild(initialOption);
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    fragment.appendChild(option);
  }
  select.replaceChildren(fragment);
}

function isSessionPlaying() {
  return state.runStatus === 'playing';
}

function isSessionPaused() {
  return state.runStatus === 'paused';
}

function updateControlStates() {
  const startBtn = getElement('btn-start');
  const stopBtn = getElement('btn-stop');
  const playing = isSessionPlaying();
  const paused = isSessionPaused();

  if (startBtn) {
    startBtn.textContent = playing ? 'Pause Game' : (paused ? 'Resume Game' : 'Start Game');
    startBtn.classList.add('accent-button');
    startBtn.classList.remove('ghost-button');
  }

  if (stopBtn) {
    stopBtn.classList.add('ghost-button');
    stopBtn.classList.remove('accent-button');
    stopBtn.disabled = !playing && !paused;
  }
}

function stopAudioPlayback() {
  const audio = ensureAudioElement();
  audio.pause();
  audio.currentTime = 0;
}

function requestStopSession(clearScreen) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'stop_session' }));
  }
  stopAudioPlayback();
  if (clearScreen) {
    resetSessionState();
  }
  state.runStatus = 'idle';
  updateUI();
}

function requestPauseSession() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'pause_session' }));
  }
  ensureAudioElement().pause();
  state.runStatus = 'paused';
  updateUI();
}

async function requestResumeSession() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'resume_session' }));
  }
  await startAudioPlayback(state.songId, state.sessionProgressMs);
  state.runStatus = 'playing';
  updateUI();
}

function initGameWaveform() {
  if (gameWaveSurfer) return;
  if (typeof WaveSurfer === 'undefined') return;

  const config = {
    container: '#waveform',
    waveColor: WAVE_SURFER_COLORS.wave || '#4f46e5',
    progressColor: WAVE_SURFER_COLORS.progress || '#3b82f6',
    cursorColor: WAVE_SURFER_COLORS.cursor || '#f43f5e',
    barWidth: WAVE_SURFER_THEME.barWidth || 2,
    barRadius: WAVE_SURFER_THEME.barRadius || 3,
    height: WAVE_SURFER_THEME.height?.game || 120,
    responsive: true
  };

  gameWaveSurfer = WaveSurfer.create(config);
  gameWaveSurfer.on('ready', () => {
    applyGameWaveformZoom({ preferExisting: true });
    scheduleGameSpectralWaveformRender();
    renderTimingSummary();
  });
  gameWaveSurfer.on('audioprocess', () => {
    scheduleGameSpectralWaveformRender();
  });
}

function loadGameWaveform(songId) {
  if (!songId) return;
  initGameWaveform();
  if (!gameWaveSurfer) return;
  const url = `${apiBaseUrl}/songs/${encodeURIComponent(songId)}/audio`;
  gameWaveSurfer.load(url);
  scheduleGameSpectralWaveformRender(0);
}

function formatMs(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '--';
  }
  return `${(value / 1000).toFixed(2)}s`;
}

function formatPlaybackTime(value) {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    return '--';
  }
  const totalSeconds = Math.floor(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function computeChartDuration(chart) {
  if (!chart) {
    return 0;
  }
  const leftMax = chart.left.length > 0 ? Math.max(...chart.left) : 0;
  const rightMax = chart.right.length > 0 ? Math.max(...chart.right) : 0;
  return Math.max(leftMax, rightMax) + chart.travel_time_ms;
}

function getAnalysisDurationMs(chart) {
  const analysis = chart?.audio_analysis;
  if (!analysis) {
    return 0;
  }
  const explicitDurationMs = Number(analysis.duration_ms) || 0;
  if (explicitDurationMs > 0) {
    return explicitDurationMs;
  }
  const beatDurationMs = Array.isArray(analysis.beat_times_ms) && analysis.beat_times_ms.length > 0
    ? Math.max(...analysis.beat_times_ms.map((value) => Number(value) || 0))
    : 0;
  const descriptorDurationMs = Array.isArray(analysis.beat_descriptors)
    && analysis.beat_descriptors.length > 0
    ? Math.max(...analysis.beat_descriptors.map((descriptor) => Number(descriptor.time_ms) || 0))
    : 0;
  return Math.max(beatDurationMs, descriptorDurationMs);
}

function computeTrackDuration(chart) {
  const analysisDurationMs = getAnalysisDurationMs(chart);
  if (analysisDurationMs > 0) {
    return analysisDurationMs;
  }
  return computeChartDuration(chart);
}

function getAudioDurationMs() {
  const audio = ensureAudioElement();
  const audioDurationMs = (audio?.duration || 0) * 1000;
  if (Number.isFinite(audioDurationMs) && audioDurationMs > 0) {
    return audioDurationMs;
  }
  return 0;
}

function resolveWaveformDurationMs() {
  const audioDurationMs = getAudioDurationMs();
  if (audioDurationMs > 0) {
    return audioDurationMs;
  }
  const waveDurationMs = (gameWaveSurfer?.getDuration?.() || 0) * 1000;
  if (Number.isFinite(waveDurationMs) && waveDurationMs > 0) {
    return waveDurationMs;
  }
  if (state.chartDurationMs > 0) {
    return state.chartDurationMs;
  }
  const descriptors = state.chart?.audio_analysis?.beat_descriptors;
  if (Array.isArray(descriptors) && descriptors.length > 0) {
    return Math.max(...descriptors.map((descriptor) => Number(descriptor.time_ms) || 0), 1);
  }
  return 1;
}

function ensureGameWaveformController() {
  if (gameWaveformController || !window.SpectralWaveform) {
    return gameWaveformController;
  }

  gameWaveformController = window.SpectralWaveform.createController({
    canvas: '#game-spectral-waveform',
    scrollContainer: '#game-spectral-waveform-scroll',
    overviewCanvas: '#game-spectral-waveform-overview',
    emptyMessage: 'Run Analyze Song in Manage Songs to generate colors.',
    getAnalysis: () => state.chart?.audio_analysis || null,
    getBeatTimesMs: () => state.chart?.audio_analysis?.beat_times_ms || [],
    getDurationMs: resolveWaveformDurationMs,
    getProgressMs: () => resolveCurrentPlaybackMs(state.sessionProgressMs),
    getRmsMax: () => state.spectralRmsMax,
    getZoom: () => state.waveformZoom || 1,
    onScroll: () => {
      scheduleGameBeatGridWindowRender();
    },
    onVisibleWindowChange: (ratios) => {
      state.visibleWaveformWindowRatios = ratios;
      scheduleGameBeatGridWindowRender();
    },
    shouldAutoFollow: () => isSessionPlaying(),
    showTimeAxis: false
  });
  gameWaveformController.attach();
  return gameWaveformController;
}

function getGameWaveformZoom() {
  const durationMs = Math.max(resolveWaveformDurationMs(), 1);
  return Math.max(GAME_WAVEFORM_ZOOM_MIN, durationMs / GAME_WAVEFORM_TARGET_WINDOW_MS);
}

function updateVisibleWaveformWindowRatios(scrollContainer) {
  const controller = ensureGameWaveformController();
  if (!controller) {
    state.visibleWaveformWindowRatios = { start: 0, end: 1 };
    return state.visibleWaveformWindowRatios;
  }
  state.visibleWaveformWindowRatios = controller.updateVisibleWindowRatios(scrollContainer);
  return state.visibleWaveformWindowRatios;
}

function applyGameWaveformZoom(options = {}) {
  const preferExisting = options.preferExisting === true;
  ensureGameWaveformController();
  const spectralWaveform = getElement('game-spectral-waveform');
  const beatGrid = getElement('game-zoom-beat-grid');
  const scrollContainer = getElement('game-spectral-waveform-scroll');
  if (!spectralWaveform) {
    return;
  }
  const computedZoom = getGameWaveformZoom();
  state.waveformZoom = preferExisting
    ? Math.max(state.waveformZoom, computedZoom, GAME_WAVEFORM_ZOOM_MIN)
    : computedZoom;
  localStorage.setItem(
    GAME_WAVEFORM_ZOOM_STORAGE_KEY,
    String(state.waveformZoom.toFixed(6))
  );
  const widthPercent = `${Math.max(state.waveformZoom * 100, 100)}%`;
  spectralWaveform.style.width = widthPercent;
  if (beatGrid) {
    beatGrid.style.width = widthPercent;
  }
  updateVisibleWaveformWindowRatios(scrollContainer);
  scheduleGameBeatGridWindowRender();
  scheduleGameSpectralWaveformRender();
}

function getSortedBeatTimesMs() {
  const beatTimes = state.chart?.audio_analysis?.beat_times_ms;
  if (!Array.isArray(beatTimes) || beatTimes.length === 0) {
    return [];
  }
  const sanitized = beatTimes
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const unique = [];
  for (let i = 0; i < sanitized.length; i += 1) {
    if (i === 0 || Math.abs(sanitized[i] - sanitized[i - 1]) > 1) {
      unique.push(sanitized[i]);
    }
  }
  return unique;
}

function buildGameBeatSlots() {
  const beatTimes = getSortedBeatTimesMs();
  if (beatTimes.length === 0) {
    state.gameBeatSlots = [];
    state.gameNoteSlotSets = { left: new Set(), right: new Set() };
    return;
  }

  const slots = [];
  for (let i = 0; i < beatTimes.length; i += 1) {
    const timeMs = beatTimes[i];
    slots.push({ timeMs, isBeatStart: true, beatIndex: i });
    if (i < beatTimes.length - 1) {
      const nextMs = beatTimes[i + 1];
      const midMs = timeMs + ((nextMs - timeMs) * 0.5);
      slots.push({ timeMs: midMs, isBeatStart: false, beatIndex: i });
    }
  }
  slots.sort((a, b) => a.timeMs - b.timeMs);
  const slotTimes = slots.map((slot) => slot.timeMs);
  const slotGaps = [];
  for (let i = 1; i < slotTimes.length; i += 1) {
    const gapMs = slotTimes[i] - slotTimes[i - 1];
    if (gapMs > 0) {
      slotGaps.push(gapMs);
    }
  }
  const baseGapMs = slotGaps.length > 0
    ? slotGaps.sort((a, b) => a - b)[Math.floor(slotGaps.length / 2)]
    : Math.max(resolveWaveformDurationMs() / Math.max(slots.length, 1), 1);
  state.gameBeatSlots = slots;
  state.gameBeatSlotTimesMs = slotTimes;
  state.gameBeatSlotBaseGapMs = Math.max(baseGapMs, 1);
  state.gameNoteSlotSets = {
    left: mapNotesToBeatSlotIndexes(state.chart?.left || []),
    right: mapNotesToBeatSlotIndexes(state.chart?.right || [])
  };
  lastRenderedGameBeatGridRange = { startIndex: -1, endIndex: -1 };
}

function lowerBoundGameBeatSlotIndex(targetMs) {
  if (!state.gameBeatSlotTimesMs.length) {
    return 0;
  }
  let low = 0;
  let high = state.gameBeatSlotTimesMs.length - 1;
  let answer = state.gameBeatSlotTimesMs.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if ((state.gameBeatSlotTimesMs[mid] || 0) >= targetMs) {
      answer = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return answer;
}

function upperBoundGameBeatSlotIndex(targetMs) {
  if (!state.gameBeatSlotTimesMs.length) {
    return 0;
  }
  let low = 0;
  let high = state.gameBeatSlotTimesMs.length - 1;
  let answer = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if ((state.gameBeatSlotTimesMs[mid] || 0) <= targetMs) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return answer;
}

function findNearestGameBeatSlotIndex(targetMs) {
  if (!state.gameBeatSlots.length) {
    return -1;
  }
  const rightIndex = lowerBoundGameBeatSlotIndex(targetMs);
  if (rightIndex <= 0) {
    return 0;
  }
  if (rightIndex >= state.gameBeatSlots.length) {
    return state.gameBeatSlots.length - 1;
  }
  const leftIndex = rightIndex - 1;
  const leftDistance = Math.abs((state.gameBeatSlots[leftIndex]?.timeMs || 0) - targetMs);
  const rightDistance = Math.abs((state.gameBeatSlots[rightIndex]?.timeMs || 0) - targetMs);
  return leftDistance <= rightDistance ? leftIndex : rightIndex;
}

function mapNotesToBeatSlotIndexes(noteTimesMs) {
  const mapped = new Set();
  if (!Array.isArray(noteTimesMs) || !state.gameBeatSlots.length) {
    return mapped;
  }

  for (const noteTime of noteTimesMs) {
    const targetMs = Number(noteTime);
    if (!Number.isFinite(targetMs)) {
      continue;
    }
    const slotIndex = findNearestGameBeatSlotIndex(targetMs);
    if (slotIndex < 0) {
      continue;
    }
    const slotTimeMs = state.gameBeatSlots[slotIndex]?.timeMs || 0;
    const prevTime = state.gameBeatSlots[slotIndex - 1]?.timeMs ?? slotTimeMs;
    const nextTime = state.gameBeatSlots[slotIndex + 1]?.timeMs ?? slotTimeMs;
    const localGapMs = Math.max(
      Math.min(Math.abs(slotTimeMs - prevTime), Math.abs(nextTime - slotTimeMs)),
      1
    );
    const snapThresholdMs = Math.min(GAME_NOTE_SNAP_MAX_MS, localGapMs * 0.48);
    if (Math.abs(slotTimeMs - targetMs) <= snapThresholdMs) {
      mapped.add(slotIndex);
    }
  }

  return mapped;
}

function renderGameBeatGrid() {
  const beatGrid = getElement('game-zoom-beat-grid');
  if (!beatGrid) {
    return;
  }

  beatGrid.innerHTML = '';
  beatGrid.style.gridTemplateColumns = '1fr';
  if (!state.gameBeatSlots.length) {
    beatGrid.innerHTML = '<p class="beat-grid-empty">Beat grid will appear after a song loads.</p>';
    lastRenderedGameBeatGridRange = { startIndex: -1, endIndex: -1 };
    return;
  }

  const durationMs = Math.max(resolveWaveformDurationMs(), 1);
  const visibleWindow = state.visibleWaveformWindowRatios;
  const visibleStartMs = Math.max(0, visibleWindow.start * durationMs);
  const visibleEndMs = Math.max(visibleStartMs, visibleWindow.end * durationMs);
  const baseGapMs = Math.max(state.gameBeatSlotBaseGapMs || 1, 1);
  const overscanMs = baseGapMs * GAME_BEAT_GRID_OVERSCAN_SLOTS;
  const startIndex = lowerBoundGameBeatSlotIndex(Math.max(0, visibleStartMs - overscanMs));
  const endIndex = upperBoundGameBeatSlotIndex(Math.min(durationMs, visibleEndMs + overscanMs));
  const clampedStart = Math.max(0, Math.min(startIndex, state.gameBeatSlots.length - 1));
  const clampedEnd = Math.max(clampedStart, Math.min(endIndex, state.gameBeatSlots.length - 1));
  const firstMs = state.gameBeatSlots[clampedStart]?.timeMs || 0;
  const contentWidthPx = Math.max(
    getElement('game-spectral-waveform')?.clientWidth || beatGrid.clientWidth || 0,
    1
  );
  const pxPerMs = contentWidthPx / durationMs;
  const leadWidthPx = Math.max(firstMs * pxPerMs, 0);
  const trackParts = [];
  if (leadWidthPx > 0.0001) {
    trackParts.push(`${leadWidthPx}px`);
  }
  for (let i = clampedStart; i <= clampedEnd; i += 1) {
    const currentMs = state.gameBeatSlots[i].timeMs;
    const nextMs = state.gameBeatSlots[i + 1]?.timeMs ?? durationMs;
    const spanWidthPx = Math.max((nextMs - currentMs) * pxPerMs, 1);
    trackParts.push(`${spanWidthPx}px`);
  }
  const tailStartMs = state.gameBeatSlots[clampedEnd + 1]?.timeMs ?? durationMs;
  const tailWidthPx = Math.max((durationMs - tailStartMs) * pxPerMs, 0);
  if (tailWidthPx > 0.0001) {
    trackParts.push(`${tailWidthPx}px`);
  }
  beatGrid.style.gridTemplateColumns = trackParts.join(' ');

  const fragment = document.createDocumentFragment();
  if (leadWidthPx > 0.0001) {
    const leadSpacer = document.createElement('div');
    leadSpacer.className = 'beat-grid-spacer';
    leadSpacer.setAttribute('aria-hidden', 'true');
    fragment.appendChild(leadSpacer);
  }

  for (let index = clampedStart; index <= clampedEnd; index += 1) {
    const slot = state.gameBeatSlots[index];
    const column = document.createElement('div');
    column.className = slot.isBeatStart ? 'beat-column beat-start' : 'beat-column';
    if (slot.isBeatStart && ((slot.beatIndex % 4) + 4) % 4 === 0) {
      column.classList.add('bar');
    }

    const leftCell = document.createElement('div');
    leftCell.className = 'beat-cell beat-cell-readonly';
    leftCell.dataset.lane = 'left';
    leftCell.setAttribute('aria-disabled', 'true');
    leftCell.textContent = 'L';
    if (state.gameNoteSlotSets.left.has(index)) {
      leftCell.classList.add('active');
    }

    const rightCell = document.createElement('div');
    rightCell.className = 'beat-cell beat-cell-readonly';
    rightCell.dataset.lane = 'right';
    rightCell.setAttribute('aria-disabled', 'true');
    rightCell.textContent = 'R';
    if (state.gameNoteSlotSets.right.has(index)) {
      rightCell.classList.add('active');
    }

    column.appendChild(leftCell);
    column.appendChild(rightCell);
    fragment.appendChild(column);
  }

  if (tailWidthPx > 0.0001) {
    const tailSpacer = document.createElement('div');
    tailSpacer.className = 'beat-grid-spacer';
    tailSpacer.setAttribute('aria-hidden', 'true');
    fragment.appendChild(tailSpacer);
  }
  beatGrid.appendChild(fragment);
  lastRenderedGameBeatGridRange = { startIndex: clampedStart, endIndex: clampedEnd };
}

function scheduleGameBeatGridWindowRender() {
  if (!state.gameBeatSlots.length) {
    return;
  }
  if (gameBeatGridWindowRenderRafId) {
    return;
  }
  gameBeatGridWindowRenderRafId = window.requestAnimationFrame(() => {
    gameBeatGridWindowRenderRafId = 0;
    const durationMs = Math.max(resolveWaveformDurationMs(), 1);
    const visibleWindow = state.visibleWaveformWindowRatios;
    const visibleStartMs = Math.max(0, visibleWindow.start * durationMs);
    const visibleEndMs = Math.max(visibleStartMs, visibleWindow.end * durationMs);
    const baseGapMs = Math.max(state.gameBeatSlotBaseGapMs || 1, 1);
    const overscanMs = baseGapMs * GAME_BEAT_GRID_OVERSCAN_SLOTS;
    const startIndex = lowerBoundGameBeatSlotIndex(Math.max(0, visibleStartMs - overscanMs));
    const endIndex = upperBoundGameBeatSlotIndex(Math.min(durationMs, visibleEndMs + overscanMs));
    const clampedStart = Math.max(0, Math.min(startIndex, state.gameBeatSlots.length - 1));
    const clampedEnd = Math.max(clampedStart, Math.min(endIndex, state.gameBeatSlots.length - 1));
    if (
      lastRenderedGameBeatGridRange.startIndex === clampedStart
      && lastRenderedGameBeatGridRange.endIndex === clampedEnd
    ) {
      return;
    }
    renderGameBeatGrid();
  });
}

function renderGameSpectralWaveform(progressMs = state.sessionProgressMs) {
  ensureGameWaveformController()?.renderMain(resolveCurrentPlaybackMs(progressMs));
}

function refreshGameTimingLayout() {
  applyGameWaveformZoom({ preferExisting: true });
  renderGameBeatGrid();
  scheduleGameBeatGridWindowRender();
}

function scheduleGameSpectralWaveformRender(progressMs = state.sessionProgressMs) {
  pendingGameWaveformProgressMs = progressMs;
  if (shouldAnimateGamePlayback()) {
    ensureGamePlaybackRenderLoop();
    return;
  }
  if (gameWaveformRenderRafId) {
    return;
  }
  gameWaveformRenderRafId = window.requestAnimationFrame(() => {
    gameWaveformRenderRafId = 0;
    renderGameSpectralWaveform(pendingGameWaveformProgressMs);
  });
}

function renderGameUi(progressMs = state.sessionProgressMs) {
  const playbackMs = resolveCurrentPlaybackMs(progressMs);
  renderGameMeta(playbackMs);
  renderVisualizer(playbackMs);
  renderTimingSummary(playbackMs);
}

function scheduleGameUiRender(progressMs = state.sessionProgressMs) {
  pendingGameUiProgressMs = progressMs;
  if (shouldAnimateGamePlayback()) {
    ensureGamePlaybackRenderLoop();
    return;
  }
  if (gameUiRenderRafId) {
    return;
  }
  gameUiRenderRafId = window.requestAnimationFrame(() => {
    gameUiRenderRafId = 0;
    renderGameUi(pendingGameUiProgressMs);
  });
}

function shouldAnimateGamePlayback() {
  const audio = ensureAudioElement();
  return isSessionPlaying() || Boolean(audio && !audio.paused && !audio.ended);
}

function ensureGamePlaybackRenderLoop() {
  if (gamePlaybackRenderRafId || !shouldAnimateGamePlayback()) {
    return;
  }
  const renderFrame = () => {
    gamePlaybackRenderRafId = 0;
    const playbackMs = resolveCurrentPlaybackMs();
    renderGameUi(playbackMs);
    renderGameSpectralWaveform(playbackMs);
    if (shouldAnimateGamePlayback()) {
      gamePlaybackRenderRafId = window.requestAnimationFrame(renderFrame);
    }
  };
  gamePlaybackRenderRafId = window.requestAnimationFrame(renderFrame);
}

function stopGamePlaybackRenderLoop() {
  if (!gamePlaybackRenderRafId) {
    return;
  }
  window.cancelAnimationFrame(gamePlaybackRenderRafId);
  gamePlaybackRenderRafId = 0;
}

function invalidateLedBeatFeedbackCache() {
  ledBeatFeedbackSignature = '';
  ledBeatFeedbackMarkerRefs = { left: [], right: [] };
}

function pushTimelineEntry(timeline, lane, entry) {
  const bucket = timeline[lane];
  bucket.unshift(entry);
  if (bucket.length > MAX_TIMELINE_ENTRIES) {
    bucket.length = MAX_TIMELINE_ENTRIES;
  }
}

function upsertTriggerTimelineEntry(lane, entry) {
  const bucket = state.triggerTimeline[lane];
  const existingIndex = bucket.findIndex(
    (timelineEntry) => timelineEntry.hitTimeMs === entry.hitTimeMs
  );
  if (existingIndex >= 0) {
    bucket[existingIndex] = entry;
    return;
  }
  pushTimelineEntry(state.triggerTimeline, lane, entry);
}

let audioElement = null;

let socket = null;

function buildSessionStreamUrl(sessionId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/session/${encodeURIComponent(sessionId)}`;
}

function clampLevel(value) {
  return Math.max(0, Math.min(1, value));
}

function getCurrentPlaybackProgressMs() {
  const audio = ensureAudioElement();
  if (Number.isFinite(audio.currentTime) && audio.currentTime > 0) {
    return Math.round(audio.currentTime * 1000);
  }
  return Math.max(state.sessionProgressMs || 0, 0);
}

function getLaneHitNotes(lane) {
  return Array.isArray(state.chart?.[lane]) ? state.chart[lane] : [];
}

function judgePressTiming(lane) {
  const notes = getLaneHitNotes(lane);
  const windows = state.chart?.judgement_windows_ms || { perfect: 0, good: 0 };
  const pressMs = getCurrentPlaybackProgressMs();
  let closestDeltaMs = null;
  let closestNoteTimeMs = null;

  for (const noteTimeMs of notes) {
    const deltaMs = pressMs - Number(noteTimeMs || 0);
    if (closestDeltaMs === null || Math.abs(deltaMs) < Math.abs(closestDeltaMs)) {
      closestDeltaMs = deltaMs;
      closestNoteTimeMs = Number(noteTimeMs || 0);
    }
  }

  if (closestDeltaMs === null) {
    return {
      deltaMs: null,
      judgement: 'off',
      pressMs,
      noteTimeMs: null,
      triggerHit: false
    };
  }

  const absoluteDeltaMs = Math.abs(closestDeltaMs);
  if (absoluteDeltaMs <= windows.perfect) {
    return {
      deltaMs: closestDeltaMs,
      judgement: 'perfect',
      pressMs,
      noteTimeMs: closestNoteTimeMs,
      triggerHit: true
    };
  }
  if (absoluteDeltaMs <= windows.good) {
    return {
      deltaMs: closestDeltaMs,
      judgement: 'good',
      pressMs,
      noteTimeMs: closestNoteTimeMs,
      triggerHit: true
    };
  }
  return {
    deltaMs: closestDeltaMs,
    judgement: 'off',
    pressMs,
    noteTimeMs: closestNoteTimeMs,
    triggerHit: false
  };
}

function getNoteResultKey(noteTimeMs) {
  return String(Math.round(Number(noteTimeMs) || 0));
}

function recordLaneNoteResult(lane, noteTimeMs, judgement) {
  if (!lane || !Number.isFinite(noteTimeMs) || !state.noteHitResults[lane]) {
    return;
  }
  const resultKey = getNoteResultKey(noteTimeMs);
  if (state.noteHitResults[lane].has(resultKey)) {
    return;
  }
  state.noteHitResults[lane].set(resultKey, judgement);
}

function getLaneNoteResult(lane, noteTimeMs, playbackMs) {
  const resultKey = getNoteResultKey(noteTimeMs);
  const stored = state.noteHitResults[lane]?.get(resultKey);
  if (stored) {
    return stored;
  }

  const missWindowMs = Number(state.chart?.judgement_windows_ms?.good) || 0;
  if (playbackMs > (Number(noteTimeMs) || 0) + missWindowMs) {
    return 'miss';
  }

  return 'pending';
}

function ensureLedBeatFeedbackMarkers(container, rows, durationMs) {
  const signature = JSON.stringify({
    durationMs: Math.round(durationMs),
    rows: rows.map(({ lane, notes }) => ({
      lane,
      notes: notes.map((noteTimeMs) => Math.round(Number(noteTimeMs) || 0)),
    })),
  });
  if (ledBeatFeedbackSignature === signature) {
    return;
  }

  container.innerHTML = '';
  ledBeatFeedbackMarkerRefs = { left: [], right: [] };
  const fragment = document.createDocumentFragment();

  for (const { lane, label, notes } of rows) {
    const row = document.createElement('div');
    row.className = 'led-beat-feedback-row';
    row.dataset.lane = lane;

    const rowLabel = document.createElement('span');
    rowLabel.className = 'led-beat-feedback-label';
    rowLabel.textContent = label;
    row.appendChild(rowLabel);

    const track = document.createElement('div');
    track.className = 'led-beat-feedback-track';
    row.appendChild(track);

    for (const noteTimeMs of notes) {
      const marker = document.createElement('span');
      const leftPercent = Math.max(
        0,
        Math.min(((Number(noteTimeMs) || 0) / durationMs) * 100, 100)
      );
      marker.className = 'led-beat-feedback-marker pending';
      marker.style.left = `${leftPercent.toFixed(3)}%`;
      track.appendChild(marker);
      ledBeatFeedbackMarkerRefs[lane].push({
        element: marker,
        noteTimeMs: Number(noteTimeMs) || 0,
      });
    }

    fragment.appendChild(row);
  }

  container.appendChild(fragment);
  ledBeatFeedbackSignature = signature;
}

function renderLedBeatFeedback(playbackMs = resolveCurrentPlaybackMs()) {
  const container = document.getElementById('led-beat-feedback');
  if (!container) {
    return;
  }

  const leftNotes = getLaneHitNotes('left');
  const rightNotes = getLaneHitNotes('right');
  if (!leftNotes.length && !rightNotes.length) {
    invalidateLedBeatFeedbackCache();
    container.innerHTML = '<div class="led-beat-feedback-empty">Beat feedback appears after a chart loads.</div>';
    return;
  }

  const durationMs = Math.max(resolveWaveformDurationMs(), 1);
  const rows = [
    { lane: 'left', label: 'L', notes: leftNotes },
    { lane: 'right', label: 'R', notes: rightNotes },
  ];
  ensureLedBeatFeedbackMarkers(container, rows, durationMs);

  for (const { lane } of rows) {
    for (const markerRef of ledBeatFeedbackMarkerRefs[lane]) {
      const { element, noteTimeMs } = markerRef;
      const result = getLaneNoteResult(lane, noteTimeMs, playbackMs);
      element.className = `led-beat-feedback-marker ${result}`;
      element.title = `${lane} @ ${formatMs(noteTimeMs)}: ${result}`;
    }
  }
}

function renderVisualizer(playbackMs = resolveCurrentPlaybackMs()) {
  const canvas = document.getElementById('visualizer');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const width = Math.max(canvas.clientWidth || canvas.width || 0, 1);
  const height = Math.max(canvas.clientHeight || canvas.height || 0, 1);
  if (canvas.width !== width) {
    canvas.width = width;
  }
  if (canvas.height !== height) {
    canvas.height = height;
  }

  ctx.clearRect(0, 0, width, height);

  const numLeds = 70;
  const ledWidth = (width - 20) / numLeds;
  const ledHeight = 12;
  const ledY = (height - ledHeight) / 2;
  ctx.drawImage(getVisualizerBackgroundCanvas(width, height, numLeds, ledWidth, ledY, ledHeight), 0, 0);
  renderLedPixels(ctx, ledY, ledHeight, numLeds, ledWidth);
  renderActiveBarFeedback(ctx, playbackMs, ledY, ledHeight, numLeds, ledWidth);
  renderLedBeatFeedback(playbackMs);
}

function renderLedPixels(ctx, ledY, ledHeight, numLeds, ledWidth) {
  if (!Array.isArray(state.ledPixels) || state.ledPixels.length === 0) {
    return;
  }

  for (let index = 0; index < Math.min(state.ledPixels.length, numLeds); index += 1) {
    const pixel = state.ledPixels[index];
    if (!Array.isArray(pixel) || pixel.length !== 3) {
      continue;
    }
    const [red, green, blue] = pixel.map((value) => Math.max(0, Math.min(255, Number(value) || 0)));
    if (red === 0 && green === 0 && blue === 0) {
      continue;
    }
    ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
    ctx.fillRect(10 + index * ledWidth, ledY, ledWidth - 2, ledHeight);
  }
}

function getActiveBarFlashAlpha(result, hitTimeMs, playbackMs) {
  if (result === 'pending') {
    return 0;
  }

  const elapsedSinceHitMs = playbackMs - hitTimeMs;
  if (elapsedSinceHitMs < 0 || elapsedSinceHitMs > ACTIVE_BAR_FLASH_WINDOW_MS) {
    return 0;
  }

  const decay = 1 - (elapsedSinceHitMs / ACTIVE_BAR_FLASH_WINDOW_MS);
  const pulse = 0.7 + (0.3 * Math.sin((elapsedSinceHitMs / 28) * Math.PI));
  return Math.max(0.25, Math.min(decay * pulse, 1));
}

function getActiveBarColor(result, lane) {
  return ACTIVE_BAR_COLORS[result] || ACTIVE_BAR_COLORS[lane] || ACTIVE_BAR_COLORS.fallback || '#f8fafc';
}

function getActiveBarRange(bar, playbackMs, numLeds) {
  const lane = bar?.lane;
  const hitTimeMs = Math.max(Number(bar?.hit_time_ms) || 0, 0);
  const travelTimeMs = Math.max(Number(bar?.travel_time_ms) || 0, 1);
  const fallbackProgressMs = Math.min(
    Math.max(Number(bar?.progress_ms) || 0, 0),
    travelTimeMs
  );
  const alignedProgressMs = window.VisualizerProjection?.getPlaybackAlignedBarProgressMs
    ? window.VisualizerProjection.getPlaybackAlignedBarProgressMs(
      hitTimeMs,
      travelTimeMs,
      playbackMs,
      fallbackProgressMs
    )
    : fallbackProgressMs;
  const clampedProgressMs = Math.min(alignedProgressMs, travelTimeMs - Number.EPSILON);
  const progress = Math.max(clampedProgressMs / travelTimeMs, 0);

  if (window.VisualizerProjection?.getRenderedBarRange) {
    return window.VisualizerProjection.getRenderedBarRange(
      numLeds,
      progress,
      lane,
      ACTIVE_BAR_SPAN
    );
  }

  return null;
}

function renderActiveBarFeedback(ctx, playbackMs, ledY, ledHeight, numLeds, ledWidth) {
  for (const bar of Object.values(state.activeBars)) {
    const lane = String(bar?.lane || '');
    if (lane !== 'left' && lane !== 'right') {
      continue;
    }
    const hitTimeMs = Math.max(Number(bar?.hit_time_ms) || 0, 0);
    const result = getLaneNoteResult(lane, hitTimeMs, playbackMs);
    const alpha = getActiveBarFlashAlpha(result, hitTimeMs, playbackMs);
    if (alpha <= 0) {
      continue;
    }

    const range = getActiveBarRange(bar, playbackMs, numLeds);
    if (!range) {
      continue;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = getActiveBarColor(result, lane);
    for (let index = range.startIndex; index <= range.endIndex; index += 1) {
      ctx.fillRect(10 + index * ledWidth, ledY, ledWidth - 2, ledHeight);
    }
    ctx.restore();
  }
}

function getVisualizerBackgroundCanvas(width, height, numLeds, ledWidth, ledY, ledHeight) {
  if (
    visualizerBackgroundCanvas
    && visualizerBackgroundCacheWidth === width
    && visualizerBackgroundCacheHeight === height
  ) {
    return visualizerBackgroundCanvas;
  }

  visualizerBackgroundCanvas = document.createElement('canvas');
  visualizerBackgroundCanvas.width = width;
  visualizerBackgroundCanvas.height = height;
  visualizerBackgroundCacheWidth = width;
  visualizerBackgroundCacheHeight = height;

  const backgroundCtx = visualizerBackgroundCanvas.getContext('2d');
  backgroundCtx.clearRect(0, 0, width, height);

  for (let i = 0; i < numLeds; i += 1) {
    backgroundCtx.fillStyle = i < numLeds / 2
      ? (theme.colors?.ledTrack?.left || 'rgba(59, 130, 246, 0.12)')
      : (theme.colors?.ledTrack?.right || 'rgba(236, 72, 153, 0.12)');
    backgroundCtx.fillRect(10 + i * ledWidth, ledY, ledWidth - 2, ledHeight);
  }

  return visualizerBackgroundCanvas;
}

function renderTimelineList(containerId, entries, formatter) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (entries.length === 0) {
    container.innerHTML = '<div class="timeline-empty">Waiting for events...</div>';
    return;
  }

  container.innerHTML = entries
    .map((entry) => `<div class="timeline-entry">${formatter(entry)}</div>`)
    .join('');
}

function formatDeltaMs(deltaMs) {
  if (!Number.isFinite(deltaMs)) {
    return 'no chart hit';
  }
  const roundedMs = Math.round(deltaMs);
  if (roundedMs === 0) {
    return 'on time';
  }
  return roundedMs > 0 ? `${formatMs(roundedMs)} late` : `${formatMs(Math.abs(roundedMs))} early`;
}

function renderLaneLogEntry(entry) {
  if (entry.kind === 'trigger') {
    return [
      '<span class="timeline-badge trigger">Trigger</span>',
      `<span class="timeline-main">@${formatMs(entry.hitTimeMs)}</span>`,
      `<span class="timeline-meta">${formatMs(entry.remainingMs)} left</span>`
    ].join('');
  }

  return [
    '<span class="timeline-badge press">Press</span>',
    `<span class="timeline-badge ${entry.judgement}">${entry.judgement}</span>`,
    `<span class="timeline-main">@${entry.label}</span>`,
    `<span class="timeline-meta">${entry.triggerHit ? 'hit' : 'miss'} · ${formatDeltaMs(entry.deltaMs)}</span>`
  ].join('');
}

function renderLaneLog(containerId, lane) {
  const entries = [
    ...state.triggerTimeline[lane].map((entry) => ({
      ...entry,
      kind: 'trigger',
      sortTimeMs: entry.hitTimeMs
    })),
    ...state.pressTimeline[lane].map((entry) => ({
      ...entry,
      kind: 'press',
      sortTimeMs: entry.pressMs ?? 0
    }))
  ]
    .sort((leftEntry, rightEntry) => rightEntry.sortTimeMs - leftEntry.sortTimeMs)
    .slice(0, MAX_TIMELINE_ENTRIES);

  renderTimelineList(containerId, entries, renderLaneLogEntry);
}

function resolveCurrentPlaybackMs(fallbackMs = state.sessionProgressMs) {
  const audio = ensureAudioElement();
  const audioMs = audio ? audio.currentTime * 1000 : Number.NaN;
  if (Number.isFinite(audioMs) && audioMs >= 0) {
    return audioMs;
  }
  return Math.max(Number(fallbackMs) || 0, 0);
}

function renderGameMeta(playbackMs = resolveCurrentPlaybackMs()) {
  const currentTimeEl = document.getElementById('game-current-time');
  if (currentTimeEl) {
    currentTimeEl.textContent = formatPlaybackTime(playbackMs);
  }

  const trackLengthEl = document.getElementById('game-track-length');
  if (trackLengthEl) {
    trackLengthEl.textContent = formatPlaybackTime(resolveWaveformDurationMs());
  }

}

function renderTimingSummary(playbackMs = resolveCurrentPlaybackMs()) {
  const perfectEl = document.getElementById('game-perfect-window');
  const goodEl = document.getElementById('game-good-window');
  if (state.chart?.judgement_windows_ms) {
    const windows = state.chart.judgement_windows_ms;
    if (perfectEl) {
      perfectEl.textContent = `Perfect ±${formatMs(windows.perfect)}`;
    }
    if (goodEl) {
      goodEl.textContent = `Good ±${formatMs(windows.good)}`;
    }
  } else {
    if (perfectEl) {
      perfectEl.textContent = 'Perfect ±0.00s';
    }
    if (goodEl) {
      goodEl.textContent = 'Good ±0.00s';
    }
  }

  renderLaneLog('left-lane-log', 'left');
  renderLaneLog('right-lane-log', 'right');
  renderLedBeatFeedback(playbackMs);
}

function handleBarFrame(payload) {
  const key = `${payload.lane}-${payload.hit_time_ms}`;
  const travelMs = Math.max(Number(payload.travel_time_ms) || 0, 1);
  const progressMs = Math.min(Math.max(Number(payload.progress_ms) || 0, 0), travelMs);
  state.activeBars[key] = {
    ...payload,
    progress_ms: progressMs,
    received_at_ms: performance.now(),
  };

  if (progressMs >= travelMs) {
    window.setTimeout(() => {
      if (state.activeBars[key]?.hit_time_ms === payload.hit_time_ms) {
        delete state.activeBars[key];
        scheduleGameUiRender();
      }
    }, 250);
  }

  upsertTriggerTimelineEntry(payload.lane, {
    hitTimeMs: payload.hit_time_ms,
    progressMs: payload.progress_ms,
    remainingMs: payload.remaining_ms,
  });

  state.remainingMs = Math.max(payload.remaining_ms, 0);
  scheduleGameUiRender();
}

function recordButtonPress(lane) {
  const judgementResult = judgePressTiming(lane);
  const entry = {
    label: formatMs(judgementResult.pressMs),
    pressMs: judgementResult.pressMs,
    source: 'keyboard',
    deltaMs: judgementResult.deltaMs,
    judgement: judgementResult.judgement,
    triggerHit: judgementResult.triggerHit,
  };
  pushTimelineEntry(state.pressTimeline, lane, entry);
  if (judgementResult.triggerHit && Number.isFinite(judgementResult.noteTimeMs)) {
    recordLaneNoteResult(lane, judgementResult.noteTimeMs, judgementResult.judgement);
  }
  scheduleGameUiRender();
}

function resetSessionState() {
  stopAudioPlayback();
  state.activeBars = {};
  state.ledPixels = [];
  state.pendingStartSongId = null;
  state.noteHitResults = createLaneNoteResults();
  state.triggerTimeline.left = [];
  state.triggerTimeline.right = [];
  state.pressTimeline.left = [];
  state.pressTimeline.right = [];
  state.remainingMs = 0;
  state.sessionProgressMs = 0;
  state.sessionStartMs = null;
  stopGamePlaybackRenderLoop();
  if (gameWaveformRenderRafId) {
    window.cancelAnimationFrame(gameWaveformRenderRafId);
    gameWaveformRenderRafId = 0;
  }
  if (gameUiRenderRafId) {
    window.cancelAnimationFrame(gameUiRenderRafId);
    gameUiRenderRafId = 0;
  }
  invalidateLedBeatFeedbackCache();
  renderGameUi(0);
  renderGameSpectralWaveform(0);
}

function updateUI() {
  const select = getElement('song-select');
  if (select.options.length <= 1 && state.songs.length > 0) {
    populateSelectOptions(select, state.songs, {
      placeholder: 'Select a song',
      emptyLabel: 'No songs available',
    });
    if (!select.value && state.songs.length > 0) {
      select.value = state.songs[0];
    }
  }
  if (select.value) {
    state.songId = select.value;
  }
  updateControlStates();
}

function connectWebSocket() {
  if (socket) socket.close();

  socket = new WebSocket(buildSessionStreamUrl(DEFAULT_SESSION_ID));

  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'session_state') {
        state.runStatus = payload.state;
        if (typeof payload.progress_ms === 'number') {
          state.sessionProgressMs = payload.progress_ms;
        }
        if (isSessionPlaying()) {
          ensureGamePlaybackRenderLoop();
        } else {
          stopGamePlaybackRenderLoop();
        }
        updateUI();
        scheduleGameSpectralWaveformRender();
        scheduleGameUiRender();
        return;
      }

      if (payload.type === 'led_frame' && Array.isArray(payload.levels)) {
        state.levels = payload.levels.map(clampLevel);
        if (Array.isArray(payload.pixels)) {
          state.ledPixels = payload.pixels;
        }
        if (typeof payload.progress_ms === 'number') {
          state.sessionProgressMs = payload.progress_ms;
          if (state.chartDurationMs > 0) {
            state.remainingMs = Math.max(
              state.chartDurationMs - payload.progress_ms,
              0
            );
          }
        }
        if (state.pendingStartSongId && isSessionPlaying()) {
          void startPendingAudioPlayback(state.sessionProgressMs);
        }
        scheduleGameSpectralWaveformRender(state.sessionProgressMs);
        scheduleGameUiRender(state.sessionProgressMs);
        return;
      }

      if (payload.type === 'bar_frame') {
        handleBarFrame(payload);
        return;
      }

    } catch (e) {
      console.error('WS Error:', e);
    }
  };

  socket.onopen = () => {
    state.runStatus = 'Connected';
    updateUI();
  };

  socket.onclose = () => {
    state.runStatus = 'Disconnected. Reconnecting...';
    updateUI();
    setTimeout(connectWebSocket, 2000);
  };
}

async function fetchSongs() {
  try {
    state.songs = await requestJson(`${apiBaseUrl}/songs`, {}, 'Failed to load songs');
    updateUI();
    const select = getElement('song-select');
    if (select?.value) {
      state.songId = select.value;
      await loadChart(select.value);
    }
  } catch (e) {
    console.error('Failed to fetch songs:', e);
  }
}

async function loadChart(songId) {
  if (!songId) return;
  if (state.chart?.song_id === songId) return;

  try {
    const chartData = await requestJson(
      `${apiBaseUrl}/charts/${encodeURIComponent(songId)}`
      ,
      {},
      'Failed to load chart'
    );
    state.chart = chartData;
    state.noteHitResults = createLaneNoteResults();
    invalidateLedBeatFeedbackCache();
    ensureGameWaveformController()?.invalidateOverviewCache();
    state.chartDurationMs = computeTrackDuration(chartData);
    const descriptors = chartData?.audio_analysis?.beat_descriptors;
    if (Array.isArray(descriptors) && descriptors.length > 0) {
      state.spectralRmsMax = Math.max(
        ...descriptors.map((descriptor) => Number(descriptor.rms) || 0),
        MIN_SPECTRAL_RMS
      );
    } else {
      state.spectralRmsMax = 1;
    }
    buildGameBeatSlots();
    applyGameWaveformZoom({ preferExisting: true });
    ensureGameWaveformController()?.setVisibleWindowStart(0);
    renderGameBeatGrid();
    state.remainingMs = state.chartDurationMs;
    loadGameWaveform(songId);
    scheduleGameSpectralWaveformRender(0);
    scheduleGameUiRender(0);
  } catch (error) {
    console.error('Failed to load chart:', error);
  }
}

function handleKeydown(event) {
  if (event.repeat) return;
  const action = KEY_MAPPING[event.key] || KEY_MAPPING[event.code];
  if (!action) return;

  event.preventDefault();

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'lane_event',
      lane: action,
      source: 'keyboard'
    }));
    recordButtonPress(action);
  }
  
  updateUI();
}

function ensureAudioElement() {
  if (audioElement) return audioElement;
  audioElement = document.getElementById('song-audio');
  if (!audioElement) {
    audioElement = document.createElement('audio');
    audioElement.id = 'song-audio';
    audioElement.hidden = true;
    audioElement.preload = 'auto';
    document.body.appendChild(audioElement);
  }
  return audioElement;
}

async function startAudioPlayback(songId, startMs = 0) {
  const audio = ensureAudioElement();
  audio.pause();
  const nextSrc = `${apiBaseUrl}/songs/${encodeURIComponent(songId)}/audio`;
  if (audio.src !== new URL(nextSrc, window.location.href).href) {
    audio.src = nextSrc;
    audio.load();
  }
  audio.currentTime = Math.max(startMs, 0) / 1000;
  audio.muted = true;
  await audio.play();
}

async function startPendingAudioPlayback(progressMs = 0) {
  if (!state.pendingStartSongId) return;

  const songId = state.pendingStartSongId;
  state.pendingStartSongId = null;

  try {
    await startAudioPlayback(songId, progressMs);
  } catch (error) {
    console.error('Playback failed', error);
    state.runStatus = 'Playback blocked';
    updateUI();
  }
}

function init() {
  const startButton = getElement('btn-start');
  if (startButton) {
    startButton.addEventListener('click', async () => {
      if (isSessionPlaying()) {
        requestPauseSession();
        return;
      }

      if (isSessionPaused()) {
        await requestResumeSession();
        return;
      }

      const songId = getElement('song-select').value;
      if (!songId) return window.alert('Select a song first!');
      
      state.runStatus = 'Buffering';
      updateUI();

      if (socket && socket.readyState === WebSocket.OPEN) {
        resetSessionState();
        if (!state.chart || state.chart.song_id !== songId) {
          await loadChart(songId);
        }
        state.sessionStartMs = Date.now();
        state.sessionProgressMs = 0;
        state.remainingMs = state.chartDurationMs;
        state.pendingStartSongId = songId;
        scheduleGameUiRender(0);

        socket.send(JSON.stringify({
          type: 'start_session',
          song_id: songId
        }));
        state.songId = songId;
        updateUI();
      }
    });
  }

  const stopButton = getElement('btn-stop');
  if (stopButton) {
    stopButton.addEventListener('click', () => {
      if (!isSessionPlaying() && !isSessionPaused()) return;
      requestStopSession(true);
    });
  }

  getElement('song-select').addEventListener('change', async (event) => {
    const songId = event.target.value;
    state.songId = songId;
    await loadChart(songId);
  });

  const audio = ensureAudioElement();
  ['loadedmetadata', 'durationchange'].forEach((eventName) => {
    audio.addEventListener(eventName, () => {
      refreshGameTimingLayout();
      scheduleGameUiRender(resolveCurrentPlaybackMs());
      scheduleGameSpectralWaveformRender(resolveCurrentPlaybackMs());
    });
  });
  ['timeupdate', 'seeked', 'play', 'pause', 'ended'].forEach((eventName) => {
    audio.addEventListener(eventName, () => {
      scheduleGameUiRender(resolveCurrentPlaybackMs());
      scheduleGameSpectralWaveformRender(resolveCurrentPlaybackMs());
      if (shouldAnimateGamePlayback()) {
        ensureGamePlaybackRenderLoop();
      } else {
        stopGamePlaybackRenderLoop();
      }
    });
  });

  renderGameUi(0);
  initGameWaveform();
  ensureGameWaveformController();
  applyGameWaveformZoom({ preferExisting: true });
  renderGameBeatGrid();

  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('resize', () => {
    applyGameWaveformZoom();
    renderGameBeatGrid();
    scheduleGameSpectralWaveformRender();
  });
  
  fetchSongs();
  connectWebSocket();
}

document.addEventListener('DOMContentLoaded', init);
