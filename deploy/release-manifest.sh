#!/usr/bin/env bash
# Release manifest tools for Local GTM immutable deployment.
# Provides: generate, validate, and resolve operations on release manifests.
#
# Schema:
#   {
#     "schemaVersion": 1,
#     "commit": "<git-sha>",
#     "createdAt": "<UTC ISO-8601>",
#     "images": {
#       "web":        { "repository": "ghcr.io/owner/local-gtm/web",        "digest": "sha256:..." },
#       "platformWorker": { "repository": "ghcr.io/owner/local-gtm/platform-worker", "digest": "sha256:..." },
#       "migrator":   { "repository": "ghcr.io/owner/local-gtm/migrator",   "digest": "sha256:..." }
#     }
#   }
#
# Usage:
#   bash release-manifest.sh generate <commit> <web-repo> <web-digest> <worker-repo> <worker-digest> <migrator-repo> <migrator-digest>
#   bash release-manifest.sh validate <manifest-file>
#   bash release-manifest.sh resolve <manifest-file> <image-key>   # prints "repo@digest"
#   bash release-manifest.sh get-commit <manifest-file>
set -euo pipefail

SCHEMA_VERSION=1

log() { printf '[release-manifest] %s\n' "$*" >&2; }

# Cross-platform path helper: convert MSYS paths to native for Windows binaries
_to_native_path() {
	if command -v cygpath &>/dev/null; then
		cygpath -w "$1" 2>/dev/null || echo "$1"
	else
		echo "$1"
	fi
}

# --- Validation helpers ---

validate_digest() {
	# Exactly sha256: followed by 64 lowercase hex characters.
	if [[ "$1" =~ ^sha256:[a-f0-9]{64}$ ]]; then
		return 0
	fi
	return 1
}

