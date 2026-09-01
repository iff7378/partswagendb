from enum import StrEnum


class UserRole(StrEnum):
    ADMIN = "admin"
    STAFF = "staff"
    VIEWER = "viewer"


class VehicleStatus(StrEnum):
    """Where a donor car is in its life.

    Stripped means the worthwhile parts are out but the shell is still on the
    property; scrapped means the shell has gone to the yard.
    """

    ACQUIRED = "acquired"
    IN_TEARDOWN = "in_teardown"
    STRIPPED = "stripped"
    SCRAPPED = "scrapped"


class LocationKind(StrEnum):
    SITE = "site"
    SHELF = "shelf"
    BAY = "bay"
    BIN = "bin"


class PartStatus(StrEnum):
    DRAFT = "draft"
    AVAILABLE = "available"
    RESERVED = "reserved"
    SOLD = "sold"
    SCRAPPED = "scrapped"


class PartCondition(StrEnum):
    NEW = "new"
    GRADE_A = "a"
    GRADE_B = "b"
    GRADE_C = "c"
    CORE = "core"
    SALVAGE = "salvage"
    UNKNOWN = "unknown"


class ExpenseCategory(StrEnum):
    PURCHASE = "purchase"
    TRANSPORT = "transport"
    TOOLING = "tooling"
    DISPOSAL = "disposal"
    STORAGE = "storage"
    FEES = "fees"
    # Overheads that belong to the venture rather than to any one car.
    SUPPLIES = "supplies"
    MEALS = "meals"
    OTHER = "other"


class SaleChannel(StrEnum):
    EBAY = "ebay"
    FACEBOOK = "facebook"
    LOCAL = "local"
    PHONE = "phone"
    # Weighing in a stripped shell. Its own channel so scrap income can be told
    # apart from parts income when judging what a car actually returned.
    SCRAP = "scrap"
    OTHER = "other"


class OcrStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"
