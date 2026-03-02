"""
TTB-specific extraction tests.

These tests simulate realistic OCR output from actual label layouts:
  - Multi-line text (how physical labels split words across lines)
  - Styled/large fonts that Tesseract or Azure may read with extra spaces
  - Common OCR errors on spirit labels (0→O, all-caps, punctuation)
  - Class/type extraction scenarios (the field most likely to fail)

Unlike test_extraction.py (which tests patterns with clean strings),
these tests use OCR-like raw text to verify the 4-tier matcher holds up.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from extraction import (
    extract_brand_name,
    extract_class_type,
    extract_alcohol_content,
    extract_net_contents,
    extract_government_warning,
)

IMAGE_SIZE = {"w": 1200, "h": 1800}
EMPTY_WORDS: list = []


# ─── Multi-line brand name ─────────────────────────────────────────────────────

class TestMultilineBrandName:
    """Label has brand name split across two visual lines."""

    def test_brand_split_across_lines(self):
        # "Old Tom\nDistillery" — how Azure/Tesseract returns multi-line text
        ocr_text = "Old Tom\nDistillery\n45% Alc. by Vol.\n750 mL"
        result = extract_brand_name(ocr_text, EMPTY_WORDS, IMAGE_SIZE, expected="Old Tom Distillery")
        assert result["found"] is True, f"Expected brand not found. text={ocr_text!r}"

    def test_brand_split_with_extra_whitespace(self):
        ocr_text = "Old  Tom\n\nDistillery"
        result = extract_brand_name(ocr_text, EMPTY_WORDS, IMAGE_SIZE, expected="Old Tom Distillery")
        assert result["found"] is True

    def test_brand_all_caps_multiline(self):
        ocr_text = "OLD TOM\nDISTILLERY"
        result = extract_brand_name(ocr_text, EMPTY_WORDS, IMAGE_SIZE, expected="Old Tom Distillery")
        assert result["found"] is True


# ─── Multi-line class/type ─────────────────────────────────────────────────────

class TestMultilineClassType:
    """Label has class/type split across two visual lines."""

    def test_class_type_split_across_lines(self):
        # Core scenario the user reported: "Kentucky Straight" on line 1, "Bourbon Whiskey" on line 2
        ocr_text = "OLD TOM DISTILLERY\nKentucky Straight\nBourbon Whiskey\n45% Alc. by Vol.\n750 mL"
        result = extract_class_type(
            ocr_text, EMPTY_WORDS, IMAGE_SIZE,
            expected="Kentucky Straight Bourbon Whiskey"
        )
        assert result["found"] is True, f"Multi-line class/type not found. text={ocr_text!r}"

    def test_class_type_all_caps_split(self):
        ocr_text = "KENTUCKY STRAIGHT\nBOURBON WHISKEY"
        result = extract_class_type(
            ocr_text, EMPTY_WORDS, IMAGE_SIZE,
            expected="Kentucky Straight Bourbon Whiskey"
        )
        assert result["found"] is True

    def test_class_type_single_line(self):
        # Should still work when on a single line
        ocr_text = "Kentucky Straight Bourbon Whiskey"
        result = extract_class_type(
            ocr_text, EMPTY_WORDS, IMAGE_SIZE,
            expected="Kentucky Straight Bourbon Whiskey"
        )
        assert result["found"] is True
        # Tier 1 exact match; bbox is None (no real words list) so conf = 0.70
        assert result["confidence"] >= 0.65

    def test_class_type_with_ocr_noise(self):
        # Tesseract sometimes inserts spurious characters in decorative fonts
        ocr_text = "Kentucky Stra1ght\nBourbon Wh1skey"
        result = extract_class_type(
            ocr_text, EMPTY_WORDS, IMAGE_SIZE,
            expected="Kentucky Straight Bourbon Whiskey"
        )
        # Should find via Tier 4 OCR correction (1→I)
        assert result["found"] is True

    def test_class_type_three_lines(self):
        # Some labels have three-line class declarations
        ocr_text = "Straight\nBourbon\nWhiskey"
        result = extract_class_type(
            ocr_text, EMPTY_WORDS, IMAGE_SIZE,
            expected="Straight Bourbon Whiskey"
        )
        assert result["found"] is True

    def test_wrong_class_type_not_found(self):
        ocr_text = "Tennessee Whiskey\n750 mL\n40% ABV"
        result = extract_class_type(
            ocr_text, EMPTY_WORDS, IMAGE_SIZE,
            expected="Kentucky Straight Bourbon Whiskey"
        )
        assert result["found"] is False


# ─── Realistic full-label OCR text ────────────────────────────────────────────

class TestFullLabelOcrText:
    """Simulate the full_text a real label produces after image_to_string()."""

    BOURBON_LABEL = (
        "OLD TOM\n"
        "DISTILLERY\n"
        "Kentucky Straight\n"
        "Bourbon Whiskey\n"
        "Aged 4 Years\n"
        "45% Alc. by Vol.  (90 Proof)\n"
        "750 mL\n"
        "GOVERNMENT WARNING: (1) According to the Surgeon General, "
        "women should not drink alcoholic beverages during pregnancy. "
        "(2) Consumption of alcoholic beverages impairs your ability to drive a car "
        "or operate machinery, and may cause health problems."
    )

    def test_brand_from_full_label(self):
        result = extract_brand_name(
            self.BOURBON_LABEL, EMPTY_WORDS, IMAGE_SIZE,
            expected="Old Tom Distillery"
        )
        assert result["found"] is True

    def test_class_type_from_full_label(self):
        result = extract_class_type(
            self.BOURBON_LABEL, EMPTY_WORDS, IMAGE_SIZE,
            expected="Kentucky Straight Bourbon Whiskey"
        )
        assert result["found"] is True

    def test_abv_from_full_label(self):
        result = extract_alcohol_content(self.BOURBON_LABEL, EMPTY_WORDS, IMAGE_SIZE)
        assert result["found"] is True
        assert "45" in result["value"]

    def test_net_contents_from_full_label(self):
        result = extract_net_contents(self.BOURBON_LABEL, EMPTY_WORDS, IMAGE_SIZE)
        assert result["found"] is True
        assert "750" in result["value"]

    def test_confidence_tier1_higher_than_tier3(self):
        # Exact phrase match should score higher than word-level match
        exact_text = "Kentucky Straight Bourbon Whiskey"
        multiline_text = "Kentucky Straight\nBourbon Whiskey"

        exact_result = extract_class_type(
            exact_text, EMPTY_WORDS, IMAGE_SIZE,
            expected="Kentucky Straight Bourbon Whiskey"
        )
        multi_result = extract_class_type(
            multiline_text, EMPTY_WORDS, IMAGE_SIZE,
            expected="Kentucky Straight Bourbon Whiskey"
        )

        assert exact_result["found"] is True
        assert multi_result["found"] is True
        # Exact phrase on one line scores higher than multi-line word match
        assert exact_result["confidence"] >= multi_result["confidence"]


# ─── Gin label variant ────────────────────────────────────────────────────────

# ─── Government warning capitalization ────────────────────────────────────────

class TestGovernmentWarningCapitalization:
    """TTB 27 CFR 16.21 requires GOVERNMENT WARNING in all caps."""

    def test_all_caps_passes(self):
        result = extract_government_warning(
            "GOVERNMENT WARNING: (1) According to the Surgeon General...",
            EMPTY_WORDS, IMAGE_SIZE,
        )
        assert result["found"] is True
        assert result["value"] == "GOVERNMENT WARNING present"
        assert result["confidence"] >= 0.90

    def test_mixed_case_is_flagged(self):
        # "Government Warning" on label — TTB violation
        result = extract_government_warning(
            "Government Warning: (1) According to the Surgeon General...",
            EMPTY_WORDS, IMAGE_SIZE,
        )
        assert result["found"] is True
        assert result["value"] != "GOVERNMENT WARNING present"
        assert result["confidence"] <= 0.55

    def test_lowercase_is_flagged(self):
        result = extract_government_warning(
            "government warning: women should not drink...",
            EMPTY_WORDS, IMAGE_SIZE,
        )
        assert result["found"] is True
        assert result["value"] != "GOVERNMENT WARNING present"
        assert result["confidence"] <= 0.55

    def test_mixed_case_produces_mismatch_in_comparison(self):
        from comparison import compare_field
        extraction = extract_government_warning(
            "Government Warning: (1) According to the Surgeon General...",
            EMPTY_WORDS, IMAGE_SIZE,
        )
        comparison = compare_field(
            "governmentWarning",
            extraction["value"],
            "GOVERNMENT WARNING",
            extraction["confidence"],
        )
        # Must NOT pass as a match — it's a labeling violation
        assert comparison["status"] != "match"
        assert comparison["needs_human"] is True

    def test_all_caps_produces_match_in_comparison(self):
        from comparison import compare_field
        extraction = extract_government_warning(
            "GOVERNMENT WARNING: (1) According to the Surgeon General...",
            EMPTY_WORDS, IMAGE_SIZE,
        )
        comparison = compare_field(
            "governmentWarning",
            extraction["value"],
            "GOVERNMENT WARNING",
            extraction["confidence"],
        )
        assert comparison["status"] == "match"
        assert comparison["needs_human"] is False

    def test_absent_is_not_found(self):
        result = extract_government_warning(
            "Old Tom Distillery Kentucky Straight Bourbon Whiskey 750 mL",
            EMPTY_WORDS, IMAGE_SIZE,
        )
        assert result["found"] is False


class TestGinLabel:
    GIN_LABEL = (
        "Harbour\n"
        "Spirits\n"
        "London Dry\n"
        "Gin\n"
        "40% Alc. by Vol.\n"
        "1 L\n"
        "GOVERNMENT WARNING: ..."
    )

    def test_gin_brand(self):
        result = extract_brand_name(
            self.GIN_LABEL, EMPTY_WORDS, IMAGE_SIZE,
            expected="Harbour Spirits"
        )
        assert result["found"] is True

    def test_gin_class_type(self):
        result = extract_class_type(
            self.GIN_LABEL, EMPTY_WORDS, IMAGE_SIZE,
            expected="London Dry Gin"
        )
        assert result["found"] is True

    def test_gin_liter_volume(self):
        result = extract_net_contents(self.GIN_LABEL, EMPTY_WORDS, IMAGE_SIZE)
        assert result["found"] is True
        assert "1" in result["value"]
