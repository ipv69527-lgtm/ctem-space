"""asset changes

Revision ID: 0007_asset_changes
Revises: 0006_audit_logs
Create Date: 2026-06-05
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0007_asset_changes"
down_revision = "0006_audit_logs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "asset_changes",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("asset_id", sa.String(length=36), nullable=False),
        sa.Column("unit_id", sa.String(length=36), nullable=False),
        sa.Column("ip", sa.String(length=45), nullable=False),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("changes", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_asset_changes_asset_id", "asset_changes", ["asset_id"])
    op.create_index("ix_asset_changes_unit_id", "asset_changes", ["unit_id"])
    op.create_index("ix_asset_changes_ip", "asset_changes", ["ip"])
    op.create_index("ix_asset_changes_action", "asset_changes", ["action"])
    op.create_index("ix_asset_changes_created_at", "asset_changes", ["created_at"])
    op.create_index("ix_assets_unit_ip", "assets", ["unit_id", "ip"])


def downgrade() -> None:
    op.drop_index("ix_assets_unit_ip", table_name="assets")
    op.drop_index("ix_asset_changes_created_at", table_name="asset_changes")
    op.drop_index("ix_asset_changes_action", table_name="asset_changes")
    op.drop_index("ix_asset_changes_ip", table_name="asset_changes")
    op.drop_index("ix_asset_changes_unit_id", table_name="asset_changes")
    op.drop_index("ix_asset_changes_asset_id", table_name="asset_changes")
    op.drop_table("asset_changes")
