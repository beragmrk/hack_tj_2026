from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.federated import router as federated_router
from app.routes.inference import router as inference_router

app = FastAPI(
    title="PulseMesh Inference Engine",
    version="0.1.0",
    description=(
        "Actionability prediction service for ICU alarms with neuro-symbolic safety routing "
        "and deterministic federated-round replay."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "inference"}


app.include_router(inference_router)
app.include_router(federated_router)
