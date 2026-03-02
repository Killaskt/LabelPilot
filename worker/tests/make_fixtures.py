"""
Generate synthetic label images for automated tests.

Run directly to regenerate:
    python tests/make_fixtures.py

Or imported by conftest.py to auto-create missing fixtures before tests run.

Images are plain white backgrounds with black text — minimal, deterministic,
and readable by both Tesseract and Azure AI Vision.  Each image is < 50 KB
and safe to commit to the repository.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def _font(size: int):
    """Return a PIL font — falls back to default if no TTF available."""
    try:
        # Arial is available on Windows; Liberation Sans on Linux/CI
        for name in ("arial.ttf", "Arial.ttf", "LiberationSans-Regular.ttf",
                     "DejaVuSans.ttf"):
            try:
                return ImageFont.truetype(name, size)
            except (IOError, OSError):
                continue
    except Exception:
        pass
    return ImageFont.load_default()


def _make_label(
    path: Path,
    lines: list[tuple[str, int]],   # [(text, font_size), ...]
    width: int = 600,
    padding: int = 40,
    line_gap: int = 12,
) -> Path:
    """Render lines of text onto a white image and save as PNG."""
    draw_dummy = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    total_height = padding * 2
    rendered = []
    for text, size in lines:
        font = _font(size)
        bbox = draw_dummy.textbbox((0, 0), text, font=font)
        h = bbox[3] - bbox[1]
        rendered.append((text, font, h))
        total_height += h + line_gap

    img = Image.new("RGB", (width, max(total_height, 200)), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    y = padding
    for text, font, h in rendered:
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        x = (width - text_w) // 2
        draw.text((x, y), text, fill=(0, 0, 0), font=font)
        y += h + line_gap

    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="PNG", optimize=True)
    return path


def make_bourbon_label(dest: Path | None = None) -> Path:
    """
    Bourbon label with multi-line brand and class/type — the main regression fixture.

    Brand:     "Old Tom Distillery"  (split across 2 lines)
    Class:     "Kentucky Straight Bourbon Whiskey"  (split across 2 lines)
    ABV:       "45% Alc. by Vol."
    Volume:    "750 mL"
    Warning:   short GOVERNMENT WARNING
    """
    dest = dest or FIXTURES_DIR / "bourbon_label.png"
    return _make_label(dest, [
        ("OLD TOM",                              48),
        ("DISTILLERY",                           36),
        ("",                                      8),   # spacer
        ("Kentucky Straight",                    28),
        ("Bourbon Whiskey",                      28),
        ("",                                      8),
        ("45% Alc. by Vol.  (90 Proof)",         20),
        ("750 mL",                               20),
        ("",                                      8),
        ("GOVERNMENT WARNING: (1) According to the Surgeon General,", 11),
        ("women should not drink alcoholic beverages during pregnancy.", 11),
    ])


def make_gin_label(dest: Path | None = None) -> Path:
    """
    Gin label — second fixture for variety.

    Brand:     "Harbour Spirits"
    Class:     "London Dry Gin"
    """
    dest = dest or FIXTURES_DIR / "gin_label.png"
    return _make_label(dest, [
        ("Harbour",          44),
        ("Spirits",          44),
        ("",                  8),
        ("London Dry",       26),
        ("Gin",              26),
        ("",                  8),
        ("40% Alc. by Vol.", 20),
        ("1 L",              20),
        ("",                  8),
        ("GOVERNMENT WARNING: (1) According to the Surgeon General,", 11),
        ("women should not drink during pregnancy.", 11),
    ])


def generate_all() -> list[Path]:
    paths = [make_bourbon_label(), make_gin_label()]
    for p in paths:
        kb = p.stat().st_size / 1024
        print(f"  {p.name}  ({kb:.0f} KB)")
    return paths


if __name__ == "__main__":
    print("Generating test fixtures...")
    generate_all()
    print("Done.")
