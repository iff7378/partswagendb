from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.core.deps import CurrentUser, DbSession, RequireEditor
from app.models import Part, PartCategory, Tag
from app.schemas.common import Message
from app.schemas.part import CategoryCreate, CategoryRead, TagRead

router = APIRouter(tags=["catalog"])


def _slugify(name: str, parent: PartCategory | None) -> str:
    base = name.strip().lower().replace(" ", "-")
    base = "".join(c for c in base if c.isalnum() or c == "-").strip("-")
    return f"{parent.slug}/{base}" if parent else base


@router.get("/categories", response_model=list[CategoryRead])
def list_categories(db: DbSession, _: CurrentUser) -> list[PartCategory]:
    return list(db.execute(select(PartCategory).order_by(PartCategory.path)).scalars())


@router.post("/categories", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
def create_category(db: DbSession, _: RequireEditor, payload: CategoryCreate) -> PartCategory:
    parent = None
    if payload.parent_id is not None:
        parent = db.get(PartCategory, payload.parent_id)
        if parent is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Parent category not found"
            )

    slug = _slugify(payload.name, parent)
    if db.execute(select(PartCategory).where(PartCategory.slug == slug)).scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="That category already exists"
        )

    category = PartCategory(
        name=payload.name.strip(),
        parent_id=payload.parent_id,
        slug=slug,
        path=f"{parent.path} / {payload.name.strip()}" if parent else payload.name.strip(),
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@router.delete("/categories/{category_id}", response_model=Message)
def delete_category(db: DbSession, _: RequireEditor, category_id: int) -> Message:
    category = db.get(PartCategory, category_id)
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    if category.children:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Delete the child categories first"
        )

    part_count = db.execute(
        select(func.count()).select_from(Part).where(Part.category_id == category_id)
    ).scalar_one()
    if part_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{part_count} part(s) use this category. Recategorise them first.",
        )

    db.delete(category)
    db.commit()
    return Message(detail=f"Deleted category {category.name}")


@router.get("/tags", response_model=list[TagRead])
def list_tags(db: DbSession, _: CurrentUser) -> list[Tag]:
    return list(db.execute(select(Tag).order_by(Tag.name)).scalars())
