"""backfill cve names

Revision ID: 0009_backfill_cve_names
Revises: 0008_asset_change_baseline
Create Date: 2026-06-05
"""

from __future__ import annotations

from alembic import op

revision = "0009_backfill_cve_names"
down_revision = "0008_asset_change_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        WITH raw_items AS (
            SELECT jsonb_array_elements(assets.raw_data) AS raw
            FROM assets
            WHERE jsonb_typeof(assets.raw_data) = 'array'
        ),
        detail_arrays AS (
            SELECT raw->'cve_detail'->'os'->'detail' AS items FROM raw_items
            UNION ALL
            SELECT raw->'cve_detail'->'service'->'detail' AS items FROM raw_items
        ),
        detail_items AS (
            SELECT jsonb_array_elements(
                CASE
                    WHEN jsonb_typeof(items) = 'array' THEN items
                    ELSE '[]'::jsonb
                END
            ) AS detail
            FROM detail_arrays
        ),
        cve_names AS (
            SELECT DISTINCT ON (upper(detail->>'cve'))
                upper(detail->>'cve') AS cve,
                detail->>'name' AS name
            FROM detail_items
            WHERE (detail->>'cve') ~* '^CVE-[0-9]{4}-[0-9]{4,}$'
              AND COALESCE(detail->>'name', '') <> ''
              AND upper(detail->>'name') <> upper(detail->>'cve')
            ORDER BY upper(detail->>'cve'), length(detail->>'name') DESC
        )
        UPDATE vulnerabilities
        SET title = cve_names.name,
            updated_at = now()
        FROM cve_names
        WHERE upper(vulnerabilities.cve) = cve_names.cve
          AND vulnerabilities.title IS DISTINCT FROM cve_names.name
        """
    )


def downgrade() -> None:
    pass
