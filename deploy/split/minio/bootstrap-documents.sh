#!/bin/sh
set -eu

: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
: "${MINIO_DOCUMENT_BUCKET:?MINIO_DOCUMENT_BUCKET is required}"
: "${MINIO_DOCUMENT_RETENTION_DAYS:?MINIO_DOCUMENT_RETENTION_DAYS is required}"
: "${MINIO_UPLOADER_ACCESS_KEY:?MINIO_UPLOADER_ACCESS_KEY is required}"
: "${MINIO_UPLOADER_SECRET_KEY:?MINIO_UPLOADER_SECRET_KEY is required}"
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

mc alias set local https://minio.local-gtm.internal:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

# Object lock is creation-time only. Do not recreate a bucket to work around a lock/retention
# failure: migrate or restore the evidence store through the approved procedure.
mc mb --ignore-existing --with-lock "local/$MINIO_DOCUMENT_BUCKET"
mc version enable "local/$MINIO_DOCUMENT_BUCKET"
mc retention set --default GOVERNANCE "${MINIO_DOCUMENT_RETENTION_DAYS}d" "local/$MINIO_DOCUMENT_BUCKET"

write_policy() {
  policy_name="$1"
  actions="$2"
  printf '%s\n' '{' '  "Version": "2012-10-17",' '  "Statement": [' '    {' \
    '      "Effect": "Allow",' "      \"Action\": $actions," \
    "      \"Resource\": [\"arn:aws:s3:::$MINIO_DOCUMENT_BUCKET/*\"]" '    }' '  ]' '}' > "/tmp/$policy_name.json"
  mc admin policy detach local "$policy_name" --user "$3" >/dev/null 2>&1 || true
  mc admin policy remove local "$policy_name" >/dev/null 2>&1 || true
  mc admin policy create local "$policy_name" "/tmp/$policy_name.json"
}

# Uploader can create object versions only; it cannot list, read, delete, administer, or bypass
# retention/legal-hold controls. Scanner can read an exact object/version only.
write_policy document-uploader '["s3:PutObject"]' "$MINIO_UPLOADER_ACCESS_KEY"
write_policy document-scanner '["s3:GetObject", "s3:GetObjectVersion"]' "$MINIO_SCANNER_ACCESS_KEY"
mc admin user add local "$MINIO_UPLOADER_ACCESS_KEY" "$MINIO_UPLOADER_SECRET_KEY"
mc admin policy attach local document-uploader --user "$MINIO_UPLOADER_ACCESS_KEY"
mc admin user add local "$MINIO_SCANNER_ACCESS_KEY" "$MINIO_SCANNER_SECRET_KEY"
mc admin policy attach local document-scanner --user "$MINIO_SCANNER_ACCESS_KEY"
