from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from app.models import Part, Sale, SaleItem, Settlement, VehicleExpense
from app.services.ledger import ZERO, build_settle_up_report

PERIOD_START = date(2026, 7, 1)
PERIOD_END = date(2026, 9, 30)


def add_expense(db: Session, user_id: int, amount: str, when: date = PERIOD_START) -> None:
    db.add(
        VehicleExpense(
            description="Donor car",
            amount=Decimal(amount),
            incurred_on=when,
            paid_by_id=user_id,
        )
    )
    db.commit()


def add_sale(
    db: Session,
    user_id: int,
    amount: str,
    when: date = PERIOD_END,
    fees: str = "0",
    reference: str | None = None,
) -> Sale:
    sale = Sale(
        reference=reference or f"S-{user_id}-{amount}-{when}",
        sold_on=when,
        collected_by_id=user_id,
        fees=Decimal(fees),
    )
    sale.items.append(SaleItem(description="A part", quantity=1, unit_price=Decimal(amount)))
    db.add(sale)
    db.commit()
    return sale


def report(db: Session):  # type: ignore[no-untyped-def]
    return build_settle_up_report(db, PERIOD_START, PERIOD_END)


def balance_for(result, user_id: int):  # type: ignore[no-untyped-def]
    return next(b for b in result.balances if b.user.id == user_id)


def test_no_activity_produces_no_transfers(db: Session, make_user) -> None:
    make_user("a@example.com", is_partner=True, share_bps=5000)
    make_user("b@example.com", is_partner=True, share_bps=5000)

    result = report(db)

    assert result.profit == ZERO
    assert result.transfers == []


def test_one_partner_funds_the_other_collects(db: Session, make_user) -> None:
    payer = make_user("payer@example.com", is_partner=True, share_bps=5000)
    collector = make_user("collector@example.com", is_partner=True, share_bps=5000)

    add_expense(db, payer.id, "2000.00")
    add_sale(db, collector.id, "1600.00", fees="100.00")

    result = report(db)

    # Revenue is net of fees: 1600 - 100 = 1500, against 2000 of cost.
    assert result.total_revenue == Decimal("1500.00")
    assert result.total_expenses == Decimal("2000.00")
    assert result.profit == Decimal("-500.00")

    # A 500 loss split evenly means each should end up 250 out of pocket.
    assert balance_for(result, payer.id).entitled == Decimal("-250.00")
    assert balance_for(result, collector.id).entitled == Decimal("-250.00")

    assert len(result.transfers) == 1
    transfer = result.transfers[0]
    assert transfer.from_user.id == collector.id
    assert transfer.to_user.id == payer.id
    assert transfer.amount == Decimal("1750.00")


def test_transfers_leave_every_partner_at_their_entitlement(db: Session, make_user) -> None:
    a = make_user("a@example.com", is_partner=True, share_bps=5000)
    b = make_user("b@example.com", is_partner=True, share_bps=5000)

    add_expense(db, a.id, "1200.00")
    add_sale(db, b.id, "3000.00")

    result = report(db)

    settled = {bal.user.id: bal.net_holding for bal in result.balances}
    for transfer in result.transfers:
        settled[transfer.from_user.id] -= transfer.amount
        settled[transfer.to_user.id] += transfer.amount

    for bal in result.balances:
        assert settled[bal.user.id] == bal.entitled

    assert settled[a.id] == Decimal("900.00")
    assert settled[b.id] == Decimal("900.00")


def test_uneven_shares_are_respected(db: Session, make_user) -> None:
    major = make_user("major@example.com", is_partner=True, share_bps=7000)
    minor = make_user("minor@example.com", is_partner=True, share_bps=3000)

    add_expense(db, major.id, "1000.00")
    add_sale(db, minor.id, "2000.00")

    result = report(db)

    assert result.profit == Decimal("1000.00")
    assert balance_for(result, major.id).entitled == Decimal("700.00")
    assert balance_for(result, minor.id).entitled == Decimal("300.00")


def test_odd_cent_is_not_lost_when_splitting(db: Session, make_user) -> None:
    a = make_user("a@example.com", is_partner=True, share_bps=5000)
    make_user("b@example.com", is_partner=True, share_bps=5000)

    # A profit of 0.01 cannot be halved evenly.
    add_sale(db, a.id, "0.01")

    result = report(db)

    total_entitled = sum(bal.entitled for bal in result.balances)
    assert total_entitled == result.profit


def test_settlement_closes_out_the_balance(db: Session, make_user) -> None:
    payer = make_user("payer@example.com", is_partner=True, share_bps=5000)
    collector = make_user("collector@example.com", is_partner=True, share_bps=5000)

    add_expense(db, payer.id, "1000.00")
    add_sale(db, collector.id, "1000.00")

    before = report(db)
    assert len(before.transfers) == 1
    owed = before.transfers[0].amount
    assert owed == Decimal("1000.00")

    db.add(
        Settlement(
            period_start=PERIOD_START,
            period_end=PERIOD_END,
            paid_on=PERIOD_END,
            from_user_id=collector.id,
            to_user_id=payer.id,
            amount=owed,
        )
    )
    db.commit()

    after = report(db)
    assert after.transfers == []
    for bal in after.balances:
        assert bal.delta == ZERO


def test_activity_outside_the_period_is_excluded(db: Session, make_user) -> None:
    partner = make_user("a@example.com", is_partner=True, share_bps=10000)

    add_expense(db, partner.id, "500.00", when=date(2026, 6, 30))
    add_sale(db, partner.id, "900.00", when=date(2026, 10, 1))

    result = report(db)

    assert result.total_expenses == ZERO
    assert result.total_revenue == ZERO


def test_non_partners_are_excluded_from_balances(db: Session, make_user) -> None:
    partner = make_user("partner@example.com", is_partner=True, share_bps=10000)
    helper = make_user("helper@example.com", is_partner=False)

    add_sale(db, helper.id, "300.00")

    result = report(db)

    assert [bal.user.id for bal in result.balances] == [partner.id]
    # The helper's sale is still venture revenue even though they hold no share.
    assert result.total_revenue == Decimal("300.00")


def test_unallocated_shares_are_reported(db: Session, make_user) -> None:
    make_user("a@example.com", is_partner=True, share_bps=4000)
    make_user("b@example.com", is_partner=True, share_bps=4000)

    result = report(db)

    assert result.unallocated_share_bps == 2000


@pytest.mark.parametrize(
    ("expense", "revenue", "expected_profit"),
    [
        ("0", "100.00", Decimal("100.00")),
        ("100.00", "0", Decimal("-100.00")),
        ("50.00", "50.00", Decimal("0.00")),
    ],
)
def test_profit_arithmetic(
    db: Session, make_user, expense: str, revenue: str, expected_profit: Decimal
) -> None:
    partner = make_user("a@example.com", is_partner=True, share_bps=10000)

    if Decimal(expense) > 0:
        add_expense(db, partner.id, expense)
    if Decimal(revenue) > 0:
        add_sale(db, partner.id, revenue)

    assert report(db).profit == expected_profit


def test_sold_parts_do_not_break_revenue_attribution(db: Session, make_user) -> None:
    partner = make_user("a@example.com", is_partner=True, share_bps=10000)

    part = Part(sku="P-000001", title="Alternator")
    db.add(part)
    db.commit()

    sale = Sale(reference="S26-0001", sold_on=PERIOD_END, collected_by_id=partner.id)
    sale.items.append(
        SaleItem(part_id=part.id, description="Alternator", quantity=2, unit_price=Decimal("75.00"))
    )
    db.add(sale)
    db.commit()

    assert report(db).total_revenue == Decimal("150.00")
