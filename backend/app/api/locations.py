from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.core.deps import CurrentUser, DbSession, RequireEditor
from app.models import Location, Part
from app.schemas.common import Message
from app.schemas.location import LocationCreate, LocationNode, LocationRead, LocationUpdate
from app.services.identifiers import build_location_code

router = APIRouter(prefix="/locations", tags=["locations"])


def _get_or_404(db: DbSession, location_id: int) -> Location:
    location = db.get(Location, location_id)
    if location is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found")
    return location


def _compute_path(location: Location, parent: Location | None) -> str:
    return f"{parent.path} / {location.name}" if parent else location.name


def _refresh_descendant_paths(db: DbSession, location: Location) -> None:
    """Rewrite cached paths for a subtree after a rename or move."""
    for child in location.children:
        child.path = _compute_path(child, location)
        _refresh_descendant_paths(db, child)


@router.get("", response_model=list[LocationRead])
def list_locations(db: DbSession, _: CurrentUser) -> list[Location]:
    return list(db.execute(select(Location).order_by(Location.path)).scalars())


@router.get("/tree", response_model=list[LocationNode])
def location_tree(db: DbSession, _: CurrentUser) -> list[LocationNode]:
    locations = list(db.execute(select(Location).order_by(Location.name)).scalars())

    counts = dict(
        db.execute(select(Part.location_id, func.count()).group_by(Part.location_id)).all()
    )

    nodes = {
        loc.id: LocationNode.model_validate(loc, update={"part_count": counts.get(loc.id, 0)})
        for loc in locations
    }

    roots: list[LocationNode] = []
    for loc in locations:
        node = nodes[loc.id]
        parent = nodes.get(loc.parent_id) if loc.parent_id else None
        if parent is None:
            roots.append(node)
        else:
            parent.children.append(node)
    return roots


@router.get("/by-code/{code}", response_model=LocationRead)
def get_by_code(db: DbSession, _: CurrentUser, code: str) -> Location:
    """Resolve a scanned location QR code to its record."""
    location = db.execute(
        select(Location).where(Location.code == code.upper().strip())
    ).scalar_one_or_none()
    if location is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown location code")
    return location


@router.post("", response_model=LocationRead, status_code=status.HTTP_201_CREATED)
def create_location(db: DbSession, _: RequireEditor, payload: LocationCreate) -> Location:
    parent = _get_or_404(db, payload.parent_id) if payload.parent_id else None

    code = (
        payload.code.upper().strip()
        if payload.code
        else build_location_code(db, payload.name, parent)
    )
    if db.execute(select(Location).where(Location.code == code)).scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Location code {code} is already in use"
        )

    location = Location(**payload.model_dump(exclude={"code"}), code=code)
    location.path = _compute_path(location, parent)
    db.add(location)
    db.commit()
    db.refresh(location)
    return location


@router.patch("/{location_id}", response_model=LocationRead)
def update_location(
    db: DbSession, _: RequireEditor, location_id: int, payload: LocationUpdate
) -> Location:
    location = _get_or_404(db, location_id)
    updates = payload.model_dump(exclude_unset=True)

    if "parent_id" in updates and updates["parent_id"] != location.parent_id:
        new_parent_id = updates["parent_id"]
        if new_parent_id == location_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A location cannot be its own parent",
            )
        if new_parent_id is not None:
            new_parent = _get_or_404(db, new_parent_id)
            # Walk up from the proposed parent; hitting this node means a cycle.
            cursor: Location | None = new_parent
            while cursor is not None:
                if cursor.id == location_id:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="That move would nest this location inside itself",
                    )
                cursor = cursor.parent

    for field, value in updates.items():
        setattr(location, field, value)

    db.flush()
    parent = db.get(Location, location.parent_id) if location.parent_id else None
    location.path = _compute_path(location, parent)
    _refresh_descendant_paths(db, location)

    db.commit()
    db.refresh(location)
    return location


@router.delete("/{location_id}", response_model=Message)
def delete_location(db: DbSession, _: RequireEditor, location_id: int) -> Message:
    location = _get_or_404(db, location_id)

    if location.children:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Delete or move the child locations first",
        )

    part_count = db.execute(
        select(func.count()).select_from(Part).where(Part.location_id == location_id)
    ).scalar_one()
    if part_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{part_count} part(s) are stored here. Move them first.",
        )

    db.delete(location)
    db.commit()
    return Message(detail=f"Deleted location {location.code}")
