const apiBaseUrl = '/api';
const DEFAULT_SESSION_ID = 'default-session';
const CLOCK_DECAY = 0.85;
const DEBUG_STORAGE_KEY = 'rhythmJumpDebugVisible';
const SPECTRAL_MODE_STORAGE_KEY = 'rhythmJumpSpectralMode';
const MAX_TIMELINE_ENTRIES = 12;
const MIN_SPECTRAL_RMS = 0.001;

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

function loadSpectralMode() {
  const stored = localStorage.getItem(SPECTRAL_MODE_STORAGE_KEY);
  if (stored === 'live' || stored === 'off') {
    return stored;
  }
  return 'precomputed';
}

let state = {
  songId: '',
  runStatus: 'idle',
  lastAction: 'none',
  levels: [0, 0],
  songs: [],
  activeBars: {},
  triggerTimeline: { left: [], right: [] },
  pressTimeline: { left: [], right: [] },
  remainingMs: 0,
  sessionProgressMs: 0,
  chart: null,
  chartDurationMs: 0,
  spectralMode: loadSpectralMode(),
  spectralRmsMax: 1,
  debugVisible: loadDebugVisibility(),
  sessionStartMs: null,
};

let gameWaveSurfer = null;
let analyzerContext = null;
let analyzerNode = null;
let analyzerData = null;
let audioSourceNode = null;

function isSessionPlaying() {
  return state.runStatus === 'playing';
}

function updateControlStates() {
  const startBtn = document.getElementById('btn-start');
  const stopBtn = document.getElementById('btn-stop');
  const playing = isSessionPlaying();

  if (startBtn) {
    startBtn.textContent = playing ? 'Pause Game' : 'Start Game';
    startBtn.classList.toggle('ghost-button', playing);
    startBtn.classList.toggle('accent-button', !playing);
  }

  if (stopBtn) {
    stopBtn.disabled = !playing;
  }
}

function updateSpectralModeSelector() {
  const select = document.getElementById('spectral-mode-select');
  if (!select) return;
  select.value = state.spectralMode;
}

function setSpectralMode(mode) {
  const supported = ['precomputed', 'live', 'off'];
  if (!supported.includes(mode)) {
    return;
  }
  state.spectralMode = mode;
  localStorage.setItem(SPECTRAL_MODE_STORAGE_KEY, mode);
  updateSpectralModeSelector();
  renderGameSpectralWaveform();
}

function stopAudioPlayback() {
  const audio = ensureAudioElement();
  audio.pause();
  audio.currentTime = 0;
}

