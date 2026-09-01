from collections.abc import Generator

from sqlalchemy import Integer, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.sql.functions import FunctionElement

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, future=True)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class days_since(FunctionElement):  # noqa: N801  SQL function, lowercase by convention
    """Whole days between a timestamp column and now.

    Written as a compiled function because the two databases in play spell it
    differently: Postgres runs in production, SQLite backs the test suite.
    """

    name = "days_since"
    type = Integer()
    inherit_cache = True


@compiles(days_since)
def _days_since_default(element, compiler, **kw) -> str:  # type: ignore[no-untyped-def]
    (column,) = element.clauses
    return f"EXTRACT(DAY FROM (now() - {compiler.process(column, **kw)}))"


@compiles(days_since, "sqlite")
def _days_since_sqlite(element, compiler, **kw) -> str:  # type: ignore[no-untyped-def]
    (column,) = element.clauses
    return f"(julianday('now') - julianday({compiler.process(column, **kw)}))"
