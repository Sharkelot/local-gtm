#!/bin/sh
set -eu

# shellcheck disable=SC1091
. "${HOSTS_ENV:-/etc/local-gtm/hosts.env}"

: "${CRM_HOST:?set CRM_HOST}"
: "${DATABASE_HOST:?set DATABASE_HOST}"
: "${DOCUMENT_HOST:?set DOCUMENT_HOST}"
: "${IDENTITY_HOST:?set IDENTITY_HOST}"

iptables=/usr/sbin/iptables

ensure_forward_rule() {
  if ! "$iptables" -C FORWARD "$@" 2>/dev/null; then
    "$iptables" -I FORWARD 1 "$@"
  fi
}

ensure_forward_rule -s "$CRM_HOST" -d "$DATABASE_HOST" -p tcp --dport 5432 \
  -m conntrack --ctstate NEW,ESTABLISHED -m comment --comment LOCAL-GTM-app-to-postgres -j ACCEPT
ensure_forward_rule -s "$DATABASE_HOST" -d "$CRM_HOST" -p tcp --sport 5432 \
  -m conntrack --ctstate ESTABLISHED -m comment --comment LOCAL-GTM-postgres-to-app -j ACCEPT

ensure_forward_rule -s "$IDENTITY_HOST" -d "$DATABASE_HOST" -p tcp --dport 5432 \
  -m conntrack --ctstate NEW,ESTABLISHED -m comment --comment LOCAL-GTM-identity-to-postgres -j ACCEPT
ensure_forward_rule -s "$DATABASE_HOST" -d "$IDENTITY_HOST" -p tcp --sport 5432 \
  -m conntrack --ctstate ESTABLISHED -m comment --comment LOCAL-GTM-postgres-to-identity -j ACCEPT

ensure_forward_rule -s "$CRM_HOST" -d "$DOCUMENT_HOST" -p tcp \
  -m multiport --dports 8200,9000,3310 -m conntrack --ctstate NEW,ESTABLISHED \
  -m comment --comment LOCAL-GTM-app-to-documents -j ACCEPT
ensure_forward_rule -s "$DOCUMENT_HOST" -d "$CRM_HOST" -p tcp \
  -m multiport --sports 8200,9000,3310 -m conntrack --ctstate ESTABLISHED \
  -m comment --comment LOCAL-GTM-documents-to-app -j ACCEPT

ensure_forward_rule -s "$CRM_HOST" -d "$IDENTITY_HOST" -p tcp \
  -m multiport --dports 8443,3000,4318 -m conntrack --ctstate NEW,ESTABLISHED \
  -m comment --comment LOCAL-GTM-app-to-identity -j ACCEPT
ensure_forward_rule -s "$IDENTITY_HOST" -d "$CRM_HOST" -p tcp \
  -m multiport --sports 8443,3000,4318 -m conntrack --ctstate ESTABLISHED \
  -m comment --comment LOCAL-GTM-identity-to-app -j ACCEPT
