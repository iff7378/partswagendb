from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.deps import CurrentUser, DbSession, RequireEditor
from app.enums import PartStatus
from app.models import Part, Sale, SaleItem, User
from app.schemas.common import Message, Page
from app.schemas.sale import SaleCreate, SaleDetail, SaleRead, SaleUpdate
from app.services.identifiers import next_sale_reference

router = APIRouter(prefix="/sales", tags=["sales"])

_LOADERS = (selectinload(Sale.items).selectinload(SaleItem.part), selectinload(Sale.collected_by))


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
        item.part_sku = source.part.sku if source.part else None
    return detail


@router.get("", response_model=Page[SaleRead])
def list_sales(
    db: DbSession,
    _: CurrentUser,
    collected_by_id: int | None = None,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
) -> Page[SaleRead]:
    query = select(Sale).options(*_LOADERS)
    if collected_by_id is not None:
        query = query.where(Sale.collected_by_id == collected_by_id)

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
        part = None
        if line.part_id is not None:
            part = db.get(Part, line.part_id)
            if part is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Part {line.part_id} does not exist",
                )
            if part.status == PartStatus.SOLD:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Part {part.sku} is already marked sold",
                )
            part.status = PartStatus.SOLD

        description = line.description or (part.title if part else None)
        if not description:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Each line needs either a part or a description",
            )

        sale.items.append(
            SaleItem(
                part_id=line.part_id,
                description=description,
                quantity=line.quantity,
                unit_price=line.unit_price,
            )
        )

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

    if "collected_by_id" in updates and db.get(User, updates["collected_by_id"]) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Collecting user does not exist"
        )

    for field, value in updates.items():
        setattr(sale, field, value)

    db.commit()
    return _to_detail(_get_or_404(db, sale_id))


@router.delete("/{sale_id}", response_model=Message)
def delete_sale(db: DbSession, _: RequireEditor, sale_id: int) -> Message:
    """Void a sale and return its parts to available stock."""
    sale = _get_or_404(db, sale_id)

    for item in sale.items:
        if item.part is not None and item.part.status == PartStatus.SOLD:
            item.part.status = PartStatus.AVAILABLE

    reference = sale.reference
    db.delete(sale)
    db.commit()
    return Message(detail=f"Voided sale {reference}")
