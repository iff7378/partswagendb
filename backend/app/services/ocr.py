import io
import logging
import re
from typing import Any

from PIL import Image, ImageOps

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

# Long-edge size fed to Tesseract. Large enough to keep characters legible,
# small enough that sensor noise from a phone camera averages out.
TARGET_LONG_EDGE_PX = 1600


def _to_digits(text: str) -> str:
    return text.translate(_DIGIT_LOOKALIKES)


def _real_digit_count(text: str) -> int:
    return sum(1 for c in text if c.isdigit())


def _preprocess(image: Image.Image) -> Image.Image:
    """Normalise a photo to the size and form Tesseract reads best.

    Resolution matters far more than contrast here. A 12MP phone photo left at
    full size fails outright — Tesseract latches onto sensor noise instead of
    the label, taking seconds and returning nothing. Scaling the long edge to
    ~1600px averages that noise away and makes the text dominant, which turns a
    3.5s miss into a 0.3s hit on the same image.

    Small images are still scaled up, since a tiny crop gives Tesseract too few
    pixels per character.

    Deliberately no sharpening. It looks like it should help a faint stamped
    number, and it is harmless on a clean close-up, but on a real photo it
    re-amplifies the sensor noise the downscale just removed and Tesseract goes
    back to reading nothing.
    """
    image = ImageOps.exif_transpose(image)
    image = image.convert("L")

    longest = max(image.size)
    if longest != TARGET_LONG_EDGE_PX:
        scale = TARGET_LONG_EDGE_PX / longest
        image = image.resize(
            (max(1, int(image.width * scale)), max(1, int(image.height * scale))),
            Image.Resampling.LANCZOS,
        )

    return ImageOps.autocontrast(image)


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


# A VIN is 17 characters and deliberately excludes I, O and Q so they cannot be
# confused with 1 and 0 — which means any of those the OCR reports is certainly
# a misread digit.
_VIN_LOOKALIKES = str.maketrans({"I": "1", "O": "0", "Q": "0"})
_VIN_PATTERN = re.compile(r"\b([A-HJ-NPR-Z0-9IOQ]{17})\b")


def find_vins(text: str | None) -> list[str]:
    """Pull candidate VINs out of OCR output, best first.

    Registration stickers and titles print the VIN plainly, so this is far more
    reliable than reading a stamped part number.
    """
    if not text:
        return []

    seen: list[str] = []
    for match in _VIN_PATTERN.finditer(text.upper()):
        vin = match.group(1).translate(_VIN_LOOKALIKES)
        # A real VIN mixes letters and digits; 17 digits is a serial number.
        if vin.isdigit() or vin.isalpha():
            continue
        if vin not in seen:
            seen.append(vin)
    return seen


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
