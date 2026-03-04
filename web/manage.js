const apiBaseUrl = '/api';

let wavesurfer = null;
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
  document.getElementById('song-editor').classList.remove('hidden');
  
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
  
  wavesurfer.on('audioprocess', (time) => {
    document.getElementById('audio-time').textContent = 
      `${formatTime(time)} / ${formatTime(wavesurfer.getDuration())}`;
  });
  
  wavesurfer.on('ready', () => {
    document.getElementById('audio-time').textContent = 
      `0:00 / ${formatTime(wavesurfer.getDuration())}`;
  });
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
      document.getElementById('song-editor').classList.add('hidden');
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
  
  document.getElementById('btn-tap-bpm').addEventListener('click', tapBpm);
  
  document.getElementById('btn-save-chart').addEventListener('click', saveChart);
  
  fetchSongs();
}

document.addEventListener('DOMContentLoaded', init);
