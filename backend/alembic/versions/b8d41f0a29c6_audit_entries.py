"""audit entries

Revision ID: b8d41f0a29c6
Revises: a5e2c904f731
Create Date: 2026-09-04 09:02:18.663214

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "b8d41f0a29c6"
down_revision: str | None = "a5e2c904f731"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "audit_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("user_name", sa.String(length=255), nullable=True),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("entity", sa.String(length=32), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column("label", sa.String(length=255), nullable=True),
        # JSONB on Postgres, matching JsonColumn on the model; a plain JSON
        # here reads as drift against it.
        sa.Column("changes", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        # SET NULL, not CASCADE: removing an account must not erase what it did.
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_entries_at", "audit_entries", ["at"])
    op.create_index("ix_audit_entries_user_id", "audit_entries", ["user_id"])
    op.create_index("ix_audit_entries_entity", "audit_entries", ["entity"])
    op.create_index("ix_audit_entries_entity_id", "audit_entries", ["entity_id"])


def downgrade() -> None:
    op.drop_table("audit_entries")
