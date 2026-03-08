const apiBaseUrl = '/api';
const MANAGE_SELECTED_SONG_KEY = 'manage:selectedSongId';
const MIN_SPECTRAL_RMS = 0.001;

let wavesurfer = null;
let wsRegions = null;
let currentSongId = '';
let state = {
  songs: [],
  bpm: 120,
  offset: 0,
  left: [],
  right: [],
  audioAnalysis: null,
  chartDurationMs: 1,
  spectralRmsMax: 1,
  beats: [],
  beatIntervalMs: 500,
  beatSelections: {
    left: new Set(),
    right: new Set()
  }
};

function buildBeatTimeline(duration, bpm, offsetSeconds) {
  const beatInterval = 60 / bpm;
  const beats = [];
  const startIndex = Math.ceil(-offsetSeconds / beatInterval);
  let safety = 0;

  for (let i = startIndex; ; i++) {
    if (safety++ > 6000) break;
    const time = offsetSeconds + (i * beatInterval);
    if (time > duration) break;
    if (time < 0) continue;

    beats.push({
      index: i,
      time,
      timeMs: Math.max(0, Math.round(time * 1000)),
      isBar: ((i % 4) + 4) % 4 === 0
    });
  }

  return { beats, beatInterval };
}

function findClosestBeatIndex(timeMs, toleranceMs) {
  if (!state.beats.length) return -1;

  let bestIdx = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < state.beats.length; i++) {
    const diff = Math.abs(state.beats[i].timeMs - timeMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    } else if (state.beats[i].timeMs > timeMs && diff > bestDiff) {
      break;
    }
  }

  return bestDiff <= toleranceMs ? bestIdx : -1;
}

function buildBeatSelectionSets() {
  const sets = {
    left: new Set(),
    right: new Set()
  };

  if (!state.beats.length) {
    state.beatSelections = sets;
    return sets;
  }

  const toleranceMs = Math.max((state.beatIntervalMs || 0) * 0.25, 30);

  for (const lane of ['left', 'right']) {
    const quantized = [];
    for (const timing of state[lane]) {
      const idx = findClosestBeatIndex(timing, toleranceMs);
      if (idx >= 0) {
        sets[lane].add(idx);
        quantized.push(state.beats[idx].timeMs);
      }
    }
    state[lane] = Array.from(new Set(quantized)).sort((a, b) => a - b);
  }

  state.beatSelections = sets;
  return sets;
}

function renderBeatGrid() {
  const beatGrid = document.getElementById('beat-grid');
  if (!beatGrid) return;

  beatGrid.innerHTML = '';

  if (!state.beats.length) {
    beatGrid.innerHTML = '<p class="beat-grid-empty">Beat grid will appear after a song loads.</p>';
    state.beatSelections = {
      left: new Set(),
      right: new Set()
    };
    return;
  }

  const selections = buildBeatSelectionSets();
  const fragment = document.createDocumentFragment();

  state.beats.forEach((beat, index) => {
    const column = document.createElement('div');
    column.className = beat.isBar ? 'beat-column bar' : 'beat-column';
    column.dataset.beatIndex = String(index);

    const indexLabel = document.createElement('span');
    indexLabel.className = 'beat-index';
    indexLabel.textContent = String(index + 1);

    const timeLabel = document.createElement('span');
    timeLabel.className = 'beat-time';
    timeLabel.textContent = `${beat.timeMs}ms`;

    const leftBtn = document.createElement('button');
    leftBtn.type = 'button';
    leftBtn.className = 'beat-cell';
    leftBtn.dataset.beatIndex = String(index);
    leftBtn.dataset.lane = 'left';
    leftBtn.textContent = 'L';
    leftBtn.setAttribute('title', `Left note at ${beat.timeMs} ms`);
    leftBtn.setAttribute('aria-pressed', selections.left.has(index));
    if (selections.left.has(index)) leftBtn.classList.add('active');

    const rightBtn = document.createElement('button');
    rightBtn.type = 'button';
    rightBtn.className = 'beat-cell';
    rightBtn.dataset.beatIndex = String(index);
    rightBtn.dataset.lane = 'right';
    rightBtn.textContent = 'R';
    rightBtn.setAttribute('title', `Right note at ${beat.timeMs} ms`);
    rightBtn.setAttribute('aria-pressed', selections.right.has(index));
    if (selections.right.has(index)) rightBtn.classList.add('active');

    column.appendChild(indexLabel);
    column.appendChild(timeLabel);
    column.appendChild(leftBtn);
    column.appendChild(rightBtn);
    fragment.appendChild(column);
  });

  beatGrid.appendChild(fragment);
}

