#!/usr/bin/env bash
# Poll GHCR for the newest approved main-branch image digest.
# Copy to the deployment CT and configure via /etc/local-gtm/deployment.env.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "${DEPLOYMENT_ENV:-/etc/local-gtm/deployment.env}"

: "${GHCR_REGISTRY:?set GHCR_REGISTRY, e.g. ghcr.io}"
: "${GHCR_REPOSITORY:?set GHCR_REPOSITORY, e.g. owner/local-gtm}"
: "${IMAGE_NAME:?set IMAGE_NAME, e.g. web}"
: "${APPROVED_DIGEST_FILE:?set APPROVED_DIGEST_FILE}"
: "${CURRENT_DIGEST_FILE:?set CURRENT_DIGEST_FILE}"
: "${DEPLOY_SCRIPT:?set DEPLOY_SCRIPT}"

log() {
  printf '[local-gtm-poller] %s\n' "$*" >&2
}

resolve_main_digest() {
  local token=""
  if [ -n "${GHCR_READ_TOKEN:-}" ]; then
    token=$(printf 'Bearer %s' "$GHCR_READ_TOKEN")
  fi

  local manifest_url="https://${GHCR_REGISTRY}/v2/${GHCR_REPOSITORY}/${IMAGE_NAME}/manifests/main"
  local digest
  digest=$(
    curl -fsSL \
      ${token:+-H "Authorization: $token"} \
      -H 'Accept: application/vnd.docker.distribution.manifest.v2+json' \
      -I "$manifest_url" |
      awk -F': ' 'tolower($1)=="docker-content-digest"{print $2; exit}' |
      tr -d '\r'
  )

  if [ -z "$digest" ]; then
    log "unable to resolve digest for ${GHCR_REPOSITORY}/${IMAGE_NAME}:main"
    return 1
  fi
  printf '%s\n' "$digest"
}

approved_digest=$(tr -d '[:space:]' < "$APPROVED_DIGEST_FILE")
current_digest=""
if [ -f "$CURRENT_DIGEST_FILE" ]; then
  current_digest=$(tr -d '[:space:]' < "$CURRENT_DIGEST_FILE")
fi

candidate_digest=$(resolve_main_digest)

if [ "$candidate_digest" != "$approved_digest" ]; then
  log "candidate digest is not on the approved list; exiting"
  exit 0
fi

if [ "$candidate_digest" = "$current_digest" ]; then
  log "already deployed digest ${candidate_digest}; exiting"
  exit 0
fi

exec "$DEPLOY_SCRIPT" "$candidate_digest"
