"""backfill vulnerability descriptions

Revision ID: 0010_backfill_vuln_descr
Revises: 0009_backfill_cve_names
Create Date: 2026-06-05
"""

from __future__ import annotations

from alembic import op

revision = "0010_backfill_vuln_descr"
down_revision = "0009_backfill_cve_names"
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
        cve_descr AS (
            SELECT DISTINCT ON (upper(detail->>'cve'))
                upper(detail->>'cve') AS cve,
                COALESCE(detail->>'descr', detail->>'desc', detail->>'description') AS descr
            FROM detail_items
            WHERE (detail->>'cve') ~* '^CVE-[0-9]{4}-[0-9]{4,}$'
              AND COALESCE(detail->>'descr', detail->>'desc', detail->>'description', '') <> ''
            ORDER BY upper(detail->>'cve'), length(COALESCE(detail->>'descr', detail->>'desc', detail->>'description')) DESC
        )
        UPDATE vulnerabilities
        SET "desc" = cve_descr.descr,
            updated_at = now()
        FROM cve_descr
        WHERE upper(vulnerabilities.cve) = cve_descr.cve
          AND vulnerabilities."desc" IS DISTINCT FROM cve_descr.descr
        """
    )


def downgrade() -> None:
    pass
