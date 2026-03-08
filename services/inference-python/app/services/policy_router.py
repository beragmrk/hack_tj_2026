"""Neuro-symbolic policy router.

This module encodes hard clinical safety constraints that override pure model output.
The key principle is: model predictions can prioritize triage effort, but cannot violate
high-confidence physiologic deterioration rules.

Current hard rules:
1. Never suppress sustained SpO2 drops when waveform quality is high.
2. Never suppress critical alarms with high-quality input.
3. Route uncertain predictions to clinicians for conservative safety.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Tuple

from app.models.schemas import InferenceRequest

Decision = Literal["suppress", "route_clinician", "route_rapid_response"]


@dataclass(frozen=True)
class PolicyResult:
    decision: Decision
    overrides: List[str]


def route_decision(
    req: InferenceRequest,
    p_actionable: float,
    uncertainty: float,
    features: Dict[str, float],
) -> PolicyResult:
    overrides: List[str] = []

    alarm_type = req.alarm_type.lower()
    is_high_quality = req.signal_quality == "high"
    drop_duration_s = features.get("drop_duration_s", 0.0)
    spo2 = features.get("spo2", 100.0)

    # Hard safety rule: sustained, high-quality SpO2 drops are never suppressed.
    if alarm_type == "spo2_drop" and is_high_quality and drop_duration_s >= 15.0 and spo2 < 90.0:
        overrides.append(
            "hard_rule:sustained_spo2_drop_high_quality -> route_clinician"
        )
        return PolicyResult(decision="route_clinician", overrides=overrides)

    # Critical alarms with reliable signal should not be suppressed.
    if req.severity == "critical" and is_high_quality:
        overrides.append("hard_rule:critical_alarm_high_quality -> route_rapid_response")
        return PolicyResult(decision="route_rapid_response", overrides=overrides)

    # Soft policy layer over model scores.
    if uncertainty >= 0.45:
        overrides.append("soft_rule:high_uncertainty -> route_clinician")
        return PolicyResult(decision="route_clinician", overrides=overrides)

    if p_actionable >= 0.78:
        if req.severity in {"high", "critical"}:
            return PolicyResult(decision="route_rapid_response", overrides=overrides)
        return PolicyResult(decision="route_clinician", overrides=overrides)

    if p_actionable <= 0.22 and uncertainty <= 0.2 and req.severity in {"low", "medium"}:
        return PolicyResult(decision="suppress", overrides=overrides)

    return PolicyResult(decision="route_clinician", overrides=overrides)


def build_explanation(
    req: InferenceRequest,
    features: Dict[str, float],
    contributions: Dict[str, float],
    overrides: List[str],
) -> Dict[str, Any]:
    sorted_contribs = sorted(
        contributions.items(), key=lambda item: abs(item[1]), reverse=True
    )[:6]
    top_factors = [
        {"feature": key, "contribution": round(value, 4), "feature_value": features.get(key)}
        for key, value in sorted_contribs
    ]

    return {
        "alarm_type": req.alarm_type,
        "severity": req.severity,
        "signal_quality": req.signal_quality,
        "policy_overrides": overrides,
        "top_factors": top_factors,
        "provenance_hint": "feature-level summary only; no raw identifiers",
    }
