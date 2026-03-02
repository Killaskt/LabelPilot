# TTB Label Review Assistant

A local-first prototype for reviewing TTB (Alcohol and Tobacco Tax and Trade Bureau) label submissions. Built with Next.js App Router, Prisma/SQLite, and a Python OCR worker — designed so every component can be swapped for Azure services with minimal refactoring.

---

## How it works

1. **Upload** — Submit application fields (brand name, class/type, ABV, net contents) and 1–10 label images.
2. **Queue** — Jobs are written to SQLite with `status=queued`. The queue page polls every 2 seconds.
3. **Worker** — A Python process polls the DB, claims jobs atomically, runs OCR + regex extraction, compares results against submitted values, and writes back `status=ready|needs_human|error`.
4. **Review** — A split-pane review page shows a field checklist (match/mismatch/needs-review) on the left and a zoomable image viewer with highlight rectangles on the right. Accept or Reject each field, then click **Finish Review**.
5. **History** — Recent jobs (last 24 hours). All jobs auto-expire; a cleanup script purges them.

---

## Quick Start

### Prerequisites
- Node.js ≥ 18
- Python ≥ 3.10
- **OCR backend** — either Tesseract (local) or Azure AI Vision credentials (see below)

### 1. Set up the web app

```bash
cd web
cp .env.example .env
npm install
npm run db:migrate       # creates web/prisma/dev.db and applies schema
npm run dev              # starts Next.js on http://localhost:3000
```

### 2. Set up the worker (second terminal)

```bash
cd worker
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env           # then edit .env with your OCR backend settings
python worker.py
```

### 3. Open the app

Navigate to http://localhost:3000/upload

---

## OCR Backends

The worker supports two OCR backends, switchable via `OCR_BACKEND` in `worker/.env`. Azure AI Vision is recommended for production — it handles multi-line text, decorative fonts, and low-contrast labels significantly better than Tesseract.

### Option A — Azure AI Vision (recommended)

