"""add raw data to assets

Revision ID: 0004_asset_raw_data
Revises: 0003_sync_task_metrics
Create Date: 2026-06-04 00:00:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "0004_asset_raw_data"
down_revision = "0003_sync_task_metrics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE assets ADD COLUMN IF NOT EXISTS raw_data JSONB NOT NULL DEFAULT '[]'::jsonb")
    op.execute("ALTER TABLE assets ALTER COLUMN raw_data DROP DEFAULT")


def downgrade() -> None:
    op.execute("ALTER TABLE assets DROP COLUMN IF EXISTS raw_data")
