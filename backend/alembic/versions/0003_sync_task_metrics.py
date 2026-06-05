"""add sync task metrics

Revision ID: 0003_sync_task_metrics
Revises: 0002_space_config_adapter_fields
Create Date: 2026-06-04 00:00:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "0003_sync_task_metrics"
down_revision = "0002_space_config_adapter_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE sync_tasks ADD COLUMN IF NOT EXISTS query_condition TEXT NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE sync_tasks ADD COLUMN IF NOT EXISTS fetched_assets INTEGER NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE sync_tasks ADD COLUMN IF NOT EXISTS synced_assets INTEGER NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE sync_tasks ADD COLUMN IF NOT EXISTS synced_vulns INTEGER NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE sync_tasks ADD COLUMN IF NOT EXISTS error_detail TEXT NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE sync_tasks ALTER COLUMN query_condition DROP DEFAULT")
    op.execute("ALTER TABLE sync_tasks ALTER COLUMN fetched_assets DROP DEFAULT")
    op.execute("ALTER TABLE sync_tasks ALTER COLUMN synced_assets DROP DEFAULT")
    op.execute("ALTER TABLE sync_tasks ALTER COLUMN synced_vulns DROP DEFAULT")
    op.execute("ALTER TABLE sync_tasks ALTER COLUMN error_detail DROP DEFAULT")


def downgrade() -> None:
    op.execute("ALTER TABLE sync_tasks DROP COLUMN IF EXISTS error_detail")
    op.execute("ALTER TABLE sync_tasks DROP COLUMN IF EXISTS synced_vulns")
    op.execute("ALTER TABLE sync_tasks DROP COLUMN IF EXISTS synced_assets")
    op.execute("ALTER TABLE sync_tasks DROP COLUMN IF EXISTS fetched_assets")
    op.execute("ALTER TABLE sync_tasks DROP COLUMN IF EXISTS query_condition")
