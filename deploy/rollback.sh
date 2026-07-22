#!/usr/bin/env bash
# Restore a release from atomic deployment state without deleting data volumes.
# Manual mode swaps current/previous after health passes. --failed-deploy restores
# state.current while deploy.sh already holds the deployment lock and leaves state unchanged.
set -euo pipefail

mode=manual
if [ "$#" -gt 1 ]; then
  echo "usage: $0 [--failed-deploy]" >&2
  exit 64
fi
if [ "$#" -eq 1 ]; then
  if [ "$1" != "--failed-deploy" ]; then
    echo "usage: $0 [--failed-deploy]" >&2
    exit 64
  fi
  mode=failed-deploy
fi

for cmd in flock jq ssh sync; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "error: '$cmd' is required but not found in PATH" >&2
    exit 70
  fi
done

# shellcheck disable=SC1090
source "${DEPLOYMENT_ENV:-/etc/local-gtm/deployment.env}"

: "${DEPLOY_STATE_FILE:?set DEPLOY_STATE_FILE (path to state.json)}"
: "${LOCK_FILE:?set LOCK_FILE}"
: "${DEPLOY_USER:?set DEPLOY_USER}"
: "${APP_HOST:?set APP_HOST}"
: "${SSH_IDENTITY_FILE:?set SSH_IDENTITY_FILE}"
: "${SSH_KNOWN_HOSTS_FILE:?set SSH_KNOWN_HOSTS_FILE}"
: "${APP_COMPOSE_DIR:?set APP_COMPOSE_DIR}"
: "${APP_ENV_FILE:?set APP_ENV_FILE}"
: "${HEALTH_CHECK_SCRIPT:?set HEALTH_CHECK_SCRIPT}"

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

if [ "$APP_ENV_FILE" != "${APP_COMPOSE_DIR%/}/app.env" ]; then
  echo "error: APP_ENV_FILE must be APP_COMPOSE_DIR/app.env" >&2
  exit 78
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RELEASE_MANIFEST_SCRIPT="${SCRIPT_DIR}/release-manifest.sh"
MAX_STATE_GENERATION=9007199254740991

