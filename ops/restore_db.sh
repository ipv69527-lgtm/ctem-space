#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-$PROJECT_DIR/docker-compose.prod.yml}"
DB_NAME="${DB_NAME:-ctem}"
DB_USER="${DB_USER:-ctem}"
BACKUP_FILE="${1:-}"

if [[ -z "$BACKUP_FILE" ]]; then
  echo "Usage: $0 /path/to/ctem-YYYYmmdd-HHMMSS.dump" >&2
  exit 2
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 2
fi

if [[ "${CONFIRM_RESTORE:-}" != "YES" ]]; then
  echo "Refusing to restore without explicit confirmation." >&2
  echo "Run: CONFIRM_RESTORE=YES $0 $BACKUP_FILE" >&2
  exit 2
fi

cd "$PROJECT_DIR"

pre_restore_backup="$(PROJECT_DIR="$PROJECT_DIR" COMPOSE_FILE="$COMPOSE_FILE" DB_NAME="$DB_NAME" DB_USER="$DB_USER" "$PROJECT_DIR/ops/backup_db.sh")"
echo "Pre-restore backup created: $pre_restore_backup"

docker compose -f "$COMPOSE_FILE" --project-directory "$PROJECT_DIR" stop backend worker frontend

docker compose -f "$COMPOSE_FILE" --project-directory "$PROJECT_DIR" exec -T postgres \
  sh -c "dropdb -U '$DB_USER' '$DB_NAME' --force && createdb -U '$DB_USER' '$DB_NAME'"

docker compose -f "$COMPOSE_FILE" --project-directory "$PROJECT_DIR" exec -T postgres \
  pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --role="$DB_USER" < "$BACKUP_FILE"

docker compose -f "$COMPOSE_FILE" --project-directory "$PROJECT_DIR" up -d backend worker frontend

echo "Restore completed from: $BACKUP_FILE"
