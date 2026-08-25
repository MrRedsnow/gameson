import { ensureSchema, getD1 } from "../../../db";
import {
  ROLE_INFO,
  SELECTABLE_ROLES,
  buildRoleDeck,
  defaultWolfCount,
  determineWinner,
  maxWolfCount,
  roleTeam,
  validateRoleSetup,
  weightedVoteLeaders,
  type WerewolfPhase,
  type WerewolfPlayerState,
  type WerewolfRole,
} from "../../../lib/werewolf";
import { normalizeName } from "../../../lib/game";

export const runtime = "edge";

type LobbyRow = {
  id: string; name: string; normalized_name: string; status: "waiting" | "playing" | "results"; phase: WerewolfPhase; host_player_id: string;
  wolf_count: number; selected_roles: string; mayor_enabled: number; mayor_player_id: string | null; discoverable: number; audio_mode: "all" | "host"; revision: number; match_number: number;
  night: number; runoff_round: number; pending_wolf_victim_id: string | null; pending_heal_id: string | null; pending_poison_id: string | null;
  pending_hunter_id: string | null; winner: string | null; resolution_source: "night" | "day" | null; reserve_roles: string; phase_started_at: number;
  network_hash: string; created_at: number; updated_at: number;
};

type PlayerRow = {
  id: string; lobby_id: string; name: string; normalized_name: string; token_hash: string; is_host: number; removed: number; alive: number;
  role: WerewolfRole | null; team: "village" | "wolf" | "solo" | null; revealed: number; lover_id: string | null; role_model_id: string | null;
  charmed: number; elder_shield: number; heal_potion: number; poison_potion: number; last_protected_id: string | null; transformed_night: number | null;
  joined_at: number; last_seen: number;
};

const HOUR = 60 * 60 * 1000;
const DISCOVERY_WINDOW = 15 * 60 * 1000;

function reply(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
function fail(message: string, status = 400) { return reply({ error: message }, status); }
function cleanText(value: unknown, max: number) { return typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, max) : ""; }
function parseRoles(value: string): WerewolfRole[] { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((role): role is WerewolfRole => SELECTABLE_ROLES.includes(role)) : []; } catch { return []; } }

