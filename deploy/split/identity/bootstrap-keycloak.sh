#!/usr/bin/env bash
set -euo pipefail

required=(
  KC_BOOTSTRAP_ADMIN_USERNAME KC_BOOTSTRAP_ADMIN_PASSWORD
  KEYCLOAK_CLIENT_ID KEYCLOAK_CLIENT_SECRET
  EVE_ADMIN_PASSWORD REALM_ADMIN_PASSWORD
  KEYCLOAK_SERVER APP_DOMAIN KEYCLOAK_REALM_ADMIN_EMAIL
)
for name in "${required[@]}"; do
  if [ -z "${!name:-}" ]; then
    echo "missing Keycloak bootstrap value: $name" >&2
    exit 65
  fi
done

server=$KEYCLOAK_SERVER
realm=legal-crm
config=/tmp/local-gtm-kcadm.config
truststore=/tmp/local-gtm-admin-truststore.p12
trustpass=local-gtm-ca-trust
kcadm=/opt/keycloak/bin/kcadm.sh
crm_base_url="https://${APP_DOMAIN}"

rm -f "$truststore"
keytool -importcert -noprompt -alias local-gtm-inter-ct-ca \
  -file /run/postgresql-ca/root.crt -keystore "$truststore" \
  -storetype PKCS12 -storepass "$trustpass" >/dev/null

kc() {
  "$kcadm" "$@" --config "$config" --truststore "$truststore" --trustpass "$trustpass"
}

kc config credentials --server "$server" --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD"

if ! kc get "realms/$realm" >/dev/null 2>&1; then
  kc create realms \
    -s "realm=$realm" \
    -s enabled=true \
    -s sslRequired=all \
    -s registrationAllowed=false \
    -s resetPasswordAllowed=false \
    -s rememberMe=false \
    -s loginWithEmailAllowed=true \
    -s duplicateEmailsAllowed=false
fi

kc update "realms/$realm" \
  -s enabled=true \
  -s sslRequired=all \
  -s registrationAllowed=false \
  -s resetPasswordAllowed=false \
  -s rememberMe=false \
  -s loginWithEmailAllowed=true \
  -s duplicateEmailsAllowed=false \
  -s bruteForceProtected=true \
  -s failureFactor=5 \
  -s waitIncrementSeconds=60 \
  -s maxFailureWaitSeconds=900 \
  -s 'passwordPolicy=length(14) and digits(1) and lowerCase(1) and upperCase(1) and specialChars(1)'

client_uuid=$(kc get clients -r "$realm" -q "clientId=$KEYCLOAK_CLIENT_ID" \
  --fields id --format csv --noquotes 2>/dev/null | grep -E '^[0-9a-f-]{36}$' | head -n 1 || true)

client_settings=(
  -s "clientId=$KEYCLOAK_CLIENT_ID"
  -s enabled=true
  -s publicClient=false
  -s "secret=$KEYCLOAK_CLIENT_SECRET"
  -s standardFlowEnabled=true
  -s directAccessGrantsEnabled=false
  -s serviceAccountsEnabled=false
  -s "redirectUris=[\"${crm_base_url}/api/auth/callback/keycloak\"]"
  -s "webOrigins=[\"${crm_base_url}\"]"
  -s "attributes={\"post.logout.redirect.uris\":\"${crm_base_url}/*\",\"pkce.code.challenge.method\":\"S256\"}"
)
if [ -z "$client_uuid" ]; then
  kc create clients -r "$realm" "${client_settings[@]}" >/dev/null
else
  kc update "clients/$client_uuid" -r "$realm" "${client_settings[@]}"
fi

ensure_user() {
  local username=$1
  local email=$2
  local password=$3
  local first_name=$4
  local last_name=$5

  local user_id
  user_id=$(kc get users -r "$realm" -q "username=$username" --fields id \
    --format csv --noquotes 2>/dev/null | grep -E '^[0-9a-f-]{36}$' | head -n 1 || true)
  if [ -z "$user_id" ]; then
    kc create users -r "$realm" \
      -s "username=$username" -s "email=$email" \
      -s "firstName=$first_name" -s "lastName=$last_name" \
      -s enabled=true -s emailVerified=true >/dev/null
    user_id=$(kc get users -r "$realm" -q "username=$username" --fields id \
      --format csv --noquotes | grep -E '^[0-9a-f-]{36}$' | head -n 1)
  fi
  kc update "users/$user_id" -r "$realm" \
    -s enabled=true -s emailVerified=true -s 'requiredActions=["CONFIGURE_TOTP"]'
  kc set-password -r "$realm" --username "$username" \
    --new-password "$password" --temporary=false
}

ensure_user eve-admin eve.admin@example.test "$EVE_ADMIN_PASSWORD" Eve Administrator
ensure_user local-gtm-realm-admin "$KEYCLOAK_REALM_ADMIN_EMAIL" \
  "$REALM_ADMIN_PASSWORD" Local-GTM Administrator

# This operation is idempotent in Keycloak; it does not broaden the application user.
kc add-roles -r "$realm" --uusername local-gtm-realm-admin \
  --cclientid realm-management --rolename realm-admin

master_admin_id=$(kc get users -r master -q "username=$KC_BOOTSTRAP_ADMIN_USERNAME" \
  --fields id --format csv --noquotes 2>/dev/null | grep -E '^[0-9a-f-]{36}$' | head -n 1 || true)
if [ -n "$master_admin_id" ]; then
  kc update "users/$master_admin_id" -r master -s 'requiredActions=["CONFIGURE_TOTP"]'
fi

echo "keycloak-bootstrap=complete realm=$realm mfa-required=true"
