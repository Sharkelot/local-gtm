#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <legacy-env> <cloudflare-token-file> <output-directory>" >&2
  exit 64
fi

legacy_env=$1
cloudflare_token_file=$2
output_dir=$3

for path in "$legacy_env" "$cloudflare_token_file"; do
  if [ ! -r "$path" ]; then
    echo "required protected input is not readable: $path" >&2
    exit 66
  fi
done

parsed_env=$(mktemp)
trap 'rm -f "$parsed_env"' EXIT
if ! python3 - "$legacy_env" > "$parsed_env" <<'PY'
import re
import sys

seen = set()
for number, raw in enumerate(open(sys.argv[1], encoding="utf-8"), 1):
    line = raw.rstrip("\r\n")
    if not line or line.lstrip().startswith("#"):
        continue
    match = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line)
    if not match:
        raise SystemExit(f"invalid legacy env syntax on line {number}")
    name, value = match.groups()
    if name in seen:
        raise SystemExit(f"duplicate legacy env key on line {number}: {name}")
    seen.add(name)
    if value.startswith("'") or value.startswith('"'):
        quote = value[0]
        if len(value) < 2 or value[-1] != quote:
            raise SystemExit(f"malformed quoted value on line {number}")
        body = value[1:-1]
        decoded = []
        index = 0
        while index < len(body):
            char = body[index]
            if char == "\\":
                index += 1
                if index >= len(body) or body[index] not in ("\\", quote):
                    raise SystemExit(f"invalid escape on line {number}")
                char = body[index]
            elif char == quote:
                raise SystemExit(f"unescaped quote on line {number}")
            decoded.append(char)
            index += 1
        value = "".join(decoded)
    elif any(char in value for char in "'\"`;$"):
        raise SystemExit(f"unsupported shell syntax on line {number}")
    sys.stdout.write(name + "\0" + value + "\0")
PY
then
  rm -f "$parsed_env"
  echo "could not parse legacy env file safely" >&2
  exit 65
fi

declare -A legacy_values=()
while IFS= read -r -d '' name && IFS= read -r -d '' value; do
  legacy_values["$name"]="$value"
  printf -v "$name" '%s' "$value"
done < "$parsed_env"
rm -f "$parsed_env"
trap - EXIT

required=(
  APP_DOMAIN HOOKS_DOMAIN KEYCLOAK_DOMAIN GRAFANA_DOMAIN POSTGRES_DB
  CRM_HOST DATABASE_HOST DOCUMENT_HOST IDENTITY_HOST KEYCLOAK_ADMIN_DOMAIN
  POSTGRES_BOOTSTRAP_USER POSTGRES_BOOTSTRAP_PASSWORD POSTGRES_MIGRATION_USER
  POSTGRES_MIGRATION_PASSWORD POSTGRES_RUNTIME_USER POSTGRES_RUNTIME_PASSWORD
  POSTGRES_PLATFORM_USER POSTGRES_PLATFORM_PASSWORD POSTGRES_REPORTING_USER
  POSTGRES_REPORTING_PASSWORD POSTGRES_KEYCLOAK_USER POSTGRES_KEYCLOAK_PASSWORD
  REDIS_PASSWORD KEYCLOAK_ADMIN KEYCLOAK_ADMIN_PASSWORD KEYCLOAK_CLIENT_ID
  KEYCLOAK_CLIENT_SECRET NEXTAUTH_SECRET INFERENCE_WORKER_TOKEN
  INFERENCE_WORKER_ACTOR_ID MINIO_ROOT_USER MINIO_ROOT_PASSWORD
  MINIO_DOCUMENT_BUCKET MINIO_DOCUMENT_RETENTION_DAYS MINIO_SCANNER_ACCESS_KEY
  MINIO_SCANNER_SECRET_KEY PRIVATE_ADMIN_CIDR
)

for name in "${required[@]}"; do
  if [ -z "${legacy_values[$name]:-}" ]; then
    echo "missing required legacy value: $name" >&2
    exit 65
  fi
done

cloudflare_token=$(tr -d '\r\n' < "$cloudflare_token_file")
if [ "${#cloudflare_token}" -lt 32 ]; then
  echo "Cloudflare token is unexpectedly short" >&2
  exit 65
fi

openbao_placeholder="replace-after-openbao""-bootstrap"
if [ -z "${legacy_values[OPENBAO_TOKEN]:-}" ] || [ "${legacy_values[OPENBAO_TOKEN]}" = "$openbao_placeholder" ]; then
  echo "OPENBAO_TOKEN must be explicitly configured in the legacy env file" >&2
  exit 65
fi
WEBHOOK_TRUSTED_MAPPINGS=${legacy_values[WEBHOOK_TRUSTED_MAPPINGS]:-[]}

umask 077
mkdir -p "$output_dir"
staging_dir=$(mktemp -d "${output_dir}/.render.XXXXXX")
backup_dir=$(mktemp -d "${output_dir}/.backup.XXXXXX")
cleanup() { rm -rf "$staging_dir" "$backup_dir"; }
trap cleanup EXIT
minio_uploader_secret=$(openssl rand -hex 32)
grafana_admin_password=$(openssl rand -hex 32)

