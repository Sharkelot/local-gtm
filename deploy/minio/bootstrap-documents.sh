#!/bin/sh
set -eu

: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
: "${MINIO_DOCUMENT_BUCKET:?MINIO_DOCUMENT_BUCKET is required}"
: "${MINIO_DOCUMENT_RETENTION_DAYS:?MINIO_DOCUMENT_RETENTION_DAYS is required}"
: "${MINIO_SCANNER_ACCESS_KEY:?MINIO_SCANNER_ACCESS_KEY is required}"
: "${MINIO_SCANNER_SECRET_KEY:?MINIO_SCANNER_SECRET_KEY is required}"

case "$MINIO_DOCUMENT_BUCKET" in
  [a-z0-9][a-z0-9.-]*[a-z0-9]) ;;
  *) echo 'MINIO_DOCUMENT_BUCKET must be a valid lowercase bucket name.' >&2; exit 1 ;;
esac
case "$MINIO_DOCUMENT_RETENTION_DAYS" in
  *[!0-9]*|'') echo 'MINIO_DOCUMENT_RETENTION_DAYS must be a positive integer.' >&2; exit 1 ;;
esac
if [ "$MINIO_DOCUMENT_RETENTION_DAYS" -lt 1 ]; then
  echo 'MINIO_DOCUMENT_RETENTION_DAYS must be at least one day.' >&2
  exit 1
fi

mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

# Object lock can only be selected at bucket creation. --ignore-existing preserves existing
# evidence; setting a default retention below fails if an old bucket was created without lock.
mc mb --ignore-existing --with-lock "local/$MINIO_DOCUMENT_BUCKET"
mc version enable "local/$MINIO_DOCUMENT_BUCKET"
mc retention set --default GOVERNANCE "${MINIO_DOCUMENT_RETENTION_DAYS}d" "local/$MINIO_DOCUMENT_BUCKET"

printf '%s\n' \
  '{' \
  '  "Version": "2012-10-17",' \
  '  "Statement": [' \
  '    {' \
  '      "Effect": "Allow",' \
  '      "Action": ["s3:GetObject", "s3:GetObjectVersion"],' \
  "      \"Resource\": [\"arn:aws:s3:::$MINIO_DOCUMENT_BUCKET/*\"]" \
  '    }' \
  '  ]' \
  '}' > /tmp/scanner-document-read-policy.json
mc admin policy detach local scanner-document-read --user "$MINIO_SCANNER_ACCESS_KEY" >/dev/null 2>&1 || true
mc admin policy remove local scanner-document-read >/dev/null 2>&1 || true
mc admin policy create local scanner-document-read /tmp/scanner-document-read-policy.json

# `user add` updates an existing user's secret, allowing an intentional scanner-secret rotation
# during a controlled bootstrap restart. The worker has no root credential.
mc admin user add local "$MINIO_SCANNER_ACCESS_KEY" "$MINIO_SCANNER_SECRET_KEY"
mc admin policy attach local scanner-document-read --user "$MINIO_SCANNER_ACCESS_KEY"
