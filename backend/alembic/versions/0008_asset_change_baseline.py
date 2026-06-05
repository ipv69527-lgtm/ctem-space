"""asset change baseline

Revision ID: 0008_asset_change_baseline
Revises: 0007_asset_changes
Create Date: 2026-06-05
"""

from __future__ import annotations

from alembic import op

revision = "0008_asset_change_baseline"
down_revision = "0007_asset_changes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO asset_changes (
            id,
            asset_id,
            unit_id,
            ip,
            source,
            action,
            changes,
            created_at
        )
        SELECT
            gen_random_uuid()::text,
            assets.id,
            assets.unit_id,
            assets.ip,
            'migration',
            'create',
            jsonb_build_object(
                'after',
                jsonb_build_object(
                    'name', assets.name,
                    'mac', assets.mac,
                    'type', assets.type,
                    'os', assets.os,
                    'risk', assets.risk,
                    'ports', assets.ports,
                    'services', assets.services,
                    'location', assets.location,
                    'isp', assets.isp
                )
            ),
            COALESCE(assets.created_at, now())
        FROM assets
        WHERE NOT EXISTS (
            SELECT 1
            FROM asset_changes
            WHERE asset_changes.asset_id = assets.id
        )
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM asset_changes
        WHERE source = 'migration'
          AND action = 'create'
        """
    )
