"""one sale line covers many parts

Revision ID: d7b2e5c14f80
Revises: c3f1a8d90b47
Create Date: 2026-08-31 10:41:02.774915

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d7b2e5c14f80"
down_revision: str | None = "c3f1a8d90b47"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sale_item_parts",
        sa.Column("sale_item_id", sa.Integer(), nullable=False),
        sa.Column("part_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["part_id"], ["parts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sale_item_id"], ["sale_items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("sale_item_id", "part_id"),
    )

    # Carry every existing single-part line across before the column goes.
    op.execute(
        "INSERT INTO sale_item_parts (sale_item_id, part_id) "
        "SELECT id, part_id FROM sale_items WHERE part_id IS NOT NULL"
    )

    op.drop_index("ix_sale_items_part_id", table_name="sale_items")
    op.drop_column("sale_items", "part_id")

    # Lines written before this release that named a car were always shells:
    # a lot line against a car had no way to exist yet.
    op.add_column(
        "sale_items",
        sa.Column("is_shell", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE sale_items SET is_shell = true WHERE vehicle_id IS NOT NULL")


def downgrade() -> None:
    op.drop_column("sale_items", "is_shell")

    op.add_column("sale_items", sa.Column("part_id", sa.Integer(), nullable=True))
    op.create_index("ix_sale_items_part_id", "sale_items", ["part_id"])
    op.create_foreign_key(
        "sale_items_part_id_fkey", "sale_items", "parts", ["part_id"], ["id"], ondelete="SET NULL"
    )

    # Only one part per line fits again, so keep the lowest-numbered one.
    op.execute(
        "UPDATE sale_items SET part_id = ("
        "  SELECT MIN(part_id) FROM sale_item_parts WHERE sale_item_id = sale_items.id"
        ")"
    )
    op.drop_table("sale_item_parts")
