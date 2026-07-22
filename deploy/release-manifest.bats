#!/usr/bin/env bash
# BATS tests for release-manifest.sh, deploy.sh, poller.sh
# Run: bats deploy/release-manifest.bats
# Requires: bats, jq

# BATS copies the .bats file to a temp dir — use $BATS_TEST_FILENAME for original path.
REPO_ROOT="$(cd "$(dirname "${BATS_TEST_FILENAME}")/.." && pwd)"
MANIFEST_SH="${REPO_ROOT}/deploy/release-manifest.sh"

# jq on Windows can't read MSYS /tmp paths — use python3 for /tmp reads
_jq() {
  local file="$1"; shift
  if [[ "$file" == /tmp/* ]]; then
    python3 -c "import json,sys; print(json.load(open(sys.argv[1]))$*)" "$file"
  else
    jq "$@" "$file"
  fi
}

setup() {
  TEST_DIR=$(mktemp -d)
  MANIFEST_FILE="${TEST_DIR}/manifest.json"
  export EXPECTED_WEB_REPOSITORY="ghcr.io/owner/local-gtm/web"
  export EXPECTED_PLATFORM_WORKER_REPOSITORY="ghcr.io/owner/local-gtm/platform-worker"
  export EXPECTED_MIGRATOR_REPOSITORY="ghcr.io/owner/local-gtm/migrator"
}

teardown() {
  rm -rf "$TEST_DIR"
}

# ============================================================
# Valid manifest generation and validation
# ============================================================

@test "generate produces valid JSON with correct schema version" {
  bash "$MANIFEST_SH" generate \
    abcdef1234567890abcdef1234567890abcdef12 \
    ghcr.io/owner/local-gtm/web \
    sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    ghcr.io/owner/local-gtm/platform-worker \
    sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
    ghcr.io/owner/local-gtm/migrator \
    sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc \
    > "$MANIFEST_FILE"

  bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  sv=$(cat "$MANIFEST_FILE" | jq '.schemaVersion')
  [ "$sv" = "1" ]
}

@test "validate accepts a well-formed manifest" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": {
      "repository": "ghcr.io/owner/local-gtm/web",
      "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    "platformWorker": {
      "repository": "ghcr.io/owner/local-gtm/platform-worker",
      "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    },
    "migrator": {
      "repository": "ghcr.io/owner/local-gtm/migrator",
      "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    }
  }
}
EOF
  bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
}

@test "resolve returns correct image reference for web" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": {
      "repository": "ghcr.io/owner/local-gtm/web",
      "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    "platformWorker": {
      "repository": "ghcr.io/owner/local-gtm/platform-worker",
      "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    },
    "migrator": {
      "repository": "ghcr.io/owner/local-gtm/migrator",
      "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    }
  }
}
EOF
  result=$(bash "$MANIFEST_SH" resolve "$MANIFEST_FILE" web)
  [ "$result" = "ghcr.io/owner/local-gtm/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ]
}

@test "resolve returns correct image reference for platformWorker" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  result=$(bash "$MANIFEST_SH" resolve "$MANIFEST_FILE" platformWorker)
  [ "$result" = "ghcr.io/owner/local-gtm/platform-worker@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" ]
}

@test "resolve returns correct image reference for migrator" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  result=$(bash "$MANIFEST_SH" resolve "$MANIFEST_FILE" migrator)
  [ "$result" = "ghcr.io/owner/local-gtm/migrator@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" ]
}

@test "get-commit returns the commit SHA" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  result=$(bash "$MANIFEST_SH" get-commit "$MANIFEST_FILE")
  [ "$result" = "abcdef1234567890" ]
}

# ============================================================
# Malformed JSON rejection
# ============================================================

@test "validate rejects malformed JSON" {
  echo '{not valid json' > "$MANIFEST_FILE"
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

@test "validate rejects empty file" {
  : > "$MANIFEST_FILE"
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

@test "validate rejects truncated JSON" {
  echo '{"schemaVersion": 1, "commit":' > "$MANIFEST_FILE"
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

# ============================================================
# Missing image rejection
# ============================================================

@test "validate rejects manifest missing web image" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

@test "validate rejects manifest missing platformWorker image" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

@test "validate rejects manifest missing migrator image" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

# ============================================================
# Malformed digest rejection
# ============================================================

@test "validate rejects uppercase hex in digest" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

@test "validate rejects short digest (too few hex chars)" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:abcdef1234" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

@test "validate rejects missing sha256 prefix" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

@test "validate rejects wrong algorithm prefix (md5)" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "md5:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

# ============================================================
# Hostile repository string rejection
# ============================================================

@test "validate rejects repository with path traversal" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/../etc/passwd", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

@test "validate rejects repository with shell metacharacters" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web;rm -rf /", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

@test "validate rejects repository with spaces" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local gtm/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

@test "validate rejects repository without slash (no registry)" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "local-gtm-web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

@test "validate rejects repository with backticks" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/\`whoami\`/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

# ============================================================
# Hostile commit/timestamp string rejection
# ============================================================

@test "validate rejects hostile commit with shell injection" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abc;rm -rf /",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

@test "validate rejects short commit (less than 7 chars)" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abc",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

@test "validate rejects commit with non-hex characters" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "ghijklmnop",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

@test "validate rejects invalid timestamp format" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "January 15, 2025",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

# ============================================================
# Schema version rejection
# ============================================================

@test "validate rejects unknown schema version" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 99,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

# ============================================================
# Equal digests accepted when repositories are independently specified
# ============================================================

@test "validate accepts equal digests with different repositories" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
  }
}
EOF
  bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
}

# ============================================================
# Repository allowlist enforcement
# ============================================================

@test "validate rejects repository not in allowlist" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "evil.io/attacker/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  EXPECTED_WEB_REPOSITORY="ghcr.io/owner/local-gtm/web" run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

@test "validate accepts repository matching allowlist" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  EXPECTED_WEB_REPOSITORY="ghcr.io/owner/local-gtm/web" \
  EXPECTED_PLATFORM_WORKER_REPOSITORY="ghcr.io/owner/local-gtm/platform-worker" \
  EXPECTED_MIGRATOR_REPOSITORY="ghcr.io/owner/local-gtm/migrator" \
  bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
}

@test "validate fails closed when repository allowlist is not fully configured" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run env -u EXPECTED_MIGRATOR_REPOSITORY bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

@test "config example declares every required repository allowlist entry" {
  config=$(cat "${REPO_ROOT}/deploy/config.example")
  [[ "$config" == *"EXPECTED_WEB_REPOSITORY="* ]]
  [[ "$config" == *"EXPECTED_PLATFORM_WORKER_REPOSITORY="* ]]
  [[ "$config" == *"EXPECTED_MIGRATOR_REPOSITORY="* ]]
}

# ============================================================
# Abbreviated commit rejection
# ============================================================

@test "validate rejects abbreviated 7-character commit" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

@test "generate rejects abbreviated commit" {
  run bash "$MANIFEST_SH" generate \
    abc1234 \
    ghcr.io/owner/local-gtm/web \
    sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    ghcr.io/owner/local-gtm/platform-worker \
    sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
    ghcr.io/owner/local-gtm/migrator \
    sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
  [ "$status" -ne 0 ]
}

# ============================================================
# Repository lowercase enforcement
# ============================================================

@test "validate rejects uppercase repository" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/Owner/Local-GTM/Web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

# ============================================================
# Generate-specific tests
# ============================================================

@test "generate accepts equal digests with different repositories" {
  bash "$MANIFEST_SH" generate \
    abcdef1234567890abcdef1234567890abcdef12 \
    ghcr.io/owner/local-gtm/web \
    sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    ghcr.io/owner/local-gtm/platform-worker \
    sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    ghcr.io/owner/local-gtm/migrator \
    sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    > "$MANIFEST_FILE"

  bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
}

@test "generate rejects invalid digest format" {
  run bash "$MANIFEST_SH" generate \
    abcdef1234567890abcdef1234567890abcdef12 \
    ghcr.io/owner/local-gtm/web \
    "not-a-digest" \
    ghcr.io/owner/local-gtm/platform-worker \
    sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
    ghcr.io/owner/local-gtm/migrator \
    sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
  [ "$status" -ne 0 ]
}

@test "generate rejects invalid commit format" {
  run bash "$MANIFEST_SH" generate \
    "not-a-sha" \
    ghcr.io/owner/local-gtm/web \
    sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    ghcr.io/owner/local-gtm/platform-worker \
    sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
    ghcr.io/owner/local-gtm/migrator \
    sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
  [ "$status" -ne 0 ]
}

@test "generate rejects invalid repository name" {
  run bash "$MANIFEST_SH" generate \
    abcdef1234567890abcdef1234567890abcdef12 \
    "../etc/passwd" \
    sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    ghcr.io/owner/local-gtm/platform-worker \
    sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
    ghcr.io/owner/local-gtm/migrator \
    sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
  [ "$status" -ne 0 ]
}

@test "generate output is valid JSON parseable by jq" {
  bash "$MANIFEST_SH" generate \
    abcdef1234567890abcdef1234567890abcdef12 \
    ghcr.io/owner/local-gtm/web \
    sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    ghcr.io/owner/local-gtm/platform-worker \
    sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
    ghcr.io/owner/local-gtm/migrator \
    sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc \
    | jq . >/dev/null
}

# ============================================================
# File not found
# ============================================================

@test "validate rejects non-existent file" {
  run bash "$MANIFEST_SH" validate "/nonexistent/path/manifest.json"
  [ "$status" -ne 0 ]
}

@test "resolve rejects non-existent file" {
  run bash "$MANIFEST_SH" resolve "/nonexistent/path/manifest.json" web
  [ "$status" -ne 0 ]
}

# ============================================================
# Invalid image key rejection
# ============================================================

@test "resolve rejects invalid image key" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" resolve "$MANIFEST_FILE" "nonexistent"
  [ "$status" -ne 0 ]
}

@test "resolve rejects image key with injection attempt" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1234567890abcdef1234567890abcdef12",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" resolve "$MANIFEST_FILE" 'web;rm -rf /'
  [ "$status" -ne 0 ]
}

# ============================================================
# Poller artifact provenance and commit binding
# ============================================================

write_manifest_for_commit() {
  local commit="$1"
  bash "$MANIFEST_SH" generate \
    "$commit" \
    "$EXPECTED_WEB_REPOSITORY" \
    sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    "$EXPECTED_PLATFORM_WORKER_REPOSITORY" \
    sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
    "$EXPECTED_MIGRATOR_REPOSITORY" \
    sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc \
    > "$MANIFEST_FILE"
}

setup_poller_mocks() {
  local approved_commit="$1"
  MOCK_BIN="${TEST_DIR}/bin"
  mkdir -p "$MOCK_BIN"
  export MOCK_ARTIFACTS_JSON="${TEST_DIR}/artifacts.json"
  export MOCK_RUNS_DIR="${TEST_DIR}/runs"
  export MOCK_MANIFEST="$MANIFEST_FILE"
  export MOCK_SELECTED_FILE="${TEST_DIR}/selected-url"
  export DEPLOY_MARKER="${TEST_DIR}/deployed"
  mkdir -p "$MOCK_RUNS_DIR"

  cat > "${MOCK_BIN}/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
output=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output=$2; shift 2 ;;
    -H) shift 2 ;;
    -*) shift ;;
    *) url=$1; shift ;;
  esac
done
case "$url" in
  */actions/artifacts\?*) cat "$MOCK_ARTIFACTS_JSON" ;;
  */actions/runs/*) cat "$MOCK_RUNS_DIR/${url##*/}.json" ;;
  https://download.example/*)
    printf '%s\n' "$url" > "$output"
    ;;
  *) exit 22 ;;
