import { ensureSchema, getD1 } from "../../../db";
import { cleanupDatabase, deleteImposterLobby } from "../../../db/cleanup";
import { CATEGORIES, WORD_PAIRS, defaultImposterCount, maxImposterCount, normalizeName, type ContentMode } from "../../../lib/game";

export const runtime = "edge";

type LobbyRow = {
  id: string; name: string; normalized_name: string; status: "waiting" | "revealing" | "voting" | "results";
  host_player_id: string; content_mode: ContentMode; pool: string; imposter_count: number; imposter_overridden: number;
  discoverable: number; revision: number; network_hash: string; round_number: number; finished_at: number | null; created_at: number; updated_at: number;
};
type PlayerRow = { id: string; lobby_id: string; name: string; normalized_name: string; token_hash: string; is_host: number; removed: number; joined_at: number; last_seen: number };

const DISCOVERY_WINDOW = 15 * 60 * 1000;

function reply(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
function fail(message: string, status = 400) { return reply({ error: message }, status); }
function cleanText(value: unknown, max: number) { return typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, max) : ""; }

function rawToken(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function makeToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function networkPrefix(request: Request) {
  const value = (request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local-preview").trim();
  if (value.includes(":")) return value.split(":").slice(0, 4).join(":");
  return value;
}

async function networkHash(request: Request, offset = 0) {
  const bucket = Math.floor(Date.now() / DISCOVERY_WINDOW) + offset;
  return digest(`imposter-nearby-v1|${networkPrefix(request)}|${bucket}`);
}

async function rateLimit(request: Request, action: string, max = 30) {
  const db = getD1();
  const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
  const key = await digest(`${networkPrefix(request)}|${action}|${bucket}`);
  await db.prepare("INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1").bind(key, Date.now() + 11 * 60 * 1000).run();
  const row = await db.prepare("SELECT count FROM rate_limits WHERE key = ?").bind(key).first<{ count: number }>();
  return (row?.count ?? 0) <= max;
}

async function authenticate(request: Request, lobbyId?: string) {
  const token = rawToken(request);
  if (!token) return null;
  const db = getD1();
  const hash = await digest(token);
  const player = await db.prepare("SELECT * FROM players WHERE token_hash = ? AND removed = 0").bind(hash).first<PlayerRow>();
  if (!player || (lobbyId && player.lobby_id !== lobbyId)) return null;
  const lobby = await db.prepare("SELECT * FROM lobbies WHERE id = ?").bind(player.lobby_id).first<LobbyRow>();
  return lobby ? { player, lobby } : null;
}

async function hostAuth(request: Request, lobbyId?: string) {
  const auth = await authenticate(request, lobbyId);
  return auth && auth.player.is_host && auth.lobby.host_player_id === auth.player.id ? auth : null;
}

function secureIndex(length: number) {
  if (length <= 1) return 0;
  const max = Math.floor(0x100000000 / length) * length;
  const random = new Uint32Array(1);
  do crypto.getRandomValues(random); while (random[0] >= max);
  return random[0] % length;
}

async function currentRound(lobby: LobbyRow) {
  if (!lobby.round_number) return null;
  return getD1().prepare("SELECT * FROM rounds WHERE lobby_id = ? AND number = ?").bind(lobby.id, lobby.round_number).first<{ id: string; status: string }>();
}

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const url = new URL(request.url);
    const action = url.searchParams.get("action") ?? "state";
    const db = getD1();

    if (action === "nearby") {
      await cleanupDatabase(db);
      const [current, previous] = await Promise.all([networkHash(request), networkHash(request, -1)]);
      const result = await db.prepare("SELECT l.id, l.name, (SELECT COUNT(*) FROM players p WHERE p.lobby_id = l.id AND p.removed = 0) AS player_count FROM lobbies l WHERE l.discoverable = 1 AND l.status = 'waiting' AND l.network_hash IN (?, ?) ORDER BY l.updated_at DESC LIMIT 8").bind(current, previous).all<{ id: string; name: string; player_count: number }>();
      return reply({ lobbies: result.results ?? [] });
    }

    const lobbyId = cleanText(url.searchParams.get("lobbyId"), 64);
    const auth = await authenticate(request, lobbyId);
    if (!auth) return fail("Deine Sitzung ist nicht mehr gültig.", 401);
    const { player, lobby } = auth;

    if (action === "role") {
      const round = await currentRound(lobby);
      if (!round) return fail("Es läuft noch keine Runde.", 409);
      const assignment = await db.prepare("SELECT role, word FROM assignments WHERE round_id = ? AND player_id = ?").bind(round.id, player.id).first<{ role: "crew" | "imposter"; word: string }>();
      return assignment ? reply({ assignment }) : fail("Deine Rolle wurde nicht gefunden.", 404);
    }

    const now = Date.now();
    if (now - player.last_seen > 12000) {
      const nextNetwork = player.is_host ? await networkHash(request) : lobby.network_hash;
      const heartbeats = [db.prepare("UPDATE players SET last_seen = ? WHERE id = ?").bind(now, player.id)];
      if (lobby.status !== "results") heartbeats.push(db.prepare("UPDATE lobbies SET updated_at = ?, network_hash = CASE WHEN host_player_id = ? THEN ? ELSE network_hash END WHERE id = ?").bind(now, player.id, nextNetwork, lobby.id));
      await db.batch(heartbeats);
    }
    const playersResult = await db.prepare("SELECT id, name, is_host, joined_at, last_seen FROM players WHERE lobby_id = ? AND removed = 0 ORDER BY joined_at ASC").bind(lobby.id).all<{ id: string; name: string; is_host: number; joined_at: number; last_seen: number }>();
    const activePlayers = playersResult.results ?? [];
    const round = await currentRound(lobby);
    let votesSubmitted = 0;
    let ownVote: string | null = null;
    let results: { playerId: string; name: string; votes: number }[] | null = null;
    if (round) {
      const count = await db.prepare("SELECT COUNT(*) AS count FROM votes WHERE round_id = ?").bind(round.id).first<{ count: number }>();
      votesSubmitted = count?.count ?? 0;
      const own = await db.prepare("SELECT target_id FROM votes WHERE round_id = ? AND voter_id = ?").bind(round.id, player.id).first<{ target_id: string }>();
      ownVote = own?.target_id ?? null;
      if (lobby.status === "results") {
        const totals = await db.prepare("SELECT p.id AS player_id, p.name, COUNT(v.target_id) AS votes FROM players p LEFT JOIN votes v ON v.target_id = p.id AND v.round_id = ? WHERE p.lobby_id = ? AND p.removed = 0 GROUP BY p.id, p.name ORDER BY votes DESC, p.name ASC").bind(round.id, lobby.id).all<{ player_id: string; name: string; votes: number }>();
        results = (totals.results ?? []).map((row) => ({ playerId: row.player_id, name: row.name, votes: row.votes }));
      }
    }
    const host = activePlayers.find((item) => item.id === lobby.host_player_id);
    const custom = player.is_host ? await db.prepare("SELECT id, crew_word, imposter_word, rating FROM custom_pairs WHERE lobby_id = ? ORDER BY created_at DESC").bind(lobby.id).all() : null;
    return reply({
      lobby: { id: lobby.id, name: lobby.name, status: lobby.status, contentMode: lobby.content_mode, pool: lobby.pool, imposterCount: lobby.imposter_count, discoverable: Boolean(lobby.discoverable), revision: lobby.revision, roundNumber: lobby.round_number },
      me: { id: player.id, name: player.name, isHost: Boolean(player.is_host) },
      players: activePlayers.map((item) => ({ id: item.id, name: item.name, isHost: Boolean(item.is_host), online: now - item.last_seen < 45000 })),
      votesSubmitted, ownVote, results,
      customPairs: custom?.results ?? undefined,
      canClaimHost: !player.is_host && Boolean(host) && now - (host?.last_seen ?? now) > 60000,
    });
  } catch (error) {
    console.error(error);
    return fail("Die Lobby konnte gerade nicht geladen werden.", 500);
  }
}

