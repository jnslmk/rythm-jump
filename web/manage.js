const apiBaseUrl = '/api';

let wavesurfer = null;
let wsRegions = null;
let currentSongId = '';
let state = {
  songs: [],
  bpm: 120,
  offset: 0,
  left: [],
  right: []
};

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
  state.left = chart.left || [];
  state.right = chart.right || [];
  
  document.getElementById('song-bpm').value = state.bpm;
  document.getElementById('global-offset').value = state.offset;
  document.getElementById('left-timings').value = state.left.join(', ');
  document.getElementById('right-timings').value = state.right.join(', ');
  
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
  if (!wavesurfer || !wsRegions) return;
  
  wsRegions.clearRegions();
  
  const bpm = parseFloat(document.getElementById('song-bpm').value) || 120;
  const offsetMs = parseFloat(document.getElementById('global-offset').value) || 0;
  const offset = offsetMs / 1000;
  const duration = wavesurfer.getDuration();
  
  if (bpm <= 0 || !duration) return;
  
  const beatInterval = 60 / bpm;
  
  // High-precision loop: multiply index to avoid accumulation drift
  // Start index: first i such that offset + i*beatInterval >= 0
  const startI = Math.ceil(-offset / beatInterval);
  
  for (let i = startI; ; i++) {
    const t = offset + (i * beatInterval);
    if (t > duration) break;
    
    // Safety break to prevent infinite loops (max 10 minutes of song)
    if (i > 5000) break;

    const isBar = (i % 4 === 0);
    
    wsRegions.addRegion({
      start: t,
      end: t + 0.01, // Minimal width, rely on border for visibility
      color: isBar ? '#f6d03f' : 'rgba(255, 255, 255, 0.4)',
      drag: false,
      resize: false,
      // Some WaveSurfer versions use 'label' or 'content' or specific data attributes
      content: isBar ? 'BAR' : ''
    });
  }
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
    left: parseTimings(document.getElementById('left-timings').value),
    right: parseTimings(document.getElementById('right-timings').value),
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

function parseTimings(text) {
  return text.split(',').map(s => s.trim()).filter(s => s.length > 0).map(Number).filter(n => !isNaN(n));
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
  
  document.getElementById('btn-save-chart').addEventListener('click', saveChart);
  
  fetchSongs();
}

document.addEventListener('DOMContentLoaded', init);
