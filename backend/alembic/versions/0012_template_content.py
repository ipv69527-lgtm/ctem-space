"""add editable report template content

Revision ID: 0012_template_content
Revises: 0011_sync_policy
Create Date: 2026-06-05
"""

from __future__ import annotations

from alembic import op


revision = "0012_template_content"
down_revision = "0011_sync_policy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE templates ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE templates ALTER COLUMN content DROP DEFAULT")
    op.execute("ALTER TABLE reports ADD COLUMN IF NOT EXISTS template_id VARCHAR(36)")
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'fk_reports_template_id'
            ) THEN
                ALTER TABLE reports
                ADD CONSTRAINT fk_reports_template_id
                FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE SET NULL;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE reports DROP CONSTRAINT IF EXISTS fk_reports_template_id")
    op.execute("ALTER TABLE reports DROP COLUMN IF EXISTS template_id")
    op.execute("ALTER TABLE templates DROP COLUMN IF EXISTS content")
