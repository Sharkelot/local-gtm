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
}

teardown() {
  rm -rf "$TEST_DIR"
}

# ============================================================
# Valid manifest generation and validation
# ============================================================

@test "generate produces valid JSON with correct schema version" {
  bash "$MANIFEST_SH" generate \
    abc1234 \
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
  "commit": "abcdef1",
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
  "commit": "abcdef1",
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
  "commit": "abcdef1",
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
  "commit": "abcdef1",
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
  "commit": "abcdef1",
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
  "commit": "abcdef1",
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
  "commit": "abcdef1",
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
  "commit": "abcdef1",
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
  "commit": "abcdef1",
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
  "commit": "abcdef1",
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
  "commit": "abcdef1",
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
  "commit": "abcdef1",
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
  "commit": "abcdef1",
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
  "commit": "abcdef1",
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
  "commit": "abcdef1",
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
  "commit": "abcdef1",
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
  "commit": "abcdef1",
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

# ============================================================
# Duplicate digest rejection (three distinct image references)
# ============================================================

@test "validate rejects duplicate digests between web and platformWorker" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

@test "validate rejects duplicate digests between web and migrator" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

@test "validate rejects duplicate digests between platformWorker and migrator" {
  cat > "$MANIFEST_FILE" <<'EOF'
{
  "schemaVersion": 1,
  "commit": "abcdef1",
  "createdAt": "2025-01-15T10:30:00Z",
  "images": {
    "web": { "repository": "ghcr.io/owner/local-gtm/web", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "migrator": { "repository": "ghcr.io/owner/local-gtm/migrator", "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
  }
}
EOF
  run bash "$MANIFEST_SH" validate "$MANIFEST_FILE"
  [ "$status" -ne 0 ]
}

# ============================================================
# Generate-specific tests
# ============================================================

@test "generate rejects invalid digest format" {
  run bash "$MANIFEST_SH" generate \
    abc1234 \
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
    abc1234 \
    "../etc/passwd" \
    sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    ghcr.io/owner/local-gtm/platform-worker \
    sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
    ghcr.io/owner/local-gtm/migrator \
    sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
  [ "$status" -ne 0 ]
}

@test "generate rejects duplicate digests" {
  run bash "$MANIFEST_SH" generate \
    abc1234 \
    ghcr.io/owner/local-gtm/web \
    sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    ghcr.io/owner/local-gtm/platform-worker \
    sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    ghcr.io/owner/local-gtm/migrator \
    sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
  [ "$status" -ne 0 ]
}

@test "generate output is valid JSON parseable by jq" {
  bash "$MANIFEST_SH" generate \
    abc1234 \
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
  "commit": "abcdef1",
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
  "commit": "abcdef1",
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
