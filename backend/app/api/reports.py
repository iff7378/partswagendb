import csv
import io
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser, DbSession, RequireAdmin, RequireEditor
from app.db import days_since
from app.enums import PartStatus, VehicleStatus
from app.models import (
    AuditEntry,
    Location,
    Part,
    PartCategory,
    Photo,
    Sale,
    SaleItem,
    Settlement,
    Tag,
    User,
    Vehicle,
    VehicleExpense,
)
from app.schemas.common import ORMModel, Page
from app.services.ledger import ZERO, money

router = APIRouter(tags=["reports"])


class DashboardStats(BaseModel):
    parts_total: int
    parts_available: int
    parts_draft: int
    parts_sold: int
    parts_overdue: int
    vehicles_total: int
    vehicles_in_teardown: int
    revenue_last_30_days: Decimal
    expenses_last_30_days: Decimal
    inventory_asking_value: Decimal


@router.get("/dashboard", response_model=DashboardStats)
def dashboard(db: DbSession, _: CurrentUser) -> DashboardStats:
    def count_parts(*conditions) -> int:  # type: ignore[no-untyped-def]
        return db.execute(select(func.count()).select_from(Part).where(*conditions)).scalar_one()

    cutoff = date.today() - timedelta(days=30)

    revenue = db.execute(
        select(func.sum(SaleItem.unit_price * SaleItem.quantity))
        .select_from(SaleItem)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .where(Sale.voided_at.is_(None), Sale.paid_on.is_not(None), Sale.paid_on >= cutoff)
    ).scalar_one_or_none()

    expenses = db.execute(
        select(func.sum(VehicleExpense.amount)).where(VehicleExpense.incurred_on >= cutoff)
    ).scalar_one_or_none()

    inventory_value = db.execute(
        select(func.sum(Part.asking_price * Part.quantity)).where(
            Part.status == PartStatus.AVAILABLE
        )
    ).scalar_one_or_none()

    return DashboardStats(
        parts_total=count_parts(),
        parts_available=count_parts(Part.status == PartStatus.AVAILABLE),
        parts_draft=count_parts(Part.status == PartStatus.DRAFT),
        parts_sold=count_parts(Part.status == PartStatus.SOLD),
        parts_overdue=count_parts(
            Part.age_alert_days.is_not(None),
            Part.status.in_([PartStatus.AVAILABLE, PartStatus.DRAFT]),
            days_since(Part.created_at) >= Part.age_alert_days,
        ),
        vehicles_total=db.execute(select(func.count()).select_from(Vehicle)).scalar_one(),
        vehicles_in_teardown=db.execute(
            select(func.count())
            .select_from(Vehicle)
            .where(Vehicle.status == VehicleStatus.IN_TEARDOWN)
        ).scalar_one(),
        revenue_last_30_days=money(revenue) if revenue else ZERO,
        expenses_last_30_days=money(expenses) if expenses else ZERO,
        inventory_asking_value=money(inventory_value) if inventory_value else ZERO,
    )


@router.get("/exports/listings")
def export_listings(
    db: DbSession,
    _: CurrentUser,
    vehicle_id: int | None = None,
    category_id: int | None = None,
    limit: int = Query(default=500, le=2000),
) -> Response:
    """CSV of listable stock, shaped for pasting into a marketplace bulk uploader."""
    query = (
        select(Part)
        .options(selectinload(Part.vehicle), selectinload(Part.category))
        .where(Part.status == PartStatus.AVAILABLE)
    )
    if vehicle_id is not None:
        query = query.where(Part.vehicle_id == vehicle_id)
    if category_id is not None:
        query = query.where(Part.category_id == category_id)

    parts = list(db.execute(query.order_by(Part.sku).limit(limit)).scalars())

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "sku",
            "title",
            "description",
            "category",
            "condition",
            "part_number",
            "oem_number",
            "manufacturer",
            "price",
            "quantity",
            "donor_vehicle",
        ]
    )

    for part in parts:
        vehicle = part.vehicle
        title = part.title
        # Marketplace titles sell better with the donor car up front.
        if vehicle and vehicle.display_name not in title:
            title = f"{vehicle.display_name} {title}"

        writer.writerow(
            [
                part.sku,
                title,
                part.description or "",
                part.category.path if part.category else "",
                part.condition,
                part.part_number or "",
                part.oem_number or "",
                part.manufacturer or "",
                f"{part.asking_price:.2f}" if part.asking_price is not None else "",
                part.quantity,
                vehicle.display_name if vehicle else "",
            ]
        )

    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="listings.csv"'},
    )


