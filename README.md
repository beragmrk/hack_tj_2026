# PulseMesh MVP

PulseMesh is an "Invisible Infrastructure" platform that transforms ICU physiologic data into a real-time, privacy-preserving alarm intelligence mesh.

This monorepo provides an MVP implementation with:

- `apps/web`: Next.js App Router UI (Tailwind + shadcn-style primitives + Zustand + TanStack Query + React Three Fiber).
- `services/gateway-rust`: Rust Axum event gateway with high-frequency telemetry simulation and WebSocket fan-out.
- `services/inference-python`: FastAPI inference engine for feature extraction, actionability scoring, neuro-symbolic policy routing, and federated-round replay.
- `services/proof-service-node`: Node.js proof service that commits feature vectors and produces verifiable proofs without exposing raw features.
- `infra/db/migrations`: PostgreSQL + TimescaleDB + pgvector schema and indexes.

## Architecture Summary

1. Telemetry enters gateway (`/ingest`, `/ingest/ws`) and is rebroadcast over `/ws`.
2. Frontend subscribes to `/ws` for real-time ICU graph updates.
3. Inference service consumes alarm + waveform feature snapshots, computes `p_actionable`, applies safety router, and emits decision metadata.
4. Proof service computes deterministic commitment/proof artifacts for audit verification.
5. Data is stored in Timescale hypertables and relational audit tables.

## Quick Start (Docker)

```bash
cp .env.example .env
docker compose up --build
```

Endpoints:

- Web UI: `http://localhost:3000`
- Rust Gateway: `http://localhost:8080`
- Python Inference: `http://localhost:8000/docs`
- Node Proof Service: `http://localhost:7000/health`
- PostgreSQL: `localhost:5432`

## Local Dev (without Docker)

### Database migrations

```bash
bash scripts/run-migrations.sh
```

### Frontend

```bash
cd apps/web
npm install
npm run dev
```

### Rust gateway

```bash
cd services/gateway-rust
cargo run
```

### Python inference

```bash
cd services/inference-python
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Proof service

```bash
cd services/proof-service-node
npm install
npm run dev
```

## Notes

- Clinical policy rules are conservative by design and documented inline in `services/inference-python/app/services/policy_router.py`.
- Proof service currently implements a deterministic commitment/proof stub suitable for integration testing and audit flow demos.
- The schema includes Timescale hypertable conversion for `numeric_obs` and pgvector extension enablement.
