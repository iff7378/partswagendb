from typing import TYPE_CHECKING

from sqlalchemy import Column, ForeignKey, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import TimestampMixin

if TYPE_CHECKING:
    from app.models.part import Part

part_tags = Table(
    "part_tags",
    Base.metadata,
    Column("part_id", ForeignKey("parts.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class PartCategory(Base, TimestampMixin):
    """Curated category tree, e.g. Engine > Fuel System > Injector."""

    __tablename__ = "part_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    slug: Mapped[str] = mapped_column(String(160), unique=True, index=True, nullable=False)

    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("part_categories.id", ondelete="RESTRICT"), index=True
    )
    parent: Mapped["PartCategory | None"] = relationship(
        back_populates="children", remote_side="PartCategory.id"
    )
    children: Mapped[list["PartCategory"]] = relationship(back_populates="parent")

    path: Mapped[str] = mapped_column(String(512), default="", nullable=False)

    parts: Mapped[list["Part"]] = relationship(back_populates="category")


class Tag(Base, TimestampMixin):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)

    parts: Mapped[list["Part"]] = relationship(secondary=part_tags, back_populates="tags")
