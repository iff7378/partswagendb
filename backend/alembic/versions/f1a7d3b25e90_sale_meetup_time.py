"""sale meetup time

Revision ID: f1a7d3b25e90
Revises: e4c8a1f60d23
Create Date: 2026-09-03 09:14:07.552118

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f1a7d3b25e90"
down_revision: str | None = "e4c8a1f60d23"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sales", sa.Column("meetup_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_sales_meetup_at", "sales", ["meetup_at"])


def downgrade() -> None:
    op.drop_index("ix_sales_meetup_at", table_name="sales")
    op.drop_column("sales", "meetup_at")
