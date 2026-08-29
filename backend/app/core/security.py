from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import jwt
from passlib.context import CryptContext

from app.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

TokenType = Literal["access", "refresh"]


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_token(subject: str | int, token_type: TokenType = "access") -> str:
    now = datetime.now(UTC)
    if token_type == "access":
        expires = now + timedelta(minutes=settings.access_token_expire_minutes)
    else:
        expires = now + timedelta(days=settings.refresh_token_expire_days)

    payload = {
        "sub": str(subject),
        "type": token_type,
        "iat": now,
        "exp": expires,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_token(token: str, expected_type: TokenType = "access") -> dict[str, Any]:
    """Decode and validate a JWT. Raises jwt.InvalidTokenError on any problem."""
    payload: dict[str, Any] = jwt.decode(
        token, settings.secret_key, algorithms=[settings.algorithm]
    )
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError(f"Expected {expected_type} token")
    return payload