async function createRound(lobby: LobbyRow, players: PlayerRow[]) {
  const db = getD1();
  let pair: { crew: string; imposter: string } | null = null;
  if (lobby.pool === "custom") {
    const ratingClause = lobby.content_mode === "family" ? "AND rating = 'family'" : "";
    const row = await db.prepare(`SELECT crew_word, imposter_word FROM custom_pairs WHERE lobby_id = ? ${ratingClause} ORDER BY RANDOM() LIMIT 1`).bind(lobby.id).first<{ crew_word: string; imposter_word: string }>();
    if (row) pair = { crew: row.crew_word, imposter: row.imposter_word };
  } else {
    const eligible = WORD_PAIRS.filter((item) => (lobby.content_mode === "adult" || item.rating === "family") && (lobby.pool === "random" || item.category === lobby.pool));
    if (eligible.length) pair = eligible[secureIndex(eligible.length)];
  }
  if (!pair) throw new Error("POOL_EMPTY");
  const imposterCount = Math.min(lobby.imposter_count, maxImposterCount(players.length));
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) { const j = secureIndex(i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const imposters = new Set(shuffled.slice(0, imposterCount).map((item) => item.id));
  const roundId = crypto.randomUUID();
  const roundNumber = lobby.round_number + 1;
  const now = Date.now();
  const statements = [
    db.prepare("DELETE FROM assignments WHERE round_id IN (SELECT id FROM rounds WHERE lobby_id = ?)").bind(lobby.id),
    db.prepare("DELETE FROM votes WHERE round_id IN (SELECT id FROM rounds WHERE lobby_id = ?)").bind(lobby.id),
    db.prepare("DELETE FROM rounds WHERE lobby_id = ?").bind(lobby.id),
    db.prepare("DELETE FROM players WHERE lobby_id = ? AND removed = 1").bind(lobby.id),
    db.prepare("INSERT INTO rounds (id, lobby_id, number, status, crew_word, imposter_word, created_at) VALUES (?, ?, ?, 'revealing', ?, ?, ?)").bind(roundId, lobby.id, roundNumber, pair.crew, pair.imposter, now),
    ...players.map((item) => db.prepare("INSERT INTO assignments (round_id, player_id, role, word) VALUES (?, ?, ?, ?)").bind(roundId, item.id, imposters.has(item.id) ? "imposter" : "crew", imposters.has(item.id) ? pair!.imposter : pair!.crew)),
    db.prepare("UPDATE lobbies SET status = 'revealing', round_number = ?, finished_at = NULL, revision = revision + 1, updated_at = ? WHERE id = ? AND status IN ('waiting', 'results')").bind(roundNumber, now, lobby.id),
  ];
  await db.batch(statements);
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = await request.json() as Record<string, unknown>;
    const action = cleanText(body.action, 32);
    const db = getD1();

    if (action === "create") {
      if (!(await rateLimit(request, "create", 12))) return fail("Zu viele neue Lobbys. Bitte warte kurz.", 429);
      await cleanupDatabase(db);
      const name = cleanText(body.groupName, 28); const playerName = cleanText(body.playerName, 24);
      if (name.length < 2 || playerName.length < 2) return fail("Bitte gib Gruppen- und Spielernamen mit mindestens zwei Zeichen ein.");
      const normalized = normalizeName(name);
      const existing = await db.prepare("SELECT id, status FROM lobbies WHERE normalized_name = ?").bind(normalized).first<{ id: string; status: LobbyRow["status"] }>();
      if (existing?.status === "results") await deleteImposterLobby(db, existing.id);
      else if (existing) return fail("Dieser Gruppenname ist gerade schon vergeben.", 409);
      const lobbyId = crypto.randomUUID(); const playerId = crypto.randomUUID(); const token = makeToken(); const tokenHash = await digest(token); const now = Date.now();
      await db.batch([
        db.prepare("INSERT INTO lobbies (id, name, normalized_name, status, host_player_id, content_mode, pool, imposter_count, imposter_overridden, discoverable, revision, network_hash, round_number, created_at, updated_at) VALUES (?, ?, ?, 'waiting', ?, 'family', 'random', 1, 0, 1, 1, ?, 0, ?, ?)").bind(lobbyId, name, normalized, playerId, await networkHash(request), now, now),
        db.prepare("INSERT INTO players (id, lobby_id, name, normalized_name, token_hash, is_host, removed, joined_at, last_seen) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)").bind(playerId, lobbyId, playerName, normalizeName(playerName), tokenHash, now, now),
      ]);
      return reply({ lobbyId, token }, 201);
    }

    if (action === "join") {
      if (!(await rateLimit(request, "join", 30))) return fail("Zu viele Beitrittsversuche. Bitte warte kurz.", 429);
      await cleanupDatabase(db);
      const lobbyIdInput = cleanText(body.lobbyId, 64); const groupName = cleanText(body.groupName, 28); const playerName = cleanText(body.playerName, 24);
      if (playerName.length < 2 || (!lobbyIdInput && groupName.length < 2)) return fail("Bitte gib einen gültigen Gruppen- und Spielernamen ein.");
      const lobby = lobbyIdInput ? await db.prepare("SELECT * FROM lobbies WHERE id = ?").bind(lobbyIdInput).first<LobbyRow>() : await db.prepare("SELECT * FROM lobbies WHERE normalized_name = ?").bind(normalizeName(groupName)).first<LobbyRow>();
      if (!lobby) return fail("Diese Lobby wurde nicht gefunden.", 404);
      if (lobby.status !== "waiting") return fail("Diese Runde läuft bereits. Warte auf die nächste Lobbyrunde.", 409);
      const count = await db.prepare("SELECT COUNT(*) AS count FROM players WHERE lobby_id = ? AND removed = 0").bind(lobby.id).first<{ count: number }>();
      if ((count?.count ?? 0) >= 22) return fail("Diese Lobby ist voll.", 409);
      if (await db.prepare("SELECT id FROM players WHERE lobby_id = ? AND normalized_name = ? AND removed = 0").bind(lobby.id, normalizeName(playerName)).first()) return fail("Dieser Spielername ist in der Lobby schon vergeben.", 409);
      const playerId = crypto.randomUUID(); const token = makeToken(); const now = Date.now(); const nextCount = (count?.count ?? 0) + 1;
      const suggested = lobby.imposter_overridden ? lobby.imposter_count : defaultImposterCount(nextCount);
      await db.batch([
        db.prepare("DELETE FROM players WHERE lobby_id = ? AND normalized_name = ? AND removed = 1").bind(lobby.id, normalizeName(playerName)),
        db.prepare("INSERT INTO players (id, lobby_id, name, normalized_name, token_hash, is_host, removed, joined_at, last_seen) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)").bind(playerId, lobby.id, playerName, normalizeName(playerName), await digest(token), now, now),
        db.prepare("UPDATE lobbies SET imposter_count = ?, revision = revision + 1, updated_at = ? WHERE id = ?").bind(suggested, now, lobby.id),
      ]);
      return reply({ lobbyId: lobby.id, token }, 201);
    }

    const lobbyId = cleanText(body.lobbyId, 64);
    if (!lobbyId) return fail("Lobby fehlt.");

    if (action === "vote") {
      const auth = await authenticate(request, lobbyId); if (!auth) return fail("Deine Sitzung ist nicht mehr gültig.", 401);
      if (auth.lobby.status !== "voting") return fail("Die Abstimmung ist noch nicht geöffnet.", 409);
      const targetId = cleanText(body.targetId, 64); if (!targetId || targetId === auth.player.id) return fail("Wähle eine andere Person.");
      if (!await db.prepare("SELECT id FROM players WHERE id = ? AND lobby_id = ? AND removed = 0").bind(targetId, lobbyId).first()) return fail("Diese Person ist nicht mehr in der Lobby.", 404);
      const round = await currentRound(auth.lobby); if (!round) return fail("Runde nicht gefunden.", 404);
      await db.prepare("INSERT INTO votes (round_id, voter_id, target_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(round_id, voter_id) DO UPDATE SET target_id = excluded.target_id, created_at = excluded.created_at").bind(round.id, auth.player.id, targetId, Date.now()).run();
      return reply({ ok: true });
    }

    if (action === "claim_host") {
      const auth = await authenticate(request, lobbyId); if (!auth) return fail("Deine Sitzung ist nicht mehr gültig.", 401);
      const oldHost = await db.prepare("SELECT * FROM players WHERE id = ? AND removed = 0").bind(auth.lobby.host_player_id).first<PlayerRow>();
      if (!oldHost || Date.now() - oldHost.last_seen <= 60000) return fail("Der Host ist noch verbunden.", 409);
      await db.batch([
        db.prepare("UPDATE players SET is_host = 0 WHERE lobby_id = ?").bind(lobbyId),
        db.prepare("UPDATE players SET is_host = 1 WHERE id = ?").bind(auth.player.id),
        db.prepare("UPDATE lobbies SET host_player_id = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND host_player_id = ?").bind(auth.player.id, Date.now(), lobbyId, oldHost.id),
      ]);
      return reply({ ok: true });
    }

    if (action === "close") {
      const auth = await hostAuth(request, lobbyId); if (!auth) return fail("Nur der Host darf die Lobby beenden.", 403);
      if (auth.lobby.status !== "waiting" && auth.lobby.status !== "results") return fail("Eine laufende Runde kann nicht geschlossen werden.", 409);
      await deleteImposterLobby(db, lobbyId);
      return reply({ ok: true });
    }

    const auth = await hostAuth(request, lobbyId); if (!auth) return fail("Nur der Host darf das.", 403);
    if (action === "settings") {
      if (!(["waiting", "results"] as string[]).includes(auth.lobby.status)) return fail("Einstellungen können erst nach der Runde geändert werden.", 409);
      const mode = body.contentMode === "adult" ? "adult" : "family";
      if (mode === "adult" && body.adultConfirmed !== true) return fail("Bitte bestätige den Erwachsenenmodus.");
      const pool = cleanText(body.pool, 24) || "random";
      const category = CATEGORIES.find((item) => item.id === pool); if (!category) return fail("Unbekannter Wortpool.");
      if (category.rating === "adult" && mode !== "adult") return fail("Dieser Wortpool ist erst im Erwachsenenmodus verfügbar.");
      const playerCount = await db.prepare("SELECT COUNT(*) AS count FROM players WHERE lobby_id = ? AND removed = 0").bind(lobbyId).first<{ count: number }>();
      const requested = Number(body.imposterCount); const max = maxImposterCount(playerCount?.count ?? 3);
      if (!Number.isInteger(requested) || requested < 1 || requested > max) return fail(`Wähle zwischen 1 und ${max} Imposter.`);
      await db.prepare("UPDATE lobbies SET content_mode = ?, pool = ?, imposter_count = ?, imposter_overridden = 1, discoverable = ?, revision = revision + 1, updated_at = ? WHERE id = ?").bind(mode, pool, requested, body.discoverable === false ? 0 : 1, Date.now(), lobbyId).run();
      return reply({ ok: true });
    }
    if (action === "add_pair") {
      if (!(["waiting", "results"] as string[]).includes(auth.lobby.status)) return fail("Eigene Wörter kannst du zwischen Runden ergänzen.", 409);
      const crew = cleanText(body.crewWord, 40); const imposter = cleanText(body.imposterWord, 40);
      if (crew.length < 2 || imposter.length < 2 || normalizeName(crew) === normalizeName(imposter)) return fail("Gib zwei unterschiedliche Wörter mit mindestens zwei Zeichen ein.");
      const count = await db.prepare("SELECT COUNT(*) AS count FROM custom_pairs WHERE lobby_id = ?").bind(lobbyId).first<{ count: number }>();
      if ((count?.count ?? 0) >= 50) return fail("Eine Lobby kann höchstens 50 eigene Wortpaare haben.");
      const rating = body.rating === "adult" && auth.lobby.content_mode === "adult" ? "adult" : "family";
      await db.prepare("INSERT INTO custom_pairs (id, lobby_id, crew_word, imposter_word, rating, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), lobbyId, crew, imposter, rating, Date.now()).run();
      await db.prepare("UPDATE lobbies SET revision = revision + 1, updated_at = ? WHERE id = ?").bind(Date.now(), lobbyId).run();
      return reply({ ok: true }, 201);
    }
    if (action === "remove") {
      if (!(["waiting", "results"] as string[]).includes(auth.lobby.status)) return fail("Spieler können nur zwischen Runden entfernt werden.", 409);
      const playerId = cleanText(body.playerId, 64); if (!playerId || playerId === auth.player.id) return fail("Du kannst dich als Host nicht selbst entfernen.");
      await db.prepare("UPDATE players SET removed = 1 WHERE id = ? AND lobby_id = ?").bind(playerId, lobbyId).run();
      const count = await db.prepare("SELECT COUNT(*) AS count FROM players WHERE lobby_id = ? AND removed = 0").bind(lobbyId).first<{ count: number }>();
      const next = auth.lobby.imposter_overridden ? Math.min(auth.lobby.imposter_count, maxImposterCount(count?.count ?? 3)) : defaultImposterCount(count?.count ?? 3);
      await db.prepare("UPDATE lobbies SET imposter_count = ?, revision = revision + 1, updated_at = ? WHERE id = ?").bind(next, Date.now(), lobbyId).run();
      return reply({ ok: true });
    }
    if (action === "start") {
      if (!(["waiting", "results"] as string[]).includes(auth.lobby.status)) return fail("Diese Runde läuft bereits.", 409);
      const playerList = await db.prepare("SELECT * FROM players WHERE lobby_id = ? AND removed = 0 ORDER BY joined_at").bind(lobbyId).all<PlayerRow>();
      const active = playerList.results ?? []; if (active.length < 3) return fail("Ihr braucht mindestens drei Spieler.", 409);
      try { await createRound(auth.lobby, active); } catch (error) { if (error instanceof Error && error.message === "POOL_EMPTY") return fail("In diesem Wortpool fehlt noch ein passendes Wortpaar.", 409); throw error; }
      return reply({ ok: true });
    }
    if (action === "open_vote" || action === "finish_vote") {
      const expected = action === "open_vote" ? "revealing" : "voting"; const next = action === "open_vote" ? "voting" : "results";
      if (auth.lobby.status !== expected) return fail("Dieser Schritt ist gerade nicht möglich.", 409);
      const round = await currentRound(auth.lobby); if (!round) return fail("Runde nicht gefunden.", 404);
      await db.batch([
        db.prepare("UPDATE rounds SET status = ? WHERE id = ?").bind(next, round.id),
        db.prepare("UPDATE lobbies SET status = ?, finished_at = CASE WHEN ? = 'results' THEN ? ELSE NULL END, revision = revision + 1, updated_at = ? WHERE id = ? AND status = ?").bind(next, next, Date.now(), Date.now(), lobbyId, expected),
      ]);
      return reply({ ok: true });
    }
    return fail("Unbekannte Aktion.", 404);
  } catch (error) {
    console.error(error);
    return fail("Die Aktion konnte gerade nicht ausgeführt werden.", 500);
  }
}
