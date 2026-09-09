"""expenses can belong to a sale

Revision ID: e6c8f13a920b
Revises: d2a71b5e8c04
Create Date: 2026-09-08 14:22:09.114503

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e6c8f13a920b"
down_revision: str | None = "d2a71b5e8c04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("vehicle_expenses", sa.Column("sale_id", sa.Integer(), nullable=True))
    op.create_index("ix_vehicle_expenses_sale_id", "vehicle_expenses", ["sale_id"])
    op.create_foreign_key(
        "fk_vehicle_expenses_sale_id_sales",
        "vehicle_expenses",
        "sales",
        ["sale_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_check_constraint(
        "ck_vehicle_expenses_single_anchor",
        "vehicle_expenses",
        "(CASE WHEN vehicle_id IS NOT NULL THEN 1 ELSE 0 END"
        " + CASE WHEN sale_id IS NOT NULL THEN 1 ELSE 0 END) <= 1",
    )


def downgrade() -> None:
    op.drop_constraint("ck_vehicle_expenses_single_anchor", "vehicle_expenses", type_="check")
    op.drop_constraint("fk_vehicle_expenses_sale_id_sales", "vehicle_expenses", type_="foreignkey")
    op.drop_index("ix_vehicle_expenses_sale_id", table_name="vehicle_expenses")
    op.drop_column("vehicle_expenses", "sale_id")
