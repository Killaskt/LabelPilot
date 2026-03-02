"""Tests for comparison / mismatch classification."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from comparison import compare_field


class TestCompareField:
    # ─── Exact matches ────────────────────────────────────────────────────────

    def test_exact_match(self):
        result = compare_field("brandName", "Mountain Creek", "Mountain Creek", 0.9)
        assert result["status"] == "match"
        assert result["needs_human"] is False

    def test_case_insensitive_match(self):
        result = compare_field("brandName", "MOUNTAIN CREEK", "Mountain Creek", 0.9)
        assert result["status"] == "match"

    def test_whitespace_normalized_match(self):
        result = compare_field("brandName", "Mountain  Creek", "Mountain Creek", 0.9)
        assert result["status"] == "match"

    def test_contains_match_forward(self):
        # found value contains expected
        result = compare_field("alcoholContent", "40% alc. by vol.", "40%", 0.9)
        assert result["status"] == "match"

    def test_contains_match_reverse(self):
        # expected contains found
        result = compare_field("alcoholContent", "40%", "40% alc. by vol.", 0.9)
        assert result["status"] == "match"

    # ─── Soft mismatches ──────────────────────────────────────────────────────

    def test_soft_mismatch_punctuation(self):
        result = compare_field("brandName", "Mountain.Creek", "Mountain Creek", 0.7)
        # Strip punctuation makes them equal → soft_mismatch or match
        assert result["status"] in ("match", "soft_mismatch")

    def test_numeric_abv_close(self):
        # 40.0 vs 40.1 — within tolerance
        result = compare_field("alcoholContent", "40.0% alc. by vol.", "40.1% alc. by vol.", 0.9)
        assert result["status"] in ("match", "soft_mismatch")

    def test_numeric_abv_far(self):
        result = compare_field("alcoholContent", "35.0%", "40.0%", 0.9)
        assert result["status"] in ("mismatch", "soft_mismatch")
        assert result["needs_human"] is True

    # ─── Not found ────────────────────────────────────────────────────────────

    def test_none_value_is_not_found(self):
        result = compare_field("brandName", None, "Mountain Creek", 0.0)
        assert result["status"] == "not_found"
        assert result["needs_human"] is True

    # ─── Hard mismatches ──────────────────────────────────────────────────────

    def test_completely_different_values(self):
        result = compare_field("brandName", "Sunset Valley", "Mountain Creek", 0.8)
        assert result["status"] == "mismatch"
        assert result["needs_human"] is True

    def test_net_contents_mismatch(self):
        result = compare_field("netContents", "375 mL", "750 mL", 0.85)
        assert result["status"] in ("mismatch", "soft_mismatch")
        assert result["needs_human"] is True

    # ─── Government warning ───────────────────────────────────────────────────

    def test_government_warning_present(self):
        result = compare_field(
            "governmentWarning",
            "GOVERNMENT WARNING present",
            "GOVERNMENT WARNING",
            0.95,
        )
        assert result["status"] == "match"
        assert result["needs_human"] is False

    def test_government_warning_missing(self):
        result = compare_field("governmentWarning", None, "GOVERNMENT WARNING", 0.0)
        assert result["status"] == "not_found"
        assert result["needs_human"] is True
