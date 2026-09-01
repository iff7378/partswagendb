"""sale payment and handover dates

Revision ID: e4c8a1f60d23
Revises: d7b2e5c14f80
Create Date: 2026-09-01 13:22:41.905112

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e4c8a1f60d23"
down_revision: str | None = "d7b2e5c14f80"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sales", sa.Column("paid_on", sa.Date(), nullable=True))
    op.add_column("sales", sa.Column("fulfilled_on", sa.Date(), nullable=True))
    op.create_index("ix_sales_paid_on", "sales", ["paid_on"])
    op.create_index("ix_sales_fulfilled_on", "sales", ["fulfilled_on"])

    # Every sale recorded before this release meant "done": the money was in
    # and the part had gone. Backfilling both keeps the settle-up report and
    # every car's profit reading exactly as they did yesterday.
    op.execute("UPDATE sales SET paid_on = sold_on, fulfilled_on = sold_on")


def downgrade() -> None:
    op.drop_index("ix_sales_fulfilled_on", table_name="sales")
    op.drop_index("ix_sales_paid_on", table_name="sales")
    op.drop_column("sales", "fulfilled_on")
    op.drop_column("sales", "paid_on")
