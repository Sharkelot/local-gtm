#!/usr/bin/env bash
# Provision the local-gtm-deployer CT (or any management machine).
# Run as root on the deployer CT after a clean Debian/Ubuntu install.
#
# Usage:
#   bash setup-deployer.sh
#
# Prerequisites:
#   - Deployer CT has outbound HTTPS (registry, git, cloudflare api)
#   - A cloudflared tunnel token at /etc/cloudflared/tunnel-token.txt
#   - An SSH keypair for the local-gtm-deploy user
#   - CRM CT600 has the matching public key in ~deploy/.ssh/authorized_keys
set -euo pipefail

log() { printf '[setup-deployer] %s\n' "$*" >&2; }

DEPLOY_USER=local-gtm-deploy
DEPLOY_GROUP=local-gtm-deploy
DEPLOY_HOME=/var/lib/local-gtm-deployer
DEPLOY_SCRIPT_DIR=/opt/local-gtm/deploy
LOCAL_GTM_ETC=/etc/local-gtm
REPO_URL=git@github.com:Sharkelot/local-gtm-internal.git
REPO_BRANCH=ci/public-safe-pipeline

# --- Step 1: System packages ---
log "installing system packages"
apt-get update -qq
apt-get install -y -qq \
  curl docker.io docker-compose-v2 git openssl systemd

# --- Step 2: Create deploy user ---
log "creating deploy user and group"
groupadd -f "$DEPLOY_GROUP"
if ! id "$DEPLOY_USER" &>/dev/null; then
  useradd -m -d "$DEPLOY_HOME" -g "$DEPLOY_GROUP" -s /usr/sbin/nologin "$DEPLOY_USER"
fi

# --- Step 3: Directory layout ---
log "creating directory layout"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 0750 \
  "$LOCAL_GTM_ETC" \
  "$LOCAL_GTM_ETC/ca" \
  "$LOCAL_GTM_ETC/caddy" \
  /etc/cloudflared

install -d -o root -g root -m 0755 "$DEPLOY_SCRIPT_DIR"

# --- Step 4: Clone private repo ---
log "cloning internal repository (initial fetch)"
if [ ! -d "$DEPLOY_SCRIPT_DIR/.git" ]; then
  git clone --branch "$REPO_BRANCH" --single-branch "$REPO_URL" "$DEPLOY_SCRIPT_DIR"
else
  cd "$DEPLOY_SCRIPT_DIR" && git fetch origin && git reset --hard "origin/$REPO_BRANCH"
fi
chown -R root:root "$DEPLOY_SCRIPT_DIR"

# --- Step 5: Systemd service and timer ---
log "installing systemd units"
cp "$DEPLOY_SCRIPT_DIR/deploy/local-gtm-deployer.service" /etc/systemd/system/
cp "$DEPLOY_SCRIPT_DIR/deploy/local-gtm-deployer.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now local-gtm-deployer.timer

# --- Step 6: Deployment env ---
log "creating deployment.env"
cat > "$LOCAL_GTM_ETC/deployment.env" <<ENV
# local-gtm-deployer configuration
GHCR_REGISTRY=ghcr.io
GHCR_REPOSITORY=sharkelot/local-gtm
WEB_IMAGE_NAME=legal-crm-web
PLATFORM_WORKER_IMAGE_NAME=legal-crm-platform-worker
MIGRATOR_IMAGE_NAME=legal-crm-migrator
IMAGE_NAME=legal-crm-web

# Approved digest file path (must contain allowed SHA256 digest)
APPROVED_DIGEST_FILE=${LOCAL_GTM_ETC}/approved-digest
CURRENT_DIGEST_FILE=${LOCAL_GTM_ETC}/current-digest
PREVIOUS_DIGEST_FILE=${LOCAL_GTM_ETC}/previous-digest

DEPLOY_METADATA_DIR=${LOCAL_GTM_ETC}/deployments
LOCK_FILE=/tmp/local-gtm-deploy.lock
HEALTH_CHECK_SCRIPT=${DEPLOY_SCRIPT_DIR}/deploy/health-check.sh
ROLLBACK_SCRIPT=${DEPLOY_SCRIPT_DIR}/deploy/rollback.sh
PUBLIC_CRM_URL=https://crm.afterlifehigh.com
DEPLOY_SCRIPT=${DEPLOY_SCRIPT_DIR}/deploy/deploy.sh

# SSH deployment target
DEPLOY_USER=${DEPLOY_USER}
CRM_HOST=10.0.0.70
SSH_IDENTITY_FILE=${DEPLOY_HOME}/.ssh/id_ed25519
SSH_KNOWN_HOSTS_FILE=${DEPLOY_HOME}/.ssh/known_hosts
REMOTE_COMPOSE_DIR=/opt/local-gtm/deploy/split
REMOTE_ENV_FILE=/opt/local-gtm/deploy/split/app.env
ENV

# --- Step 7: Permissions ---
chmod 0640 "$LOCAL_GTM_ETC/deployment.env"
chown -R root:"$DEPLOY_GROUP" "$LOCAL_GTM_ETC"

# --- Step 8: Post-install instructions ---
cat <<INSTRUCTIONS

=== post-install steps (manual) ===

1. Set up Cloudflare Tunnel on CT901:
     scp ${DEPLOY_SCRIPT_DIR}/deploy/internal/setup-cloudflared-ct901.sh root@10.0.0.13?:
     ssh root@CT901 bash setup-cloudflared-ct901.sh
   (This replaces nginx with cloudflared for ingress)

2. Copy the inter-CT CA bundle:
     scp root@10.0.0.70:/etc/local-gtm/ca/inter-ct-ca-bundle.pem ${LOCAL_GTM_ETC}/ca/

3. Generate the bootstrap env and render per-CT environments:
     bash ${DEPLOY_SCRIPT_DIR}/deploy/internal/bootstrap-env.sh > ${LOCAL_GTM_ETC}/bootstrap.env
     source ${LOCAL_GTM_ETC}/bootstrap.env && \\
       bash ${DEPLOY_SCRIPT_DIR}/deploy/split/render-proxmox-envs.sh \\
         ${LOCAL_GTM_ETC}/bootstrap.env \\
         /etc/cloudflared/tunnel-token.txt \\
         ${LOCAL_GTM_ETC}/

4. Render app.env and copy to CT600:
     cp ${LOCAL_GTM_ETC}/app.env /opt/local-gtm/deploy/split/app.env

5. Approve a digest for auto-deployment:
     echo "sha256:..." > ${LOCAL_GTM_ETC}/approved-digest

6. Verify the timer:
     systemctl status local-gtm-deployer.timer

INSTRUCTIONS