function rawToken(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function makeToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function secureIndex(length: number) {
  if (length <= 1) return 0;
  const max = Math.floor(0x100000000 / length) * length;
  const values = new Uint32Array(1);
  do crypto.getRandomValues(values); while (values[0] >= max);
  return values[0] % length;
}

function networkPrefix(request: Request) {
  const value = (request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local-preview").trim();
  return value.includes(":") ? value.split(":").slice(0, 4).join(":") : value;
}

async function networkHash(request: Request, offset = 0) {
  const bucket = Math.floor(Date.now() / DISCOVERY_WINDOW) + offset;
  return digest(`gameson-werewolf-nearby-v1|${networkPrefix(request)}|${bucket}`);
}

async function cleanup() {
  const db = getD1(); const cutoff = Date.now() - 12 * HOUR;
  await db.batch([
    db.prepare("DELETE FROM werewolf_votes WHERE lobby_id IN (SELECT id FROM werewolf_lobbies WHERE updated_at < ?)").bind(cutoff),
    db.prepare("DELETE FROM werewolf_actions WHERE lobby_id IN (SELECT id FROM werewolf_lobbies WHERE updated_at < ?)").bind(cutoff),
    db.prepare("DELETE FROM werewolf_players WHERE lobby_id IN (SELECT id FROM werewolf_lobbies WHERE updated_at < ?)").bind(cutoff),
    db.prepare("DELETE FROM werewolf_lobbies WHERE updated_at < ?").bind(cutoff),
    db.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(Date.now()),
  ]);
}

async function rateLimit(request: Request, action: string, max = 30) {
  const db = getD1(); const bucket = Math.floor(Date.now() / (10 * 60 * 1000)); const key = await digest(`${networkPrefix(request)}|werewolf|${action}|${bucket}`);
  await db.prepare("INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1").bind(key, Date.now() + 11 * 60 * 1000).run();
  const row = await db.prepare("SELECT count FROM rate_limits WHERE key = ?").bind(key).first<{ count: number }>();
  return (row?.count ?? 0) <= max;
}

async function authenticate(request: Request, lobbyId?: string) {
  const token = rawToken(request); if (!token) return null;
  const db = getD1(); const hash = await digest(token);
  const player = await db.prepare("SELECT * FROM werewolf_players WHERE token_hash = ? AND removed = 0").bind(hash).first<PlayerRow>();
  if (!player || (lobbyId && player.lobby_id !== lobbyId)) return null;
  const lobby = await db.prepare("SELECT * FROM werewolf_lobbies WHERE id = ?").bind(player.lobby_id).first<LobbyRow>();
  return lobby ? { player, lobby } : null;
}

async function hostAuth(request: Request, lobbyId: string) {
  const auth = await authenticate(request, lobbyId);
  return auth && auth.player.is_host && auth.lobby.host_player_id === auth.player.id ? auth : null;
}

async function activePlayers(lobbyId: string): Promise<PlayerRow[]> {
  const result = await getD1().prepare("SELECT * FROM werewolf_players WHERE lobby_id = ? AND removed = 0 ORDER BY joined_at ASC").bind(lobbyId).all<PlayerRow>();
  return (result.results ?? []) as PlayerRow[];
}

async function updatePhase(lobbyId: string, phase: WerewolfPhase, extras = "", bindings: unknown[] = []) {
  const sql = `UPDATE werewolf_lobbies SET phase = ?, phase_started_at = ?, revision = revision + 1, updated_at = ?${extras} WHERE id = ?`;
  await getD1().prepare(sql).bind(phase, Date.now(), Date.now(), ...bindings, lobbyId).run();
}

async function insertAction(lobby: LobbyRow, actorId: string, kind: string, targetId: string | null, target2Id: string | null, payload: unknown = null) {
  await getD1().prepare("INSERT INTO werewolf_actions (id, lobby_id, match_number, cycle, phase, actor_id, kind, target_id, target2_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(lobby_id, match_number, cycle, phase, actor_id, kind) DO UPDATE SET target_id = excluded.target_id, target2_id = excluded.target2_id, payload = excluded.payload, created_at = excluded.created_at")
    .bind(crypto.randomUUID(), lobby.id, lobby.match_number, lobby.night, lobby.phase, actorId, kind, targetId, target2Id, payload == null ? null : JSON.stringify(payload), Date.now()).run();
}

async function phaseActors(lobby: LobbyRow, phase = lobby.phase) {
  const allPlayers = await activePlayers(lobby.id);
  if (phase === "hunter") return allPlayers.filter((player) => player.id === lobby.pending_hunter_id);
  const players = allPlayers.filter((player) => player.alive);
  if (phase === "mayor_vote" || phase === "day_vote" || phase === "runoff") return players;
  if (phase === "wolves") return players.filter((player) => player.team === "wolf" || player.role === "white_werewolf");
  const roleByPhase: Partial<Record<WerewolfPhase, WerewolfRole>> = { thief: "thief", cupid: "cupid", wild_child: "wild_child", healer: "healer", seer: "seer", witch: "witch", white_werewolf: "white_werewolf", piper: "piper" };
  const role = roleByPhase[phase];
  return role ? players.filter((player) => player.role === role) : [];
}

async function nextInitialPhase(lobby: LobbyRow, after?: WerewolfPhase) {
  const sequence: WerewolfPhase[] = ["thief", "cupid", "wild_child"];
  const start = after ? sequence.indexOf(after) + 1 : 0;
  for (const phase of sequence.slice(Math.max(0, start))) {
    if ((await phaseActors(lobby, phase)).length) { await updatePhase(lobby.id, phase); return; }
  }
  await beginNight(lobby);
}

async function beginNight(lobby: LobbyRow) {
  const db = getD1(); const night = lobby.night + 1;
  await db.prepare("DELETE FROM werewolf_votes WHERE lobby_id = ? AND match_number = ?").bind(lobby.id, lobby.match_number).run();
  await db.prepare("UPDATE werewolf_lobbies SET night = ?, runoff_round = 0, pending_wolf_victim_id = NULL, pending_heal_id = NULL, pending_poison_id = NULL, pending_hunter_id = NULL, resolution_source = NULL, revision = revision + 1, updated_at = ? WHERE id = ?").bind(night, Date.now(), lobby.id).run();
  const refreshed = await db.prepare("SELECT * FROM werewolf_lobbies WHERE id = ?").bind(lobby.id).first<LobbyRow>();
  if (!refreshed) return;
  await nextNightPhase(refreshed);
}

async function nextNightPhase(lobby: LobbyRow, after?: WerewolfPhase) {
  const sequence: WerewolfPhase[] = ["healer", "seer", "wolves", "witch", ...(lobby.night % 2 === 0 ? ["white_werewolf" as const] : []), "piper"];
  const start = after ? sequence.indexOf(after) + 1 : 0;
  for (const phase of sequence.slice(Math.max(0, start))) {
    if ((await phaseActors(lobby, phase)).length) { await updatePhase(lobby.id, phase); return; }
  }
  await resolveNight(lobby);
}

async function finishDeaths(lobbyId: string, source: "night" | "day") {
  const db = getD1(); const lobby = await db.prepare("SELECT * FROM werewolf_lobbies WHERE id = ?").bind(lobbyId).first<LobbyRow>(); if (!lobby) return;
  const players = await activePlayers(lobbyId);
  const deadIds = new Set(players.filter((player) => !player.alive).map((player) => player.id));
  const transformations = players.filter((player) => player.alive && player.role === "wild_child" && player.team !== "wolf" && player.role_model_id && deadIds.has(player.role_model_id));
  if (transformations.length) await db.batch(transformations.map((player) => db.prepare("UPDATE werewolf_players SET team = 'wolf', transformed_night = ? WHERE id = ?").bind(lobby.night + (source === "day" ? 1 : 0), player.id)));
  if (lobby.mayor_player_id && deadIds.has(lobby.mayor_player_id)) await db.prepare("UPDATE werewolf_lobbies SET mayor_player_id = NULL WHERE id = ?").bind(lobbyId).run();
  const refreshedPlayers = await activePlayers(lobbyId);
  const winner = determineWinner(refreshedPlayers.map((player) => ({ id: player.id, role: player.role!, alive: Boolean(player.alive), team: player.team!, charmed: Boolean(player.charmed), loverId: player.lover_id, roleModelId: player.role_model_id, elderShield: Boolean(player.elder_shield) } satisfies WerewolfPlayerState)));
  if (winner) {
    await db.prepare("UPDATE werewolf_lobbies SET status = 'results', phase = 'results', winner = ?, pending_hunter_id = NULL, resolution_source = ?, phase_started_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?").bind(winner, source, Date.now(), Date.now(), lobbyId).run();
  } else {
    await db.prepare("UPDATE werewolf_lobbies SET phase = 'dawn', pending_hunter_id = NULL, resolution_source = ?, phase_started_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?").bind(source, Date.now(), Date.now(), lobbyId).run();
  }
}

async function killPlayers(lobby: LobbyRow, initialIds: string[], source: "night" | "day", afterHunter = false) {
  const db = getD1(); const players = await activePlayers(lobby.id); const byId = new Map(players.map((player) => [player.id, player]));
  const deaths = new Set(initialIds.filter((id) => byId.get(id)?.alive));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...deaths]) {
      const loverId = byId.get(id)?.lover_id;
      if (loverId && byId.get(loverId)?.alive && !deaths.has(loverId)) { deaths.add(loverId); changed = true; }
    }
  }
  if (deaths.size) await db.batch([...deaths].map((id) => db.prepare("UPDATE werewolf_players SET alive = 0, revealed = 1 WHERE id = ?").bind(id)));
  const hunter = [...deaths].map((id) => byId.get(id)).find((player) => player?.role === "hunter");
  if (hunter && !afterHunter && !lobby.pending_hunter_id) {
    await db.prepare("UPDATE werewolf_lobbies SET phase = 'hunter', pending_hunter_id = ?, resolution_source = ?, phase_started_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?").bind(hunter.id, source, Date.now(), Date.now(), lobby.id).run();
    return;
  }
  await finishDeaths(lobby.id, source);
}

