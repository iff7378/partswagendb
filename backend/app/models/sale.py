from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import SaleChannel
from app.models.base import TimestampMixin

if TYPE_CHECKING:
    from app.models.part import Part
    from app.models.user import User


class Sale(Base, TimestampMixin):
    """A completed sale of one or more parts."""

    __tablename__ = "sales"

    id: Mapped[int] = mapped_column(primary_key=True)
    reference: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)

    sold_on: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    channel: Mapped[SaleChannel] = mapped_column(
        String(16), default=SaleChannel.LOCAL, nullable=False
    )
    buyer_name: Mapped[str | None] = mapped_column(String(255))
    buyer_contact: Mapped[str | None] = mapped_column(String(255))

    shipping: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), nullable=False)
    fees: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), nullable=False)
    tax: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"), nullable=False)

    # Who physically received the money. Drives the settle-up report.
    collected_by_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    collected_by: Mapped["User"] = relationship(foreign_keys=[collected_by_id])

    payment_method: Mapped[str | None] = mapped_column(String(32))
    notes: Mapped[str | None] = mapped_column(Text)

    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_by: Mapped["User | None"] = relationship(foreign_keys=[created_by_id])

    items: Mapped[list["SaleItem"]] = relationship(
        back_populates="sale", cascade="all, delete-orphan"
    )

    @property
    def subtotal(self) -> Decimal:
        return sum((item.line_total for item in self.items), Decimal("0"))

    @property
    def net_collected(self) -> Decimal:
        """Cash that actually landed in the collector's pocket."""
        return self.subtotal + self.shipping + self.tax - self.fees


class SaleItem(Base, TimestampMixin):
    __tablename__ = "sale_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    sale_id: Mapped[int] = mapped_column(
        ForeignKey("sales.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sale: Mapped["Sale"] = relationship(back_populates="items")

    part_id: Mapped[int | None] = mapped_column(
        ForeignKey("parts.id", ondelete="SET NULL"), index=True
    )
    part: Mapped["Part | None"] = relationship(back_populates="sale_items")

    # Snapshot so the sale record survives the part being edited or deleted.
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    @property
    def line_total(self) -> Decimal:
        return self.unit_price * self.quantity
