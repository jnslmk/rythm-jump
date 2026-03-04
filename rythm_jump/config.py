from pydantic import BaseModel, NonNegativeInt


class InputConfig(BaseModel):
    debounce_threshold_ms: NonNegativeInt = 30
