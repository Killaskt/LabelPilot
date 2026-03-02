# pulls out brand/class/abv/net/gov warning from ocr text. WORD_MATCH_THRESHOLD in .env for word-level match (default 0.75).
import os
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

def _word_match_threshold() -> float:
    return float(os.environ.get("WORD_MATCH_THRESHOLD", "0.75"))


def normalize_text(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[\u2018\u2019\u201a\u201b\u0060\u00b4]", "'", text)
    text = re.sub(r'[\u201c\u201d\u201e\u201f]', '"', text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def strip_punctuation(text: str) -> str:
    result = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", result).strip()


def _ocr_correct(text: str) -> str:
    def fix_token(token: str) -> str:
        if re.search(r"[a-zA-Z]", token):
            token = token.replace("0", "O").replace("1", "I").replace("|", "I")
            token = token.replace("5", "S").replace("8", "B")
        return token

    return " ".join(fix_token(t) for t in text.split())


def normalize_bbox(bbox: Optional[dict], image_size: dict) -> Optional[dict]:
    if not bbox:
        return None
    img_w = image_size.get("w") or 1
    img_h = image_size.get("h") or 1
    return {
        "x": bbox["x"] / img_w,
        "y": bbox["y"] / img_h,
        "w": bbox["w"] / img_w,
        "h": bbox["h"] / img_h,
    }


def _find_word_bbox(search: str, words: list, image_size: dict) -> Optional[dict]:
    search_lower = search.lower()
    for word in words:
        if search_lower in word["text"].lower():
            return normalize_bbox(word["bbox"], image_size)
    return None


def _find_phrase_bbox(phrase: str, words: list, image_size: dict) -> Optional[dict]:
    tokens = phrase.lower().split()
    if not tokens:
        return None
    n = len(tokens)
    for i in range(len(words) - n + 1):
        chunk = words[i: i + n]
        if all(tokens[j] in chunk[j]["text"].lower() for j in range(n)):
            bboxes = [w["bbox"] for w in chunk]
            x = min(b["x"] for b in bboxes)
            y = min(b["y"] for b in bboxes)
            x2 = max(b["x"] + b["w"] for b in bboxes)
            y2 = max(b["y"] + b["h"] for b in bboxes)
            return normalize_bbox({"x": x, "y": y, "w": x2 - x, "h": y2 - y}, image_size)
    return None


def _word_coverage(expected_words: list[str], ocr_word_set: set[str]) -> float:
    if not expected_words:
        return 0.0
    return sum(1 for w in expected_words if w in ocr_word_set) / len(expected_words)


def _extract_text_field(
    text: str,
    words: list,
    image_size: dict,
    expected: str,
) -> dict:
    norm_text = normalize_text(text)
    norm_expected = normalize_text(expected)
    threshold = _word_match_threshold()

    if norm_expected in norm_text:
        bbox = (
            _find_phrase_bbox(expected, words, image_size)
            or _find_word_bbox(expected.split()[0], words, image_size)
            if expected.split() else None
        )
        return {
            "found": True, "value": expected, "raw_match": expected,
            "bbox": bbox, "confidence": 0.90 if bbox else 0.70,
        }

    soft_text = strip_punctuation(norm_text)
    soft_expected = strip_punctuation(norm_expected)
    if soft_expected and soft_expected in soft_text:
        bbox = _find_word_bbox(expected.split()[0], words, image_size) if expected.split() else None
        return {
            "found": True, "value": expected, "raw_match": expected,
            "bbox": bbox, "confidence": 0.65,
        }

    expected_words = norm_expected.split()
    ocr_word_set = set(norm_text.split())
    coverage = _word_coverage(expected_words, ocr_word_set)

    if coverage >= threshold:
        bbox = _find_word_bbox(expected.split()[0], words, image_size) if expected.split() else None
        confidence = 0.50 + coverage * 0.25   # 0.75 threshold → 0.69; 1.0 → 0.75
        logger.debug(
            "Word-level match for '%s': coverage=%.0f%% conf=%.2f",
            expected, coverage * 100, confidence,
        )
        return {
            "found": True, "value": expected, "raw_match": expected,
            "bbox": bbox, "confidence": confidence,
        }

    corrected_text = normalize_text(_ocr_correct(text))
    corrected_word_set = set(corrected_text.split())
    corrected_coverage = _word_coverage(expected_words, corrected_word_set)

    if corrected_coverage >= threshold:
        confidence = min(0.60, 0.45 + corrected_coverage * 0.20)
        logger.debug(
            "OCR-corrected match for '%s': coverage=%.0f%% conf=%.2f",
            expected, corrected_coverage * 100, confidence,
        )
        return {
            "found": True, "value": expected, "raw_match": expected,
            "bbox": None, "confidence": confidence,
        }

    best = max(coverage, corrected_coverage)
    if best >= 0.5:
        logger.debug("Partial match for '%s': best coverage=%.0f%%", expected, best * 100)
        return {
            "found": True, "value": expected, "raw_match": expected,
            "bbox": None, "confidence": best * 0.4,
        }

    return {"found": False, "value": None, "raw_match": None, "bbox": None, "confidence": 0.0}


def extract_brand_name(text: str, words: list, image_size: dict, expected: str) -> dict:
    return _extract_text_field(text, words, image_size, expected)


def extract_class_type(text: str, words: list, image_size: dict, expected: str) -> dict:
    return _extract_text_field(text, words, image_size, expected)


def extract_alcohol_content(text: str, words: list, image_size: dict) -> dict:
    patterns = [
        r"(\d+(?:\.\d+)?)\s*%\s*(?:alc(?:ohol)?\.?\s*(?:by\s*vol(?:ume)?\.?)?)",
        r"(\d+(?:\.\d+)?)\s*%\s*abv",
        r"(\d+(?:\.\d+)?)\s*%\s*alc\s*/\s*vol",
        r"(\d+(?:\.\d+)?)\s*%",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            raw = match.group(0).strip()
            value = f"{match.group(1)}% alc. by vol."
            bbox = _find_word_bbox(match.group(1), words, image_size)
            return {
                "found": True, "value": value, "raw_match": raw,
                "bbox": bbox, "confidence": 0.9 if bbox else 0.6,
            }
    return {"found": False, "value": None, "raw_match": None, "bbox": None, "confidence": 0.0}


def extract_net_contents(text: str, words: list, image_size: dict) -> dict:
    patterns = [
        r"(\d+(?:\.\d+)?)\s*(ml|mL|L|litre|liter)",
        r"(\d+(?:\.\d+)?)\s*(?:fluid\s+)?(?:fl\.?\s*)?oz(?:\.)?",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            raw = match.group(0).strip()
            bbox = _find_word_bbox(match.group(1), words, image_size)
            return {
                "found": True, "value": raw, "raw_match": raw,
                "bbox": bbox, "confidence": 0.85 if bbox else 0.55,
            }
    return {"found": False, "value": None, "raw_match": None, "bbox": None, "confidence": 0.0}


def extract_government_warning(text: str, words: list, image_size: dict) -> dict:
    if re.search(r"GOVERNMENT\s+WARNING", text):
        bbox = _find_phrase_bbox("GOVERNMENT WARNING", words, image_size)
        return {
            "found": True, "value": "GOVERNMENT WARNING present",
            "raw_match": "GOVERNMENT WARNING", "bbox": bbox, "confidence": 0.95,
        }

    match = re.search(r"government\s+warning", text, re.IGNORECASE)
    if match:
        raw = match.group(0)
        bbox = (
            _find_phrase_bbox(raw, words, image_size)
            or _find_word_bbox("warning", words, image_size)
        )
        logger.warning(
            "Government warning found as %r — not all-caps, TTB non-compliant", raw
        )
        return {
            "found": True,
            "value": "warning present — not all-caps (TTB non-compliant)",
            "raw_match": raw,
            "bbox": bbox,
            "confidence": 0.50,
        }

    return {"found": False, "value": None, "raw_match": None, "bbox": None, "confidence": 0.0}
