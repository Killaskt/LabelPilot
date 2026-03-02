"""
pytest configuration — exposes the user-supplied test image(s) as fixtures.

Place test images in worker/test-picture/.  These are committed to the repo
as they are generated/synthetic images, not real brand labels.
"""

import pytest
from pathlib import Path

TEST_PICTURE_DIR = Path(__file__).parent.parent / "test-picture"


def _find_images() -> list[Path]:
    if not TEST_PICTURE_DIR.exists():
        return []
    return sorted(
        p for p in TEST_PICTURE_DIR.iterdir()
        if p.suffix.lower() in {".jpg", ".jpeg", ".png"}
    )


@pytest.fixture(scope="session")
def test_label_path() -> Path | None:
    """
    First image found in worker/test-picture/.
    Tests that require an actual image will skip if none is present.
    """
    images = _find_images()
    return images[0] if images else None


@pytest.fixture(scope="session")
def all_test_label_paths() -> list[Path]:
    """All images in worker/test-picture/ — for batch integration tests."""
    return _find_images()
