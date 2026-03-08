from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from app.models.schemas import (
    BatchInferenceRequest,
    InferenceRequest,
    InferenceResponse,
)
from app.services.feature_extractor import extract_features
from app.services.model import MODEL
from app.services.policy_router import build_explanation, route_decision

router = APIRouter(prefix="/inference", tags=["inference"])


def _run_inference(req: InferenceRequest) -> InferenceResponse:
    features = extract_features(req)
    p_actionable, uncertainty, contributions = MODEL.predict(features.values)
    routed = route_decision(req, p_actionable, uncertainty, features.values)

    alarm_id = req.alarm_id or str(uuid4())

    explanation_json = build_explanation(
        req=req,
        features=features.values,
        contributions=contributions,
        overrides=routed.overrides,
    )
    explanation_json["provenance"] = features.provenance
    explanation_json["scored_at"] = datetime.now(timezone.utc).isoformat()

    return InferenceResponse(
        alarm_id=alarm_id,
        patient_id=req.patient_id,
        model_version_id=req.model_version_id,
        p_actionable=round(float(p_actionable), 4),
        uncertainty=round(float(uncertainty), 4),
        decision=routed.decision,
        explanation_json=explanation_json,
    )


@router.post("", response_model=InferenceResponse)
def infer(req: InferenceRequest) -> InferenceResponse:
    return _run_inference(req)


@router.post("/batch", response_model=list[InferenceResponse])
def infer_batch(req: BatchInferenceRequest) -> list[InferenceResponse]:
    if len(req.items) > 512:
        raise HTTPException(status_code=400, detail="batch too large")
    return [_run_inference(item) for item in req.items]
