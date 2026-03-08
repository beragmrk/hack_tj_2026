"""Deterministic gradient-boosted-style model for MVP inference.

This module intentionally avoids external model loading to keep startup deterministic.
The scoring function mimics a compact boosted-tree ensemble:
- Each stump contributes a signed increment based on a threshold test.
- Final score is transformed via sigmoid to produce probability.

In production, replace with a serialized calibrated GBT artifact (e.g., XGBoost/LightGBM).
"""

from __future__ import annotations

from dataclasses import dataclass
from math import exp
from typing import Dict, List, Tuple


@dataclass(frozen=True)
class Stump:
    feature: str
    threshold: float
    left_value: float
    right_value: float

    def eval(self, features: Dict[str, float]) -> float:
        value = features.get(self.feature, 0.0)
        return self.left_value if value <= self.threshold else self.right_value


class TinyGBTModel:
    def __init__(self) -> None:
        self.bias = -0.35
        self.learning_rate = 0.55
        self.trees: List[Stump] = [
            Stump("severity_score", 0.6, -0.08, 0.36),
            Stump("signal_quality_score", 0.5, 0.2, -0.05),
            Stump("spo2", 92.5, 0.35, -0.12),
            Stump("hr", 125.0, -0.07, 0.26),
            Stump("drop_duration_s", 18.0, -0.03, 0.34),
            Stump("alarm_arrhythmia", 0.5, 0.0, 0.42),
            Stump("alarm_tachycardia", 0.5, 0.0, 0.18),
            Stump("missing_numeric_fraction", 0.5, -0.02, 0.19),
            Stump("wf_quality_hint", 0.06, 0.09, -0.11),
            Stump("ppg_ptp", 0.5, 0.16, -0.08),
            Stump("ecg_std", 0.12, 0.14, -0.04),
        ]

    @staticmethod
    def _sigmoid(x: float) -> float:
        if x >= 0:
            z = exp(-x)
            return 1.0 / (1.0 + z)
        z = exp(x)
        return z / (1.0 + z)

    def predict(self, features: Dict[str, float]) -> Tuple[float, float, Dict[str, float]]:
        contributions: Dict[str, float] = {}
        logit = self.bias

        for tree in self.trees:
            value = tree.eval(features) * self.learning_rate
            contributions[tree.feature] = contributions.get(tree.feature, 0.0) + value
            logit += value

        p = self._sigmoid(logit)

        # Lightweight uncertainty proxy:
        # - near decision boundary => uncertain
        # - high missingness / poor support => uncertain
        # For ECG-only rhythm alarms, missing non-ECG numerics should matter less.
        boundary_uncertainty = 1.0 - abs(p - 0.5) * 2.0
        ecg_rhythm_context = features.get("alarm_ecg_rhythm", 0.0) > 0.5
        missingness_uncertainty = min(1.0, features.get("missing_numeric_fraction", 0.0) * 1.2)
        expected_coverage = max(0.0, min(1.0, features.get("expected_numeric_coverage", 1.0)))
        waveform_support = min(1.0, features.get("wf_count", 0.0) / 2.0)
        quality_support = min(1.0, features.get("wf_quality_hint", 0.0) / 0.12)
        context_support = max(expected_coverage, 0.6 * waveform_support + 0.4 * quality_support)
        support_uncertainty = 1.0 - context_support

        missingness_weight = 0.12 if ecg_rhythm_context else 0.32
        support_weight = 0.32 - missingness_weight
        uncertainty = max(
            0.02,
            min(
                0.98,
                0.68 * boundary_uncertainty
                + missingness_weight * missingness_uncertainty
                + support_weight * support_uncertainty,
            ),
        )

        return p, uncertainty, contributions


MODEL = TinyGBTModel()
