#!/usr/bin/env bash
# Generate a bootstrap.env file with random secrets for Local GTM internal deployment.
# Usage: bash bootstrap-env.sh > /etc/local-gtm/bootstrap.env
# Then: source /etc/local-gtm/bootstrap.env && bash ../split/render-proxmox-envs.sh \
#         /etc/local-gtm/bootstrap.env /etc/cloudflared/tunnel-token.txt /etc/local-gtm/
set -euo pipefail

gen() { openssl rand -hex 32; }

cat <<BOOTSTRAP
# Local GTM internal deployment bootstrap
# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Source this then run render-proxmox-envs.sh to produce per-CT env files.

# --- Host topology ---
CRM_HOST=10.0.0.70
DATABASE_HOST=10.0.0.71
DOCUMENT_HOST=10.0.0.72
IDENTITY_HOST=10.0.0.73
INFERENCE_WORKER_IP=10.0.0.3

# --- Public domains ---
APP_DOMAIN=crm.afterlifehigh.com
HOOKS_DOMAIN=hooks.afterlifehigh.com
KEYCLOAK_DOMAIN=auth.afterlifehigh.com
KEYCLOAK_ADMIN_DOMAIN=auth-admin.afterlifehigh.com
GRAFANA_DOMAIN=observability.afterlifehigh.com

# --- Admin CIDR (restricts Keycloak admin hostname) ---
PRIVATE_ADMIN_CIDR=10.0.0.0/24

# --- PostgreSQL ---
POSTGRES_DB=legal_crm
POSTGRES_BOOTSTRAP_USER=legal_crm_bootstrap
POSTGRES_BOOTSTRAP_PASSWORD=$(gen)
POSTGRES_MIGRATION_USER=legal_crm_migrator
POSTGRES_MIGRATION_PASSWORD=$(gen)
POSTGRES_RUNTIME_USER=legal_crm_runtime
POSTGRES_RUNTIME_PASSWORD=$(gen)
POSTGRES_PLATFORM_USER=legal_crm_platform
POSTGRES_PLATFORM_PASSWORD=$(gen)
POSTGRES_REPORTING_USER=legal_crm_reporting
POSTGRES_REPORTING_PASSWORD=$(gen)
POSTGRES_KEYCLOAK_USER=keycloak
POSTGRES_KEYCLOAK_PASSWORD=$(gen)

# --- Redis ---
REDIS_PASSWORD=$(gen)

# --- Keycloak ---
KEYCLOAK_ADMIN=platform-admin
KEYCLOAK_ADMIN_PASSWORD=$(gen)
KEYCLOAK_CLIENT_ID=legal-crm-web
KEYCLOAK_CLIENT_SECRET=$(gen)

# --- NextAuth ---
NEXTAUTH_SECRET=$(gen)

# --- Inference worker ---
INFERENCE_WORKER_TOKEN=$(gen)
INFERENCE_WORKER_ACTOR_ID=10000000-0000-4000-8000-000000000020

# --- MinIO ---
MINIO_ROOT_USER=minio-admin
MINIO_ROOT_PASSWORD=$(gen)
MINIO_DOCUMENT_BUCKET=legal-documents
MINIO_DOCUMENT_RETENTION_DAYS=365
MINIO_SCANNER_ACCESS_KEY=document-scanner
MINIO_SCANNER_SECRET_KEY=$(gen)

# --- Webhook mappings ---
WEBHOOK_TRUSTED_MAPPINGS=[]
BOOTSTRAP
