const apiBaseUrl = '/api';
const DEFAULT_SESSION_ID = 'default-session';
const CLOCK_DECAY = 0.85;
const DEBUG_STORAGE_KEY = 'rhythmJumpDebugVisible';
const GAME_WAVEFORM_ZOOM_STORAGE_KEY = 'rhythmJumpGameWaveformZoom';
const MAX_TIMELINE_ENTRIES = 12;
const MIN_SPECTRAL_RMS = 0.001;
const GAME_WAVEFORM_ZOOM_MIN = 1;
const GAME_WAVEFORM_TARGET_WINDOW_MS = 12000;
const GAME_NOTE_SNAP_MAX_MS = 180;
const WAVEFORM_BAND_LAYERS = [
  { alpha: 0.78, color: 'rgba(249, 115, 22, 0.72)', gain: 1.15 },
  { alpha: 0.78, color: 'rgba(16, 185, 129, 0.72)', gain: 1.0 },
  { alpha: 0.82, color: 'rgba(14, 165, 233, 0.74)', gain: 1.25 }
];

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
  gameNoteSlotSets: { left: new Set(), right: new Set() },
};

let gameWaveSurfer = null;
let isGameWaveformDragging = false;
let gameWaveformDragStartX = 0;
let gameWaveformDragStartLeft = 0;
let gameWaveformDragTargetLeft = 0;
let gameWaveformDragRafId = 0;

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
    startBtn.classList.toggle('ghost-button', playing || paused);
    startBtn.classList.toggle('accent-button', !playing && !paused);
  }

  if (stopBtn) {
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
    applyGameWaveformZoom();
    renderGameSpectralWaveform();
  });
  gameWaveSurfer.on('audioprocess', () => {
    renderGameSpectralWaveform();
  });
}

function loadGameWaveform(songId) {
  if (!songId) return;
  initGameWaveform();
  if (!gameWaveSurfer) return;
  const url = `${apiBaseUrl}/songs/${encodeURIComponent(songId)}/audio`;
  gameWaveSurfer.load(url);
  renderGameSpectralWaveform(0);
}

function formatMs(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '--';
  }
  return `${(value / 1000).toFixed(2)}s`;
}

function computeChartDuration(chart) {
  if (!chart) {
    return 0;
  }
  const leftMax = chart.left.length > 0 ? Math.max(...chart.left) : 0;
  const rightMax = chart.right.length > 0 ? Math.max(...chart.right) : 0;
  return Math.max(leftMax, rightMax) + chart.travel_time_ms;
}

