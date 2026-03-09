const apiBaseUrl = '/api';
const DEFAULT_SESSION_ID = 'default-session';
const CLOCK_DECAY = 0.85;
const DEBUG_STORAGE_KEY = 'rhythmJumpDebugVisible';
const GAME_WAVEFORM_ZOOM_STORAGE_KEY = 'rhythmJumpGameWaveformZoom';
const MAX_TIMELINE_ENTRIES = 12;
const HIT_EFFECT_DURATION_MS = 320;
const MIN_SPECTRAL_RMS = window.SpectralWaveform?.MIN_SPECTRAL_RMS || 0.001;
const GAME_WAVEFORM_ZOOM_MIN = 1;
const GAME_WAVEFORM_TARGET_WINDOW_MS = 12000;
const GAME_NOTE_SNAP_MAX_MS = 180;
const GAME_BEAT_GRID_OVERSCAN_SLOTS = 96;

const KEY_MAPPING = {
  a: 'left',
  ' ': 'left',
  Space: 'left',
  l: 'right',
  Enter: 'right'
};

function loadDebugVisibility() {
  const stored = localStorage.getItem(DEBUG_STORAGE_KEY);
  if (stored === null) {
    return true;
  }
  return stored === 'true';
}

function loadStoredGameWaveformZoom() {
  const stored = Number(localStorage.getItem(GAME_WAVEFORM_ZOOM_STORAGE_KEY));
  if (!Number.isFinite(stored) || stored < GAME_WAVEFORM_ZOOM_MIN) {
    return GAME_WAVEFORM_ZOOM_MIN;
  }
  return stored;
}

let state = {
  songId: '',
  runStatus: 'idle',
  levels: [0, 0],
  songs: [],
  activeBars: {},
  hitEffects: { left: [], right: [] },
  triggerTimeline: { left: [], right: [] },
  pressTimeline: { left: [], right: [] },
  remainingMs: 0,
  sessionProgressMs: 0,
  chart: null,
  chartDurationMs: 0,
  spectralRmsMax: 1,
  debugVisible: loadDebugVisibility(),
  sessionStartMs: null,
  waveformZoom: loadStoredGameWaveformZoom(),
  visibleWaveformWindowRatios: { start: 0, end: 1 },
  gameBeatSlots: [],
  gameBeatSlotTimesMs: [],
  gameBeatSlotBaseGapMs: 1,
  gameNoteSlotSets: { left: new Set(), right: new Set() },
};

let gameWaveSurfer = null;
let visualizerEffectRafId = 0;
let gameWaveformController = null;
let gameWaveformRenderRafId = 0;
let gamePlaybackRenderRafId = 0;
let pendingGameWaveformProgressMs = 0;
let gameBeatGridWindowRenderRafId = 0;
let lastRenderedGameBeatGridRange = { startIndex: -1, endIndex: -1 };
let visualizerBackgroundCanvas = null;
let visualizerBackgroundCacheWidth = 0;
let visualizerBackgroundCacheHeight = 0;

function isSessionPlaying() {
  return state.runStatus === 'playing';
}

function isSessionPaused() {
  return state.runStatus === 'paused';
}