log() {
  printf '[local-gtm-rollback] %s\n' "$*" >&2
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
if [ ! -x "$HEALTH_CHECK_SCRIPT" ]; then
  log "health-check script must be executable"
  exit 66
fi

# Manual rollback acquires the deployment lock itself. Failed-deploy mode is
# internal: deploy.sh passes its inherited locked descriptor to avoid deadlock.
if [ "$mode" = manual ]; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    log "another deployment is in progress"
    exit 75
  fi
else
  lock_fd=${DEPLOY_LOCK_FD:-}
  if [[ ! "$lock_fd" =~ ^[0-9]+$ ]] || [ "$lock_fd" -lt 3 ] \
    || ! { : >&"$lock_fd"; } 2>/dev/null; then
    log "failed-deploy mode requires an inherited deployment lock descriptor"
    exit 77
  fi
  # Prove the FD actually points to our lock file, not a random writable descriptor.
  if [ -L "/proc/self/fd/$lock_fd" ]; then
    fd_target=$(readlink -f "/proc/self/fd/$lock_fd")
    lock_real=$(readlink -f "$LOCK_FILE")
    if [ "$fd_target" != "$lock_real" ]; then
      log "failed-deploy FD does not point to the deployment lock file"
      exit 77
    fi
  fi
  if flock -n "$lock_fd" -c true >/dev/null 2>&1; then
    log "failed-deploy mode requires the caller to already hold the deployment lock"
    exit 77
  fi
fi

if [ ! -s "$DEPLOY_STATE_FILE" ]; then
  log "deployment state is missing; manual intervention required"
  exit 66
fi

state_dir=$(dirname "$DEPLOY_STATE_FILE")
if [ ! -d "$state_dir" ] || [ ! -w "$state_dir" ]; then
  log "deployment state directory must be writable"
  exit 73
fi
work_dir=$(mktemp -d "${state_dir}/.rollback-preflight.XXXXXX")
trap 'rm -rf "$work_dir"' EXIT
state_native=$(to_native_path "$DEPLOY_STATE_FILE")

if ! validate_state_file "$DEPLOY_STATE_FILE" existing; then
  log "deployment state is invalid; refusing remote mutation"
  exit 67
fi
cp "$DEPLOY_STATE_FILE" "${work_dir}/original-state.json"
cp "${work_dir}/existing-current.json" "${work_dir}/current.json"

if [ "$mode" = manual ]; then
  if jq -e '.previous == null' "$state_native" >/dev/null; then
    log "no previous release exists; manual intervention required"
    exit 66
  fi
  jq '.previous' "$state_native" > "${work_dir}/target.json"
else
  cp "${work_dir}/current.json" "${work_dir}/target.json"
fi

if ! bash "$RELEASE_MANIFEST_SCRIPT" validate "${work_dir}/target.json" >/dev/null; then
  log "rollback target release is invalid"
  exit 67
fi

# Prepare and sync the manual state swap before changing the remote stack.
tmp_state="${work_dir}/state.json"
if [ "$mode" = manual ]; then
  old_gen=$(jq -r '.generation' "$state_native")
  if [ "$old_gen" -ge "$MAX_STATE_GENERATION" ]; then
    log "deployment state generation is exhausted; refusing remote mutation"
    exit 67
  fi
  new_gen=$((old_gen + 1))
  target_native=$(to_native_path "${work_dir}/target.json")
  current_json=$(jq -c '.current' "$state_native")
  jq -n \
    --argjson sv 1 \
    --argjson gen "$new_gen" \
    --slurpfile current "$target_native" \
    --argjson previous "$current_json" \
    --arg updated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{
      schemaVersion: $sv,
      generation: $gen,
      current: $current[0],
      previous: $previous,
      updatedAt: $updated
    }' > "$tmp_state"
  if ! validate_state_file "$tmp_state" prospective; then
    log "generated rollback state failed validation"
    exit 67
  fi
  sync "$tmp_state"
fi

ssh_base=(
  ssh
  -i "$SSH_IDENTITY_FILE"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile="$SSH_KNOWN_HOSTS_FILE"
  "${DEPLOY_USER}@${APP_HOST}"
)

apply_stack() {
  local manifest="$1" web_ref worker_ref
  web_ref=$(bash "$RELEASE_MANIFEST_SCRIPT" resolve "$manifest" web)
  worker_ref=$(bash "$RELEASE_MANIFEST_SCRIPT" resolve "$manifest" platformWorker)
  "${ssh_base[@]}" bash -s -- "$web_ref" "$worker_ref" "$APP_COMPOSE_DIR" <<'REMOTE'
set -euo pipefail
web_ref=$1; worker_ref=$2; compose_dir=$3
cd "$compose_dir"
export WEB_IMAGE="$web_ref"
export PLATFORM_WORKER_IMAGE="$worker_ref"
docker compose --env-file app.env -f compose.app.yml up -d --no-build --wait --wait-timeout "$HEALTH_TIMEOUT_SECONDS"
REMOTE
}

restore_original_current() {
  log "re-applying and verifying the original current release"
  if ! apply_stack "${work_dir}/current.json"; then
    log "could not re-apply original current release; manual intervention required"
    return 1
  fi
  if ! "$HEALTH_CHECK_SCRIPT"; then
    log "original current release failed health checks; manual intervention required"
    return 1
  fi
}

recover_original_state() {
  local recovery_state
  recovery_state=$(mktemp "${state_dir}/.rollback-state-recovery.XXXXXX")
  cp "${work_dir}/original-state.json" "$recovery_state"
  validate_state_file "$recovery_state" recovery \
    && sync "$recovery_state" \
    && mv -f "$recovery_state" "$DEPLOY_STATE_FILE" \
    && sync "$state_dir"
}

if ! apply_stack "${work_dir}/target.json"; then
  log "rollback target apply failed; deployment state was not changed"
  if [ "$mode" = manual ]; then
    restore_original_current || true
  fi
  exit 1
fi

if ! "$HEALTH_CHECK_SCRIPT"; then
  log "restored stack failed health checks; deployment state was not changed"
  if [ "$mode" = manual ]; then
    restore_original_current || true
  fi
  exit 1
fi

if [ "$mode" = manual ]; then
  if ! mv -f "$tmp_state" "$DEPLOY_STATE_FILE"; then
    log "could not publish rollback state; restoring original current release"
    restore_original_current || true
    exit 1
  fi
  if ! sync "$state_dir"; then
    log "could not sync rollback state directory; recovering prior state and release"
    if ! recover_original_state; then
      log "could not recover prior deployment state; manual intervention required"
    fi
    restore_original_current || true
    exit 1
  fi
fi

restored_commit=$(bash "$RELEASE_MANIFEST_SCRIPT" get-commit "${work_dir}/target.json")
log "restored healthy release commit=${restored_commit}"
