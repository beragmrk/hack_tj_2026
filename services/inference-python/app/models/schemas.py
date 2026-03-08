from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class WaveformWindow(BaseModel):
    signal_type: str = Field(..., description="Waveform modality (ecg, ppg, etc.)")
    sample_hz: float = Field(..., gt=0)
    samples: List[float] = Field(..., min_length=8)


class InferenceRequest(BaseModel):
    alarm_id: Optional[str] = Field(default=None)
    patient_id: str
    device_id: str
    alarm_type: str
    severity: Literal["low", "medium", "high", "critical"]
    observed_at: datetime
    signal_quality: Literal["high", "medium", "low"] = "high"
    numeric_snapshot: Dict[str, float] = Field(default_factory=dict)
    waveforms: List[WaveformWindow] = Field(default_factory=list)
    context: Dict[str, Any] = Field(default_factory=dict)
    model_version_id: str = "gbt-v0.1"


class InferenceResponse(BaseModel):
    alarm_id: str
    patient_id: str
    model_version_id: str
    p_actionable: float
    uncertainty: float
    decision: Literal["suppress", "route_clinician", "route_rapid_response"]
    explanation_json: Dict[str, Any]


class BatchInferenceRequest(BaseModel):
    items: List[InferenceRequest]


class FederatedRound(BaseModel):
    id: str
    started_at: datetime
    ended_at: datetime
    participants_json: List[Dict[str, Any]]
    agg_metrics_json: Dict[str, Any]


class FederatedReplayEvent(BaseModel):
    round_id: str
    stage: str
    at: datetime
    payload: Dict[str, Any]
