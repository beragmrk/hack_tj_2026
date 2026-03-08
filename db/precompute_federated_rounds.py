#!/usr/bin/env python3
"""Precompute deterministic federated rounds and upsert into PulseMesh database."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import psycopg


@dataclass(frozen=True)
class SiteSnapshot:
    site: str
    examples: int
    false_alarm_rate: float
    local_auroc: float


@dataclass(frozen=True)
class FederatedRound:
    id: str
    started_at: datetime
    ended_at: datetime
    participants_json: list[dict[str, Any]]
    agg_metrics_json: dict[str, Any]


def _aggregate_metrics(round_idx: int, sites: list[SiteSnapshot]) -> dict[str, Any]:
    total_examples = sum(s.examples for s in sites)
    weighted_auroc = sum(s.local_auroc * s.examples for s in sites) / total_examples
    weighted_far = sum(s.false_alarm_rate * s.examples for s in sites) / total_examples

    auprc = 0.42 + 0.38 * weighted_auroc
    brier = max(0.05, 0.22 - 0.11 * weighted_auroc)

    return {
        "round": round_idx,
        "sites": len(sites),
        "examples": total_examples,
        "auroc": round(weighted_auroc, 4),
        "auprc": round(auprc, 4),
        "brier": round(brier, 4),
        "global_false_alarm_rate": round(weighted_far, 4),
        "privacy_budget_eps": round(1.15 + round_idx * 0.06, 3),
        "secure_agg_checksum": f"pm-r{round_idx}-sha256:{(total_examples * (round_idx + 17)) % 10**8:08d}",
    }


def build_rounds() -> list[FederatedRound]:
    base = datetime(2026, 3, 5, 13, 0, tzinfo=timezone.utc)

    r1_sites = [
        SiteSnapshot("Starlight Medical Center", 10234, 0.61, 0.816),
        SiteSnapshot("Bayline General", 8000, 0.58, 0.802),
    ]
    r2_sites = [
        SiteSnapshot("Starlight Medical Center", 13612, 0.51, 0.861),
        SiteSnapshot("Bayline General", 10507, 0.49, 0.848),
    ]

    round_1 = FederatedRound(
        id="f0000000-0000-0000-0000-000000000001",
        started_at=base,
        ended_at=base + timedelta(minutes=34),
        participants_json=[s.__dict__ for s in r1_sites],
        agg_metrics_json=_aggregate_metrics(1, r1_sites),
    )
    round_2 = FederatedRound(
        id="f0000000-0000-0000-0000-000000000002",
        started_at=base + timedelta(hours=24),
        ended_at=base + timedelta(hours=24, minutes=36),
        participants_json=[s.__dict__ for s in r2_sites],
        agg_metrics_json=_aggregate_metrics(2, r2_sites),
    )

    return [round_1, round_2]


def upsert_rounds(conn: psycopg.Connection, rounds: list[FederatedRound]) -> None:
    sql = """
    INSERT INTO federated_round (id, started_at, ended_at, participants_json, agg_metrics_json)
    VALUES (%(id)s, %(started_at)s, %(ended_at)s, %(participants_json)s::jsonb, %(agg_metrics_json)s::jsonb)
    ON CONFLICT (id)
    DO UPDATE SET
      started_at = EXCLUDED.started_at,
      ended_at = EXCLUDED.ended_at,
      participants_json = EXCLUDED.participants_json,
      agg_metrics_json = EXCLUDED.agg_metrics_json;
    """

    with conn.cursor() as cur:
        for r in rounds:
            cur.execute(
                sql,
                {
                    "id": r.id,
                    "started_at": r.started_at,
                    "ended_at": r.ended_at,
                    "participants_json": json.dumps(r.participants_json),
                    "agg_metrics_json": json.dumps(r.agg_metrics_json),
                },
            )
    conn.commit()


def main() -> None:
    dsn = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/pulsemesh")
    rounds = build_rounds()

    with psycopg.connect(dsn) as conn:
        upsert_rounds(conn, rounds)

    print(f"Upserted {len(rounds)} federated rounds into federated_round")


if __name__ == "__main__":
    main()
