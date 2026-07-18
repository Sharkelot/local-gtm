#!/bin/sh
set -eu

iptables=/usr/sbin/iptables

ensure_forward_rule() {
  if ! "$iptables" -C FORWARD "$@" 2>/dev/null; then
    "$iptables" -I FORWARD 1 "$@"
  fi
}

# App CT600 -> PostgreSQL CT601, plus established replies.
ensure_forward_rule -s 10.0.0.70 -d 10.0.0.71 -p tcp --dport 5432 \
  -m conntrack --ctstate NEW,ESTABLISHED -m comment --comment LOCAL-GTM-app-to-postgres -j ACCEPT
ensure_forward_rule -s 10.0.0.71 -d 10.0.0.70 -p tcp --sport 5432 \
  -m conntrack --ctstate ESTABLISHED -m comment --comment LOCAL-GTM-postgres-to-app -j ACCEPT

# Identity CT603 -> its Keycloak schema in PostgreSQL, plus replies.
ensure_forward_rule -s 10.0.0.73 -d 10.0.0.71 -p tcp --dport 5432 \
  -m conntrack --ctstate NEW,ESTABLISHED -m comment --comment LOCAL-GTM-identity-to-postgres -j ACCEPT
ensure_forward_rule -s 10.0.0.71 -d 10.0.0.73 -p tcp --sport 5432 \
  -m conntrack --ctstate ESTABLISHED -m comment --comment LOCAL-GTM-postgres-to-identity -j ACCEPT

# App CT600 -> document bytes, secrets, and malware scanning on CT602.
ensure_forward_rule -s 10.0.0.70 -d 10.0.0.72 -p tcp \
  -m multiport --dports 8200,9000,3310 -m conntrack --ctstate NEW,ESTABLISHED \
  -m comment --comment LOCAL-GTM-app-to-documents -j ACCEPT
ensure_forward_rule -s 10.0.0.72 -d 10.0.0.70 -p tcp \
  -m multiport --sports 8200,9000,3310 -m conntrack --ctstate ESTABLISHED \
  -m comment --comment LOCAL-GTM-documents-to-app -j ACCEPT

# App CT600 -> private Keycloak, Grafana, and OTLP on CT603.
ensure_forward_rule -s 10.0.0.70 -d 10.0.0.73 -p tcp \
  -m multiport --dports 8443,3000,4318 -m conntrack --ctstate NEW,ESTABLISHED \
  -m comment --comment LOCAL-GTM-app-to-identity -j ACCEPT
ensure_forward_rule -s 10.0.0.73 -d 10.0.0.70 -p tcp \
  -m multiport --sports 8443,3000,4318 -m conntrack --ctstate ESTABLISHED \
  -m comment --comment LOCAL-GTM-identity-to-app -j ACCEPT
