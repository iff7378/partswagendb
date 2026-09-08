from datetime import date, datetime

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import ORMModel
from app.schemas.user import UserBrief


class TaskAnchor(BaseModel):
    """What the task is about, flattened so a board needs one request."""

    kind: str  # part | sale | vehicle
    id: int
    label: str


class TaskBase(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    notes: str | None = None
    # Null means anyone: a shared pile rather than a forced choice.
    assigned_to_id: int | None = None
    due_on: date | None = None
    part_id: int | None = None
    sale_id: int | None = None
    vehicle_id: int | None = None

    @model_validator(mode="after")
    def _single_anchor(self) -> "TaskBase":
        anchors = [self.part_id, self.sale_id, self.vehicle_id]
        if sum(a is not None for a in anchors) > 1:
            raise ValueError("A task can be about a part, a sale or a car, not several")
        return self


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    notes: str | None = None
    assigned_to_id: int | None = None
    due_on: date | None = None
    part_id: int | None = None
    sale_id: int | None = None
    vehicle_id: int | None = None
    # Ticking the box, rather than making the client invent a timestamp and
    # work out who did it.
    done: bool | None = None


class TaskRead(ORMModel):
    id: int
    title: str
    notes: str | None = None
    assigned_to: UserBrief | None = None
    assigned_to_id: int | None = None
    due_on: date | None = None
    done_at: datetime | None = None
    done_by: UserBrief | None = None
    is_done: bool
    is_overdue: bool
    anchor: TaskAnchor | None = None
    created_by: UserBrief | None = None
    created_at: datetime
