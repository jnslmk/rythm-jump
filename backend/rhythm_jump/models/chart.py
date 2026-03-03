from pydantic import BaseModel, NonNegativeInt, model_validator


class JudgementWindowsMs(BaseModel):
    perfect: NonNegativeInt
    good: NonNegativeInt


class Chart(BaseModel):
    song_id: str
    travel_time_ms: NonNegativeInt
    # Signed to allow calibration shifts where charts need early/late global timing offsets.
    global_offset_ms: int
    judgement_windows_ms: JudgementWindowsMs
    left: list[NonNegativeInt]
    right: list[NonNegativeInt]

    @model_validator(mode='after')
    def validate_lanes_not_both_empty(self) -> 'Chart':
        if not self.left and not self.right:
            raise ValueError('left and right lanes cannot both be empty')
        return self
