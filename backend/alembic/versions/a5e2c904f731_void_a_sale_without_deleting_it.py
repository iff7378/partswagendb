"""void a sale without deleting it

Revision ID: a5e2c904f731
Revises: f1a7d3b25e90
Create Date: 2026-09-04 08:41:22.310884

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a5e2c904f731"
down_revision: str | None = "f1a7d3b25e90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sales", sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sales", sa.Column("voided_by_id", sa.Integer(), nullable=True))
    op.add_column("sales", sa.Column("void_reason", sa.String(length=255), nullable=True))
    op.create_index("ix_sales_voided_at", "sales", ["voided_at"])
    op.create_foreign_key(
        "fk_sales_voided_by_id_users",
        "sales",
        "users",
        ["voided_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # Nothing to backfill: sales voided before this release were hard deleted
    # and are not recoverable. Everything still present is live.


def downgrade() -> None:
    op.drop_constraint("fk_sales_voided_by_id_users", "sales", type_="foreignkey")
    op.drop_index("ix_sales_voided_at", table_name="sales")
    op.drop_column("sales", "void_reason")
    op.drop_column("sales", "voided_by_id")
    op.drop_column("sales", "voided_at")
