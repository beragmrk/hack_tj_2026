"""Federated training replay service.

The MVP includes two precomputed rounds that can be replayed for deterministic demo output.
Each replay emits a stage-by-stage narrative suitable for timeline visualizations.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, List

from app.models.schemas import FederatedReplayEvent, FederatedRound


_BASE = datetime(2026, 3, 5, 9, 0, tzinfo=timezone.utc)

PRECOMPUTED_ROUNDS: List[FederatedRound] = [
    FederatedRound(
        id="f0000000-0000-0000-0000-000000000001",
        started_at=_BASE,
        ended_at=_BASE + timedelta(minutes=34),
        participants_json=[
            {"site": "Starlight Medical Center", "examples": 10234},
            {"site": "Bayline General", "examples": 8000},
        ],
        agg_metrics_json={
            "round": 1,
            "auroc": 0.842,
            "auprc": 0.621,
            "brier": 0.152,
            "privacy_budget_eps": 1.25,
            "global_checksum": "r1:a91cbf9982",
        },
    ),
    FederatedRound(
        id="f0000000-0000-0000-0000-000000000002",
        started_at=_BASE + timedelta(hours=24),
        ended_at=_BASE + timedelta(hours=24, minutes=36),
        participants_json=[
            {"site": "Starlight Medical Center", "examples": 13612},
            {"site": "Bayline General", "examples": 10507},
        ],
        agg_metrics_json={
            "round": 2,
            "auroc": 0.871,
            "auprc": 0.664,
            "brier": 0.131,
            "privacy_budget_eps": 1.31,
            "global_checksum": "r2:bf0d2ca4c4",
        },
    ),
]


def get_rounds() -> List[FederatedRound]:
    return PRECOMPUTED_ROUNDS


def replay_round(round_id: str) -> List[FederatedReplayEvent]:
    selected = next((r for r in PRECOMPUTED_ROUNDS if r.id == round_id), None)
    if not selected:
        raise KeyError(f"round {round_id} not found")

    t0 = selected.started_at
    events = [
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
                    {"site": p["site"], "delta_norm": round(0.14 + i * 0.03, 3)}
                    for i, p in enumerate(selected.participants_json)
                ]
            },
        ),
        FederatedReplayEvent(
            round_id=round_id,
            stage="secure_aggregation",
            at=t0 + timedelta(minutes=18),
            payload={"checksum": selected.agg_metrics_json["global_checksum"]},
        ),
        FederatedReplayEvent(
            round_id=round_id,
            stage="global_eval",
            at=t0 + timedelta(minutes=28),
            payload=selected.agg_metrics_json,
        ),
        FederatedReplayEvent(
            round_id=round_id,
            stage="round_committed",
            at=selected.ended_at,
            payload={"status": "committed"},
        ),
    ]
    return events


def replay_all_rounds() -> Dict[str, List[FederatedReplayEvent]]:
    return {round_.id: replay_round(round_.id) for round_ in PRECOMPUTED_ROUNDS}
