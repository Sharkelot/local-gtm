#!/usr/bin/env bash
set -eu

iptables=/usr/sbin/iptables
worker_ip=${INFERENCE_WORKER_IP:-10.0.0.3}
ingress_interface=${REDIS_INGRESS_INTERFACE:-eth0}

# DOCKER-USER sees the packet after DNAT, so match the original destination.
# Scope the rules to ingress so the deny rule cannot also drop the return half
# of an accepted connection as it leaves the Docker bridge.
allow=( -i "$ingress_interface" -s "$worker_ip" -p tcp -m conntrack --ctorigdst 10.0.0.70 --ctorigdstport 6379 -j ACCEPT )
deny=( -i "$ingress_interface" -p tcp -m conntrack --ctorigdst 10.0.0.70 --ctorigdstport 6379 -j DROP )

# Remove the original unscoped rules during an in-place upgrade. Their deny
# rule also matched Redis replies and made the source allowlist one-way only.
legacy_allow=( -s "$worker_ip" -p tcp -m conntrack --ctorigdst 10.0.0.70 --ctorigdstport 6379 -j ACCEPT )
legacy_deny=( -p tcp -m conntrack --ctorigdst 10.0.0.70 --ctorigdstport 6379 -j DROP )
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
