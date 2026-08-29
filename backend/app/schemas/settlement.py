from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from app.schemas.user import UserBrief


class SettlementCreate(BaseModel):
    period_start: date
    period_end: date
    paid_on: date
    from_user_id: int
    to_user_id: int
    amount: Decimal = Field(gt=0, decimal_places=2)
    method: str | None = None
    notes: str | None = None


class SettlementRead(ORMModel):
    id: int
    period_start: date
    period_end: date
    paid_on: date
    from_user: UserBrief
    to_user: UserBrief
    amount: Decimal
    method: str | None = None
    notes: str | None = None
    created_at: datetime


class PartnerBalance(BaseModel):
    user: UserBrief
    share_bps: int
    expenses_paid: Decimal
    revenue_collected: Decimal
    settlements_paid: Decimal
    settlements_received: Decimal
    # Cash the partner is currently holding on the venture's behalf.
    net_holding: Decimal
    # What they should be holding: their share of the period's profit.
    entitled: Decimal
    # Positive means they hold too much and owe the other partner(s).
    delta: Decimal


class Transfer(BaseModel):
    from_user: UserBrief
    to_user: UserBrief
    amount: Decimal


class SettleUpReport(BaseModel):
    period_start: date
    period_end: date
    total_revenue: Decimal
    total_expenses: Decimal
    profit: Decimal
    balances: list[PartnerBalance]
    transfers: list[Transfer]
    unallocated_share_bps: int = Field(
        default=0,
        description="Basis points not assigned to any partner; non-zero means shares need fixing",
    )
