from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models.schemas import FederatedReplayEvent, FederatedRound
from app.services.federated import get_rounds, replay_all_rounds, replay_round

router = APIRouter(prefix="/federated", tags=["federated"])


@router.get("/rounds", response_model=list[FederatedRound])
def rounds() -> list[FederatedRound]:
    return get_rounds()


@router.get("/rounds/{round_id}/replay", response_model=list[FederatedReplayEvent])
def replay(round_id: str) -> list[FederatedReplayEvent]:
    try:
        return replay_round(round_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/replay-all")
def replay_all() -> dict[str, list[FederatedReplayEvent]]:
    return replay_all_rounds()
