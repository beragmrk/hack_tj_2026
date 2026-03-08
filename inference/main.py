from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sklearn.ensemble import GradientBoostingClassifier


Decision = Literal["suppress", "route_clinician", "route_rapid_response"]


class WaveformWindow(BaseModel):
    signal_type: str = Field(..., description="Waveform modality: ecg, ppg, etc.")
    sample_hz: float = Field(..., gt=0)
    samples: List[float] = Field(default_factory=list)


class InferenceRequest(BaseModel):
    alarm_id: Optional[str] = None
    patient_id: str
    device_id: str
    alarm_type: str
    severity: Literal["low", "medium", "high", "critical"]
    observed_at: datetime
    signal_quality: Literal["high", "medium", "low"] = "high"
    numeric_snapshot: Dict[str, float] = Field(default_factory=dict)
    waveforms: List[WaveformWindow] = Field(default_factory=list)
    context: Dict[str, Any] = Field(default_factory=dict)
    model_version_id: str = "gbt-sklearn-v1"


class InferenceResponse(BaseModel):
    alarm_id: str
    patient_id: str
    model_version_id: str
    p_actionable: float
    uncertainty: float
    decision: Decision
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


@dataclass(frozen=True)
class FeatureBundle:
    ordered: np.ndarray
    named: Dict[str, float]
    names: List[str]


FEATURE_ORDER = [
    "severity_score",
    "signal_quality_score",
    "spo2",
    "hr",
    "rr",
    "drop_duration_s",
    "wf_count",
    "wf_energy",
    "wf_std",
    "wf_ptp",
    "alarm_spo2_drop",
    "alarm_tachycardia",
    "alarm_arrhythmia",
    "alarm_bradycardia",
    "alarm_respiratory_concern",
    "missing_numeric_fraction",
]


def _wf_stats(waveforms: List[WaveformWindow]) -> Dict[str, float]:
    if not waveforms:
        return {
            "wf_count": 0.0,
            "wf_energy": 0.0,
            "wf_std": 0.0,
            "wf_ptp": 0.0,
        }

    energies: List[float] = []
    stds: List[float] = []
    ptps: List[float] = []

    for wf in waveforms:
        arr = np.asarray(wf.samples, dtype=np.float32)
        if arr.size == 0:
            continue
        energies.append(float(np.mean(arr * arr)))
        stds.append(float(arr.std()))
        ptps.append(float(np.ptp(arr)))

    return {
        "wf_count": float(len(waveforms)),
        "wf_energy": float(np.mean(energies) if energies else 0.0),
        "wf_std": float(np.mean(stds) if stds else 0.0),
        "wf_ptp": float(np.mean(ptps) if ptps else 0.0),
    }


def extract_features(req: InferenceRequest) -> FeatureBundle:
    numeric = {k.lower(): float(v) for k, v in req.numeric_snapshot.items()}
    wf = _wf_stats(req.waveforms)
    alarm_type = req.alarm_type.lower()
    normalized_alarm = {
        "tachy": "tachycardia",
        "brady": "bradycardia",
        "respiratory": "respiratory_concern",
        "resp_concern": "respiratory_concern",
    }.get(alarm_type, alarm_type)

    expected_signals = {"hr", "spo2"}
    if normalized_alarm in {"arrhythmia", "vfib", "vtach"}:
        expected_signals = {"hr"}
    elif normalized_alarm in {"respiratory_concern"}:
        expected_signals = {"hr", "spo2", "rr"}
    missing = [s for s in expected_signals if s not in numeric]

    values: Dict[str, float] = {
        "severity_score": {"low": 0.1, "medium": 0.45, "high": 0.8, "critical": 1.0}[req.severity],
        "signal_quality_score": {"low": 0.2, "medium": 0.55, "high": 0.95}[req.signal_quality],
        "spo2": numeric.get("spo2", 97.0),
        "hr": numeric.get("hr", 80.0),
        "rr": numeric.get("rr", 16.0),
        "drop_duration_s": float(req.context.get("drop_duration_s", 0.0)),
        "alarm_spo2_drop": 1.0 if normalized_alarm == "spo2_drop" else 0.0,
        "alarm_tachycardia": 1.0 if normalized_alarm == "tachycardia" else 0.0,
        "alarm_arrhythmia": 1.0 if normalized_alarm in {"arrhythmia", "vfib", "vtach", "asystole"} else 0.0,
        "alarm_bradycardia": 1.0 if normalized_alarm == "bradycardia" else 0.0,
        "alarm_respiratory_concern": 1.0 if normalized_alarm == "respiratory_concern" else 0.0,
        "missing_numeric_fraction": float(len(missing) / max(len(expected_signals), 1)),
        **wf,
    }

    ordered = np.asarray([[values[name] for name in FEATURE_ORDER]], dtype=np.float32)
    return FeatureBundle(ordered=ordered, named=values, names=FEATURE_ORDER)