function updateControlStates() {
  const startBtn = document.getElementById('btn-start');
  const stopBtn = document.getElementById('btn-stop');
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
    waveColor: '#4f46e5',
    progressColor: '#3b82f6',
    cursorColor: '#f43f5e',
    barWidth: 2,
    barRadius: 3,
    height: 120,
    responsive: true
  };

  gameWaveSurfer = WaveSurfer.create(config);
  gameWaveSurfer.on('ready', () => {
    applyGameWaveformZoom({ preferExisting: true });
    scheduleGameSpectralWaveformRender();
    renderDebugPanel();
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
  const spectralWaveform = document.getElementById('game-spectral-waveform');
  const beatGrid = document.getElementById('game-zoom-beat-grid');
  const scrollContainer = document.getElementById('game-spectral-waveform-scroll');
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
  const beatGrid = document.getElementById('game-zoom-beat-grid');
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
  const lastMs = state.gameBeatSlots[clampedEnd]?.timeMs || firstMs;
  const leadUnits = Math.max(firstMs / baseGapMs, 0);
  const tailUnits = Math.max((durationMs - lastMs) / baseGapMs, 0);
  const trackParts = [];
  if (leadUnits > 0.0001) {
    trackParts.push(`minmax(0, ${leadUnits}fr)`);
  }
  for (let i = clampedStart; i <= clampedEnd; i += 1) {
    const currentMs = state.gameBeatSlots[i].timeMs;
    const nextMs = state.gameBeatSlots[i + 1]?.timeMs ?? (currentMs + baseGapMs);
    const spanUnits = Math.max((nextMs - currentMs) / Math.max(baseGapMs, 1), 0.2);
    trackParts.push(`minmax(0, ${spanUnits}fr)`);
  }
  if (tailUnits > 0.0001) {
    trackParts.push(`minmax(0, ${tailUnits}fr)`);
  }
  beatGrid.style.gridTemplateColumns = trackParts.join(' ');

  const fragment = document.createDocumentFragment();
  if (leadUnits > 0.0001) {
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

  if (tailUnits > 0.0001) {
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

function scheduleGameSpectralWaveformRender(progressMs = state.sessionProgressMs) {
  pendingGameWaveformProgressMs = progressMs;
  if (gameWaveformRenderRafId) {
    return;
  }
  gameWaveformRenderRafId = window.requestAnimationFrame(() => {
    gameWaveformRenderRafId = 0;
    renderGameSpectralWaveform(pendingGameWaveformProgressMs);
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
    renderGameMeta();
    renderGameSpectralWaveform(resolveCurrentPlaybackMs());
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

  for (const noteTimeMs of notes) {
    const deltaMs = pressMs - Number(noteTimeMs || 0);
    if (closestDeltaMs === null || Math.abs(deltaMs) < Math.abs(closestDeltaMs)) {
      closestDeltaMs = deltaMs;
    }
  }

  if (closestDeltaMs === null) {
    return {
      deltaMs: null,
      judgement: 'off',
      pressMs,
      triggerHit: false
    };
  }

  const absoluteDeltaMs = Math.abs(closestDeltaMs);
  if (absoluteDeltaMs <= windows.perfect) {
    return { deltaMs: closestDeltaMs, judgement: 'perfect', pressMs, triggerHit: true };
  }
  if (absoluteDeltaMs <= windows.good) {
    return { deltaMs: closestDeltaMs, judgement: 'good', pressMs, triggerHit: true };
  }
  return { deltaMs: closestDeltaMs, judgement: 'off', pressMs, triggerHit: false };
}

function pruneHitEffects(now = performance.now()) {
  for (const lane of ['left', 'right']) {
    state.hitEffects[lane] = state.hitEffects[lane].filter(
      (effect) => (now - effect.createdAt) < HIT_EFFECT_DURATION_MS
    );
  }
}

function hasActiveHitEffects() {
  return state.hitEffects.left.length > 0 || state.hitEffects.right.length > 0;
}

function hasActiveBarAnimations() {
  return Object.keys(state.activeBars).length > 0 && isSessionPlaying();
}

function scheduleVisualizerEffectRender() {
  if (visualizerEffectRafId) {
    return;
  }
  visualizerEffectRafId = window.requestAnimationFrame(() => {
    visualizerEffectRafId = 0;
    renderVisualizer();
    if (hasActiveHitEffects() || hasActiveBarAnimations()) {
      scheduleVisualizerEffectRender();
    }
  });
}

function addHitEffect(lane, judgement) {
  state.hitEffects[lane].push({
    createdAt: performance.now(),
    judgement
  });
  renderVisualizer();
  scheduleVisualizerEffectRender();
}

function getMovingBarLedSpan(numLeds) {
  const travelMs = Math.max(Number(state.chart?.travel_time_ms) || 0, 1);
  const slotTimes = state.gameBeatSlots.map((slot) => slot.timeMs);
  let minGapMs = Infinity;
  for (let index = 1; index < slotTimes.length; index += 1) {
    const gapMs = slotTimes[index] - slotTimes[index - 1];
    if (gapMs > 0) {
      minGapMs = Math.min(minGapMs, gapMs);
    }
  }
  const halfStripLeds = Math.max(Math.floor(numLeds / 2) - 2, 2);
  const projectedGapLeds = Number.isFinite(minGapMs)
    ? Math.floor((minGapMs / travelMs) * halfStripLeds) - 1
    : 6;
  return Math.max(2, Math.min(8, projectedGapLeds));
}

function reduceStreamLevels(levels, event) {
  if (event.type === 'led_frame' && Array.isArray(event.levels)) {
    return event.levels.map(clampLevel);
  }

  if (event.type === 'lane_event') {
    const isLeft = event.lane === 'left';
    const isRight = event.lane === 'right';
    
    if (isLeft) {
      return [1, levels[1]];
    }
    if (isRight) {
      return [levels[0], 1];
    }
  }

  if (event.type === 'clock_tick') {
    return [clampLevel(levels[0] * CLOCK_DECAY), clampLevel(levels[1] * CLOCK_DECAY)];
  }

  return levels;
}

function renderVisualizer() {
  const canvas = document.getElementById('visualizer');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);

  const numLeds = 70;
  const ledWidth = (width - 20) / numLeds;
  const ledHeight = 12;
  const ledY = (height - ledHeight) / 2;
  pruneHitEffects();
  ctx.drawImage(getVisualizerBackgroundCanvas(width, height, numLeds, ledWidth, ledY, ledHeight), 0, 0);

  renderBars(ctx, width, ledY, ledHeight, numLeds, ledWidth);
  renderHitEffects(ctx, ledY, ledHeight, numLeds, ledWidth);
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
  backgroundCtx.fillStyle = '#0f172a';
  backgroundCtx.fillRect(0, 0, width, height);

  for (let i = 0; i < numLeds; i += 1) {
    backgroundCtx.fillStyle = i < numLeds / 2
      ? 'rgba(59, 130, 246, 0.12)'
      : 'rgba(236, 72, 153, 0.12)';
    backgroundCtx.fillRect(10 + i * ledWidth, ledY, ledWidth - 2, ledHeight);
  }

  return visualizerBackgroundCanvas;
}

function renderBars(ctx, canvasWidth, ledY, ledHeight, numLeds, ledWidth) {
  void canvasWidth;
  const barSpan = getMovingBarLedSpan(numLeds);
  const nowMs = performance.now();
  Object.values(state.activeBars).forEach((bar) => {
    const travelMs = bar.travel_time_ms || 1;
    const progressMs = VisualizerProjection.getAnimatedBarProgressMs(
      bar.progress_ms,
      bar.received_at_ms,
      nowMs,
      travelMs
    );
    const ratio = Math.min(Math.max(progressMs / travelMs, 0), 1);
    const ledRange = VisualizerProjection.getRenderedBarRange(
      numLeds,
      ratio,
      bar.lane,
      barSpan
    );
    if (!ledRange) {
      return;
    }

    for (let ledIndex = ledRange.startIndex; ledIndex <= ledRange.endIndex; ledIndex += 1) {
      const x = 10 + ledIndex * ledWidth;
      ctx.fillStyle = bar.lane === 'left'
        ? 'rgba(96, 165, 250, 0.95)'
        : 'rgba(244, 114, 182, 0.95)';
      ctx.fillRect(x, ledY, ledWidth - 2, ledHeight);
    }
  });
}

function getJudgementEffectColor(judgement, alpha) {
  if (judgement === 'perfect') {
    return `rgba(250, 204, 21, ${alpha})`;
  }
  if (judgement === 'good') {
    return `rgba(74, 222, 128, ${alpha})`;
  }
  return `rgba(248, 113, 113, ${alpha})`;
}

function renderHitEffects(ctx, ledY, ledHeight, numLeds, ledWidth) {
  const centerLeftIndex = Math.floor((numLeds / 2) - 1);
  const centerRightIndex = centerLeftIndex + 1;
  const baseSpan = 4;
  const now = performance.now();

  for (const lane of ['left', 'right']) {
    state.hitEffects[lane].forEach((effect) => {
      const ageMs = now - effect.createdAt;
      const ageRatio = Math.max(0, Math.min(ageMs / HIT_EFFECT_DURATION_MS, 1));
      const spread = Math.round(ageRatio * 3);
      const alpha = 1 - ageRatio;
      const anchorIndex = lane === 'left' ? centerLeftIndex - 1 : centerRightIndex + 1;
      const startIndex = lane === 'left'
        ? Math.max(0, anchorIndex - baseSpan - spread + 1)
        : Math.max(0, anchorIndex - spread);
      const endIndex = lane === 'left'
        ? Math.min(numLeds - 1, anchorIndex + spread)
        : Math.min(numLeds - 1, anchorIndex + baseSpan + spread - 1);

      for (let ledIndex = startIndex; ledIndex <= endIndex; ledIndex += 1) {
        const x = 10 + ledIndex * ledWidth;
        ctx.fillStyle = getJudgementEffectColor(effect.judgement, alpha);
        ctx.fillRect(x, ledY, ledWidth - 2, ledHeight);
      }
    });
  }
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

function setDebugVisibility(visible) {
  state.debugVisible = Boolean(visible);
  localStorage.setItem(DEBUG_STORAGE_KEY, state.debugVisible ? 'true' : 'false');
  const panel = document.getElementById('debug-panel');
  if (panel) {
    panel.classList.toggle('panel-hidden', !state.debugVisible);
  }
  const toggle = document.getElementById('btn-toggle-debug');
  if (toggle) {
    toggle.textContent = state.debugVisible ? 'Hide overlay' : 'Show overlay';
  }
}

function resolveCurrentPlaybackMs(fallbackMs = state.sessionProgressMs) {
  const audio = ensureAudioElement();
  const audioMs = audio ? audio.currentTime * 1000 : Number.NaN;
  const fallbackProgressMs = Math.max(Number(fallbackMs) || 0, 0);
  if (Number.isFinite(audioMs) && audioMs >= 0) {
    return Math.max(audioMs, fallbackProgressMs);
  }
  return fallbackProgressMs;
}

function renderGameMeta() {
  const currentTimeEl = document.getElementById('game-current-time');
  if (currentTimeEl) {
    currentTimeEl.textContent = formatPlaybackTime(resolveCurrentPlaybackMs());
  }

  const trackLengthEl = document.getElementById('game-track-length');
  if (trackLengthEl) {
    trackLengthEl.textContent = formatPlaybackTime(resolveWaveformDurationMs());
  }
}

function renderDebugPanel() {
  const remainingEl = document.getElementById('debug-remaining-time');
  if (remainingEl) {
    remainingEl.textContent = formatMs(state.remainingMs);
  }

  const perfectEl = document.getElementById('debug-perfect-window');
  const goodEl = document.getElementById('debug-good-window');
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
  renderGameMeta();
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
        renderVisualizer();
        renderDebugPanel();
      }
    }, 250);
  }

  upsertTriggerTimelineEntry(payload.lane, {
    hitTimeMs: payload.hit_time_ms,
    progressMs: payload.progress_ms,
    remainingMs: payload.remaining_ms,
  });

  state.remainingMs = Math.max(payload.remaining_ms, 0);
  renderVisualizer();
  renderDebugPanel();
  scheduleVisualizerEffectRender();
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
  addHitEffect(lane, judgementResult.judgement);
  renderDebugPanel();
}

function resetSessionState() {
  stopAudioPlayback();
  state.activeBars = {};
  state.hitEffects.left = [];
  state.hitEffects.right = [];
  state.triggerTimeline.left = [];
  state.triggerTimeline.right = [];
  state.pressTimeline.left = [];
  state.pressTimeline.right = [];
  state.remainingMs = 0;
  state.sessionProgressMs = 0;
  state.sessionStartMs = null;
  if (visualizerEffectRafId) {
    window.cancelAnimationFrame(visualizerEffectRafId);
    visualizerEffectRafId = 0;
  }
  stopGamePlaybackRenderLoop();
  if (gameWaveformRenderRafId) {
    window.cancelAnimationFrame(gameWaveformRenderRafId);
    gameWaveformRenderRafId = 0;
  }
  renderVisualizer();
  renderGameSpectralWaveform(0);
  renderDebugPanel();
}

function updateUI() {
  const select = document.getElementById('song-select');
  if (select.options.length <= 1 && state.songs.length > 0) {
    select.innerHTML = '<option value="">Select a song</option>' + 
      state.songs.map(s => `<option value="${s}">${s}</option>`).join('');
    select.value = state.songs[0];
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
        renderDebugPanel();
        return;
      }

      if (payload.type === 'led_frame' && Array.isArray(payload.levels)) {
        state.levels = payload.levels.map(clampLevel);
        if (typeof payload.progress_ms === 'number') {
          state.sessionProgressMs = payload.progress_ms;
          if (state.chartDurationMs > 0) {
            state.remainingMs = Math.max(
              state.chartDurationMs - payload.progress_ms,
              0
            );
          }
        }
        scheduleGameSpectralWaveformRender(state.sessionProgressMs);
        renderVisualizer();
        renderDebugPanel();
        return;
      }

      if (payload.type === 'bar_frame') {
        handleBarFrame(payload);
        return;
      }

      state.levels = reduceStreamLevels(state.levels, payload);
      renderVisualizer();
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
    const response = await fetch(`${apiBaseUrl}/songs`);
    state.songs = await response.json();
    updateUI();
    const select = document.getElementById('song-select');
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
    const response = await fetch(
      `${apiBaseUrl}/charts/${encodeURIComponent(songId)}`
    );
    if (!response.ok) {
      throw new Error('failed to load chart');
    }
    const chartData = await response.json();
    state.chart = chartData;
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
    renderDebugPanel();
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
  const previousMuted = audio.muted;
  audio.muted = true;
  try {
    await audio.play();
  } finally {
    audio.muted = previousMuted;
  }
}

function init() {
  const startButton = document.getElementById('btn-start');
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

      const songId = document.getElementById('song-select').value;
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
        renderDebugPanel();

        try {
          await startAudioPlayback(songId, 0);
        } catch (error) {
          console.error('Playback failed', error);
          state.runStatus = 'Playback blocked';
          updateUI();
          return;
        }

        socket.send(JSON.stringify({
          type: 'start_session',
          song_id: songId
        }));
        state.songId = songId;
        updateUI();
      }
    });
  }

  const stopButton = document.getElementById('btn-stop');
  if (stopButton) {
    stopButton.addEventListener('click', () => {
      if (!isSessionPlaying() && !isSessionPaused()) return;
      requestStopSession(true);
    });
  }

  document.getElementById('song-select').addEventListener('change', async (event) => {
    const songId = event.target.value;
    state.songId = songId;
    await loadChart(songId);
  });

  document.getElementById('btn-toggle-debug').addEventListener('click', () => {
    setDebugVisibility(!state.debugVisible);
  });

  const audio = ensureAudioElement();
  ['loadedmetadata', 'timeupdate', 'seeked', 'play', 'pause', 'ended'].forEach((eventName) => {
    audio.addEventListener(eventName, () => {
      renderGameMeta();
      scheduleGameSpectralWaveformRender(resolveCurrentPlaybackMs());
      if (shouldAnimateGamePlayback()) {
        ensureGamePlaybackRenderLoop();
      } else {
        stopGamePlaybackRenderLoop();
      }
    });
  });

  setDebugVisibility(state.debugVisible);
  renderDebugPanel();
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
