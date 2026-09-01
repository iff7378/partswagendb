"""sale lines can be a scrapped car

Revision ID: c3f1a8d90b47
Revises: ae210c603808
Create Date: 2026-08-31 09:12:44.310827

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c3f1a8d90b47"
down_revision: str | None = "ae210c603808"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable: almost every line is still a part, not a shell.
    op.add_column("sale_items", sa.Column("vehicle_id", sa.Integer(), nullable=True))
    op.create_index("ix_sale_items_vehicle_id", "sale_items", ["vehicle_id"])
    # SET NULL, not CASCADE: deleting a car must not rewrite a settled sale.
    op.create_foreign_key(
        "fk_sale_items_vehicle_id_vehicles",
        "sale_items",
        "vehicles",
        ["vehicle_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_sale_items_vehicle_id_vehicles", "sale_items", type_="foreignkey")
    op.drop_index("ix_sale_items_vehicle_id", table_name="sale_items")
    op.drop_column("sale_items", "vehicle_id")