async function resolveNight(lobby: LobbyRow) {
  const db = getD1(); const refreshed = await db.prepare("SELECT * FROM werewolf_lobbies WHERE id = ?").bind(lobby.id).first<LobbyRow>(); if (!refreshed) return;
  const players = await activePlayers(lobby.id); const byId = new Map(players.map((player) => [player.id, player])); const deaths: string[] = [];
  const wolfVictim = refreshed.pending_wolf_victim_id ? byId.get(refreshed.pending_wolf_victim_id) : null;
  if (wolfVictim && wolfVictim.alive && wolfVictim.id !== refreshed.pending_heal_id) {
    if (wolfVictim.role === "elder" && wolfVictim.elder_shield) await db.prepare("UPDATE werewolf_players SET elder_shield = 0 WHERE id = ?").bind(wolfVictim.id).run();
    else deaths.push(wolfVictim.id);
  }
  if (refreshed.pending_poison_id && byId.get(refreshed.pending_poison_id)?.alive) deaths.push(refreshed.pending_poison_id);
  const whiteAction = await db.prepare("SELECT target_id FROM werewolf_actions WHERE lobby_id = ? AND match_number = ? AND cycle = ? AND phase = 'white_werewolf' ORDER BY created_at DESC LIMIT 1").bind(lobby.id, lobby.match_number, lobby.night).first<{ target_id: string | null }>();
  if (whiteAction?.target_id && byId.get(whiteAction.target_id)?.alive) deaths.push(whiteAction.target_id);
  await db.prepare("UPDATE werewolf_lobbies SET pending_wolf_victim_id = NULL, pending_heal_id = NULL, pending_poison_id = NULL WHERE id = ?").bind(lobby.id).run();
  await killPlayers(refreshed, [...new Set(deaths)], "night");
}

async function submittedCount(lobby: LobbyRow, phase: WerewolfPhase) {
  const db = getD1();
  if (["mayor_vote", "wolves", "day_vote", "runoff"].includes(phase)) {
    const row = await db.prepare("SELECT COUNT(*) AS count FROM werewolf_votes WHERE lobby_id = ? AND match_number = ? AND cycle = ? AND phase = ?").bind(lobby.id, lobby.match_number, lobby.night, phase).first<{ count: number }>();
    return row?.count ?? 0;
  }
  const row = await db.prepare("SELECT COUNT(*) AS count FROM werewolf_actions WHERE lobby_id = ? AND match_number = ? AND cycle = ? AND phase = ?").bind(lobby.id, lobby.match_number, lobby.night, phase).first<{ count: number }>();
  return row?.count ?? 0;
}

async function resolveVotes(lobby: LobbyRow) {
  const db = getD1(); const players = await activePlayers(lobby.id);
  const rows = await db.prepare("SELECT voter_id, target_id FROM werewolf_votes WHERE lobby_id = ? AND match_number = ? AND cycle = ? AND phase = ?").bind(lobby.id, lobby.match_number, lobby.night, lobby.phase).all<{ voter_id: string; target_id: string }>();
  const voteRows = (rows.results ?? []) as { voter_id: string; target_id: string }[];
  const { leaders } = weightedVoteLeaders(voteRows.map((row) => ({ voterId: row.voter_id, targetId: row.target_id })), lobby.phase === "wolves" ? null : lobby.mayor_player_id);
  if (lobby.phase === "mayor_vote") {
    const winner = leaders.length ? leaders[secureIndex(leaders.length)] : players.filter((player) => player.alive)[secureIndex(players.filter((player) => player.alive).length)]?.id;
    if (winner) await db.prepare("UPDATE werewolf_lobbies SET mayor_player_id = ? WHERE id = ?").bind(winner, lobby.id).run();
    const refreshed = await db.prepare("SELECT * FROM werewolf_lobbies WHERE id = ?").bind(lobby.id).first<LobbyRow>(); if (!refreshed) return;
    if (lobby.night === 0) await nextInitialPhase(refreshed); else await updatePhase(lobby.id, "day_vote");
    return;
  }
  if (lobby.phase === "wolves") {
    const victim = leaders.length ? leaders[secureIndex(leaders.length)] : null;
    await db.prepare("UPDATE werewolf_lobbies SET pending_wolf_victim_id = ? WHERE id = ?").bind(victim, lobby.id).run();
    const refreshed = await db.prepare("SELECT * FROM werewolf_lobbies WHERE id = ?").bind(lobby.id).first<LobbyRow>(); if (refreshed) await nextNightPhase(refreshed, "wolves");
    return;
  }
  if (leaders.length === 1) { await killPlayers(lobby, leaders, "day"); return; }
  if (leaders.length > 1 && lobby.phase === "day_vote") {
    await updatePhase(lobby.id, "runoff", ", runoff_round = 1"); return;
  }
  if (leaders.length > 1 && lobby.phase === "runoff") {
    const scapegoat = players.find((player) => player.alive && player.role === "scapegoat");
    await killPlayers(lobby, scapegoat ? [scapegoat.id] : [], "day"); return;
  }
  await killPlayers(lobby, [], "day");
}

