from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.deps import CurrentUser, DbSession, RequireEditor
from app.enums import PartCondition, PartStatus
from app.models import Location, Part, PartCategory, Tag, Vehicle
from app.schemas.common import Message, Page
from app.schemas.part import PartCreate, PartDetail, PartMove, PartRead, PartUpdate
from app.services.identifiers import next_part_sku
from app.services.storage import presigned_url

router = APIRouter(prefix="/parts", tags=["parts"])

_LOADERS = (
    selectinload(Part.vehicle),
    selectinload(Part.category),
    selectinload(Part.location),
    selectinload(Part.tags),
    selectinload(Part.photos),
)


def _get_or_404(db: Session, part_id: int) -> Part:
    part = db.execute(
        select(Part).options(*_LOADERS).where(Part.id == part_id)
    ).scalar_one_or_none()
    if part is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Part not found")
    return part


def _resolve_tags(db: Session, names: list[str]) -> list[Tag]:
    tags: list[Tag] = []
    for raw in names:
        name = raw.strip().lower()
        if not name:
            continue
        tag = db.execute(select(Tag).where(Tag.name == name)).scalar_one_or_none()
        if tag is None:
            tag = Tag(name=name)
            db.add(tag)
            db.flush()
        tags.append(tag)
    return tags


def _validate_references(db: Session, data: dict[str, object]) -> None:
    for field, model, label in (
        ("vehicle_id", Vehicle, "Vehicle"),
        ("category_id", PartCategory, "Category"),
        ("location_id", Location, "Location"),
    ):
        value = data.get(field)
        if value is not None and db.get(model, value) is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"{label} {value} does not exist"
            )


def _to_read(part: Part) -> PartRead:
    read = PartRead.model_validate(part)
    primary = next((p for p in part.photos if p.is_primary), None) or (
        part.photos[0] if part.photos else None
    )
    if primary:
        read.primary_photo_url = presigned_url(primary.thumbnail_key or primary.object_key)
    return read


def _to_detail(part: Part) -> PartDetail:
    detail = PartDetail.model_validate(part)
    for photo, source in zip(detail.photos, part.photos, strict=True):
        photo.url = presigned_url(source.object_key)
        photo.thumbnail_url = presigned_url(source.thumbnail_key or source.object_key)
    primary = next((p for p in detail.photos if p.is_primary), None) or (
        detail.photos[0] if detail.photos else None
    )
    detail.primary_photo_url = primary.thumbnail_url if primary else None
    return detail


@router.get("", response_model=Page[PartRead])
def list_parts(
    db: DbSession,
    _: CurrentUser,
    q: str | None = None,
    part_status: str | None = Query(default=None, alias="status"),
    condition: PartCondition | None = None,
    vehicle_id: int | None = None,
    category_id: int | None = None,
    location_id: int | None = None,
    tag: str | None = None,
    needs_details: bool = Query(
        default=False, description="Only parts missing category, location or price"
    ),
    limit: int = Query(default=50, le=200),
    offset: int = 0,
) -> Page[PartRead]:
    query = select(Part).options(*_LOADERS)

    if q:
        term = f"%{q.strip()}%"
        query = query.where(
            or_(
                Part.sku.ilike(term),
                Part.title.ilike(term),
                Part.part_number.ilike(term),
                Part.oem_number.ilike(term),
                Part.manufacturer.ilike(term),
                Part.description.ilike(term),
            )
        )
    if part_status:
        query = query.where(Part.status == part_status)
    if condition:
        query = query.where(Part.condition == condition)
    if vehicle_id is not None:
        query = query.where(Part.vehicle_id == vehicle_id)
    if category_id is not None:
        query = query.where(Part.category_id == category_id)
    if location_id is not None:
        query = query.where(Part.location_id == location_id)
    if tag:
        query = query.where(Part.tags.any(Tag.name == tag.strip().lower()))
    if needs_details:
        query = query.where(
            or_(
                Part.category_id.is_(None),
                Part.location_id.is_(None),
                Part.asking_price.is_(None),
                Part.status == PartStatus.DRAFT,
            )
        )

    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()
    rows = db.execute(query.order_by(Part.created_at.desc()).limit(limit).offset(offset)).scalars()

    return Page[PartRead](
        items=[_to_read(p) for p in rows], total=total, limit=limit, offset=offset
    )


@router.get("/by-sku/{sku}", response_model=PartDetail)
def get_by_sku(db: DbSession, _: CurrentUser, sku: str) -> PartDetail:
    """Resolve a scanned part QR code to its record."""
    part = db.execute(
        select(Part).options(*_LOADERS).where(Part.sku == sku.upper().strip())
    ).scalar_one_or_none()
    if part is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown part SKU")
    return _to_detail(part)


@router.post("", response_model=PartDetail, status_code=status.HTTP_201_CREATED)
def create_part(db: DbSession, user: RequireEditor, payload: PartCreate) -> PartDetail:
    data = payload.model_dump(exclude={"tags"})
    _validate_references(db, data)

    part = Part(**data, sku=next_part_sku(db), created_by_id=user.id)
    part.tags = _resolve_tags(db, payload.tags)

    db.add(part)
    db.commit()
    db.refresh(part)
    return _to_detail(_get_or_404(db, part.id))


@router.get("/{part_id}", response_model=PartDetail)
def get_part(db: DbSession, _: CurrentUser, part_id: int) -> PartDetail:
    return _to_detail(_get_or_404(db, part_id))


@router.patch("/{part_id}", response_model=PartDetail)
def update_part(db: DbSession, _: RequireEditor, part_id: int, payload: PartUpdate) -> PartDetail:
    part = _get_or_404(db, part_id)
    updates = payload.model_dump(exclude_unset=True, exclude={"tags"})
    _validate_references(db, updates)

    for field, value in updates.items():
        setattr(part, field, value)

    if payload.tags is not None:
        part.tags = _resolve_tags(db, payload.tags)

    db.commit()
    db.refresh(part)
    return _to_detail(_get_or_404(db, part_id))


@router.post("/{part_id}/move", response_model=PartDetail)
def move_part(db: DbSession, _: RequireEditor, part_id: int, payload: PartMove) -> PartDetail:
    """Relocate a part, accepting either a location id or a scanned location code."""
    part = _get_or_404(db, part_id)

    if payload.location_code:
        location = db.execute(
            select(Location).where(Location.code == payload.location_code.upper().strip())
        ).scalar_one_or_none()
        if location is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Unknown location code"
            )
        part.location_id = location.id
    elif payload.location_id is not None:
        if db.get(Location, payload.location_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found")
        part.location_id = payload.location_id
    else:
        part.location_id = None

    db.commit()
    return _to_detail(_get_or_404(db, part_id))


@router.delete("/{part_id}", response_model=Message)
def delete_part(db: DbSession, _: RequireEditor, part_id: int) -> Message:
    part = _get_or_404(db, part_id)
    if part.status == PartStatus.SOLD:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Sold parts cannot be deleted because a sale references them",
        )

    sku = part.sku
    db.delete(part)
    db.commit()
    return Message(detail=f"Deleted part {sku}")
