from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.enums import UserRole
from app.schemas.common import ORMModel


class UserBase(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=255)
    role: UserRole = UserRole.STAFF
    is_active: bool = True
    is_partner: bool = False
    share_bps: int = Field(default=0, ge=0, le=10000)


class UserCreate(UserBase):
    password: str = Field(min_length=12, max_length=128)


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    role: UserRole | None = None
    is_active: bool | None = None
    is_partner: bool | None = None
    share_bps: int | None = Field(default=None, ge=0, le=10000)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=12, max_length=128)


class UserRead(UserBase, ORMModel):
    id: int
    created_at: datetime


class UserBrief(ORMModel):
    id: int
    full_name: str
    email: EmailStr


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str