class ActionabilityModel:
    """Deterministic sklearn Gradient Boosted Tree mock.

    For MVP we train on deterministic synthetic data at service startup.
    This preserves repeatability while using the exact estimator class that
    production can later replace with a persisted artifact.
    """

    def __init__(self) -> None:
        self.model = GradientBoostingClassifier(
            n_estimators=80,
            learning_rate=0.08,
            max_depth=3,
            random_state=7,
            subsample=0.9,
        )
        self._fit_synthetic()

    def _fit_synthetic(self) -> None:
        rng = np.random.default_rng(42)
        n = 7000
        x = np.zeros((n, len(FEATURE_ORDER)), dtype=np.float32)

        x[:, 0] = rng.uniform(0.1, 1.0, n)  # severity_score
        x[:, 1] = rng.uniform(0.2, 0.95, n)  # signal_quality_score
        x[:, 2] = rng.uniform(80, 100, n)  # spo2
        x[:, 3] = rng.uniform(45, 160, n)  # hr
        x[:, 4] = rng.uniform(8, 30, n)  # rr
        x[:, 5] = rng.uniform(0, 120, n)  # drop_duration_s
        x[:, 6] = rng.integers(0, 3, n)  # wf_count
        x[:, 7] = rng.uniform(0.0, 1.5, n)  # wf_energy
        x[:, 8] = rng.uniform(0.0, 0.45, n)  # wf_std
        x[:, 9] = rng.uniform(0.0, 2.0, n)  # wf_ptp
        x[:, 10] = rng.binomial(1, 0.28, n)  # alarm_spo2_drop
        x[:, 11] = rng.binomial(1, 0.34, n)  # alarm_tachycardia
        x[:, 12] = rng.binomial(1, 0.18, n)  # alarm_arrhythmia
        x[:, 13] = rng.binomial(1, 0.12, n)  # alarm_bradycardia
        x[:, 14] = rng.binomial(1, 0.16, n)  # alarm_respiratory_concern
        x[:, 15] = rng.uniform(0, 1.0, n)  # missing_numeric_fraction

        score = (
            2.1 * x[:, 0]
            + 0.8 * x[:, 12]
            + 0.6 * x[:, 11]
            + 1.0 * x[:, 13] * ((55 - x[:, 3]).clip(min=0) / 18)
            + 0.75 * x[:, 14] * (((x[:, 4] - 22).clip(min=0) / 10) + 0.5 * ((90 - x[:, 2]).clip(min=0) / 12))
            + 1.3 * (x[:, 10] * ((90 - x[:, 2]).clip(min=0) / 15))
            + 0.9 * (x[:, 5] / 60)
            + 0.5 * (x[:, 1] - 0.4)
            - 1.2 * x[:, 15]
            + 0.25 * (x[:, 8] > 0.08)
            - 0.18 * (x[:, 3] < 55)
        )
        p = 1 / (1 + np.exp(-(score - 2.0)))
        y = rng.binomial(1, p.clip(0.02, 0.98))

        self.model.fit(x, y)

    def predict(self, bundle: FeatureBundle) -> tuple[float, float, Dict[str, float]]:
        probs = self.model.predict_proba(bundle.ordered)[0]
        p_actionable = float(probs[1])

        if hasattr(self.model, "feature_importances_"):
            importances = self.model.feature_importances_
            contributions = {
                name: float(importances[idx] * bundle.ordered[0, idx])
                for idx, name in enumerate(bundle.names)
            }
        else:
            contributions = {name: 0.0 for name in bundle.names}

        boundary_uncertainty = 1.0 - abs(p_actionable - 0.5) * 2.0
        support_uncertainty = min(1.0, bundle.named["missing_numeric_fraction"] + (0.3 if bundle.named["wf_count"] == 0 else 0.0))
        uncertainty = float(np.clip(0.72 * boundary_uncertainty + 0.28 * support_uncertainty, 0.02, 0.99))

        return p_actionable, uncertainty, contributions


MODEL = ActionabilityModel()


@dataclass(frozen=True)
class PolicyResult:
    decision: Decision
    overrides: List[str]


