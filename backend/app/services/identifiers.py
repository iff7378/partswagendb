import re
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Location, Part, Sale, Vehicle

_NON_ALNUM = re.compile(r"[^A-Z0-9]+")


def slugify_code(value: str) -> str:
    return _NON_ALNUM.sub("-", value.upper()).strip("-")


def _next_sequence(db: Session, model: type, column, prefix: str, width: int) -> str:  # type: ignore[no-untyped-def]
    """Allocate the next `PREFIX-000123` style identifier for a table."""
    pattern = f"{prefix}-%"
    latest = db.execute(select(func.max(column)).where(column.like(pattern))).scalar_one_or_none()

    next_number = 1
    if latest:
        tail = str(latest).rsplit("-", 1)[-1]
        if tail.isdigit():
            next_number = int(tail) + 1

    return f"{prefix}-{next_number:0{width}d}"


def next_part_sku(db: Session) -> str:
    return _next_sequence(db, Part, Part.sku, "P", 6)


def next_vehicle_stock_number(db: Session) -> str:
    year = datetime.now(UTC).strftime("%y")
    return _next_sequence(db, Vehicle, Vehicle.stock_number, f"V{year}", 4)


def next_sale_reference(db: Session) -> str:
    year = datetime.now(UTC).strftime("%y")
    return _next_sequence(db, Sale, Sale.reference, f"S{year}", 4)


def build_location_code(db: Session, name: str, parent: Location | None) -> str:
    """Derive a scannable code from the location name, prefixed by its parent."""
    base = slugify_code(name) or "LOC"
    if parent:
        base = f"{parent.code}-{base}"

    code = base
    suffix = 2
    while db.execute(select(Location.id).where(Location.code == code)).first():
        code = f"{base}-{suffix}"
        suffix += 1
    return code
