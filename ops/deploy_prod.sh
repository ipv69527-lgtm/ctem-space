#!/usr/bin/env bash
set -euo pipefail

LOCAL_DIR="${LOCAL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REMOTE_HOST="${REMOTE_HOST:-}"
REMOTE_DIR="${REMOTE_DIR:-}"
PACKAGE="${PACKAGE:-/tmp/ctem-platform-$(date +%Y%m%d-%H%M%S).tar.gz}"

if [[ -z "$REMOTE_HOST" || -z "$REMOTE_DIR" ]]; then
  echo "REMOTE_HOST and REMOTE_DIR are required" >&2
  echo "Usage: REMOTE_HOST='user@example.com' REMOTE_DIR='/opt/ctem-platform' ./ops/deploy_prod.sh" >&2
  exit 2
fi

cd "$LOCAL_DIR"

COPYFILE_DISABLE=1 tar --no-xattrs -czf "$PACKAGE" \
  --exclude frontend/node_modules \
  --exclude frontend/dist \
  --exclude backups \
  --exclude .DS_Store \
  --exclude '._*' \
  backend frontend ops docs docker-compose.prod.yml README.md .env.example .dockerignore

remote_package="/home/kali/$(basename "$PACKAGE")"

scp -o StrictHostKeyChecking=no "$PACKAGE" "$REMOTE_HOST:$remote_package"

ssh -o StrictHostKeyChecking=no "$REMOTE_HOST" \
  "mkdir -p '$REMOTE_DIR/releases' '$REMOTE_DIR/backups/postgres' && \
   if [ -f '$REMOTE_DIR/docker-compose.prod.yml' ]; then \
     tar -czf '$REMOTE_DIR/releases/predeploy-$(date +%Y%m%d-%H%M%S).tar.gz' \
       -C '$REMOTE_DIR' --exclude './.env' --exclude './backups' --exclude './releases' .; \
   fi && \
   tar -xzf '$remote_package' -C '$REMOTE_DIR' && \
   cd '$REMOTE_DIR' && \
   ./ops/backup_db.sh && \
   docker compose -f docker-compose.prod.yml --project-directory '$REMOTE_DIR' build backend worker frontend && \
   docker compose -f docker-compose.prod.yml --project-directory '$REMOTE_DIR' run --rm backend alembic upgrade head && \
   docker compose -f docker-compose.prod.yml --project-directory '$REMOTE_DIR' up -d backend worker frontend"

echo "Deployed to $REMOTE_HOST:$REMOTE_DIR"
