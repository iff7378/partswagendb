from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession
from app.models import Location, Part
from app.services.labels import render_label_sheet

router = APIRouter(prefix="/labels", tags=["labels"])


def _pdf_response(pdf: bytes, filename: str) -> Response:
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/parts")
def part_labels(
    db: DbSession,
    _: CurrentUser,
    ids: list[int] = Query(..., description="Part ids to print"),
) -> Response:
    parts = list(db.execute(select(Part).where(Part.id.in_(ids))).scalars())
    if not parts:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No matching parts")

    order = {part_id: index for index, part_id in enumerate(ids)}
    parts.sort(key=lambda p: order.get(p.id, 0))

    labels = [
        (
            p.sku,
            p.title,
            p.location.path if p.location else "Unassigned",
        )
        for p in parts
    ]
    return _pdf_response(render_label_sheet(labels), "part-labels.pdf")


@router.get("/locations")
def location_labels(
    db: DbSession,
    _: CurrentUser,
    ids: list[int] = Query(..., description="Location ids to print"),
) -> Response:
    locations = list(db.execute(select(Location).where(Location.id.in_(ids))).scalars())
    if not locations:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No matching locations")

    labels = [(loc.code, loc.name, loc.path) for loc in locations]
    return _pdf_response(render_label_sheet(labels), "location-labels.pdf")
