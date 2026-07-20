#!/usr/bin/env bash
# Deploy an immutable release manifest to the application CT over outbound SSH.
# Usage: deploy.sh <manifest-file>
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <manifest-file>" >&2
  exit 64
fi

manifest_file=$1
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RELEASE_MANIFEST_SCRIPT="${SCRIPT_DIR}/release-manifest.sh"

# shellcheck disable=SC1091
# shellcheck disable=SC1090
source "${DEPLOYMENT_ENV:-/etc/local-gtm/deployment.env}"

# shellcheck disable=SC1090
source "${HOSTS_ENV:-/etc/local-gtm/hosts.env}"

: "${DEPLOY_USER:?set DEPLOY_USER}"
: "${CRM_HOST:?set CRM_HOST}"
: "${SSH_IDENTITY_FILE:?set SSH_IDENTITY_FILE}"
: "${SSH_KNOWN_HOSTS_FILE:?set SSH_KNOWN_HOSTS_FILE}"
: "${LOCK_FILE:?set LOCK_FILE}"
: "${CURRENT_RELEASE_FILE:?set CURRENT_RELEASE_FILE}"
: "${PREVIOUS_RELEASE_FILE:?set PREVIOUS_RELEASE_FILE}"
: "${DEPLOY_METADATA_DIR:?set DEPLOY_METADATA_DIR}"
: "${REMOTE_COMPOSE_DIR:?set REMOTE_COMPOSE_DIR}"
: "${HEALTH_CHECK_SCRIPT:?set HEALTH_CHECK_SCRIPT}"
: "${ROLLBACK_SCRIPT:?set ROLLBACK_SCRIPT}"

# Validate and resolve image references from the manifest
if ! bash "$RELEASE_MANIFEST_SCRIPT" validate "$manifest_file"; then
  echo "invalid release manifest: $manifest_file" >&2
  exit 67
fi

web_ref=$(bash "$RELEASE_MANIFEST_SCRIPT" resolve "$manifest_file" web)
worker_ref=$(bash "$RELEASE_MANIFEST_SCRIPT" resolve "$manifest_file" platformWorker)
migrator_ref=$(bash "$RELEASE_MANIFEST_SCRIPT" resolve "$manifest_file" migrator)

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

# Acquire deployment lock (fd 9) — prevents concurrent deploys
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "another deployment is in progress"
  exit 75
fi

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="${DEPLOY_METADATA_DIR}/backup-${timestamp}"
mkdir -p "$backup_dir"

# Backup current release and set previous (atomic: write to temp, then mv)
if [ -f "$CURRENT_RELEASE_FILE" ]; then
  cp "$CURRENT_RELEASE_FILE" "$backup_dir/current-release.json"
  # Atomic swap: write previous to temp file, then move into place
  tmp_previous=$(mktemp "${PREVIOUS_RELEASE_FILE}.XXXXXX")
  cp "$CURRENT_RELEASE_FILE" "$tmp_previous"
  mv -f "$tmp_previous" "$PREVIOUS_RELEASE_FILE"
fi

log "release commit=$(bash "$RELEASE_MANIFEST_SCRIPT" get-commit "$manifest_file" 2>/dev/null || echo unknown)"
log "web=${web_ref} worker=${worker_ref} migrator=${migrator_ref}"

log "preflight remote connectivity"
"${ssh_base[@]}" 'test -d "'"${REMOTE_COMPOSE_DIR}"'"'

log "pull immutable images on target"
# Use a single SSH session for all pulls to minimize connections
"${ssh_base[@]}" bash -s -- "$web_ref" "$worker_ref" "$migrator_ref" <<'REMOTE'
set -euo pipefail
web_ref=$1; worker_ref=$2; migrator_ref=$3
docker pull "$web_ref"
docker pull "$worker_ref"
docker pull "$migrator_ref"
REMOTE

log "run database migrations"
"${ssh_base[@]}" bash -s -- "$migrator_ref" "$REMOTE_COMPOSE_DIR" <<'REMOTE'
set -euo pipefail
migrator_ref=$1; compose_dir=$2
cd "$compose_dir"
export MIGRATOR_IMAGE="$migrator_ref"
docker compose -f compose.app.yml --profile migration run --rm migrator
REMOTE

log "deploy application stack"
"${ssh_base[@]}" bash -s -- "$web_ref" "$worker_ref" "$REMOTE_COMPOSE_DIR" <<'REMOTE'
set -euo pipefail
web_ref=$1; worker_ref=$2; compose_dir=$3
cd "$compose_dir"
export WEB_IMAGE="$web_ref"
export PLATFORM_WORKER_IMAGE="$worker_ref"
docker compose -f compose.app.yml up -d --no-build
REMOTE

if ! "$HEALTH_CHECK_SCRIPT"; then
  log "health checks failed; rolling back"
  "$ROLLBACK_SCRIPT"
  exit 1
fi

# Atomic update of current release: write to temp, then mv
tmp_current=$(mktemp "${CURRENT_RELEASE_FILE}.XXXXXX")
cp "$manifest_file" "$tmp_current"
mv -f "$tmp_current" "$CURRENT_RELEASE_FILE"

log "deployment complete manifest=${manifest_file}"
