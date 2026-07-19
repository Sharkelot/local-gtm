#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <empty-output-directory>" >&2
  exit 64
fi

output_dir=$1

: "${DATABASE_HOST:?set DATABASE_HOST before generating PKI}"
: "${DOCUMENT_HOST:?set DOCUMENT_HOST before generating PKI}"
: "${IDENTITY_HOST:?set IDENTITY_HOST before generating PKI}"

if [ -e "$output_dir" ] && [ -n "$(find "$output_dir" -mindepth 1 -print -quit 2>/dev/null)" ]; then
  echo "refusing to overwrite non-empty PKI directory: $output_dir" >&2
  exit 73
fi

umask 077
mkdir -p "$output_dir/ca" "$output_dir/app" "$output_dir/postgres" \
  "$output_dir/documents/minio/CAs" "$output_dir/documents/openbao" \
  "$output_dir/identity"

openssl genrsa -out "$output_dir/ca/ca.key" 4096
openssl req -x509 -new -sha256 -days 3650 \
  -key "$output_dir/ca/ca.key" \
  -out "$output_dir/ca/ca.crt" \
  -subj "/O=Local GTM/CN=Local GTM Inter-CT Root CA"

issue_server_certificate() {
  local name=$1
  local common_name=$2
  local san=$3
  local destination=$4

  local extension_file
  extension_file=$(mktemp)
  printf '%s\n' \
    'basicConstraints=critical,CA:FALSE' \
    'keyUsage=critical,digitalSignature,keyEncipherment' \
    'extendedKeyUsage=serverAuth' \
    "subjectAltName=$san" > "$extension_file"

  openssl genrsa -out "$destination.key" 3072
  openssl req -new -sha256 \
    -key "$destination.key" \
    -out "$output_dir/$name.csr" \
    -subj "/O=Local GTM/CN=$common_name"
  openssl x509 -req -sha256 -days 397 \
    -in "$output_dir/$name.csr" \
    -CA "$output_dir/ca/ca.crt" \
    -CAkey "$output_dir/ca/ca.key" \
    -CAcreateserial \
    -out "$destination.crt" \
    -extfile "$extension_file"

  rm -f "$extension_file" "$output_dir/$name.csr"
}

issue_server_certificate postgres postgres.local-gtm.internal \
  "DNS:postgres.local-gtm.internal,IP:${DATABASE_HOST}" \
  "$output_dir/postgres/server"
issue_server_certificate minio minio.local-gtm.internal \
  "DNS:minio.local-gtm.internal,IP:${DOCUMENT_HOST}" \
  "$output_dir/documents/minio/public"
issue_server_certificate openbao openbao.local-gtm.internal \
  "DNS:openbao.local-gtm.internal,IP:${DOCUMENT_HOST}" \
  "$output_dir/documents/openbao/tls"
issue_server_certificate keycloak keycloak.local-gtm.internal \
  "DNS:keycloak.local-gtm.internal,IP:${IDENTITY_HOST}" \
  "$output_dir/identity/keycloak"
issue_server_certificate grafana grafana.local-gtm.internal \
  "DNS:grafana.local-gtm.internal,IP:${IDENTITY_HOST}" \
  "$output_dir/identity/grafana"
issue_server_certificate otel otel.local-gtm.internal \
  "DNS:otel.local-gtm.internal,IP:${IDENTITY_HOST}" \
  "$output_dir/identity/otel"

cp "$output_dir/ca/ca.crt" "$output_dir/app/ca-bundle.pem"
cp "$output_dir/ca/ca.crt" "$output_dir/postgres/root.crt"
cp "$output_dir/ca/ca.crt" "$output_dir/documents/minio/CAs/inter-ct-ca.crt"
cp "$output_dir/ca/ca.crt" "$output_dir/documents/openbao/ca.crt"
cp "$output_dir/ca/ca.crt" "$output_dir/identity/ca.crt"

find "$output_dir" -type d -exec chmod 0700 {} +
find "$output_dir" -type f -name '*.key' -exec chmod 0600 {} +
find "$output_dir" -type f \( -name '*.crt' -o -name '*.pem' \) -exec chmod 0644 {} +

echo "private PKI generated in $output_dir; protect ca/ca.key offline"
