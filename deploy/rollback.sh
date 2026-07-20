#!/usr/bin/env bash
# Restore the previous release manifest without deleting persistent data volumes.
set -euo pipefail

# shellcheck disable=SC1091
# shellcheck disable=SC1090
source "${DEPLOYMENT_ENV:-/etc/local-gtm/deployment.env}"
# shellcheck disable=SC1091
# shellcheck disable=SC1090
source "${HOSTS_ENV:-/etc/local-gtm/hosts.env}"

: "${PREVIOUS_RELEASE_FILE:?set PREVIOUS_RELEASE_FILE}"
: "${CURRENT_RELEASE_FILE:?set CURRENT_RELEASE_FILE}"
: "${DEPLOY_USER:?set DEPLOY_USER}"
: "${CRM_HOST:?set CRM_HOST}"
: "${SSH_IDENTITY_FILE:?set SSH_IDENTITY_FILE}"
: "${SSH_KNOWN_HOSTS_FILE:?set SSH_KNOWN_HOSTS_FILE}"
: "${REMOTE_COMPOSE_DIR:?set REMOTE_COMPOSE_DIR}"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RELEASE_MANIFEST_SCRIPT="${SCRIPT_DIR}/release-manifest.sh"

if [ ! -s "$PREVIOUS_RELEASE_FILE" ]; then
  echo "no previous release manifest found; manual intervention required" >&2
  exit 66
fi

if ! bash "$RELEASE_MANIFEST_SCRIPT" validate "$PREVIOUS_RELEASE_FILE"; then
  echo "previous release manifest is invalid; manual intervention required" >&2
  exit 67
fi

web_ref=$(bash "$RELEASE_MANIFEST_SCRIPT" resolve "$PREVIOUS_RELEASE_FILE" web)
worker_ref=$(bash "$RELEASE_MANIFEST_SCRIPT" resolve "$PREVIOUS_RELEASE_FILE" platformWorker)

ssh_base=(
  ssh
  -i "$SSH_IDENTITY_FILE"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile="$SSH_KNOWN_HOSTS_FILE"
  "${DEPLOY_USER}@${CRM_HOST}"
)

"${ssh_base[@]}" bash -s -- "$web_ref" "$worker_ref" "$REMOTE_COMPOSE_DIR" <<'REMOTE'
set -euo pipefail
web_ref=$1; worker_ref=$2; compose_dir=$3
cd "$compose_dir"
export WEB_IMAGE="$web_ref"
export PLATFORM_WORKER_IMAGE="$worker_ref"
docker compose -f compose.app.yml up -d --no-build
REMOTE

cp "$PREVIOUS_RELEASE_FILE" "$CURRENT_RELEASE_FILE"
previous_commit=$(bash "$RELEASE_MANIFEST_SCRIPT" get-commit "$PREVIOUS_RELEASE_FILE" 2>/dev/null || echo "unknown")
printf '[local-gtm-rollback] restored release commit=%s\n' "$previous_commit" >&2
