#!/usr/bin/env python3
# polls db for queued jobs, runs ocr + extraction + comparison, writes results. see .env.example for config.

import argparse
import json
import logging
import os
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import ocr
import extraction
import comparison

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


def get_conn() -> sqlite3.Connection:
    db_path = Path(SQLITE_PATH).resolve()
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def claim_next_job(conn: sqlite3.Connection) -> Optional[dict]:
    now_iso = datetime.now(timezone.utc).isoformat()
    with conn:
        cur = conn.execute(
            """
            UPDATE Job
            SET status = 'processing', startedAt = ?
            WHERE id = (
                SELECT id FROM Job
                WHERE status = 'queued'
                ORDER BY createdAt ASC
                LIMIT 1
            )
            RETURNING *
            """,
            (now_iso,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def get_assets(conn: sqlite3.Connection, job_id: str) -> list[dict]:
    cur = conn.execute(
        "SELECT * FROM JobAsset WHERE jobId = ? ORDER BY assetOrder ASC",
        (job_id,),
    )
    return [dict(r) for r in cur.fetchall()]


def insert_result(
    conn: sqlite3.Connection,
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
            INSERT INTO JobResult
              (id, jobId, assetId, field, foundValue, expectedValue,
               confidence, status, bboxJson, needsHuman, processingTimeMs, createdAt)
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
                1 if result.get("needs_human", True) else 0,
                processing_ms,
                now_iso,
            ),
        )


def finish_job(
    conn: sqlite3.Connection,
    job_id: str,
    final_status: str,
    metrics: dict,
    error_message: Optional[str] = None,
) -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    with conn:
        conn.execute(
            """
            UPDATE Job
            SET status = ?, finishedAt = ?, errorMessage = ?,
                timeToFirstResult = ?, avgPerLabel = ?,
                p95PerLabel = ?, totalBatchTime = ?
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

        for asset in assets:
            asset_start = time.perf_counter()
            stored_path = asset["storedPath"].replace("/", os.sep)
            image_path = str((Path(UPLOAD_BASE_DIR) / stored_path).resolve())

            logger.info("  Asset %s: %s", asset["id"], image_path)

            try:
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

                    if comp["needs_human"]:
                        any_needs_human = True

                    field_ms = (time.perf_counter() - field_start) * 1000
                    insert_result(
                        conn,
                        job_id,
                        asset["id"],
                        field,
                        {
                            "found_value": ext.get("value"),
                            "expected_value": expected[field],
                            "confidence": ext.get("confidence", 0.0),
                            "status": comp["status"],
                            "needs_human": comp["needs_human"],
                            "bbox": ext.get("bbox"),
                        },
                        field_ms,
                    )

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
    parser = argparse.ArgumentParser(description="TTB Label Review Worker")
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

    db_path = Path(SQLITE_PATH).resolve()
    upload_dir = Path(UPLOAD_BASE_DIR).resolve()

    logger.info("Worker starting")
    logger.info("  DB:      %s", db_path)
    logger.info("  Uploads: %s", upload_dir)
    logger.info("  Poll:    %.1fs", POLL_INTERVAL)
    logger.info("  Backend: %s", active_backend)

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
