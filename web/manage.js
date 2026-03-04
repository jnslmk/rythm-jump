const apiBaseUrl = '/api';

let wavesurfer = null;
let wsRegions = null;
let currentSongId = '';
let state = {
  songs: [],
  bpm: 120,
  offset: 0,
  left: [],
  right: [],
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

async function fetchSongs() {
  const response = await fetch(`${apiBaseUrl}/songs`);
  state.songs = await response.json();
  const select = document.getElementById('song-edit-select');
  select.innerHTML = '<option value="">Select a song to edit</option>' + 
    state.songs.map(s => `<option value="${s}">${s}</option>`).join('');
}

async function loadSong(songId) {
  currentSongId = songId;
  const response = await fetch(`${apiBaseUrl}/charts/${encodeURIComponent(songId)}`);
  const chart = await response.json();
  
  state.bpm = chart.bpm || 120; // Default if not in chart
  state.offset = chart.global_offset_ms || 0;
  state.left = (chart.left || []).slice().sort((a, b) => a - b);
  state.right = (chart.right || []).slice().sort((a, b) => a - b);
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
  });
  
  wavesurfer.on('ready', () => {
    document.getElementById('audio-time').textContent = 
      `0:00 / ${formatTime(wavesurfer.getDuration())}`;
    updateBeatGrid();
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

async function analyzeBpm() {
  if (!wavesurfer) return;
  const decodedData = wavesurfer.getDecodedData();
  if (!decodedData) return;

  const status = document.getElementById('save-status');
  status.textContent = 'Analyzing...';

  try {
    const data = decodedData.getChannelData(0);
    const sampleRate = decodedData.sampleRate;
    
    // Very basic beat detection: find peaks in volume
    const step = Math.floor(sampleRate * 0.05); // 50ms windows
    const peaks = [];
    const threshold = 0.5;
    
    for (let i = 0; i < data.length; i += step) {
      let max = 0;
      for (let j = 0; j < step && i + j < data.length; j++) {
        const val = Math.abs(data[i + j]);
        if (val > max) max = val;
      }
      if (max > threshold) {
        peaks.push(i / sampleRate);
      }
    }

    if (peaks.length < 2) {
      status.textContent = 'Could not detect BPM';
      return;
    }

    // Find common intervals
    const intervals = [];
    for (let i = 1; i < peaks.length; i++) {
      intervals.push(peaks[i] - peaks[i-1]);
    }
    
    // Sort and find median-ish interval
    intervals.sort((a, b) => a - b);
    const medianInterval = intervals[Math.floor(intervals.length / 2)];
    let bpm = 60 / medianInterval;
    
    // Normalize to reasonable range (60-180)
    while (bpm < 60) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    
    bpm = Math.round(bpm * 10) / 10;
    
    document.getElementById('song-bpm').value = bpm;
    state.bpm = bpm;
    updateBeatGrid();
    status.textContent = 'BPM detected: ' + bpm;
    setTimeout(() => { status.textContent = ''; }, 3000);
  } catch (e) {
    console.error(e);
    status.textContent = 'Analysis failed';
  }
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

let tapTimes = [];
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
    bpm: parseFloat(document.getElementById('song-bpm').value)
  };
  
  const status = document.getElementById('save-status');
  status.textContent = 'Saving...';
  
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
  }
}

function init() {
  document.getElementById('song-edit-select').addEventListener('change', (e) => {
    if (e.target.value) {
      loadSong(e.target.value);
    } else {
      const editor = document.getElementById('song-editor');
      editor.classList.add('hidden');
      editor.setAttribute('aria-hidden', 'true');
      if (wavesurfer) {
        wavesurfer.destroy();
        wavesurfer = null;
      }
    }
  });
  
  document.getElementById('upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const songId = document.getElementById('new-song-id').value;
    const audioFile = document.getElementById('new-song-audio').files[0];
    const status = document.getElementById('upload-status');
    
    if (!songId || !audioFile) return;
    
    status.textContent = 'Uploading...';
    
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
        fetchSongs();
        loadSong(songId);
      } else {
        throw new Error('Upload failed');
      }
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
    }
  });
  
  document.getElementById('btn-play-pause').addEventListener('click', () => {
    if (wavesurfer) wavesurfer.playPause();
  });
  
  document.getElementById('btn-stop-audio').addEventListener('click', () => {
    if (wavesurfer) wavesurfer.stop();
  });
  
  document.getElementById('btn-tap-bpm').addEventListener('click', () => {
    tapBpm();
    updateBeatGrid();
  });
  
  document.getElementById('btn-analyze-bpm').addEventListener('click', analyzeBpm);
  
  document.getElementById('song-bpm').addEventListener('input', updateBeatGrid);
  document.getElementById('global-offset').addEventListener('input', updateBeatGrid);
  document.getElementById('beat-grid').addEventListener('click', handleBeatGridClick);
  
  document.getElementById('btn-save-chart').addEventListener('click', saveChart);
  
  renderBeatGrid();
  fetchSongs();
}

document.addEventListener('DOMContentLoaded', init);