validate_repository() {
	# Repository must match: registry/owner/name pattern.
	# Reject path traversal, spaces, and shell metacharacters.
	local repo="$1"
	if [[ -z "$repo" ]]; then
		return 1
	fi
	# Must contain a slash (registry/repo)
	if [[ "$repo" != */* ]]; then
		return 1
	fi
	# Reject path traversal, spaces, and dangerous characters
	if [[ "$repo" == *..* ]] || [[ "$repo" == *[\ \;\|\&\$\`\']* ]]; then
		return 1
	fi
	# Must match basic OCI registry pattern: hostname/path[/path...]
	if [[ ! "$repo" =~ ^[a-zA-Z0-9._-]+(/[a-zA-Z0-9._-]+)+$ ]]; then
		return 1
	fi
	return 0
}

validate_commit() {
	# Git SHA: at least 7 hex characters, no injection chars
	if [[ "$1" =~ ^[a-f0-9]{7,40}$ ]]; then
		return 0
	fi
	return 1
}

validate_timestamp() {
	# ISO-8601 UTC format: YYYY-MM-DDTHH:MM:SSZ
	if [[ "$1" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
		return 0
	fi
	return 1
}

# --- Structured JSON operations (no string interpolation) ---

# Parse a manifest file using jq. Returns exit 1 if malformed or missing fields.
parse_manifest() {
	local file="$1"
	if [[ ! -f "$file" ]]; then
		echo "manifest file not found: $file" >&2
		return 1
	fi
	local native_file
	native_file=$(_to_native_path "$file")
	# Validate JSON structure and schema version using jq
	if ! jq -e "
		.schemaVersion == ${SCHEMA_VERSION}
		and (.commit | type == \"string\" and length >= 7)
		and (.createdAt | type == \"string\")
		and (.images | has(\"web\", \"platformWorker\", \"migrator\"))
		and (.images.web   | has(\"repository\", \"digest\"))
		and (.images.platformWorker | has(\"repository\", \"digest\"))
		and (.images.migrator | has(\"repository\", \"digest\"))
	" "$native_file" >/dev/null 2>&1; then
		return 1
	fi
	return 0
}

# --- Commands ---

generate() {
	if [[ $# -ne 7 ]]; then
		echo "usage: $0 generate <commit-sha> <web-repo> <web-digest> <worker-repo> <worker-digest> <migrator-repo> <migrator-digest>" >&2
		exit 64
	fi

	local commit="$1"
	local web_repo="$2"
	local web_digest="$3"
	local worker_repo="$4"
	local worker_digest="$5"
	local migrator_repo="$6"
	local migrator_digest="$7"

	# Validate commit SHA
	if ! validate_commit "$commit"; then
		echo "invalid commit format: expected 7-40 hex characters" >&2
		exit 65
	fi

	# Validate all digests
	for d in "$web_digest" "$worker_digest" "$migrator_digest"; do
		if ! validate_digest "$d"; then
			echo "invalid digest format: expected sha256: followed by 64 hex chars" >&2
			exit 65
		fi
	done

	# Validate all repository names
	for r in "$web_repo" "$worker_repo" "$migrator_repo"; do
		if ! validate_repository "$r"; then
			echo "invalid repository name: $r" >&2
			exit 65
		fi
	done

	# Ensure digests are distinct (web, worker, migrator must differ)
	if [[ "$web_digest" == "$worker_digest" ]]; then
		echo "web and platformWorker digests must be distinct" >&2
		exit 65
	fi
	if [[ "$web_digest" == "$migrator_digest" ]]; then
		echo "web and migrator digests must be distinct" >&2
		exit 65
	fi
	if [[ "$worker_digest" == "$migrator_digest" ]]; then
		echo "platformWorker and migrator digests must be distinct" >&2
		exit 65
	fi

	local created_at
	created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

	# Use jq to produce valid JSON — no shell interpolation in JSON body
	jq -n \
		--argjson sv "$SCHEMA_VERSION" \
		--arg commit "$commit" \
		--arg created_at "$created_at" \
		--arg web_repo "$web_repo" \
		--arg web_digest "$web_digest" \
		--arg worker_repo "$worker_repo" \
		--arg worker_digest "$worker_digest" \
		--arg migrator_repo "$migrator_repo" \
		--arg migrator_digest "$migrator_digest" \
		'{
			schemaVersion: $sv,
			commit: $commit,
			createdAt: $created_at,
			images: {
				web: { repository: $web_repo, digest: $web_digest },
				platformWorker: { repository: $worker_repo, digest: $worker_digest },
				migrator: { repository: $migrator_repo, digest: $migrator_digest }
			}
		}'
}

validate() {
	if [[ $# -ne 1 ]]; then
		echo "usage: $0 validate <manifest-file>" >&2
		exit 64
	fi

	local file="$1"

	if [[ ! -f "$file" ]]; then
		echo "manifest file not found: $file" >&2
		exit 66
	fi

	local native_file
	native_file=$(_to_native_path "$file")

	if command -v jq &>/dev/null; then
		# Parse and validate structure
		if ! parse_manifest "$file"; then
			echo "manifest validation failed (schema, structure, or JSON parse error)" >&2
			exit 67
		fi

		# Validate each image entry using jq — no shell interpolation
		local errors=0
		for key in web platformWorker migrator; do
			local repo digest
			repo=$(jq -r ".images.${key}.repository" "$native_file")
			digest=$(jq -r ".images.${key}.digest" "$native_file")

			if ! validate_repository "$repo"; then
				echo "images.${key}.repository: invalid format ($repo)" >&2
				((errors++)) || true
			fi

			if ! validate_digest "$digest"; then
				echo "images.${key}.digest: invalid format ($digest)" >&2
				((errors++)) || true
			fi
		done

		# Validate commit format
		local commit
		commit=$(jq -r '.commit' "$native_file")
		if ! validate_commit "$commit"; then
			echo "commit: invalid format" >&2
			((errors++)) || true
		fi

		# Validate timestamp format
		local created_at
		created_at=$(jq -r '.createdAt' "$native_file")
		if ! validate_timestamp "$created_at"; then
			echo "createdAt: invalid ISO-8601 format" >&2
			((errors++)) || true
		fi

		# Check that all three image digests are distinct
		local web_digest worker_digest migrator_digest
		web_digest=$(jq -r '.images.web.digest' "$native_file")
		worker_digest=$(jq -r '.images.platformWorker.digest' "$native_file")
		migrator_digest=$(jq -r '.images.migrator.digest' "$native_file")
		if [[ "$web_digest" == "$worker_digest" ]] || \
		   [[ "$web_digest" == "$migrator_digest" ]] || \
		   [[ "$worker_digest" == "$migrator_digest" ]]; then
			echo "images: web, platformWorker, and migrator must have distinct digests" >&2
			((errors++)) || true
		fi

		if [[ $errors -gt 0 ]]; then
			exit 67
		fi
	else
		# Fallback: python3 with stdin-based file reading (no string interpolation)
		if command -v python3 &>/dev/null; then
			python3 -c "
import json, sys, re

file_path = sys.argv[1]
schema_version = int(sys.argv[2])

try:
    with open(file_path, 'r') as f:
        content = f.read()
    m = json.loads(content)
except (json.JSONDecodeError, OSError) as e:
    print(f'JSON parse error: {e}', file=sys.stderr)
    sys.exit(1)

errors = 0
sv = m.get('schemaVersion', 0)
if sv != schema_version:
    print(f'schemaVersion: expected {schema_version}, got {sv}', file=sys.stderr)
    errors += 1

commit = m.get('commit', '')
if not isinstance(commit, str) or not re.match(r'^[a-f0-9]{7,40}$', commit):
    print('commit: invalid format (expected 7-40 hex chars)', file=sys.stderr)
    errors += 1

created_at = m.get('createdAt', '')
if not isinstance(created_at, str) or not re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$', created_at):
    print('createdAt: invalid ISO-8601 format', file=sys.stderr)
    errors += 1

digest_re = re.compile(r'^sha256:[a-f0-9]{64}$')
repo_re = re.compile(r'^[a-zA-Z0-9._-]+(/[a-zA-Z0-9._-]+)+$')
images = m.get('images', {})
digests_seen = []

for key in ['web', 'platformWorker', 'migrator']:
    img = images.get(key, {})
    if not isinstance(img, dict):
        print(f'images.{key}: expected object', file=sys.stderr)
        errors += 1
        continue
    repo = img.get('repository', '')
    digest = img.get('digest', '')
    if not isinstance(repo, str) or not repo_re.match(repo):
        print(f'images.{key}.repository: invalid format', file=sys.stderr)
        errors += 1
    if not isinstance(digest, str) or not digest_re.match(digest):
        print(f'images.{key}.digest: invalid format', file=sys.stderr)
        errors += 1
    digests_seen.append(digest)

# Check distinct digests
if len(set(digests_seen)) != len(digests_seen):
    print('images: web, platformWorker, and migrator must have distinct digests', file=sys.stderr)
    errors += 1

sys.exit(errors)
" "$file" "$SCHEMA_VERSION"
		else
			echo "jq or python3 is required for manifest validation" >&2
			exit 70
		fi
	fi

	log "manifest is valid"
}

get_commit() {
	if [[ $# -ne 1 ]]; then
		echo "usage: $0 get-commit <manifest-file>" >&2
		exit 64
	fi
	local native_file
	native_file=$(_to_native_path "$1")
	jq -r '.commit // empty' "$native_file" 2>/dev/null || {
		# Fallback to python3 if jq fails
		python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['commit'])" "$1" 2>/dev/null || {
			echo "failed to read commit from manifest" >&2
			exit 68
		}
	}
}

resolve() {
	if [[ $# -ne 2 ]]; then
		echo "usage: $0 resolve <manifest-file> <image-key>" >&2
		echo "  image-key: web, platformWorker, or migrator" >&2
		exit 64
	fi

	local file="$1"
	local key="$2"

	# Validate key is one of the allowed values
	case "$key" in
		web|platformWorker|migrator) ;;
		*)
			echo "invalid image key: $key (expected web, platformWorker, or migrator)" >&2
			exit 64
			;;
	esac

	local native_file
	native_file=$(_to_native_path "$file")
	jq -r --arg k "$key" '.images[$k] | "\(.repository)@\(.digest)"' "$native_file" 2>/dev/null || {
		echo "failed to resolve image reference for '${key}' in manifest" >&2
		exit 68
	}
}

# --- Main dispatch ---
case "${1:-help}" in
	generate)
		shift
		generate "$@"
		;;
	validate)
		shift
		validate "$@"
		;;
	resolve)
		shift
		resolve "$@"
		;;
	get-commit)
		shift
		get_commit "$@"
		;;
	*)
		echo "usage: $0 {generate|validate|resolve|get-commit} ..." >&2
		exit 64
		;;
esac
