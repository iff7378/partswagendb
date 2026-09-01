from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.deps import CurrentUser, DbSession, RequireEditor
from app.enums import PartStatus, SaleState, VehicleStatus
from app.models import Part, Sale, SaleItem, User, Vehicle
from app.schemas.common import Message, Page
from app.schemas.sale import SaleCreate, SaleDetail, SaleItemCreate, SaleRead, SaleUpdate
from app.services.identifiers import next_sale_reference

router = APIRouter(prefix="/sales", tags=["sales"])

_LOADERS = (
    selectinload(Sale.items).selectinload(SaleItem.parts),
    selectinload(Sale.items).selectinload(SaleItem.vehicle),
    selectinload(Sale.collected_by),
)

# Where a part goes back to when it comes off a sale. Draft is deliberately not
# restored: by the time something has been sold it is a real part, not a stub.
RETURNED_STATUS = PartStatus.AVAILABLE

_STATE_FILTERS = {
    SaleState.PENDING: (Sale.paid_on.is_(None), Sale.fulfilled_on.is_(None)),
    SaleState.PAID: (Sale.paid_on.is_not(None), Sale.fulfilled_on.is_(None)),
    SaleState.GONE: (Sale.paid_on.is_(None), Sale.fulfilled_on.is_not(None)),
    SaleState.COMPLETE: (Sale.paid_on.is_not(None), Sale.fulfilled_on.is_not(None)),
}


def _get_or_404(db: Session, sale_id: int) -> Sale:
    sale = db.execute(
        select(Sale).options(*_LOADERS).where(Sale.id == sale_id)
    ).scalar_one_or_none()
    if sale is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sale not found")
    return sale


def _to_detail(sale: Sale) -> SaleDetail:
    detail = SaleDetail.model_validate(sale)
    for item, source in zip(detail.items, sale.items, strict=True):
        item.vehicle_name = source.vehicle.display_name if source.vehicle else None
    return detail


def _build_line(db: Session, line: SaleItemCreate, sale_id: int | None) -> SaleItem:
    """Turn one submitted line into a SaleItem, claiming whatever it covers.

    A line is any of: some parts, a whole car going for scrap, a lot named
    against a car, or free text. They differ only in what they point at.
    """
    if line.is_shell and line.part_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A scrapped shell is the car itself, so it cannot also list parts",
        )
    if line.is_shell and line.vehicle_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Say which car was scrapped",
        )

    parts: list[Part] = []
    for part_id in dict.fromkeys(line.part_ids):
        part = db.get(Part, part_id)
        if part is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Part {part_id} does not exist",
            )
        # Sold on some *other* sale is a conflict; sold on this one is just
        # the line being edited, so it stays put.
        clash = db.execute(
            select(Sale.reference)
            .join(SaleItem, SaleItem.sale_id == Sale.id)
            .join(SaleItem.parts)
            .where(Part.id == part.id, Sale.id != sale_id)
            .limit(1)
        ).scalar_one_or_none()
        if clash is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"{part.sku} is already on sale {clash}",
            )
        parts.append(part)

    vehicle = None
    if line.vehicle_id is not None:
        vehicle = db.get(Vehicle, line.vehicle_id)
        if vehicle is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Car {line.vehicle_id} does not exist",
            )

    if line.is_shell and vehicle is not None:
        # A shell can only be weighed in once. Checking for an existing line
        # rather than the status, because the status can be set by hand
        # without any money having changed hands.
        already = db.execute(
            select(Sale.reference)
            .join(SaleItem, SaleItem.sale_id == Sale.id)
            .where(
                SaleItem.vehicle_id == vehicle.id,
                SaleItem.is_shell.is_(True),
                Sale.id != sale_id,
            )
            .limit(1)
        ).scalar_one_or_none()
        if already is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"{vehicle.display_name} was already scrapped on sale {already}",
            )

    description = line.description
    if not description and len(parts) == 1:
        description = parts[0].title
    if not description and parts:
        description = f"{len(parts)} parts"
    if not description and line.is_shell and vehicle is not None:
        description = f"{vehicle.display_name} — shell scrapped"
    if not description and vehicle is not None:
        description = f"Parts off {vehicle.display_name}"
    if not description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Each line needs a part, a car, or a description",
        )

    item = SaleItem(
        vehicle_id=line.vehicle_id,
        is_shell=line.is_shell,
        description=description,
        quantity=line.quantity,
        unit_price=line.unit_price,
    )
    item.parts = parts
    # Set the relationship, not just the id: _apply_state runs before the flush
    # that would populate it, and would otherwise see no car to scrap.
    item.vehicle = vehicle
    return item


