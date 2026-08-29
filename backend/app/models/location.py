from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import LocationKind
from app.models.base import TimestampMixin

if TYPE_CHECKING:
    from app.models.part import Part


class Location(Base, TimestampMixin):
    """A storage location. Shallow tree: Site > Shelf > Bay > Bin."""

    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Scannable short code printed on the QR label, e.g. "SHED-A-R3-B2".
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[LocationKind] = mapped_column(String(16), nullable=False)

    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("locations.id", ondelete="RESTRICT"), index=True
    )
    parent: Mapped["Location | None"] = relationship(
        back_populates="children", remote_side="Location.id"
    )
    children: Mapped[list["Location"]] = relationship(back_populates="parent")

    # Denormalised "SHED-A / R3 / B2" for display and prefix search; rebuilt on move.
    path: Mapped[str] = mapped_column(String(512), default="", nullable=False, index=True)

    notes: Mapped[str | None] = mapped_column(Text)

    parts: Mapped[list["Part"]] = relationship(back_populates="location")
