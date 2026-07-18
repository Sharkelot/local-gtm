#!/bin/sh
set -eu

DOCKER_CE_VERSION=${DOCKER_CE_VERSION:-5:29.6.2-1~debian.12~bookworm}
CONTAINERD_VERSION=${CONTAINERD_VERSION:-2.2.6-1~debian.12~bookworm}
BUILDX_VERSION=${BUILDX_VERSION:-0.35.0-1~debian.12~bookworm}
COMPOSE_VERSION=${COMPOSE_VERSION:-5.3.1-1~debian.12~bookworm}

. /etc/os-release
if [ "${ID:-}" != debian ] || [ "${VERSION_CODENAME:-}" != bookworm ]; then
  echo 'This provisioner requires Debian 12 (bookworm).' >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install --yes --no-install-recommends ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl --fail --silent --show-error --location \
  https://download.docker.com/linux/debian/gpg \
  --output /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

printf '%s\n' \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install --yes --no-install-recommends \
  "docker-ce=${DOCKER_CE_VERSION}" \
  "docker-ce-cli=${DOCKER_CE_VERSION}" \
  "containerd.io=${CONTAINERD_VERSION}" \
  "docker-buildx-plugin=${BUILDX_VERSION}" \
  "docker-compose-plugin=${COMPOSE_VERSION}"

systemctl enable --now docker
docker version --format '{{.Server.Version}}'
docker compose version