def route_decision(req: InferenceRequest, p_actionable: float, uncertainty: float, features: Dict[str, float]) -> PolicyResult:
    """Neuro-symbolic safety router.

    Clinical intent:
    - ML ranks probability of actionability.
    - Symbolic rules enforce never-events and safety-critical guardrails.

    Rule Layer 1 (Hard no-suppress rules):
    1) Never suppress sustained SpO2 drops if waveform/signal quality is high.
       Rationale: sustained desaturation can indicate hypoxemia and delayed intervention can be harmful.
    2) Never suppress lethal rhythm signatures (vfib/vtach/asystole).
    3) Never suppress critical-severity alarms with high-quality signals.

    Rule Layer 2 (Conservative uncertainty policy):
    4) If uncertainty is high, route to clinician instead of suppressing.

    Rule Layer 3 (Model-driven policy):
    - High probability => escalate to clinician/rapid response depending on severity.
    - Low probability + low uncertainty + lower severity => suppress.
    """

    overrides: List[str] = []
    alarm_type = req.alarm_type.lower()
    quality_high = req.signal_quality == "high"

    drop_duration_s = float(features.get("drop_duration_s", 0.0))
    spo2 = float(features.get("spo2", 100.0))
    hr = float(features.get("hr", 80.0))
    rr = float(features.get("rr", 16.0))

    if alarm_type == "spo2_drop" and quality_high and drop_duration_s >= 15 and spo2 < 90:
        overrides.append("hard_rule:sustained_spo2_drop_high_quality")
        return PolicyResult(decision="route_clinician", overrides=overrides)

    if alarm_type == "bradycardia" and quality_high and hr < 42:
        overrides.append("hard_rule:profound_bradycardia_never_suppress")
        return PolicyResult(decision="route_clinician", overrides=overrides)

    if alarm_type == "respiratory_concern" and quality_high and (rr > 32 or rr < 8 or spo2 < 90):
        overrides.append("hard_rule:respiratory_instability_never_suppress")
        return PolicyResult(decision="route_clinician", overrides=overrides)

    if alarm_type in {"vfib", "vtach", "asystole"}:
        overrides.append("hard_rule:lethal_rhythm_never_suppress")
        return PolicyResult(decision="route_rapid_response", overrides=overrides)

    if req.severity == "critical" and quality_high:
        overrides.append("hard_rule:critical_high_quality_never_suppress")
        return PolicyResult(decision="route_rapid_response", overrides=overrides)

    if uncertainty >= 0.45:
        overrides.append("soft_rule:high_uncertainty_route_clinician")
        return PolicyResult(decision="route_clinician", overrides=overrides)

    if p_actionable >= 0.82:
        if req.severity in {"high", "critical"}:
            return PolicyResult(decision="route_rapid_response", overrides=overrides)
        return PolicyResult(decision="route_clinician", overrides=overrides)

    if p_actionable <= 0.22 and uncertainty <= 0.22 and req.severity in {"low", "medium"}:
        return PolicyResult(decision="suppress", overrides=overrides)

    return PolicyResult(decision="route_clinician", overrides=overrides)


def _top_factors(contributions: Dict[str, float], features: Dict[str, float]) -> List[Dict[str, float | str]]:
    ranked = sorted(contributions.items(), key=lambda kv: abs(kv[1]), reverse=True)[:6]
    return [
        {
            "feature": name,
            "contribution": round(value, 6),
            "feature_value": round(float(features.get(name, 0.0)), 6),
        }
        for name, value in ranked
    ]


def _run_inference(req: InferenceRequest) -> InferenceResponse:
    bundle = extract_features(req)
    p_actionable, uncertainty, contributions = MODEL.predict(bundle)
    routed = route_decision(req, p_actionable, uncertainty, bundle.named)

    alarm_id = req.alarm_id or f"alarm-{abs(hash((req.patient_id, req.device_id, req.observed_at.isoformat()))) % 1_000_000_000:09d}"

    explanation_json: Dict[str, Any] = {
        "top_factors": _top_factors(contributions, bundle.named),
        "policy_overrides": routed.overrides,
        "signal_quality": req.signal_quality,
        "alarm_type": req.alarm_type,
        "severity": req.severity,
        "features": {k: round(float(v), 6) for k, v in bundle.named.items()},
        "provenance_hint": "feature-level explanation only; no direct identifiers",
    }

    return InferenceResponse(
        alarm_id=alarm_id,
        patient_id=req.patient_id,
        model_version_id=req.model_version_id,
        p_actionable=round(p_actionable, 4),
        uncertainty=round(uncertainty, 4),
        decision=routed.decision,
        explanation_json=explanation_json,
    )


