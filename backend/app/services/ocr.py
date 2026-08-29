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

# Tesseract routinely reads stamped digits as their letter lookalikes, so digit
# positions accept both and are folded back to digits once matched.
_DIGIT_LOOKALIKES = str.maketrans(
    {"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "S": "5", "B": "8", "G": "6", "Z": "2"}
)
_D = "0-9OQDILSBGZ"

# VW/Audi group style: "06A 906 461 L" — three digit groups plus an optional index.
_VAG_PATTERN = re.compile(
    rf"\b([{_D}][A-Z0-9]{{2}})\s?([{_D}]{{3}})\s?([{_D}]{{3}})\s?([A-Z]{{0,2}})\b"
)
# Bosch style: "0 280 218 002"
_BOSCH_PATTERN = re.compile(rf"\b([{_D}])\s?([{_D}]{{3}})\s?([{_D}]{{3}})\s?([{_D}]{{3}})\b")
# Generic: 6+ chars, letters and digits mixed, dashes allowed.
_GENERIC_PATTERN = re.compile(r"\b([A-Z0-9][A-Z0-9\-]{5,19})\b")

# Below this many real digits a lookalike match is almost certainly a word.
_MIN_REAL_DIGITS = 2


def _to_digits(text: str) -> str:
    return text.translate(_DIGIT_LOOKALIKES)


def _real_digit_count(text: str) -> int:
    return sum(1 for c in text if c.isdigit())


def _preprocess(image: Image.Image) -> Image.Image:
    """Grayscale, upscale and sharpen — stamped part numbers are low contrast."""
    image = ImageOps.exif_transpose(image)
    image = image.convert("L")
    image = ImageOps.autocontrast(image)
    if max(image.size) < 1600:
        scale = 1600 / max(image.size)
        image = image.resize(
            (int(image.width * scale), int(image.height * scale)), Image.Resampling.LANCZOS
        )
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
    found: list[tuple[str, int, tuple[int, int]]] = []

    def consider(raw: str, score: int, span: tuple[int, int]) -> None:
        candidate = re.sub(r"\s+", " ", raw).strip()
        squashed = candidate.replace(" ", "").replace("-", "")
        if len(squashed) < 6 or squashed in _NOISE:
            return
        # Needs at least one digit and cannot be purely numeric noise like a date.
        if not any(c.isdigit() for c in squashed):
            return
        found.append((candidate, score, span))

    for match in _VAG_PATTERN.finditer(upper):
        if _real_digit_count(match.group(0)) < _MIN_REAL_DIGITS:
            continue
        prefix, mid, tail, index = match.groups()
        # Only the first character of the prefix is a digit position; the index
        # suffix is genuinely a letter and must survive untouched.
        rebuilt = f"{_to_digits(prefix[0])}{prefix[1:]} {_to_digits(mid)} {_to_digits(tail)}"
        consider(f"{rebuilt} {index}" if index else rebuilt, 100, match.span())

    for match in _BOSCH_PATTERN.finditer(upper):
        if _real_digit_count(match.group(0)) < _MIN_REAL_DIGITS:
            continue
        consider(" ".join(_to_digits(group) for group in match.groups()), 90, match.span())

    for match in _GENERIC_PATTERN.finditer(upper):
        token = match.group(1)
        # Mixed letters and digits is a stronger signal than digits alone.
        has_alpha = any(c.isalpha() for c in token)
        consider(token, 60 if has_alpha else 40, match.span())

    # A pattern can match a fragment of a longer number it does not fully
    # understand, so a match sitting inside another match is discarded.
    kept: dict[str, int] = {}
    for candidate, score, (start, end) in found:
        contained = any(
            other_start <= start and end <= other_end and (other_end - other_start) > (end - start)
            for _, _, (other_start, other_end) in found
        )
        if contained:
            continue
        kept[candidate] = max(kept.get(candidate, 0), score)

    ranked = sorted(kept.items(), key=lambda kv: (-kv[1], -len(kv[0])))
    return [{"value": value, "confidence": score} for value, score in ranked[:10]]


def process_photo(data: bytes) -> tuple[str | None, list[dict[str, Any]]]:
    text = extract_text(data)
    return text, find_part_numbers(text)
