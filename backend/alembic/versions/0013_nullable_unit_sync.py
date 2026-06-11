"""allow unassigned assets and query sync tasks

Revision ID: 0013_nullable_unit_sync
Revises: 0012_template_content
Create Date: 2026-06-05
"""

from __future__ import annotations

from alembic import op

revision = "0013_nullable_unit_sync"
down_revision = "0012_template_content"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_unit_id_fkey")
    op.execute("ALTER TABLE asset_changes DROP CONSTRAINT IF EXISTS asset_changes_unit_id_fkey")
    op.execute("ALTER TABLE sync_tasks DROP CONSTRAINT IF EXISTS sync_tasks_unit_id_fkey")

    op.execute("ALTER TABLE assets ALTER COLUMN unit_id DROP NOT NULL")
    op.execute("ALTER TABLE asset_changes ALTER COLUMN unit_id DROP NOT NULL")
    op.execute("ALTER TABLE sync_tasks ALTER COLUMN unit_id DROP NOT NULL")

    op.execute(
        "ALTER TABLE assets ADD CONSTRAINT assets_unit_id_fkey "
        "FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL"
    )
    op.execute(
        "ALTER TABLE asset_changes ADD CONSTRAINT asset_changes_unit_id_fkey "
        "FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL"
    )
    op.execute(
        "ALTER TABLE sync_tasks ADD CONSTRAINT sync_tasks_unit_id_fkey "
        "FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL"
    )


def downgrade() -> None:
    op.execute("DELETE FROM asset_changes WHERE unit_id IS NULL")
    op.execute("DELETE FROM sync_tasks WHERE unit_id IS NULL")
    op.execute("DELETE FROM assets WHERE unit_id IS NULL")

    op.execute("ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_unit_id_fkey")
    op.execute("ALTER TABLE asset_changes DROP CONSTRAINT IF EXISTS asset_changes_unit_id_fkey")
    op.execute("ALTER TABLE sync_tasks DROP CONSTRAINT IF EXISTS sync_tasks_unit_id_fkey")

    op.execute("ALTER TABLE assets ALTER COLUMN unit_id SET NOT NULL")
    op.execute("ALTER TABLE asset_changes ALTER COLUMN unit_id SET NOT NULL")
    op.execute("ALTER TABLE sync_tasks ALTER COLUMN unit_id SET NOT NULL")

    op.execute(
        "ALTER TABLE assets ADD CONSTRAINT assets_unit_id_fkey "
        "FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE"
    )
    op.execute(
        "ALTER TABLE asset_changes ADD CONSTRAINT asset_changes_unit_id_fkey "
        "FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE"
    )
    op.execute(
        "ALTER TABLE sync_tasks ADD CONSTRAINT sync_tasks_unit_id_fkey "
        "FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE"
    )
