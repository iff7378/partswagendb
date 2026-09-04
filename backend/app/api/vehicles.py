from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import selectinload

from app.config import settings
from app.core.deps import CurrentUser, DbSession, RequireEditor
from app.enums import PartStatus
from app.models import Part, Sale, SaleItem, Vehicle, VehicleExpense
from app.schemas.common import Message, Page
from app.schemas.vehicle import (
    VehicleCreate,
    VehicleDetail,
    VehicleRead,
    VehicleSaleLine,
    VehicleUpdate,
    VinDecodeResult,
    normalise_vin,
)
from app.services.identifiers import next_vehicle_stock_number
from app.services.ledger import ZERO, money
from app.services.ocr import extract_text, find_vins
from app.services.storage import ALLOWED_CONTENT_TYPES
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


@router.post("/scan-vin", response_model=VinDecodeResult)
async def scan_vin(_: RequireEditor, file: UploadFile = File(...)) -> VinDecodeResult:
    """Read a VIN off a photo of a registration sticker, title or door jamb.

    Printed VINs OCR far more reliably than stamped part numbers, so this is
    usually quicker than typing seventeen characters by hand.
    """
    content_type = file.content_type or ""
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported image type {content_type}",
        )

    data = await file.read()
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Image is too large"
        )

    candidates = find_vins(extract_text(data))
    if not candidates:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No VIN found in that photo. Try a closer, straighter shot.",
        )

    # Decoding also proves the VIN is real rather than a plausible-looking misread.
    for vin in candidates:
        decoded = await decode_vin(vin)
        if decoded and decoded.make:
            return decoded

    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=f'Read "{candidates[0]}" but no vehicle matches it. Check the photo or type it in.',
    )


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

    # Marking the VIN unknown wins over a stale value in the field.
    if data.get("vin_unknown"):
        data["vin"] = None

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

    # Revenue attributable to this car: lines named against it, plus lines
    # whose parts came off it. Picked out as distinct line ids first, because a
    # lot line joins once per part and would otherwise be counted several times.
    line_total = func.sum(SaleItem.unit_price * SaleItem.quantity)
    attributed = (
        select(SaleItem.id)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .outerjoin(SaleItem.parts)
        .where(
            # Only money that has actually landed, matching the ledger.
            Sale.paid_on.is_not(None),
            Sale.voided_at.is_(None),
            or_(
                SaleItem.vehicle_id == vehicle_id,
                # A line naming a car has already been counted by that car, so
                # its parts must not drag it onto a second one.
                and_(SaleItem.vehicle_id.is_(None), Part.vehicle_id == vehicle_id),
            ),
        )
        .distinct()
    )
    revenue = db.execute(select(line_total).where(SaleItem.id.in_(attributed))).scalar_one_or_none()

    scrap = db.execute(
        select(line_total)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .where(
            Sale.paid_on.is_not(None),
            Sale.voided_at.is_(None),
            SaleItem.vehicle_id == vehicle_id,
            SaleItem.is_shell.is_(True),
        )
    ).scalar_one_or_none()

    total_expenses = money(expenses) if expenses else ZERO
    total_revenue = money(revenue) if revenue else ZERO

    detail = VehicleDetail.model_validate(vehicle)
    detail.part_count = part_count
    detail.parts_sold = parts_sold
    detail.total_expenses = total_expenses
    detail.total_revenue = total_revenue
    detail.scrap_revenue = money(scrap) if scrap else ZERO
    detail.profit = money(total_revenue - total_expenses)
    return detail


@router.patch("/{vehicle_id}", response_model=VehicleRead)
def update_vehicle(
    db: DbSession, _: RequireEditor, vehicle_id: int, payload: VehicleUpdate
) -> Vehicle:
    vehicle = _get_or_404(db, vehicle_id)
    updates = payload.model_dump(exclude_unset=True)

    if updates.get("vin_unknown"):
        updates["vin"] = None
    elif updates.get("vin"):
        updates["vin_unknown"] = False

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


@router.get("/{vehicle_id}/sales", response_model=list[VehicleSaleLine])
def vehicle_sales(db: DbSession, _: CurrentUser, vehicle_id: int) -> list[VehicleSaleLine]:
    """Every line of income booked against this car, paid or not.

    The car page previously showed only what had been spent, which made a car
    look like a pure loss. Unpaid lines are included and labelled, because
    "agreed but not paid" is worth seeing next to the costs even though it does
    not count towards profit yet.
    """
    _get_or_404(db, vehicle_id)

    # Ids first: a lot line joins once per part, so it has to be de-duplicated.
    # Postgres refuses SELECT DISTINCT when the ORDER BY names a column outside
    # the select list, so the ordering waits for the second query. (SQLite
    # allows it, which is why the tests alone would not have caught this.)
    attributed = (
        select(SaleItem.id)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .outerjoin(SaleItem.parts)
        .where(
            Sale.voided_at.is_(None),
            or_(
                SaleItem.vehicle_id == vehicle_id,
                and_(SaleItem.vehicle_id.is_(None), Part.vehicle_id == vehicle_id),
            ),
        )
        .distinct()
    )

    rows = db.execute(
        select(SaleItem)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .where(SaleItem.id.in_(attributed))
        .options(selectinload(SaleItem.sale), selectinload(SaleItem.parts))
        .order_by(Sale.sold_on.desc(), SaleItem.id)
    ).scalars()

    return [
        VehicleSaleLine(
            sale_id=item.sale.id,
            reference=item.sale.reference,
            sold_on=item.sale.sold_on,
            paid_on=item.sale.paid_on,
            state=item.sale.state,
            buyer_name=item.sale.buyer_name,
            description=item.description,
            is_shell=item.is_shell,
            quantity=item.quantity,
            line_total=item.line_total,
            via="shell" if item.is_shell else ("car" if item.vehicle_id else "parts"),
        )
        for item in rows
    ]
