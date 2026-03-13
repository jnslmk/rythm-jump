"""HTTP-only helpers such as health and hardware debug routes."""

from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from rythm_jump.cli import LedDebugOptions, debug_ws2811_output
from rythm_jump.config import build_gpio_config
from rythm_jump.hw.gpio_input import read_jump_box_states

router = APIRouter()


class LedDebugRequest(BaseModel):
    """Serializable LED diagnostic settings accepted by the browser UI."""

    pattern: Literal["solid", "chase", "lanes"] = "lanes"
    color: Literal["off", "red", "green", "blue", "white", "amber", "pink", "cyan"] = (
        "amber"
    )
    repeat: int = Field(default=1, ge=1, le=20)
    delay_s: float = Field(default=0.05, ge=0.0, le=5.0)


@router.get("/health")
def health() -> dict[str, bool]:
    """Return the current service health state."""
    return {"ok": True}


@router.get("/debug/gpio")
def read_gpio_debug_state() -> dict[str, object]:
    """Return the current jump-box GPIO states and configured pin numbers."""
    gpio_config = build_gpio_config()
    return {
        "pins": {
            "left": gpio_config.left_contact_pin,
            "right": gpio_config.right_contact_pin,
        },
        "states": read_jump_box_states(),
    }


@router.post("/debug/led")
async def run_led_debug_pattern(payload: LedDebugRequest) -> dict[str, object]:
    """Run a simple LED-strip diagnostic pattern from the browser UI."""
    options = LedDebugOptions(
        pattern=payload.pattern,
        color_name=payload.color,
        repeat=payload.repeat,
        delay_s=payload.delay_s,
    )
    await asyncio.to_thread(debug_ws2811_output, options=options)
    return {
        "ok": True,
        "pattern": payload.pattern,
        "color": payload.color,
        "repeat": payload.repeat,
        "delay_s": payload.delay_s,
    }
