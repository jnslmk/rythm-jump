(function initRhythmJumpTheme(global) {
  const theme = {
    colors: {
      panelText: '#050508',
      waveform: {
        wave: '#4f46e5',
        progress: '#3b82f6',
        cursor: '#f43f5e',
        background: '#020617',
        progressLine: '#f8fafc',
        progressLineSoft: 'rgba(248, 250, 252, 0.95)',
        windowFill: '#f8fafc',
        axis: 'rgba(148, 163, 184, 0.45)',
        axisLabel: 'rgba(203, 213, 225, 0.9)',
        beat: 'rgba(45, 212, 191, 0.6)',
        barBeat: 'rgba(246, 208, 63, 0.95)',
        label: 'rgba(248, 250, 252, 0.9)',
        empty: 'rgba(156, 163, 175, 0.9)',
        descriptorFallback: '#22d3ee',
      },
      spectralBands: [
        { alpha: 0.78, color: 'rgba(249, 115, 22, 0.72)', gain: 1.15 },
        { alpha: 0.78, color: 'rgba(16, 185, 129, 0.72)', gain: 1.0 },
        { alpha: 0.82, color: 'rgba(14, 165, 233, 0.74)', gain: 1.25 }
      ],
      lanes: {
        left: '#a5b4fc',
        right: '#fb7185',
        leftText: '#c5d1ff',
        rightText: '#ffe1e7',
        leftSoft: 'rgba(165, 180, 252, 0.25)',
        rightSoft: 'rgba(251, 113, 133, 0.25)',
      },
      judgement: {
        perfect: '#fde047',
        good: '#86efac',
        miss: '#f87171',
      },
      activeBars: {
        left: 'rgba(90, 210, 255, 0.9)',
        right: 'rgba(255, 105, 160, 0.9)',
        perfect: 'rgba(253, 224, 71, 0.98)',
        good: 'rgba(134, 239, 172, 0.96)',
        miss: 'rgba(248, 113, 113, 0.96)',
        fallback: '#f8fafc',
      },
      ledTrack: {
        left: 'rgba(59, 130, 246, 0.12)',
        right: 'rgba(236, 72, 153, 0.12)',
      },
      region: {
        bar: '#f6d03f',
        beat: 'rgba(255, 255, 255, 0.4)',
      },
      textOnDark: '#fff',
      shadowDark: '#000',
    },
    waveSurfer: {
      barWidth: 2,
      barRadius: 3,
      height: {
        game: 120,
        manage: 128,
      },
    },
  };

  global.RhythmJumpTheme = Object.freeze(theme);
}(typeof globalThis !== 'undefined' ? globalThis : this));
