"""part listings

Revision ID: c9f3b07a4d18
Revises: b8d41f0a29c6
Create Date: 2026-09-07 10:12:44.902117

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c9f3b07a4d18"
down_revision: str | None = "b8d41f0a29c6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "part_listings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("part_id", sa.Integer(), nullable=False),
        sa.Column("channel", sa.String(length=16), nullable=False),
        sa.Column("account", sa.String(length=128), nullable=True),
        sa.Column("url", sa.String(length=1024), nullable=True),
        sa.Column("posted_on", sa.Date(), nullable=False),
        sa.Column("removed_on", sa.Date(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # CASCADE: a listing has no meaning without the part it advertises.
        sa.ForeignKeyConstraint(["part_id"], ["parts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_part_listings_part_id", "part_listings", ["part_id"])


def downgrade() -> None:
    op.drop_table("part_listings")
