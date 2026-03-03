from pydantic import BaseModel, model_validator


class JudgementWindowsMs(BaseModel):
    perfect: int
    good: int


class Chart(BaseModel):
    song_id: str
    travel_time_ms: int
    global_offset_ms: int
    judgement_windows_ms: JudgementWindowsMs
    left: list[int]
    right: list[int]

    @model_validator(mode='after')
    def validate_lanes_not_both_empty(self) -> 'Chart':
        if not self.left and not self.right:
            raise ValueError('left and right lanes cannot both be empty')
        return self
