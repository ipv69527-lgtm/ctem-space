#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
PROJECT_DIR="${PROJECT_DIR:-$(pwd)}"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups/postgres}"
DISK_PATH="${DISK_PATH:-$PROJECT_DIR}"
DISK_WARN_PERCENT="${DISK_WARN_PERCENT:-85}"
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-24}"
ADMIN_USERNAME="${ADMIN_USERNAME:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

warn() {
  echo "[WARN] $*"
}

ok() {
  echo "[OK] $*"
}

fail() {
  echo "[FAIL] $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"
}

require_cmd curl
require_cmd docker
require_cmd python3

echo "CTEM monitor check"
echo "BASE_URL=$BASE_URL"
echo "PROJECT_DIR=$PROJECT_DIR"

curl -fsS "$BASE_URL/api/health" >/dev/null
ok "health endpoint"

docker compose -f "$COMPOSE_FILE" --project-directory "$PROJECT_DIR" ps >/dev/null
ok "compose ps"

unhealthy=$(
  docker compose -f "$COMPOSE_FILE" --project-directory "$PROJECT_DIR" ps --format json 2>/dev/null \
    | python3 -c 'import json,sys
bad=[]
for line in sys.stdin:
    if not line.strip():
        continue
    item=json.loads(line)
    state=(item.get("State") or "").lower()
    health=(item.get("Health") or "").lower()
    name=item.get("Name") or item.get("Service") or "unknown"
    if state not in {"running"} or health in {"unhealthy"}:
        bad.append(f"{name}:{state}:{health}")
print(",".join(bad))'
)
if [[ -n "$unhealthy" ]]; then
  fail "unhealthy containers: $unhealthy"
fi
ok "containers running"

disk_used=$(df -P "$DISK_PATH" | awk 'NR==2 {gsub("%","",$5); print $5}')
if [[ "$disk_used" =~ ^[0-9]+$ ]] && (( disk_used >= DISK_WARN_PERCENT )); then
  warn "disk usage ${disk_used}% >= ${DISK_WARN_PERCENT}% on $DISK_PATH"
else
  ok "disk usage ${disk_used}% on $DISK_PATH"
fi

if [[ -d "$BACKUP_DIR" ]]; then
  latest_backup=$(find "$BACKUP_DIR" -type f -name '*.dump' -print0 | xargs -0 ls -1t 2>/dev/null | head -n 1 || true)
  if [[ -n "$latest_backup" ]]; then
    backup_age_hours=$(python3 - "$latest_backup" <<'PY'
from datetime import datetime
from pathlib import Path
import sys
path = Path(sys.argv[1])
age = datetime.now().timestamp() - path.stat().st_mtime
print(int(age // 3600))
PY
)
    if (( backup_age_hours > BACKUP_MAX_AGE_HOURS )); then
      warn "latest backup is ${backup_age_hours}h old: $latest_backup"
    else
      ok "latest backup ${backup_age_hours}h old"
    fi
  else
    warn "no database dump found in $BACKUP_DIR"
  fi
else
  warn "backup directory not found: $BACKUP_DIR"
fi

if [[ -n "$ADMIN_USERNAME" && -n "$ADMIN_PASSWORD" ]]; then
  python3 - "$BASE_URL" "$ADMIN_USERNAME" "$ADMIN_PASSWORD" <<'PY'
import json
import sys
from urllib import request

base_url, username, password = sys.argv[1:4]

def post_json(path, body):
    data = json.dumps(body).encode()
    req = request.Request(
        base_url.rstrip("/") + path,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())

def get_json(path, token):
    req = request.Request(
        base_url.rstrip("/") + path,
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    with request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())

login = post_json("/api/auth/login", {"username": username, "password": password})
token = login["access_token"]
summary = get_json("/api/sync/task-summary", token)
failed = int(summary.get("failed") or 0)
running = int(summary.get("running") or 0) + int(summary.get("pending") or 0)
print(f"[OK] auth and sync summary failed={failed} running={running}")
if failed:
    print(f"[WARN] failed sync tasks: {failed}")
PY
else
  warn "ADMIN_USERNAME/ADMIN_PASSWORD not set; skipped authenticated sync summary check"
fi

ok "monitor check completed"