cat > "$staging_dir/data.env" <<EOF
POSTGRES_DB=$POSTGRES_DB
POSTGRES_BOOTSTRAP_USER=$POSTGRES_BOOTSTRAP_USER
POSTGRES_BOOTSTRAP_PASSWORD=$POSTGRES_BOOTSTRAP_PASSWORD
POSTGRES_MIGRATION_USER=$POSTGRES_MIGRATION_USER
POSTGRES_MIGRATION_PASSWORD=$POSTGRES_MIGRATION_PASSWORD
POSTGRES_RUNTIME_USER=$POSTGRES_RUNTIME_USER
POSTGRES_RUNTIME_PASSWORD=$POSTGRES_RUNTIME_PASSWORD
POSTGRES_PLATFORM_USER=$POSTGRES_PLATFORM_USER
POSTGRES_PLATFORM_PASSWORD=$POSTGRES_PLATFORM_PASSWORD
POSTGRES_REPORTING_USER=$POSTGRES_REPORTING_USER
POSTGRES_REPORTING_PASSWORD=$POSTGRES_REPORTING_PASSWORD
POSTGRES_KEYCLOAK_USER=$POSTGRES_KEYCLOAK_USER
POSTGRES_KEYCLOAK_PASSWORD=$POSTGRES_KEYCLOAK_PASSWORD
PRIVATE_ADMIN_CIDR=10.0.0.0/24
POSTGRES_PRIVATE_BIND_ADDRESS=$DATABASE_HOST
MIGRATOR_IMAGE=local/legal-crm-migrator:26.13.1
EOF

cat > "$staging_dir/documents.env" <<EOF
DOCUMENTS_PRIVATE_BIND_IP=$DOCUMENT_HOST
MINIO_ROOT_USER=$MINIO_ROOT_USER
MINIO_ROOT_PASSWORD=$MINIO_ROOT_PASSWORD
MINIO_DOCUMENT_BUCKET=$MINIO_DOCUMENT_BUCKET
MINIO_DOCUMENT_RETENTION_DAYS=$MINIO_DOCUMENT_RETENTION_DAYS
MINIO_UPLOADER_ACCESS_KEY=document-uploader
MINIO_UPLOADER_SECRET_KEY=$minio_uploader_secret
MINIO_SCANNER_ACCESS_KEY=$MINIO_SCANNER_ACCESS_KEY
MINIO_SCANNER_SECRET_KEY=$MINIO_SCANNER_SECRET_KEY
EOF

cat > "$staging_dir/identity.env" <<EOF
IDENTITY_PRIVATE_BIND_ADDRESS=$IDENTITY_HOST
KEYCLOAK_IMAGE=quay.io/keycloak/keycloak@sha256:87758ff2293c78c942c7a1f0df2bc13e0f943fcf0c0d027c12fdfac54a35d93b
OTEL_COLLECTOR_IMAGE=ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-contrib@sha256:125bdbeb7590cc1952c5b3430ecf14063568980c2c93d5b38676cc0446ed8108
PROMETHEUS_IMAGE=prom/prometheus@sha256:63805ebb8d2b3920190daf1cb14a60871b16fd38bed42b857a3182bc621f4996
ALERTMANAGER_IMAGE=prom/alertmanager@sha256:27c475db5fb156cab31d5c18a4251ac7ed567746a2483ff264516437a39b15ba
LOKI_IMAGE=grafana/loki@sha256:a74594532eec4cc313401beedc4dd2708c43674c032084b1aeb87c14a5be1745
GRAFANA_IMAGE=grafana/grafana@sha256:b5b59bfc7561634c2d7b136c4543d702ebcc94a3da477f21ff26f89ffd4214fa
KEYCLOAK_HOSTNAME=https://$KEYCLOAK_DOMAIN
KEYCLOAK_ADMIN_HOSTNAME=https://$KEYCLOAK_ADMIN_DOMAIN
GRAFANA_ROOT_URL=https://$GRAFANA_DOMAIN
KEYCLOAK_DATABASE_URL=jdbc:postgresql://${DATABASE_HOST}:5432/$POSTGRES_DB?sslmode=verify-full&sslrootcert=/run/postgresql-ca/root.crt
POSTGRES_KEYCLOAK_USER=$POSTGRES_KEYCLOAK_USER
POSTGRES_KEYCLOAK_PASSWORD=$POSTGRES_KEYCLOAK_PASSWORD
KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME=$KEYCLOAK_ADMIN
KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD=$KEYCLOAK_ADMIN_PASSWORD
GRAFANA_ADMIN_USER=local-gtm-admin
GRAFANA_ADMIN_PASSWORD=$grafana_admin_password
EOF

