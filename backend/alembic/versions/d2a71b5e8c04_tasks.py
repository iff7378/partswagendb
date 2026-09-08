"""tasks

Revision ID: d2a71b5e8c04
Revises: c9f3b07a4d18
Create Date: 2026-09-08 11:04:31.772094

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d2a71b5e8c04"
down_revision: str | None = "c9f3b07a4d18"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("assigned_to_id", sa.Integer(), nullable=True),
        sa.Column("due_on", sa.Date(), nullable=True),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("done_by_id", sa.Integer(), nullable=True),
        sa.Column("part_id", sa.Integer(), nullable=True),
        sa.Column("sale_id", sa.Integer(), nullable=True),
        sa.Column("vehicle_id", sa.Integer(), nullable=True),
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
        # CASCADE on the anchors: a task about a deleted part has nothing left
        # to be about. SET NULL on people: who was asked is worth keeping even
        # after an account goes.
        sa.ForeignKeyConstraint(["part_id"], ["parts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sale_id"], ["sales.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["vehicle_id"], ["vehicles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assigned_to_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["done_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint(
            "(CASE WHEN part_id IS NOT NULL THEN 1 ELSE 0 END"
            " + CASE WHEN sale_id IS NOT NULL THEN 1 ELSE 0 END"
            " + CASE WHEN vehicle_id IS NOT NULL THEN 1 ELSE 0 END) <= 1",
            name="ck_tasks_single_anchor",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("assigned_to_id", "due_on", "done_at", "part_id", "sale_id", "vehicle_id"):
        op.create_index(f"ix_tasks_{column}", "tasks", [column])


def downgrade() -> None:
    op.drop_table("tasks")
