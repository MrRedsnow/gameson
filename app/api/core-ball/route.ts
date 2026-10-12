import { ensureSchema, getD1 } from "../../../db";
import { applyCoreBallAction, createCoreBallGame, type CoreBallAction, type CoreBallMode } from "../../../lib/core-ball";
import {
  coreBallLobbyAllMembers, coreBallLobbyGame, coreBallLobbyMembers, coreBallLobbySettings, coreBallLobbyView,
  digestCoreBallToken, readCoreBallLobby, type CoreBallCommandAck, type CoreBallLobby, type CoreBallMember,
} from "../../../lib/core-ball-lobby-server";
import { publishCoreBallLobby } from "../../../lib/core-ball-live-server";

export const runtime = "edge";
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: string, status = 400) => reply({ error }, status);
const clean = (value: unknown, max: number) => typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, max) : "";
const normalize = (value: string) => value.toLocaleLowerCase("de");
const validMode = (value: unknown): value is CoreBallMode => value === "coop" || value === "competitive";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function token() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
async function networkHash(request: Request, offset = 0) {
  const ip = (request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local-preview").trim();
  const prefix = ip.includes(":") ? ip.split(":").slice(0, 4).join(":") : ip;
  return digestCoreBallToken(`core-ball-nearby|${prefix}|${Math.floor(Date.now() / 900000) + offset}`);
}
async function authenticatedHash(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  return /^Bearer [a-f0-9]{64}$/.test(auth) ? digestCoreBallToken(auth.slice(7)) : "";
}
async function rateLimit(request: Request, action: string) {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const key = await digestCoreBallToken(`core-ball|${ip}|${action}|${Math.floor(Date.now() / 600000)}`);
  const row = await getD1().prepare("INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count")
    .bind(key, Date.now() + 660000).first<{ count: number }>();
  return (row?.count ?? 61) <= 60;
}
async function save(lobby: CoreBallLobby, expectedRevision: number) {
  const result = await getD1().prepare("UPDATE core_ball_lobbies SET host_player_id = ?, settings = ?, members = ?, game = ?, discoverable = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?")
    .bind(lobby.host_player_id, lobby.settings, lobby.members, lobby.game, lobby.discoverable, lobby.revision, Date.now(), lobby.id, expectedRevision).run();
  return result.meta.changes === 1;
}
function receiptResponse(ack: CoreBallCommandAck, receivedAt: number) {
  return reply({ ...ack, ...(ack.state ? { state: { ...ack.state, serverReceivedAt: receivedAt, serverSentAt: Date.now() } } : {}) });
}
function sameCommand(member: CoreBallMember, body: Record<string, unknown>, payloadHash: string) {
  return member.commandSeq === body.commandSeq && member.commandId === body.commandId && member.payloadHash === payloadHash && member.ack;
}
function unavailable(error: unknown) {
  console.error("Core Ball request failed", error);
  return fail("Die Core-Ball-Lobby ist gerade nicht erreichbar. Bitte versuche es erneut.", 503);
}

export async function GET(request: Request) {
  const receivedAt = Date.now();
  try {
    await ensureSchema(); const url = new URL(request.url);
    if (url.searchParams.get("nearby") === "1") {
      const hashes = await Promise.all([networkHash(request), networkHash(request, -1)]);
      const rows = await getD1().prepare("SELECT id, name, members FROM core_ball_lobbies WHERE discoverable = 1 AND game IS NULL AND network_hash IN (?, ?) AND updated_at > ? ORDER BY updated_at DESC LIMIT 8")
        .bind(...hashes, Date.now() - 120000).all<Pick<CoreBallLobby, "id" | "name" | "members">>();
      return reply({ lobbies: (rows.results ?? []).map((row: Pick<CoreBallLobby, "id" | "name" | "members">) => ({ id: row.id, name: row.name, player_count: (JSON.parse(row.members) as CoreBallMember[]).filter((member) => !member.removed).length })).filter((row: { player_count: number }) => row.player_count < 8), serverReceivedAt: receivedAt, serverSentAt: Date.now() });
    }
    const id = clean(url.searchParams.get("lobby"), 40).toUpperCase(); if (!id) return fail("Der Lobbycode fehlt.");
    const lobby = await readCoreBallLobby(id, getD1()); if (!lobby) return fail("Diese Lobby gibt es nicht mehr.", 404);
    const hash = await authenticatedHash(request); const me = coreBallLobbyMembers(lobby).find((member) => member.tokenHash === hash);
    if (!me) return fail("Bitte tritt der Lobby erneut bei.", 401);
    const network = me.id === lobby.host_player_id && !lobby.game ? await networkHash(request) : lobby.network_hash;
    if (network !== lobby.network_hash || Date.now() - lobby.updated_at > 60000) {
      await getD1().prepare("UPDATE core_ball_lobbies SET updated_at = ?, network_hash = ? WHERE id = ? AND revision = ?").bind(Date.now(), network, id, lobby.revision).run();
    }
    return reply(coreBallLobbyView(lobby, me, receivedAt));
  } catch (error) { return unavailable(error); }
}

export async function POST(request: Request) {
  const receivedAt = Date.now();
  let body: Record<string, unknown>;
  try {
    const raw = await request.text(); if (new TextEncoder().encode(raw).length > 4096) return fail("Die Anfrage ist zu groß.", 413);
    const parsed = JSON.parse(raw); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("Ungültige Anfrage."); body = parsed;
  } catch { return fail("Ungültige Anfrage."); }
  try {
    await ensureSchema(); const action = body.action;
    if (action === "create" || action === "join") {
      if (!await rateLimit(request, action)) return fail("Zu viele Versuche. Bitte warte kurz.", 429);
      const name = clean(body.playerName, 24); if (!name) return fail("Bitte gib deinen Namen ein.");
      const secret = token(); const member: CoreBallMember = { id: crypto.randomUUID(), name, tokenHash: await digestCoreBallToken(secret), commandSeq: 0 };
      if (action === "create") {
        const lobbyName = clean(body.name, 32); if (lobbyName.length < 2) return fail("Der Gruppenname braucht mindestens zwei Zeichen.");
        if (body.mode !== undefined && !validMode(body.mode)) return fail("Bitte wähle einen gültigen Spielmodus.");
        if (body.discoverable !== undefined && typeof body.discoverable !== "boolean") return fail("Ungültige Einstellung für die Netzwerksuche.");
        await getD1().prepare("DELETE FROM core_ball_lobbies WHERE updated_at < ?").bind(Date.now() - 7 * 86400000).run();
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const network = await networkHash(request);
        for (let attempt = 0; attempt < 5; attempt++) {
          const id = Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => alphabet[byte % alphabet.length]).join("");
          const now = Date.now();
          const lobby: CoreBallLobby = { id, name: lobbyName, normalized_name: normalize(lobbyName), host_player_id: member.id, settings: JSON.stringify({ mode: body.mode ?? "coop" }), members: JSON.stringify([member]), game: null, discoverable: body.discoverable === false ? 0 : 1, network_hash: network, revision: 1, created_at: now, updated_at: now };
          try {
            await getD1().prepare("INSERT INTO core_ball_lobbies (id, name, normalized_name, host_player_id, settings, members, game, discoverable, network_hash, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?)")
              .bind(id, lobby.name, lobby.normalized_name, member.id, lobby.settings, lobby.members, lobby.discoverable, network, now, now).run();
            await publishCoreBallLobby(lobby);
            return reply({ session: { lobbyId: id, token: secret }, state: coreBallLobbyView(lobby, member, receivedAt) });
          } catch (error) {
            if (!String(error).includes("UNIQUE")) throw error;
            if (String(error).includes("normalized_name")) return fail("Dieser Gruppenname ist schon vergeben.", 409);
          }
        }
        return fail("Kein freier Lobbycode. Bitte versuche es erneut.", 409);
      }
      const code = clean(body.code, 40); if (!code) return fail("Bitte gib einen Lobbycode oder Gruppennamen ein.");
      for (let attempt = 0; attempt < 8; attempt++) {
        const lobby = await getD1().prepare("SELECT * FROM core_ball_lobbies WHERE id = ? OR normalized_name = ?").bind(code.toUpperCase(), normalize(code)).first<CoreBallLobby>();
        if (!lobby) return fail("Keine Lobby mit diesem Code oder Gruppennamen gefunden.", 404);
        if (lobby.game) return fail("Diese Partie läuft bereits. Wartet, bis die Lobby wieder geöffnet wird.", 409);
        const seats = coreBallLobbyMembers(lobby); if (seats.length >= 8) return fail("Die Core-Ball-Lobby ist voll (8 Personen).", 409);
        if (seats.some((seat) => normalize(seat.name) === normalize(name))) return fail("Dieser Name ist schon vergeben.", 409);
        const expected = lobby.revision; lobby.revision++;
        lobby.members = JSON.stringify([...coreBallLobbyAllMembers(lobby), member]);
        if (!await save(lobby, expected)) continue;
        await publishCoreBallLobby(lobby);
        return reply({ session: { lobbyId: lobby.id, token: secret }, state: coreBallLobbyView(lobby, member, receivedAt) });
      }
      return fail("Die Lobby wird gerade aktualisiert. Bitte tritt erneut bei.", 409);
    }

    const id = clean(body.lobbyId, 40).toUpperCase(); if (!id) return fail("Der Lobbycode fehlt.");
    const hash = await authenticatedHash(request);
    const lobby = await readCoreBallLobby(id, getD1()); if (!lobby) return fail("Diese Lobby gibt es nicht mehr.", 404);
    const allMembers = coreBallLobbyAllMembers(lobby); const me = allMembers.find((member) => member.tokenHash === hash);
    if (!me) return fail("Du bist nicht in dieser Lobby angemeldet.", 401);
    if (typeof body.commandId !== "string" || !uuid.test(body.commandId) || !Number.isSafeInteger(body.commandSeq) || Number(body.commandSeq) < 1 || !Number.isSafeInteger(body.revision)) return fail("Der Befehl braucht eine gültige Kennung, Sequenz und Revision.");
    const payloadHash = await digestCoreBallToken(canonicalJson(body));
    const repeated = sameCommand(me, body, payloadHash); if (repeated) return receiptResponse(repeated, receivedAt);
    if (me.removed) return fail("Du bist nicht mehr in dieser Lobby angemeldet.", 401);
    if (body.commandSeq !== me.commandSeq + 1 || body.commandId === me.commandId) return fail("Dieser Befehl ist veraltet oder wurde bereits anders verwendet. Der Spielstand wird neu geladen.", 409);
    const isHost = me.id === lobby.host_player_id;
    if (["settings", "start", "reset", "remove"].includes(String(action)) && !isHost) return fail("Das kann nur der Lobby-Master tun.", 403);
    if (body.revision !== lobby.revision) return fail("Die Lobby hat sich geändert. Der Spielstand wird neu geladen.", 409);
    const expectedRevision = lobby.revision; const seats = allMembers.filter((member) => !member.removed);
    const previousFormer = allMembers.filter((member) => member.removed); let game = coreBallLobbyGame(lobby);
    let left = false; let deleteLobby = false;
    try {
      if (action === "settings") {
        if (game) return fail("Diese Einstellung kann nur in der wartenden Lobby geändert werden.");
        if (body.mode === undefined && body.discoverable === undefined) return fail("Bitte wähle eine Einstellung.");
        if (body.mode !== undefined && !validMode(body.mode)) return fail("Bitte wähle einen gültigen Spielmodus.");
        if (body.discoverable !== undefined && typeof body.discoverable !== "boolean") return fail("Ungültige Einstellung für die Netzwerksuche.");
        if (body.mode !== undefined) lobby.settings = JSON.stringify({ mode: body.mode });
        if (body.discoverable !== undefined) lobby.discoverable = body.discoverable ? 1 : 0;
      } else if (action === "start") {
        if (game) return fail("Die Partie wurde bereits gestartet.", 409);
        game = createCoreBallGame(seats, coreBallLobbySettings(lobby).mode, lobby.host_player_id, Date.now());
      } else if (action === "play") {
        if (!game) return fail("Startet zuerst eine Partie.");
        if (!body.move || typeof body.move !== "object" || Array.isArray(body.move)) return fail("Ungültige Spielaktion.");
        const move = body.move as CoreBallAction;
        if (["skip-player", "finish"].includes(move.type) && !isHost) return fail("Das kann nur der Lobby-Master tun.", 403);
        if (["ready", "shoot", "handoff"].includes(move.type) && game.activePlayerId !== me.id) return fail("Gerade ist eine andere Person am Zug.", 403);
        if (move.gameId !== game.id || move.attemptId !== game.attemptId || move.turnId !== game.turnId) return fail("Dieser Zug gehört zu einem veralteten Spielstand. Der Spielstand wird neu geladen.", 409);
        // A valid input does not become stale while D1 or token hashing processes it.
        game = applyCoreBallAction(game, me.id, move, move.type === "shoot" ? receivedAt : Date.now());
      } else if (action === "reset") {
        if (!game || game.phase !== "finished" || body.gameId !== game.id) return fail("Beendet zuerst die aktuelle Partie und ladet den aktuellen Spielstand.");
        game = null;
      } else if (action === "leave" || action === "remove") {
        if (game && game.phase !== "finished") return fail("Die Plätze bleiben während der Partie erhalten. Der Lobby-Master kann die Partie beenden oder eine Person überspringen.");
        const target = action === "leave" ? me.id : clean(body.playerId, 40);
        if (action === "remove" && target === me.id) return fail("Nutze „Lobby verlassen“, um selbst zu gehen.");
        const member = seats.find((seat) => seat.id === target); if (!member) return fail("Diese Person ist nicht in der Lobby.");
        member.removed = true;
        const remaining = seats.filter((seat) => !seat.removed); deleteLobby = remaining.length === 0;
        if (!deleteLobby && !remaining.some((seat) => seat.id === lobby.host_player_id)) lobby.host_player_id = remaining[0].id;
        left = action === "leave";
      } else return fail("Unbekannte Aktion.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ungültige Aktion.";
      const technical = action === "play" && (/(Zeitpunkt|aktuell|veraltet|bereits|synchron|angekommen|Animation|Sekunde)/i.test(message));
      return fail(message, technical ? 409 : 400);
    }
    lobby.revision++; lobby.game = game ? JSON.stringify(game) : null;
    me.commandSeq = Number(body.commandSeq); me.commandId = body.commandId; me.payloadHash = payloadHash;
    // At most eight former seats are kept, and only their latest command receipt.
    const active = allMembers.filter((member) => !member.removed);
    const former = [...previousFormer, ...seats.filter((member) => member.removed)].slice(-8);
    lobby.members = JSON.stringify([...active, ...former]);
    const ack: CoreBallCommandAck = { ack: { commandId: me.commandId, commandSeq: me.commandSeq, revision: lobby.revision }, ...(left ? { left: true as const } : { state: coreBallLobbyView(lobby, me, receivedAt) }) };
    me.ack = ack; lobby.members = JSON.stringify([...active, ...former]);
    const committed = deleteLobby
      ? (await getD1().prepare("DELETE FROM core_ball_lobbies WHERE id = ? AND revision = ?").bind(id, expectedRevision).run()).meta.changes === 1
      : await save(lobby, expectedRevision);
    if (!committed) {
      const current = await readCoreBallLobby(id, getD1()); const currentMember = current && coreBallLobbyAllMembers(current).find((member) => member.tokenHash === hash);
      const receipt = currentMember && sameCommand(currentMember, body, payloadHash);
      return receipt ? receiptResponse(receipt, receivedAt) : fail("Die Lobby wurde gleichzeitig aktualisiert. Der Spielstand wird neu geladen.", 409);
    }
    await publishCoreBallLobby(deleteLobby ? null : lobby, deleteLobby ? { id, revision: lobby.revision } : undefined);
    return receiptResponse(ack, receivedAt);
  } catch (error) { return unavailable(error); }
}
