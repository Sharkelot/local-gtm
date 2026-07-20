#!/usr/bin/env bash
# Poll GitHub for the latest successful publish workflow run and its release manifest.
# Downloads the manifest, validates it, and triggers deployment if different from current.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
# shellcheck disable=SC1090
source "${DEPLOYMENT_ENV:-/etc/local-gtm/deployment.env}"

: "${GHCR_REPOSITORY:?set GHCR_REPOSITORY, e.g. owner/local-gtm}"
: "${GITHUB_REPOSITORY:?set GITHUB_REPOSITORY (owner/repo) for artifact download}"
: "${APPROVED_COMMIT_FILE:?set APPROVED_COMMIT_FILE}"
: "${CURRENT_RELEASE_FILE:?set CURRENT_RELEASE_FILE}"
: "${DEPLOY_SCRIPT:?set DEPLOY_SCRIPT}"
: "${POLL_LOCK_FILE:=/tmp/local-gtm-poller.lock}"
: "${GHCR_READ_TOKEN:=}"

log() {
  printf '[local-gtm-poller] %s\n' "$*" >&2
}

# Acquire poll lock — prevents concurrent poller invocations from racing
exec 8>"$POLL_LOCK_FILE"
if ! flock -n 8; then
  log "another poller is running; exiting"
  exit 75
fi

fetch_manifest_artifact() {
  local commit="$1"
  local artifact_name="release-manifest-${commit}"

  # GitHub API: find the artifact
  local api_url="https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/artifacts?name=${artifact_name}&per_page=1"
  local auth_header=""
  [ -n "$GHCR_READ_TOKEN" ] && auth_header="Authorization: Bearer ${GHCR_READ_TOKEN}"

  local download_url
  download_url=$(curl -fsSL ${auth_header:+-H "$auth_header"} "$api_url" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    artifacts = data.get('artifacts', [])
    if artifacts:
        print(artifacts[0]['archive_download_url'])
except Exception:
    sys.exit(1)
" 2>/dev/null || true)

  if [ -z "$download_url" ]; then
    log "no manifest artifact found for commit ${commit}"
    return 1
  fi

  # Download and extract manifest from zip
  local tmp_dir
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' RETURN

  curl -fsSL ${auth_header:+-H "$auth_header"} -o "${tmp_dir}/artifact.zip" "$download_url"
  unzip -q -o "${tmp_dir}/artifact.zip" -d "$tmp_dir" 2>/dev/null || true

  local manifest_file="${tmp_dir}/release-manifest.json"
  if [ ! -f "$manifest_file" ]; then
    log "manifest not found in artifact archive for commit ${commit}"
    return 1
  fi

  # Copy to a stable location with atomic write (temp + mv)
  local dest="${tmp_dir}/../release-manifest-${commit}.json"
  local tmp_dest
  tmp_dest=$(mktemp "${dest}.XXXXXX")
  cp "$manifest_file" "$tmp_dest"
  mv -f "$tmp_dest" "$dest"

  echo "$dest"
}

# Read approved commit
if [ ! -f "$APPROVED_COMMIT_FILE" ]; then
  log "no approved commit file at ${APPROVED_COMMIT_FILE}; exiting"
  exit 0
fi
approved_commit=$(tr -d '[:space:]' < "$APPROVED_COMMIT_FILE")

if [ -z "$approved_commit" ]; then
  log "approved commit is empty; exiting"
  exit 0
fi

# Validate commit format before proceeding
if ! [[ "$approved_commit" =~ ^[a-f0-9]{7,40}$ ]]; then
  log "invalid approved commit format: ${approved_commit}"
  exit 1
fi

manifest_path=$(fetch_manifest_artifact "$approved_commit") || {
  log "could not fetch manifest for approved commit ${approved_commit}"
  exit 1
}

if [ ! -f "$manifest_path" ]; then
  log "manifest file missing after fetch: ${manifest_path}"
  exit 1
fi

# Validate
if ! bash "${SCRIPT_DIR}/release-manifest.sh" validate "$manifest_path"; then
  log "invalid manifest for commit ${approved_commit}"
  exit 67
fi

# Check if already deployed (atomic read — file is small, single cp is safe)
if [ -f "$CURRENT_RELEASE_FILE" ]; then
  current_commit=$(bash "${SCRIPT_DIR}/release-manifest.sh" get-commit "$CURRENT_RELEASE_FILE" 2>/dev/null || echo "")
  if [ "$approved_commit" = "$current_commit" ]; then
    log "already deployed commit ${approved_commit}; exiting"
    exit 0
  fi
fi

log "deploying commit ${approved_commit}"
exec "$DEPLOY_SCRIPT" "$manifest_path"
