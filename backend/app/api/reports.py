import csv
import io
from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Query, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser, DbSession
from app.enums import PartStatus
from app.models import Part, Sale, SaleItem, Vehicle, VehicleExpense
from app.services.ledger import ZERO, money

router = APIRouter(tags=["reports"])


class DashboardStats(BaseModel):
    parts_total: int
    parts_available: int
    parts_draft: int
    parts_sold: int
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
        .where(Sale.sold_on >= cutoff)
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
        vehicles_total=db.execute(select(func.count()).select_from(Vehicle)).scalar_one(),
        vehicles_in_teardown=db.execute(
            select(func.count()).select_from(Vehicle).where(Vehicle.status == "teardown")
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