class VehicleResult(BaseModel):
    """One donor car's contribution to the books."""

    id: int
    stock_number: str
    display_name: str
    status: VehicleStatus
    acquired_on: date | None = None
    parts_total: int = 0
    parts_sold: int = 0
    total_expenses: Decimal = ZERO
    total_revenue: Decimal = ZERO
    scrap_revenue: Decimal = ZERO
    profit: Decimal = ZERO


class VehicleResults(BaseModel):
    vehicles: list[VehicleResult]
    # Overheads belong to the venture, not to any one car, so they sit outside
    # the per-car rows and are why these never sum to the settle-up profit.
    general_expenses: Decimal = ZERO
    # Money that is real but belongs to no car, so the rows above can be
    # reconciled against the ledger instead of quietly disagreeing with it:
    #
    #   ledger revenue = sum(car revenue) + unattributed + adjustments
    #
    # Unattributed is a line naming no car whose parts came off none either.
    # Adjustments are shipping and tax less fees, which are charged on the sale
    # as a whole and so cannot be pinned to one car.
    unattributed_revenue: Decimal = ZERO
    sale_adjustments: Decimal = ZERO


@router.get("/reports/by-vehicle", response_model=VehicleResults)
def by_vehicle(db: DbSession, _: CurrentUser) -> VehicleResults:
    """Profit and loss for every car, side by side.

    Deliberately set-based rather than a loop over `GET /vehicles/{id}`: with a
    row per car that would be three queries each.
    """
    line_total = SaleItem.unit_price * SaleItem.quantity

    expenses: dict[int, Decimal] = {
        vehicle_id: amount
        for vehicle_id, amount in db.execute(
            select(VehicleExpense.vehicle_id, func.sum(VehicleExpense.amount))
            .where(VehicleExpense.vehicle_id.is_not(None))
            .group_by(VehicleExpense.vehicle_id)
        ).all()
        if vehicle_id is not None
    }
    general = db.execute(
        select(func.sum(VehicleExpense.amount)).where(VehicleExpense.vehicle_id.is_(None))
    ).scalar_one_or_none()

    part_counts = {
        vehicle_id: (total, sold)
        for vehicle_id, total, sold in db.execute(
            select(
                Part.vehicle_id,
                func.count(),
                func.count().filter(Part.status == PartStatus.SOLD),
            )
            .where(Part.vehicle_id.is_not(None))
            .group_by(Part.vehicle_id)
        ).all()
    }

    # Revenue is attributed the same way the single-car page does it: a line
    # named against a car counts there, otherwise it follows its parts. Line
    # ids are collected first so a lot covering several parts is counted once.
    # Unpaid sales are not income yet, so they stay out of every car's return
    # exactly as they stay off the ledger and off the single-car page.
    named = db.execute(
        select(SaleItem.vehicle_id, SaleItem.id, line_total)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .where(
            SaleItem.vehicle_id.is_not(None),
            Sale.paid_on.is_not(None),
            Sale.voided_at.is_(None),
        )
    ).all()
    via_parts = db.execute(
        select(Part.vehicle_id, SaleItem.id, line_total)
        .select_from(SaleItem)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .join(SaleItem.parts)
        .where(
            SaleItem.vehicle_id.is_(None),
            Part.vehicle_id.is_not(None),
            Sale.paid_on.is_not(None),
            Sale.voided_at.is_(None),
        )
    ).all()

    revenue: dict[int, Decimal] = {}
    seen: set[tuple[int, int]] = set()
    for vehicle_id, item_id, amount in [*named, *via_parts]:
        if (vehicle_id, item_id) in seen:
            continue
        seen.add((vehicle_id, item_id))
        revenue[vehicle_id] = revenue.get(vehicle_id, ZERO) + money(amount)

    scrap: dict[int, Decimal] = {
        vehicle_id: amount
        for vehicle_id, amount in db.execute(
            select(SaleItem.vehicle_id, func.sum(line_total))
            .join(Sale, Sale.id == SaleItem.sale_id)
            .where(
                SaleItem.vehicle_id.is_not(None),
                SaleItem.is_shell.is_(True),
                Sale.paid_on.is_not(None),
                Sale.voided_at.is_(None),
            )
            .group_by(SaleItem.vehicle_id)
        ).all()
        if vehicle_id is not None
    }

    # Everything the cars could not account for, so the totals can be checked.
    paid_lines = db.execute(
        select(func.sum(line_total))
        .select_from(SaleItem)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .where(Sale.paid_on.is_not(None), Sale.voided_at.is_(None))
    ).scalar_one_or_none()
    adjustments = db.execute(
        select(func.sum(Sale.shipping + Sale.tax - Sale.fees)).where(
            Sale.paid_on.is_not(None), Sale.voided_at.is_(None)
        )
    ).scalar_one_or_none()

    rows: list[VehicleResult] = []
    for vehicle in db.execute(select(Vehicle).order_by(Vehicle.created_at.desc())).scalars():
        total, sold = part_counts.get(vehicle.id, (0, 0))
        spent = money(expenses.get(vehicle.id) or 0)
        earned = money(revenue.get(vehicle.id) or 0)
        rows.append(
            VehicleResult(
                id=vehicle.id,
                stock_number=vehicle.stock_number,
                display_name=vehicle.display_name,
                status=vehicle.status,
                acquired_on=vehicle.acquired_on,
                parts_total=total,
                parts_sold=sold,
                total_expenses=spent,
                total_revenue=earned,
                scrap_revenue=money(scrap.get(vehicle.id) or 0),
                profit=money(earned - spent),
            )
        )

    attributed = sum(revenue.values(), ZERO)
    return VehicleResults(
        vehicles=rows,
        general_expenses=money(general) if general else ZERO,
        unattributed_revenue=money(paid_lines or 0) - money(attributed),
        sale_adjustments=money(adjustments or 0),
    )


