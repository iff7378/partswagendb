from datetime import UTC, date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Date, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import ListingChannel, PartCondition, PartStatus
from app.models.base import TimestampMixin
from app.models.catalog import part_tags

if TYPE_CHECKING:
    from app.models.catalog import PartCategory, Tag
    from app.models.location import Location
    from app.models.photo import Photo
    from app.models.sale import SaleItem
    from app.models.user import User
    from app.models.vehicle import Vehicle


class Part(Base, TimestampMixin):
    """A single inventoried component pulled from a donor vehicle."""

    __tablename__ = "parts"
    __table_args__ = (Index("ix_parts_status_category", "status", "category_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    # Human-readable scannable identifier printed on the part's QR label.
    sku: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    vehicle_id: Mapped[int | None] = mapped_column(
        ForeignKey("vehicles.id", ondelete="SET NULL"), index=True
    )
    vehicle: Mapped["Vehicle | None"] = relationship(back_populates="parts")

    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("part_categories.id", ondelete="SET NULL"), index=True
    )
    category: Mapped["PartCategory | None"] = relationship(back_populates="parts")

    location_id: Mapped[int | None] = mapped_column(
        ForeignKey("locations.id", ondelete="SET NULL"), index=True
    )
    location: Mapped["Location | None"] = relationship(back_populates="parts")

    part_number: Mapped[str | None] = mapped_column(String(64), index=True)
    oem_number: Mapped[str | None] = mapped_column(String(64), index=True)
    manufacturer: Mapped[str | None] = mapped_column(String(128))

    condition: Mapped[PartCondition] = mapped_column(
        String(16), default=PartCondition.UNKNOWN, nullable=False
    )
    status: Mapped[PartStatus] = mapped_column(
        String(16), default=PartStatus.DRAFT, nullable=False, index=True
    )
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    asking_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))

    notes: Mapped[str | None] = mapped_column(Text)

    # Flag the part once it has sat this many days. Null means never nag.
    age_alert_days: Mapped[int | None] = mapped_column(Integer)

    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_by: Mapped["User | None"] = relationship()

    tags: Mapped[list["Tag"]] = relationship(secondary=part_tags, back_populates="parts")
    photos: Mapped[list["Photo"]] = relationship(
        back_populates="part", cascade="all, delete-orphan", order_by="Photo.id"
    )
    sale_items: Mapped[list["SaleItem"]] = relationship(
        secondary="sale_item_parts", back_populates="parts"
    )
    listings: Mapped[list["PartListing"]] = relationship(
        back_populates="part", cascade="all, delete-orphan", order_by="PartListing.id"
    )

    @property
    def is_sellable(self) -> bool:
        """Could still go on a sale.

        Status alone is not enough: a part reserved against a pending sale is
        spoken for, and offering it again only earns a rejection at the till.
        """
        if self.status not in (PartStatus.DRAFT, PartStatus.AVAILABLE, PartStatus.RESERVED):
            return False
        # A voided sale holds nothing, so its parts are on offer again.
        return not any(item.sale.voided_at is None for item in self.sale_items)

    @property
    def days_in_stock(self) -> int:
        """Days since the part was catalogued."""
        created = self.created_at
        if created is None:
            return 0
        now = datetime.now(UTC) if created.tzinfo else datetime.now()
        return max(0, (now - created).days)

    @property
    def is_overdue(self) -> bool:
        """Sitting longer than its own threshold, and still sellable."""
        if self.age_alert_days is None:
            return False
        if self.status not in (PartStatus.AVAILABLE, PartStatus.DRAFT):
            return False
        return self.days_in_stock >= self.age_alert_days

    @property
    def is_complete(self) -> bool:
        """A part is ready to list once it has the fields a buyer needs."""
        return bool(self.title and self.category_id and self.location_id and self.asking_price)


class PartListing(Base, TimestampMixin):
    """Where a part is advertised, under which account, and the link to it.

    Several per part on purpose: the same alternator gets cross-posted to
    Facebook and eBay, and when it sells both need taking down.
    """

    __tablename__ = "part_listings"

    id: Mapped[int] = mapped_column(primary_key=True)
    part_id: Mapped[int] = mapped_column(
        ForeignKey("parts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    part: Mapped["Part"] = relationship(back_populates="listings")

    channel: Mapped[ListingChannel] = mapped_column(String(16), nullable=False)
    # Which login it was posted under. Free text, because these are marketplace
    # account names rather than users of this system.
    account: Mapped[str | None] = mapped_column(String(128))
    url: Mapped[str | None] = mapped_column(String(1024))

    posted_on: Mapped[date] = mapped_column(Date, nullable=False)
    # Set when the advert comes down. A listing that cannot be closed off turns
    # into stale data the moment the part sells.
    removed_on: Mapped[date | None] = mapped_column(Date)

    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_by: Mapped["User | None"] = relationship()

    @property
    def is_live(self) -> bool:
        return self.removed_on is None
