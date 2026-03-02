#!/usr/bin/env python3
# polls db for queued jobs, runs ocr + extraction + comparison, writes results. see .env.example for config.

import argparse
import json
import logging
import os
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv


def _resolve_env_file() -> Path:
    """
    Extract --env from argv before argparse runs so load_dotenv
    gets the right profile file before module-level config is read.
    Falls back to .env for backwards compatibility.
    """
    _pre = argparse.ArgumentParser(add_help=False)
    _pre.add_argument("--env", default=None)
    _pre_args, _ = _pre.parse_known_args()

    if _pre_args.env:
        env_file = Path(__file__).parent / f".env.{_pre_args.env}"
        if env_file.exists():
            return env_file
        raise FileNotFoundError(f"Env profile not found: {env_file}")

    # No --env given: try .env.dev first, fall back to .env
    for name in (".env.dev", ".env"):
        candidate = Path(__file__).parent / name
        if candidate.exists():
            return candidate
    raise FileNotFoundError("No .env.dev or .env file found in worker/")


_env_file = _resolve_env_file()
load_dotenv(_env_file)
print(f"[env] Loaded {_env_file.name}")

import ocr
import extraction
import comparison
from db import get_conn

SQLITE_PATH = os.environ.get("SQLITE_PATH", "../web/prisma/dev.db")
UPLOAD_BASE_DIR = os.environ.get("UPLOAD_BASE_DIR", "../local_uploads")
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "1.0"))

