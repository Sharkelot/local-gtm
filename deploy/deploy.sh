#!/usr/bin/env bash
# Deploy an immutable release manifest across the application and database CTs.
# State is prepared and synced before remote mutation, then atomically renamed
# only after health checks pass.
# Usage: deploy.sh <manifest-file>
set -euo pipefail

for cmd in flock jq ssh sync; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "error: '$cmd' is required but not found in PATH" >&2
    exit 70
  fi
done

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <manifest-file>" >&2
  exit 64
fi

manifest_file=$1
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RELEASE_MANIFEST_SCRIPT="${SCRIPT_DIR}/release-manifest.sh"
MAX_STATE_GENERATION=9007199254740991

# shellcheck disable=SC1090
source "${DEPLOYMENT_ENV:-/etc/local-gtm/deployment.env}"

: "${DEPLOY_USER:?set DEPLOY_USER}"
: "${APP_HOST:?set APP_HOST}"
: "${DATABASE_HOST:?set DATABASE_HOST}"
: "${SSH_IDENTITY_FILE:?set SSH_IDENTITY_FILE}"
: "${SSH_KNOWN_HOSTS_FILE:?set SSH_KNOWN_HOSTS_FILE}"
: "${LOCK_FILE:?set LOCK_FILE}"
: "${DEPLOY_STATE_FILE:?set DEPLOY_STATE_FILE (path to state.json)}"
: "${DEPLOY_METADATA_DIR:?set DEPLOY_METADATA_DIR}"
: "${APP_COMPOSE_DIR:?set APP_COMPOSE_DIR}"
: "${APP_ENV_FILE:?set APP_ENV_FILE}"
: "${DATA_COMPOSE_DIR:?set DATA_COMPOSE_DIR}"
: "${DATA_ENV_FILE:?set DATA_ENV_FILE}"
: "${HEALTH_CHECK_SCRIPT:?set HEALTH_CHECK_SCRIPT}"
: "${ROLLBACK_SCRIPT:?set ROLLBACK_SCRIPT}"

if [ "$APP_HOST" = "$DATABASE_HOST" ]; then
  echo "error: APP_HOST and DATABASE_HOST must target distinct hosts" >&2
  exit 78
