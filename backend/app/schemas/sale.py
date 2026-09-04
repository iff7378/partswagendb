from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.enums import SaleChannel, SaleState
from app.schemas.common import ORMModel
from app.schemas.user import UserBrief


class SaleItemCreate(BaseModel):
    """One line: whatever went for one price.

    Any number of parts, optionally against a car. A lot names the car so the
    money still lands on it when the pieces were never catalogued separately.
    """

    part_ids: list[int] = Field(default_factory=list)
    vehicle_id: int | None = None
    is_shell: bool = False
    description: str | None = Field(default=None, max_length=255)
    quantity: int = Field(default=1, gt=0)
    unit_price: Decimal = Field(ge=0, decimal_places=2)


class SaleItemPart(ORMModel):
    id: int
    sku: str
    title: str


class SaleItemRead(ORMModel):
    id: int
    parts: list[SaleItemPart] = Field(default_factory=list)
    vehicle_id: int | None = None
    vehicle_name: str | None = None
    is_shell: bool = False
    description: str
    quantity: int
    unit_price: Decimal
    line_total: Decimal


class SaleBase(BaseModel):
    sold_on: date
    # Null until it happens. Paid puts the money on the ledger; fulfilled takes
    # the stock off the shelf.
    paid_on: date | None = None
    fulfilled_on: date | None = None
    # When the buyer is coming. Arranged over Messenger, kept here.
    meetup_at: datetime | None = None
    channel: SaleChannel = SaleChannel.LOCAL
    buyer_name: str | None = None
    buyer_contact: str | None = None
    shipping: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    fees: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    tax: Decimal = Field(default=Decimal("0"), ge=0, decimal_places=2)
    collected_by_id: int
    payment_method: str | None = None
    notes: str | None = None


class SaleCreate(SaleBase):
    items: list[SaleItemCreate] = Field(min_length=1)


class SaleUpdate(BaseModel):
    sold_on: date | None = None
    # Explicit null clears these, which is how a mis-marked sale is undone.
    paid_on: date | None = None
    fulfilled_on: date | None = None
    meetup_at: datetime | None = None
    channel: SaleChannel | None = None
    buyer_name: str | None = None
    buyer_contact: str | None = None
    shipping: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    fees: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    tax: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    collected_by_id: int | None = None
    payment_method: str | None = None
    notes: str | None = None
    # Omit to leave the lines alone; send a full replacement set to change what
    # sold, so a mistyped sale can be corrected without voiding it.
    items: list[SaleItemCreate] | None = None


class SaleRead(SaleBase, ORMModel):
    id: int
    reference: str
    state: SaleState
    voided_at: datetime | None = None
    void_reason: str | None = None
    voided_by: UserBrief | None = None
    subtotal: Decimal
    net_collected: Decimal
    collected_by: UserBrief
    created_at: datetime


class SaleDetail(SaleRead):
    items: list[SaleItemRead] = Field(default_factory=list)


class SiteBrief(BaseModel):
    id: int
    name: str


class ScheduleEntry(BaseModel):
    """One handover to be at, flattened for a diary view."""

    id: int
    reference: str
    state: SaleState
    meetup_at: datetime | None = None
    buyer_name: str | None = None
    buyer_contact: str | None = None
    channel: SaleChannel
    net_collected: Decimal
    paid_on: date | None = None
    summary: str
    part_count: int = 0
    # Where the parts are kept, so you know which site to be at. Derived from
    # the parts rather than typed in, and null when nothing on the sale is
    # shelved anywhere.
    site: SiteBrief | None = None


class Schedule(BaseModel):
    scheduled: list[ScheduleEntry]
    # Agreed but with no time set: the ones still to be pinned down.
    unscheduled: list[ScheduleEntry]
    sites: list[SiteBrief]