_FED_BASE = datetime(2026, 3, 5, 13, 0, tzinfo=timezone.utc)
PRECOMPUTED_ROUNDS: List[FederatedRound] = [
    FederatedRound(
        id="f0000000-0000-0000-0000-000000000001",
        started_at=_FED_BASE,
        ended_at=_FED_BASE + timedelta(minutes=34),
        participants_json=[
            {"site": "Starlight Medical Center", "examples": 10234, "false_alarm_rate": 0.61},
            {"site": "Bayline General", "examples": 8000, "false_alarm_rate": 0.58},
        ],
        agg_metrics_json={
            "round": 1,
            "auroc": 0.8099,
            "auprc": 0.7278,
            "brier": 0.1309,
            "global_false_alarm_rate": 0.5968,
            "privacy_budget_eps": 1.21,
            "secure_agg_checksum": "pm-r1-sha256:00328112",
        },
    ),
    FederatedRound(
        id="f0000000-0000-0000-0000-000000000002",
        started_at=_FED_BASE + timedelta(hours=24),
        ended_at=_FED_BASE + timedelta(hours=24, minutes=36),
        participants_json=[
            {"site": "Starlight Medical Center", "examples": 13612, "false_alarm_rate": 0.51},
            {"site": "Bayline General", "examples": 10507, "false_alarm_rate": 0.49},
        ],
        agg_metrics_json={
            "round": 2,
            "auroc": 0.8553,
            "auprc": 0.745,
            "brier": 0.1259,
            "global_false_alarm_rate": 0.5013,
            "privacy_budget_eps": 1.27,
            "secure_agg_checksum": "pm-r2-sha256:00458499",
        },
    ),
]


def replay_round(round_id: str) -> List[FederatedReplayEvent]:
    selected = next((r for r in PRECOMPUTED_ROUNDS if r.id == round_id), None)
    if not selected:
        raise KeyError(round_id)

    t0 = selected.started_at
    return [
        FederatedReplayEvent(
            round_id=round_id,
            stage="round_started",
            at=t0,
            payload={"participants": selected.participants_json},
        ),
        FederatedReplayEvent(
            round_id=round_id,
            stage="local_training",
            at=t0 + timedelta(minutes=8),
            payload={
                "site_updates": [
                    {"site": p["site"], "delta_norm": round(0.11 + i * 0.035, 4)}
                    for i, p in enumerate(selected.participants_json)
                ]
            },
        ),
        FederatedReplayEvent(
            round_id=round_id,
            stage="secure_aggregation",
            at=t0 + timedelta(minutes=18),
            payload={"checksum": selected.agg_metrics_json["secure_agg_checksum"]},
        ),
        FederatedReplayEvent(
            round_id=round_id,
            stage="global_eval",
            at=t0 + timedelta(minutes=29),
            payload=selected.agg_metrics_json,
        ),
        FederatedReplayEvent(
            round_id=round_id,
            stage="round_committed",
            at=selected.ended_at,
            payload={"status": "committed"},
        ),
    ]


app = FastAPI(
    title="PulseMesh Inference Engine",
    version="0.1.0",
    description=(
        "Alarm actionability prediction with gradient-boosted inference and "
        "neuro-symbolic clinical policy overrides."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "service": "inference"}


@app.post("/inference", response_model=InferenceResponse)
def infer(req: InferenceRequest) -> InferenceResponse:
    return _run_inference(req)


@app.post("/inference/batch", response_model=List[InferenceResponse])
def infer_batch(req: BatchInferenceRequest) -> List[InferenceResponse]:
    if len(req.items) > 512:
        raise HTTPException(status_code=400, detail="batch too large")
    return [_run_inference(item) for item in req.items]


@app.get("/federated/rounds", response_model=List[FederatedRound])
def federated_rounds() -> List[FederatedRound]:
    return PRECOMPUTED_ROUNDS


@app.get("/federated/rounds/{round_id}/replay", response_model=List[FederatedReplayEvent])
def federated_replay(round_id: str) -> List[FederatedReplayEvent]:
    try:
        return replay_round(round_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"round {round_id} not found") from exc


@app.get("/federated/replay-all")
def federated_replay_all() -> Dict[str, List[FederatedReplayEvent]]:
    return {r.id: replay_round(r.id) for r in PRECOMPUTED_ROUNDS}
