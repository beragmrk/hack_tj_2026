.PHONY: up down logs migrate gateway inference proof web

up:
	docker compose up --build

down:
	docker compose down -v

logs:
	docker compose logs -f --tail=200

migrate:
	bash scripts/run-migrations.sh

gateway:
	cd services/gateway-rust && cargo run

inference:
	cd services/inference-python && uvicorn app.main:app --reload --port 8000

proof:
	cd services/proof-service-node && npm run dev

web:
	cd apps/web && npm run dev
