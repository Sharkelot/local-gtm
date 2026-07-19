#!/usr/bin/env bash
# Deploy an immutable image digest to the application CT over outbound SSH.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <image-digest>" >&2
  exit 64
fi

target_digest=$1
# shellcheck disable=SC1091
source "${DEPLOYMENT_ENV:-/etc/local-gtm/deployment.env}"
# shellcheck disable=SC1091
source "${HOSTS_ENV:-/etc/local-gtm/hosts.env}"

: "${DEPLOY_USER:?set DEPLOY_USER}"
: "${CRM_HOST:?set CRM_HOST}"
: "${SSH_IDENTITY_FILE:?set SSH_IDENTITY_FILE}"
: "${SSH_KNOWN_HOSTS_FILE:?set SSH_KNOWN_HOSTS_FILE}"
: "${LOCK_FILE:?set LOCK_FILE}"
: "${CURRENT_DIGEST_FILE:?set CURRENT_DIGEST_FILE}"
: "${PREVIOUS_DIGEST_FILE:?set PREVIOUS_DIGEST_FILE}"
: "${DEPLOY_METADATA_DIR:?set DEPLOY_METADATA_DIR}"
: "${GHCR_REGISTRY:?set GHCR_REGISTRY}"
: "${GHCR_REPOSITORY:?set GHCR_REPOSITORY}"
: "${WEB_IMAGE_NAME:?set WEB_IMAGE_NAME}"
: "${PLATFORM_WORKER_IMAGE_NAME:?set PLATFORM_WORKER_IMAGE_NAME}"
: "${MIGRATOR_IMAGE_NAME:?set MIGRATOR_IMAGE_NAME}"
: "${REMOTE_COMPOSE_DIR:?set REMOTE_COMPOSE_DIR}"
: "${REMOTE_ENV_FILE:?set REMOTE_ENV_FILE, e.g. /etc/local-gtm/app.env}"
: "${HEALTH_CHECK_SCRIPT:?set HEALTH_CHECK_SCRIPT}"
: "${ROLLBACK_SCRIPT:?set ROLLBACK_SCRIPT}"

ssh_base=(
  ssh
  -i "$SSH_IDENTITY_FILE"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile="$SSH_KNOWN_HOSTS_FILE"
  "${DEPLOY_USER}@${CRM_HOST}"
)

log() {
  printf '[local-gtm-deploy] %s\n' "$*" >&2
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "another deployment is in progress"
  exit 75
fi

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="${DEPLOY_METADATA_DIR}/backup-${timestamp}"
mkdir -p "$backup_dir"

if [ -f "$CURRENT_DIGEST_FILE" ]; then
  cp "$CURRENT_DIGEST_FILE" "$backup_dir/current-digest"
  cp "$CURRENT_DIGEST_FILE" "$PREVIOUS_DIGEST_FILE"
fi

web_ref="${GHCR_REGISTRY}/${GHCR_REPOSITORY}/${WEB_IMAGE_NAME}@${target_digest}"
worker_ref="${GHCR_REGISTRY}/${GHCR_REPOSITORY}/${PLATFORM_WORKER_IMAGE_NAME}@${target_digest}"
migrator_ref="${GHCR_REGISTRY}/${GHCR_REPOSITORY}/${MIGRATOR_IMAGE_NAME}@${target_digest}"

log "preflight remote connectivity"
"${ssh_base[@]}" 'test -d "'"$REMOTE_COMPOSE_DIR"'"'

log "pull immutable images on target"
"${ssh_base[@]}" bash -s -- "$web_ref" "$worker_ref" "$migrator_ref" <<'REMOTE'
set -euo pipefail
web_ref=$1
worker_ref=$2
migrator_ref=$3
docker pull "$web_ref"
docker pull "$worker_ref"
docker pull "$migrator_ref"
REMOTE

log "run database migrations"
"${ssh_base[@]}" bash -s -- "$migrator_ref" "$REMOTE_COMPOSE_DIR" <<'REMOTE'
set -euo pipefail
migrator_ref=$1
compose_dir=$2
cd "$compose_dir"
docker compose --env-file "$REMOTE_ENV_FILE" -f compose.app.yml --profile migration run --rm migrator
REMOTE

log "deploy application stack"
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

if ! "$HEALTH_CHECK_SCRIPT"; then
  log "health checks failed; rolling back"
  "$ROLLBACK_SCRIPT"
  exit 1
fi

printf '%s\n' "$target_digest" > "$CURRENT_DIGEST_FILE"
log "deployment complete digest=${target_digest}"
