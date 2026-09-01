from datetime import date

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser, DbSession, RequireEditor
from app.models import Settlement, User, VehicleExpense
from app.schemas.common import Message
from app.schemas.settlement import SettlementCreate, SettlementRead, SettleUpReport
from app.schemas.vehicle import ExpenseCreate, ExpenseRead, ExpenseUpdate
from app.services.ledger import build_settle_up_report

router = APIRouter(tags=["money"])

_SETTLEMENT_LOADERS = (
    selectinload(Settlement.from_user),
    selectinload(Settlement.to_user),
)


# --- Expenses -------------------------------------------------------------


@router.get("/expenses", response_model=list[ExpenseRead])
def list_expenses(
    db: DbSession,
    _: CurrentUser,
    vehicle_id: int | None = None,
    paid_by_id: int | None = None,
    general: bool = Query(
        default=False, description="Only overheads that belong to no particular car"
    ),
) -> list[VehicleExpense]:
    query = select(VehicleExpense).options(selectinload(VehicleExpense.paid_by))
    if general:
        # Food, supplies, tooling: real money on the ledger, but not part of
        # any one car's cost basis.
        query = query.where(VehicleExpense.vehicle_id.is_(None))
    elif vehicle_id is not None:
        query = query.where(VehicleExpense.vehicle_id == vehicle_id)
    if paid_by_id is not None:
        query = query.where(VehicleExpense.paid_by_id == paid_by_id)
    return list(db.execute(query.order_by(VehicleExpense.incurred_on.desc())).scalars())


@router.post("/expenses", response_model=ExpenseRead, status_code=status.HTTP_201_CREATED)
def create_expense(db: DbSession, user: RequireEditor, payload: ExpenseCreate) -> VehicleExpense:
    if db.get(User, payload.paid_by_id) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Paying user does not exist"
        )

    expense = VehicleExpense(**payload.model_dump(), created_by_id=user.id)
    db.add(expense)
    db.commit()
    db.refresh(expense)
    return expense


@router.patch("/expenses/{expense_id}", response_model=ExpenseRead)
def update_expense(
    db: DbSession, _: RequireEditor, expense_id: int, payload: ExpenseUpdate
) -> VehicleExpense:
    expense = db.get(VehicleExpense, expense_id)
    if expense is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense not found")

    updates = payload.model_dump(exclude_unset=True)
    if "paid_by_id" in updates and db.get(User, updates["paid_by_id"]) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Paying user does not exist"
        )

    for field, value in updates.items():
        setattr(expense, field, value)

    db.commit()
    db.refresh(expense)
    return expense


@router.delete("/expenses/{expense_id}", response_model=Message)
def delete_expense(db: DbSession, _: RequireEditor, expense_id: int) -> Message:
    expense = db.get(VehicleExpense, expense_id)
    if expense is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense not found")
    db.delete(expense)
    db.commit()
    return Message(detail="Expense deleted")


# --- Settle up ------------------------------------------------------------


@router.get("/settle-up", response_model=SettleUpReport)
def settle_up(
    db: DbSession,
    _: CurrentUser,
    period_start: date = Query(...),
    period_end: date = Query(...),
) -> SettleUpReport:
    """Who owes whom for a period, and the transfers that zero everyone out."""
    if period_end < period_start:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="period_end must be on or after period_start",
        )
    return build_settle_up_report(db, period_start, period_end)


@router.get("/settlements", response_model=list[SettlementRead])
def list_settlements(db: DbSession, _: CurrentUser) -> list[Settlement]:
    return list(
        db.execute(
            select(Settlement).options(*_SETTLEMENT_LOADERS).order_by(Settlement.paid_on.desc())
        ).scalars()
    )


@router.post("/settlements", response_model=SettlementRead, status_code=status.HTTP_201_CREATED)
def create_settlement(db: DbSession, user: RequireEditor, payload: SettlementCreate) -> Settlement:
    if payload.from_user_id == payload.to_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A settlement must be between two different people",
        )
    if payload.period_end < payload.period_start:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="period_end must be on or after period_start",
        )
    for user_id in (payload.from_user_id, payload.to_user_id):
        if db.get(User, user_id) is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"User {user_id} does not exist"
            )

    settlement = Settlement(**payload.model_dump(), created_by_id=user.id)
    db.add(settlement)
    db.commit()
    db.refresh(settlement)
    return settlement


@router.delete("/settlements/{settlement_id}", response_model=Message)
def delete_settlement(db: DbSession, _: RequireEditor, settlement_id: int) -> Message:
    settlement = db.get(Settlement, settlement_id)
    if settlement is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Settlement not found")
    db.delete(settlement)
    db.commit()
    return Message(detail="Settlement deleted")
