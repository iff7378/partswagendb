"""Drop the shipping, fees and tax fields from sales

Two different things were called "Shipping": a field on the sale, meaning what
the buyer paid on top, and a cost row, meaning what it cost us to send it. They
moved money in opposite directions and nothing on screen said which was which.
Only a cost row can record *who* paid, which is what the settle-up needs, so
costs are now the single way to record money going out.

Revision ID: c4d81b6f02a7
Revises: e6c8f13a920b
"""

import sqlalchemy as sa

from alembic import op

revision = "c4d81b6f02a7"
down_revision = "e6c8f13a920b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Refuse rather than silently destroy money. Every sale recorded so far has
    # all three at zero, so this is lossless here -- but a deployment where it
    # is not deserves a person looking at it, not a dropped column.
    conn = op.get_bind()
    stranded = conn.execute(
        sa.text(
            "SELECT reference, shipping, fees, tax FROM sales"
            " WHERE shipping <> 0 OR fees <> 0 OR tax <> 0"
        )
    ).fetchall()
    if stranded:
        listed = ", ".join(
            f"{r[0]} (shipping {r[1]}, fees {r[2]}, tax {r[3]})" for r in stranded[:10]
        )
        raise RuntimeError(
            f"{len(stranded)} sale(s) still carry shipping, fees or tax: {listed}. "
            "Re-record those amounts -- money the buyer paid as a sale line, money "
            "we paid as a cost on the sale -- then run this migration again."
        )

    with op.batch_alter_table("sales") as batch:
        batch.drop_column("shipping")
        batch.drop_column("fees")
        batch.drop_column("tax")


def downgrade() -> None:
    # Restored as zeroes: the values are gone, and the upgrade only runs when
    # they were all zero anyway.
    zero = sa.text("0")
    with op.batch_alter_table("sales") as batch:
        for name in ("shipping", "fees", "tax"):
            batch.add_column(
                sa.Column(name, sa.Numeric(12, 2), nullable=False, server_default=zero)
            )
