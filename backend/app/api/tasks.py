from datetime import UTC, date, datetime

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.deps import CurrentUser, DbSession, RequireEditor
from app.models import Part, Sale, Task, User, Vehicle
from app.schemas.common import Message
from app.schemas.task import TaskAnchor, TaskCreate, TaskRead, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])

_LOADERS = (
    selectinload(Task.assigned_to),
    selectinload(Task.done_by),
    selectinload(Task.created_by),
    selectinload(Task.part),
    selectinload(Task.sale),
    selectinload(Task.vehicle),
)


def _get_or_404(db: Session, task_id: int) -> Task:
    task = db.execute(
        select(Task).options(*_LOADERS).where(Task.id == task_id)
    ).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


def _anchor(task: Task) -> TaskAnchor | None:
    """How a person would refer to the thing this is about."""
    if task.part is not None:
        return TaskAnchor(
            kind="part", id=task.part.id, label=f"{task.part.sku} · {task.part.title}"
        )
    if task.sale is not None:
        buyer = task.sale.buyer_name or "walk-in buyer"
        return TaskAnchor(kind="sale", id=task.sale.id, label=f"{task.sale.reference} · {buyer}")
    if task.vehicle is not None:
        return TaskAnchor(kind="vehicle", id=task.vehicle.id, label=task.vehicle.display_name)
    return None


def _to_read(task: Task) -> TaskRead:
    read = TaskRead.model_validate(task)
    read.anchor = _anchor(task)
    return read


def _check_references(db: Session, data: dict[str, object]) -> None:
    for field, model, label in (
        ("assigned_to_id", User, "User"),
        ("part_id", Part, "Part"),
        ("sale_id", Sale, "Sale"),
        ("vehicle_id", Vehicle, "Vehicle"),
    ):
        value = data.get(field)
        if value is not None and db.get(model, value) is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"{label} {value} does not exist"
            )


@router.get("", response_model=list[TaskRead])
def list_tasks(
    db: DbSession,
    _: CurrentUser,
    assigned_to_id: int | None = None,
    unassigned: bool = Query(default=False, description="Only tasks nobody has taken"),
    mine_or_free: int | None = Query(
        default=None, description="Tasks for this user plus anything unclaimed"
    ),
    done: bool | None = Query(default=None, description="Omit for everything still open"),
    part_id: int | None = None,
    sale_id: int | None = None,
    vehicle_id: int | None = None,
    due_before: date | None = None,
    limit: int = Query(default=200, le=500),
) -> list[TaskRead]:
    query = select(Task).options(*_LOADERS)

    # Open by default: a board is a list of what is left, not an archive.
    if done is None:
        query = query.where(Task.done_at.is_(None))
    elif done:
        query = query.where(Task.done_at.is_not(None))
    else:
        query = query.where(Task.done_at.is_(None))

    if unassigned:
        query = query.where(Task.assigned_to_id.is_(None))
    elif mine_or_free is not None:
        # What one person could pick up right now: theirs, plus the pile.
        query = query.where(or_(Task.assigned_to_id == mine_or_free, Task.assigned_to_id.is_(None)))
    elif assigned_to_id is not None:
        query = query.where(Task.assigned_to_id == assigned_to_id)

    for field, value in (
        (Task.part_id, part_id),
        (Task.sale_id, sale_id),
        (Task.vehicle_id, vehicle_id),
    ):
        if value is not None:
            query = query.where(field == value)

    if due_before is not None:
        query = query.where(Task.due_on.is_not(None), Task.due_on <= due_before)

    rows = db.execute(
        # Dated first and soonest first; undated work sits below it.
        query.order_by(Task.due_on.asc().nullslast(), Task.id.asc()).limit(limit)
    ).scalars()
    return [_to_read(task) for task in rows]


@router.post("", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
def create_task(db: DbSession, user: RequireEditor, payload: TaskCreate) -> TaskRead:
    data = payload.model_dump()
    _check_references(db, data)

    task = Task(**data, created_by_id=user.id)
    db.add(task)
    db.commit()
    return _to_read(_get_or_404(db, task.id))


@router.get("/{task_id}", response_model=TaskRead)
def get_task(db: DbSession, _: CurrentUser, task_id: int) -> TaskRead:
    return _to_read(_get_or_404(db, task_id))


@router.patch("/{task_id}", response_model=TaskRead)
def update_task(db: DbSession, user: RequireEditor, task_id: int, payload: TaskUpdate) -> TaskRead:
    task = _get_or_404(db, task_id)
    updates = payload.model_dump(exclude_unset=True)
    done = updates.pop("done", None)
    _check_references(db, updates)

    for field, value in updates.items():
        setattr(task, field, value)

    if done is not None:
        # Who ticked it is recorded here rather than trusted from the client.
        task.done_at = datetime.now(UTC) if done else None
        task.done_by_id = user.id if done else None

    anchors = [task.part_id, task.sale_id, task.vehicle_id]
    if sum(a is not None for a in anchors) > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A task can be about a part, a sale or a car, not several",
        )

    db.commit()
    return _to_read(_get_or_404(db, task_id))


@router.delete("/{task_id}", response_model=Message)
def delete_task(db: DbSession, _: RequireEditor, task_id: int) -> Message:
    """Remove a task that should not have been raised.

    Finishing one is a PATCH setting done: that is worth keeping. This is for
    something typed by mistake.
    """
    task = _get_or_404(db, task_id)
    db.delete(task)
    db.commit()
    return Message(detail="Task removed")