function ensureLiveAnalyzer(audio) {
  if (typeof window.AudioContext === 'undefined' && typeof window.webkitAudioContext === 'undefined') {
    return;
  }
  if (!analyzerContext) {
    const ContextCtor = window.AudioContext || window.webkitAudioContext;
    analyzerContext = new ContextCtor();
    analyzerNode = analyzerContext.createAnalyser();
    analyzerNode.fftSize = 512;
    analyzerNode.smoothingTimeConstant = 0.8;
  }
  if (!audioSourceNode) {
    audioSourceNode = analyzerContext.createMediaElementSource(audio);
    audioSourceNode.connect(analyzerNode);
    analyzerNode.connect(analyzerContext.destination);
  }
  if (!analyzerData || analyzerData.length !== analyzerNode.frequencyBinCount) {
    analyzerData = new Uint8Array(analyzerNode.frequencyBinCount);
  }
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

function initGameWaveform() {
  if (gameWaveSurfer) return;
  if (typeof WaveSurfer === 'undefined') return;

  const Timeline = window.TimelinePlugin || WaveSurfer.Timeline || (WaveSurfer.plugins && WaveSurfer.plugins.Timeline);
  const timelinePlugin = Timeline
    ? Timeline.create({ container: '#game-timeline' })
    : null;

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

  if (timelinePlugin) {
    config.plugins = [timelinePlugin];
  }

  gameWaveSurfer = WaveSurfer.create(config);
  gameWaveSurfer.on('ready', () => {
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

  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    ctx.fillStyle = 'rgba(156, 163, 175, 0.9)';
    ctx.font = "12px 'Space Grotesk', sans-serif";
    ctx.fillText('Run Analyze Song in Manage Songs to generate colors.', 16, 24);
    return;
  }

  const durationMs = resolveWaveformDurationMs();
  const axisY = height - 16;
  const centerY = (axisY - 2) / 2;
  const maxAmplitude = Math.max(Math.floor((axisY - 4) * 0.45), 8);
  const rmsMax = Math.max(state.spectralRmsMax || 0, MIN_SPECTRAL_RMS);
  drawBeatMarkers(ctx, width, axisY, durationMs, beatTimesMs);

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

  const progressX = Math.max(0, Math.min((progressMs / durationMs) * width, width));
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(progressX, 0);
  ctx.lineTo(progressX, axisY);
  ctx.stroke();
  drawSpectralTimeAxis(ctx, width, height, durationMs);
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

function renderPrecomputedSpectralOverlay(ctx, width, overlayHeight) {
  const descriptors = state.chart?.audio_analysis?.beat_descriptors;
  if (!Array.isArray(descriptors) || descriptors.length === 0 || state.chartDurationMs <= 0) {
    return;
  }

  const progressMs = state.sessionProgressMs || 0;
  const rmsMax = state.spectralRmsMax || 1;
  for (const descriptor of descriptors) {
    const x = 10 + ((descriptor.time_ms || 0) / state.chartDurationMs) * (width - 20);
    const rmsRatio = Math.max(0, Math.min((descriptor.rms || 0) / rmsMax, 1));
    const height = 2 + rmsRatio * (overlayHeight - 4);
    const ageMs = Math.abs(progressMs - (descriptor.time_ms || 0));
    const emphasis = ageMs < 160 ? 1 : 0.55;
    ctx.fillStyle = descriptor.color_hint || '#2dd4bf';
    ctx.globalAlpha = emphasis;
    ctx.fillRect(x, overlayHeight - height, 2, height);
  }
  ctx.globalAlpha = 1;
}

function renderLiveSpectralOverlay(ctx, width, overlayHeight) {
  if (!analyzerNode || !analyzerData) {
    return;
  }
  analyzerNode.getByteFrequencyData(analyzerData);
  const barWidth = Math.max(width / analyzerData.length, 1);
  for (let i = 0; i < analyzerData.length; i += 1) {
    const level = analyzerData[i] / 255;
    const hue = Math.round((i / analyzerData.length) * 330);
    const alpha = Math.max(level, 0.15);
    ctx.fillStyle = `hsla(${hue}, 80%, 60%, ${alpha})`;
    const x = i * barWidth;
    const barHeight = Math.max(level * overlayHeight, 1);
    ctx.fillRect(x, overlayHeight - barHeight, Math.ceil(barWidth), barHeight);
  }
}

function renderSpectralOverlay(ctx, width, height) {
  if (state.spectralMode === 'off') {
    return;
  }
  const overlayHeight = Math.min(30, Math.max(16, Math.round(height * 0.4)));
  if (state.spectralMode === 'live') {
    renderLiveSpectralOverlay(ctx, width, overlayHeight);
    return;
  }
  renderPrecomputedSpectralOverlay(ctx, width, overlayHeight);
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
  renderSpectralOverlay(ctx, width, height);

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
  renderDebugPanel();
}

function updateUI() {
  document.getElementById('last-action').textContent = state.lastAction;
  document.getElementById('run-status').textContent = state.runStatus;
  
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
  state.lastAction = action;
  
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

async function startAudioPlayback(songId) {
  const audio = ensureAudioElement();
  if (state.spectralMode === 'live') {
    ensureLiveAnalyzer(audio);
    if (analyzerContext?.state === 'suspended') {
      await analyzerContext.resume();
    }
  }
  audio.pause();
  audio.currentTime = 0;
  audio.src = `${apiBaseUrl}/songs/${encodeURIComponent(songId)}/audio`;
  audio.load();
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
        requestStopSession(false);
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
          await startAudioPlayback(songId);
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
      if (!isSessionPlaying()) return;
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

  const spectralModeSelect = document.getElementById('spectral-mode-select');
  if (spectralModeSelect) {
    spectralModeSelect.addEventListener('change', (event) => {
      setSpectralMode(event.target.value);
    });
  }

  setDebugVisibility(state.debugVisible);
  updateSpectralModeSelector();
  renderDebugPanel();
  initGameWaveform();

    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('resize', () => {
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
