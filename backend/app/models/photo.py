from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import OcrStatus
from app.models.base import JsonColumn, TimestampMixin

if TYPE_CHECKING:
    from app.models.part import Part
    from app.models.user import User


class Photo(Base, TimestampMixin):
    __tablename__ = "photos"

    id: Mapped[int] = mapped_column(primary_key=True)

    part_id: Mapped[int | None] = mapped_column(
        ForeignKey("parts.id", ondelete="CASCADE"), index=True
    )
    part: Mapped["Part | None"] = relationship(back_populates="photos")

    vehicle_id: Mapped[int | None] = mapped_column(
        ForeignKey("vehicles.id", ondelete="CASCADE"), index=True
    )

    object_key: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    thumbnail_key: Mapped[str | None] = mapped_column(String(512))
    original_filename: Mapped[str | None] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)

    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    ocr_status: Mapped[OcrStatus] = mapped_column(
        String(16), default=OcrStatus.PENDING, nullable=False
    )
    ocr_text: Mapped[str | None] = mapped_column(Text)
    # Ranked part-number candidates extracted from ocr_text.
    ocr_candidates: Mapped[list[dict[str, Any]] | None] = mapped_column(JsonColumn)

    uploaded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    uploaded_by: Mapped["User | None"] = relationship()
