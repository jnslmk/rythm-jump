# Hardware Wiring

## Contact Switch Inputs

- Default contact pin: BCM `17` (override with `RHYTHM_CONTACT_PIN`).
- Input mode: pull-up (`GPIO.PUD_UP`).
- Active-low logic: switch pressed when pin reads `LOW`.

Recommended wiring per switch:
- One leg to GPIO input pin.
- Other leg to GND.
- Keep wire runs short and stable; debounce in software if needed.

## WS2811 Level Shifting

- Raspberry Pi GPIO is 3.3V logic; WS2811 data path is typically 5V.
- Use a level shifter (for example 74AHCT125/74HCT14 class) between Pi data pin and LED data-in.
- Ensure common ground between Pi, LED power supply, and level shifter.

## Power And Safety Notes

- Do not power LED strips from Pi 5V pin directly.
- Use a dedicated 5V supply sized for worst-case LED current.
- Add an inline fuse on LED power feed.
- Add a series resistor on LED data line near first pixel (typical 220-470 ohm).
- Power off before rewiring GPIO, switch, or LED power rails.
