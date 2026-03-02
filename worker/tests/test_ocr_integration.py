"""
OCR integration tests — run the actual OCR pipeline against the image(s) in
worker/test-picture/.

These tests verify that the configured OCR backend runs end-to-end and returns
sensible output.  They intentionally avoid asserting specific field values since
that is the job of benchmark.py (where you supply --expected-* arguments).

Skipped automatically if the required backend is unavailable or no test image
is present.
"""

import os
import sys
import pytest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from ocr import extract_text_with_boxes
from extraction import extract_alcohol_content, extract_net_contents, extract_government_warning


def _backend_available() -> bool:
    backend = os.environ.get("OCR_BACKEND", "tesseract").lower()
    if backend == "azure":
        return bool(os.environ.get("AZURE_VISION_ENDPOINT") and os.environ.get("AZURE_VISION_KEY"))
    try:
        import pytesseract
        tesseract_cmd = os.environ.get("TESSERACT_CMD")
        if tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


requires_ocr = pytest.mark.skipif(
    not _backend_available(),
    reason=f"OCR backend '{os.environ.get('OCR_BACKEND', 'tesseract')}' not available",
)


@requires_ocr
class TestOcrPipeline:
    """
    Smoke tests: verify the OCR pipeline runs without error and returns
    structured output.  No field-value assertions — use benchmark.py for that.
    """

    @pytest.fixture(autouse=True)
    def _load(self, test_label_path):
        if test_label_path is None:
            pytest.skip("No test image found in worker/test-picture/")
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).parent.parent / ".env")
        self.path = test_label_path
        self.result = extract_text_with_boxes(str(test_label_path))

    def test_ocr_available(self):
        assert self.result["ocr_available"], (
            "OCR backend returned the stub — check TESSERACT_CMD or Azure credentials"
        )

    def test_returns_nonempty_text(self):
        text = self.result["full_text"].strip()
        assert len(text) > 10, f"OCR returned almost no text from {self.path.name!r}"

    def test_returns_word_list(self):
        words = self.result["words"]
        assert isinstance(words, list)
        assert len(words) > 0, "No words with bounding boxes returned"

    def test_word_bboxes_are_valid(self):
        for w in self.result["words"]:
            assert "text" in w
            assert "conf" in w
            if w["bbox"] is not None:
                bbox = w["bbox"]
                assert all(k in bbox for k in ("x", "y", "w", "h"))
                assert bbox["w"] > 0 and bbox["h"] > 0

    def test_image_size_returned(self):
        size = self.result["image_size"]
        assert size["w"] > 0 and size["h"] > 0

    def test_regex_extractors_run_without_error(self):
        """Extractors shouldn't raise on any OCR output."""
        text, words, size = self.result["full_text"], self.result["words"], self.result["image_size"]
        extract_alcohol_content(text, words, size)
        extract_net_contents(text, words, size)
        extract_government_warning(text, words, size)

    def test_prints_extracted_text(self, capsys):
        """Not a real assertion — prints OCR output so you can eyeball it."""
        backend = os.environ.get("OCR_BACKEND", "tesseract").upper()
        text = self.result["full_text"]
        print(f"\n── [{backend}] OCR text from {self.path.name} ──")
        print(text[:600])
        if len(text) > 600:
            print(f"... ({len(text)} chars total)")
        print(f"── {len(self.result['words'])} words with bboxes ──")
