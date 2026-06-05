#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-$PROJECT_DIR/docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups/postgres}"
RETENTION="${RETENTION:-10}"
DB_NAME="${DB_NAME:-ctem}"
DB_USER="${DB_USER:-ctem}"

mkdir -p "$BACKUP_DIR"

timestamp="$(date +%Y%m%d-%H%M%S)"
backup_file="$BACKUP_DIR/${DB_NAME}-${timestamp}.dump"
meta_file="$BACKUP_DIR/${DB_NAME}-${timestamp}.meta"

cd "$PROJECT_DIR"

docker compose -f "$COMPOSE_FILE" --project-directory "$PROJECT_DIR" exec -T postgres \
  pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$backup_file"

cat > "$meta_file" <<META
created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
project_dir=$PROJECT_DIR
compose_file=$COMPOSE_FILE
db_name=$DB_NAME
db_user=$DB_USER
backup_file=$backup_file
META

find "$BACKUP_DIR" -maxdepth 1 -name "${DB_NAME}-*.dump" -type f \
  | sort -r \
  | awk -v keep="$RETENTION" 'NR > keep' \
  | while read -r old_backup; do
      rm -f "$old_backup" "${old_backup%.dump}.meta"
    done

echo "$backup_file"
