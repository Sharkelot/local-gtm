#!/usr/bin/env bash
set -eu

# shellcheck disable=SC1091
source "${HOSTS_ENV:-/etc/local-gtm/hosts.env}"

: "${CRM_HOST:?set CRM_HOST}"
: "${INFERENCE_WORKER_IP:?set INFERENCE_WORKER_IP}"

iptables=/usr/sbin/iptables
worker_ip=$INFERENCE_WORKER_IP
ingress_interface=${REDIS_INGRESS_INTERFACE:-eth0}

allow=( -i "$ingress_interface" -s "$worker_ip" -p tcp -m conntrack --ctorigdst "$CRM_HOST" --ctorigdstport 6379 -j ACCEPT )
deny=( -i "$ingress_interface" -p tcp -m conntrack --ctorigdst "$CRM_HOST" --ctorigdstport 6379 -j DROP )

legacy_allow=( -s "$worker_ip" -p tcp -m conntrack --ctorigdst "$CRM_HOST" --ctorigdstport 6379 -j ACCEPT )
legacy_deny=( -p tcp -m conntrack --ctorigdst "$CRM_HOST" --ctorigdstport 6379 -j DROP )
while "$iptables" -C DOCKER-USER "${legacy_allow[@]}" 2>/dev/null; do
  "$iptables" -D DOCKER-USER "${legacy_allow[@]}"
done
while "$iptables" -C DOCKER-USER "${legacy_deny[@]}" 2>/dev/null; do
  "$iptables" -D DOCKER-USER "${legacy_deny[@]}"
done

if ! "$iptables" -C DOCKER-USER "${allow[@]}" 2>/dev/null; then
  "$iptables" -I DOCKER-USER 1 "${allow[@]}"
fi
if ! "$iptables" -C DOCKER-USER "${deny[@]}" 2>/dev/null; then
  "$iptables" -A DOCKER-USER "${deny[@]}"
fi