async function completeRolePhase(lobby: LobbyRow) {
  if (lobby.phase === "thief" || lobby.phase === "cupid" || lobby.phase === "wild_child") { await nextInitialPhase(lobby, lobby.phase); return; }
  if (["healer", "seer", "witch", "white_werewolf", "piper"].includes(lobby.phase)) { await nextNightPhase(lobby, lobby.phase); }
}

async function maybeAdvance(lobby: LobbyRow) {
  const actors = await phaseActors(lobby); const submitted = await submittedCount(lobby, lobby.phase);
  if (actors.length && submitted < actors.length) return;
  if (["mayor_vote", "wolves", "day_vote", "runoff"].includes(lobby.phase)) await resolveVotes(lobby);
  else await completeRolePhase(lobby);
}

async function forceAdvance(lobby: LobbyRow) {
  if (["mayor_vote", "wolves", "day_vote", "runoff"].includes(lobby.phase)) await resolveVotes(lobby);
  else if (lobby.phase === "hunter") await finishDeaths(lobby.id, lobby.resolution_source ?? "night");
  else await completeRolePhase(lobby);
}

async function actionCandidates(lobby: LobbyRow, me: PlayerRow, players: PlayerRow[]) {
  const living = players.filter((player) => player.alive);
  const others = living.filter((player) => player.id !== me.id);
  if (lobby.phase === "mayor_vote") return living;
  if (lobby.phase === "day_vote") return others;
  if (lobby.phase === "runoff") {
    const rows = await getD1().prepare("SELECT voter_id, target_id FROM werewolf_votes WHERE lobby_id = ? AND match_number = ? AND cycle = ? AND phase = 'day_vote'").bind(lobby.id, lobby.match_number, lobby.night).all<{ voter_id: string; target_id: string }>();
    const leaders = weightedVoteLeaders(((rows.results ?? []) as { voter_id: string; target_id: string }[]).map((row) => ({ voterId: row.voter_id, targetId: row.target_id })), lobby.mayor_player_id).leaders;
    return others.filter((player) => leaders.includes(player.id));
  }
  if (lobby.phase === "wolves") return living.filter((player) => player.team !== "wolf" && player.role !== "white_werewolf");
  if (lobby.phase === "healer") return living.filter((player) => player.id !== me.last_protected_id);
  if (["seer", "wild_child", "hunter"].includes(lobby.phase)) return others;
  if (lobby.phase === "cupid") return living;
  if (lobby.phase === "witch") return others;
  if (lobby.phase === "white_werewolf") return living.filter((player) => player.id !== me.id && player.team === "wolf");
  if (lobby.phase === "piper") return others.filter((player) => !player.charmed);
  return [];
}

