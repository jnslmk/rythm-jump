from pydantic import BaseModel, NonNegativeInt, PositiveInt, model_validator


class JudgementWindowsMs(BaseModel):
    perfect: PositiveInt
    good: PositiveInt

    @model_validator(mode="after")
    def validate_good_not_less_than_perfect(self) -> "JudgementWindowsMs":
        if self.good < self.perfect:
            raise ValueError("good judgement window must be >= perfect window")
        return self


class Chart(BaseModel):
    song_id: str
    bpm: float = 120.0
    travel_time_ms: PositiveInt
    # Signed to allow calibration shifts where charts need early/late global timing offsets.
    global_offset_ms: int
    judgement_windows_ms: JudgementWindowsMs
    left: list[NonNegativeInt]
    right: list[NonNegativeInt]

    # Removed lane validation as new songs might start empty.