def _apply_state(sale: Sale) -> None:
    """Push the sale's state onto the stock it covers.

    Agreed but not handed over means reserved: the part is spoken for and must
    not be sold twice, but it is still on the shelf. Handover is what makes it
    sold, and what sends a shell to the yard.
    """
    gone = sale.fulfilled_on is not None
    for item in sale.items:
        for part in item.parts:
            part.status = PartStatus.SOLD if gone else PartStatus.RESERVED
        if item.is_shell and item.vehicle is not None:
            if gone:
                item.vehicle.status = VehicleStatus.SCRAPPED
            elif item.vehicle.status == VehicleStatus.SCRAPPED:
                item.vehicle.status = VehicleStatus.STRIPPED


def _release(sale: Sale) -> None:
    """Give back everything a sale is holding, before it is voided or rewritten."""
    for item in sale.items:
        for part in item.parts:
            if part.status in (PartStatus.SOLD, PartStatus.RESERVED):
                part.status = RETURNED_STATUS
        # The shell never went to the yard after all, so it is back to being a
        # stripped car sitting on the property.
        if (
            item.is_shell
            and item.vehicle is not None
            and item.vehicle.status == VehicleStatus.SCRAPPED
        ):
            item.vehicle.status = VehicleStatus.STRIPPED


@router.get("", response_model=Page[SaleRead])
def list_sales(
    db: DbSession,
    _: CurrentUser,
    collected_by_id: int | None = None,
    state: SaleState | None = None,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
) -> Page[SaleRead]:
    query = select(Sale).options(*_LOADERS)
    if collected_by_id is not None:
        query = query.where(Sale.collected_by_id == collected_by_id)
    if state is not None:
        # The state is derived from two dates, so it is filtered the same way
        # rather than being stored and risking drift.
        query = query.where(*_STATE_FILTERS[state])

    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()
    rows = db.execute(
        query.order_by(Sale.sold_on.desc(), Sale.id.desc()).limit(limit).offset(offset)
    ).scalars()

    return Page[SaleRead](
        items=[SaleRead.model_validate(s) for s in rows], total=total, limit=limit, offset=offset
    )


@router.post("", response_model=SaleDetail, status_code=status.HTTP_201_CREATED)
def create_sale(db: DbSession, user: RequireEditor, payload: SaleCreate) -> SaleDetail:
    if db.get(User, payload.collected_by_id) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Collecting user does not exist"
        )

    sale = Sale(
        **payload.model_dump(exclude={"items"}),
        reference=next_sale_reference(db),
        created_by_id=user.id,
    )
    for line in payload.items:
        sale.items.append(_build_line(db, line, sale_id=None))

    _apply_state(sale)
    db.add(sale)
    db.commit()
    return _to_detail(_get_or_404(db, sale.id))


@router.get("/{sale_id}", response_model=SaleDetail)
def get_sale(db: DbSession, _: CurrentUser, sale_id: int) -> SaleDetail:
    return _to_detail(_get_or_404(db, sale_id))


@router.patch("/{sale_id}", response_model=SaleDetail)
def update_sale(db: DbSession, _: RequireEditor, sale_id: int, payload: SaleUpdate) -> SaleDetail:
    sale = _get_or_404(db, sale_id)
    updates = payload.model_dump(exclude_unset=True)
    items = updates.pop("items", None)

    if "collected_by_id" in updates and db.get(User, updates["collected_by_id"]) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Collecting user does not exist"
        )

    for field, value in updates.items():
        setattr(sale, field, value)

    if items is not None:
        if not items:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="A sale needs at least one line"
            )
        # Release first, then re-claim: a line that keeps a part must not trip
        # its own already-sold check, and one that drops a part must free it.
        _release(sale)
        db.flush()
        sale.items.clear()
        db.flush()
        for line in items:
            sale.items.append(_build_line(db, SaleItemCreate.model_validate(line), sale_id=sale.id))

    # Runs whether the lines or the dates changed: marking a sale collected is
    # what turns a reservation into a sale, and un-marking it reverses that.
    _apply_state(sale)
    db.commit()
    return _to_detail(_get_or_404(db, sale_id))


@router.delete("/{sale_id}", response_model=Message)
def delete_sale(db: DbSession, _: RequireEditor, sale_id: int) -> Message:
    """Void a sale and return its parts to available stock."""
    sale = _get_or_404(db, sale_id)
    _release(sale)

    reference = sale.reference
    db.delete(sale)
    db.commit()
    return Message(detail=f"Voided sale {reference}")
