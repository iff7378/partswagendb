from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import TimestampMixin

if TYPE_CHECKING:
    from app.models.part import Part
    from app.models.sale import Sale
    from app.models.user import User
    from app.models.vehicle import Vehicle


class Task(Base, TimestampMixin):
    """Something that needs doing, usually to a particular record.

    Anchored to a part, sale or car rather than floating free: every real
    example is "photograph *this*" or "pack *that*", and an anchored task can
    be opened from the thing it is about and vice versa.
    """

    __tablename__ = "tasks"
    __table_args__ = (
        # At most one anchor. A task about both a part and a sale would have no
        # sensible place to appear, and nowhere obvious to click through to.
        CheckConstraint(
            "(CASE WHEN part_id IS NOT NULL THEN 1 ELSE 0 END"
            " + CASE WHEN sale_id IS NOT NULL THEN 1 ELSE 0 END"
            " + CASE WHEN vehicle_id IS NOT NULL THEN 1 ELSE 0 END) <= 1",
            name="ck_tasks_single_anchor",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)

    # Null means anyone: a shared pile both partners can pick from. Capturing a
    # job without first deciding who does it is most of the value.
    assigned_to_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    assigned_to: Mapped["User | None"] = relationship(foreign_keys=[assigned_to_id])

    # A day, not a time. Most of these are "sometime Thursday", and a time
    # nobody means turns into noise on the schedule.
    due_on: Mapped[date | None] = mapped_column(Date, index=True)

    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    done_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    done_by: Mapped["User | None"] = relationship(foreign_keys=[done_by_id])

    part_id: Mapped[int | None] = mapped_column(
        ForeignKey("parts.id", ondelete="CASCADE"), index=True
    )
    part: Mapped["Part | None"] = relationship()
    sale_id: Mapped[int | None] = mapped_column(
        ForeignKey("sales.id", ondelete="CASCADE"), index=True
    )
    sale: Mapped["Sale | None"] = relationship()
    vehicle_id: Mapped[int | None] = mapped_column(
        ForeignKey("vehicles.id", ondelete="CASCADE"), index=True
    )
    vehicle: Mapped["Vehicle | None"] = relationship()

    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_by: Mapped["User | None"] = relationship(foreign_keys=[created_by_id])

    @property
    def is_done(self) -> bool:
        return self.done_at is not None

    @property
    def is_overdue(self) -> bool:
        """Past its day and still not done."""
        if self.due_on is None or self.done_at is not None:
            return False
        return self.due_on < date.today()
