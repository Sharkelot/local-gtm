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
  local api_url="https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/artifacts?name=${artifact_name}&per_page=100"
  local auth_header=""
  [ -n "$GHCR_READ_TOKEN" ] && auth_header="Authorization: Bearer ${GHCR...KEN}"

  local artifacts_json candidates run_id run_url download_url=""
  artifacts_json=$(curl -fsSL ${auth_header:+-H "$auth_header"} "$api_url") || return 1
  candidates=$(printf '%s' "$artifacts_json" | python3 -c '
import json, sys
commit, name = sys.argv[1:]
for artifact in json.load(sys.stdin).get("artifacts", []):
    run = artifact.get("workflow_run") or {}
    if (artifact.get("name") == name and not artifact.get("expired")
            and run.get("head_sha") == commit and run.get("id")
            and artifact.get("archive_download_url")):
        print("{}\t{}".format(run["id"], artifact["archive_download_url"]))
' "$commit" "$artifact_name" 2>/dev/null) || return 1

  while IFS=$'\t' read -r run_id candidate_url; do
    [ -n "$run_id" ] || continue
    run_url="https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/runs/${run_id}"
    if curl -fsSL ${auth_header:+-H "$auth_header"} "$run_url" | python3 -c '
import json, sys
run = json.load(sys.stdin)
expected_id, commit, repository = sys.argv[1:]
sys.exit(0 if run.get("id") == int(expected_id)
    and run.get("name") == "Publish images"
    and run.get("path") == ".github/workflows/publish.yml"
    and run.get("event") == "workflow_run"
    and run.get("status") == "completed"
    and run.get("conclusion") == "success"
    and run.get("head_branch") == "main"
    and run.get("head_sha") == commit
    and (run.get("repository") or {}).get("full_name") == repository else 1)
' "$run_id" "$commit" "$GITHUB_REPOSITORY" 2>/dev/null; then
      download_url=$candidate_url
      break
    fi
  done <<< "$candidates"

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
  local dest
  dest="$(dirname "$tmp_dir")/release-manifest-${commit}.json"
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
manifest_commit=$(bash "${SCRIPT_DIR}/release-manifest.sh" get-commit "$manifest_path") || exit 67
if [ "$manifest_commit" != "$approved_commit" ]; then
  log "manifest commit does not match approved commit ${approved_commit}"
  exit 67
fi

if [ -n "${DEPLOY_STATE_FILE:-}" ] && [ -e "$DEPLOY_STATE_FILE" ] \
  && ! jq -e 'type == "object" and .schemaVersion == 1' "$DEPLOY_STATE_FILE" >/dev/null 2>&1; then
  log "deployment state is corrupt; refusing to trigger deployment"
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
