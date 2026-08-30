from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile, status
from sqlalchemy import select

from app.config import settings
from app.core.deps import DbSession, RequireEditor
from app.db import SessionLocal
from app.enums import OcrStatus
from app.models import Part, Photo
from app.schemas.common import Message
from app.schemas.part import PhotoRead
from app.services import ocr, storage

router = APIRouter(prefix="/photos", tags=["photos"])


def _run_ocr(photo_id: int, data: bytes) -> None:
    """Extract part numbers in the background so uploads stay fast."""
    with SessionLocal() as db:
        photo = db.get(Photo, photo_id)
        if photo is None:
            return
        try:
            text, candidates = ocr.process_photo(data)
            photo.ocr_text = text
            photo.ocr_candidates = candidates
            photo.ocr_status = OcrStatus.DONE if text is not None else OcrStatus.SKIPPED
        except Exception:
            photo.ocr_status = OcrStatus.FAILED
        db.commit()


def _with_urls(photo: Photo) -> PhotoRead:
    read = PhotoRead.model_validate(photo)
    read.url = storage.presigned_url(photo.object_key)
    read.thumbnail_url = storage.presigned_url(photo.thumbnail_key or photo.object_key)
    return read


@router.post("/parts/{part_id}", response_model=PhotoRead, status_code=status.HTTP_201_CREATED)
async def upload_part_photo(
    db: DbSession,
    user: RequireEditor,
    background: BackgroundTasks,
    part_id: int,
    file: UploadFile = File(...),
) -> PhotoRead:
    part = db.get(Part, part_id)
    if part is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Part not found")

    content_type = file.content_type or "application/octet-stream"
    if content_type not in storage.ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported image type {content_type}",
        )

    data = await file.read()
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Image exceeds the {settings.max_upload_bytes // (1024 * 1024)}MB limit",
        )

    # OCR reads the bytes as uploaded; only what gets stored is downscaled.
    width: int | None = None
    height: int | None = None
    stored = storage.normalise_original(data)
    if stored:
        stored_bytes, width, height = stored
        stored_type = "image/jpeg"
        key = storage.build_object_key(f"parts/{part_id}", "photo.jpg")
    else:
        stored_bytes, stored_type = data, content_type
        key = storage.build_object_key(f"parts/{part_id}", file.filename or "photo.jpg")

    storage.upload_bytes(key, stored_bytes, stored_type)

    thumbnail_key = None
    thumbnail = storage.make_thumbnail(stored_bytes)
    if thumbnail:
        thumb_bytes, _, _ = thumbnail
        thumbnail_key = f"{key.rsplit('.', 1)[0]}_thumb.jpg"
        storage.upload_bytes(thumbnail_key, thumb_bytes, "image/jpeg")

    has_photos = bool(db.execute(select(Photo.id).where(Photo.part_id == part_id)).first())

    photo = Photo(
        part_id=part_id,
        object_key=key,
        thumbnail_key=thumbnail_key,
        original_filename=file.filename,
        content_type=stored_type,
        size_bytes=len(stored_bytes),
        width=width,
        height=height,
        is_primary=not has_photos,
        ocr_status=OcrStatus.PENDING if settings.ocr_enabled else OcrStatus.SKIPPED,
        uploaded_by_id=user.id,
    )
    db.add(photo)
    db.commit()
    db.refresh(photo)

    if settings.ocr_enabled:
        background.add_task(_run_ocr, photo.id, data)

    return _with_urls(photo)


@router.post("/{photo_id}/primary", response_model=PhotoRead)
def set_primary(db: DbSession, _: RequireEditor, photo_id: int) -> PhotoRead:
    photo = db.get(Photo, photo_id)
    if photo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found")

    siblings = db.execute(select(Photo).where(Photo.part_id == photo.part_id)).scalars()
    for sibling in siblings:
        sibling.is_primary = sibling.id == photo_id

    db.commit()
    db.refresh(photo)
    return _with_urls(photo)


@router.delete("/{photo_id}", response_model=Message)
def delete_photo(db: DbSession, _: RequireEditor, photo_id: int) -> Message:
    photo = db.get(Photo, photo_id)
    if photo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found")

    was_primary = photo.is_primary
    part_id = photo.part_id

    storage.delete_object(photo.object_key)
    if photo.thumbnail_key:
        storage.delete_object(photo.thumbnail_key)
    db.delete(photo)
    db.flush()

    # Promote another photo so the part keeps a thumbnail.
    if was_primary and part_id is not None:
        replacement = db.execute(
            select(Photo).where(Photo.part_id == part_id).order_by(Photo.id).limit(1)
        ).scalar_one_or_none()
        if replacement:
            replacement.is_primary = True

    db.commit()
    return Message(detail="Photo deleted")
