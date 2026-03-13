# Backend Architecture

This backend is easiest to understand as a signal path:

1. Inputs arrive from the browser WebSocket or the Raspberry Pi GPIO contacts.
2. The runtime updates the session clock and active chart state.
3. The runtime emits two output streams:
   - browser events over WebSocket
   - LED frames to the physical strip
4. Audio playback is treated as another adapter that follows the runtime clock.

## Module Map

- `rythm_jump/main.py`
  - FastAPI entrypoint.
  - Mounts the API routers and static frontend.
  - Starts and stops the backend runtime during app lifespan.
- `rythm_jump/bootstrap.py`
  - The backend wiring diagram.
  - Builds the runtime, GPIO polling source, and LED output adapter.
  - Good first file to read when debugging Pi startup or hardware integration.
- `rythm_jump/config.py`
  - Central place for environment-driven configuration.
  - Collects filesystem paths, GPIO pins, and LED strip settings.
- `rythm_jump/engine/session.py`
  - Small session state machine: `idle -> playing -> paused`.
- `rythm_jump/engine/runtime.py`
  - Main coordinator.
  - Owns the active chart, clock, playback loop, event sinks, and LED outputs.
- `rythm_jump/engine/io.py`
  - Polling adapter for physical button inputs.
- `rythm_jump/api/session_stream.py`
  - Browser control surface over WebSocket.
  - Converts browser messages into runtime commands.
- `rythm_jump/api/charts.py`
  - Song/chart management over HTTP.
- `rythm_jump/hw/*.py`
  - Hardware adapters only.
  - GPIO input, audio playback, and WS281x LED output stay isolated here.

## Startup Sequence

When the app starts:

1. `main.lifespan()` calls `build_runtime_stack()`.
2. `bootstrap` creates:
   - `GameRuntime`
   - `PollingInputSource`
   - physical LED output
3. `start_runtime_stack()` launches the GPIO polling task.
4. API routes access the shared runtime through `app.state.runtime`.

When the app stops:

1. The polling task is cancelled.
2. The runtime stops playback and clears outputs.
3. The audio adapter is closed.

## Configuration

Most Raspberry Pi setup values are now grouped in `rythm_jump/config.py`.

Useful environment variables:

- `RHYTHM_SONGS_DIR`
- `RHYTHM_FRONTEND_DIR`
- `RHYTHM_LEFT_CONTACT_PIN`
- `RHYTHM_RIGHT_CONTACT_PIN`
- `RHYTHM_LED_COUNT`
- `RHYTHM_LED_PIN`
- `RHYTHM_LED_FREQ_HZ`
- `RHYTHM_LED_DMA`
- `RHYTHM_LED_INVERT`
- `RHYTHM_LED_BRIGHTNESS`
- `RHYTHM_LED_CHANNEL`

## Suggested Reading Order For New Contributors

If someone wants to modify gameplay without getting lost:

1. Read `docs/backend-architecture.md`
2. Read `rythm_jump/bootstrap.py`
3. Read `rythm_jump/engine/session.py`
4. Read `rythm_jump/engine/runtime.py`
5. Then read whichever adapter they need:
   - browser: `rythm_jump/api/session_stream.py`
   - GPIO: `rythm_jump/hw/gpio_input.py`
   - LEDs: `rythm_jump/hw/led_output.py`
   - songs/charts: `rythm_jump/song_library.py`
