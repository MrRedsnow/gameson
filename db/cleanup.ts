const HOUR = 60 * 60 * 1000;
const RESULT_RETENTION = 30 * 60 * 1000;
const INACTIVE_RETENTION = 12 * HOUR;

export async function deleteImposterLobby(db: D1Database, lobbyId: string) {
  await db.batch([
    db.prepare("DELETE FROM assignments WHERE round_id IN (SELECT id FROM rounds WHERE lobby_id = ?)").bind(lobbyId),
    db.prepare("DELETE FROM votes WHERE round_id IN (SELECT id FROM rounds WHERE lobby_id = ?)").bind(lobbyId),
    db.prepare("DELETE FROM rounds WHERE lobby_id = ?").bind(lobbyId),
    db.prepare("DELETE FROM custom_pairs WHERE lobby_id = ?").bind(lobbyId),
    db.prepare("DELETE FROM players WHERE lobby_id = ?").bind(lobbyId),
    db.prepare("DELETE FROM lobbies WHERE id = ?").bind(lobbyId),
  ]);
}

export async function deleteWerewolfLobby(db: D1Database, lobbyId: string) {
  await db.batch([
    db.prepare("DELETE FROM werewolf_votes WHERE lobby_id = ?").bind(lobbyId),
    db.prepare("DELETE FROM werewolf_actions WHERE lobby_id = ?").bind(lobbyId),
    db.prepare("DELETE FROM werewolf_players WHERE lobby_id = ?").bind(lobbyId),
    db.prepare("DELETE FROM werewolf_lobbies WHERE id = ?").bind(lobbyId),
  ]);
}

export async function cleanupDatabase(db: D1Database, now = Date.now()) {
  const resultCutoff = now - RESULT_RETENTION;
  const inactiveCutoff = now - INACTIVE_RETENTION;
  const staleImposter = "SELECT id FROM lobbies WHERE (status = 'results' AND COALESCE(finished_at, updated_at) < ?) OR updated_at < ?";
  const staleWerewolf = "SELECT id FROM werewolf_lobbies WHERE (status = 'results' AND phase_started_at < ?) OR updated_at < ?";

  await db.batch([
    db.prepare(`DELETE FROM assignments WHERE round_id NOT IN (SELECT id FROM rounds) OR player_id NOT IN (SELECT id FROM players) OR round_id IN (SELECT id FROM rounds WHERE lobby_id IN (${staleImposter}))`).bind(resultCutoff, inactiveCutoff),
    db.prepare(`DELETE FROM votes WHERE round_id NOT IN (SELECT id FROM rounds) OR voter_id NOT IN (SELECT id FROM players) OR target_id NOT IN (SELECT id FROM players) OR round_id IN (SELECT id FROM rounds WHERE lobby_id IN (${staleImposter}))`).bind(resultCutoff, inactiveCutoff),
    db.prepare(`DELETE FROM rounds WHERE lobby_id NOT IN (SELECT id FROM lobbies) OR lobby_id IN (${staleImposter})`).bind(resultCutoff, inactiveCutoff),
    db.prepare(`DELETE FROM custom_pairs WHERE lobby_id NOT IN (SELECT id FROM lobbies) OR lobby_id IN (${staleImposter})`).bind(resultCutoff, inactiveCutoff),
    db.prepare(`DELETE FROM players WHERE lobby_id NOT IN (SELECT id FROM lobbies) OR lobby_id IN (${staleImposter})`).bind(resultCutoff, inactiveCutoff),
    db.prepare("DELETE FROM lobbies WHERE (status = 'results' AND COALESCE(finished_at, updated_at) < ?) OR updated_at < ?").bind(resultCutoff, inactiveCutoff),

    db.prepare(`DELETE FROM werewolf_votes WHERE lobby_id NOT IN (SELECT id FROM werewolf_lobbies) OR voter_id NOT IN (SELECT id FROM werewolf_players) OR target_id NOT IN (SELECT id FROM werewolf_players) OR lobby_id IN (${staleWerewolf})`).bind(resultCutoff, inactiveCutoff),
    db.prepare(`DELETE FROM werewolf_actions WHERE lobby_id NOT IN (SELECT id FROM werewolf_lobbies) OR actor_id NOT IN (SELECT id FROM werewolf_players) OR lobby_id IN (${staleWerewolf})`).bind(resultCutoff, inactiveCutoff),
    db.prepare(`DELETE FROM werewolf_players WHERE lobby_id NOT IN (SELECT id FROM werewolf_lobbies) OR lobby_id IN (${staleWerewolf})`).bind(resultCutoff, inactiveCutoff),
    db.prepare("DELETE FROM werewolf_lobbies WHERE (status = 'results' AND phase_started_at < ?) OR updated_at < ?").bind(resultCutoff, inactiveCutoff),
    db.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(now),
  ]);
}
