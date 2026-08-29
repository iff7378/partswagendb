from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Date, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class Settlement(Base, TimestampMixin):
    """A recorded partner-to-partner payment that zeroes out a period's balances.

    Settle-up math only counts expenses and sales dated on or before `period_end`,
    so recording one of these makes the next period start from a clean slate.
    """

    __tablename__ = "settlements"

    id: Mapped[int] = mapped_column(primary_key=True)

    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    paid_on: Mapped[date] = mapped_column(Date, nullable=False)

    from_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    from_user: Mapped["User"] = relationship(foreign_keys=[from_user_id])

    to_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    to_user: Mapped["User"] = relationship(foreign_keys=[to_user_id])

    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    method: Mapped[str | None] = mapped_column(String(32))
    notes: Mapped[str | None] = mapped_column(Text)

    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_by: Mapped["User | None"] = relationship(foreign_keys=[created_by_id])
