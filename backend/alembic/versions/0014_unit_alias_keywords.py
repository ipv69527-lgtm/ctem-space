"""add unit alias and keyword rules

Revision ID: 0014_unit_alias_keywords
Revises: 0013_nullable_unit_sync
Create Date: 2026-06-11
"""

from alembic import op
import sqlalchemy as sa


revision = "0014_unit_alias_keywords"
down_revision = "0013_nullable_unit_sync"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE units ADD COLUMN IF NOT EXISTS aliases VARCHAR[] NOT NULL DEFAULT '{}'")
    op.execute("ALTER TABLE units ADD COLUMN IF NOT EXISTS keywords VARCHAR[] NOT NULL DEFAULT '{}'")


def downgrade() -> None:
    op.drop_column("units", "keywords")
    op.drop_column("units", "aliases")
