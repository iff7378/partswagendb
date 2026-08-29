# PartsWagen

Inventory and management for a small used auto parts operation. Built for the
workflow of buying a donor car, tearing it down, photographing and shelving each
component, then selling parts and squaring up the money between partners.

## What it does

**Inventory** — every part gets a SKU, photos, a condition grade, a category, an
asking price and a shelf. Drafts are first-class: save a part with just a photo
during teardown and finish the details later from the "needs details" queue.

**Part number OCR** — photograph a part-number sticker and the number is read off
it in the background, then offered as a one-tap suggestion. Tolerates the usual
Tesseract confusions (a stamped `0` read as the letter `O`).

**Donor cars** — enter a VIN and the year, make, model, trim and engine are
filled in from the free [NHTSA vPIC](https://vpic.nhtsa.dot.gov/api/) API. Each
car tracks what was spent on it against what its parts brought in.

**Storage** — a shallow tree of sites, shelves, bays and bins. Everything gets a
QR code, and label sheets print to an Avery 5160 grid. Scan a shelf to see what
is on it, or scan a part to jump straight to it.

**Sales** — record what sold, to whom, through which channel, and for how much,
net of fees. Selling a part marks it sold; voiding a sale puts it back in stock.

**Settle up** — the part that makes a two-person operation work. Every expense
records who paid it and every sale records who collected the cash. Ask for a
period and you get the split:

```
net_holding[partner] = collected − paid_out
entitled[partner]    = share × profit
difference           = net_holding − entitled
```

Whoever is holding more than their share pays whoever is holding less. The
report lists the transfers that zero everyone out, and recording a settlement
closes the period so the next one starts clean.

## Running it

Requires Docker and Docker Compose.

```bash
cp .env.example .env
# Generate a real secret and set the passwords:
sed -i "s|^SECRET_KEY=.*|SECRET_KEY=$(openssl rand -hex 32)|" .env
$EDITOR .env          # set POSTGRES_PASSWORD, S3_SECRET_KEY, FIRST_ADMIN_*

docker compose up -d
```

The app is on <http://localhost:8080>. Sign in with `FIRST_ADMIN_EMAIL` and
`FIRST_ADMIN_PASSWORD` — that account is created on first boot, when the
database is empty, and seeded as a 100% partner. Change the password
immediately, then add your partner under Users and set both shares to 50%.

Migrations run automatically on backend start. API docs are at `/api/docs`.

### Behind a reverse proxy

Set these in `.env` to the address people will actually visit:

```
S3_PUBLIC_ENDPOINT_URL=https://parts.example.com:9000
CORS_ORIGINS=https://parts.example.com
```

`S3_PUBLIC_ENDPOINT_URL` must be reachable from the browser: photo links are
presigned against it, and the signature covers the hostname, so it cannot be
rewritten after the fact.

Put TLS in front of the stack. The camera scanner needs a secure context —
browsers only grant camera access over HTTPS or on `localhost`.

## Developing

Backing services in Docker, app processes on the host:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres minio

cd backend
python -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload

cd ../frontend
npm install
npm run dev          # proxies /api to the backend
```

OCR needs Tesseract locally (`apt install tesseract-ocr`), or set
`OCR_ENABLED=false` and let the container handle it.

### Checks

```bash
cd backend  && .venv/bin/ruff check . && .venv/bin/mypy app && .venv/bin/pytest
cd frontend && npm run lint && npm run typecheck && npm test
```

The backend suite runs against SQLite, so it needs no database. CI additionally
applies the migrations to a real Postgres and fails if the models have drifted
from them.

After changing a model:

```bash
cd backend && .venv/bin/alembic revision --autogenerate -m "what changed"
```

## Layout

```
backend/          FastAPI + SQLAlchemy + Alembic
  app/models/     Database tables
  app/api/        HTTP routes
  app/services/   Ledger maths, OCR, VIN decoding, storage, QR labels
frontend/         React + TypeScript + Vite + Tailwind
.github/          Tests, image publishing, dependency and image scanning
```

## Deploying

CI publishes multi-arch images to GHCR on every push to `main`:

```
ghcr.io/<owner>/partswagendb-backend
ghcr.io/<owner>/partswagendb-frontend
```

Point a compose file at those tags instead of the `build:` stanzas to run
without a toolchain on the host.

Back up the `postgres-data` and `minio-data` volumes together — the database
holds the records and MinIO holds the photos they reference.
