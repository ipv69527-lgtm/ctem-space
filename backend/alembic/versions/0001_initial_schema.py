"""initial schema

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-06-04
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    unit_status = postgresql.ENUM("ACTIVE", "INACTIVE", name="unitstatus", create_type=False)
    user_role = postgresql.ENUM(
        "SUPER_ADMIN",
        "OPERATOR",
        "AUDITOR",
        name="userrole",
        create_type=False,
    )
    user_status = postgresql.ENUM("ACTIVE", "DISABLED", name="userstatus", create_type=False)
    unit_status.create(op.get_bind(), checkfirst=True)
    user_role.create(op.get_bind(), checkfirst=True)
    user_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("hashed_password", sa.String(length=256), nullable=False),
        sa.Column("role", user_role, nullable=False),
        sa.Column("email", sa.String(length=256), nullable=False),
        sa.Column("status", user_status, nullable=False),
        sa.Column("last_login", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    op.create_table(
        "units",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("desc", sa.Text(), nullable=False),
        sa.Column("ip_ranges", sa.ARRAY(sa.String()), nullable=False),
        sa.Column("contact", sa.String(length=128), nullable=False),
        sa.Column("email", sa.String(length=256), nullable=False),
        sa.Column("status", unit_status, nullable=False),
        sa.Column("region", sa.String(length=32), nullable=False),
        sa.Column("region_name", sa.String(length=128), nullable=False),
        sa.Column("last_sync", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_units_name", "units", ["name"])
    op.create_index("ix_units_code", "units", ["code"], unique=True)

    op.create_table(
        "assets",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("ip", sa.String(length=45), nullable=False),
        sa.Column("mac", sa.String(length=32), nullable=False),
        sa.Column("type", sa.String(length=64), nullable=False),
        sa.Column("os", sa.String(length=256), nullable=False),
        sa.Column("risk", sa.String(length=16), nullable=False),
        sa.Column("unit_id", sa.String(length=36), nullable=False),
        sa.Column("vuln_ids", sa.ARRAY(sa.String()), nullable=False),
        sa.Column("ports", sa.String(length=512), nullable=False),
        sa.Column("services", sa.Text(), nullable=False),
        sa.Column("location", sa.String(length=256), nullable=False),
        sa.Column("isp", sa.String(length=64), nullable=False),
        sa.Column("raw_data", postgresql.JSONB(), nullable=False),
        sa.Column("last_seen", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_assets_name", "assets", ["name"])
    op.create_index("ix_assets_ip", "assets", ["ip"])
    op.create_index("ix_assets_unit_id", "assets", ["unit_id"])
    op.create_index("ix_assets_unit_ip", "assets", ["unit_id", "ip"])

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

    op.create_table(
        "vulnerabilities",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("cve", sa.String(length=32), nullable=False),
        sa.Column("cvss", sa.Float(), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("asset_ids", sa.ARRAY(sa.String()), nullable=False),
        sa.Column("desc", sa.Text(), nullable=False),
        sa.Column("solution", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("status_note", sa.Text(), nullable=False),
        sa.Column("status_updated_at", sa.DateTime(), nullable=True),
        sa.Column("first_found", sa.DateTime(), nullable=True),
        sa.Column("last_found", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_vulnerabilities_title", "vulnerabilities", ["title"])
    op.create_index("ix_vulnerabilities_cve", "vulnerabilities", ["cve"])

    op.create_table(
        "reports",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("type", sa.String(length=64), nullable=False),
        sa.Column("format", sa.String(length=16), nullable=False),
        sa.Column("unit_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("file_path", sa.String(length=512), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"], ondelete="SET NULL"),
    )

    op.create_table(
        "templates",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("desc", sa.Text(), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("vars", sa.ARRAY(sa.String()), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("file_path", sa.String(length=512), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "sync_tasks",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("unit_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("query_condition", sa.Text(), nullable=False),
        sa.Column("fetched_assets", sa.Integer(), nullable=False),
        sa.Column("synced_assets", sa.Integer(), nullable=False),
        sa.Column("synced_vulns", sa.Integer(), nullable=False),
        sa.Column("error_detail", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_sync_tasks_unit_id", "sync_tasks", ["unit_id"])

    op.create_table(
        "space_configs",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("base_url", sa.String(length=512), nullable=False),
        sa.Column("username", sa.String(length=128), nullable=False),
        sa.Column("password", sa.String(length=512), nullable=False),
        sa.Column("api_key", sa.String(length=512), nullable=False),
        sa.Column("auth_type", sa.String(length=32), nullable=False),
        sa.Column("asset_path", sa.String(length=256), nullable=False),
        sa.Column("vulnerability_path", sa.String(length=256), nullable=False),
        sa.Column("verify_tls", sa.Boolean(), nullable=False),
        sa.Column("mock_mode", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=64), nullable=False),
        sa.Column("target_id", sa.String(length=128), nullable=False),
        sa.Column("target_name", sa.String(length=256), nullable=False),
        sa.Column("result", sa.String(length=16), nullable=False),
        sa.Column("ip", sa.String(length=64), nullable=False),
        sa.Column("user_agent", sa.Text(), nullable=False),
        sa.Column("detail", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_audit_logs_user_id", "audit_logs", ["user_id"])
    op.create_index("ix_audit_logs_username", "audit_logs", ["username"])
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"])
    op.create_index("ix_audit_logs_target_type", "audit_logs", ["target_type"])
    op.create_index("ix_audit_logs_target_id", "audit_logs", ["target_id"])
    op.create_index("ix_audit_logs_result", "audit_logs", ["result"])
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_audit_logs_created_at", table_name="audit_logs")
    op.drop_index("ix_audit_logs_result", table_name="audit_logs")
    op.drop_index("ix_audit_logs_target_id", table_name="audit_logs")
    op.drop_index("ix_audit_logs_target_type", table_name="audit_logs")
    op.drop_index("ix_audit_logs_action", table_name="audit_logs")
    op.drop_index("ix_audit_logs_username", table_name="audit_logs")
    op.drop_index("ix_audit_logs_user_id", table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_table("space_configs")
    op.drop_index("ix_sync_tasks_unit_id", table_name="sync_tasks")
    op.drop_table("sync_tasks")
    op.drop_table("templates")
    op.drop_table("reports")
    op.drop_index("ix_vulnerabilities_cve", table_name="vulnerabilities")
    op.drop_index("ix_vulnerabilities_title", table_name="vulnerabilities")
    op.drop_table("vulnerabilities")
    op.drop_index("ix_assets_unit_id", table_name="assets")
    op.drop_index("ix_assets_ip", table_name="assets")
    op.drop_index("ix_assets_name", table_name="assets")
    op.drop_index("ix_asset_changes_created_at", table_name="asset_changes")
    op.drop_index("ix_asset_changes_action", table_name="asset_changes")
    op.drop_index("ix_asset_changes_ip", table_name="asset_changes")
    op.drop_index("ix_asset_changes_unit_id", table_name="asset_changes")
    op.drop_index("ix_asset_changes_asset_id", table_name="asset_changes")
    op.drop_table("asset_changes")
    op.drop_index("ix_assets_unit_ip", table_name="assets")
    op.drop_table("assets")
    op.drop_index("ix_units_code", table_name="units")
    op.drop_index("ix_units_name", table_name="units")
    op.drop_table("units")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")
    sa.Enum(name="userstatus").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="userrole").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="unitstatus").drop(op.get_bind(), checkfirst=True)