export async function GET(request: Request) {
  try {
    await ensureSchema(); const url = new URL(request.url); const action = url.searchParams.get("action") ?? "state"; const db = getD1();
    if (action === "nearby") {
      await cleanup(); const [current, previous] = await Promise.all([networkHash(request), networkHash(request, -1)]);
      const result = await db.prepare("SELECT l.id, l.name, (SELECT COUNT(*) FROM werewolf_players p WHERE p.lobby_id = l.id AND p.removed = 0) AS player_count FROM werewolf_lobbies l WHERE l.discoverable = 1 AND l.status = 'waiting' AND l.network_hash IN (?, ?) ORDER BY l.updated_at DESC LIMIT 8").bind(current, previous).all();
      return reply({ lobbies: result.results ?? [] });
    }
    const lobbyId = cleanText(url.searchParams.get("lobbyId"), 64); const auth = await authenticate(request, lobbyId); if (!auth) return fail("Deine Werwolf-Sitzung ist nicht mehr gültig.", 401);
    const now = Date.now(); const { player, lobby } = auth;
    if (now - player.last_seen > 12000) {
      const nextNetwork = player.is_host ? await networkHash(request) : lobby.network_hash;
      await db.batch([db.prepare("UPDATE werewolf_players SET last_seen = ? WHERE id = ?").bind(now, player.id), db.prepare("UPDATE werewolf_lobbies SET updated_at = ?, network_hash = CASE WHEN host_player_id = ? THEN ? ELSE network_hash END WHERE id = ?").bind(now, player.id, nextNetwork, lobby.id)]);
    }
    const players = await activePlayers(lobby.id); const actors = await phaseActors(lobby); const isActor = actors.some((item) => item.id === player.id); const candidates = isActor ? await actionCandidates(lobby, player, players) : [];
    const submitted = await submittedCount(lobby, lobby.phase); const ownAction = await db.prepare("SELECT target_id, target2_id, payload FROM werewolf_actions WHERE lobby_id = ? AND match_number = ? AND cycle = ? AND phase = ? AND actor_id = ? ORDER BY created_at DESC LIMIT 1").bind(lobby.id, lobby.match_number, lobby.night, lobby.phase, player.id).first<{ target_id: string | null; target2_id: string | null; payload: string | null }>();
    const ownVote = await db.prepare("SELECT target_id FROM werewolf_votes WHERE lobby_id = ? AND match_number = ? AND cycle = ? AND phase = ? AND voter_id = ?").bind(lobby.id, lobby.match_number, lobby.night, lobby.phase, player.id).first<{ target_id: string }>();
    const host = players.find((item) => item.id === lobby.host_player_id);
    const lover = players.find((item) => item.id === player.lover_id); const model = players.find((item) => item.id === player.role_model_id);
    const myWolfView = player.team === "wolf" || player.role === "white_werewolf";
    const reserveRoles = player.role === "thief" && lobby.phase === "thief" ? JSON.parse(lobby.reserve_roles || "[]") : undefined;
    return reply({
      lobby: { id: lobby.id, name: lobby.name, status: lobby.status, phase: lobby.phase, wolfCount: lobby.wolf_count, selectedRoles: parseRoles(lobby.selected_roles), mayorEnabled: Boolean(lobby.mayor_enabled), mayorPlayerId: lobby.mayor_player_id, discoverable: Boolean(lobby.discoverable), audioMode: lobby.audio_mode === "host" ? "host" : "all", revision: lobby.revision, matchNumber: lobby.match_number, night: lobby.night, winner: lobby.winner, phaseStartedAt: lobby.phase_started_at },
      me: { id: player.id, name: player.name, isHost: Boolean(player.is_host), alive: Boolean(player.alive) },
      players: players.map((item) => ({ id: item.id, name: item.name, isHost: Boolean(item.is_host), alive: Boolean(item.alive), online: now - item.last_seen < 45000, role: item.id === player.id || item.revealed || lobby.status === "results" ? item.role : undefined, knownRole: myWolfView && item.alive && (item.team === "wolf" || item.role === "white_werewolf") ? (item.role === "white_werewolf" && item.id !== player.id ? "werewolf" : item.role) : undefined, charmed: item.id === player.id ? Boolean(item.charmed) : undefined })),
      privateRole: player.role ? { role: player.role, label: ROLE_INFO[player.role].label, description: ROLE_INFO[player.role].description, team: player.team, lover: lover?.name ?? null, roleModel: model?.name ?? null, charmed: Boolean(player.charmed), elderShield: Boolean(player.elder_shield), healPotion: Boolean(player.heal_potion), poisonPotion: Boolean(player.poison_potion), reserveRoles } : null,
      action: isActor && (player.alive || lobby.phase === "hunter") ? { phase: lobby.phase, candidates: candidates.map((item) => ({ id: item.id, name: item.name })), maxTargets: lobby.phase === "cupid" || lobby.phase === "piper" ? 2 : 1, wolfVictimId: lobby.phase === "witch" ? lobby.pending_wolf_victim_id : null, canHeal: lobby.phase === "witch" ? Boolean(player.heal_potion && lobby.pending_wolf_victim_id) : undefined, canPoison: lobby.phase === "witch" ? Boolean(player.poison_potion) : undefined } : null,
      ownSubmission: ownVote?.target_id ?? ownAction ?? null,
      actionResult: ownAction?.payload ? JSON.parse(ownAction.payload) : null,
      progress: { submitted, required: actors.length },
      canSkip: Boolean(player.is_host && lobby.status === "playing" && now - lobby.phase_started_at >= 60000),
      canClaimHost: !player.is_host && Boolean(host) && now - (host?.last_seen ?? now) > 60000,
      serverTime: now,
    });
  } catch (error) { console.error(error); return fail("Die Werwolf-Lobby konnte gerade nicht geladen werden.", 500); }
}

