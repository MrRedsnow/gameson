import { ensureSchema, getD1 } from "../../../db";
import { applyCatanAction, catanView, createCatanGame, DEFAULT_TARGET_POINTS, randomIndex, validateTargetPoints, type CatanAction, type CatanGame } from "../../../lib/catan";

export const runtime = "edge";
type Member = { id: string; name: string; tokenHash: string };
type Lobby = { id: string; name: string; normalized_name: string; host_player_id: string; target_points: number; members: string; game: string | null; discoverable: number; network_hash: string; revision: number; created_at: number; updated_at: number };
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: string, status = 400) => reply({ error }, status);
const clean = (value: unknown, max: number) => typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, max) : "";
const normalize = (value: string) => value.toLocaleLowerCase("de");
async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function token() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function members(lobby: Lobby): Member[] { return JSON.parse(lobby.members); }
function gameOf(lobby: Lobby): CatanGame | null { return lobby.game ? JSON.parse(lobby.game) : null; }
const DISCOVERY_WINDOW = 15 * 60 * 1000;
function networkPrefix(request: Request) {
  const value = (request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local-preview").trim();
  return value.includes(":") ? value.split(":").slice(0, 4).join(":") : value;
}
// Devices behind the same public address see each other's waiting lobbies; the time bucket lets stale entries fade out.
async function networkHash(request: Request, offset = 0) {
  return digest(`catan-nearby-v1|${networkPrefix(request)}|${Math.floor(Date.now() / DISCOVERY_WINDOW) + offset}`);
}
async function authenticate(request: Request, lobby: Lobby): Promise<Member | undefined> {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ") || header.length > 200) return undefined;
  const hash = await digest(header.slice(7));
  return members(lobby).find((m) => m.tokenHash === hash);
}
function view(lobby: Lobby, me: Member) {
  const game = gameOf(lobby);
  return { lobby: { id: lobby.id, name: lobby.name, hostPlayerId: lobby.host_player_id, targetPoints: lobby.target_points, discoverable: Boolean(lobby.discoverable), revision: lobby.revision },
    members: members(lobby).map(({ id, name }) => ({ id, name })), me: { id: me.id, name: me.name }, game: game ? catanView(game, me.id) : null };
}
async function readLobby(id: string) { return getD1().prepare("SELECT * FROM catan_lobbies WHERE id = ?").bind(id).first<Lobby>(); }
async function save(lobby: Lobby, previousRevision: number) {
  const result = await getD1().prepare("UPDATE catan_lobbies SET host_player_id = ?, target_points = ?, members = ?, game = ?, discoverable = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?")
    .bind(lobby.host_player_id, lobby.target_points, lobby.members, lobby.game, lobby.discoverable, Date.now(), lobby.id, previousRevision).run();
  return result.meta.changes === 1;
}
async function rateLimit(request: Request, action: string) {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const key = await digest(`catan|${ip}|${action}|${Math.floor(Date.now() / 600000)}`);
  const row = await getD1().prepare("INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count")
    .bind(key, Date.now() + 660000).first<{ count: number }>();
  return (row?.count ?? 31) <= 30;
}
function errorResponse(error: unknown) {
  console.error("Catan request failed", error);
  return fail("Die Verbindung zur Spiellobby ist gerade unterbrochen. Bitte versuche es erneut.", 503);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("nearby") === "1") {
      await ensureSchema();
      const [current, previous] = await Promise.all([networkHash(request), networkHash(request, -1)]);
      const rows = await getD1().prepare("SELECT id, name, members FROM catan_lobbies WHERE discoverable = 1 AND game IS NULL AND network_hash IN (?, ?) ORDER BY updated_at DESC LIMIT 8").bind(current, previous).all<Pick<Lobby, "id" | "name" | "members">>();
      const lobbies = (rows.results ?? []).map((row: Pick<Lobby, "id" | "name" | "members">) => ({ id: row.id, name: row.name, player_count: (JSON.parse(row.members) as Member[]).length })).filter((row: { player_count: number }) => row.player_count > 0 && row.player_count < 4);
      return reply({ lobbies });
    }
    const id = clean(url.searchParams.get("lobby"), 40);
    if (!id) return fail("Der Lobbycode fehlt.");
    await ensureSchema();
    const lobby = await readLobby(id); if (!lobby) return fail("Diese Lobby gibt es nicht mehr.", 404);
    const me = await authenticate(request, lobby); if (!me) return fail("Bitte tritt der Lobby erneut bei.", 401);
    // Read-only polls keep long sessions alive without invalidating turn revisions; the host's polls also keep a waiting lobby discoverable on its current network.
    const hash = me.id === lobby.host_player_id && !lobby.game ? await networkHash(request) : lobby.network_hash;
    if (hash !== lobby.network_hash || Date.now() - lobby.updated_at > 60000) await getD1().prepare("UPDATE catan_lobbies SET updated_at = ?, network_hash = ? WHERE id = ?").bind(Date.now(), hash, id).run();
    return reply(view(lobby, me));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 12000) return fail("Die Anfrage ist zu groß.", 413);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("Ungültige Anfrage.");
    body = parsed;
  } catch { return fail("Ungültige Anfrage."); }
  try {
    const action = body.action;
    if (action === "create" || action === "join") {
      await ensureSchema();
      if (!await rateLimit(request, action)) return fail("Zu viele Versuche. Bitte warte kurz.", 429);
      const name = clean(body.playerName, 24); if (!name) return fail("Bitte gib deinen Namen ein.");
      const secret = token(); const member = { id: crypto.randomUUID(), name, tokenHash: await digest(secret) };
      if (action === "create") {
        const lobbyName = clean(body.name, 32); if (lobbyName.length < 2) return fail("Der Gruppenname braucht mindestens zwei Zeichen.");
        let points: number;
        try { points = validateTargetPoints(body.targetPoints ?? DEFAULT_TARGET_POINTS); } catch (e) { return fail((e as Error).message); }
        await getD1().prepare("DELETE FROM catan_lobbies WHERE updated_at < ?").bind(Date.now() - 7 * 86400000).run();
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        const id = Array.from({ length: 6 }, () => alphabet[randomIndex(alphabet.length)]).join("");
        const existing = await getD1().prepare("SELECT id FROM catan_lobbies WHERE normalized_name = ?").bind(normalize(lobbyName)).first();
        if (existing) return fail("Dieser Gruppenname ist schon vergeben.", 409);
        try {
          await getD1().prepare("INSERT INTO catan_lobbies (id, name, normalized_name, host_player_id, target_points, members, discoverable, network_hash, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)")
            .bind(id, lobbyName, normalize(lobbyName), member.id, points, JSON.stringify([member]), await networkHash(request), Date.now(), Date.now()).run();
        } catch (e) {
          if (String(e).includes("UNIQUE")) return fail("Dieser Gruppenname ist inzwischen vergeben. Bitte wähle einen anderen.", 409);
          throw e;
        }
        return reply({ session: { lobbyId: id, token: secret }, state: view((await readLobby(id))!, member) });
      }
      const code = clean(body.code, 40);
      const lobby = await getD1().prepare("SELECT * FROM catan_lobbies WHERE id = ? OR normalized_name = ?").bind(code.toUpperCase(), normalize(code)).first<Lobby>();
      if (!lobby) return fail("Keine Lobby mit diesem Code oder Gruppennamen gefunden.", 404);
      if (lobby.game) return fail("Die Partie läuft bereits. Neue Personen können erst in der nächsten Lobby beitreten.", 409);
      const seats = members(lobby);
      if (seats.length >= 4) return fail("Die Lobby ist voll. Catan ist für höchstens vier Personen.", 409);
      if (seats.some((p) => normalize(p.name) === normalize(name))) return fail("Dieser Name ist in der Lobby schon vergeben.", 409);
      lobby.members = JSON.stringify([...seats, member]);
      if (!await save(lobby, lobby.revision)) return fail("Die Lobby wurde gerade geändert. Bitte tritt erneut bei.", 409);
      lobby.revision++;
      return reply({ session: { lobbyId: lobby.id, token: secret }, state: view(lobby, member) });
    }
    const lobby = await readLobby(clean(body.lobbyId, 40)); if (!lobby) return fail("Diese Lobby gibt es nicht mehr.", 404);
    const me = await authenticate(request, lobby); if (!me) return fail("Du bist nicht in dieser Lobby angemeldet.", 401);
    if (body.revision !== lobby.revision) return fail("Der Spielstand hat sich geändert. Er wurde neu geladen; bitte wähle deinen Zug erneut.", 409);
    const isHost = me.id === lobby.host_player_id; const game = gameOf(lobby);
    if (["settings", "start", "reset", "remove"].includes(String(action)) && !isHost) return fail("Das kann nur die Spielleitung tun.", 403);
    if (action === "settings") {
      if (typeof body.discoverable === "boolean") lobby.discoverable = body.discoverable ? 1 : 0;
      if (body.targetPoints !== undefined) {
        if (game) return fail("Die Siegpunktzahl bleibt während einer Partie fest.");
        try { lobby.target_points = validateTargetPoints(body.targetPoints); } catch (e) { return fail((e as Error).message); }
      } else if (typeof body.discoverable !== "boolean") return fail("Keine Einstellung übergeben.");
    } else if (action === "start") {
      if (game) return fail("Diese Partie wurde schon gestartet.");
      try { lobby.game = JSON.stringify(createCatanGame(members(lobby), lobby.target_points)); } catch (e) { return fail((e as Error).message); }
    } else if (action === "move") {
      if (!game) return fail("Startet zuerst eine Partie.");
      try { lobby.game = JSON.stringify(applyCatanAction(game, me.id, body.move as CatanAction)); } catch (e) { return fail(e instanceof Error ? e.message : "Ungültiger Spielzug."); }
    } else if (action === "reset") {
      if (!game || game.phase !== "finished") return fail("Die laufende Partie muss zuerst beendet werden.");
      lobby.game = null;
    } else if (action === "leave" || action === "remove") {
      if (game) return fail("Während einer Partie bleiben die Plätze erhalten. Du kannst später mit diesem Gerät weiterspielen.");
      const id = action === "leave" ? me.id : clean(body.playerId, 40);
      if (action === "remove" && id === me.id) return fail("Nutze „Lobby verlassen“, um selbst zu gehen.");
      const seats = members(lobby).filter((p) => p.id !== id);
      if (!seats.length) {
        const deleted = await getD1().prepare("DELETE FROM catan_lobbies WHERE id = ? AND revision = ?").bind(lobby.id, lobby.revision).run();
        return deleted.meta.changes === 1 ? reply({ left: true }) : fail("Die Lobby wurde inzwischen geändert.", 409);
      }
      lobby.members = JSON.stringify(seats);
      if (!seats.some((p) => p.id === lobby.host_player_id)) lobby.host_player_id = seats[0].id;
    } else return fail("Unbekannte Aktion.");
    if (!await save(lobby, lobby.revision)) return fail("Ein anderer Zug war schneller. Der aktuelle Spielstand wird geladen.", 409);
    lobby.revision++;
    return action === "leave" ? reply({ left: true }) : reply({ state: view(lobby, me) });
  } catch (error) { return errorResponse(error); }
}
