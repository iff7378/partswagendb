from collections import defaultdict
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Sale, SaleItem, Settlement, User, VehicleExpense
from app.schemas.settlement import PartnerBalance, SettleUpReport, Transfer
from app.schemas.user import UserBrief

ZERO = Decimal("0.00")
BPS_TOTAL = 10_000


def money(value: Decimal | int | float | None) -> Decimal:
    """Coerce to a 2dp Decimal so partner balances always tie out to the cent."""
    if value is None:
        return ZERO
    return Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _expenses_by_user(db: Session, start: date, end: date) -> dict[int, Decimal]:
    rows = db.execute(
        select(VehicleExpense.paid_by_id, func.sum(VehicleExpense.amount))
        .where(VehicleExpense.incurred_on >= start, VehicleExpense.incurred_on <= end)
        .group_by(VehicleExpense.paid_by_id)
    ).all()
    return {user_id: money(total) for user_id, total in rows}


def _revenue_by_user(db: Session, start: date, end: date) -> dict[int, Decimal]:
    """Net cash each collector took in: line totals plus shipping and tax, less fees.

    Counted on the day the money landed, not the day the deal was agreed. A
    sale that is still owed for is not cash anyone is holding, so it cannot
    change who owes whom.
    """
    item_totals = (
        select(
            SaleItem.sale_id.label("sale_id"),
            func.sum(SaleItem.unit_price * SaleItem.quantity).label("subtotal"),
        )
        .group_by(SaleItem.sale_id)
        .subquery()
    )

    rows = db.execute(
        select(
            Sale.collected_by_id,
            func.sum(
                func.coalesce(item_totals.c.subtotal, 0) + Sale.shipping + Sale.tax - Sale.fees
            ),
        )
        .outerjoin(item_totals, item_totals.c.sale_id == Sale.id)
        .where(
            Sale.voided_at.is_(None),
            Sale.paid_on.is_not(None),
            Sale.paid_on >= start,
            Sale.paid_on <= end,
        )
        .group_by(Sale.collected_by_id)
    ).all()
    return {user_id: money(total) for user_id, total in rows}


def _settlements(
    db: Session, start: date, end: date
) -> tuple[dict[int, Decimal], dict[int, Decimal]]:
    paid: dict[int, Decimal] = defaultdict(lambda: ZERO)
    received: dict[int, Decimal] = defaultdict(lambda: ZERO)
    rows = db.execute(
        select(Settlement).where(Settlement.paid_on >= start, Settlement.paid_on <= end)
    ).scalars()
    for s in rows:
        paid[s.from_user_id] += money(s.amount)
        received[s.to_user_id] += money(s.amount)
    return dict(paid), dict(received)


def _split_profit(profit: Decimal, shares_bps: list[int]) -> list[Decimal]:
    """Divide profit by basis-point shares, giving the rounding remainder away.

    Rounding each share independently can leave the parts a cent short of the
    whole, which would make the settle-up transfers fail to balance. The
    remainder goes to the largest shareholder.
    """
    if not shares_bps:
        return []

    allocated = sum(shares_bps)
    amounts = [money(profit * Decimal(bps) / Decimal(BPS_TOTAL)) for bps in shares_bps]

    # Only force a tie-out when shares actually account for the whole venture;
    # otherwise the shortfall is real and should stay visible.
    if allocated == BPS_TOTAL:
        residual = money(profit) - sum(amounts, ZERO)
        if residual != ZERO:
            largest = max(range(len(shares_bps)), key=lambda i: shares_bps[i])
            amounts[largest] = money(amounts[largest] + residual)

    return amounts


def _plan_transfers(balances: list[PartnerBalance]) -> list[Transfer]:
    """Greedily match partners holding a surplus against those owed money.

    Produces at most n-1 transfers for n partners, which is the minimum needed.
    """
    debtors = sorted([(b, b.delta) for b in balances if b.delta > ZERO], key=lambda x: -x[1])
    creditors = sorted([(b, -b.delta) for b in balances if b.delta < ZERO], key=lambda x: -x[1])

    transfers: list[Transfer] = []
    i = j = 0
    debtor_remaining = debtors[0][1] if debtors else ZERO
    creditor_remaining = creditors[0][1] if creditors else ZERO

    while i < len(debtors) and j < len(creditors):
        amount = min(debtor_remaining, creditor_remaining)
        if amount > ZERO:
            transfers.append(
                Transfer(
                    from_user=debtors[i][0].user,
                    to_user=creditors[j][0].user,
                    amount=money(amount),
                )
            )
        debtor_remaining -= amount
        creditor_remaining -= amount
        if debtor_remaining <= ZERO:
            i += 1
            debtor_remaining = debtors[i][1] if i < len(debtors) else ZERO
        if creditor_remaining <= ZERO:
            j += 1
            creditor_remaining = creditors[j][1] if j < len(creditors) else ZERO

    return transfers


def build_settle_up_report(db: Session, start: date, end: date) -> SettleUpReport:
    """Work out who owes whom for a period.

    Each partner is entitled to `share x profit`. Whatever cash they are actually
    holding (money collected, less money they laid out) above that entitlement is
    what they owe the others.
    """
    partners = list(
        db.execute(select(User).where(User.is_partner.is_(True)).order_by(User.id)).scalars()
    )

    expenses = _expenses_by_user(db, start, end)
    revenue = _revenue_by_user(db, start, end)
    settle_paid, settle_received = _settlements(db, start, end)

    # Totals cover the whole venture, including anything recorded against a
    # non-partner user, so profit stays accurate even if a helper made a sale.
    total_revenue = money(sum(revenue.values(), ZERO))
    total_expenses = money(sum(expenses.values(), ZERO))
    profit = money(total_revenue - total_expenses)

    allocated_bps = sum(p.share_bps for p in partners)

    entitlements = _split_profit(profit, [p.share_bps for p in partners])

    balances: list[PartnerBalance] = []
    for partner, entitled in zip(partners, entitlements, strict=True):
        paid = expenses.get(partner.id, ZERO)
        collected = revenue.get(partner.id, ZERO)
        s_paid = settle_paid.get(partner.id, ZERO)
        s_received = settle_received.get(partner.id, ZERO)

        # A settlement moves cash between partners, so it shifts holdings the
        # same way a sale or an expense does.
        net_holding = money(collected - paid - s_paid + s_received)

        balances.append(
            PartnerBalance(
                user=UserBrief.model_validate(partner),
                share_bps=partner.share_bps,
                expenses_paid=paid,
                revenue_collected=collected,
                settlements_paid=s_paid,
                settlements_received=s_received,
                net_holding=net_holding,
                entitled=entitled,
                delta=money(net_holding - entitled),
            )
        )

    return SettleUpReport(
        period_start=start,
        period_end=end,
        total_revenue=total_revenue,
        total_expenses=total_expenses,
        profit=profit,
        balances=balances,
        transfers=_plan_transfers(balances),
        unallocated_share_bps=BPS_TOTAL - allocated_bps if partners else 0,
    )