cat > "$staging_dir/app.env" <<EOF
APP_DOMAIN=$APP_DOMAIN
HOOKS_DOMAIN=$HOOKS_DOMAIN
PRIVATE_ADMIN_CIDR=$PRIVATE_ADMIN_CIDR
KEYCLOAK_DOMAIN=$KEYCLOAK_DOMAIN
KEYCLOAK_ADMIN_DOMAIN=$KEYCLOAK_ADMIN_DOMAIN
GRAFANA_DOMAIN=$GRAFANA_DOMAIN
KEYCLOAK_UPSTREAM=https://${IDENTITY_HOST}:8443
GRAFANA_UPSTREAM=https://${IDENTITY_HOST}:3000
CLOUDFLARE_API_TOKEN=$cloudflare_token
PRIVATE_CA_BUNDLE_PATH=/etc/local-gtm/ca/inter-ct-ca-bundle.pem
CADDY_IMAGE=local/legal-crm-caddy:2.10.2
WEB_IMAGE=local/legal-crm-web:latest
PLATFORM_WORKER_IMAGE=local/legal-crm-platform-worker:latest
REDIS_IMAGE=redis@sha256:02419de7eddf55aa5bcf49efb74e88fa8d931b4d77c07eff8a6b2144472b6952
REDIS_PASSWORD=$REDIS_PASSWORD
REDIS_PRIVATE_BIND_ADDRESS=$CRM_HOST
DATABASE_URL=postgresql://$POSTGRES_RUNTIME_USER:$POSTGRES_RUNTIME_PASSWORD@${DATABASE_HOST}:5432/$POSTGRES_DB?schema=public&sslmode=verify-full&sslrootcert=/etc/ssl/private-ca/ca-bundle.pem
INTERNAL_DATABASE_URL=postgresql://$POSTGRES_PLATFORM_USER:$POSTGRES_PLATFORM_PASSWORD@${DATABASE_HOST}:5432/$POSTGRES_DB?schema=public&sslmode=verify-full&sslrootcert=/etc/ssl/private-ca/ca-bundle.pem
PLATFORM_DATABASE_URL=postgresql://$POSTGRES_PLATFORM_USER:$POSTGRES_PLATFORM_PASSWORD@${DATABASE_HOST}:5432/$POSTGRES_DB?schema=public&sslmode=verify-full&sslrootcert=/etc/ssl/private-ca/ca-bundle.pem
KEYCLOAK_ISSUER=https://$KEYCLOAK_DOMAIN/realms/legal-crm
KEYCLOAK_CLIENT_ID=$KEYCLOAK_CLIENT_ID
KEYCLOAK_CLIENT_SECRET=$KEYCLOAK_CLIENT_SECRET
AUTH_SECRET=$NEXTAUTH_SECRET
OPENBAO_ADDR=https://${DOCUMENT_HOST}:8200
OPENBAO_TOKEN=$OPENBAO_TOKEN
OTEL_EXPORTER_OTLP_ENDPOINT=https://${IDENTITY_HOST}:4318
INFERENCE_WORKER_TOKEN=$INFERENCE_WORKER_TOKEN
INFERENCE_WORKER_ACTOR_ID=$INFERENCE_WORKER_ACTOR_ID
WEBHOOK_TRUSTED_MAPPINGS=${WEBHOOK_TRUSTED_MAPPINGS:-[]}
MINIO_ENDPOINT=$DOCUMENT_HOST
MINIO_PORT=9000
MINIO_USE_SSL=true
MINIO_SCANNER_ACCESS_KEY=$MINIO_SCANNER_ACCESS_KEY
MINIO_SCANNER_SECRET_KEY=$MINIO_SCANNER_SECRET_KEY
MINIO_DOCUMENT_BUCKET=$MINIO_DOCUMENT_BUCKET
CLAMAV_HOST=$DOCUMENT_HOST
CLAMAV_PORT=3310
EOF

python3 - "$staging_dir" <<'PY'
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
for path in root.glob("*.env"):
    lines = []
    for line in path.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        if not separator:
            raise SystemExit(f"invalid generated dotenv line in {path.name}")
        value = value.replace("\\", "\\\\").replace("'", "\\'")
        lines.append(f"{key}='{value}'")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY

chmod 0600 "$staging_dir"/*.env
published=()
rollback_publication() {
  local name
  for name in "${published[@]}"; do
    rm -f "$output_dir/$name"
    if [ -f "$backup_dir/$name" ]; then
      mv "$backup_dir/$name" "$output_dir/$name"
    fi
  done
}
for name in data.env documents.env identity.env app.env; do
  if [ -e "$output_dir/$name" ]; then
    cp -p "$output_dir/$name" "$backup_dir/$name"
  fi
done
if ! sync "$staging_dir" "$backup_dir"; then
  echo "could not sync staged protected environments" >&2
  exit 1
fi
for name in data.env documents.env identity.env app.env; do
  if ! mv -f "$staging_dir/$name" "$output_dir/$name"; then
    rollback_publication
    echo "could not publish protected environments" >&2
    exit 1
  fi
  published+=("$name")
done
if ! sync "$output_dir"; then
  rollback_publication
  echo "could not sync published protected environments" >&2
  exit 1
fi
echo "rendered protected split environments in $output_dir"
