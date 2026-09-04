from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import JsonColumn

if TYPE_CHECKING:
    from app.models.user import User


class AuditEntry(Base):
    """An append-only record of who changed what.

    Written by a SQLAlchemy flush listener rather than by each endpoint. Doing
    it per endpoint means every new write path is a chance to forget, and a
    half-kept audit trail is worse than none: it reads as complete.

    Never updated or deleted. The rows are the evidence.
    """

    __tablename__ = "audit_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    # Null when something happened outside a request, such as first-run seeding.
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    user: Mapped["User | None"] = relationship()
    # Kept as text as well: the point of an audit trail is to survive the
    # account being renamed or removed.
    user_name: Mapped[str | None] = mapped_column(String(255))

    action: Mapped[str] = mapped_column(String(16), nullable=False)  # created/updated/deleted
    entity: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    entity_id: Mapped[int | None] = mapped_column(Integer, index=True)
    # How a person would refer to it: "S26-0004", "P-000012", "The silver wagon".
    label: Mapped[str | None] = mapped_column(String(255))

    # {"field": {"from": x, "to": y}} for an update; the whole row otherwise.
    changes: Mapped[dict[str, Any] | None] = mapped_column(JsonColumn)
