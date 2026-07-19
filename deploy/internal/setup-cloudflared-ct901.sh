#!/usr/bin/env bash
# Install cloudflared on CT901 (crm-proxy-new) and configure tunnel ingress.
# Run as root on the CT901 container via `pct enter 901` or SSH.
#
# Usage:
#   bash setup-cloudflared-ct901.sh
#
# Prerequisites:
#   - Cloudflare tunnel token (create one in Cloudflare Dashboard → Zero Trust → Tunnels)
#   - Save the token to /etc/cloudflared/tunnel-token.txt before running
set -euo pipefail

log() { printf '[setup-cloudflared] %s\n' "$*" >&2; }

TUNNEL_TOKEN_FILE=/etc/cloudflared/tunnel-token.txt
CLOUDFLARED_BIN=/usr/local/bin/cloudflared
CONFIG_DIR=/etc/cloudflared
CONFIG_FILE=$CONFIG_DIR/config.yml
SERVICE_FILE=/etc/systemd/system/cloudflared-tunnel.service

# --- Step 1: Install cloudflared ---
if [ ! -x "$CLOUDFLARED_BIN" ]; then
  log "downloading cloudflared"
  curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -o "$CLOUDFLARED_BIN"
  chmod 0755 "$CLOUDFLARED_BIN"
else
  log "cloudflared already installed at $CLOUDFLARED_BIN"
fi

# --- Step 2: Create config directory ---
install -d -m 0755 "$CONFIG_DIR"

# --- Step 3: Validate tunnel token ---
if [ ! -f "$TUNNEL_TOKEN_FILE" ]; then
  log "ERROR: tunnel token file not found at $TUNNEL_TOKEN_FILE"
  log ""
  log "Create a tunnel in Cloudflare Dashboard:"
  log "  1. Go to Zero Trust → Access → Tunnels"
  log "  2. Create a tunnel named 'local-gtm'"
  log "  3. Copy the tunnel token (long string starting with eyJ...) "
  log "  4. Save it:"
  log "     echo 'eyJ...' > $TUNNEL_TOKEN_FILE"
  log "  5. Re-run this script"
  exit 64
fi

TOKEN=$(tr -d '\r\n' < "$TUNNEL_TOKEN_FILE")
CREDENTIALS_FILE=$CONFIG_DIR/credentials.json

# Write tunnel credentials JSON (token-based auth)
cat > "$CREDENTIALS_FILE" <<CREDJSON
{
  "AccountTag": "",
  "TunnelID": "",
  "TunnelName": "local-gtm",
  "Token": "$TOKEN"
}
CREDJSON
chmod 0600 "$CREDENTIALS_FILE"
if [ "${#TOKEN}" -lt 20 ]; then
  log "ERROR: tunnel token in $TUNNEL_TOKEN_FILE appears too short (${#TOKEN} chars)"
  exit 65
fi

# --- Step 4: Write ingress config ---
log "writing tunnel ingress config"
# Caddy has valid Let's Encrypt certs via Cloudflare DNS challenge.
# Tunnel connects via HTTPS with noTLSVerify since origin IP != domain cert SAN.
cat > "$CONFIG_FILE" <<YAML
tunnel: local-gtm
credentials-file: $CONFIG_DIR/credentials.json
metrics: 127.0.0.1:20241

ingress:
  # CRM application
  - hostname: crm.afterlifehigh.com
    service: https://10.0.0.70:443
    originRequest:
      noTLSVerify: true

  # Keycloak authentication (proxied through Caddy)
  - hostname: auth.afterlifehigh.com
    service: https://10.0.0.70:443
    originRequest:
      noTLSVerify: true

  # Catch-all
  - service: http_status:404
YAML

chmod 0644 "$CONFIG_FILE"

# --- Step 5: Install systemd service ---
log "installing systemd service"
cat > "$SERVICE_FILE" <<UNIT
[Unit]
Description=Cloudflare Tunnel for local-gtm
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$CLOUDFLARED_BIN tunnel --config $CONFIG_FILE run
Restart=always
RestartSec=5
User=root
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$CONFIG_DIR

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable cloudflared-tunnel.service

# --- Step 6: Stop nginx on port 80/443 to free ports for cloudflared ---
# cloudflared tunnel does NOT listen on ports; it connects outbound to Cloudflare edge.
# But nginx currently owns ports 80/443. cloudflared doesn't need them, so
# we can either leave nginx running (harmless but unused) or stop it.
# Stopping also removes a potential confusion point.
log "stopping and disabling nginx (ports 80/443 no longer needed locally)"
systemctl stop nginx 2>/dev/null || true
systemctl disable nginx 2>/dev/null || true

# If nginx was started via Docker or another mechanism, mask it:
systemctl mask nginx 2>/dev/null || true

# --- Step 7: Start tunnel ---
log "starting cloudflared tunnel service"
systemctl start cloudflared-tunnel.service

# --- Step 8: Verify ---
sleep 3
if systemctl is-active -q cloudflared-tunnel.service; then
  log "cloudflared tunnel is RUNNING"
  log ""
  log "Next steps:"
  log "  1. In Cloudflare Dashboard → Zero Trust → Tunnels, verify tunnel shows green"
  log "  2. Public Hostname entries in the tunnel are already defined in the ingress config above"
  log "  3. DNS change (one-time):"
  log "     cloudflared tunnel route dns local-gtm crm.afterlifehigh.com"
  log "     cloudflared tunnel route dns local-gtm auth.afterlifehigh.com"
  log "     (This switches DNS from CDN-proxied A record to CNAME tunnel target)"
  log ""
  log "Test with:"
  log "  curl -sI https://crm.afterlifehigh.com/api/health/live"
  log "  curl -sI https://auth.afterlifehigh.com"
else
  log "ERROR: cloudflared tunnel failed to start"
  journalctl -u cloudflared-tunnel.service --no-pager -n 20
  exit 1
fi
