#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-$PROJECT_DIR/docker-compose.prod.yml}"
RELEASE_FILE="${1:-}"

if [[ -z "$RELEASE_FILE" ]]; then
  RELEASE_FILE="$(find "$PROJECT_DIR/releases" -maxdepth 1 -name 'predeploy-*.tar.gz' -type f 2>/dev/null | sort -r | head -1)"
fi

if [[ -z "$RELEASE_FILE" || ! -f "$RELEASE_FILE" ]]; then
  echo "No rollback release found. Usage: $0 /path/to/predeploy-YYYYmmdd-HHMMSS.tar.gz" >&2
  exit 2
fi

cd "$PROJECT_DIR"

backup_file="$(PROJECT_DIR="$PROJECT_DIR" COMPOSE_FILE="$COMPOSE_FILE" "$PROJECT_DIR/ops/backup_db.sh")"
echo "Database backup before rollback: $backup_file"

tar -xzf "$RELEASE_FILE" -C "$PROJECT_DIR"

docker compose -f "$COMPOSE_FILE" --project-directory "$PROJECT_DIR" build backend worker frontend
docker compose -f "$COMPOSE_FILE" --project-directory "$PROJECT_DIR" run --rm backend alembic upgrade head
docker compose -f "$COMPOSE_FILE" --project-directory "$PROJECT_DIR" up -d backend worker frontend

echo "Rolled back source from: $RELEASE_FILE"
