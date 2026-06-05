"""add space adapter configuration fields

Revision ID: 0002_space_config_adapter_fields
Revises: 0001_initial_schema
Create Date: 2026-06-04 00:00:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "0002_space_config_adapter_fields"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE space_configs ADD COLUMN IF NOT EXISTS auth_type VARCHAR(32) NOT NULL DEFAULT 'rayspace'")
    op.execute(
        "ALTER TABLE space_configs ADD COLUMN IF NOT EXISTS asset_path VARCHAR(256) NOT NULL DEFAULT 'api/asset/select/query'"
    )
    op.execute(
        "ALTER TABLE space_configs ADD COLUMN IF NOT EXISTS vulnerability_path VARCHAR(256) NOT NULL DEFAULT 'api/v1/vulnerabilities'"
    )
    op.execute("ALTER TABLE space_configs ADD COLUMN IF NOT EXISTS verify_tls BOOLEAN NOT NULL DEFAULT false")
    op.execute("ALTER TABLE space_configs ALTER COLUMN auth_type DROP DEFAULT")
    op.execute("ALTER TABLE space_configs ALTER COLUMN asset_path DROP DEFAULT")
    op.execute("ALTER TABLE space_configs ALTER COLUMN vulnerability_path DROP DEFAULT")
    op.execute("ALTER TABLE space_configs ALTER COLUMN verify_tls DROP DEFAULT")


def downgrade() -> None:
    op.execute("ALTER TABLE space_configs DROP COLUMN IF EXISTS verify_tls")
    op.execute("ALTER TABLE space_configs DROP COLUMN IF EXISTS vulnerability_path")
    op.execute("ALTER TABLE space_configs DROP COLUMN IF EXISTS asset_path")
    op.execute("ALTER TABLE space_configs DROP COLUMN IF EXISTS auth_type")
