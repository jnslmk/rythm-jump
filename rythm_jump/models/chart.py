"""Pydantic models that describe Rhythm Jump charts."""

from typing import Literal

from pydantic import (
    BaseModel,
    NonNegativeFloat,
    NonNegativeInt,
    PositiveFloat,
    PositiveInt,
    model_validator,
)


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


class SpectralBandEnergy(BaseModel):
    """Normalized energy split across low/mid/high frequency ranges."""

    low: NonNegativeFloat
    mid: NonNegativeFloat
    high: NonNegativeFloat


class BeatSpectralDescriptor(BaseModel):
    """Per-beat spectral annotation used by the chart editor and game UI."""

    time_ms: NonNegativeInt
    onset_strength: NonNegativeFloat
    spectral_centroid_hz: NonNegativeFloat
    spectral_bandwidth_hz: NonNegativeFloat
    spectral_rolloff_hz: NonNegativeFloat
    rms: NonNegativeFloat
    band_energy: SpectralBandEnergy
    dominant_band: Literal["low", "mid", "high"]
    color_hint: str


class AudioAnalysis(BaseModel):
    """Offline audio analysis metadata derived from librosa."""

    version: str = "librosa-v1"
    sample_rate_hz: PositiveInt
    hop_length: PositiveInt
    frame_length_ms: PositiveInt
    tempo_bpm: PositiveFloat
    beat_times_ms: list[NonNegativeInt]
    beat_descriptors: list[BeatSpectralDescriptor]


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
    audio_analysis: AudioAnalysis | None = None
