from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Table,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import SaleChannel, SaleState
from app.models.base import TimestampMixin

if TYPE_CHECKING:
    from app.models.part import Part
    from app.models.user import User
    from app.models.vehicle import Vehicle


sale_item_parts = Table(
    "sale_item_parts",
    Base.metadata,
    Column("sale_item_id", ForeignKey("sale_items.id", ondelete="CASCADE"), primary_key=True),
    Column("part_id", ForeignKey("parts.id", ondelete="CASCADE"), primary_key=True),
)


class Sale(Base, TimestampMixin):
    """A sale, from the handshake through to the money landing."""

    __tablename__ = "sales"

    id: Mapped[int] = mapped_column(primary_key=True)
    reference: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)

    # When it was agreed. The two dates below are what actually move things:
    # paid_on puts the money on the ledger, fulfilled_on takes the stock away.
    sold_on: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    paid_on: Mapped[date | None] = mapped_column(Date, index=True)
    fulfilled_on: Mapped[date | None] = mapped_column(Date, index=True)

    # When the buyer said they would turn up. Most of this trade is arranged
    # over Messenger, so the handover time lives here rather than in someone's
    # phone. Stored with an offset so it survives a device in another zone.
    meetup_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
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
    def state(self) -> SaleState:
        if self.paid_on and self.fulfilled_on:
            return SaleState.COMPLETE
        if self.paid_on:
            return SaleState.PAID
        if self.fulfilled_on:
            return SaleState.GONE
        return SaleState.PENDING

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

    # A line covers however many parts went for one price. One part is the
    # common case; several is a lot ("the whole interior"); none is either a
    # shell or something that was never catalogued.
    parts: Mapped[list["Part"]] = relationship(
        secondary=sale_item_parts, back_populates="sale_items"
    )

    # Which car the money belongs to. Set for a lot or a shell, where there is
    # no part to derive it from, so the car's profit still adds up.
    vehicle_id: Mapped[int | None] = mapped_column(
        ForeignKey("vehicles.id", ondelete="SET NULL"), index=True
    )
    vehicle: Mapped["Vehicle | None"] = relationship(back_populates="sale_items")

    # The car itself went to the yard, as opposed to a lot of parts off it.
    # Only this flips the car to scrapped.
    is_shell: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Snapshot so the sale record survives the part being edited or deleted.
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    @property
    def line_total(self) -> Decimal:
        return self.unit_price * self.quantity
