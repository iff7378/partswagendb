from sqlalchemy import Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.enums import UserRole
from app.models.base import TimestampMixin


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(String(16), default=UserRole.STAFF, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Partners share in profits; a non-partner (e.g. a helper or viewer) does not
    # appear in settle-up reports even if they record sales or expenses.
    is_partner: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Profit share in basis points (5000 = 50%). Only meaningful when is_partner.
    share_bps: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