esac
EOF

  cat > "${MOCK_BIN}/unzip" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
archive=""
dest=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -d) dest=$2; shift 2 ;;
    -*) shift ;;
    release-manifest.json) shift ;;
    *) archive=$1; shift ;;
  esac
done
cp "$archive" "$MOCK_SELECTED_FILE"
cp "$MOCK_MANIFEST" "$dest/release-manifest.json"
EOF

  cat > "${MOCK_BIN}/python3" <<'EOF'
#!/usr/bin/env bash
exec python "$@"
EOF

  cat > "${MOCK_BIN}/flock" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  cat > "${MOCK_BIN}/deploy" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
test -f "$1"
: > "$DEPLOY_MARKER"
EOF
  chmod +x "$MOCK_BIN"/*

  printf '%s\n' "$approved_commit" > "${TEST_DIR}/approved-commit"
  cat > "${TEST_DIR}/deployment.env" <<EOF
GHCR_REPOSITORY=owner/local-gtm
GITHUB_REPOSITORY=owner/local-gtm
APPROVED_COMMIT_FILE=${TEST_DIR}/approved-commit
DEPLOY_STATE_FILE=${TEST_DIR}/state.json
DEPLOY_SCRIPT=${MOCK_BIN}/deploy
POLL_LOCK_FILE=${TEST_DIR}/poll.lock
GHCR_READ_TOKEN=
EXPECTED_WEB_REPOSITORY=${EXPECTED_WEB_REPOSITORY}
EXPECTED_PLATFORM_WORKER_REPOSITORY=${EXPECTED_PLATFORM_WORKER_REPOSITORY}
EXPECTED_MIGRATOR_REPOSITORY=${EXPECTED_MIGRATOR_REPOSITORY}
EOF
  export DEPLOYMENT_ENV="${TEST_DIR}/deployment.env"
  export PATH="${MOCK_BIN}:$PATH"
}

write_publish_run() {
  local id="$1" commit="$2" path="${3:-.github/workflows/publish.yml}" conclusion="${4:-success}"
  cat > "$MOCK_RUNS_DIR/${id}.json" <<EOF
{"id":${id},"name":"Publish images","path":"${path}","event":"workflow_run","status":"completed","conclusion":"${conclusion}","head_branch":"main","head_sha":"${commit}","repository":{"full_name":"owner/local-gtm"}}
EOF
}

@test "poller skips an untrusted first name match and selects a proven publish artifact" {
  commit=1111111111111111111111111111111111111111
  write_manifest_for_commit "$commit"
  setup_poller_mocks "$commit"
  cat > "$MOCK_ARTIFACTS_JSON" <<EOF
{"artifacts":[
  {"id":1,"name":"release-manifest-${commit}","expired":false,"created_at":"2026-01-01T00:00:00Z","archive_download_url":"https://download.example/untrusted","workflow_run":{"id":100,"head_sha":"${commit}"}},
  {"id":2,"name":"release-manifest-${commit}","expired":false,"created_at":"2026-01-02T00:00:00Z","archive_download_url":"https://download.example/trusted","workflow_run":{"id":101,"head_sha":"${commit}"}}
]}
EOF
  write_publish_run 100 "$commit" .github/workflows/not-publish.yml success
  write_publish_run 101 "$commit"

  bash "${REPO_ROOT}/deploy/poller.sh"

  [ -f "$DEPLOY_MARKER" ]
  [ "$(cat "$MOCK_SELECTED_FILE")" = "https://download.example/trusted" ]
}

@test "poller rejects an artifact without successful publish workflow provenance" {
  commit=2222222222222222222222222222222222222222
  write_manifest_for_commit "$commit"
  setup_poller_mocks "$commit"
  cat > "$MOCK_ARTIFACTS_JSON" <<EOF
{"artifacts":[{"id":3,"name":"release-manifest-${commit}","expired":false,"created_at":"2026-01-01T00:00:00Z","archive_download_url":"https://download.example/failed","workflow_run":{"id":102,"head_sha":"${commit}"}}]}
EOF
  write_publish_run 102 "$commit" .github/workflows/publish.yml failure

  run bash "${REPO_ROOT}/deploy/poller.sh"

  [ "$status" -ne 0 ]
  [ ! -e "$DEPLOY_MARKER" ]
}

@test "poller rejects a valid manifest whose commit differs from the approval" {
  approved=3333333333333333333333333333333333333333
  artifact_commit=4444444444444444444444444444444444444444
  write_manifest_for_commit "$artifact_commit"
  setup_poller_mocks "$approved"
  cat > "$MOCK_ARTIFACTS_JSON" <<EOF
{"artifacts":[{"id":4,"name":"release-manifest-${approved}","expired":false,"created_at":"2026-01-01T00:00:00Z","archive_download_url":"https://download.example/mismatch","workflow_run":{"id":103,"head_sha":"${approved}"}}]}
EOF
  write_publish_run 103 "$approved"

  run bash "${REPO_ROOT}/deploy/poller.sh"

  [ "$status" -ne 0 ]
  [ ! -e "$DEPLOY_MARKER" ]
}

@test "poller rejects corrupt deployment state instead of treating it as not deployed" {
  commit=4545454545454545454545454545454545454545
  write_manifest_for_commit "$commit"
  setup_poller_mocks "$commit"
  cat > "$MOCK_ARTIFACTS_JSON" <<EOF
{"artifacts":[{"id":5,"name":"release-manifest-${commit}","expired":false,"created_at":"2026-01-01T00:00:00Z","archive_download_url":"https://download.example/corrupt-state","workflow_run":{"id":104,"head_sha":"${commit}"}}]}
EOF
  write_publish_run 104 "$commit"
  printf '%s\n' '{not-json' > "${TEST_DIR}/state.json"

  run bash "${REPO_ROOT}/deploy/poller.sh"

  [ "$status" -ne 0 ]
  [ ! -e "$DEPLOY_MARKER" ]
}

# ============================================================
# Protected environment parsing
# ============================================================

@test "render-proxmox-envs rejects shell syntax without executing it" {
  marker="${TEST_DIR}/unsafe-source-executed"
  legacy_env="${TEST_DIR}/legacy.env"
  token_file="${TEST_DIR}/cloudflare-token"
  printf 'touch %q\n' "$marker" > "$legacy_env"
  printf '%s\n' 'placeholder-token-that-is-at-least-thirty-two-characters' > "$token_file"

  run bash "${REPO_ROOT}/deploy/split/render-proxmox-envs.sh" \
    "$legacy_env" "$token_file" "${TEST_DIR}/output"

  [ "$status" -ne 0 ]
  [ ! -e "$marker" ]
}

# ============================================================
# Deployment state and rollback fail-closed behavior
# ============================================================

setup_deploy_mocks() {
  MOCK_BIN="${TEST_DIR}/deploy-bin"
  mkdir -p "$MOCK_BIN" "${TEST_DIR}/metadata"
  export SSH_MARKER="${TEST_DIR}/ssh-called"
  export SSH_CALL_LOG="${TEST_DIR}/ssh-calls.log"
  export ROLLBACK_ARGS="${TEST_DIR}/rollback-args"
  export HEALTH_MARKER="${TEST_DIR}/health-called"
  export HEALTH_COUNT_FILE="${TEST_DIR}/health-count"
  export SSH_COUNT_FILE="${TEST_DIR}/ssh-count"
  export SYNC_COUNT_FILE="${TEST_DIR}/sync-count"
  export HEALTH_RESULT="${HEALTH_RESULT:-0}"

  cat > "${MOCK_BIN}/ssh" <<'EOF'
#!/usr/bin/env bash
printf 'called\n' >> "$SSH_MARKER"
count=0
if [ -f "$SSH_COUNT_FILE" ]; then
  read -r count < "$SSH_COUNT_FILE"
fi
count=$((count + 1))
printf '%s\n' "$count" > "$SSH_COUNT_FILE"
printf 'ARGS=%s\n' "$*" >> "$SSH_CALL_LOG"
if [ -n "${SSH_RESULTS:-}" ]; then
  read -r -a results <<< "$SSH_RESULTS"
  index=$((count - 1))
  if [ "$index" -ge "${#results[@]}" ]; then
    index=$((${#results[@]} - 1))
  fi
  exit "${results[$index]}"
fi
exit "${SSH_RESULT:-0}"
EOF
  cat > "${MOCK_BIN}/flock" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  cat > "${MOCK_BIN}/sync" <<'EOF'
#!/usr/bin/env bash
count=0
if [ -f "$SYNC_COUNT_FILE" ]; then
  read -r count < "$SYNC_COUNT_FILE"
fi
count=$((count + 1))
printf '%s\n' "$count" > "$SYNC_COUNT_FILE"
if [ -n "${SYNC_RESULTS:-}" ]; then
  read -r -a results <<< "$SYNC_RESULTS"
  index=$((count - 1))
  if [ "$index" -ge "${#results[@]}" ]; then
    index=$((${#results[@]} - 1))
  fi
  exit "${results[$index]}"
fi
exit "${SYNC_RESULT:-0}"
EOF
  cat > "${MOCK_BIN}/health" <<'EOF'
#!/usr/bin/env bash
printf 'called\n' >> "$HEALTH_MARKER"
count=0
if [ -f "$HEALTH_COUNT_FILE" ]; then
  read -r count < "$HEALTH_COUNT_FILE"
fi
count=$((count + 1))
printf '%s\n' "$count" > "$HEALTH_COUNT_FILE"
if [ -n "${HEALTH_RESULTS:-}" ]; then
  read -r -a results <<< "$HEALTH_RESULTS"
  index=$((count - 1))
  if [ "$index" -ge "${#results[@]}" ]; then
    index=$((${#results[@]} - 1))
  fi
  exit "${results[$index]}"
fi
exit "$HEALTH_RESULT"
EOF
  cat > "${MOCK_BIN}/rollback" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$ROLLBACK_ARGS"
printf '%s\n' "${DEPLOY_LOCK_FD:-}" > "${ROLLBACK_ARGS}.lock-fd"
exit "${ROLLBACK_RESULT:-0}"
EOF
  chmod +x "$MOCK_BIN"/*
  : > "${TEST_DIR}/identity"
  : > "${TEST_DIR}/known-hosts"

  cat > "${TEST_DIR}/deploy.env" <<EOF
DEPLOY_USER=deployer
APP_HOST=app-host
DATABASE_HOST=data-host
SSH_IDENTITY_FILE=${TEST_DIR}/identity
SSH_KNOWN_HOSTS_FILE=${TEST_DIR}/known-hosts
LOCK_FILE=${TEST_DIR}/deploy.lock
DEPLOY_STATE_FILE=${TEST_DIR}/state.json
DEPLOY_METADATA_DIR=${TEST_DIR}/metadata
APP_COMPOSE_DIR=/opt/local-gtm/app
APP_ENV_FILE=/opt/local-gtm/app/app.env
DATA_COMPOSE_DIR=/opt/local-gtm/data
DATA_ENV_FILE=/opt/local-gtm/data/data.env
HEALTH_CHECK_SCRIPT=${MOCK_BIN}/health
ROLLBACK_SCRIPT=${MOCK_BIN}/rollback
EXPECTED_WEB_REPOSITORY=${EXPECTED_WEB_REPOSITORY}
EXPECTED_PLATFORM_WORKER_REPOSITORY=${EXPECTED_PLATFORM_WORKER_REPOSITORY}
EXPECTED_MIGRATOR_REPOSITORY=${EXPECTED_MIGRATOR_REPOSITORY}
CURRENT_RELEASE_FILE=${TEST_DIR}/stale-current.json
PREVIOUS_RELEASE_FILE=${TEST_DIR}/stale-previous.json
EOF
  export DEPLOYMENT_ENV="${TEST_DIR}/deploy.env"
  export PATH="${MOCK_BIN}:$PATH"
}

write_deployment_state() {
  local current_manifest="$1" previous_manifest="$2" state_file="$3" generation="${4:-1}"
  if command -v cygpath >/dev/null 2>&1; then
    current_manifest=$(cygpath -w "$current_manifest")
    previous_manifest=$(cygpath -w "$previous_manifest")
    state_file=$(cygpath -w "$state_file")
  fi
  python - "$current_manifest" "$previous_manifest" "$state_file" "$generation" <<'PY'
import json, sys
current_path, previous_path, state_path, generation = sys.argv[1:]
with open(current_path, encoding='utf-8') as f:
    current = json.load(f)
with open(previous_path, encoding='utf-8') as f:
    previous = json.load(f)
with open(state_path, 'w', encoding='utf-8') as f:
    json.dump({
        'schemaVersion': 1,
        'generation': int(generation),
        'current': current,
        'previous': previous,
        'updatedAt': '2026-01-01T00:00:00Z',
    }, f)
PY
}

json_commit() {
  local file="$1"
  if command -v cygpath >/dev/null 2>&1; then
    file=$(cygpath -w "$file")
  fi
  python - "$file" "$2" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as f:
    data = json.load(f)
value = data
for key in sys.argv[2].split('.'):
    value = value[key]
print(value)
PY
}

@test "deploy rejects corrupt existing state before any remote mutation" {
  commit=5555555555555555555555555555555555555555
  write_manifest_for_commit "$commit"
  setup_deploy_mocks
  printf '%s\n' '{not-json' > "${TEST_DIR}/state.json"

  run bash "${REPO_ROOT}/deploy/deploy.sh" "$MANIFEST_FILE"

  [ "$status" -ne 0 ]
  [ ! -e "$SSH_MARKER" ]
}

@test "deploy refuses remote mutation when prospective state cannot be synced" {
  commit=6666666666666666666666666666666666666666
  write_manifest_for_commit "$commit"
  setup_deploy_mocks
  export SYNC_RESULT=1

  run bash "${REPO_ROOT}/deploy/deploy.sh" "$MANIFEST_FILE"

  [ "$status" -ne 0 ]
  [ ! -e "$SSH_MARKER" ]
}

@test "deploy requests failed-deploy rollback mode after health failure" {
  commit=7777777777777777777777777777777777777777
  write_manifest_for_commit "$commit"
  setup_deploy_mocks
  export HEALTH_RESULT=1
  cp "$MANIFEST_FILE" "${TEST_DIR}/old-current.json"
  cp "$MANIFEST_FILE" "${TEST_DIR}/old-previous.json"
  write_deployment_state "${TEST_DIR}/old-current.json" "${TEST_DIR}/old-previous.json" "${TEST_DIR}/state.json"

  run bash "${REPO_ROOT}/deploy/deploy.sh" "$MANIFEST_FILE"

  [ "$status" -ne 0 ]
  [ "$(cat "$ROLLBACK_ARGS")" = "--failed-deploy" ]
}

@test "rollback atomically swaps current and previous state after a healthy restore" {
  new_commit=8888888888888888888888888888888888888888
  old_commit=9999999999999999999999999999999999999999
  write_manifest_for_commit "$new_commit"
  cp "$MANIFEST_FILE" "${TEST_DIR}/current.json"
  write_manifest_for_commit "$old_commit"
  cp "$MANIFEST_FILE" "${TEST_DIR}/previous.json"
  setup_deploy_mocks
  cp "${TEST_DIR}/previous.json" "${TEST_DIR}/stale-previous.json"
  cp "${TEST_DIR}/current.json" "${TEST_DIR}/stale-current.json"
  write_deployment_state "${TEST_DIR}/current.json" "${TEST_DIR}/previous.json" "${TEST_DIR}/state.json" 4

  bash "${REPO_ROOT}/deploy/rollback.sh"

  [ "$(json_commit "${TEST_DIR}/state.json" current.commit)" = "$old_commit" ]
  [ "$(json_commit "${TEST_DIR}/state.json" previous.commit)" = "$new_commit" ]
  [ "$(json_commit "${TEST_DIR}/state.json" generation)" = "5" ]
}

@test "rollback health failure restores current stack and leaves state unchanged" {
  new_commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  old_commit=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  write_manifest_for_commit "$new_commit"
  cp "$MANIFEST_FILE" "${TEST_DIR}/current.json"
  write_manifest_for_commit "$old_commit"
  cp "$MANIFEST_FILE" "${TEST_DIR}/previous.json"
  setup_deploy_mocks
  export HEALTH_RESULTS="1 0"
  cp "${TEST_DIR}/previous.json" "${TEST_DIR}/stale-previous.json"
  cp "${TEST_DIR}/current.json" "${TEST_DIR}/stale-current.json"
  write_deployment_state "${TEST_DIR}/current.json" "${TEST_DIR}/previous.json" "${TEST_DIR}/state.json" 2

  run bash "${REPO_ROOT}/deploy/rollback.sh"

  [ "$status" -ne 0 ]
  mapfile -t ssh_calls < "$SSH_MARKER"
  [ "${#ssh_calls[@]}" -eq 2 ]
  [ "$(json_commit "${TEST_DIR}/state.json" current.commit)" = "$new_commit" ]
  [ "$(json_commit "${TEST_DIR}/state.json" generation)" = "2" ]
}

# ============================================================
# Independent deployment-review blocker regressions
# ============================================================

write_protected_env() {
  local file="$1"
  cat > "$file" <<'EOF'
APP_DOMAIN=crm.example.test
HOOKS_DOMAIN=hooks.example.test
KEYCLOAK_DOMAIN=id.example.test
GRAFANA_DOMAIN=grafana.example.test
POSTGRES_DB=local_gtm
CRM_HOST=crm-host
DATABASE_HOST=db-host
DOCUMENT_HOST=document-host
IDENTITY_HOST=identity-host
KEYCLOAK_ADMIN_DOMAIN=id-admin.example.test
POSTGRES_BOOTSTRAP_USER=bootstrap
POSTGRES_BOOTSTRAP_PASSWORD=bootstrap-password
POSTGRES_MIGRATION_USER=migration
POSTGRES_MIGRATION_PASSWORD=migration-password
POSTGRES_RUNTIME_USER=runtime
POSTGRES_RUNTIME_PASSWORD=runtime-password
POSTGRES_PLATFORM_USER=platform
POSTGRES_PLATFORM_PASSWORD=platform-password
POSTGRES_REPORTING_USER=reporting
POSTGRES_REPORTING_PASSWORD=reporting-password
POSTGRES_KEYCLOAK_USER=keycloak
POSTGRES_KEYCLOAK_PASSWORD=keycloak-password
REDIS_PASSWORD=redis-password
KEYCLOAK_ADMIN=keycloak-admin
KEYCLOAK_ADMIN_PASSWORD=keycloak-admin-password
KEYCLOAK_CLIENT_ID=local-gtm
KEYCLOAK_CLIENT_SECRET=keycloak-client-secret
NEXTAUTH_SECRET=nextauth-secret
INFERENCE_WORKER_TOKEN=inference-token
INFERENCE_WORKER_ACTOR_ID=inference-worker
MINIO_ROOT_USER=minio-root
MINIO_ROOT_PASSWORD=minio-root-password
MINIO_DOCUMENT_BUCKET=documents
MINIO_DOCUMENT_RETENTION_DAYS=30
MINIO_SCANNER_ACCESS_KEY=scanner
MINIO_SCANNER_SECRET_KEY=scanner-secret
PRIVATE_ADMIN_CIDR=192.0.2.0/24
OPENBAO_TOKEN=openbao-protected-token
EOF
}

setup_render_inputs() {
  LEGACY_ENV="${TEST_DIR}/legacy.env"
  TOKEN_FILE="${TEST_DIR}/cloudflare-token"
  OUTPUT_DIR="${TEST_DIR}/rendered"
  RENDER_BIN="${TEST_DIR}/render-bin"
  mkdir -p "$RENDER_BIN"
  cat > "$RENDER_BIN/sync" <<'EOF'
#!/usr/bin/env bash
exit "${RENDER_SYNC_RESULT:-0}"
EOF
  chmod +x "$RENDER_BIN/sync"
  export PATH="$RENDER_BIN:$PATH"
  write_protected_env "$LEGACY_ENV"
  printf '%s\n' 'cloudflare-protected-token-with-adequate-length' > "$TOKEN_FILE"
}

replace_env_line() {
  local file="$1" key="$2" replacement="$3" native_file
  native_file="$file"
  if command -v cygpath >/dev/null 2>&1; then
    native_file=$(cygpath -w "$file")
  fi
  python - "$native_file" "$key" "$replacement" <<'PY'
import sys
path, key, replacement = sys.argv[1:]
with open(path, encoding='utf-8') as handle:
    lines = handle.read().splitlines()
with open(path, 'w', encoding='utf-8', newline='\n') as handle:
    for line in lines:
        handle.write((replacement if line.startswith(key + '=') else line) + '\n')
PY
}

remove_env_line() {
  local file="$1" key="$2" native_file
  native_file="$file"
  if command -v cygpath >/dev/null 2>&1; then
    native_file=$(cygpath -w "$file")
  fi
  python - "$native_file" "$key" <<'PY'
import sys
path, key = sys.argv[1:]
with open(path, encoding='utf-8') as handle:
    lines = handle.read().splitlines()
with open(path, 'w', encoding='utf-8', newline='\n') as handle:
    for line in lines:
        if not line.startswith(key + '='):
            handle.write(line + '\n')
PY
}

read_single_quoted_env_value() {
  local file="$1" key="$2" native_file
  native_file="$file"
  if command -v cygpath >/dev/null 2>&1; then
    native_file=$(cygpath -w "$file")
  fi
  python - "$native_file" "$key" <<'PY'
import sys
path, key = sys.argv[1:]
prefix = key + '='
with open(path, encoding='utf-8') as handle:
    line = next(line.rstrip('\n') for line in handle if line.startswith(prefix))
raw = line[len(prefix):]
assert len(raw) >= 2 and raw[0] == raw[-1] == "'", raw
body = raw[1:-1]
out = []
i = 0
while i < len(body):
    if body[i] == '\\':
        i += 1
        assert i < len(body) and body[i] in "\\'", body
    out.append(body[i])
    i += 1
print(''.join(out))
PY
}

@test "failed-deploy rollback rejects a direct caller without inherited lock ownership" {
  current_commit=1010101010101010101010101010101010101010
  previous_commit=2020202020202020202020202020202020202020
  write_manifest_for_commit "$current_commit"
  cp "$MANIFEST_FILE" "${TEST_DIR}/current.json"
  write_manifest_for_commit "$previous_commit"
  cp "$MANIFEST_FILE" "${TEST_DIR}/previous.json"
  setup_deploy_mocks
  write_deployment_state "${TEST_DIR}/current.json" "${TEST_DIR}/previous.json" "${TEST_DIR}/state.json"

  run env -u DEPLOY_LOCK_FD bash "${REPO_ROOT}/deploy/rollback.sh" --failed-deploy

  [ "$status" -ne 0 ]
  [ ! -e "$SSH_MARKER" ]
}

@test "deploy passes inherited lock ownership to failed-deploy rollback" {
  commit=3030303030303030303030303030303030303030
  write_manifest_for_commit "$commit"
  setup_deploy_mocks
  export HEALTH_RESULT=1
  cp "$MANIFEST_FILE" "${TEST_DIR}/current.json"
  cp "$MANIFEST_FILE" "${TEST_DIR}/previous.json"
  write_deployment_state "${TEST_DIR}/current.json" "${TEST_DIR}/previous.json" "${TEST_DIR}/state.json"

  run bash "${REPO_ROOT}/deploy/deploy.sh" "$MANIFEST_FILE"

  [ "$status" -ne 0 ]
  [ "$(cat "${ROLLBACK_ARGS}.lock-fd")" = "9" ]
}

@test "deploy restores current after a partial application apply failure" {
  commit=4040404040404040404040404040404040404040
  write_manifest_for_commit "$commit"
  setup_deploy_mocks
  export SSH_RESULTS="0 0 0 0 0 1"
  cp "$MANIFEST_FILE" "${TEST_DIR}/current.json"
  cp "$MANIFEST_FILE" "${TEST_DIR}/previous.json"
  write_deployment_state "${TEST_DIR}/current.json" "${TEST_DIR}/previous.json" "${TEST_DIR}/state.json"

  run bash "${REPO_ROOT}/deploy/deploy.sh" "$MANIFEST_FILE"

  [ "$status" -ne 0 ]
  [ "$(cat "$ROLLBACK_ARGS")" = "--failed-deploy" ]
  [ "$(cat "${ROLLBACK_ARGS}.lock-fd")" = "9" ]
}

@test "manual rollback re-applies and verifies current when target apply fails" {
  current_commit=5050505050505050505050505050505050505050
  previous_commit=6060606060606060606060606060606060606060
  write_manifest_for_commit "$current_commit"
  cp "$MANIFEST_FILE" "${TEST_DIR}/current.json"
  write_manifest_for_commit "$previous_commit"
  cp "$MANIFEST_FILE" "${TEST_DIR}/previous.json"
  setup_deploy_mocks
  export SSH_RESULTS="1 0"
  write_deployment_state "${TEST_DIR}/current.json" "${TEST_DIR}/previous.json" "${TEST_DIR}/state.json" 8

  run bash "${REPO_ROOT}/deploy/rollback.sh"

  [ "$status" -ne 0 ]
  [ "$(wc -l < "$SSH_MARKER")" -eq 2 ]
  [ "$(cat "$HEALTH_COUNT_FILE")" -eq 1 ]
  [ "$(json_commit "${TEST_DIR}/state.json" current.commit)" = "$current_commit" ]
  [ "$(json_commit "${TEST_DIR}/state.json" generation)" = "8" ]
}

@test "manual rollback recovers current and state when final rename fails" {
  current_commit=7070707070707070707070707070707070707070
  previous_commit=8080808080808080808080808080808080808080
  write_manifest_for_commit "$current_commit"
  cp "$MANIFEST_FILE" "${TEST_DIR}/current.json"
  write_manifest_for_commit "$previous_commit"
  cp "$MANIFEST_FILE" "${TEST_DIR}/previous.json"
  setup_deploy_mocks
  write_deployment_state "${TEST_DIR}/current.json" "${TEST_DIR}/previous.json" "${TEST_DIR}/state.json" 10
  cat > "${MOCK_BIN}/mv" <<'EOF'
#!/usr/bin/env bash
if [ "${MV_FAIL_STATE_RENAME:-0}" = 1 ] && [ "${*: -1}" = "$MV_FAIL_DEST" ]; then
  exit 1
fi
exec /usr/bin/mv "$@"
EOF
  chmod +x "${MOCK_BIN}/mv"
  export MV_FAIL_STATE_RENAME=1
  export MV_FAIL_DEST="${TEST_DIR}/state.json"

  run bash "${REPO_ROOT}/deploy/rollback.sh"

  [ "$status" -ne 0 ]
  [ "$(wc -l < "$SSH_MARKER")" -eq 2 ]
  [ "$(cat "$HEALTH_COUNT_FILE")" -eq 2 ]
  [ "$(json_commit "${TEST_DIR}/state.json" current.commit)" = "$current_commit" ]
  [ "$(json_commit "${TEST_DIR}/state.json" generation)" = "10" ]
}

@test "manual rollback recovers current and prior state when directory sync fails" {
  current_commit=9090909090909090909090909090909090909090
  previous_commit=abababababababababababababababababababab
  write_manifest_for_commit "$current_commit"
  cp "$MANIFEST_FILE" "${TEST_DIR}/current.json"
  write_manifest_for_commit "$previous_commit"
  cp "$MANIFEST_FILE" "${TEST_DIR}/previous.json"
  setup_deploy_mocks
  export SYNC_RESULTS="0 1 0 0"
  write_deployment_state "${TEST_DIR}/current.json" "${TEST_DIR}/previous.json" "${TEST_DIR}/state.json" 12

  run bash "${REPO_ROOT}/deploy/rollback.sh"

  [ "$status" -ne 0 ]
  [ "$(wc -l < "$SSH_MARKER")" -eq 2 ]
  [ "$(cat "$HEALTH_COUNT_FILE")" -eq 2 ]
  [ "$(json_commit "${TEST_DIR}/state.json" current.commit)" = "$current_commit" ]
  [ "$(json_commit "${TEST_DIR}/state.json" generation)" = "12" ]
}

@test "deploy rejects generation overflow before remote mutation" {
  commit=cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd
  write_manifest_for_commit "$commit"
  setup_deploy_mocks
  cp "$MANIFEST_FILE" "${TEST_DIR}/current.json"
  cp "$MANIFEST_FILE" "${TEST_DIR}/previous.json"
  write_deployment_state "${TEST_DIR}/current.json" "${TEST_DIR}/previous.json" "${TEST_DIR}/state.json" 9007199254740991

  run bash "${REPO_ROOT}/deploy/deploy.sh" "$MANIFEST_FILE"

  [ "$status" -ne 0 ]
  [ ! -e "$SSH_MARKER" ]
}

@test "deploy revalidates generated state before remote mutation" {
  commit=dededededededededededededededededededede
  write_manifest_for_commit "$commit"
  setup_deploy_mocks
  cat > "${MOCK_BIN}/date" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' 'not-a-timestamp'
EOF
  chmod +x "${MOCK_BIN}/date"

  run bash "${REPO_ROOT}/deploy/deploy.sh" "$MANIFEST_FILE"

  [ "$status" -ne 0 ]
  [ ! -e "$SSH_MARKER" ]
}

@test "deploy syncs the state directory after atomic publication" {
  commit=efefefefefefefefefefefefefefefefefefefef
  write_manifest_for_commit "$commit"
  setup_deploy_mocks

  bash "${REPO_ROOT}/deploy/deploy.sh" "$MANIFEST_FILE"

  [ "$(cat "$SYNC_COUNT_FILE")" -ge 2 ]
}

@test "deploy targets split hosts with protected env and service-specific image contracts" {
  commit=f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0
  write_manifest_for_commit "$commit"
  setup_deploy_mocks

  bash "${REPO_ROOT}/deploy/deploy.sh" "$MANIFEST_FILE"

  app_calls=$(grep '^ARGS=.*deployer@app-host' "$SSH_CALL_LOG")
  data_calls=$(grep '^ARGS=.*deployer@data-host' "$SSH_CALL_LOG")
  [[ "$app_calls" == *"$EXPECTED_WEB_REPOSITORY@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"* ]]
  [[ "$app_calls" == *"$EXPECTED_PLATFORM_WORKER_REPOSITORY@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"* ]]
  [[ "$app_calls" != *"$EXPECTED_MIGRATOR_REPOSITORY@"* ]]
  [[ "$data_calls" == *"$EXPECTED_MIGRATOR_REPOSITORY@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"* ]]
  [[ "$data_calls" != *"$EXPECTED_WEB_REPOSITORY@"* ]]
  [[ "$data_calls" != *"$EXPECTED_PLATFORM_WORKER_REPOSITORY@"* ]]
  grep -F 'docker compose --env-file data.env -f compose.data.yml --profile migration run --rm migrator' "${REPO_ROOT}/deploy/deploy.sh"
  grep -F 'docker compose --env-file app.env -f compose.app.yml up -d --no-build --wait --wait-timeout' "${REPO_ROOT}/deploy/deploy.sh"
}

@test "rollback target and recovery use the identical app host compose contract" {
  current_commit=1212121212121212121212121212121212121212
  previous_commit=3434343434343434343434343434343434343434
  write_manifest_for_commit "$current_commit"
  cp "$MANIFEST_FILE" "${TEST_DIR}/current.json"
  write_manifest_for_commit "$previous_commit"
  cp "$MANIFEST_FILE" "${TEST_DIR}/previous.json"
  setup_deploy_mocks
  export SSH_RESULTS="1 0"
  write_deployment_state "${TEST_DIR}/current.json" "${TEST_DIR}/previous.json" "${TEST_DIR}/state.json" 14

  run bash "${REPO_ROOT}/deploy/rollback.sh"

  [ "$status" -ne 0 ]
  [ "$(grep -c '^ARGS=.*deployer@app-host' "$SSH_CALL_LOG")" -eq 2 ]
  [ "$(grep -c '/opt/local-gtm/app' "$SSH_CALL_LOG")" -eq 2 ]
  ! grep -q 'deployer@data-host' "$SSH_CALL_LOG"
  grep -F 'docker compose --env-file app.env -f compose.app.yml up -d --no-build --wait --wait-timeout' "${REPO_ROOT}/deploy/rollback.sh"
}

@test "publish derives one lowercase GHCR repository for tags and manifests" {
  workflow=$(cat "${REPO_ROOT}/.github/workflows/publish.yml")
  expression_open='$'"{{"

  [[ "$workflow" == *'repository="ghcr.io/${GITHUB_REPOSITORY,,}"'* ]]
  [[ "$workflow" == *"${expression_open} steps.repository.outputs.repository }}/web"* ]]
  [[ "$workflow" == *"${expression_open} needs.publish.outputs.ghcr_repository }}/migrator"* ]]
  [[ "$workflow" != *"ghcr.io/${expression_open} github.repository }}"* ]]
}

@test "publish fails closed until every exact digest is anonymously pullable" {
  workflow=$(cat "${REPO_ROOT}/.github/workflows/publish.yml")

  [[ "$workflow" == *'name: Verify anonymous GHCR pulls'* ]]
  [[ "$workflow" == *'permissions: {}'* ]]
  [[ "$workflow" == *'export DOCKER_CONFIG="$(mktemp -d)"'* ]]
  [[ "$workflow" == *'test -z "${DOCKER_AUTH_CONFIG:-}"'* ]]
  [[ "$workflow" == *'docker pull "${GHCR_REPOSITORY}/web@${WEB_DIGEST}"'* ]]
  [[ "$workflow" == *'docker pull "${GHCR_REPOSITORY}/platform-worker@${WORKER_DIGEST}"'* ]]
  [[ "$workflow" == *'docker pull "${GHCR_REPOSITORY}/migrator@${MIGRATOR_DIGEST}"'* ]]
}

@test "deploy rejects compose paths with shell metacharacters" {
  commit=a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1
  write_manifest_for_commit "$commit"
  setup_deploy_mocks
  sed -i "s|^APP_COMPOSE_DIR=.*|APP_COMPOSE_DIR='/opt/app; rm -rf /'|" "$DEPLOYMENT_ENV"

  run bash "${REPO_ROOT}/deploy/deploy.sh" "$MANIFEST_FILE"

  [ "$status" -ne 0 ]
  [ ! -e "$SSH_MARKER" ]
}

@test "deploy rejects compose paths that are not absolute" {
  commit=b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2
  write_manifest_for_commit "$commit"
  setup_deploy_mocks
  sed -i "s|^APP_COMPOSE_DIR=.*|APP_COMPOSE_DIR='relative/path'|" "$DEPLOYMENT_ENV"

  run bash "${REPO_ROOT}/deploy/deploy.sh" "$MANIFEST_FILE"

  [ "$status" -ne 0 ]
  [ ! -e "$SSH_MARKER" ]
}

@test "rollback rejects forged lock FD in failed-deploy mode" {
  current_commit=c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3
  previous_commit=d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4
  write_manifest_for_commit "$current_commit"
  cp "$MANIFEST_FILE" "${TEST_DIR}/current.json"
  write_manifest_for_commit "$previous_commit"
  cp "$MANIFEST_FILE" "${TEST_DIR}/previous.json"
  setup_deploy_mocks
  write_deployment_state "${TEST_DIR}/current.json" "${TEST_DIR}/previous.json" "${TEST_DIR}/state.json" 20

  # Pass a random FD that does not point to the lock file
  exec 8>"${TEST_DIR}/random-fd-file"
  DEPLOY_LOCK_FD=8 run bash "${REPO_ROOT}/deploy/rollback.sh" --failed-deploy

  [ "$status" -ne 0 ]
  exec 8>&-
}

@test "first-release deploy requires operational backup when configured" {
  commit=e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5
  write_manifest_for_commit "$commit"
  setup_deploy_mocks
  printf 'FIRST_RELEASE_BACKUP=%s/nonexistent-backup\n' "$TEST_DIR" >> "$DEPLOYMENT_ENV"

  run bash "${REPO_ROOT}/deploy/deploy.sh" "$MANIFEST_FILE"

  [ "$status" -ne 0 ]
  [ ! -e "$SSH_MARKER" ]
}

@test "first-release deploy accepts non-empty operational backup" {
  commit=f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6
  write_manifest_for_commit "$commit"
  setup_deploy_mocks
  mkdir -p "${TEST_DIR}/valid-backup"
  printf 'placeholder' > "${TEST_DIR}/valid-backup/artifact.tar"
  printf 'FIRST_RELEASE_BACKUP=%s/valid-backup\n' "$TEST_DIR" >> "$DEPLOYMENT_ENV"

  bash "${REPO_ROOT}/deploy/deploy.sh" "$MANIFEST_FILE"

  [ -e "$SSH_MARKER" ]
}

@test "protected env requires every key from file data despite inherited values" {
  setup_render_inputs
  remove_env_line "$LEGACY_ENV" APP_DOMAIN

  APP_DOMAIN=inherited.example.test run bash "${REPO_ROOT}/deploy/split/render-proxmox-envs.sh" \
    "$LEGACY_ENV" "$TOKEN_FILE" "$OUTPUT_DIR"

  [ "$status" -ne 0 ]
  [ ! -e "$OUTPUT_DIR" ]
}

@test "protected env rejects malformed mixed quoting" {
  setup_render_inputs
  replace_env_line "$LEGACY_ENV" APP_DOMAIN 'APP_DOMAIN="crm.example.test"junk"'

  run bash "${REPO_ROOT}/deploy/split/render-proxmox-envs.sh" \
    "$LEGACY_ENV" "$TOKEN_FILE" "$OUTPUT_DIR"

  [ "$status" -ne 0 ]
  [ ! -e "$OUTPUT_DIR" ]
}

@test "protected env special characters round-trip through rendered dotenv" {
  setup_render_inputs
  expected="sp ace#\$=semi;'quote'\\back"
  replace_env_line "$LEGACY_ENV" POSTGRES_RUNTIME_PASSWORD \
    "POSTGRES_RUNTIME_PASSWORD=\"sp ace#\$=semi;'quote'\\\\back\""

  bash "${REPO_ROOT}/deploy/split/render-proxmox-envs.sh" \
    "$LEGACY_ENV" "$TOKEN_FILE" "$OUTPUT_DIR"

  [ "$(read_single_quoted_env_value "$OUTPUT_DIR/data.env" POSTGRES_RUNTIME_PASSWORD)" = "$expected" ]
}

@test "protected env publication is all-or-nothing when finalization fails" {
  setup_render_inputs
  mkdir -p "$OUTPUT_DIR"
  printf '%s\n' 'old-data' > "$OUTPUT_DIR/data.env"
  printf '%s\n' 'old-app' > "$OUTPUT_DIR/app.env"
  cp "$RENDER_BIN/sync" "$RENDER_BIN/chmod"
  cat > "$RENDER_BIN/chmod" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

  run bash "${REPO_ROOT}/deploy/split/render-proxmox-envs.sh" \
    "$LEGACY_ENV" "$TOKEN_FILE" "$OUTPUT_DIR"

  [ "$status" -ne 0 ]
  [ "$(cat "$OUTPUT_DIR/data.env")" = "old-data" ]
  [ "$(cat "$OUTPUT_DIR/app.env")" = "old-app" ]
  [ ! -e "$OUTPUT_DIR/documents.env" ]
  [ ! -e "$OUTPUT_DIR/identity.env" ]
}

@test "protected env requires explicit OpenBao token and emits no placeholder" {
  setup_render_inputs
  remove_env_line "$LEGACY_ENV" OPENBAO_TOKEN

  run bash "${REPO_ROOT}/deploy/split/render-proxmox-envs.sh" \
    "$LEGACY_ENV" "$TOKEN_FILE" "$OUTPUT_DIR"
  [ "$status" -ne 0 ]

  write_protected_env "$LEGACY_ENV"
  bash "${REPO_ROOT}/deploy/split/render-proxmox-envs.sh" \
    "$LEGACY_ENV" "$TOKEN_FILE" "$OUTPUT_DIR"
  [ "$(read_single_quoted_env_value "$OUTPUT_DIR/app.env" OPENBAO_TOKEN)" = "openbao-protected-token" ]
  run env REPO_ROOT="$REPO_ROOT" bash -c '! command grep -R "replace-after-openbao-bootstrap" "$REPO_ROOT/deploy/split/render-proxmox-envs.sh" "$REPO_ROOT/deploy/config.example"'
  [ "$status" -eq 0 ]
}
