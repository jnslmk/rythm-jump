"""Configuration schemas consumed by Rhythm Jump."""

from pydantic import BaseModel, NonNegativeInt


class InputConfig(BaseModel):
    """Input-related settings that can be tuned by the player."""

    debounce_threshold_ms: NonNegativeInt = 30
