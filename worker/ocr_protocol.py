"""
Formal interface that every OCR backend must satisfy.

Both ocr.py (Tesseract) and ocr_azure.py (Azure AI Vision) return a dict
matching OcrResult. This module makes the contract explicit and provides
type-safe access patterns.
"""

from typing import TypedDict, Optional


class WordBox(TypedDict):
    text: str
    bbox: Optional[dict]   # {"x": int, "y": int, "w": int, "h": int} in pixels, or None
    conf: float            # 0.0–1.0


class OcrResult(TypedDict):
    full_text: str         # complete page text (newlines preserved, normalize_text collapses them)
    words: list            # list[WordBox] — for bounding-box overlays
    image_size: dict       # {"w": int, "h": int}
    ocr_available: bool    # False when stub fallback was used


def validate_ocr_result(result: dict, source: str = "unknown") -> OcrResult:
    """
    Validate that a backend's return value matches OcrResult.
    Raises ValueError with a clear message if the shape is wrong.
    Used in tests and the benchmark script.
    """
    required = {"full_text", "words", "image_size", "ocr_available"}
    missing = required - result.keys()
    if missing:
        raise ValueError(f"OCR result from '{source}' is missing keys: {missing}")
    if not isinstance(result["full_text"], str):
        raise ValueError(f"'full_text' must be str, got {type(result['full_text'])}")
    if not isinstance(result["words"], list):
        raise ValueError(f"'words' must be list, got {type(result['words'])}")
    if not isinstance(result["image_size"], dict):
        raise ValueError(f"'image_size' must be dict")
    return result  # type: ignore[return-value]
