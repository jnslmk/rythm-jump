import time

from rpi_ws281x import Color, PixelStrip

LED_COUNT = 70
LED_PIN = 18
LED_FREQ_HZ = 800000
LED_DMA = 10
LED_BRIGHTNESS = 64
LED_INVERT = False
LED_CHANNEL = 0

strip = PixelStrip(
    LED_COUNT,
    LED_PIN,
    LED_FREQ_HZ,
    LED_DMA,
    LED_INVERT,
    LED_BRIGHTNESS,
    LED_CHANNEL,
)
strip.begin()

for i in range(LED_COUNT):
    strip.setPixelColor(i, Color(0, 255, 0))
strip.show()

time.sleep(10)
