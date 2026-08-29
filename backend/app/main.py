import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.router import api_router
from app.bootstrap import seed_categories, seed_first_admin
from app.config import settings
from app.db import SessionLocal
from app.services.storage import ensure_bucket

logging.basicConfig(level=settings.log_level)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
    try:
        ensure_bucket()
    except Exception:
        logger.warning("Object storage is not reachable yet", exc_info=True)

    with SessionLocal() as db:
        seed_categories(db)
        seed_first_admin(db)

    yield


app = FastAPI(
    title="PartsWagen API",
    version=__version__,
    description="Inventory and management for a small used auto parts operation",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/api/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}
