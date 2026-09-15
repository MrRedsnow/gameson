import { ensureSchema, getD1 } from "../../../db";
import { applySlfAction, changeSlfTimer, createSlfGame, DEFAULT_COLUMNS, DEFAULT_TIMER_SECONDS, expireSlfRound, MAX_PLAYERS, randomIndex, slfView, validateSettings, validateTimer, type SlfAction, type SlfGame, type SlfSettings, type SlfState } from "../../../lib/stadt-land-fluss";

export const runtime = "edge";
type Member = { id: string; name: string; tokenHash: string };
type Lobby = { id: string; name: string; normalized_name: string; host_player_id: string; settings: string; members: string; game: string | null; discoverable: number; network_hash: string; revision: number; created_at: number; updated_at: number };
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: string, status = 400) => reply({ error }, status);
const clean = (value: unknown, max: number) => typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, max) : "";
const normalize = (value: string) => value.toLocaleLowerCase("de");
const members = (lobby: Lobby): Member[] => JSON.parse(lobby.members);
const gameOf = (lobby: Lobby): SlfGame | null => lobby.game ? JSON.parse(lobby.game) : null;
const settingsOf = (lobby: Lobby): SlfSettings => JSON.parse(lobby.settings);
const readLobby = (id: string) => getD1().prepare("SELECT * FROM slf_lobbies WHERE id = ?").bind(id).first<Lobby>();
async function digest(value: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join(""); }
function token() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join(""); }
async function networkHash(request: Request, offset = 0) {
  const ip = (request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local-preview").trim();
  const prefix = ip.includes(":") ? ip.split(":").slice(0, 4).join(":") : ip;
  return digest(`slf-nearby|${prefix}|${Math.floor(Date.now() / 900000) + offset}`);
}
async function authenticatedHash(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") && auth.length < 200 ? digest(auth.slice(7)) : "";
}
function view(lobby: Lobby, me: Member): SlfState {
  const game = gameOf(lobby);
  return { serverNow: Date.now(), lobby: { id: lobby.id, name: lobby.name, hostPlayerId: lobby.host_player_id, settings: settingsOf(lobby), discoverable: Boolean(lobby.discoverable), revision: lobby.revision },
    members: members(lobby).map(({ id, name }) => ({ id, name })), me: { id: me.id, name: me.name }, game: game ? slfView(game, me.id) : null };
}
async function save(lobby: Lobby) {
  const result = await getD1().prepare("UPDATE slf_lobbies SET host_player_id = ?, settings = ?, members = ?, game = ?, discoverable = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?")
    .bind(lobby.host_player_id, lobby.settings, lobby.members, lobby.game, lobby.discoverable, Date.now(), lobby.id, lobby.revision).run();
  if (result.meta.changes !== 1) return false;
  lobby.revision++; return true;
}
async function rateLimit(request: Request, action: string) {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const key = await digest(`slf|${ip}|${action}|${Math.floor(Date.now() / 600000)}`);
  const row = await getD1().prepare("INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count").bind(key, Date.now() + 660000).first<{ count: number }>();
  return (row?.count ?? 61) <= 60;
}
function unavailable(error: unknown) { console.error("Stadt Land Fluss request failed", error); return fail("Die Spiellobby ist gerade nicht erreichbar. Bitte versuche es erneut.", 503); }

export async function GET(request: Request) {
  try {
    await ensureSchema(); const url = new URL(request.url);
    if (url.searchParams.get("nearby") === "1") {
      const hashes = await Promise.all([networkHash(request), networkHash(request, -1)]);
      const rows = await getD1().prepare("SELECT id, name, members FROM slf_lobbies WHERE discoverable = 1 AND game IS NULL AND network_hash IN (?, ?) ORDER BY updated_at DESC LIMIT 8").bind(...hashes).all<Pick<Lobby, "id" | "name" | "members">>();
      return reply({ lobbies: (rows.results ?? []).map((row: Pick<Lobby, "id" | "name" | "members">) => ({ id: row.id, name: row.name, player_count: JSON.parse(row.members).length as number })).filter((row: { player_count: number }) => row.player_count < MAX_PLAYERS) });
    }
    const id = clean(url.searchParams.get("lobby"), 40); if (!id) return fail("Der Lobbycode fehlt.");
    const hash = await authenticatedHash(request);
    for (let attempt = 0; attempt < 24; attempt++) {
      const lobby = await readLobby(id); if (!lobby) return fail("Diese Lobby gibt es nicht mehr.", 404);
      const me = members(lobby).find((m) => m.tokenHash === hash); if (!me) return fail("Bitte tritt der Lobby erneut bei.", 401);
      const game = gameOf(lobby);
      if (game && expireSlfRound(game, Date.now())) { lobby.game = JSON.stringify(game); if (!await save(lobby)) continue; }
      // Presence writes do not invalidate game revisions or compete with answer saves.
      const network = me.id === lobby.host_player_id && !game ? await networkHash(request) : lobby.network_hash;
      if (network !== lobby.network_hash || Date.now() - lobby.updated_at > 60000) await getD1().prepare("UPDATE slf_lobbies SET updated_at = ?, network_hash = ? WHERE id = ?").bind(Date.now(), network, id).run();
      return reply(view(lobby, me));
    }
    return fail("Die Lobby wird gerade aktualisiert. Bitte versuche es gleich noch einmal.", 409);
  } catch (error) { return unavailable(error); }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { const raw = await request.text(); if (raw.length > 16000) return fail("Die Anfrage ist zu groß.", 413); const parsed = JSON.parse(raw); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("Ungültige Anfrage."); body = parsed; } catch { return fail("Ungültige Anfrage."); }
  try {
    await ensureSchema(); const action = body.action;
    if (action === "create" || action === "join") {
      if (!await rateLimit(request, action)) return fail("Zu viele Versuche. Bitte warte kurz.", 429);
      const name = clean(body.playerName, 24); if (!name) return fail("Bitte gib deinen Namen ein.");
      const secret = token(); const member: Member = { id: crypto.randomUUID(), name, tokenHash: await digest(secret) };
      if (action === "create") {
        const lobbyName = clean(body.name, 32); if (lobbyName.length < 2) return fail("Der Gruppenname braucht mindestens zwei Zeichen.");
        let settings: SlfSettings;
        try { settings = validateSettings(body.settings ?? { columns: DEFAULT_COLUMNS, timerSeconds: DEFAULT_TIMER_SECONDS, rounds: 5 }); } catch (e) { return fail((e as Error).message); }
        await getD1().prepare("DELETE FROM slf_lobbies WHERE updated_at < ?").bind(Date.now() - 7 * 86400000).run();
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        for (let attempt = 0; attempt < 5; attempt++) {
          const id = Array.from({ length: 6 }, () => alphabet[randomIndex(alphabet.length)]).join("");
          try {
            await getD1().prepare("INSERT INTO slf_lobbies (id, name, normalized_name, host_player_id, settings, members, discoverable, network_hash, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)")
              .bind(id, lobbyName, normalize(lobbyName), member.id, JSON.stringify(settings), JSON.stringify([member]), await networkHash(request), Date.now(), Date.now()).run();
            return reply({ session: { lobbyId: id, token: secret }, state: view((await readLobby(id))!, member) });
          } catch (e) { if (!String(e).includes("UNIQUE")) throw e; if (String(e).includes("normalized_name")) return fail("Dieser Gruppenname ist schon vergeben.", 409); }
        }
        return fail("Kein freier Lobbycode. Bitte versuche es erneut.", 409);
      }
      const code = clean(body.code, 40);
      for (let attempt = 0; attempt < 24; attempt++) {
        const lobby = await getD1().prepare("SELECT * FROM slf_lobbies WHERE id = ? OR normalized_name = ?").bind(code.toUpperCase(), normalize(code)).first<Lobby>();
        if (!lobby) return fail("Keine Lobby mit diesem Code oder Gruppennamen gefunden.", 404);
        if (lobby.game) return fail("Diese Partie läuft bereits. Nach dem Spiel öffnet der Lobby-Master die Lobby wieder.", 409);
        const seats = members(lobby); if (seats.length >= MAX_PLAYERS) return fail(`Die Lobby ist voll (${MAX_PLAYERS} Personen).`, 409);
        if (seats.some((p) => normalize(p.name) === normalize(name))) return fail("Dieser Name ist schon vergeben.", 409);
        lobby.members = JSON.stringify([...seats, member]); if (!await save(lobby)) continue;
        return reply({ session: { lobbyId: lobby.id, token: secret }, state: view(lobby, member) });
      }
      return fail("Die Lobby ist gerade sehr beschäftigt. Bitte tritt erneut bei.", 409);
    }
    const id = clean(body.lobbyId, 40); const hash = await authenticatedHash(request);
    // Independent edits are reapplied to the newest row on conflict. A stale global revision must not reject parallel typing/voting.
    for (let attempt = 0; attempt < 24; attempt++) {
      const lobby = await readLobby(id); if (!lobby) return fail("Diese Lobby gibt es nicht mehr.", 404);
      const seats = members(lobby); const me = seats.find((p) => p.tokenHash === hash); if (!me) return fail("Du bist nicht in dieser Lobby angemeldet.", 401);
      const isHost = me.id === lobby.host_player_id; const settings = settingsOf(lobby); let game = gameOf(lobby);
      if (game && expireSlfRound(game, Date.now())) {
        lobby.game = JSON.stringify(game); if (!await save(lobby)) continue;
        // Persist expiration even when the requested action is no longer permitted.
      }
      if (["settings", "timer", "start", "reset", "remove"].includes(String(action)) && !isHost) return fail("Das kann nur der Lobby-Master tun.", 403);
      try {
        if (action === "settings") {
          if (body.settings !== undefined) {
            if (game && game.phase !== "results") return fail("Spalten können vor dem Start und zwischen den Runden geändert werden.");
            const next = validateSettings(body.settings);
            if (game && next.rounds !== game.rounds) return fail("Die Rundenzahl steht für diese Partie bereits fest.");
            lobby.settings = JSON.stringify(next);
          }
          if (typeof body.discoverable === "boolean") lobby.discoverable = body.discoverable ? 1 : 0;
          if (body.settings === undefined && typeof body.discoverable !== "boolean") return fail("Keine Einstellung übergeben.");
        } else if (action === "timer") {
          // The round guard prevents a late timer dialog from changing a different round.
          if (game && body.roundId !== game.round.id) return fail("Diese Runde ist nicht mehr aktuell.", 409);
          settings.timerSeconds = validateTimer(body.timerSeconds); lobby.settings = JSON.stringify(settings);
          if (game) changeSlfTimer(game, settings.timerSeconds, Date.now());
        } else if (action === "start") {
          if (game) return fail("Die Partie wurde schon gestartet.", 409);
          game = createSlfGame(seats, settings);
        } else if (action === "move") {
          if (!game) return fail("Startet zuerst eine Partie.");
          game = applySlfAction(game, me.id, lobby.host_player_id, body.move as SlfAction, settings);
        } else if (action === "reset") {
          if (!game || game.phase !== "finished" || body.gameId !== game.id) return fail("Beendet zuerst die Partie.");
          game = null;
        } else if (action === "leave" || action === "remove") {
          if (game) return fail("Während einer Partie bleiben die Plätze erhalten. Mit diesem Gerät kannst du jederzeit zurückkehren.");
          const target = action === "leave" ? me.id : clean(body.playerId, 40);
          if (action === "remove" && target === me.id) return fail("Nutze „Lobby verlassen“, um selbst zu gehen.");
          const remaining = seats.filter((p) => p.id !== target);
          if (!remaining.length) { const result = await getD1().prepare("DELETE FROM slf_lobbies WHERE id = ? AND revision = ?").bind(id, lobby.revision).run(); if (result.meta.changes !== 1) continue; return reply({ left: true }); }
          lobby.members = JSON.stringify(remaining); if (!remaining.some((p) => p.id === lobby.host_player_id)) lobby.host_player_id = remaining[0].id;
        } else return fail("Unbekannte Aktion.");
      } catch (e) { return fail(e instanceof Error ? e.message : "Ungültige Aktion."); }
      lobby.game = game ? JSON.stringify(game) : null;
      if (!await save(lobby)) continue;
      return action === "leave" ? reply({ left: true }) : reply({ state: view(lobby, me) });
    }
    return fail("Viele gleichzeitige Eingaben. Bitte versuche es gleich erneut.", 409);
  } catch (error) { return unavailable(error); }
}
