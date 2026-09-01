"""part age alerts and clearer vehicle states

Revision ID: 741a78c78a30
Revises: acdf1961a5f5
Create Date: 2026-08-31 20:35:55.497880

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "741a78c78a30"
down_revision: str | None = "acdf1961a5f5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("parts", sa.Column("age_alert_days", sa.Integer(), nullable=True))

    # "teardown" and "complete" read ambiguously next to each other. The states
    # are now acquired -> in_teardown -> stripped -> scrapped, where stripped
    # means the parts are out but the shell is still on the property.
    op.execute("UPDATE vehicles SET status = 'in_teardown' WHERE status = 'teardown'")
    op.execute("UPDATE vehicles SET status = 'stripped' WHERE status = 'complete'")


def downgrade() -> None:
    op.execute("UPDATE vehicles SET status = 'complete' WHERE status = 'stripped'")
    op.execute("UPDATE vehicles SET status = 'teardown' WHERE status = 'in_teardown'")
    op.drop_column("parts", "age_alert_days")