class AppMetrics(BaseModel):
    """What the system is holding, for an admin checking on its health."""

    parts_by_status: dict[str, int]
    parts_total: int
    vehicles_by_status: dict[str, int]
    vehicles_total: int
    sales_total: int
    sale_lines_total: int
    gross_sales: Decimal
    expenses_total: int
    expenses_amount: Decimal
    settlements_total: int
    photos_total: int
    photo_bytes: int
    largest_photo_bytes: int
    users_total: int
    users_active: int
    locations_total: int
    categories_total: int
    tags_total: int
    database_bytes: int | None = None


@router.get("/reports/metrics", response_model=AppMetrics)
def metrics(db: DbSession, _: RequireAdmin) -> AppMetrics:
    def count(model, *where) -> int:  # type: ignore[no-untyped-def]
        return db.execute(select(func.count()).select_from(model).where(*where)).scalar_one()

    def grouped(column) -> dict[str, int]:  # type: ignore[no-untyped-def]
        return {
            str(value): total
            for value, total in db.execute(select(column, func.count()).group_by(column)).all()
        }

    photo_bytes = db.execute(select(func.sum(Photo.size_bytes))).scalar_one_or_none()
    largest = db.execute(select(func.max(Photo.size_bytes))).scalar_one_or_none()
    gross = db.execute(
        select(func.sum(SaleItem.unit_price * SaleItem.quantity))
    ).scalar_one_or_none()
    spent = db.execute(select(func.sum(VehicleExpense.amount))).scalar_one_or_none()

    # Postgres can report its own size; SQLite in the tests cannot, so this
    # stays optional rather than branching the whole endpoint.
    database_bytes: int | None = None
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        database_bytes = db.execute(
            select(func.pg_database_size(func.current_database()))
        ).scalar_one()

    return AppMetrics(
        parts_by_status=grouped(Part.status),
        parts_total=count(Part),
        vehicles_by_status=grouped(Vehicle.status),
        vehicles_total=count(Vehicle),
        sales_total=count(Sale),
        sale_lines_total=count(SaleItem),
        gross_sales=money(gross) if gross else ZERO,
        expenses_total=count(VehicleExpense),
        expenses_amount=money(spent) if spent else ZERO,
        settlements_total=count(Settlement),
        photos_total=count(Photo),
        photo_bytes=int(photo_bytes or 0),
        largest_photo_bytes=int(largest or 0),
        users_total=count(User),
        users_active=count(User, User.is_active.is_(True)),
        locations_total=count(Location),
        categories_total=count(PartCategory),
        tags_total=count(Tag),
        database_bytes=database_bytes,
    )


