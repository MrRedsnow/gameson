# Gameson

Mobile German party games for multiple phones or one shared device. The app
currently includes Imposter and Werwolf, with persistent lobby state in a local
Cloudflare D1-compatible SQLite store.

## Prerequisites

- Node.js `>=22.13.0`

## Local development

```bash
npm install
npm run dev
npm run build
npm test
```

## Ubuntu 24/7 hosting with HTTPS

The included setup supports Ubuntu 22.04 and 24.04. It installs Node.js 22,
Nginx, systemd, Certbot, and a persistent local Worker/D1 runtime. Before
starting, point the domain's `A`/`AAAA` records to the server and allow inbound
TCP ports 80 and 443. The application runtime listens only on
`127.0.0.1:3000`; Nginx is the public endpoint and serves HTTPS on port 443.

```bash
sudo install -d -o "$USER" -g "$(id -gn)" /opt/gameson
git clone git@github.com:MrRedsnow/gameson.git /opt/gameson
cd /opt/gameson
sudo ./scripts/setup-ubuntu.sh games.example.com admin@example.com
```

The setup script is an idempotent installer and updater. On every later run it
fetches the current branch from `origin`, accepts only a clean fast-forward
update, installs changed dependencies, rebuilds when required, and restarts the
service. Lobby data is stored outside the repository in `/var/lib/gameson`, so
deployments and rebuilds do not erase active games. Existing Let's Encrypt
certificates are reused and only renewed when they enter the renewal window.

Useful operations:

```bash
systemctl status gameson
journalctl -u gameson -f
systemctl restart gameson
certbot renew --dry-run
```

To update the installation:

```bash
cd /opt/gameson
sudo ./scripts/setup-ubuntu.sh games.example.com admin@example.com
```

When upgrading a server that still has an older version of the setup script,
run `git pull --ff-only` once before the command above. From then on the script
updates its repository by itself. Set `GAMESON_UPDATE_REPO=0` only when you
intentionally want to deploy the currently checked-out revision without
contacting the remote repository.

### Database backup

Stop the service briefly before copying `/var/lib/gameson` so the SQLite/WAL
files form a consistent snapshot:

```bash
sudo systemctl stop gameson
sudo tar -C /var/lib -czf "/root/gameson-backup-$(date +%F).tar.gz" gameson
sudo systemctl start gameson
```

## Project commands

- `npm run dev`: local Worker/D1 development server
- `npm run build`: production build
- `npm test`: build plus automated tests
- `npm run lint`: source checks
- `npm run db:generate`: generate Drizzle migrations after schema changes
