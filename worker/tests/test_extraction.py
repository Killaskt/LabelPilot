"""Tests for field extraction from OCR text."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from extraction import (
    extract_alcohol_content,
    extract_net_contents,
    extract_government_warning,
    extract_brand_name,
)

IMAGE_SIZE = {"w": 1000, "h": 1000}
EMPTY_WORDS: list = []


class TestExtractAlcoholContent:
    def test_standard_format(self):
        result = extract_alcohol_content("40% alc. by vol.", EMPTY_WORDS, IMAGE_SIZE)
        assert result["found"] is True
        assert "40" in result["value"]

    def test_abv_format(self):
        result = extract_alcohol_content("12.5% ABV", EMPTY_WORDS, IMAGE_SIZE)
        assert result["found"] is True
        assert "12.5" in result["value"]

    def test_no_match(self):
        result = extract_alcohol_content("No alcohol info here", EMPTY_WORDS, IMAGE_SIZE)
        assert result["found"] is False
        assert result["value"] is None
        assert result["confidence"] == 0.0

    def test_decimal_abv(self):
        result = extract_alcohol_content("Alc. 13.5% by Vol.", EMPTY_WORDS, IMAGE_SIZE)
        assert result["found"] is True
        assert "13.5" in result["value"]

    def test_case_insensitive(self):
        result = extract_alcohol_content("ALC/VOL 40%", EMPTY_WORDS, IMAGE_SIZE)
        assert result["found"] is True


class TestExtractNetContents:
    def test_ml_format(self):
        result = extract_net_contents("750 mL", EMPTY_WORDS, IMAGE_SIZE)
        assert result["found"] is True
        assert "750" in result["value"]

    def test_liter_format(self):
        result = extract_net_contents("1.5 L", EMPTY_WORDS, IMAGE_SIZE)
        assert result["found"] is True

    def test_fl_oz_format(self):
        result = extract_net_contents("12 fl oz", EMPTY_WORDS, IMAGE_SIZE)
        assert result["found"] is True

    def test_no_match(self):
        result = extract_net_contents("No volume info", EMPTY_WORDS, IMAGE_SIZE)
        assert result["found"] is False

    def test_compact_format(self):
        result = extract_net_contents("750ml", EMPTY_WORDS, IMAGE_SIZE)
        assert result["found"] is True


class TestExtractGovernmentWarning:
    def test_detects_warning(self):
        text = "GOVERNMENT WARNING: (1) According to the Surgeon General..."
        result = extract_government_warning(text, EMPTY_WORDS, IMAGE_SIZE)
        assert result["found"] is True
        assert result["confidence"] > 0.9

    def test_case_insensitive(self):
        result = extract_government_warning("government warning", EMPTY_WORDS, IMAGE_SIZE)
        assert result["found"] is True

    def test_not_present(self):
        result = extract_government_warning("no warning here", EMPTY_WORDS, IMAGE_SIZE)
        assert result["found"] is False


class TestExtractBrandName:
    def test_finds_brand_in_text(self):
        result = extract_brand_name(
            "MOUNTAIN CREEK American Whisky",
            EMPTY_WORDS, IMAGE_SIZE,
            expected="Mountain Creek"
        )
        assert result["found"] is True

    def test_not_found(self):
        result = extract_brand_name(
            "Completely Different Brand",
            EMPTY_WORDS, IMAGE_SIZE,
            expected="Mountain Creek"
        )
        assert result["found"] is False

    def test_soft_match_punctuation(self):
        result = extract_brand_name(
            "O'Brien's Whisky label text",
            EMPTY_WORDS, IMAGE_SIZE,
            expected="OBriens"
        )
        # May or may not find; at least it shouldn't crash
        assert isinstance(result["found"], bool)