function resolveWaveformDurationMs() {
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

function getGameWaveformZoom() {
  const durationMs = Math.max(resolveWaveformDurationMs(), 1);
  return Math.max(GAME_WAVEFORM_ZOOM_MIN, durationMs / GAME_WAVEFORM_TARGET_WINDOW_MS);
}

function updateVisibleWaveformWindowRatios(scrollContainer) {
  if (!scrollContainer) {
    state.visibleWaveformWindowRatios = { start: 0, end: 1 };
    return state.visibleWaveformWindowRatios;
  }
  const totalWidth = Math.max(scrollContainer.scrollWidth, 1);
  const viewportWidth = Math.max(scrollContainer.clientWidth, 1);
  const maxLeft = Math.max(totalWidth - viewportWidth, 0);
  const left = Math.max(0, Math.min(scrollContainer.scrollLeft, maxLeft));
  const right = Math.max(left, Math.min(left + viewportWidth, totalWidth));
  state.visibleWaveformWindowRatios = {
    start: left / totalWidth,
    end: right / totalWidth
  };
  return state.visibleWaveformWindowRatios;
}

function applyGameWaveformZoom(options = {}) {
  const preferExisting = options.preferExisting === true;
  const spectralWaveform = document.getElementById('game-spectral-waveform');
  const beatGrid = document.getElementById('game-zoom-beat-grid');
  const scrollContainer = document.getElementById('game-spectral-waveform-scroll');
  if (!spectralWaveform) {
    return;
  }
  const computedZoom = getGameWaveformZoom();
  const hasComputedDuration = computedZoom > GAME_WAVEFORM_ZOOM_MIN;
  state.waveformZoom = (preferExisting && !hasComputedDuration)
    ? Math.max(state.waveformZoom, GAME_WAVEFORM_ZOOM_MIN)
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
  state.gameBeatSlots = slots;
  state.gameNoteSlotSets = {
    left: mapNotesToBeatSlotIndexes(state.chart?.left || []),
    right: mapNotesToBeatSlotIndexes(state.chart?.right || [])
  };
}

function lowerBoundGameBeatSlotIndex(targetMs) {
  if (!state.gameBeatSlots.length) {
    return -1;
  }
  let low = 0;
  let high = state.gameBeatSlots.length - 1;
  let answer = state.gameBeatSlots.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if ((state.gameBeatSlots[mid]?.timeMs || 0) >= targetMs) {
      answer = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
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
    return;
  }

  const durationMs = Math.max(resolveWaveformDurationMs(), 1);
  const slotTimes = state.gameBeatSlots.map((slot) => slot.timeMs);
  const slotGaps = [];
  for (let i = 1; i < slotTimes.length; i += 1) {
    const gap = slotTimes[i] - slotTimes[i - 1];
    if (gap > 0) {
      slotGaps.push(gap);
    }
  }
  const baseGapMs = slotGaps.length > 0
    ? slotGaps.sort((a, b) => a - b)[Math.floor(slotGaps.length / 2)]
    : Math.max(durationMs / Math.max(state.gameBeatSlots.length, 1), 1);
  const firstMs = state.gameBeatSlots[0]?.timeMs || 0;
  const lastMs = state.gameBeatSlots[state.gameBeatSlots.length - 1]?.timeMs || firstMs;
  const leadUnits = Math.max(firstMs / Math.max(baseGapMs, 1), 0);
  const tailUnits = Math.max((durationMs - lastMs) / Math.max(baseGapMs, 1), 0);
  const trackParts = [];
  if (leadUnits > 0.0001) {
    trackParts.push(`minmax(0, ${leadUnits}fr)`);
  }
  for (let i = 0; i < state.gameBeatSlots.length; i += 1) {
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

  for (let index = 0; index < state.gameBeatSlots.length; index += 1) {
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
}

function startGameWaveformDrag(event) {
  if (event.button !== 0) {
    return;
  }
  const scrollContainer = document.getElementById('game-spectral-waveform-scroll');
  if (!scrollContainer) {
    return;
  }
  isGameWaveformDragging = true;
  gameWaveformDragStartX = event.clientX;
  gameWaveformDragStartLeft = scrollContainer.scrollLeft;
  scrollContainer.classList.add('dragging');
  event.preventDefault();
}

function handleGameWaveformDragMove(event) {
  if (!isGameWaveformDragging) {
    return;
  }
  const scrollContainer = document.getElementById('game-spectral-waveform-scroll');
  if (!scrollContainer) {
    return;
  }
  const dragDelta = event.clientX - gameWaveformDragStartX;
  gameWaveformDragTargetLeft = gameWaveformDragStartLeft - dragDelta;
  if (gameWaveformDragRafId) {
    return;
  }
  gameWaveformDragRafId = window.requestAnimationFrame(() => {
    gameWaveformDragRafId = 0;
    scrollContainer.scrollLeft = gameWaveformDragTargetLeft;
    updateVisibleWaveformWindowRatios(scrollContainer);
  });
}

function stopGameWaveformDrag() {
  if (!isGameWaveformDragging) {
    return;
  }
  isGameWaveformDragging = false;
  if (gameWaveformDragRafId) {
    window.cancelAnimationFrame(gameWaveformDragRafId);
    gameWaveformDragRafId = 0;
  }
  const scrollContainer = document.getElementById('game-spectral-waveform-scroll');
  if (scrollContainer) {
    scrollContainer.classList.remove('dragging');
    updateVisibleWaveformWindowRatios(scrollContainer);
  }
}

function drawSpectralTimeAxis(ctx, width, height, durationMs) {
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

function drawBeatMarkers(ctx, width, axisY, durationMs, beatTimesMs = []) {
  if (!Array.isArray(beatTimesMs) || beatTimesMs.length === 0) {
    return;
  }
  for (let i = 0; i < beatTimesMs.length; i += 1) {
    const beatMs = Number(beatTimesMs[i]) || 0;
    const x = (beatMs / durationMs) * width;
    const isBarStart = i % 4 === 0;
    ctx.strokeStyle = isBarStart ? 'rgba(246, 208, 63, 0.95)' : 'rgba(45, 212, 191, 0.6)';
    ctx.lineWidth = isBarStart ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, 2);
    ctx.lineTo(x, axisY);
    ctx.stroke();
  }
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
  return Math.max(0, Math.min(maxValue, 1));
}

function drawDecodedWaveform(ctx, width, centerY, maxAmplitude) {
  const analysis = state.chart?.audio_analysis;
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
    for (let i = 0; i < WAVEFORM_BAND_LAYERS.length; i += 1) {
      const layer = WAVEFORM_BAND_LAYERS[i];
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

function renderGameSpectralWaveform(progressMs = state.sessionProgressMs) {
  const canvas = document.getElementById('game-spectral-waveform');
  const descriptors = state.chart?.audio_analysis?.beat_descriptors;
  const beatTimesMs = state.chart?.audio_analysis?.beat_times_ms;
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext('2d');
  const width = Math.max(canvas.clientWidth, 1);
  const height = Math.max(canvas.clientHeight, 1);
  canvas.width = width;
  canvas.height = height;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, width, height);

  const durationMs = resolveWaveformDurationMs();
  const axisY = height - 16;
  const centerY = (axisY - 2) / 2;
  const maxAmplitude = Math.max(Math.floor((axisY - 4) * 0.45), 8);
  const hasDetailedWaveform = drawDecodedWaveform(ctx, width, centerY, maxAmplitude);
  const rmsMax = Math.max(state.spectralRmsMax || 0, MIN_SPECTRAL_RMS);
  drawBeatMarkers(ctx, width, axisY, durationMs, beatTimesMs);

  if (Array.isArray(descriptors) && descriptors.length > 0) {
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (const descriptor of descriptors) {
      const timeMs = Number(descriptor.time_ms) || 0;
      const x = (timeMs / durationMs) * width;
      const amplitude = Math.max((Number(descriptor.rms) || 0) / rmsMax, 0) * maxAmplitude;
      ctx.strokeStyle = descriptor.color_hint || '#22d3ee';
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, centerY - amplitude);
      ctx.lineTo(x, centerY + amplitude);
      ctx.stroke();
    }
  } else if (!hasDetailedWaveform) {
    ctx.fillStyle = 'rgba(156, 163, 175, 0.9)';
    ctx.font = "12px 'Space Grotesk', sans-serif";
    ctx.fillText('Run Analyze Song in Manage Songs to generate colors.', 16, 24);
    return;
  }

  const progressX = Math.max(0, Math.min((progressMs / durationMs) * width, width));
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(progressX, 0);
  ctx.lineTo(progressX, axisY);
  ctx.stroke();
  drawSpectralTimeAxis(ctx, width, height, durationMs);

  if (isSessionPlaying() && state.waveformZoom > 1 && !isGameWaveformDragging) {
    const scrollContainer = document.getElementById('game-spectral-waveform-scroll');
    if (scrollContainer) {
      const leftTarget = progressX - (scrollContainer.clientWidth * 0.5);
      const maxLeft = Math.max(scrollContainer.scrollWidth - scrollContainer.clientWidth, 0);
      scrollContainer.scrollLeft = Math.max(0, Math.min(leftTarget, maxLeft));
      updateVisibleWaveformWindowRatios(scrollContainer);
    }
  }
}

function pushTimelineEntry(timeline, lane, entry) {
  const bucket = timeline[lane];
  bucket.unshift(entry);
  if (bucket.length > MAX_TIMELINE_ENTRIES) {
    bucket.length = MAX_TIMELINE_ENTRIES;
  }
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
  const centerX = width / 2;

  ctx.clearRect(0, 0, width, height);
  
  // Background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);

  // LED Strip Representation
  const numLeds = 70;
  const ledWidth = (width - 20) / numLeds;
  const ledHeight = 12;
  const ledY = (height - ledHeight) / 2;

  for (let i = 0; i < numLeds; i++) {
    const intensity = i < numLeds / 2 ? state.levels[0] : state.levels[1];
    const distFromCenter = Math.abs(i - (numLeds - 1) / 2) / (numLeds / 2);
    const ledIntensity = intensity * (1 - distFromCenter * 0.5);
    
    ctx.fillStyle = i < numLeds / 2 
      ? `rgba(59, 130, 246, ${ledIntensity})` 
      : `rgba(236, 72, 153, ${ledIntensity})`;
    
    ctx.fillRect(10 + i * ledWidth, ledY, ledWidth - 2, ledHeight);
    
    // Glow effect
    if (ledIntensity > 0.1) {
      ctx.shadowBlur = 10 * ledIntensity;
      ctx.shadowColor = ctx.fillStyle;
      ctx.strokeRect(10 + i * ledWidth, ledY, ledWidth - 2, ledHeight);
      ctx.shadowBlur = 0;
    }
  }

  renderBars(ctx, width, height, ledY, ledHeight, centerX);
  renderGameSpectralWaveform();
}

function renderBars(ctx, canvasWidth, canvasHeight, ledY, ledHeight, centerX) {
  const halfWidth = (canvasWidth - 20) / 2;
  const barHeight = ledHeight + 14;
  const barY = ledY - barHeight - 6;
  Object.values(state.activeBars).forEach((bar) => {
    const travelMs = bar.travel_time_ms || 1;
    const ratio = Math.min(Math.max(bar.progress_ms / travelMs, 0), 1);
    const length = ratio * Math.max(halfWidth - 10, 0);
    if (length <= 0) {
      return;
    }

    ctx.fillStyle =
      bar.lane === 'left'
        ? 'rgba(59, 130, 246, 0.7)'
        : 'rgba(236, 72, 153, 0.7)';
    ctx.fillRect(
      bar.lane === 'left' ? centerX - length : centerX,
      barY,
      length,
      barHeight
    );
  });
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
      perfectEl.textContent = `Perfect ±${windows.perfect} ms`;
    }
    if (goodEl) {
      goodEl.textContent = `Good ±${windows.good} ms`;
    }
  } else {
    if (perfectEl) {
      perfectEl.textContent = 'Perfect ±0 ms';
    }
    if (goodEl) {
      goodEl.textContent = 'Good ±0 ms';
    }
  }

  renderTimelineList(
    'left-trigger-timeline',
    state.triggerTimeline.left,
    (entry) =>
      `Trigger @${formatMs(entry.hitTimeMs)} (progress ${entry.progressMs} ms · remaining ${entry.remainingMs} ms)`
  );
  renderTimelineList(
    'right-trigger-timeline',
    state.triggerTimeline.right,
    (entry) =>
      `Trigger @${formatMs(entry.hitTimeMs)} (progress ${entry.progressMs} ms · remaining ${entry.remainingMs} ms)`
  );
  renderTimelineList(
    'left-press-timeline',
    state.pressTimeline.left,
    (entry) => `Press @${entry.label} (${entry.source})`
  );
  renderTimelineList(
    'right-press-timeline',
    state.pressTimeline.right,
    (entry) => `Press @${entry.label} (${entry.source})`
  );
}

function handleBarFrame(payload) {
  const key = `${payload.lane}-${payload.hit_time_ms}`;
  state.activeBars[key] = payload;

  if (payload.progress_ms >= payload.travel_time_ms) {
    window.setTimeout(() => {
      if (state.activeBars[key]?.hit_time_ms === payload.hit_time_ms) {
        delete state.activeBars[key];
        renderVisualizer();
        renderDebugPanel();
      }
    }, 250);
  }

  pushTimelineEntry(state.triggerTimeline, payload.lane, {
    hitTimeMs: payload.hit_time_ms,
    progressMs: payload.progress_ms,
    remainingMs: payload.remaining_ms,
  });

  state.remainingMs = Math.max(payload.remaining_ms, 0);
  renderVisualizer();
  renderDebugPanel();
}

function recordButtonPress(lane) {
  const offset = state.sessionStartMs ? Date.now() - state.sessionStartMs : null;
  const entry = {
    label: offset !== null ? formatMs(offset) : new Date().toLocaleTimeString(),
    source: 'keyboard',
  };
  pushTimelineEntry(state.pressTimeline, lane, entry);
  renderDebugPanel();
}

function resetSessionState() {
  stopAudioPlayback();
  state.activeBars = {};
  state.triggerTimeline.left = [];
  state.triggerTimeline.right = [];
  state.pressTimeline.left = [];
  state.pressTimeline.right = [];
  state.remainingMs = 0;
  state.sessionProgressMs = 0;
  state.sessionStartMs = null;
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
        updateUI();
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
    state.chartDurationMs = computeChartDuration(chartData);
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
    applyGameWaveformZoom();
    renderGameBeatGrid();
    state.remainingMs = state.chartDurationMs;
    loadGameWaveform(songId);
    renderGameSpectralWaveform(0);
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

  setDebugVisibility(state.debugVisible);
  renderDebugPanel();
  initGameWaveform();
  applyGameWaveformZoom({ preferExisting: true });
  renderGameBeatGrid();

  const waveformScroll = document.getElementById('game-spectral-waveform-scroll');
  if (waveformScroll) {
    waveformScroll.addEventListener('scroll', () => {
      updateVisibleWaveformWindowRatios(waveformScroll);
    });
    waveformScroll.addEventListener('mousedown', startGameWaveformDrag);
  }
  window.addEventListener('mousemove', handleGameWaveformDragMove);
  window.addEventListener('mouseup', stopGameWaveformDrag);

    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('resize', () => {
      applyGameWaveformZoom();
      renderGameBeatGrid();
      renderGameSpectralWaveform();
    });
  
  fetchSongs();
  connectWebSocket();
  
  // Animation loop for smooth decay if no clock ticks
    function animate() {
      state.levels = [
        clampLevel(state.levels[0] * 0.95),
        clampLevel(state.levels[1] * 0.95)
      ];
      renderVisualizer();
      window.requestAnimationFrame(animate);
    }
  animate();
}

document.addEventListener('DOMContentLoaded', init);
