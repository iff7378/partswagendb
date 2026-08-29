from enum import StrEnum


class UserRole(StrEnum):
    ADMIN = "admin"
    STAFF = "staff"
    VIEWER = "viewer"


class VehicleStatus(StrEnum):
    ACQUIRED = "acquired"
    TEARDOWN = "teardown"
    COMPLETE = "complete"
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
    OTHER = "other"


class SaleChannel(StrEnum):
    EBAY = "ebay"
    FACEBOOK = "facebook"
    LOCAL = "local"
    PHONE = "phone"
    OTHER = "other"


class OcrStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"
