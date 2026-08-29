from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, or_, select

from app.core.deps import CurrentUser, DbSession, RequireEditor
from app.enums import PartStatus
from app.models import Part, Sale, SaleItem, Vehicle, VehicleExpense
from app.schemas.common import Message, Page
from app.schemas.vehicle import (
    VehicleCreate,
    VehicleDetail,
    VehicleRead,
    VehicleUpdate,
    VinDecodeResult,
    normalise_vin,
)
from app.services.identifiers import next_vehicle_stock_number
from app.services.ledger import ZERO, money
from app.services.vin import decode_vin

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


def _get_or_404(db: DbSession, vehicle_id: int) -> Vehicle:
    vehicle = db.get(Vehicle, vehicle_id)
    if vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
    return vehicle


@router.get("/decode/{vin}", response_model=VinDecodeResult)
async def decode(vin: str, _: CurrentUser) -> VinDecodeResult:
    try:
        clean_vin = normalise_vin(vin)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if clean_vin is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="VIN is required")

    result = await decode_vin(clean_vin)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not decode this VIN right now. Enter the details manually.",
        )
    return result


@router.get("", response_model=Page[VehicleRead])
def list_vehicles(
    db: DbSession,
    _: CurrentUser,
    q: str | None = None,
    vehicle_status: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, le=200),
    offset: int = 0,
) -> Page[VehicleRead]:
    query = select(Vehicle)
    if q:
        term = f"%{q.strip()}%"
        query = query.where(
            or_(
                Vehicle.vin.ilike(term),
                Vehicle.stock_number.ilike(term),
                Vehicle.make.ilike(term),
                Vehicle.model.ilike(term),
            )
        )
    if vehicle_status:
        query = query.where(Vehicle.status == vehicle_status)

    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()
    rows = db.execute(
        query.order_by(Vehicle.created_at.desc()).limit(limit).offset(offset)
    ).scalars()

    return Page[VehicleRead](
        items=[VehicleRead.model_validate(v) for v in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=VehicleRead, status_code=status.HTTP_201_CREATED)
async def create_vehicle(db: DbSession, user: RequireEditor, payload: VehicleCreate) -> Vehicle:
    data = payload.model_dump(exclude={"decode_vin", "stock_number"})

    if data.get("vin"):
        existing = db.execute(
            select(Vehicle).where(Vehicle.vin == data["vin"])
        ).scalar_one_or_none()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"VIN already recorded as {existing.stock_number}",
            )

    decoded_data = None
    if payload.decode_vin and data.get("vin"):
        result = await decode_vin(data["vin"])
        if result:
            decoded_data = result.raw
            # Anything the user typed wins; decoding only fills the gaps.
            for field in (
                "year",
                "make",
                "model",
                "trim",
                "engine",
                "transmission",
                "drive_type",
                "body_style",
            ):
                if not data.get(field):
                    data[field] = getattr(result, field)

    vehicle = Vehicle(
        **data,
        stock_number=payload.stock_number or next_vehicle_stock_number(db),
        decoded_data=decoded_data,
        created_by_id=user.id,
    )
    db.add(vehicle)
    db.commit()
    db.refresh(vehicle)
    return vehicle


@router.get("/{vehicle_id}", response_model=VehicleDetail)
def get_vehicle(db: DbSession, _: CurrentUser, vehicle_id: int) -> VehicleDetail:
    vehicle = _get_or_404(db, vehicle_id)

    part_count = db.execute(
        select(func.count()).select_from(Part).where(Part.vehicle_id == vehicle_id)
    ).scalar_one()
    parts_sold = db.execute(
        select(func.count())
        .select_from(Part)
        .where(Part.vehicle_id == vehicle_id, Part.status == PartStatus.SOLD)
    ).scalar_one()

    expenses = db.execute(
        select(func.sum(VehicleExpense.amount)).where(VehicleExpense.vehicle_id == vehicle_id)
    ).scalar_one_or_none()

    # Revenue attributable to this vehicle: sale lines for parts that came off it.
    revenue = db.execute(
        select(func.sum(SaleItem.unit_price * SaleItem.quantity))
        .select_from(SaleItem)
        .join(Part, Part.id == SaleItem.part_id)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .where(Part.vehicle_id == vehicle_id)
    ).scalar_one_or_none()

    total_expenses = money(expenses) if expenses else ZERO
    total_revenue = money(revenue) if revenue else ZERO

    detail = VehicleDetail.model_validate(vehicle)
    detail.part_count = part_count
    detail.parts_sold = parts_sold
    detail.total_expenses = total_expenses
    detail.total_revenue = total_revenue
    detail.profit = money(total_revenue - total_expenses)
    return detail


@router.patch("/{vehicle_id}", response_model=VehicleRead)
def update_vehicle(
    db: DbSession, _: RequireEditor, vehicle_id: int, payload: VehicleUpdate
) -> Vehicle:
    vehicle = _get_or_404(db, vehicle_id)
    updates = payload.model_dump(exclude_unset=True)

    if updates.get("vin"):
        clash = db.execute(
            select(Vehicle).where(Vehicle.vin == updates["vin"], Vehicle.id != vehicle_id)
        ).scalar_one_or_none()
        if clash:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"VIN already recorded as {clash.stock_number}",
            )

    for field, value in updates.items():
        setattr(vehicle, field, value)

    db.commit()
    db.refresh(vehicle)
    return vehicle


@router.delete("/{vehicle_id}", response_model=Message)
def delete_vehicle(db: DbSession, _: RequireEditor, vehicle_id: int) -> Message:
    vehicle = _get_or_404(db, vehicle_id)

    part_count = db.execute(
        select(func.count()).select_from(Part).where(Part.vehicle_id == vehicle_id)
    ).scalar_one()
    if part_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{part_count} part(s) still reference this vehicle. Reassign or delete them first."
            ),
        )

    db.delete(vehicle)
    db.commit()
    return Message(detail=f"Deleted vehicle {vehicle.stock_number}")
