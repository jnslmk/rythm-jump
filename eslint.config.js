module.exports = [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        console: "readonly",
        document: "readonly",
        window: "readonly",
        WebSocket: "readonly",
        setTimeout: "readonly",
        localStorage: "readonly",
        performance: "readonly",
        URL: "readonly",
        requestAnimationFrame: "readonly",
        HTMLElement: "readonly",
        Element: "readonly",
        EventTarget: "readonly",
        KeyboardEvent: "readonly",
        fetch: "readonly",
        File: "readonly",
        FormData: "readonly",
        WaveSurfer: "readonly",
        VisualizerProjection: "readonly",
        module: "readonly",
        require: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "warn",
    },
  },
];
