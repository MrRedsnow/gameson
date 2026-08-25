#!/usr/bin/env bash
set -Eeuo pipefail

readonly SERVICE_NAME="gameson"
readonly DEFAULT_APP_USER="gameson"
readonly DEFAULT_APP_PORT="3000"
readonly DEFAULT_DATA_DIR="/var/lib/gameson"

usage() {
  cat <<'EOF'
Usage:
  sudo ./scripts/setup-ubuntu.sh <domain> <email>

Example:
  sudo ./scripts/setup-ubuntu.sh games.example.com admin@example.com

Optional environment variables:
  GAMESON_APP_USER   Service account (default: gameson)
  GAMESON_PORT       Internal port (default: 3000)
  GAMESON_DATA_DIR   Persistent database directory (default: /var/lib/gameson)

Run this script from a checked-out Gameson repository. It is safe to rerun
after pulling updates.
EOF
}

fail() {
  echo "Error: $*" >&2
  exit 1
}

if [[ ${1:-} == "-h" || ${1:-} == "--help" ]]; then
  usage
  exit 0
fi

if [[ ${EUID} -ne 0 ]]; then
  fail "run this script as root (sudo)."
fi

if [[ $# -ne 2 ]]; then
  usage
  exit 2
fi

readonly DOMAIN="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
readonly ADMIN_EMAIL="$2"
readonly APP_USER="${GAMESON_APP_USER:-$DEFAULT_APP_USER}"
readonly APP_PORT="${GAMESON_PORT:-$DEFAULT_APP_PORT}"
readonly DATA_DIR="${GAMESON_DATA_DIR:-$DEFAULT_DATA_DIR}"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
readonly APP_GROUP="$APP_USER"
readonly BUILD_USER="$(stat -c '%U' "$APP_DIR")"
readonly BUILD_HOME="$(getent passwd "$BUILD_USER" | cut -d: -f6)"
readonly NGINX_SITE="/etc/nginx/sites-available/$SERVICE_NAME"
readonly SYSTEMD_UNIT="/etc/systemd/system/$SERVICE_NAME.service"
readonly WRANGLER_TMP_DIR="$APP_DIR/dist/server/.wrangler/tmp"
readonly MINIFLARE_CACHE_DIR="$APP_DIR/node_modules/.mf"
readonly SERVICE_TMP_DIR="$DATA_DIR/tmp"

[[ -f /etc/os-release ]] || fail "this setup requires Ubuntu."
# shellcheck disable=SC1091
source /etc/os-release
[[ ${ID:-} == "ubuntu" ]] || fail "this setup supports Ubuntu only."
[[ $DOMAIN =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] || fail "invalid domain: $DOMAIN"
[[ $ADMIN_EMAIL == *@*.* ]] || fail "invalid email address: $ADMIN_EMAIL"
[[ $APP_PORT =~ ^[0-9]+$ ]] && (( APP_PORT >= 1024 && APP_PORT <= 65535 )) || fail "GAMESON_PORT must be between 1024 and 65535."
[[ $APP_USER =~ ^[a-z_][a-z0-9_-]*$ ]] || fail "invalid GAMESON_APP_USER."
[[ $DATA_DIR == /* ]] || fail "GAMESON_DATA_DIR must be an absolute path."
[[ $APP_DIR != *$'\n'* && $APP_DIR != *' '* ]] || fail "the repository path must not contain spaces or newlines."
[[ -n $BUILD_HOME ]] || fail "could not determine the repository owner's home directory."
[[ -f "$APP_DIR/package.json" && -f "$APP_DIR/package-lock.json" ]] || fail "run this script from the Gameson repository."

export DEBIAN_FRONTEND=noninteractive

echo "[1/7] Installing system packages"
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg nginx certbot python3-certbot-nginx

if ! command -v node >/dev/null 2>&1 || (( $(node -p 'Number(process.versions.node.split(".")[0])') < 22 )); then
  echo "[2/7] Installing Node.js 22"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  chmod 0644 /etc/apt/keyrings/nodesource.gpg
  cat > /etc/apt/sources.list.d/nodesource.list <<'EOF'
deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main
EOF
  apt-get update
  apt-get install -y --no-install-recommends nodejs
else
  echo "[2/7] Node.js $(node --version) is already installed"
fi

(( $(node -p 'Number(process.versions.node.split(".")[0])') >= 22 )) || fail "Node.js 22 or newer is required."

echo "[3/7] Preparing the service account and persistent storage"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi
install -d -o "$APP_USER" -g "$APP_GROUP" -m 0750 "$DATA_DIR" "$SERVICE_TMP_DIR"
install -d -o "$BUILD_USER" -g "$APP_GROUP" -m 0770 "$APP_DIR/.wrangler"

echo "[4/7] Installing dependencies and building Gameson"
if systemctl is-active --quiet "$SERVICE_NAME.service"; then
  systemctl stop "$SERVICE_NAME.service"
fi
runuser -u "$BUILD_USER" -- env HOME="$BUILD_HOME" npm --prefix "$APP_DIR" ci
runuser -u "$BUILD_USER" -- env HOME="$BUILD_HOME" npm --prefix "$APP_DIR" run build
[[ -f "$APP_DIR/dist/server/index.js" && -f "$APP_DIR/dist/server/wrangler.json" ]] || fail "the production build is incomplete."
install -d -o "$BUILD_USER" -g "$APP_GROUP" -m 0770 \
  "$WRANGLER_TMP_DIR" \
  "$MINIFLARE_CACHE_DIR"
chgrp -R "$APP_GROUP" "$APP_DIR"
chmod -R g+rX "$APP_DIR"
chmod -R g+rwX "$APP_DIR/.wrangler"
chmod -R g+rwX "$APP_DIR/dist/server/.wrangler" "$MINIFLARE_CACHE_DIR"

echo "[5/7] Installing the 24/7 systemd service"
cat > "$SYSTEMD_UNIT" <<EOF
[Unit]
Description=Gameson party game server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=HOME=$DATA_DIR
Environment=TMPDIR=$SERVICE_TMP_DIR
Environment=WRANGLER_SEND_METRICS=false
Environment=WRANGLER_WRITE_LOGS=false
ExecStart=$APP_DIR/node_modules/.bin/wrangler dev --config $APP_DIR/dist/server/wrangler.json --local --persist-to $DATA_DIR --ip 127.0.0.1 --port $APP_PORT --inspector-ip 127.0.0.1 --inspector-port 9230 --log-level warn --show-interactive-dev-session=false
Restart=always
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGINT
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=read-only
ProtectSystem=full
ReadWritePaths=$DATA_DIR $APP_DIR/.wrangler $APP_DIR/dist/server/.wrangler $MINIFLARE_CACHE_DIR
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME.service"

for attempt in {1..30}; do
  if curl -fs --max-time 3 "http://127.0.0.1:$APP_PORT/" >/dev/null 2>&1; then
    break
  fi
  if (( attempt == 30 )); then
    systemctl status "$SERVICE_NAME.service" --no-pager || true
    journalctl -u "$SERVICE_NAME.service" -n 80 --no-pager || true
    fail "Gameson did not become ready on port $APP_PORT."
  fi
  sleep 1
done

echo "[6/7] Configuring Nginx"
cat > "$NGINX_SITE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    client_max_body_size 2m;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "same-origin" always;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering off;
        proxy_read_timeout 120s;
    }
}
EOF

ln -sfn "$NGINX_SITE" "/etc/nginx/sites-enabled/$SERVICE_NAME"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  ufw allow 'Nginx Full'
fi

echo "[7/7] Requesting and enabling Let's Encrypt SSL"
certbot --nginx --non-interactive --agree-tos --redirect --keep-until-expiring \
  --email "$ADMIN_EMAIL" --domain "$DOMAIN"
systemctl enable --now certbot.timer >/dev/null 2>&1 || true

curl -fsS --max-time 15 "https://$DOMAIN/" >/dev/null || fail "HTTPS health check failed. Check DNS and firewall settings."

cat <<EOF

Gameson is running at https://$DOMAIN

Service status:  systemctl status $SERVICE_NAME
Live logs:       journalctl -u $SERVICE_NAME -f
Database data:  $DATA_DIR

To update later:
  cd $APP_DIR
  sudo -u $BUILD_USER git pull --ff-only
  sudo ./scripts/setup-ubuntu.sh $DOMAIN $ADMIN_EMAIL
EOF