1. In [Azure Portal](https://portal.azure.com) create a **Computer Vision** resource (F0 free tier: 5,000 calls/month, 20 calls/minute)
2. Go to **Keys and Endpoint** and copy Key 1 + the Endpoint URL
3. Set in `worker/.env`:

```env
OCR_BACKEND=azure
AZURE_VISION_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
AZURE_VISION_KEY=your-key-here
```

> **Production note:** When deployed to Azure Container Apps, replace `AZURE_VISION_KEY` with a Managed Identity — no secrets stored anywhere.

### Option B — Tesseract (local, offline)

1. Install the Tesseract binary: https://github.com/tesseract-ocr/tesseract
2. Set in `worker/.env`:

```env
OCR_BACKEND=tesseract
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe   # Windows example
```

If `TESSERACT_CMD` is not set, Tesseract must be on your system PATH. If neither backend is available the worker falls back to a stub that flags all fields for human review.

---

## Environment Variables

### web/.env

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `file:./prisma/dev.db` | Prisma SQLite connection string |
| `UPLOAD_DIR` | `../local_uploads` | Where uploaded files are stored |
| `MAX_FILE_SIZE_MB` | `10` | Per-file size limit |
| `MAX_FILES` | `10` | Max files per job |
| `RATE_LIMIT_MAX_REQUESTS` | `20` | Requests per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in ms |

### worker/.env

| Variable | Default | Description |
|---|---|---|
| `SQLITE_PATH` | `../web/prisma/dev.db` | Path to the SQLite file |
| `UPLOAD_BASE_DIR` | `../local_uploads` | Must match web's UPLOAD_DIR |
| `POLL_INTERVAL` | `1.0` | Seconds between DB polls |
| `LOG_LEVEL` | `INFO` | Python log level |
| `OCR_BACKEND` | `tesseract` | `tesseract` or `azure` |
| `TESSERACT_CMD` | _(unset)_ | Full path to tesseract binary (Windows) |
| `AZURE_VISION_ENDPOINT` | _(unset)_ | Azure AI Vision endpoint URL |
| `AZURE_VISION_KEY` | _(unset)_ | Azure AI Vision API key |
| `WORD_MATCH_THRESHOLD` | `0.75` | Fraction of words required for a word-level field match (0.5–1.0) |
| `MIN_OCR_WORD_CONF` | `0.0` | Minimum word confidence to include (0–1). Raise to filter OCR noise. |

---

## Running Tests

### Worker (Python)

```bash
cd worker
.venv/Scripts/activate          # Windows
# source .venv/bin/activate     # macOS/Linux
python -m pytest tests/ -v
```

Test coverage:

| File | What it covers |
|---|---|
| `test_extraction.py` | Regex patterns for ABV, volume, government warning |
| `test_mismatch.py` | Match / soft-mismatch / mismatch / not-found classification |
| `test_normalization.py` | Text normalization and punctuation stripping |
| `test_ttb_labels.py` | Multi-line OCR text → field extraction (simulated OCR strings) |
| `test_ocr_integration.py` | Full OCR pipeline against `test-picture/` images (skipped if backend unavailable) |

### Web (TypeScript)

```bash
cd web && npm test
```

---

## Benchmarking OCR Backends

Run `benchmark.py` to compare Tesseract vs Azure AI Vision side-by-side against a real label image. Outputs timing, word count, average confidence, extracted text, and per-field accuracy.

```bash
cd worker
.venv/Scripts/activate

# Compare both backends on a label image
python benchmark.py test-picture/ttblabelexample.jpg \
  --expected-brand "Old Tom Distillery" \
  --expected-class "Kentucky Straight Bourbon Whiskey" \
  --expected-abv "45% alc. by vol." \
  --expected-net "750 mL" \
  --backend both

# Run only one backend
python benchmark.py test-picture/ttblabelexample.jpg --backend azure
python benchmark.py test-picture/ttblabelexample.jpg --backend tesseract

# Output raw JSON (useful for scripting or logging results over time)
python benchmark.py test-picture/ttblabelexample.jpg --backend both --json
```

Place additional test images in `worker/test-picture/` — they are committed to the repo (generated/synthetic images only, not real brand labels). The OCR integration tests also pick them up automatically.

---

## Project Structure

```
labelPilot/
  web/                    Next.js app (App Router + TypeScript + Prisma)
    prisma/               Schema + migrations + SQLite DB file
    src/
      app/                Pages + API route handlers
      lib/                Shared utilities (session, rate limit, storage adapter)
      types/              Shared TypeScript types
    __tests__/            Unit tests
  worker/                 Python polling worker
    ocr.py                OCR backend router (tesseract / azure / stub)
    ocr_azure.py          Azure AI Vision backend
    ocr_protocol.py       OcrResult TypedDict — contract all backends must satisfy
    extraction.py         4-tier field extractor (exact → soft → word → OCR-corrected)
    comparison.py         Multi-level comparison logic
    benchmark.py          CLI tool to compare backends against a label image
    tests/                Worker tests (unit + OCR integration)
    test-picture/         Synthetic test images (committed)
  local_uploads/          Uploaded label images (gitignored)
  scripts/                Dev utilities (cleanup, etc.)
  docs/                   Architecture, API, worker, testing docs
```

---

## How to Dockerize / Migrate to Azure

See `docs/ARCHITECTURE.md` for full details. High-level steps:

1. **Add `output: 'standalone'`** to `web/next.config.ts`
2. **Write `Dockerfile` for web** — FROM node:18-alpine, copy standalone build, expose 3000
3. **Write `Dockerfile` for worker** — FROM python:3.11-slim, install pip deps (no Tesseract binary needed when using `OCR_BACKEND=azure`)
4. **Write `docker-compose.yml`** with services: `web`, `worker`, `db` (postgres)
5. **Swap storage adapter** — replace `web/src/lib/storage/local.ts` with `azure-blob.ts` (same interface)
6. **Swap queue adapter** — replace DB polling in worker with Azure Storage Queue consumer
7. **Swap database** — change `DATABASE_URL` to postgres, update Prisma provider
8. **Use Managed Identity** — remove `AZURE_VISION_KEY`, assign the container a Managed Identity with Cognitive Services User role

Required env vars for Azure deployment:
- `AZURE_VISION_ENDPOINT` (no key — Managed Identity handles auth)
- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_STORAGE_CONTAINER`
- `AZURE_QUEUE_NAME`
- `DATABASE_URL` (postgres connection string)
- `NEXTAUTH_SECRET` (for Microsoft login)
- `AZURE_AD_CLIENT_ID` / `AZURE_AD_CLIENT_SECRET` / `AZURE_AD_TENANT_ID`

---

## Retention Policy

- Every job has `expiresAt = createdAt + 24h`
- Run `npm run cleanup` (from `web/`) to purge expired jobs and their files
- Users can also click **Delete** on the review or history page

---

## Limitations (MVP)

- Brand name and class/type extraction is best-effort string matching — no image preprocessing (upscaling, deskew, contrast enhancement) is applied before OCR
- No authentication — session is a UUID cookie (no login UI yet)
- Rate limiting is in-memory; restart clears state (use Redis in production)
- Azure AI Vision F0 free tier: 5,000 calls/month, 20 calls/minute — upgrade to S1 for production volume
