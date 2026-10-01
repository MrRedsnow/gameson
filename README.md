# Gameson

Mobile German games for multiple phones or one shared device. The app
currently includes HIVE, Imposter, Werwolf, Die Siedler von Catan and Stadt Land Fluss, with persistent lobby state in a local
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

### HIVE

Open `/hive` or choose HIVE in Gameson. Exactly two people play online on their
own devices or locally on one shared device. Online invitations support links,
QR codes, lobby codes, group names and nearby waiting lobbies. Each move is
validated on the server and saved with an atomic revision check. Reloading
restores the session; local games save after every move and work offline after
the page has been loaded online.

The base game has 22 pieces: queen, beetles, grasshoppers, spiders and ants.
Rules enforce the fourth-turn queen deadline, placement colors (including
beetle-controlled stacks), one connected hive, sliding gates at the piece's
height, exact spider paths and straight grasshopper jumps. Legal destinations
are highlighted; players confirm before a move is applied. The board supports
panning, zoom and fitting the whole hive. Both queens' surrounding sides are
shown. Surrounding both queens at once is a draw; passing requires no legal
move. Players can resign or agree a draw. Rematches swap colors.

The mobile move dock keeps the reserve and confirmation together below the
board. A transparent piece and a legal path preview the move; confirmed moves
animate unless reduced motion is enabled. Selecting blocked pieces explains
the specific rule, highlights closed gates or numbers the disconnected groups.
Tapping a beetle stack opens every layer, including covered queens.

Local players can undo the last turn by mutual agreement; the restored state
is saved as usual. The interactive tutorial at `/hive?tutorial=1` teaches six
short exercises, from placing the queen to surrounding the opponent. It uses
separate practice positions and preserves the saved local or online game.

`drizzle/0010_hive.sql` and the runtime schema bootstrap create the table
idempotently. Existing installations need no manual migration.
Rules reference: https://www.gen42.com/product/hive/

### Stadt Land Fluss

Open `/stadt-land-fluss` or choose it in Gameson. 2–22 people play simultaneously
on their own devices, joining by invitation link, code, group name or nearby lobby.
The host defines 2–12 custom columns, 1–20 rounds and a 15–1800 second timer
(default: Stadt, Land, Fluss, Tier, Beruf; 5 rounds; 120 seconds).
Columns can be changed in the lobby and between rounds. The host can change or
disable the timer during a round; a new duration starts when saved and also becomes
the next round's duration. With no timer, everyone submitting or the host stopping
the writing phase starts review.

The fixed header shows the current letter and remaining time, including while
scrolling or using a mobile keyboard. Clients estimate server time from request
round trips and advance it with a monotonic clock. The server enforces the deadline
on every read and write. Inputs autosave with per-player sequences; atomic retries
merge simultaneous edits and votes. Only the player's own answers leave the server
during writing. A browser reload restores the session and any newer local draft.
An internet connection is required; only answers saved before the server deadline
count, and the UI shows when a save is outstanding.

During review, tap **Anzweifeln**, then **Gilt** or **Gilt nicht**. Everyone has one
changeable vote per disputed answer, including its author. The majority of cast
votes decides; ties accept the answer. Players confirm the review; the host then
scores it, or explicitly closes it early using the existing votes. Empty answers
and wrong initials score 0; accepted duplicates score 5, unique answers 10, and
the only accepted answer in a column 20. Umlauts/case are normalized. Each round
uses a fresh letter and the scoreboard records all rounds.

`drizzle/0009_stadt_land_fluss.sql` and the runtime schema bootstrap both create
the table idempotently, so existing installations need no manual migration.

### Catan

Open `/catan` or choose Catan in Gameson. Supports 3–4 people, an online
lobby (code, name or invitation link) and pass-and-play on one device. The victory
target is selectable from 8 to 15, default 12; choose 10 for the original target.
The base game includes randomized terrain with nonadjacent red number tokens,
snake-order setup, resource production, limited bank/pieces, domestic and harbor
trade, robber/discard/steal, all 25 development cards and both special awards.
Online hands and deck order stay server-side; turn updates use atomic revisions.
Waiting online lobbies are listed under „Lobby beitreten“ for devices on the same
network, like in Imposter and Werwolf; the host can hide a lobby with „Lobby in
der Nähe anzeigen“.
Local games are saved on the device and hide hands when passing it around.
A running game uses five menus with scrollable content when needed.
The active player, dice, own score and resource counts stay visible; the menu and
the current action stay pinned. In landscape, status and navigation move beside
the game. Build choices and compact player scores can be compared in one list;
player details expand on demand. Overview opens the player scores directly, with
list links to history, private receipts and rules. Cards opens development cards
grouped by type, showing their count and availability, and prefers an older
playable copy; resources appear only in the global strip. Required discards
temporarily replace the card list with five resource quantity rows. Large text
can scroll the entire screen so headings and actions remain reachable. Rules
use topic accordions with shared build costs; private receipts are expandable
entries ordered newest first and retain their unread markers.

The island fits its available space. A larger island mode keeps status, resources
and navigation visible and supports panning. Landscape gives more space to the
map. Tapping a field or using the place arrows
opens a close view with larger touch targets. A separate confirmation prevents
accidental construction. Placement previews explain adjacent resources, number
probabilities, robber blocks and ports. The build menu explains missing resources,
pieces and legal positions. Tabs are the single entrypoints for building and
trading; ordinary phase changes preserve the selected view and unfinished
inputs. New required tasks and incoming trades open their relevant view. A
three-step setup guide explains placement, resources
and number probabilities; it can be skipped and reopened during setup.

Hand-painted terrain textures show forests, sheep pastures, wheat fields, clay hills,
mountains and desert dunes. Small numbers sit directly on each landscape without
discs or probability dots; production probabilities remain in placement previews.
Slender roads connect painted cottages and cities with a taller central building;
roof colors identify their owners. Painted timber piers and rowing boats mark the harbors, and a painted
ocean texture fills the whole map area. Material-colored resource pictograms are
shared by the inventory, card overview, trade, costs and harbor badges.
Artwork and generation prompts are documented in `assets/catan/README.md`.
The island's speaker button optionally enables synthesized
sheep and wood-chopping effects when receiving those resources or inspecting a
matching field. Sound starts off and works offline.

Bank trades show both resources, the harbor rate and only affected stock changes,
with one explicit confirmation; the selection stays available for repeat trades.
Player offers use four steps, ending with the exchange and resulting stock.
Incoming offers pin accept, decline and counteroffer actions.
Resource changes update the hand immediately and appear in a private, nonblocking
activity history. A compact notice shows signed gains and losses even on small
screens. Gains and payments from one trade are grouped together. Shared
devices are passed only for a real turn, discard or trade decision; unread receipts
wait for that person's next visit. Older saved local games retain unread markers.

For interactive UI checks, build once and run `node tests/catan-ux-preview.mjs`.
The local-only preview on port 3002 renders the real components with prepared
states for setup, trading, discarding, card play, long histories and game over.
It is not an application route and is not included in the deployed UI.

The table is defined by `drizzle/0007_catan.sql`; `drizzle/0008_catan_nearby.sql`
adds the discovery columns, which the app also adds at runtime when they are
missing. Sites applies the migrations during deployment; the Ubuntu updater
applies the table migration automatically.
For an existing local preview, apply it once before creating a Catan lobby:

```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/state --config dist/server/wrangler.json --file drizzle/0007_catan.sql
```

The offline game works after the Catan page has been loaded once online.

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
