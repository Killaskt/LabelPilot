#!/usr/bin/env python
"""
OCR backend benchmark tool.

Run both (or one) OCR backends against one or more label images and compare:
  - Wall-clock time
  - Word count and average word confidence
  - Full extracted text
  - Per-field extraction results

Usage:
    python benchmark.py path/to/label.png
    python benchmark.py path/to/label.png --backend azure
    python benchmark.py path/to/label.png --backend tesseract
    python benchmark.py path/to/label.png --expected-brand "Old Tom Distillery" \
        --expected-class "Kentucky Straight Bourbon Whiskey" \
        --expected-abv "45% alc. by vol." \
        --expected-net "750 mL"

Options:
    --backend       Which backend to run: "tesseract", "azure", or "both" (default: both)
    --expected-*    Expected field values to score extraction accuracy
    --json          Output results as JSON instead of formatted text
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

# Load .env so credentials are available when run directly
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

sys.path.insert(0, str(Path(__file__).parent))

from extraction import (
    extract_brand_name,
    extract_class_type,
    extract_alcohol_content,
    extract_net_contents,
    extract_government_warning,
)
from ocr_protocol import validate_ocr_result


# ─── Backend runners ──────────────────────────────────────────────────────────

def run_tesseract(image_path: str) -> tuple[dict, float]:
    """Returns (OcrResult, elapsed_seconds). Raises on failure."""
    from ocr import _tesseract_ocr  # noqa: PLC0415
    t0 = time.perf_counter()
    result = _tesseract_ocr(image_path)
    elapsed = time.perf_counter() - t0
    validate_ocr_result(result, "tesseract")
    return result, elapsed


def run_azure(image_path: str) -> tuple[dict, float]:
    """Returns (OcrResult, elapsed_seconds). Raises on failure."""
    from ocr_azure import extract_text_with_boxes_azure  # noqa: PLC0415
    t0 = time.perf_counter()
    result = extract_text_with_boxes_azure(image_path)
    elapsed = time.perf_counter() - t0
    validate_ocr_result(result, "azure")
    return result, elapsed


# ─── Extraction scoring ───────────────────────────────────────────────────────

def score_extraction(ocr_result: dict, expected: dict) -> dict:
    """Run all field extractors and return per-field results."""
    text = ocr_result["full_text"]
    words = ocr_result["words"]
    size = ocr_result["image_size"]

    fields = {}

    if expected.get("brand"):
        fields["brandName"] = extract_brand_name(text, words, size, expected["brand"])
    if expected.get("class_type"):
        fields["classType"] = extract_class_type(text, words, size, expected["class_type"])
    if expected.get("abv") or True:
        fields["alcoholContent"] = extract_alcohol_content(text, words, size)
    if expected.get("net") or True:
        fields["netContents"] = extract_net_contents(text, words, size)

    fields["governmentWarning"] = extract_government_warning(text, words, size)

    return fields


# ─── Report formatting ────────────────────────────────────────────────────────

def _word_stats(words: list) -> dict:
    if not words:
        return {"count": 0, "avg_conf": 0.0, "low_conf_count": 0}
    confs = [w.get("conf", 0.0) for w in words]
    return {
        "count": len(words),
        "avg_conf": round(sum(confs) / len(confs), 3),
        "low_conf_count": sum(1 for c in confs if c < 0.5),
    }


def print_report(backend: str, ocr: dict, elapsed: float, fields: dict, expected: dict) -> None:
    SEP = "─" * 60
    print(f"\n{'═' * 60}")
    print(f"  Backend : {backend.upper()}")
    print(f"  Time    : {elapsed:.3f}s")
    stats = _word_stats(ocr["words"])
    print(f"  Words   : {stats['count']}  |  avg conf: {stats['avg_conf']:.1%}  |  low-conf (<50%): {stats['low_conf_count']}")
    print(f"{'═' * 60}")

    print("\n── Extracted text ──────────────────────────────────────")
    # Show first 600 chars, replacing newlines with ↵ for readability
    preview = ocr["full_text"][:600].replace("\n", " ↵ ").replace("\f", " [FF] ")
    print(f"  {preview}")
    if len(ocr["full_text"]) > 600:
        print(f"  ... ({len(ocr['full_text'])} chars total)")

    print(f"\n── Field extraction ─────────────────────────────────────")
    for field, result in fields.items():
        found_mark = "✅" if result["found"] else "❌"
        conf_str = f"{result['confidence']:.0%}" if result["found"] else "—"
        value_str = result["value"] if result["found"] else "not found"
        exp_str = ""
        # Show match indicator if expected value was given
        field_key = {
            "brandName": "brand", "classType": "class_type",
            "alcoholContent": "abv", "netContents": "net",
        }.get(field)
        if field_key and expected.get(field_key):
            match = expected[field_key].lower() in (result.get("value") or "").lower() or \
                    (result.get("value") or "").lower() in expected[field_key].lower()
            exp_str = f"  {'✅ match' if match else '⚠ mismatch'} (expected: {expected[field_key]})"
        print(f"  {found_mark} {field:<20} {value_str}  [conf {conf_str}]{exp_str}")

    print()


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Benchmark OCR backends against a label image.")
    parser.add_argument("image", help="Path to label image (PNG or JPEG)")
    parser.add_argument("--backend", choices=["tesseract", "azure", "both"], default="both",
                        help="Which backend(s) to run (default: both)")
    parser.add_argument("--expected-brand",      dest="brand",      default="")
    parser.add_argument("--expected-class",      dest="class_type", default="")
    parser.add_argument("--expected-abv",        dest="abv",        default="")
    parser.add_argument("--expected-net",        dest="net",        default="")
    parser.add_argument("--json",  action="store_true", help="Output raw JSON")
    args = parser.parse_args()

    image_path = str(Path(args.image).resolve())
    if not Path(image_path).exists():
        print(f"Error: image not found: {image_path}", file=sys.stderr)
        sys.exit(1)

    expected = {
        "brand":      args.brand,
        "class_type": args.class_type,
        "abv":        args.abv,
        "net":        args.net,
    }

    backends_to_run = (
        ["tesseract", "azure"] if args.backend == "both"
        else [args.backend]
    )

    results = {}

    for backend in backends_to_run:
        print(f"Running {backend}...", end=" ", flush=True)
        try:
            if backend == "tesseract":
                ocr, elapsed = run_tesseract(image_path)
            else:
                ocr, elapsed = run_azure(image_path)
            print(f"done ({elapsed:.2f}s)")
            fields = score_extraction(ocr, expected)
            results[backend] = {"ocr": ocr, "elapsed": elapsed, "fields": fields, "error": None}
        except Exception as exc:
            print(f"FAILED: {exc}")
            results[backend] = {"ocr": None, "elapsed": None, "fields": {}, "error": str(exc)}

    if args.json:
        # Serialize (strip non-serialisable bbox objects gracefully)
        output = {}
        for backend, r in results.items():
            output[backend] = {
                "elapsed": r["elapsed"],
                "error": r["error"],
                "word_count": len(r["ocr"]["words"]) if r["ocr"] else 0,
                "full_text": r["ocr"]["full_text"] if r["ocr"] else "",
                "fields": {
                    f: {"found": v["found"], "value": v["value"], "confidence": v["confidence"]}
                    for f, v in r["fields"].items()
                },
            }
        print(json.dumps(output, indent=2))
        return

    print(f"\nImage: {image_path}")

    for backend, r in results.items():
        if r["error"]:
            print(f"\n{'═'*60}\n  Backend : {backend.upper()}\n  ERROR: {r['error']}\n{'═'*60}")
        else:
            print_report(backend, r["ocr"], r["elapsed"], r["fields"], expected)

    # Side-by-side time comparison when both ran
    if len([r for r in results.values() if not r["error"]]) == 2:
        times = {b: r["elapsed"] for b, r in results.items() if not r["error"]}
        faster, slower = sorted(times, key=times.get), sorted(times, key=times.get, reverse=True)
        ratio = times[slower[0]] / times[faster[0]]
        print(f"⏱  {faster[0].upper()} was {ratio:.1f}x faster than {slower[0].upper()} "
              f"({times[faster[0]]:.2f}s vs {times[slower[0]]:.2f}s)\n")


if __name__ == "__main__":
    main()
