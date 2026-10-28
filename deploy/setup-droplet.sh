#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu droplet (22.04 or 24.04). Run as root:
#
#   git clone <git-clone-url> /opt/keepsharpening
#   bash /opt/keepsharpening/deploy/setup-droplet.sh <git-clone-url>
#
# Safe to re-run.
set -euo pipefail

REPO_URL="${1:?usage: setup-droplet.sh <git-clone-url>}"
APP_USER=keepsharpening
REPO_DIR=/opt/keepsharpening
WEB_ROOT=/var/www/keepsharpening
LOG_DIR=/var/log/keepsharpening

[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }

echo "== packages"
apt-get update
apt-get install -y git rsync curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

# Node.js 20 LTS from NodeSource
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# Caddy from its official apt repository
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

echo "== user and directories"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
mkdir -p "$WEB_ROOT" "$LOG_DIR"
chown "$APP_USER:$APP_USER" "$WEB_ROOT" "$LOG_DIR"
chmod 755 "$WEB_ROOT"

echo "== repository"
if [ ! -d "$REPO_DIR/.git" ]; then
  git clone "$REPO_URL" "$REPO_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$REPO_DIR"

echo "== first build"
sudo -u "$APP_USER" "$REPO_DIR/deploy/deploy.sh"

echo "== caddy, cron, logrotate"
install -m 644 "$REPO_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
install -m 644 "$REPO_DIR/deploy/keepsharpening.cron" /etc/cron.d/keepsharpening
install -m 644 "$REPO_DIR/deploy/keepsharpening.logrotate" /etc/logrotate.d/keepsharpening
systemctl enable --now caddy
systemctl reload caddy

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp
  ufw allow 443/tcp
fi

echo "== done. Visit https://keepsharpening.com (first certificate can take a minute)."
