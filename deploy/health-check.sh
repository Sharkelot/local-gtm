#!/usr/bin/env bash
# Validate deployment health from the deployer CT using outbound HTTPS only.
set -euo pipefail

# shellcheck disable=SC1091
source "${DEPLOYMENT_ENV:-/etc/local-gtm/deployment.env}"

: "${PUBLIC_CRM_URL:?set PUBLIC_CRM_URL, e.g. https://crm.example.com}"
: "${HEALTH_TIMEOUT_SECONDS:=120}"
: "${HEALTH_INTERVAL_SECONDS:=5}"

deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))

check_path() {
  local path=$1
  local expected=${2:-200}
  local status
  status=$(curl -fsS -o /dev/null -w '%{http_code}' "${PUBLIC_CRM_URL}${path}" || true)
  [ "$status" = "$expected" ]
}

while [ "$SECONDS" -lt "$deadline" ]; do
  if check_path /api/health/live && check_path /api/health/ready && check_path /api/health/smoke; then
    exit 0
  fi
  sleep "$HEALTH_INTERVAL_SECONDS"
done

echo "health checks did not pass within ${HEALTH_TIMEOUT_SECONDS}s" >&2
exit 1
