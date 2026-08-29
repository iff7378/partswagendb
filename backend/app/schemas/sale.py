from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.enums import SaleChannel
from app.schemas.common import ORMModel
from app.schemas.user import UserBrief


class SaleItemCreate(BaseModel):
    part_id: int | None = None
    description: str | None = Field(default=None, max_length=255)
    quantity: int = Field(default=1, gt=0)
    unit_price: Decimal = Field(ge=0, decimal_places=2)


class SaleItemRead(ORMModel):
    id: int
    part_id: int | None = None
    part_sku: str | None = None
    description: str
    quantity: int
    unit_price: Decimal
    line_total: Decimal


class SaleBase(BaseModel):
    sold_on: date
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
    channel: SaleChannel | None = None
    buyer_name: str | None = None
    buyer_contact: str | None = None
    shipping: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    fees: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    tax: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    collected_by_id: int | None = None
    payment_method: str | None = None
    notes: str | None = None


class SaleRead(SaleBase, ORMModel):
    id: int
    reference: str
    subtotal: Decimal
    net_collected: Decimal
    collected_by: UserBrief
    created_at: datetime


class SaleDetail(SaleRead):
    items: list[SaleItemRead] = Field(default_factory=list)