function handleBeatGridClick(event) {
  const button = event.target.closest('button[data-lane]');
  if (!button) return;

  const lane = button.dataset.lane;
  const beatIndex = Number(button.dataset.beatIndex);
  toggleBeatSelection(beatIndex, lane);
}

function toggleBeatSelection(beatIndex, lane) {
  if (!state.beats[beatIndex]) return;

  const laneArray = state[lane];
  const beatMs = state.beats[beatIndex].timeMs;
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

function renderManageSpectralWaveform(progressMs = 0) {
  const canvas = document.getElementById('manage-spectral-waveform');
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

  const descriptors = state.audioAnalysis?.beat_descriptors;
  const beatTimesMs = state.audioAnalysis?.beat_times_ms;
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    ctx.fillStyle = 'rgba(156, 163, 175, 0.9)';
    ctx.font = "12px 'Space Grotesk', sans-serif";
    ctx.fillText('Run Analyze Song to render a colored waveform.', 16, 24);
    return;
  }

  const durationMs = resolveManageWaveformDurationMs();
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
    ctx.globalAlpha = 0.82;
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
  state.beatSelections = {
    left: new Set(),
    right: new Set()
  };
  renderBeatGrid();
  
  document.getElementById('song-bpm').value = state.bpm;
  document.getElementById('global-offset').value = state.offset;
  
  document.getElementById('editor-title').textContent = `Editing: ${songId}`;
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
    renderManageSpectralWaveform(0);
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
    state.beatIntervalMs = 0;
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
    state.beatIntervalMs = 0;
    renderBeatGrid();
    return;
  }

  const { beats, beatInterval } = buildBeatTimeline(duration, bpm, offset);
  state.beats = beats;
  state.beatIntervalMs = beatInterval * 1000;
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

  setControlEnabled('btn-play-pause', canEdit);
  setControlEnabled('btn-tap-bpm', canEdit);
  setControlEnabled('btn-analyze-audio', hasSong);
  setControlEnabled('btn-save-chart', hasSong);
  updatePlayPauseButtonLabel();
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
  const payload = {
    song_id: currentSongId,
    travel_time_ms: 1200, // Should probably be configurable per song
    global_offset_ms: parseInt(document.getElementById('global-offset').value, 10),
    judgement_windows_ms: { perfect: 50, good: 100 },
    left: [...state.left],
    right: [...state.right],
    bpm: parseFloat(document.getElementById('song-bpm').value),
    audio_analysis: state.audioAnalysis
  };
  
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
      state.audioAnalysis = null;
      state.spectralRmsMax = 1;
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
  
  document.getElementById('btn-tap-bpm').addEventListener('click', () => {
    tapBpm();
    updateBeatGrid();
  });
  
  document.getElementById('btn-analyze-audio').addEventListener('click', analyzeAudioMetadata);
  
  document.getElementById('song-bpm').addEventListener('input', updateBeatGrid);
  document.getElementById('global-offset').addEventListener('input', updateBeatGrid);
  document.getElementById('beat-grid').addEventListener('click', handleBeatGridClick);
  
  document.getElementById('btn-save-chart').addEventListener('click', saveChart);
  window.addEventListener('resize', () => {
    renderManageSpectralWaveform((wavesurfer?.getCurrentTime?.() || 0) * 1000);
  });
  
  renderBeatGrid();
  renderManageSpectralWaveform(0);
  updateControlStates();
  fetchSongs();
}

document.addEventListener('DOMContentLoaded', init);
