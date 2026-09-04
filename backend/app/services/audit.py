"""Recording who changed what, from the session itself.

Deliberately not done in the endpoints. Every write path added later would be
another chance to forget, and this codebase has already shipped one bug of
exactly that shape -- the scrap panel that was never told about `is_shell`. A
flush listener sees every write whether or not anyone remembered it exists.
"""

import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import event, insert, inspect
from sqlalchemy.orm import Session

from app.models import AuditEntry

logger = logging.getLogger(__name__)

# Key under which the auth dependency stashes who is making the request.
#
# Kept on the session rather than in a ContextVar: FastAPI runs sync
# dependencies and sync endpoints as separate threadpool tasks, each with its
# own copy of the context, so a value set in one is invisible to the other.
# The session is one object for the whole request, and it is what the flush
# listener already has in hand.
ACTOR_KEY = "audit_actor"


def set_actor(session: Session, user_id: int, name: str) -> None:
    session.info[ACTOR_KEY] = (user_id, name)


# What is worth a trail. Photos and tags churn constantly and say nothing about
# money or stock, so they are left out to keep the history readable.
AUDITED = {
    "Sale": ("reference", "id"),
    "SaleItem": ("description", "id"),
    "Vehicle": ("stock_number", "id"),
    "VehicleExpense": ("description", "id"),
    "Part": ("sku", "id"),
    "Settlement": ("id",),
    "User": ("email", "id"),
    "Location": ("code", "id"),
}

# Noise: these move on every write and would bury the fields that matter.
SKIP_FIELDS = {"updated_at", "created_at"}


def _label(obj: Any, fields: tuple[str, ...]) -> str | None:
    for field in fields:
        value = getattr(obj, field, None)
        if value:
            return str(value)
    return None


def _plain(value: Any) -> Any:
    """JSON-safe, and readable by a person rather than a debugger."""
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime | date):
        return value.isoformat()
    if value is None or isinstance(value, str | int | float | bool):
        return value
    return str(value)


def _snapshot(obj: Any) -> dict[str, Any]:
    state = inspect(obj)
    return {
        attr.key: _plain(getattr(obj, attr.key))
        for attr in state.mapper.column_attrs
        if attr.key not in SKIP_FIELDS
    }


def _diff(obj: Any) -> dict[str, Any]:
    """Only what actually moved, with both sides of it."""
    state = inspect(obj)
    changes: dict[str, Any] = {}
    for attr in state.mapper.column_attrs:
        if attr.key in SKIP_FIELDS:
            continue
        history = state.attrs[attr.key].history
        if not history.has_changes():
            continue
        before = history.deleted[0] if history.deleted else None
        after = history.added[0] if history.added else None
        if before == after:
            continue
        changes[attr.key] = {"from": _plain(before), "to": _plain(after)}
    return changes


def _pending(session: Session) -> list[tuple[Any, str, dict[str, Any]]]:
    """What this flush is about to write, with the diffs while they still exist.

    Attribute history is only available before the flush; afterwards it has
    been reset and the old values are unrecoverable.
    """
    found: list[tuple[Any, str, dict[str, Any]]] = []

    for obj in session.new:
        if not isinstance(obj, AuditEntry) and type(obj).__name__ in AUDITED:
            found.append((obj, "created", _snapshot(obj)))

    for obj in session.dirty:
        if isinstance(obj, AuditEntry) or type(obj).__name__ not in AUDITED:
            continue
        if not session.is_modified(obj):
            continue
        if changes := _diff(obj):
            found.append((obj, "updated", changes))

    for obj in session.deleted:
        if not isinstance(obj, AuditEntry) and type(obj).__name__ in AUDITED:
            found.append((obj, "deleted", _snapshot(obj)))

    return found


@event.listens_for(Session, "before_flush")
def _before_flush(session: Session, _flush_context: object, _instances: object) -> None:
    try:
        session.info.setdefault("audit_pending", []).extend(_pending(session))
    except Exception:
        # An audit failure must never take a sale down with it. Losing an entry
        # is bad; refusing to record the sale is worse.
        logger.exception("Could not collect audit entries")


@event.listens_for(Session, "after_flush")
def _after_flush(session: Session, _flush_context: object) -> None:
    """Write the rows once the ids exist.

    A new row has no primary key until the flush has run, so collecting the
    changes and writing them are necessarily two steps. Written with a Core
    insert rather than by adding ORM objects: new objects added during a flush
    are not picked up by it, and would sit unwritten until something else
    happened to trigger another one.
    """
    pending = session.info.pop("audit_pending", [])
    if not pending:
        return

    try:
        actor = session.info.get(ACTOR_KEY)
        rows = [
            {
                "user_id": actor[0] if actor else None,
                "user_name": actor[1] if actor else None,
                "action": action,
                "entity": type(obj).__name__,
                "entity_id": getattr(obj, "id", None),
                "label": _label(obj, AUDITED[type(obj).__name__]),
                "changes": changes or None,
            }
            for obj, action, changes in pending
        ]
        session.execute(insert(AuditEntry), rows)
    except Exception:
        logger.exception("Could not write audit entries")
