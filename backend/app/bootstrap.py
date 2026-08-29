import logging

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.security import hash_password
from app.enums import UserRole
from app.models import PartCategory, User

logger = logging.getLogger(__name__)

# A starting point for the category tree; extend it in the app as you go.
SEED_CATEGORIES: dict[str, list[str]] = {
    "Engine": ["Long Block", "Cylinder Head", "Intake", "Fuel System", "Turbo", "Accessories"],
    "Drivetrain": ["Transmission", "Clutch & Flywheel", "Driveshaft", "Differential", "Axles"],
    "Suspension": ["Struts & Shocks", "Control Arms", "Springs", "Hubs & Bearings"],
    "Brakes": ["Calipers", "Rotors", "Master Cylinder", "ABS"],
    "Body": ["Front", "Rear", "Doors", "Glass", "Mirrors", "Trim"],
    "Interior": ["Seats", "Dashboard", "Door Cards", "Carpet", "Console"],
    "Electrical": ["ECU", "Wiring Harness", "Alternator", "Starter", "Sensors", "Lighting"],
    "Wheels": ["Wheels", "Tires", "Caps & Covers"],
    "Cooling": ["Radiator", "Intercooler", "Fans", "Hoses"],
    "Exhaust": ["Manifold", "Downpipe", "Midpipe", "Muffler"],
}


def _slug(name: str) -> str:
    base = name.strip().lower().replace(" ", "-").replace("&", "and")
    return "".join(c for c in base if c.isalnum() or c == "-").strip("-")


def seed_categories(db: Session) -> None:
    if db.execute(select(func.count()).select_from(PartCategory)).scalar_one():
        return

    logger.info("Seeding part category tree")
    for parent_name, children in SEED_CATEGORIES.items():
        parent = PartCategory(name=parent_name, slug=_slug(parent_name), path=parent_name)
        db.add(parent)
        db.flush()
        for child_name in children:
            db.add(
                PartCategory(
                    name=child_name,
                    slug=f"{parent.slug}/{_slug(child_name)}",
                    parent_id=parent.id,
                    path=f"{parent_name} / {child_name}",
                )
            )
    db.commit()


def seed_first_admin(db: Session) -> None:
    if db.execute(select(func.count()).select_from(User)).scalar_one():
        return
    if not settings.first_admin_email or not settings.first_admin_password:
        logger.warning("No users exist and FIRST_ADMIN_EMAIL/PASSWORD are unset")
        return

    logger.info("Creating first admin %s", settings.first_admin_email)
    db.add(
        User(
            email=settings.first_admin_email.lower().strip(),
            full_name="Administrator",
            hashed_password=hash_password(settings.first_admin_password),
            role=UserRole.ADMIN,
            is_partner=True,
            share_bps=10_000,
        )
    )
    db.commit()
