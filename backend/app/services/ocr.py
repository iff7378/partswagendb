import io
import logging
import re
from typing import Any

from PIL import Image, ImageFilter, ImageOps

from app.config import settings

logger = logging.getLogger(__name__)

# Tokens that look like part numbers but are almost always something else.
_NOISE = {
    "MADEIN",
    "MADE",
    "GERMANY",
    "JAPAN",
    "CHINA",
    "USA",
    "KOREA",
    "MEXICO",
    "ASSEMBLED",
}

# VW/Audi group style: "06A 906 461 L" — three digit-groups plus an optional index.
_VAG_PATTERN = re.compile(r"\b(\d[A-Z0-9]{2}\s?\d{3}\s?\d{3}\s?[A-Z]{0,2})\b")
# Bosch style: "0 280 218 002"
_BOSCH_PATTERN = re.compile(r"\b(\d\s?\d{3}\s?\d{3}\s?\d{3})\b")
# Generic: 6+ chars, letters and digits mixed, dashes allowed.
_GENERIC_PATTERN = re.compile(r"\b([A-Z0-9][A-Z0-9\-]{5,19})\b")


def _preprocess(image: Image.Image) -> Image.Image:
    """Grayscale, upscale and sharpen — stamped part numbers are low contrast."""
    image = ImageOps.exif_transpose(image)
    image = image.convert("L")
    image = ImageOps.autocontrast(image)
    if max(image.size) < 1600:
        scale = 1600 / max(image.size)
        image = image.resize((int(image.width * scale), int(image.height * scale)), Image.LANCZOS)
    return image.filter(ImageFilter.SHARPEN)


def extract_text(data: bytes) -> str | None:
    if not settings.ocr_enabled:
        return None
    try:
        import pytesseract

        with Image.open(io.BytesIO(data)) as image:
            return str(pytesseract.image_to_string(_preprocess(image)))
    except Exception:
        logger.warning("OCR failed", exc_info=True)
        return None


def find_part_numbers(text: str | None) -> list[dict[str, Any]]:
    """Rank plausible part numbers found in OCR output, best first."""
    if not text:
        return []

    upper = text.upper()
    scored: dict[str, int] = {}

    def consider(raw: str, score: int) -> None:
        candidate = re.sub(r"\s+", " ", raw).strip()
        squashed = candidate.replace(" ", "").replace("-", "")
        if len(squashed) < 6 or squashed in _NOISE:
            return
        # Needs at least one digit and cannot be purely numeric noise like a date.
        if not any(c.isdigit() for c in squashed):
            return
        scored[candidate] = max(scored.get(candidate, 0), score)

    for match in _VAG_PATTERN.finditer(upper):
        consider(match.group(1), 100)
    for match in _BOSCH_PATTERN.finditer(upper):
        consider(match.group(1), 90)
    for match in _GENERIC_PATTERN.finditer(upper):
        token = match.group(1)
        # Mixed letters and digits is a stronger signal than digits alone.
        has_alpha = any(c.isalpha() for c in token)
        consider(token, 60 if has_alpha else 40)

    ranked = sorted(scored.items(), key=lambda kv: (-kv[1], -len(kv[0])))
    return [{"value": value, "confidence": score} for value, score in ranked[:10]]


def process_photo(data: bytes) -> tuple[str | None, list[dict[str, Any]]]:
    text = extract_text(data)
    return text, find_part_numbers(text)