fi
# Reject paths that are not absolute or contain shell metacharacters.
validate_path() {
  local p="$1" label="$2"
  case "$p" in
    /*) ;;
    *) echo "error: $label must be an absolute path (got '$p')" >&2; exit 78 ;;
  esac
  if [[ "$p" =~ [^a-zA-Z0-9_./@-] ]]; then
    echo "error: $label contains unsafe characters" >&2
    exit 78
  fi
}
validate_path "$APP_COMPOSE_DIR" APP_COMPOSE_DIR
validate_path "$DATA_COMPOSE_DIR" DATA_COMPOSE_DIR

if [ "$APP_ENV_FILE" != "${APP_COMPOSE_DIR%/}/app.env" ]; then
  echo "error: APP_ENV_FILE must be APP_COMPOSE_DIR/app.env" >&2
  exit 78
fi
if [ "$DATA_ENV_FILE" != "${DATA_COMPOSE_DIR%/}/data.env" ]; then
  echo "error: DATA_ENV_FILE must be DATA_COMPOSE_DIR/data.env" >&2
  exit 78
fi

# First-release gate: an operational backup must exist before we allow any
# mutation when there is no prior state to roll back to.
FIRST_RELEASE_BACKUP="${FIRST_RELEASE_BACKUP:-}"
if [ -n "$FIRST_RELEASE_BACKUP" ]; then
  if [ ! -d "$FIRST_RELEASE_BACKUP" ] || [ -z "$(ls -A "$FIRST_RELEASE_BACKUP" 2>/dev/null)" ]; then
    echo "error: first release requires a non-empty operational backup at $FIRST_RELEASE_BACKUP" >&2
    exit 78
  fi
fi

log() {
  printf '[local-gtm-deploy] %s\n' "$*" >&2
}

to_native_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s\n' "$1"
  fi
}

validate_state_file() {
  local file="$1" label="$2" native current_file previous_file
  native=$(to_native_path "$file")
  current_file="${work_dir}/${label}-current.json"
  previous_file="${work_dir}/${label}-previous.json"
  if ! jq -e --argjson max "$MAX_STATE_GENERATION" '
    type == "object"
    and (keys | sort) == ["current", "generation", "previous", "schemaVersion", "updatedAt"]
    and .schemaVersion == 1
    and (.generation | type == "number" and . >= 1 and . <= $max and floor == .)
    and (.current | type == "object")
    and ((.previous == null) or (.previous | type == "object"))
    and (.updatedAt | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))
  ' "$native" >/dev/null 2>&1; then
    return 1
  fi
  jq '.current' "$native" > "$current_file"
  bash "$RELEASE_MANIFEST_SCRIPT" validate "$current_file" >/dev/null || return 1
  if ! jq -e '.previous == null' "$native" >/dev/null; then
    jq '.previous' "$native" > "$previous_file"
    bash "$RELEASE_MANIFEST_SCRIPT" validate "$previous_file" >/dev/null || return 1
  fi
}

if [ ! -r "$SSH_IDENTITY_FILE" ] || [ ! -r "$SSH_KNOWN_HOSTS_FILE" ]; then
  log "SSH identity and known-hosts files must be readable"
  exit 66
fi
if [ ! -x "$HEALTH_CHECK_SCRIPT" ] || [ ! -x "$ROLLBACK_SCRIPT" ]; then
  log "health-check and rollback scripts must be executable"
  exit 66
fi

if ! bash "$RELEASE_MANIFEST_SCRIPT" validate "$manifest_file"; then
  log "invalid release manifest"
  exit 67
fi

web_ref=$(bash "$RELEASE_MANIFEST_SCRIPT" resolve "$manifest_file" web)
worker_ref=$(bash "$RELEASE_MANIFEST_SCRIPT" resolve "$manifest_file" platformWorker)
migrator_ref=$(bash "$RELEASE_MANIFEST_SCRIPT" resolve "$manifest_file" migrator)

ssh_common=(
  ssh
  -i "$SSH_IDENTITY_FILE"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile="$SSH_KNOWN_HOSTS_FILE"
)
app_ssh=("${ssh_common[@]}" "${DEPLOY_USER}@${APP_HOST}")
data_ssh=("${ssh_common[@]}" "${DEPLOY_USER}@${DATABASE_HOST}")

# Acquire deployment lock (fd 9) before reading or preparing state.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "another deployment is in progress"
  exit 75
fi

state_dir=$(dirname "$DEPLOY_STATE_FILE")
if [ ! -d "$state_dir" ] || [ ! -w "$state_dir" ]; then
  log "deployment state directory must already exist and be writable"
  exit 73
fi
mkdir -p "$DEPLOY_METADATA_DIR"
work_dir=$(mktemp -d "${state_dir}/.deploy-preflight.XXXXXX")
tmp_state="${work_dir}/state.json"
trap 'rm -rf "$work_dir"' EXIT

state_exists=false
old_gen=0
previous_json=null
if [ -f "$DEPLOY_STATE_FILE" ]; then
  state_exists=true
  state_native=$(to_native_path "$DEPLOY_STATE_FILE")
  if ! validate_state_file "$DEPLOY_STATE_FILE" existing; then
    log "existing deployment state is invalid; refusing remote mutation"
    exit 67
  fi

  cp "$DEPLOY_STATE_FILE" "${work_dir}/original-state.json"
  cp "${work_dir}/existing-current.json" "${work_dir}/current.json"
  old_gen=$(jq -r '.generation' "$state_native")
  if [ "$old_gen" -ge "$MAX_STATE_GENERATION" ]; then
    log "deployment state generation is exhausted; refusing remote mutation"
    exit 67
  fi
  previous_json=$(jq -c '.current' "$state_native")
fi
new_gen=$((old_gen + 1))
manifest_native=$(to_native_path "$manifest_file")

# Prepare and sync the complete next state before touching the remote host.
jq -n \
  --argjson sv 1 \
  --argjson gen "$new_gen" \
  --slurpfile current "$manifest_native" \
  --argjson previous "$previous_json" \
  --arg updated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{
    schemaVersion: $sv,
    generation: $gen,
    current: $current[0],
    previous: $previous,
    updatedAt: $updated
  }' > "$tmp_state"
if ! validate_state_file "$tmp_state" prospective; then
  log "generated deployment state failed validation"
  exit 67
fi
sync "$tmp_state"

# Preserve an audit copy after strict validation, without reusing a timestamped path.
backup_dir=$(mktemp -d "${DEPLOY_METADATA_DIR}/backup-$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
if $state_exists; then
  cp "$DEPLOY_STATE_FILE" "$backup_dir/state.json"
fi

release_commit=$(bash "$RELEASE_MANIFEST_SCRIPT" get-commit "$manifest_file")
log "deploying release commit=${release_commit}"
log "web=${web_ref} worker=${worker_ref} migrator=${migrator_ref}"

log "preflight application target"
"${app_ssh[@]}" bash -s -- "$APP_COMPOSE_DIR" <<'REMOTE'
set -euo pipefail
compose_dir=$1
cd "$compose_dir"
test -r app.env
test -r compose.app.yml
REMOTE

log "preflight database target"
"${data_ssh[@]}" bash -s -- "$DATA_COMPOSE_DIR" <<'REMOTE'
set -euo pipefail
compose_dir=$1
cd "$compose_dir"
test -r data.env
test -r compose.data.yml
REMOTE

log "pull application images on application target"
"${app_ssh[@]}" bash -s -- "$web_ref" "$worker_ref" <<'REMOTE'
set -euo pipefail
web_ref=$1; worker_ref=$2
docker pull "$web_ref"
docker pull "$worker_ref"
REMOTE

log "pull migrator image on database target"
"${data_ssh[@]}" bash -s -- "$migrator_ref" <<'REMOTE'
set -euo pipefail
migrator_ref=$1
docker pull "$migrator_ref"
REMOTE

log "run database migrations on database target"
"${data_ssh[@]}" bash -s -- "$migrator_ref" "$DATA_COMPOSE_DIR" <<'REMOTE'
set -euo pipefail
migrator_ref=$1; compose_dir=$2
cd "$compose_dir"
export MIGRATOR_IMAGE="$migrator_ref"
docker compose --env-file data.env -f compose.data.yml --profile migration run --rm migrator
REMOTE

restore_current() {
  if ! $state_exists; then
    log "no prior release exists; manual intervention required"
    return 1
  fi
  log "restoring and verifying the previously healthy current release"
  if ! DEPLOY_LOCK_FD=9 "$ROLLBACK_SCRIPT" --failed-deploy; then
    log "automatic rollback failed; manual intervention required"
    return 1
  fi
}

log "deploy application stack"
if ! "${app_ssh[@]}" bash -s -- "$web_ref" "$worker_ref" "$APP_COMPOSE_DIR" <<'REMOTE'
set -euo pipefail
web_ref=$1; worker_ref=$2; compose_dir=$3
cd "$compose_dir"
export WEB_IMAGE="$web_ref"
export PLATFORM_WORKER_IMAGE="$worker_ref"
docker compose --env-file app.env -f compose.app.yml up -d --no-build --wait --wait-timeout "$HEALTH_TIMEOUT_SECONDS"
REMOTE
then
  log "application stack apply failed or was only partially applied"
  restore_current || true
  exit 1
fi

if ! "$HEALTH_CHECK_SCRIPT"; then
  log "health checks failed"
  restore_current || true
  exit 1
fi

if ! mv -f "$tmp_state" "$DEPLOY_STATE_FILE"; then
  log "could not commit deployment state; restoring prior release"
  restore_current || true
  exit 1
fi
if ! sync "$state_dir"; then
  log "could not sync deployment state directory; recovering prior state and release"
  state_recovered=false
  if $state_exists; then
    recovery_state=$(mktemp "${state_dir}/.state-recovery.XXXXXX")
    cp "${work_dir}/original-state.json" "$recovery_state"
    if validate_state_file "$recovery_state" recovery \
      && sync "$recovery_state" \
      && mv -f "$recovery_state" "$DEPLOY_STATE_FILE" \
      && sync "$state_dir"; then
      state_recovered=true
    fi
  elif rm -f "$DEPLOY_STATE_FILE" && sync "$state_dir"; then
    state_recovered=true
  fi
  if ! $state_recovered; then
    log "could not recover prior deployment state; manual intervention required"
  fi
  restore_current || true
  exit 1
fi

log "deployment complete generation=${new_gen}"
