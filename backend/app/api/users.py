from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession, RequireAdmin
from app.core.security import hash_password
from app.models import User
from app.schemas.user import UserCreate, UserRead, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserRead])
def list_users(db: DbSession, _: CurrentUser, include_inactive: bool = False) -> list[User]:
    query = select(User).order_by(User.full_name)
    if not include_inactive:
        query = query.where(User.is_active.is_(True))
    return list(db.execute(query).scalars())


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(db: DbSession, _: RequireAdmin, payload: UserCreate) -> User:
    email = payload.email.lower().strip()
    if db.execute(select(User).where(User.email == email)).scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A user with that email already exists"
        )

    user = User(
        **payload.model_dump(exclude={"password", "email"}),
        email=email,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserRead)
def update_user(db: DbSession, admin: RequireAdmin, user_id: int, payload: UserUpdate) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    updates = payload.model_dump(exclude_unset=True)

    if "email" in updates:
        updates["email"] = updates["email"].lower().strip()
        clash = db.execute(
            select(User).where(User.email == updates["email"], User.id != user_id)
        ).scalar_one_or_none()
        if clash:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="A user with that email already exists"
            )

    # Guard against an admin locking themselves out of the only admin account.
    if user.id == admin.id and updates.get("is_active") is False:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot deactivate your own account"
        )

    for field, value in updates.items():
        setattr(user, field, value)

    db.commit()
    db.refresh(user)
    return user
