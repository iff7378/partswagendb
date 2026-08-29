from datetime import datetime

from pydantic import BaseModel, Field

from app.enums import LocationKind
from app.schemas.common import ORMModel


class LocationBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    kind: LocationKind
    parent_id: int | None = None
    notes: str | None = None


class LocationCreate(LocationBase):
    code: str | None = Field(default=None, description="Auto-generated when omitted")


class LocationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    kind: LocationKind | None = None
    parent_id: int | None = None
    notes: str | None = None


class LocationRead(LocationBase, ORMModel):
    id: int
    code: str
    path: str
    created_at: datetime


class LocationNode(LocationRead):
    children: list["LocationNode"] = Field(default_factory=list)
    part_count: int = 0
