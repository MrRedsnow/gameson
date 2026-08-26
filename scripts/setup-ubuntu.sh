#!/usr/bin/env bash
set -Eeuo pipefail

readonly SERVICE_NAME="gameson"
readonly DEFAULT_APP_USER="gameson"
readonly DEFAULT_APP_PORT="3000"
readonly DEFAULT_DATA_DIR="/var/lib/gameson"
readonly DEFAULT_GIT_REMOTE="origin"
readonly DEFAULT_CERT_RENEW_DAYS="30"

usage() {
  cat <<'EOF'
Usage:
  sudo ./scripts/setup-ubuntu.sh <domain> <email>

Example:
  sudo ./scripts/setup-ubuntu.sh games.example.com admin@example.com

Optional environment variables:
  GAMESON_APP_USER          Service account (default: gameson)
  GAMESON_PORT              Internal port (default: 3000)
  GAMESON_DATA_DIR          Persistent database directory (default: /var/lib/gameson)
  GAMESON_GIT_REMOTE        Git remote to update from (default: origin)
  GAMESON_GIT_BRANCH        Git branch to update (default: current branch)
  GAMESON_UPDATE_REPO       Set to 0 to deploy the current checkout without fetching (default: 1)
  GAMESON_FORCE_REBUILD     Set to 1 to rebuild even when the deployed revision is unchanged
  GAMESON_CERT_RENEW_DAYS   Renew certificates expiring within this many days (default: 30)

Run this script from a checked-out Gameson repository. The same command handles
the first installation and later updates. It preserves the D1 data directory,
accepts only fast-forward repository updates, and reuses valid SSL certificates.
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
readonly GIT_REMOTE="${GAMESON_GIT_REMOTE:-$DEFAULT_GIT_REMOTE}"
readonly CONFIGURED_GIT_BRANCH="${GAMESON_GIT_BRANCH:-}"
readonly UPDATE_REPO="${GAMESON_UPDATE_REPO:-1}"
readonly FORCE_REBUILD="${GAMESON_FORCE_REBUILD:-0}"
readonly CERT_RENEW_DAYS="${GAMESON_CERT_RENEW_DAYS:-$DEFAULT_CERT_RENEW_DAYS}"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
readonly BUILD_USER="$(stat -c '%U' "$APP_DIR")"
readonly BUILD_GROUP="$(id -gn "$BUILD_USER")"
readonly BUILD_HOME="$(getent passwd "$BUILD_USER" | cut -d: -f6)"
readonly NGINX_SITE="/etc/nginx/sites-available/$SERVICE_NAME"
readonly SYSTEMD_UNIT="/etc/systemd/system/$SERVICE_NAME.service"
readonly WRANGLER_TMP_DIR="$APP_DIR/dist/server/.wrangler/tmp"
readonly MINIFLARE_CACHE_DIR="$APP_DIR/node_modules/.mf"
readonly SERVICE_TMP_DIR="$DATA_DIR/tmp"
readonly DEPENDENCY_STAMP="$APP_DIR/node_modules/.gameson-dependency-hash"
readonly BUILD_STAMP="$APP_DIR/dist/.gameson-build-revision"

APP_GROUP=""
GIT_BRANCH=""
CERT_RENEW_SECONDS=""
LOCAL_TREE_DIRTY=0
SERVICE_WAS_ACTIVE=0
SERVICE_RESTARTED=0
SCRIPT_SUCCEEDED=0

cleanup() {
  local exit_code=$?
  if (( SCRIPT_SUCCEEDED == 0 && SERVICE_WAS_ACTIVE == 1 && SERVICE_RESTARTED == 0 )); then
    echo "Setup failed; attempting to restore the previously running service." >&2
    systemctl start "$SERVICE_NAME.service" >/dev/null 2>&1 || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT

run_as_build_user() {
  runuser -u "$BUILD_USER" -- env HOME="$BUILD_HOME" "$@"
}

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
[[ $UPDATE_REPO == 0 || $UPDATE_REPO == 1 ]] || fail "GAMESON_UPDATE_REPO must be 0 or 1."
[[ $FORCE_REBUILD == 0 || $FORCE_REBUILD == 1 ]] || fail "GAMESON_FORCE_REBUILD must be 0 or 1."
[[ $CERT_RENEW_DAYS =~ ^[0-9]+$ ]] && (( CERT_RENEW_DAYS >= 1 && CERT_RENEW_DAYS <= 30 )) || fail "GAMESON_CERT_RENEW_DAYS must be between 1 and 30."
[[ $GIT_REMOTE =~ ^[a-zA-Z0-9._-]+$ ]] || fail "GAMESON_GIT_REMOTE must be a Git remote name."
CERT_RENEW_SECONDS="$((CERT_RENEW_DAYS * 86400))"

export DEBIAN_FRONTEND=noninteractive

echo "[1/8] Updating the Gameson repository"
command -v git >/dev/null 2>&1 || fail "Git is required because this script runs from a Git checkout."
run_as_build_user git -C "$APP_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "the Gameson directory is not a Git checkout."

tracked_changes="$(run_as_build_user git -C "$APP_DIR" status --porcelain --untracked-files=no)"
if [[ -n $tracked_changes ]]; then
  if [[ $UPDATE_REPO == 1 ]]; then
    fail "the repository contains tracked local changes. Commit or stash them, or rerun with GAMESON_UPDATE_REPO=0."
  fi
  LOCAL_TREE_DIRTY=1
fi

if [[ -n $CONFIGURED_GIT_BRANCH ]]; then
  GIT_BRANCH="$CONFIGURED_GIT_BRANCH"
else
  GIT_BRANCH="$(run_as_build_user git -C "$APP_DIR" symbolic-ref --quiet --short HEAD)" || fail "detached HEAD: set GAMESON_GIT_BRANCH explicitly."
fi
run_as_build_user git check-ref-format --branch "$GIT_BRANCH" >/dev/null 2>&1 || fail "invalid Git branch: $GIT_BRANCH"

if [[ $UPDATE_REPO == 1 ]]; then
  before_revision="$(run_as_build_user git -C "$APP_DIR" rev-parse HEAD)"
  before_script_hash="$(sha256sum "${BASH_SOURCE[0]}" | cut -d' ' -f1)"
  run_as_build_user git -C "$APP_DIR" fetch --prune "$GIT_REMOTE" "$GIT_BRANCH"
  run_as_build_user git -C "$APP_DIR" merge --ff-only FETCH_HEAD
  after_revision="$(run_as_build_user git -C "$APP_DIR" rev-parse HEAD)"
  after_script_hash="$(sha256sum "$APP_DIR/scripts/setup-ubuntu.sh" | cut -d' ' -f1)"

  if [[ $before_revision != "$after_revision" ]]; then
    echo "Repository updated: ${before_revision:0:12} -> ${after_revision:0:12}"
  else
    echo "Repository is already up to date at ${after_revision:0:12}."
  fi

  if [[ $before_script_hash != "$after_script_hash" && ${GAMESON_SETUP_REEXECUTED:-0} != 1 ]]; then
    echo "The setup script was updated; continuing with the new version."
    export GAMESON_SETUP_REEXECUTED=1
    exec "$APP_DIR/scripts/setup-ubuntu.sh" "$DOMAIN" "$ADMIN_EMAIL"
  fi
else
  echo "Repository update skipped (GAMESON_UPDATE_REPO=0)."
fi

echo "[2/8] Installing system packages"
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git gnupg nginx openssl certbot python3-certbot-nginx

if ! command -v node >/dev/null 2>&1 || (( $(node -p 'Number(process.versions.node.split(".")[0])') < 22 )); then
  echo "[3/8] Installing Node.js 22"
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
  echo "[3/8] Node.js $(node --version) is already installed"
fi

(( $(node -p 'Number(process.versions.node.split(".")[0])') >= 22 )) || fail "Node.js 22 or newer is required."

echo "[4/8] Preparing the service account and persistent storage"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi
APP_GROUP="$(id -gn "$APP_USER")"
install -d -o "$APP_USER" -g "$APP_GROUP" -m 0750 "$DATA_DIR" "$SERVICE_TMP_DIR"
install -d -o "$BUILD_USER" -g "$APP_GROUP" -m 0770 "$APP_DIR/.wrangler"

echo "[5/8] Installing dependencies and building Gameson when required"
dependency_hash="$({ node --version; sha256sum "$APP_DIR/package.json" "$APP_DIR/package-lock.json"; } | sha256sum | cut -d' ' -f1)"
source_revision="$(run_as_build_user git -C "$APP_DIR" rev-parse HEAD)"
expected_build_revision="$source_revision:$dependency_hash"
dependencies_changed=0
build_required=0

if [[ ! -x "$APP_DIR/node_modules/.bin/wrangler" || ! -f $DEPENDENCY_STAMP || $(<"$DEPENDENCY_STAMP") != "$dependency_hash" ]]; then
  dependencies_changed=1
  build_required=1
fi
if [[ ! -f "$APP_DIR/dist/server/index.js" || ! -f "$APP_DIR/dist/server/wrangler.json" || ! -f $BUILD_STAMP || $(<"$BUILD_STAMP") != "$expected_build_revision" ]]; then
  build_required=1
fi
if (( FORCE_REBUILD == 1 || LOCAL_TREE_DIRTY == 1 )); then
  build_required=1
fi

if systemctl is-active --quiet "$SERVICE_NAME.service"; then
  SERVICE_WAS_ACTIVE=1
fi

if (( build_required == 1 )); then
  if (( SERVICE_WAS_ACTIVE == 1 )); then
    systemctl stop "$SERVICE_NAME.service"
  fi
  if (( dependencies_changed == 1 )); then
    run_as_build_user npm --prefix "$APP_DIR" ci
    install -o "$BUILD_USER" -g "$BUILD_GROUP" -m 0644 /dev/null "$DEPENDENCY_STAMP"
    printf '%s\n' "$dependency_hash" > "$DEPENDENCY_STAMP"
  else
    echo "Dependencies match package-lock.json; npm ci is not required."
  fi
  run_as_build_user npm --prefix "$APP_DIR" run build
  [[ -f "$APP_DIR/dist/server/index.js" && -f "$APP_DIR/dist/server/wrangler.json" ]] || fail "the production build is incomplete."
  install -o "$BUILD_USER" -g "$BUILD_GROUP" -m 0644 /dev/null "$BUILD_STAMP"
  printf '%s\n' "$expected_build_revision" > "$BUILD_STAMP"
else
  echo "The production build already matches ${source_revision:0:12}; rebuilding is not required."
fi

install -d -o "$BUILD_USER" -g "$APP_GROUP" -m 0770 "$WRANGLER_TMP_DIR" "$MINIFLARE_CACHE_DIR"
chgrp "$APP_GROUP" "$APP_DIR"
chmod g+rx "$APP_DIR"
chgrp -R "$APP_GROUP" "$APP_DIR/node_modules" "$APP_DIR/dist" "$APP_DIR/.wrangler"
chmod -R g+rX "$APP_DIR/node_modules" "$APP_DIR/dist" "$APP_DIR/.wrangler"
chmod -R g+rwX "$APP_DIR/.wrangler" "$APP_DIR/dist/server/.wrangler" "$MINIFLARE_CACHE_DIR"

echo "[6/8] Installing and starting the 24/7 systemd service"
unit_tmp="$(mktemp)"
cat > "$unit_tmp" <<EOF
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

unit_changed=0
if [[ ! -f $SYSTEMD_UNIT ]] || ! cmp -s "$unit_tmp" "$SYSTEMD_UNIT"; then
  install -m 0644 "$unit_tmp" "$SYSTEMD_UNIT"
  unit_changed=1
fi
rm -f "$unit_tmp"

if (( unit_changed == 1 )); then
  systemctl daemon-reload
fi
systemctl enable "$SERVICE_NAME.service" >/dev/null
if (( build_required == 1 || unit_changed == 1 )) || ! systemctl is-active --quiet "$SERVICE_NAME.service"; then
  systemctl restart "$SERVICE_NAME.service"
fi
SERVICE_RESTARTED=1

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

find_certificate_dir() {
  local candidate
  [[ -d /etc/letsencrypt/live ]] || return 1
  while IFS= read -r -d '' candidate; do
    [[ -f "$candidate/fullchain.pem" && -f "$candidate/privkey.pem" ]] || continue
    if openssl x509 -in "$candidate/fullchain.pem" -noout -checkhost "$DOMAIN" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done < <(find /etc/letsencrypt/live -mindepth 1 -maxdepth 1 -type d -print0)
  return 1
}

certificate_dir="$(find_certificate_dir || true)"

echo "[7/8] Configuring Nginx"
nginx_tmp="$(mktemp)"
if [[ -n $certificate_dir ]]; then
  [[ -f /etc/letsencrypt/options-ssl-nginx.conf && -f /etc/letsencrypt/ssl-dhparams.pem ]] || fail "the existing certificate is missing Certbot's Nginx TLS support files."
  cat > "$nginx_tmp" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN;

    ssl_certificate $certificate_dir/fullchain.pem;
    ssl_certificate_key $certificate_dir/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

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
else
  cat > "$nginx_tmp" <<EOF
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
fi

nginx_changed=0
if [[ ! -f $NGINX_SITE ]] || ! cmp -s "$nginx_tmp" "$NGINX_SITE"; then
  install -m 0644 "$nginx_tmp" "$NGINX_SITE"
  nginx_changed=1
fi
rm -f "$nginx_tmp"

ln -sfn "$NGINX_SITE" "/etc/nginx/sites-enabled/$SERVICE_NAME"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
if (( nginx_changed == 1 )); then
  systemctl reload nginx
fi

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  ufw allow 'Nginx Full'
fi

echo "[8/8] Checking Let's Encrypt SSL"
if [[ -z $certificate_dir ]]; then
  echo "No certificate for $DOMAIN exists yet; requesting the initial certificate."
  certbot --nginx --non-interactive --agree-tos --redirect \
    --email "$ADMIN_EMAIL" --domain "$DOMAIN" --cert-name "$DOMAIN"
elif openssl x509 -in "$certificate_dir/fullchain.pem" -noout -checkend "$CERT_RENEW_SECONDS"; then
  certificate_expiry="$(openssl x509 -in "$certificate_dir/fullchain.pem" -noout -enddate | cut -d= -f2-)"
  echo "Certificate is valid beyond the renewal window (expires $certificate_expiry); Certbot is not required."
else
  certificate_name="$(basename "$certificate_dir")"
  echo "Certificate expires within $CERT_RENEW_DAYS days; renewing $certificate_name."
  certbot renew --non-interactive --cert-name "$certificate_name" --deploy-hook "systemctl reload nginx"
fi
systemctl enable --now certbot.timer >/dev/null 2>&1 || true

curl -fsS --max-time 15 "https://$DOMAIN/" >/dev/null || fail "HTTPS health check failed. Check DNS and firewall settings."

SCRIPT_SUCCEEDED=1
current_revision="$(run_as_build_user git -C "$APP_DIR" rev-parse --short=12 HEAD)"
cat <<EOF

Gameson $current_revision is running at https://$DOMAIN

Service status:  systemctl status $SERVICE_NAME
Live logs:       journalctl -u $SERVICE_NAME -f
Database data:  $DATA_DIR

To install future updates, run the same command again:
  cd $APP_DIR
  sudo ./scripts/setup-ubuntu.sh $DOMAIN $ADMIN_EMAIL
EOF
