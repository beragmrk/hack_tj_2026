"""Feature extraction for alarm actionability modeling.

The design intentionally keeps all feature extraction deterministic and side-effect free.
In production, this stage would run inside a secure enclave and stream directly from
windowed waveform storage. For MVP, we compute compact summary statistics over the
provided waveform windows and numeric snapshots.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Set, Tuple

import numpy as np

from app.models.schemas import InferenceRequest, WaveformWindow


@dataclass(frozen=True)
class FeatureBundle:
    values: Dict[str, float]
    provenance: Dict[str, Any]


def _waveform_stats(window: WaveformWindow) -> Dict[str, float]:
    arr = np.asarray(window.samples, dtype=np.float32)
    if arr.size == 0:
        return {
            "mean": 0.0,
            "std": 0.0,
            "min": 0.0,
            "max": 0.0,
            "ptp": 0.0,
            "energy": 0.0,
            "slope_abs_mean": 0.0,
        }

    diffs = np.diff(arr) if arr.size > 1 else np.array([0.0], dtype=np.float32)
    return {
        "mean": float(arr.mean()),
        "std": float(arr.std()),
        "min": float(arr.min()),
        "max": float(arr.max()),
        "ptp": float(np.ptp(arr)),
        "energy": float(np.mean(arr * arr)),
        "slope_abs_mean": float(np.mean(np.abs(diffs))),
    }


def _aggregate_waveforms(waveforms: List[WaveformWindow]) -> Tuple[Dict[str, float], Dict[str, Any]]:
    if not waveforms:
        return {
            "wf_count": 0.0,
            "wf_quality_hint": 0.0,
        }, {"waveforms": []}

    feature_map: Dict[str, float] = {"wf_count": float(len(waveforms))}
    provenance: Dict[str, Any] = {"waveforms": []}

    for wf in waveforms:
        stats = _waveform_stats(wf)
        prefix = wf.signal_type.lower()
        feature_map[f"{prefix}_mean"] = stats["mean"]
        feature_map[f"{prefix}_std"] = stats["std"]
        feature_map[f"{prefix}_ptp"] = stats["ptp"]
        feature_map[f"{prefix}_energy"] = stats["energy"]
        feature_map[f"{prefix}_slope_abs_mean"] = stats["slope_abs_mean"]
        provenance["waveforms"].append(
            {
                "signal_type": wf.signal_type,
                "sample_hz": wf.sample_hz,
                "summary": stats,
            }
        )

    # Compact quality hint: stronger waveforms tend to have meaningful variance.
    std_values = [v for k, v in feature_map.items() if k.endswith("_std")]
    feature_map["wf_quality_hint"] = float(np.mean(std_values) if std_values else 0.0)
    return feature_map, provenance


def _expected_numeric_signals(alarm_type: str, waveforms: List[WaveformWindow]) -> Set[str]:
    alarm = alarm_type.lower()
    waveform_types = {wf.signal_type.lower() for wf in waveforms}

    if alarm in {"ecg_annotation_event", "arrhythmia", "vfib", "vtach"}:
        expected = {"hr"}
    elif alarm == "tachycardia":
        expected = {"hr"}
    elif alarm == "spo2_drop":
        expected = {"spo2", "hr"}
    else:
        expected = {"hr", "spo2"}

    # Add expected numerics when supporting waveform modalities are present.
    if "resp" in waveform_types:
        expected.add("rr")
    if "abp" in waveform_types or "arterial" in waveform_types:
        expected.add("map")
    if "ppg" in waveform_types:
        expected.add("spo2")

    return expected


def extract_features(req: InferenceRequest) -> FeatureBundle:
    numeric = {k.lower(): float(v) for k, v in req.numeric_snapshot.items()}
    waveform_features, waveform_provenance = _aggregate_waveforms(req.waveforms)
    alarm_type = req.alarm_type.lower()
    expected_numeric_signals = _expected_numeric_signals(req.alarm_type, req.waveforms)
    missing_expected_signals = sorted(s for s in expected_numeric_signals if s not in numeric)
    expected_count = len(expected_numeric_signals)
    missing_numeric_fraction = (
        float(len(missing_expected_signals) / expected_count) if expected_count > 0 else 0.0
    )
    expected_numeric_coverage = 1.0 - missing_numeric_fraction

    severity_map = {"low": 0.1, "medium": 0.4, "high": 0.75, "critical": 1.0}
    quality_map = {"low": 0.15, "medium": 0.55, "high": 0.95}

    values: Dict[str, float] = {
        "severity_score": severity_map[req.severity],
        "signal_quality_score": quality_map[req.signal_quality],
        "spo2": numeric.get("spo2", 97.0),
        "hr": numeric.get("hr", 80.0),
        "rr": numeric.get("rr", 16.0),
        "map": numeric.get("map", 75.0),
        "drop_duration_s": float(req.context.get("drop_duration_s", 0.0)),
        "alarm_spo2_drop": 1.0 if alarm_type == "spo2_drop" else 0.0,
        "alarm_tachycardia": 1.0 if alarm_type == "tachycardia" else 0.0,
        "alarm_arrhythmia": 1.0 if alarm_type in {"arrhythmia", "vfib", "vtach"} else 0.0,
        "alarm_ecg_annotation": 1.0 if alarm_type == "ecg_annotation_event" else 0.0,
        "alarm_ecg_rhythm": 1.0 if alarm_type in {"ecg_annotation_event", "arrhythmia", "vfib", "vtach"} else 0.0,
        "missing_numeric_fraction": missing_numeric_fraction,
        "expected_numeric_count": float(expected_count),
        "provided_expected_numeric_count": float(expected_count - len(missing_expected_signals)),
        "expected_numeric_coverage": expected_numeric_coverage,
    }
    values.update(waveform_features)

    provenance = {
        "numeric_snapshot": numeric,
        "derived": {
            "severity_score": values["severity_score"],
            "signal_quality_score": values["signal_quality_score"],
            "drop_duration_s": values["drop_duration_s"],
            "missing_numeric_fraction": values["missing_numeric_fraction"],
            "expected_numeric_signals": sorted(expected_numeric_signals),
            "missing_expected_numeric_signals": missing_expected_signals,
            "expected_numeric_coverage": expected_numeric_coverage,
        },
        **waveform_provenance,
    }

    return FeatureBundle(values=values, provenance=provenance)