# Fields worth remembering what has been typed before. Buyers and yards share
# one pool: the car page writes a yard's name into the sale's buyer_name.
_SUGGESTION_FIELDS = {
    "buyer_name": (Sale, Sale.buyer_name),
    "part_title": (Part, Part.title),
    "manufacturer": (Part, Part.manufacturer),
    "acquired_from": (Vehicle, Vehicle.acquired_from),
}


@router.get("/suggestions/{field}", response_model=list[str])
def suggestions(
    db: DbSession,
    _: CurrentUser,
    field: str,
    q: str | None = None,
    limit: int = Query(default=25, le=100),
) -> list[str]:
    """What has been typed into this field before, commonest first.

    Keeps naming consistent: the same item entered as "RL Door" on one car and
    "Rear left door" on the next makes search and the listings export useless,
    and there is no cheap way to fix it afterwards.
    """
    if field not in _SUGGESTION_FIELDS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No suggestions for {field}",
        )

    model, column = _SUGGESTION_FIELDS[field]
    query = (
        select(column, func.count().label("uses"))
        .select_from(model)
        .where(column.is_not(None), func.trim(column) != "")
        .group_by(column)
        # Commonest first so the regulars are at the top, then alphabetical so
        # the list does not reshuffle unpredictably between visits.
        .order_by(func.count().desc(), column.asc())
        .limit(limit)
    )
    if q:
        query = query.where(column.ilike(f"%{q.strip()}%"))

    return [value for value, _ in db.execute(query).all()]


class LedgerEntry(BaseModel):
    """One movement of money, sale or cost, flattened for a statement."""

    on: date
    kind: str  # sale | expense | settlement
    reference: str
    description: str
    vehicle_id: int | None = None
    vehicle_name: str | None = None
    person: str
    # Positive is money in, negative is money out, so a column of these sums to
    # the period's profit without the reader having to know the rules.
    amount: Decimal
    state: str | None = None
    # False for an agreed-but-unpaid sale: shown, but outside every total.
    counted: bool = True
    sale_id: int | None = None


class Ledger(BaseModel):
    entries: list[LedgerEntry]
    money_in: Decimal = ZERO
    money_out: Decimal = ZERO
    profit: Decimal = ZERO
    # Agreed but not paid, so deliberately excluded from the three above.
    uncounted: Decimal = ZERO