logging.basicConfig(
    level=getattr(logging, os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger("worker")

FIELDS = [
    "brandName",
    "classType",
    "alcoholContent",
    "netContents",
    "governmentWarning",
]

# A field passes at the job level when at least one asset produces a "match"
# result with OCR confidence at or above this threshold.
MATCH_CONF_THRESHOLD = float(os.environ.get("MATCH_CONF_THRESHOLD", "0.70"))


def _field_passes(field_results: list[dict]) -> bool:
    """Return True when the multi-image compliance rule is satisfied.

    A field passes if at least one asset produced a 'match' result with
    OCR confidence >= MATCH_CONF_THRESHOLD. If no image clears that bar
    the field is flagged for human review.
    """
    return any(
        r["status"] == "match" and (r["confidence"] or 0.0) >= MATCH_CONF_THRESHOLD
        for r in field_results
    )


def claim_next_job(conn) -> Optional[dict]:
    now_iso = datetime.now(timezone.utc).isoformat()
    with conn:
        cur = conn.execute(
            """
            UPDATE "Job"
            SET status = 'processing', "startedAt" = ?
            WHERE id = (
                SELECT id FROM "Job"
                WHERE status = 'queued'
                ORDER BY "createdAt" ASC
                LIMIT 1
            )
            RETURNING *
            """,
            (now_iso,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def get_assets(conn, job_id: str) -> list[dict]:
    cur = conn.execute(
        'SELECT * FROM "JobAsset" WHERE "jobId" = ? ORDER BY "assetOrder" ASC',
        (job_id,),
    )
    return [dict(r) for r in cur.fetchall()]


def insert_result(
    conn,
    job_id: str,
    asset_id: str,
    field: str,
    result: dict,
    processing_ms: float,
) -> None:
    row_id = uuid.uuid4().hex
    now_iso = datetime.now(timezone.utc).isoformat()
    bbox_json = json.dumps(result.get("bbox")) if result.get("bbox") else None

    with conn:
        conn.execute(
            """
            INSERT INTO "JobResult"
              (id, "jobId", "assetId", field, "foundValue", "expectedValue",
               confidence, status, "bboxJson", "needsHuman", "processingTimeMs", "createdAt")
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row_id,
                job_id,
                asset_id,
                field,
                result.get("found_value"),
                result.get("expected_value"),
                result.get("confidence", 0.0),
                result.get("status", "not_found"),
                bbox_json,
                bool(result.get("needs_human", True)),
                processing_ms,
                now_iso,
            ),
        )


def finish_job(
    conn,
    job_id: str,
    final_status: str,
    metrics: dict,
    error_message: Optional[str] = None,
) -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    with conn:
        conn.execute(
            """
            UPDATE "Job"
            SET status = ?, "finishedAt" = ?, "errorMessage" = ?,
                "timeToFirstResult" = ?, "avgPerLabel" = ?,
                "p95PerLabel" = ?, "totalBatchTime" = ?
            WHERE id = ?
            """,
            (
                final_status,
                now_iso,
                error_message,
                metrics.get("time_to_first"),
                metrics.get("avg_per_label"),
                metrics.get("p95_per_label"),
                metrics.get("total"),
                job_id,
            ),
        )


def percentile(data: list[float], pct: float) -> float:
    if not data:
        return 0.0
    s = sorted(data)
    idx = (pct / 100) * (len(s) - 1)
    lo, hi = int(idx), min(int(idx) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (idx - lo)


def process_job(job: dict) -> None:
    job_id = job["id"]
    logger.info("Processing job %s (%s — %s)", job_id, job["brandName"], job["classType"])

    conn = get_conn()
    try:
        assets = get_assets(conn, job_id)
        if not assets:
            finish_job(conn, job_id, "error", {}, "No assets found for job")
            return

        expected = {
            "brandName": job["brandName"],
            "classType": job["classType"],
            "alcoholContent": job["alcoholContent"],
            "netContents": job["netContents"],
            "governmentWarning": "GOVERNMENT WARNING",
        }

        job_start = time.perf_counter()
        first_result_ms: Optional[float] = None
        per_label_ms: list[float] = []
        any_needs_human = False
        # Tracks comparison results per field across all assets so we can
        # apply the multi-image rule after the loop.
        per_field_results: dict[str, list[dict]] = {f: [] for f in FIELDS}

        for asset in assets:
            asset_start = time.perf_counter()
            logger.info("  Asset %s: %s", asset["id"], asset["storedPath"])

            temp_image: Optional[str] = None
            try:
                if os.environ.get("STORAGE_BACKEND") == "azure":
                    image_path = _download_blob_to_temp(asset["storedPath"])
                    temp_image = image_path
                else:
                    stored_path = asset["storedPath"].replace("/", os.sep)
                    image_path = str((Path(UPLOAD_BASE_DIR) / stored_path).resolve())

                ocr_result = ocr.extract_text_with_boxes(image_path)
                full_text = ocr_result["full_text"]
                words = ocr_result["words"]
                image_size = ocr_result["image_size"]
                ocr_ok = ocr_result["ocr_available"]

                if not ocr_ok:
                    logger.warning("  OCR unavailable — all fields flagged needs_human")

                extractions: dict[str, dict] = {
                    "brandName": extraction.extract_brand_name(full_text, words, image_size, expected["brandName"]),
                    "classType": extraction.extract_class_type(full_text, words, image_size, expected["classType"]),
                    "alcoholContent": extraction.extract_alcohol_content(full_text, words, image_size),
                    "netContents": extraction.extract_net_contents(full_text, words, image_size),
                    "governmentWarning": extraction.extract_government_warning(full_text, words, image_size),
                }

                for field in FIELDS:
                    field_start = time.perf_counter()
                    ext = extractions[field]

                    if ext["found"]:
                        comp = comparison.compare_field(
                            field,
                            ext["value"],
                            expected[field],
                            ext["confidence"],
                        )
                    else:
                        comp = {"status": "not_found", "needs_human": True}

                    result_entry = {
                        "found_value": ext.get("value"),
                        "expected_value": expected[field],
                        "confidence": ext.get("confidence", 0.0),
                        "status": comp["status"],
                        "needs_human": comp["needs_human"],
                        "bbox": ext.get("bbox"),
                    }
                    per_field_results[field].append(result_entry)

                    field_ms = (time.perf_counter() - field_start) * 1000
                    insert_result(conn, job_id, asset["id"], field, result_entry, field_ms)

                if first_result_ms is None:
                    first_result_ms = (time.perf_counter() - job_start) * 1000

            except FileNotFoundError:
                logger.error("  Image file not found: %s", image_path)
                _save_error_results(conn, job_id, asset["id"], expected)
                any_needs_human = True
            except Exception as exc:
                logger.error("  Failed to process asset %s: %s", asset["id"], exc, exc_info=True)
                _save_error_results(conn, job_id, asset["id"], expected)
                any_needs_human = True
            finally:
                if temp_image and os.path.exists(temp_image):
                    try:
                        os.unlink(temp_image)
                    except Exception:
                        pass

            label_ms = (time.perf_counter() - asset_start) * 1000
            per_label_ms.append(label_ms)
            logger.info("  Asset done in %.0fms", label_ms)

        total_ms = (time.perf_counter() - job_start) * 1000
        metrics = {
            "time_to_first": first_result_ms or 0.0,
            "avg_per_label": sum(per_label_ms) / len(per_label_ms) if per_label_ms else 0.0,
            "p95_per_label": percentile(per_label_ms, 95),
            "total": total_ms,
        }

        # Multi-image rule: a field passes if at least one asset produced a
        # high-confidence match, even if other assets disagreed (conflict).
        # any_needs_human may already be True from a processing error above.
        for field in FIELDS:
            results = per_field_results[field]
            if not _field_passes(results):
                any_needs_human = True
            elif len(results) > 1:
                conflicts = sum(1 for r in results if r["status"] != "match")
                if conflicts:
                    logger.info(
                        "  Field %s: passed on %d/%d images (%d conflict%s)",
                        field,
                        len(results) - conflicts,
                        len(results),
                        conflicts,
                        "s" if conflicts > 1 else "",
                    )

        final_status = "needs_human" if any_needs_human else "ready"
        finish_job(conn, job_id, final_status, metrics)
        logger.info(
            "Job %s done: %s  total=%.0fms  avg=%.0fms  p95=%.0fms",
            job_id, final_status, total_ms,
            metrics["avg_per_label"], metrics["p95_per_label"],
        )

    except Exception as exc:
        logger.error("Fatal error processing job %s: %s", job_id, exc, exc_info=True)
        try:
            finish_job(conn, job_id, "error", {}, str(exc))
        except Exception:
            pass
    finally:
        conn.close()


def _download_blob_to_temp(blob_name: str) -> str:
    """Download a blob to a temp file, return the temp file path."""
    from azure.storage.blob import BlobServiceClient
    connection_string = os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "")
    container_name = os.environ.get("AZURE_STORAGE_CONTAINER", "labelpilotdb")
    blob_client = (
        BlobServiceClient.from_connection_string(connection_string)
        .get_blob_client(container=container_name, blob=blob_name)
    )
    ext = Path(blob_name).suffix
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp_path = tmp.name
        tmp.write(blob_client.download_blob().readall())
    return tmp_path


def _save_error_results(conn, job_id, asset_id, expected):
    for field in FIELDS:
        try:
            insert_result(
                conn, job_id, asset_id, field,
                {
                    "found_value": None,
                    "expected_value": expected.get(field),
                    "confidence": 0.0,
                    "status": "not_found",
                    "needs_human": True,
                    "bbox": None,
                },
                0.0,
            )
        except Exception:
            pass


def main() -> None:
    parser = argparse.ArgumentParser(description="LabelPilot Worker")
    parser.add_argument(
        "--env",
        default=None,
        metavar="PROFILE",
        help="Environment profile to load (.env.dev, .env.hybrid, .env.prod). Default: .env.dev",
    )
    parser.add_argument(
        "--backend",
        choices=["tesseract", "azure"],
        default=None,
        help="OCR backend to use. Overrides OCR_BACKEND env var. Default: env var or 'tesseract'.",
    )
    args = parser.parse_args()

    if args.backend:
        os.environ["OCR_BACKEND"] = args.backend

    active_backend = os.environ.get("OCR_BACKEND", "tesseract")

    upload_dir = Path(UPLOAD_BASE_DIR).resolve()
    database_url = os.environ.get("DATABASE_URL")
    db_label = database_url.split("@")[-1] if database_url else str(Path(SQLITE_PATH).resolve())

    logger.info("Worker starting")
    logger.info("  DB:      %s", db_label)
    logger.info("  Uploads: %s", upload_dir)
    logger.info("  Poll:    %.1fs", POLL_INTERVAL)
    logger.info("  Backend: %s", active_backend)

    # For SQLite only — check the file exists before starting the poll loop.
    # PostgreSQL connectivity is verified on first connection attempt instead.
    if not database_url:
        db_path = Path(SQLITE_PATH).resolve()
        if not db_path.exists():
            logger.error(
                "SQLite file not found at %s — run `npm run db:migrate` in web/ first.",
                db_path,
            )
            return

    while True:
        try:
            conn = get_conn()
            try:
                job = claim_next_job(conn)
            finally:
                conn.close()

            if job:
                process_job(job)
            else:
                time.sleep(POLL_INTERVAL)

        except KeyboardInterrupt:
            logger.info("Worker stopped (KeyboardInterrupt)")
            break
        except Exception as exc:
            logger.error("Worker loop error: %s", exc, exc_info=True)
            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
