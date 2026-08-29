from fastapi import APIRouter

from app.api import (
    auth,
    categories,
    labels,
    locations,
    parts,
    photos,
    reports,
    sales,
    settlements,
    users,
    vehicles,
)

api_router = APIRouter(prefix="/api")

api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(vehicles.router)
api_router.include_router(locations.router)
api_router.include_router(categories.router)
api_router.include_router(parts.router)
api_router.include_router(photos.router)
api_router.include_router(sales.router)
api_router.include_router(settlements.router)
api_router.include_router(labels.router)
api_router.include_router(reports.router)