export async function POST(request: Request) {
  try {
    await ensureSchema(); const body = await request.json() as Record<string, unknown>; const action = cleanText(body.action, 32); const db = getD1();
    if (action === "create") {
      if (!(await rateLimit(request, "create", 12))) return fail("Zu viele neue Lobbys. Bitte warte kurz.", 429); await cleanup();
      const name = cleanText(body.groupName, 28); const playerName = cleanText(body.playerName, 24); if (name.length < 2 || playerName.length < 2) return fail("Bitte gib Gruppen- und Spielernamen mit mindestens zwei Zeichen ein.");
      const normalized = normalizeName(name); if (await db.prepare("SELECT id FROM werewolf_lobbies WHERE normalized_name = ?").bind(normalized).first()) return fail("Dieser Gruppenname ist gerade schon vergeben.", 409);
      const lobbyId = crypto.randomUUID(); const playerId = crypto.randomUUID(); const token = makeToken(); const now = Date.now();
      await db.batch([
        db.prepare("INSERT INTO werewolf_lobbies (id, name, normalized_name, status, phase, host_player_id, wolf_count, selected_roles, mayor_enabled, discoverable, revision, match_number, night, runoff_round, reserve_roles, phase_started_at, network_hash, created_at, updated_at) VALUES (?, ?, ?, 'waiting', 'waiting', ?, 1, '[]', 1, 1, 1, 0, 0, 0, '[]', ?, ?, ?, ?)").bind(lobbyId, name, normalized, playerId, now, await networkHash(request), now, now),
        db.prepare("INSERT INTO werewolf_players (id, lobby_id, name, normalized_name, token_hash, is_host, removed, alive, revealed, charmed, elder_shield, heal_potion, poison_potion, joined_at, last_seen) VALUES (?, ?, ?, ?, ?, 1, 0, 1, 0, 0, 0, 0, 0, ?, ?)").bind(playerId, lobbyId, playerName, normalizeName(playerName), await digest(token), now, now),
      ]);
      return reply({ lobbyId, token }, 201);
    }
    if (action === "join") {
      if (!(await rateLimit(request, "join", 30))) return fail("Zu viele Beitrittsversuche. Bitte warte kurz.", 429); await cleanup();
      const lobbyIdInput = cleanText(body.lobbyId, 64); const groupName = cleanText(body.groupName, 28); const playerName = cleanText(body.playerName, 24);
      if (playerName.length < 2 || (!lobbyIdInput && groupName.length < 2)) return fail("Bitte gib einen gültigen Gruppen- und Spielernamen ein.");
      const lobby = lobbyIdInput ? await db.prepare("SELECT * FROM werewolf_lobbies WHERE id = ?").bind(lobbyIdInput).first<LobbyRow>() : await db.prepare("SELECT * FROM werewolf_lobbies WHERE normalized_name = ?").bind(normalizeName(groupName)).first<LobbyRow>();
      if (!lobby) return fail("Diese Werwolf-Lobby wurde nicht gefunden.", 404); if (lobby.status !== "waiting") return fail("Diese Partie läuft bereits.", 409);
      const players = await activePlayers(lobby.id); if (players.length >= 22) return fail("Diese Lobby ist voll.", 409); if (players.some((item) => item.normalized_name === normalizeName(playerName))) return fail("Dieser Spielername ist schon vergeben.", 409);
      const playerId = crypto.randomUUID(); const token = makeToken(); const now = Date.now(); const suggested = defaultWolfCount(players.length + 1);
      await db.batch([
        db.prepare("INSERT INTO werewolf_players (id, lobby_id, name, normalized_name, token_hash, is_host, removed, alive, revealed, charmed, elder_shield, heal_potion, poison_potion, joined_at, last_seen) VALUES (?, ?, ?, ?, ?, 0, 0, 1, 0, 0, 0, 0, 0, ?, ?)").bind(playerId, lobby.id, playerName, normalizeName(playerName), await digest(token), now, now),
        db.prepare("UPDATE werewolf_lobbies SET wolf_count = MIN(?, ?), revision = revision + 1, updated_at = ? WHERE id = ?").bind(suggested, maxWolfCount(players.length + 1), now, lobby.id),
      ]);
      return reply({ lobbyId: lobby.id, token }, 201);
    }

    const lobbyId = cleanText(body.lobbyId, 64); if (!lobbyId) return fail("Lobby fehlt.");
    if (action === "claim_host") {
      const auth = await authenticate(request, lobbyId); if (!auth) return fail("Deine Sitzung ist nicht mehr gültig.", 401); const oldHost = await db.prepare("SELECT * FROM werewolf_players WHERE id = ? AND removed = 0").bind(auth.lobby.host_player_id).first<PlayerRow>();
      if (!oldHost || Date.now() - oldHost.last_seen <= 60000) return fail("Der Host ist noch verbunden.", 409);
      await db.batch([db.prepare("UPDATE werewolf_players SET is_host = 0 WHERE lobby_id = ?").bind(lobbyId), db.prepare("UPDATE werewolf_players SET is_host = 1 WHERE id = ?").bind(auth.player.id), db.prepare("UPDATE werewolf_lobbies SET host_player_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?").bind(auth.player.id, Date.now(), lobbyId)]);
      return reply({ ok: true });
    }

    if (action === "vote" || action === "act") {
      const auth = await authenticate(request, lobbyId); if (!auth) return fail("Deine Sitzung ist nicht mehr gültig.", 401); const { lobby, player } = auth;
      if (body.phase !== lobby.phase || Number(body.matchNumber) !== lobby.match_number) return fail("Diese Phase ist bereits vorbei.", 409); if (!player.alive && !(lobby.phase === "hunter" && lobby.pending_hunter_id === player.id)) return fail("Du schaust dieser Partie nur noch zu.", 409);
      const actors = await phaseActors(lobby); if (!actors.some((item) => item.id === player.id)) return fail("Du bist in dieser Phase nicht an der Reihe.", 403); const players = await activePlayers(lobby.id); const candidates = await actionCandidates(lobby, player, players); const allowed = new Set(candidates.map((item) => item.id));
      if (action === "vote") {
        if (!allowed.has(cleanText(body.targetId, 64))) return fail("Dieses Ziel ist nicht verfügbar."); const targetId = cleanText(body.targetId, 64);
        await db.prepare("INSERT INTO werewolf_votes (lobby_id, match_number, cycle, phase, voter_id, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(lobby_id, match_number, cycle, phase, voter_id) DO UPDATE SET target_id = excluded.target_id, created_at = excluded.created_at").bind(lobby.id, lobby.match_number, lobby.night, lobby.phase, player.id, targetId, Date.now()).run();
        await maybeAdvance(lobby); return reply({ ok: true });
      }
      const targetId = cleanText(body.targetId, 64) || null; const target2Id = cleanText(body.target2Id, 64) || null;
      if (lobby.phase === "thief") {
        const choice = cleanText(body.choice, 24) as WerewolfRole; const reserves = JSON.parse(lobby.reserve_roles || "[]") as WerewolfRole[]; if (!["thief", ...reserves].includes(choice)) return fail("Diese Reservekarte gibt es nicht.");
        await db.prepare("UPDATE werewolf_players SET role = ?, team = ? WHERE id = ?").bind(choice, roleTeam(choice), player.id).run(); await insertAction(lobby, player.id, "thief", null, null, { choice });
      } else if (lobby.phase === "cupid") {
        if (!targetId || !target2Id || targetId === target2Id || !allowed.has(targetId) || !allowed.has(target2Id)) return fail("Wähle zwei unterschiedliche Verliebte.");
        await db.batch([db.prepare("UPDATE werewolf_players SET lover_id = ? WHERE id = ?").bind(target2Id, targetId), db.prepare("UPDATE werewolf_players SET lover_id = ? WHERE id = ?").bind(targetId, target2Id)]); await insertAction(lobby, player.id, "cupid", targetId, target2Id);
      } else if (lobby.phase === "wild_child") {
        if (!targetId || !allowed.has(targetId)) return fail("Wähle ein Vorbild."); await db.prepare("UPDATE werewolf_players SET role_model_id = ? WHERE id = ?").bind(targetId, player.id).run(); await insertAction(lobby, player.id, "wild_child", targetId, null);
      } else if (lobby.phase === "healer") {
        if (!targetId || !allowed.has(targetId)) return fail("Wähle eine schützbare Person."); await db.batch([db.prepare("UPDATE werewolf_players SET last_protected_id = ? WHERE id = ?").bind(targetId, player.id), db.prepare("UPDATE werewolf_lobbies SET pending_heal_id = ? WHERE id = ?").bind(targetId, lobby.id)]); await insertAction(lobby, player.id, "healer", targetId, null);
      } else if (lobby.phase === "seer") {
        if (!targetId || !allowed.has(targetId)) return fail("Wähle eine Person."); const target = players.find((item) => item.id === targetId)!; await insertAction(lobby, player.id, "seer", targetId, null, { seenRole: target.role, seenLabel: target.role ? ROLE_INFO[target.role].label : "Unbekannt", name: target.name });
      } else if (lobby.phase === "witch") {
        const heal = body.heal === true; if (heal && (!player.heal_potion || !lobby.pending_wolf_victim_id)) return fail("Der Heiltrank ist nicht verfügbar."); if (target2Id && (!player.poison_potion || !allowed.has(target2Id))) return fail("Dieses Giftziel ist nicht verfügbar."); if (heal && target2Id === lobby.pending_wolf_victim_id) return fail("Dieselbe Person kann nicht geheilt und vergiftet werden.");
        await db.batch([db.prepare("UPDATE werewolf_players SET heal_potion = CASE WHEN ? THEN 0 ELSE heal_potion END, poison_potion = CASE WHEN ? IS NOT NULL THEN 0 ELSE poison_potion END WHERE id = ?").bind(heal ? 1 : 0, target2Id, player.id), db.prepare("UPDATE werewolf_lobbies SET pending_wolf_victim_id = CASE WHEN ? THEN NULL ELSE pending_wolf_victim_id END, pending_poison_id = ? WHERE id = ?").bind(heal ? 1 : 0, target2Id, lobby.id)]); await insertAction(lobby, player.id, "witch", heal ? lobby.pending_wolf_victim_id : null, target2Id, { heal });
      } else if (lobby.phase === "white_werewolf") {
        if (targetId && !allowed.has(targetId)) return fail("Wähle einen anderen Wolf oder passe."); await insertAction(lobby, player.id, "white_werewolf", targetId, null);
      } else if (lobby.phase === "piper") {
        const targets = [targetId, target2Id].filter((id): id is string => Boolean(id)); if (!targets.length || new Set(targets).size !== targets.length || targets.some((id) => !allowed.has(id))) return fail("Wähle ein oder zwei noch nicht verzauberte Personen."); await db.batch(targets.map((id) => db.prepare("UPDATE werewolf_players SET charmed = 1 WHERE id = ?").bind(id))); await insertAction(lobby, player.id, "piper", targets[0], targets[1] ?? null);
      } else if (lobby.phase === "hunter") {
        const deadHunter = await db.prepare("SELECT * FROM werewolf_players WHERE id = ?").bind(lobby.pending_hunter_id).first<PlayerRow>(); if (!deadHunter || player.id !== deadHunter.id) return fail("Nur der Jäger darf schießen."); if (!targetId || !allowed.has(targetId)) return fail("Wähle eine lebende Person."); await insertAction(lobby, player.id, "hunter", targetId, null); await killPlayers(lobby, [targetId], lobby.resolution_source ?? "night", true); return reply({ ok: true });
      } else return fail("In dieser Phase ist keine Rollenaktion möglich.", 409);
      await maybeAdvance(lobby); return reply({ ok: true });
    }

    const auth = await hostAuth(request, lobbyId); if (!auth) return fail("Nur der Host darf das.", 403); const { lobby } = auth;
    if (action === "settings") {
      if (lobby.status !== "waiting" && lobby.status !== "results") return fail("Einstellungen können nur zwischen Partien geändert werden.", 409); const players = await activePlayers(lobbyId); const roles = Array.isArray(body.selectedRoles) ? body.selectedRoles.filter((role): role is WerewolfRole => typeof role === "string" && SELECTABLE_ROLES.includes(role as WerewolfRole)) : [];
      const wolves = Number(body.wolfCount); const error = validateRoleSetup(Math.max(3, players.length), wolves, roles); if (error) return fail(error);
      const audioMode = body.audioMode === "host" || body.audioMode === "all" ? body.audioMode : lobby.audio_mode;
      await db.prepare("UPDATE werewolf_lobbies SET wolf_count = ?, selected_roles = ?, mayor_enabled = ?, discoverable = ?, audio_mode = ?, revision = revision + 1, updated_at = ? WHERE id = ?").bind(wolves, JSON.stringify(roles), body.mayorEnabled === false ? 0 : 1, body.discoverable === false ? 0 : 1, audioMode, Date.now(), lobbyId).run(); return reply({ ok: true });
    }
    if (action === "remove") {
      if (lobby.status !== "waiting" && lobby.status !== "results") return fail("Spieler können nur zwischen Partien entfernt werden.", 409); const playerId = cleanText(body.playerId, 64); if (!playerId || playerId === auth.player.id) return fail("Du kannst dich nicht selbst entfernen."); await db.prepare("UPDATE werewolf_players SET removed = 1 WHERE id = ? AND lobby_id = ?").bind(playerId, lobbyId).run(); return reply({ ok: true });
    }
    if (action === "start") {
      if (lobby.status !== "waiting" && lobby.status !== "results") return fail("Diese Partie läuft bereits.", 409); const players = await activePlayers(lobbyId); if (players.length < 3) return fail("Ihr braucht mindestens drei Personen.", 409); const roles = parseRoles(lobby.selected_roles); const error = validateRoleSetup(players.length, lobby.wolf_count, roles); if (error) return fail(error);
      const deck = buildRoleDeck(players.length, lobby.wolf_count, roles, secureIndex); const reserveRoles: WerewolfRole[] = roles.includes("thief") ? ["villager", secureIndex(2) ? "werewolf" : "villager"] : [];
      const now = Date.now(); await db.batch(players.map((player, index) => { const role = deck[index]; return db.prepare("UPDATE werewolf_players SET alive = 1, role = ?, team = ?, revealed = 0, lover_id = NULL, role_model_id = NULL, charmed = 0, elder_shield = ?, heal_potion = ?, poison_potion = ?, last_protected_id = NULL, transformed_night = NULL WHERE id = ?").bind(role, roleTeam(role), role === "elder" ? 1 : 0, role === "witch" ? 1 : 0, role === "witch" ? 1 : 0, player.id); }));
      await db.batch([db.prepare("DELETE FROM werewolf_actions WHERE lobby_id = ?").bind(lobbyId), db.prepare("DELETE FROM werewolf_votes WHERE lobby_id = ?").bind(lobbyId), db.prepare("UPDATE werewolf_lobbies SET status = 'playing', phase = 'waiting', match_number = match_number + 1, night = 0, runoff_round = 0, mayor_player_id = NULL, pending_wolf_victim_id = NULL, pending_heal_id = NULL, pending_poison_id = NULL, pending_hunter_id = NULL, winner = NULL, resolution_source = NULL, reserve_roles = ?, phase_started_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?").bind(JSON.stringify(reserveRoles), now, now, lobbyId)]);
      const refreshed = await db.prepare("SELECT * FROM werewolf_lobbies WHERE id = ?").bind(lobbyId).first<LobbyRow>(); if (refreshed) { if (refreshed.mayor_enabled) await updatePhase(lobbyId, "mayor_vote"); else await nextInitialPhase(refreshed); } return reply({ ok: true });
    }
    if (action === "advance") {
      if (lobby.phase === "discussion") { if (lobby.mayor_enabled && !lobby.mayor_player_id) await updatePhase(lobbyId, "mayor_vote"); else await updatePhase(lobbyId, "day_vote"); }
      else if (lobby.phase === "dawn") { if (lobby.resolution_source === "day") await beginNight(lobby); else await updatePhase(lobbyId, "discussion"); }
      else return fail("Diese Phase kann gerade nicht weitergeschaltet werden.", 409); return reply({ ok: true });
    }
    if (action === "skip") {
      if (Date.now() - lobby.phase_started_at < 60000) return fail("Diese Aktion kann erst nach 60 Sekunden übersprungen werden.", 409); await forceAdvance(lobby); return reply({ ok: true });
    }
    if (action === "new_match") {
      if (lobby.status !== "results") return fail("Die Partie ist noch nicht beendet.", 409); await db.batch([db.prepare("UPDATE werewolf_players SET alive = 1, role = NULL, team = NULL, revealed = 0, lover_id = NULL, role_model_id = NULL, charmed = 0, elder_shield = 0, heal_potion = 0, poison_potion = 0, last_protected_id = NULL, transformed_night = NULL WHERE lobby_id = ? AND removed = 0").bind(lobbyId), db.prepare("UPDATE werewolf_lobbies SET status = 'waiting', phase = 'waiting', mayor_player_id = NULL, winner = NULL, night = 0, resolution_source = NULL, revision = revision + 1, updated_at = ? WHERE id = ?").bind(Date.now(), lobbyId)]); return reply({ ok: true });
    }
    return fail("Unbekannte Aktion.", 404);
  } catch (error) { console.error(error); return fail(error instanceof Error && error.message ? error.message : "Die Aktion konnte gerade nicht ausgeführt werden.", 500); }
}
