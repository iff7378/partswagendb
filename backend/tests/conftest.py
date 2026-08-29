import os
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("SECRET_KEY", "test-secret-key-that-is-long-enough-for-hmac-sha256")
os.environ.setdefault("OCR_ENABLED", "false")

from app.core.deps import get_db
from app.core.security import hash_password
from app.db import Base
from app.enums import UserRole
from app.main import app
from app.models import User

# SQLite in memory keeps the suite fast; the JSONB columns fall back to JSON.
TEST_URL = "sqlite://"


@pytest.fixture
def db() -> Generator[Session, None, None]:
    engine = create_engine(
        TEST_URL, connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, future=True)
    session = factory()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


@pytest.fixture
def make_user(db: Session):  # type: ignore[no-untyped-def]
    def _make(
        email: str,
        *,
        role: UserRole = UserRole.STAFF,
        is_partner: bool = False,
        share_bps: int = 0,
        password: str = "password12345",
    ) -> User:
        user = User(
            email=email,
            full_name=email.split("@")[0].title(),
            hashed_password=hash_password(password),
            role=role,
            is_partner=is_partner,
            share_bps=share_bps,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    return _make


@pytest.fixture
def client(db: Session) -> Generator[TestClient, None, None]:
    app.dependency_overrides[get_db] = lambda: db
    # Not used as a context manager on purpose: that would run the lifespan hook,
    # which seeds against the real database and reaches for MinIO.
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def admin(make_user):  # type: ignore[no-untyped-def]
    return make_user("admin@example.com", role=UserRole.ADMIN, is_partner=True, share_bps=5000)


@pytest.fixture
def auth_headers(client: TestClient, admin: User) -> dict[str, str]:
    response = client.post(
        "/api/auth/login",
        data={"username": admin.email, "password": "password12345"},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}
