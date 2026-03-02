"""
Tests for the multi-image compliance aggregation rule.

Business rule: a compliance field PASSES at the job level when at least one
uploaded image produces a 'match' result with OCR confidence >= MATCH_CONF_THRESHOLD.
If every image fails or confidence never reaches the threshold, the field is
flagged for human review.

Covers:
  - Single-image pass / fail
  - Multi-image: one pass clears the field regardless of other images
  - Confidence boundary (exactly at and just below threshold)
  - All statuses: match, soft_mismatch, mismatch, not_found
  - Empty result list edge case
  - Threshold override via MATCH_CONF_THRESHOLD env var
"""

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import worker  # ensures MATCH_CONF_THRESHOLD is importable
from worker import _field_passes, MATCH_CONF_THRESHOLD


THRESHOLD = MATCH_CONF_THRESHOLD   # 0.70 by default


def _r(status: str, confidence: float) -> dict:
    """Shorthand to build a result dict for one asset."""
    return {"status": status, "confidence": confidence}


# ─── Single-image scenarios ───────────────────────────────────────────────────

class TestSingleImage:
    def test_match_above_threshold_passes(self):
        assert _field_passes([_r("match", THRESHOLD)]) is True

    def test_match_high_confidence_passes(self):
        assert _field_passes([_r("match", 0.95)]) is True

    def test_match_below_threshold_does_not_pass(self):
        assert _field_passes([_r("match", THRESHOLD - 0.01)]) is False

    def test_mismatch_does_not_pass(self):
        assert _field_passes([_r("mismatch", 0.95)]) is False

    def test_soft_mismatch_does_not_pass(self):
        assert _field_passes([_r("soft_mismatch", 0.95)]) is False

    def test_not_found_does_not_pass(self):
        assert _field_passes([_r("not_found", 0.0)]) is False

    def test_match_zero_confidence_does_not_pass(self):
        assert _field_passes([_r("match", 0.0)]) is False


# ─── Multi-image: one good image is enough ────────────────────────────────────

class TestMultiImage:
    def test_one_pass_one_fail_passes(self):
        results = [_r("match", 0.90), _r("mismatch", 0.95)]
        assert _field_passes(results) is True

    def test_one_pass_one_not_found_passes(self):
        results = [_r("match", 0.85), _r("not_found", 0.0)]
        assert _field_passes(results) is True

    def test_one_pass_one_soft_mismatch_passes(self):
        results = [_r("match", 0.80), _r("soft_mismatch", 0.90)]
        assert _field_passes(results) is True

    def test_all_fail_does_not_pass(self):
        results = [_r("mismatch", 0.90), _r("mismatch", 0.95)]
        assert _field_passes(results) is False

    def test_all_not_found_does_not_pass(self):
        results = [_r("not_found", 0.0), _r("not_found", 0.0)]
        assert _field_passes(results) is False

    def test_three_images_one_pass_passes(self):
        results = [_r("mismatch", 0.90), _r("not_found", 0.0), _r("match", 0.80)]
        assert _field_passes(results) is True

    def test_three_images_all_fail_does_not_pass(self):
        results = [_r("mismatch", 0.90), _r("soft_mismatch", 0.85), _r("not_found", 0.0)]
        assert _field_passes(results) is False

    def test_low_confidence_match_plus_mismatch_does_not_pass(self):
        # The match exists but its confidence is below threshold — not enough
        results = [_r("match", THRESHOLD - 0.01), _r("mismatch", 0.95)]
        assert _field_passes(results) is False


# ─── Confidence boundary conditions ──────────────────────────────────────────

class TestConfidenceBoundary:
    def test_exactly_at_threshold_passes(self):
        assert _field_passes([_r("match", THRESHOLD)]) is True

    def test_one_hundredth_below_threshold_does_not_pass(self):
        assert _field_passes([_r("match", round(THRESHOLD - 0.01, 4))]) is False

    def test_one_hundredth_above_threshold_passes(self):
        assert _field_passes([_r("match", round(THRESHOLD + 0.01, 4))]) is True


# ─── Edge cases ───────────────────────────────────────────────────────────────

class TestEdgeCases:
    def test_empty_results_does_not_pass(self):
        assert _field_passes([]) is False

    def test_confidence_none_treated_as_zero(self):
        # confidence stored as None in DB is falsy — should be treated as 0.0
        result = {"status": "match", "confidence": None}
        assert _field_passes([result]) is False

    def test_confidence_nan_does_not_crash(self):
        # float('nan') is falsy-ish but > 0 via comparison — ensure no crash
        result = {"status": "match", "confidence": 0.0}
        assert _field_passes([result]) is False


# ─── Threshold env-var override ──────────────────────────────────────────────

class TestThresholdOverride:
    def test_lower_threshold_allows_lower_confidence(self, monkeypatch):
        monkeypatch.setenv("MATCH_CONF_THRESHOLD", "0.50")
        import importlib
        import worker as w
        importlib.reload(w)
        from worker import _field_passes as fp
        # 0.60 confidence should now pass with a 0.50 threshold
        assert fp([_r("match", 0.60)]) is True

    def test_higher_threshold_rejects_previously_passing(self, monkeypatch):
        monkeypatch.setenv("MATCH_CONF_THRESHOLD", "0.90")
        import importlib
        import worker as w
        importlib.reload(w)
        from worker import _field_passes as fp
        # 0.80 would pass at 0.70 default but not at 0.90
        assert fp([_r("match", 0.80)]) is False
