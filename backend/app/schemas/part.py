from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field

from app.enums import OcrStatus, PartCondition, PartStatus
from app.schemas.common import ORMModel
from app.schemas.location import LocationRead
from app.schemas.user import UserBrief


class CategoryBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    parent_id: int | None = None


class CategoryCreate(CategoryBase):
    pass


class CategoryRead(CategoryBase, ORMModel):
    id: int
    slug: str
    path: str


class TagRead(ORMModel):
    id: int
    name: str


class PhotoRead(ORMModel):
    id: int
    object_key: str
    original_filename: str | None = None
    content_type: str
    size_bytes: int
    width: int | None = None
    height: int | None = None
    is_primary: bool
    ocr_status: OcrStatus
    ocr_text: str | None = None
    ocr_candidates: list[dict[str, Any]] | None = None
    created_at: datetime
    url: str | None = None
    thumbnail_url: str | None = None


class PartBase(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    vehicle_id: int | None = None
    category_id: int | None = None
    location_id: int | None = None
    part_number: str | None = Field(default=None, max_length=64)
    oem_number: str | None = Field(default=None, max_length=64)
    manufacturer: str | None = Field(default=None, max_length=128)
    condition: PartCondition = PartCondition.UNKNOWN
    quantity: int = Field(default=1, ge=0)
    asking_price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    notes: str | None = None
    age_alert_days: int | None = Field(
        default=None, ge=1, le=3650, description="Flag the part after this many days in stock"
    )


class PartCreate(PartBase):
    status: PartStatus = PartStatus.DRAFT
    tags: list[str] = Field(default_factory=list)


class PartUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    vehicle_id: int | None = None
    category_id: int | None = None
    location_id: int | None = None
    part_number: str | None = Field(default=None, max_length=64)
    oem_number: str | None = Field(default=None, max_length=64)
    manufacturer: str | None = Field(default=None, max_length=128)
    condition: PartCondition | None = None
    status: PartStatus | None = None
    quantity: int | None = Field(default=None, ge=0)
    asking_price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    notes: str | None = None
    age_alert_days: int | None = Field(default=None, ge=1, le=3650)
    tags: list[str] | None = None


class PartMove(BaseModel):
    """Relocate a part, typically after scanning a location QR code."""

    location_id: int | None = None
    location_code: str | None = None


class VehicleBrief(ORMModel):
    id: int
    stock_number: str
    display_name: str


class PartRead(PartBase, ORMModel):
    id: int
    sku: str
    status: PartStatus
    is_complete: bool
    days_in_stock: int
    is_overdue: bool
    created_at: datetime
    updated_at: datetime
    vehicle: VehicleBrief | None = None
    category: CategoryRead | None = None
    location: LocationRead | None = None
    tags: list[TagRead] = Field(default_factory=list)
    primary_photo_url: str | None = None


class PartDetail(PartRead):
    photos: list[PhotoRead] = Field(default_factory=list)
    created_by: UserBrief | None = None
