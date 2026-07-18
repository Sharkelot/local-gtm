#!/usr/bin/env bash
set -euo pipefail

# This script runs only while PostgreSQL initializes an empty data directory.
# Passwords are supplied by the deployment secret source; never add them here.
psql --set ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set migration_user="$POSTGRES_MIGRATION_USER" \
  --set migration_password="$POSTGRES_MIGRATION_PASSWORD" \
  --set runtime_user="$POSTGRES_RUNTIME_USER" \
  --set runtime_password="$POSTGRES_RUNTIME_PASSWORD" \
  --set platform_user="$POSTGRES_PLATFORM_USER" \
  --set platform_password="$POSTGRES_PLATFORM_PASSWORD" \
  --set reporting_user="$POSTGRES_REPORTING_USER" \
  --set reporting_password="$POSTGRES_REPORTING_PASSWORD" \
  --set keycloak_user="$POSTGRES_KEYCLOAK_USER" \
  --set keycloak_password="$POSTGRES_KEYCLOAK_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'migration_user', :'migration_password') \gexec
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'runtime_user', :'runtime_password') \gexec
-- Platform operations intentionally need cross-tenant access for durable outbox
-- dispatch and the authenticated inference-worker internal API. This is the sole
-- RLS exception and is not an owner or schema-migration role.
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS PASSWORD %L', :'platform_user', :'platform_password') \gexec
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'reporting_user', :'reporting_password') \gexec
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'keycloak_user', :'keycloak_password') \gexec

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('GRANT CONNECT ON DATABASE %I TO %I, %I, %I, %I, %I', current_database(), :'migration_user', :'runtime_user', :'platform_user', :'reporting_user', :'keycloak_user') \gexec
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'migration_user') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I, %I, %I', :'runtime_user', :'platform_user', :'reporting_user') \gexec
SELECT format('CREATE SCHEMA keycloak AUTHORIZATION %I', :'keycloak_user') \gexec

-- Prisma creates all application objects as the migration role. These default
-- grants let a new migration become usable without making a runtime role owner.
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I, %I', :'migration_user', :'runtime_user', :'platform_user') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO %I', :'migration_user', :'reporting_user') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I, %I, %I', :'migration_user', :'runtime_user', :'platform_user', :'reporting_user') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO %I, %I', :'migration_user', :'runtime_user', :'platform_user') \gexec
SQL
