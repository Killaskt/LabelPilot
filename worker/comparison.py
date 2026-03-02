import re
import logging
from typing import Optional
from extraction import normalize_text, strip_punctuation

logger = logging.getLogger(__name__)


def compare_field(
    field: str,
    found_value: Optional[str],
    expected_value: str,
    confidence: float,
) -> dict:
    if found_value is None:
        return {
            "status": "not_found",
            "needs_human": True,
        }

    norm_found = normalize_text(found_value)
    norm_expected = normalize_text(expected_value)

    if norm_found == norm_expected:
        return {"status": "match", "needs_human": False}

    if norm_expected in norm_found or norm_found in norm_expected:
        return {"status": "match", "needs_human": False}

    soft_found = strip_punctuation(norm_found)
    soft_expected = strip_punctuation(norm_expected)
    if soft_found == soft_expected or soft_expected in soft_found or soft_found in soft_expected:
        return {"status": "soft_mismatch", "needs_human": True}

    if field in ("alcoholContent", "netContents"):
        fn = _extract_first_number(norm_found)
        en = _extract_first_number(norm_expected)
        if fn is not None and en is not None:
            delta = abs(fn - en)
            if delta < 0.01:
                return {"status": "match", "needs_human": False}
            if delta < 0.5:
                return {"status": "soft_mismatch", "needs_human": True}

    return {"status": "mismatch", "needs_human": True}


def _extract_first_number(text: str) -> Optional[float]:
    match = re.search(r"\d+(?:\.\d+)?", text)
    if match:
        try:
            return float(match.group())
        except ValueError:
            pass
    return None
