"""add asset profile fields

Revision ID: 0019_asset_profile_fields
Revises: 0018_poc_verified_at
Create Date: 2026-06-16
"""

from alembic import op


revision = "0019_asset_profile_fields"
down_revision = "0018_poc_verified_at"
branch_labels = None
depends_on = None


PROFILE_COLUMNS = (
    "country",
    "province",
    "city",
    "county",
    "manufacturer",
    "brand",
    "model",
    "product",
    "device",
    "device_type",
)


def upgrade() -> None:
    for column in PROFILE_COLUMNS:
        length = 256 if column in {"product", "device"} else 128
        op.execute(f"ALTER TABLE assets ADD COLUMN IF NOT EXISTS {column} VARCHAR({length}) NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE assets ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION")
    op.execute("ALTER TABLE assets ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION")

    op.execute(
        """
        WITH raw_first AS (
            SELECT assets.id, raw.elem AS raw
            FROM assets
            CROSS JOIN LATERAL (
                SELECT elem
                FROM jsonb_array_elements(
                    CASE
                        WHEN jsonb_typeof(assets.raw_data) = 'array' THEN assets.raw_data
                        ELSE '[]'::jsonb
                    END
                ) AS elem
                WHERE jsonb_typeof(elem) = 'object'
                LIMIT 1
            ) AS raw
        )
        UPDATE assets
        SET
            country = COALESCE(NULLIF(raw_first.raw->>'country', ''), assets.country),
            province = COALESCE(NULLIF(raw_first.raw->>'province', ''), assets.province),
            city = COALESCE(NULLIF(raw_first.raw->>'city', ''), assets.city),
            county = COALESCE(NULLIF(raw_first.raw->>'county', ''), NULLIF(raw_first.raw->>'district', ''), assets.county),
            longitude = COALESCE(
                CASE WHEN NULLIF(raw_first.raw->>'longitude', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (raw_first.raw->>'longitude')::double precision END,
                CASE WHEN NULLIF(raw_first.raw->>'lng', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (raw_first.raw->>'lng')::double precision END,
                assets.longitude
            ),
            latitude = COALESCE(
                CASE WHEN NULLIF(raw_first.raw->>'latitude', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (raw_first.raw->>'latitude')::double precision END,
                CASE WHEN NULLIF(raw_first.raw->>'lat', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (raw_first.raw->>'lat')::double precision END,
                assets.latitude
            ),
            manufacturer = COALESCE(
                NULLIF(raw_first.raw->>'manufacturer', ''),
                (
                    SELECT NULLIF(app->>'manufacturer', '')
                    FROM jsonb_array_elements(
                        CASE
                            WHEN jsonb_typeof(raw_first.raw->'application_info') = 'array' THEN raw_first.raw->'application_info'
                            ELSE '[]'::jsonb
                        END
                    ) AS app
                    WHERE NULLIF(app->>'manufacturer', '') IS NOT NULL
                       OR NULLIF(app->>'manufacturer_short', '') IS NOT NULL
                    LIMIT 1
                ),
                (
                    SELECT NULLIF(app->>'manufacturer_short', '')
                    FROM jsonb_array_elements(
                        CASE
                            WHEN jsonb_typeof(raw_first.raw->'application_info') = 'array' THEN raw_first.raw->'application_info'
                            ELSE '[]'::jsonb
                        END
                    ) AS app
                    WHERE NULLIF(app->>'manufacturer_short', '') IS NOT NULL
                    LIMIT 1
                ),
                assets.manufacturer
            ),
            brand = COALESCE(
                NULLIF(raw_first.raw->>'brand', ''),
                (
                    SELECT NULLIF(app->>'brand', '')
                    FROM jsonb_array_elements(
                        CASE
                            WHEN jsonb_typeof(raw_first.raw->'application_info') = 'array' THEN raw_first.raw->'application_info'
                            ELSE '[]'::jsonb
                        END
                    ) AS app
                    WHERE NULLIF(app->>'brand', '') IS NOT NULL
                    LIMIT 1
                ),
                assets.brand
            ),
            model = COALESCE(
                NULLIF(raw_first.raw->>'model', ''),
                (
                    SELECT NULLIF(app->>'model', '')
                    FROM jsonb_array_elements(
                        CASE
                            WHEN jsonb_typeof(raw_first.raw->'application_info') = 'array' THEN raw_first.raw->'application_info'
                            ELSE '[]'::jsonb
                        END
                    ) AS app
                    WHERE NULLIF(app->>'model', '') IS NOT NULL
                    LIMIT 1
                ),
                assets.model
            ),
            product = COALESCE(
                NULLIF(raw_first.raw->>'product', ''),
                NULLIF(raw_first.raw->>'app', ''),
                (
                    SELECT NULLIF(app->>'name', '')
                    FROM jsonb_array_elements(
                        CASE
                            WHEN jsonb_typeof(raw_first.raw->'application_info') = 'array' THEN raw_first.raw->'application_info'
                            ELSE '[]'::jsonb
                        END
                    ) AS app
                    WHERE NULLIF(app->>'name', '') IS NOT NULL
                    LIMIT 1
                ),
                assets.product
            ),
            device = COALESCE(NULLIF(raw_first.raw->>'device', ''), assets.device),
            device_type = COALESCE(NULLIF(raw_first.raw->>'device_type', ''), NULLIF(raw_first.raw->>'asset_type', ''), NULLIF(raw_first.raw->>'category_sub', ''), assets.device_type)
        FROM raw_first
        WHERE assets.id = raw_first.id
        """
    )

    for index_name, columns in (
        ("ix_assets_risk", "risk"),
        ("ix_assets_type", "type"),
        ("ix_assets_last_seen", "last_seen"),
        ("ix_assets_province", "province"),
        ("ix_assets_city", "city"),
        ("ix_assets_manufacturer", "manufacturer"),
        ("ix_assets_coordinates", "longitude, latitude"),
    ):
        op.execute(f"CREATE INDEX IF NOT EXISTS {index_name} ON assets ({columns})")


def downgrade() -> None:
    for index_name in (
        "ix_assets_coordinates",
        "ix_assets_manufacturer",
        "ix_assets_city",
        "ix_assets_province",
        "ix_assets_last_seen",
        "ix_assets_type",
        "ix_assets_risk",
    ):
        op.execute(f"DROP INDEX IF EXISTS {index_name}")
    op.execute("ALTER TABLE assets DROP COLUMN IF EXISTS latitude")
    op.execute("ALTER TABLE assets DROP COLUMN IF EXISTS longitude")
    for column in reversed(PROFILE_COLUMNS):
        op.execute(f"ALTER TABLE assets DROP COLUMN IF EXISTS {column}")
