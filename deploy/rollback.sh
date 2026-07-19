#!/usr/bin/env bash
# Restore the previous immutable digest without deleting persistent data volumes.
set -euo pipefail

# shellcheck disable=SC1091
source "${DEPLOYMENT_ENV:-/etc/local-gtm/deployment.env}"
# shellcheck disable=SC1091
source "${HOSTS_ENV:-/etc/local-gtm/hosts.env}"

: "${PREVIOUS_DIGEST_FILE:?set PREVIOUS_DIGEST_FILE}"
: "${CURRENT_DIGEST_FILE:?set CURRENT_DIGEST_FILE}"
: "${DEPLOY_USER:?set DEPLOY_USER}"
: "${CRM_HOST:?set CRM_HOST}"
: "${SSH_IDENTITY_FILE:?set SSH_IDENTITY_FILE}"
: "${SSH_KNOWN_HOSTS_FILE:?set SSH_KNOWN_HOSTS_FILE}"
: "${GHCR_REGISTRY:?set GHCR_REGISTRY}"
: "${GHCR_REPOSITORY:?set GHCR_REPOSITORY}"
: "${WEB_IMAGE_NAME:?set WEB_IMAGE_NAME}"
: "${PLATFORM_WORKER_IMAGE_NAME:?set PLATFORM_WORKER_IMAGE_NAME}"
: "${REMOTE_COMPOSE_DIR:?set REMOTE_COMPOSE_DIR}"
: "${REMOTE_ENV_FILE:?set REMOTE_ENV_FILE, e.g. /etc/local-gtm/app.env}"

if [ ! -s "$PREVIOUS_DIGEST_FILE" ]; then
  echo "no previous digest recorded; manual intervention required" >&2
  exit 66
fi

previous_digest=$(tr -d '[:space:]' < "$PREVIOUS_DIGEST_FILE")
web_ref="${GHCR_REGISTRY}/${GHCR_REPOSITORY}/${WEB_IMAGE_NAME}@${previous_digest}"
worker_ref="${GHCR_REGISTRY}/${GHCR_REPOSITORY}/${PLATFORM_WORKER_IMAGE_NAME}@${previous_digest}"

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
web_ref=$1
worker_ref=$2
compose_dir=$3
cd "$compose_dir"
export WEB_IMAGE="$web_ref"
export PLATFORM_WORKER_IMAGE="$worker_ref"
docker compose --env-file "$REMOTE_ENV_FILE" -f compose.app.yml up -d --no-build
REMOTE

printf '%s\n' "$previous_digest" > "$CURRENT_DIGEST_FILE"
printf '[local-gtm-rollback] restored digest=%s\n' "$previous_digest" >&2
