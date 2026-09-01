"""vehicle nickname and unknown vin

Revision ID: ae210c603808
Revises: 741a78c78a30
Create Date: 2026-08-31 21:59:07.189640

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "ae210c603808"
down_revision: str | None = "741a78c78a30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # server_default matters: adding a NOT NULL column to a table that already
    # has rows fails without one. Autogenerate does not add it.
    op.add_column(
        "vehicles",
        sa.Column("vin_unknown", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("vehicles", sa.Column("nickname", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("vehicles", "nickname")
    op.drop_column("vehicles", "vin_unknown")
