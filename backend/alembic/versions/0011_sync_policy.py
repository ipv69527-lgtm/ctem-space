"""add sync policy fields

Revision ID: 0011_sync_policy
Revises: 0010_backfill_vuln_descr
Create Date: 2026-06-05
"""

from __future__ import annotations

from alembic import op


revision = "0011_sync_policy"
down_revision = "0010_backfill_vuln_descr"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE space_configs ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN NOT NULL DEFAULT false")
    op.execute("ALTER TABLE space_configs ADD COLUMN IF NOT EXISTS sync_interval_minutes INTEGER NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE space_configs ALTER COLUMN sync_enabled DROP DEFAULT")
    op.execute("ALTER TABLE space_configs ALTER COLUMN sync_interval_minutes DROP DEFAULT")


def downgrade() -> None:
    op.execute("ALTER TABLE space_configs DROP COLUMN IF EXISTS sync_interval_minutes")
    op.execute("ALTER TABLE space_configs DROP COLUMN IF EXISTS sync_enabled")
