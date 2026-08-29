.PHONY: help up down logs dev-services migrate check backend-check frontend-check clean

help:
	@grep -E '^[a-zA-Z-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

up: ## Build and start the whole stack
	docker compose up -d --build

down: ## Stop the stack
	docker compose down

logs: ## Follow the backend logs
	docker compose logs -f backend

dev-services: ## Start only Postgres and MinIO, exposed to the host
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres minio

migrate: ## Apply migrations against the dev database
	cd backend && .venv/bin/alembic upgrade head

backend-check: ## Lint, type check and test the backend
	cd backend && .venv/bin/ruff check . && .venv/bin/ruff format --check . \
		&& .venv/bin/mypy app && .venv/bin/pytest

frontend-check: ## Lint, type check and test the frontend
	cd frontend && npm run lint && npm run typecheck && npm test

check: backend-check frontend-check ## Run every check

clean: ## Stop the stack and delete its data volumes
	docker compose down -v
