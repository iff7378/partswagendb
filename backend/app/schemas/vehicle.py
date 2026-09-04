from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.enums import ExpenseCategory, VehicleStatus
from app.schemas.common import ORMModel
from app.schemas.user import UserBrief

VIN_LENGTH = 17
# I, O and Q are excluded from the VIN alphabet to avoid confusion with 1 and 0.
VIN_INVALID_CHARS = set("IOQ")


def normalise_vin(value: str | None) -> str | None:
    if value is None:
        return None
    vin = value.strip().upper()
    if not vin:
        return None
    if len(vin) != VIN_LENGTH:
        raise ValueError(f"VIN must be {VIN_LENGTH} characters")
    if not vin.isalnum() or VIN_INVALID_CHARS & set(vin):
        raise ValueError("VIN contains invalid characters")
    return vin


class VehicleBase(BaseModel):
    vin: str | None = None
    vin_unknown: bool = False
    nickname: str | None = Field(default=None, max_length=64)
    year: int | None = Field(default=None, ge=1900, le=2100)
    make: str | None = None
    model: str | None = None
    trim: str | None = None
    engine: str | None = None
    transmission: str | None = None
    drive_type: str | None = None
    body_style: str | None = None
    color: str | None = None
    mileage: int | None = Field(default=None, ge=0)
    status: VehicleStatus = VehicleStatus.ACQUIRED
    acquired_on: date | None = None
    acquired_from: str | None = None
    notes: str | None = None

    @field_validator("vin")
    @classmethod
    def check_vin(cls, value: str | None) -> str | None:
        return normalise_vin(value)


class VehicleCreate(VehicleBase):
    stock_number: str | None = Field(default=None, description="Auto-generated when omitted")
    decode_vin: bool = Field(
        default=True, description="Look the VIN up against NHTSA and fill blank fields"
    )


class VehicleUpdate(VehicleBase):
    status: VehicleStatus | None = None  # type: ignore[assignment]


class VehicleRead(VehicleBase, ORMModel):
    id: int
    stock_number: str
    display_name: str
    description: str
    created_at: datetime
    created_by: UserBrief | None = None


class VehicleDetail(VehicleRead):
    decoded_data: dict[str, Any] | None = None
    part_count: int = 0
    parts_sold: int = 0
    total_expenses: Decimal = Decimal("0")
    total_revenue: Decimal = Decimal("0")
    # Part of total_revenue, broken out so the car page can show what the shell
    # itself fetched as against what the parts did.
    scrap_revenue: Decimal = Decimal("0")
    profit: Decimal = Decimal("0")


class VinDecodeResult(BaseModel):
    vin: str
    year: int | None = None
    make: str | None = None
    model: str | None = None
    trim: str | None = None
    engine: str | None = None
    transmission: str | None = None
    drive_type: str | None = None
    body_style: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class ExpenseBase(BaseModel):
    description: str = Field(min_length=1, max_length=255)
    category: ExpenseCategory = ExpenseCategory.OTHER
    amount: Decimal = Field(gt=0, decimal_places=2)
    incurred_on: date
    paid_by_id: int
    notes: str | None = None


class ExpenseCreate(ExpenseBase):
    vehicle_id: int | None = None


class ExpenseUpdate(BaseModel):
    description: str | None = Field(default=None, min_length=1, max_length=255)
    category: ExpenseCategory | None = None
    amount: Decimal | None = Field(default=None, gt=0, decimal_places=2)
    incurred_on: date | None = None
    paid_by_id: int | None = None
    vehicle_id: int | None = None
    notes: str | None = None


class ExpenseRead(ExpenseBase, ORMModel):
    id: int
    vehicle_id: int | None = None
    paid_by: UserBrief
    created_at: datetime


class VehicleSaleLine(ORMModel):
    """One line of income booked against a car, for its own ledger."""

    sale_id: int
    reference: str
    sold_on: date
    paid_on: date | None = None
    state: str
    buyer_name: str | None = None
    description: str
    is_shell: bool = False
    quantity: int
    line_total: Decimal
    # How it reached this car: a line named against it, or one of its parts.
    via: str