@router.get("/reports/ledger", response_model=Ledger)
def ledger(
    db: DbSession,
    _: CurrentUser,
    period_start: date = Query(...),
    period_end: date = Query(...),
) -> Ledger:
    """Every line behind the Money page, so the summary can be checked by eye.

    A dashboard nobody can drill into is a black box, and a black box is worth
    less than a spreadsheet however right it happens to be.
    """
    entries: list[LedgerEntry] = []

    sales = db.execute(
        select(Sale)
        .options(
            selectinload(Sale.collected_by),
            selectinload(Sale.items).selectinload(SaleItem.vehicle),
            selectinload(Sale.items).selectinload(SaleItem.parts).selectinload(Part.vehicle),
        )
        .where(
            Sale.sold_on >= period_start,
            Sale.sold_on <= period_end,
            Sale.voided_at.is_(None),
        )
    ).scalars()

    for sale in sales:
        counted = sale.paid_on is not None
        for item in sale.items:
            vehicle = item.vehicle or next(
                (part.vehicle for part in item.parts if part.vehicle), None
            )
            entries.append(
                LedgerEntry(
                    # Paid lines sit on the day the money landed, which is the
                    # day they hit the totals; unpaid ones on the day agreed.
                    on=sale.paid_on or sale.sold_on,
                    kind="sale",
                    reference=sale.reference,
                    description=item.description,
                    vehicle_id=vehicle.id if vehicle else None,
                    vehicle_name=vehicle.display_name if vehicle else None,
                    person=sale.collected_by.full_name,
                    amount=money(item.line_total),
                    state=sale.state,
                    counted=counted,
                    sale_id=sale.id,
                )
            )
        # Charged on the sale rather than any line, so they get their own row
        # instead of being folded invisibly into one.
        adjustment = money(sale.shipping + sale.tax - sale.fees)
        if adjustment != ZERO:
            entries.append(
                LedgerEntry(
                    on=sale.paid_on or sale.sold_on,
                    kind="sale",
                    reference=sale.reference,
                    description="Shipping and tax, less fees",
                    person=sale.collected_by.full_name,
                    amount=adjustment,
                    state=sale.state,
                    counted=counted,
                    sale_id=sale.id,
                )
            )

    expenses = db.execute(
        select(VehicleExpense)
        .options(selectinload(VehicleExpense.paid_by), selectinload(VehicleExpense.vehicle))
        .where(
            VehicleExpense.incurred_on >= period_start,
            VehicleExpense.incurred_on <= period_end,
        )
    ).scalars()

    for expense in expenses:
        entries.append(
            LedgerEntry(
                on=expense.incurred_on,
                kind="expense",
                reference=expense.category,
                description=expense.description,
                vehicle_id=expense.vehicle_id,
                vehicle_name=expense.vehicle.display_name if expense.vehicle else None,
                person=expense.paid_by.full_name,
                amount=-money(expense.amount),
            )
        )

    settlements = db.execute(
        select(Settlement)
        .options(selectinload(Settlement.from_user), selectinload(Settlement.to_user))
        .where(Settlement.paid_on >= period_start, Settlement.paid_on <= period_end)
    ).scalars()

    for settlement in settlements:
        entries.append(
            LedgerEntry(
                on=settlement.paid_on,
                kind="settlement",
                reference="settle up",
                description=(
                    f"{settlement.from_user.full_name} paid {settlement.to_user.full_name}"
                ),
                person=settlement.from_user.full_name,
                # Moves cash between partners without changing what the venture
                # made, so it is shown at zero rather than counted twice.
                amount=ZERO,
            )
        )

    entries.sort(key=lambda entry: (entry.on, entry.kind, entry.reference))

    # Split by what the row *is*, not by its sign, so these match the Money
    # page exactly. Fees are a negative sale row: they reduce what came in
    # rather than counting as money spent, which is how the ledger treats them.
    counted_entries = [entry for entry in entries if entry.counted]
    money_in = money(sum((e.amount for e in counted_entries if e.kind == "sale"), ZERO))
    money_out = money(-sum((e.amount for e in counted_entries if e.kind == "expense"), ZERO))

    return Ledger(
        entries=entries,
        money_in=money_in,
        money_out=money_out,
        profit=money(money_in - money_out),
        uncounted=money(sum((e.amount for e in entries if not e.counted), ZERO)),
    )


class AuditRead(ORMModel):
    id: int
    at: datetime
    user_name: str | None = None
    action: str
    entity: str
    entity_id: int | None = None
    label: str | None = None
    changes: dict[str, Any] | None = None


@router.get("/audit", response_model=Page[AuditRead])
def audit(
    db: DbSession,
    _: RequireEditor,
    entity: str | None = None,
    entity_id: int | None = None,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
) -> Page[AuditRead]:
    """Who changed what. Open to staff as well as admins, deliberately.

    Two people splitting takings need to be able to check each other's working
    without asking permission first; a history only one of them can read
    answers the wrong question.
    """
    query = select(AuditEntry)
    if entity:
        query = query.where(AuditEntry.entity == entity)
    if entity_id is not None:
        query = query.where(AuditEntry.entity_id == entity_id)

    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()
    rows = db.execute(
        query.order_by(AuditEntry.at.desc(), AuditEntry.id.desc()).limit(limit).offset(offset)
    ).scalars()

    return Page[AuditRead](
        items=[AuditRead.model_validate(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )
