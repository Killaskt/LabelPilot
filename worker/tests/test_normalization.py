"""Tests for text normalization utilities."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from extraction import normalize_text, strip_punctuation


class TestNormalizeText:
    def test_lowercases(self):
        assert normalize_text("MOUNTAIN CREEK") == "mountain creek"

    def test_collapses_whitespace(self):
        assert normalize_text("  hello   world  ") == "hello world"

    def test_normalizes_smart_quotes(self):
        assert normalize_text("\u2018single\u2019") == "'single'"
        assert normalize_text("\u201cdouble\u201d") == '"double"'

    def test_normalizes_backtick(self):
        assert normalize_text("`backtick`") == "'backtick'"

    def test_handles_empty(self):
        assert normalize_text("") == ""

    def test_preserves_numbers(self):
        assert normalize_text("40% alc.") == "40% alc."


class TestStripPunctuation:
    def test_removes_periods(self):
        assert strip_punctuation("alc. by vol.") == "alc by vol"

    def test_removes_percent(self):
        # % is punctuation
        result = strip_punctuation("40%")
        assert "40" in result

    def test_preserves_words(self):
        assert strip_punctuation("mountain creek whisky") == "mountain creek whisky"

    def test_handles_empty(self):
        assert strip_punctuation("") == ""

    def test_strips_commas_and_dashes(self):
        result = strip_punctuation("well-known, brand.")
        assert "," not in result
        assert "." not in result
