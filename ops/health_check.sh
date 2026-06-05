#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost}"
TOKEN="${TOKEN:-}"

curl -fsS "$BASE_URL/api/health"
echo

if [[ -n "$TOKEN" ]]; then
  curl -fsS "$BASE_URL/api/health/deep" -H "Authorization: Bearer $TOKEN"
  echo
fi
