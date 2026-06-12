"""add sync query templates

Revision ID: 0017_sync_query_templates
Revises: 0016_vulnerability_poc_semantics
Create Date: 2026-06-12
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0017_sync_query_templates"
down_revision = "0016_vulnerability_poc_semantics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sync_query_templates",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("desc", sa.Text(), nullable=False, server_default=""),
        sa.Column("query_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("query_condition", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sync_query_templates_name", "sync_query_templates", ["name"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_sync_query_templates_name", table_name="sync_query_templates")
    op.drop_table("sync_query_templates")
