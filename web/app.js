const DEFAULT_LEVELS = [0, 0];
const CLOCK_DECAY = 0.85;
const DEFAULT_SESSION_ID = 'default-session';

const apiBaseUrl = '/api';

const KEY_MAPPING = {
  a: 'left',
  ' ': 'left',
  Space: 'left',
  Spacebar: 'left',
  l: 'right',
  Enter: 'right'
};

let state = {
  runtimeMode: 'browser-attached',
  songId: 'demo',
  travelTimeMs: 1200,
  globalOffsetMs: 0,
  lastAction: 'none',
  runStatus: 'idle',
  levels: [0, 0],
  leftInput: '',
  rightInput: '',
  chartStatus: 'idle'
};

let socket = null;

function buildSessionStreamUrl(sessionId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/session/${encodeURIComponent(sessionId)}`;
}

function clampLevel(value) {
  return Math.max(0, Math.min(1, value));
}

function reduceStreamLevels(levels, event) {
  if (event.type === 'lane_event') {
    if (event.lane === 'left') {
      return [1, levels[1]];
    }
    if (event.lane === 'right') {
      return [levels[0], 1];
    }
    return levels;
  }

  if (event.type === 'clock_tick') {
    return [clampLevel(levels[0] * CLOCK_DECAY), clampLevel(levels[1] * CLOCK_DECAY)];
  }

  return levels;
}

function resetStreamLevels() {
  return [...DEFAULT_LEVELS];
}

function computeSideBarLayout(levels, width, height) {
  const barWidth = Math.max(8, Math.floor(width / 12));
  const gap = Math.max(4, Math.floor(barWidth / 2));
  const maxBarHeight = Math.max(4, height - 8);
  const centerX = width / 2;
  const leftLevel = clampLevel(levels[0]);
  const rightLevel = clampLevel(levels[1]);
  const leftHeight = Math.max(4, leftLevel * maxBarHeight);
  const rightHeight = Math.max(4, rightLevel * maxBarHeight);

  return {
    left: {
      x: centerX - gap - barWidth,
      y: (height - leftHeight) / 2,
      width: barWidth,
      height: leftHeight
    },
    right: {
      x: centerX + gap,
      y: (height - rightHeight) / 2,
      width: barWidth,
      height: rightHeight
    }
  };
}

function renderVisualizer() {
  const canvas = document.getElementById('visualizer');
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0f172a';
  const layout = computeSideBarLayout(state.levels, width, height);
  ctx.fillRect(layout.left.x, layout.left.y, layout.left.width, layout.left.height);
  ctx.fillRect(layout.right.x, layout.right.y, layout.right.width, layout.right.height);
}

function updateUI() {
  document.getElementById('last-action').textContent = state.lastAction;
  document.getElementById('run-status').textContent = `${state.runtimeMode} | ${state.songId} | ${state.runStatus}`;
  document.getElementById('chart-status').textContent = state.chartStatus;
}

function connectWebSocket() {
  if (socket) {
    socket.close();
  }

  state.levels = resetStreamLevels();
  renderVisualizer();

  socket = new WebSocket(buildSessionStreamUrl(DEFAULT_SESSION_ID));

  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (!payload || typeof payload !== 'object') {
        return;
      }
      state.levels = reduceStreamLevels(state.levels, payload);
      renderVisualizer();
    } catch {
      // Ignore malformed events
    }
  };
}

function mapKeyboardKey(key) {
  if (key.length === 1 && /[A-Za-z]/.test(key)) {
    return KEY_MAPPING[key.toLowerCase()] ?? null;
  }
  return KEY_MAPPING[key] ?? null;
}

function shouldIgnoreKeyboardTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  const interactiveSelector =
    'input, textarea, select, button, a, [role="button"], [role="link"]';

  const tagName = target.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }

  if (tagName === 'button' || tagName === 'a') {
    return true;
  }

  if (target.closest(interactiveSelector) !== null) {
    return true;
  }

  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }

  if (target.getAttribute('contenteditable') === 'true') {
    return true;
  }

  return target.closest('[contenteditable="true"]') !== null;
}

function handleKeydown(event) {
  if (shouldIgnoreKeyboardTarget(event.target)) {
    return;
  }

  const action = mapKeyboardKey(event.key);
  if (!action) {
    return;
  }

  event.preventDefault();
  state.lastAction = action;
  updateUI();
}

function parseTimings(value) {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const values = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      return { ok: false };
    }
    values.push(parseInt(entry, 10));
  }

  return { ok: true, values };
}

function parseIntegerInput(value) {
  if (!/^-?\d+$/.test(value.trim())) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function saveChart() {
  const left = parseTimings(state.leftInput);
  const right = parseTimings(state.rightInput);

  if (!left.ok || !right.ok) {
    state.chartStatus = 'Invalid timings';
    updateUI();
    return;
  }

  const payload = {
    song_id: state.songId,
    travel_time_ms: state.travelTimeMs,
    global_offset_ms: state.globalOffsetMs,
    judgement_windows_ms: {
      perfect: 50,
      good: 100
    },
    left: left.values,
    right: right.values
  };

  try {
    const response = await fetch(
      `${apiBaseUrl}/charts/${encodeURIComponent(state.songId)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      throw new Error(`failed to save chart for ${state.songId}`);
    }
    state.chartStatus = 'Saved';
  } catch {
    state.chartStatus = 'Save failed';
  }

  updateUI();
}

function init() {
  // Event listeners
  document.getElementById('runtime-mode').addEventListener('change', (e) => {
    state.runtimeMode = e.target.value;
    updateUI();
  });

  document.getElementById('song-select').addEventListener('change', (e) => {
    state.songId = e.target.value;
    updateUI();
  });

  document.getElementById('travel-time').addEventListener('change', (e) => {
    const value = parseIntegerInput(e.target.value);
    if (value !== null && value > 0) {
      state.travelTimeMs = value;
    }
  });

  document.getElementById('global-offset').addEventListener('change', (e) => {
    const value = parseIntegerInput(e.target.value);
    if (value !== null) {
      state.globalOffsetMs = value;
    }
  });

  document.getElementById('btn-start').addEventListener('click', () => {
    state.runStatus = 'running';
    updateUI();
  });

  document.getElementById('btn-stop').addEventListener('click', () => {
    state.runStatus = 'stopped';
    updateUI();
  });

  document.getElementById('left-timings').addEventListener('input', (e) => {
    state.leftInput = e.target.value;
  });

  document.getElementById('right-timings').addEventListener('input', (e) => {
    state.rightInput = e.target.value;
  });

  document.getElementById('btn-save').addEventListener('click', () => {
    state.chartStatus = 'Saving...';
    updateUI();
    saveChart();
  });

  // Keyboard input
  window.addEventListener('keydown', handleKeydown);

  // WebSocket
  connectWebSocket();

  // Initial render
  updateUI();
  renderVisualizer();
}

document.addEventListener('DOMContentLoaded', init);
