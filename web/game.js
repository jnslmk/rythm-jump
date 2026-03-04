const apiBaseUrl = '/api';
const DEFAULT_SESSION_ID = 'default-session';
const CLOCK_DECAY = 0.85;

const KEY_MAPPING = {
  a: 'left',
  ' ': 'left',
  Space: 'left',
  l: 'right',
  Enter: 'right'
};

let state = {
  songId: '',
  runStatus: 'idle',
  lastAction: 'none',
  levels: [0, 0],
  songs: []
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
  } catch (e) {
    console.error('Failed to fetch songs:', e);
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
  }
  
  updateUI();
}

function init() {
  document.getElementById('btn-start').addEventListener('click', () => {
    const songId = document.getElementById('song-select').value;
    if (!songId) return alert('Select a song first!');
    
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'start_session',
        song_id: songId
      }));
    }
  });

  document.getElementById('btn-stop').addEventListener('click', () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'stop_session' }));
    }
  });

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
    requestAnimationFrame(animate);
  }
  animate();
}

document.addEventListener('DOMContentLoaded', init);
