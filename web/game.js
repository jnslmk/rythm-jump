const apiBaseUrl = '/api';
const DEFAULT_SESSION_ID = 'default-session';
const CLOCK_DECAY = 0.85;
const DEBUG_STORAGE_KEY = 'rhythmJumpDebugVisible';
const MAX_TIMELINE_ENTRIES = 12;

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
  debugVisible: loadDebugVisibility(),
  sessionStartMs: null,
};

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
        if (payload.state === 'idle') {
          resetSessionState();
        }
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
    state.remainingMs = state.chartDurationMs;
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
  document.getElementById('btn-start').addEventListener('click', async () => {
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

  document.getElementById('btn-stop').addEventListener('click', () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'stop_session' }));
      resetSessionState();
    }
  });

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

    window.addEventListener('keydown', handleKeydown);
  
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
