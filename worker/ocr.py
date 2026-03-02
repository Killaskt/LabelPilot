# OCR backend router.
# When OCR_BACKEND=azure, falls back to Tesseract on rate limit / unreachable,
# then to stub if Tesseract is also unavailable.
# When OCR_BACKEND=tesseract (default), falls back directly to stub.
import logging
import os

logger = logging.getLogger(__name__)


def extract_text_with_boxes(image_path: str) -> dict:
    backend = os.environ.get("OCR_BACKEND", "tesseract").lower().strip()

    if backend == "azure":
        try:
            from ocr_azure import extract_text_with_boxes_azure
            return extract_text_with_boxes_azure(image_path)
        except ImportError as exc:
            logger.warning("Azure SDK not installed (%s) — falling back to Tesseract.", exc)
        except Exception as exc:
            _log_azure_failure(exc)

        logger.info("Attempting Tesseract fallback after Azure failure.")
        try:
            return _tesseract_ocr(image_path)
        except Exception as exc:
            logger.error("Tesseract fallback also failed (%s) — using stub.", exc)
            return _stub_ocr(image_path)

    # tesseract backend (default)
    try:
        return _tesseract_ocr(image_path)
    except ImportError as exc:
        logger.warning("Tesseract unavailable (%s) — using stub.", exc)
        return _stub_ocr(image_path)
    except Exception as exc:
        logger.error("Tesseract OCR failed (%s) — using stub.", exc)
        return _stub_ocr(image_path)


def _log_azure_failure(exc: Exception) -> None:
    """Log Azure failures with context-specific messages, then let the caller fall back."""
    try:
        from azure.core.exceptions import HttpResponseError, ServiceRequestError
        if isinstance(exc, HttpResponseError):
            if exc.status_code == 429:
                logger.warning(
                    "Azure rate limit hit (429) — falling back to Tesseract. "
                    "Free tier: 20 calls/min. Consider upgrading to S1."
                )
            elif exc.status_code in (401, 403):
                logger.error(
                    "Azure auth error (%d) — check AZURE_VISION_KEY / AZURE_VISION_ENDPOINT. "
                    "Falling back to Tesseract.", exc.status_code
                )
            elif exc.status_code in (502, 503, 504):
                logger.warning(
                    "Azure service unavailable (%d) — falling back to Tesseract.", exc.status_code
                )
            else:
                logger.error(
                    "Azure HTTP error %d — falling back to Tesseract. Detail: %s",
                    exc.status_code, exc.message or exc,
                )
        elif isinstance(exc, ServiceRequestError):
            logger.warning(
                "Azure unreachable (network error) — falling back to Tesseract. (%s)", exc
            )
        else:
            logger.error("Azure OCR failed (%s) — falling back to Tesseract.", exc)
    except ImportError:
        # azure-core not installed at all
        logger.error("Azure OCR failed (%s) — falling back to Tesseract.", exc)


def _tesseract_ocr(image_path: str) -> dict:
    import pytesseract
    from pytesseract import Output
    from PIL import Image

    tesseract_cmd = os.environ.get("TESSERACT_CMD")
    if tesseract_cmd:
        pytesseract.pytesseract.tesseract_cmd = tesseract_cmd

    img = Image.open(image_path).convert("RGB")
    img_w, img_h = img.size

    full_text = pytesseract.image_to_string(img)
    data = pytesseract.image_to_data(img, output_type=Output.DICT)

    words = []
    for i in range(len(data["text"])):
        raw = (data["text"][i] or "").strip()
        if not raw:
            continue
        try:
            conf = float(data["conf"][i]) / 100.0
        except (TypeError, ValueError):
            conf = 0.0
        if conf < 0:
            continue
        words.append({
            "text": raw,
            "bbox": {
                "x": data["left"][i],
                "y": data["top"][i],
                "w": data["width"][i],
                "h": data["height"][i],
            },
            "conf": conf,
        })

    return {
        "full_text": full_text,
        "words": words,
        "image_size": {"w": img_w, "h": img_h},
        "ocr_available": True,
    }


def _stub_ocr(image_path: str) -> dict:
    img_w, img_h = 1, 1
    try:
        from PIL import Image
        with Image.open(image_path) as img:
            img_w, img_h = img.size
    except Exception:
        pass

    return {
        "full_text": "",
        "words": [],
        "image_size": {"w": img_w, "h": img_h},
        "ocr_available": False,
    }
