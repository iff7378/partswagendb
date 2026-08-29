from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import ExpenseCategory, VehicleStatus
from app.models.base import TimestampMixin

if TYPE_CHECKING:
    from app.models.part import Part
    from app.models.user import User


class Vehicle(Base, TimestampMixin):
    __tablename__ = "vehicles"

    id: Mapped[int] = mapped_column(primary_key=True)
    vin: Mapped[str | None] = mapped_column(String(17), unique=True, index=True)
    stock_number: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)

    year: Mapped[int | None] = mapped_column(Integer)
    make: Mapped[str | None] = mapped_column(String(64), index=True)
    model: Mapped[str | None] = mapped_column(String(64), index=True)
    trim: Mapped[str | None] = mapped_column(String(64))
    engine: Mapped[str | None] = mapped_column(String(128))
    transmission: Mapped[str | None] = mapped_column(String(64))
    drive_type: Mapped[str | None] = mapped_column(String(32))
    body_style: Mapped[str | None] = mapped_column(String(64))
    color: Mapped[str | None] = mapped_column(String(32))
    mileage: Mapped[int | None] = mapped_column(Integer)

    status: Mapped[VehicleStatus] = mapped_column(
        String(16), default=VehicleStatus.ACQUIRED, nullable=False, index=True
    )
    acquired_on: Mapped[date | None] = mapped_column(Date)
    acquired_from: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)

    # Raw NHTSA vPIC response, kept so we can re-derive fields without re-fetching.
    decoded_data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_by: Mapped["User | None"] = relationship()

    parts: Mapped[list["Part"]] = relationship(back_populates="vehicle")
    expenses: Mapped[list["VehicleExpense"]] = relationship(
        back_populates="vehicle", cascade="all, delete-orphan"
    )

    @property
    def display_name(self) -> str:
        parts = [str(p) for p in (self.year, self.make, self.model, self.trim) if p]
        return " ".join(parts) or self.stock_number


class VehicleExpense(Base, TimestampMixin):
    """Money spent on a vehicle, tracked against whoever actually paid it."""

    __tablename__ = "vehicle_expenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    vehicle_id: Mapped[int | None] = mapped_column(
        ForeignKey("vehicles.id", ondelete="CASCADE"), index=True
    )
    vehicle: Mapped["Vehicle | None"] = relationship(back_populates="expenses")

    description: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[ExpenseCategory] = mapped_column(
        String(16), default=ExpenseCategory.OTHER, nullable=False
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    incurred_on: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    paid_by_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    paid_by: Mapped["User"] = relationship(foreign_keys=[paid_by_id])

    notes: Mapped[str | None] = mapped_column(Text)

    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_by: Mapped["User | None"] = relationship(foreign_keys=[created_by_id])
