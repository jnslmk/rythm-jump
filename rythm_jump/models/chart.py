"""Pydantic models that describe Rhythm Jump charts."""

from pydantic import BaseModel, NonNegativeInt, PositiveInt, model_validator


class JudgementWindowsMs(BaseModel):
    """Capture judgement windows for perfect and good hits."""

    perfect: PositiveInt
    good: PositiveInt

    @model_validator(mode="after")
    def validate_good_not_less_than_perfect(self) -> "JudgementWindowsMs":
        """Ensure the good window is not tighter than the perfect window."""
        if self.good < self.perfect:
            message = "good judgement window must be >= perfect window"
            raise ValueError(message)
        return self


class Chart(BaseModel):
    """Describe a Rhythm Jump chart and its timing data."""

    song_id: str
    bpm: float = 120.0
    travel_time_ms: PositiveInt
    # Signed to allow calibration shifts (early/late timing offsets).
    global_offset_ms: int
    judgement_windows_ms: JudgementWindowsMs
    left: list[NonNegativeInt]
    right: list[NonNegativeInt]
