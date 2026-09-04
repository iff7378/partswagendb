from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db import get_db
from app.enums import UserRole
from app.models import User
from app.services.audit import set_actor

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

DbSession = Annotated[Session, Depends(get_db)]

_CREDENTIALS_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(db: DbSession, token: Annotated[str, Depends(oauth2_scheme)]) -> User:
    try:
        payload = decode_token(token, expected_type="access")
        user_id = int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError) as exc:
        raise _CREDENTIALS_ERROR from exc

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _CREDENTIALS_ERROR

    # Every write in this request is attributed to whoever it authenticated as.
    # Recorded on the session, which is the one object shared by the dependency
    # and the endpoint; see ACTOR_KEY for why not a ContextVar.
    set_actor(db, user.id, user.full_name)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*allowed: UserRole):  # type: ignore[no-untyped-def]
    """Dependency factory restricting an endpoint to the given roles."""

    def dependency(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action",
            )
        return user

    return dependency


# Viewers may read; staff and admins may write; only admins may administer.
RequireEditor = Annotated[User, Depends(require_roles(UserRole.ADMIN, UserRole.STAFF))]
RequireAdmin = Annotated[User, Depends(require_roles(UserRole.ADMIN))]
