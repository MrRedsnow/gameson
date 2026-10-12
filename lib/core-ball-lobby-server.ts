import type { CoreBallGame, CoreBallMode } from "./core-ball";

export type CoreBallReceipt = { commandId: string; commandSeq: number; revision: number };
export type CoreBallState = {
  lobby: { id: string; name: string; hostPlayerId: string; settings: { mode: CoreBallMode }; discoverable: boolean; revision: number };
  members: { id: string; name: string }[];
  me: { id: string; name: string; commandSeq: number };
  game: CoreBallGame | null;
  serverReceivedAt: number;
  serverSentAt: number;
};
export type CoreBallCommandAck = { ack: CoreBallReceipt; state?: CoreBallState; left?: true };
export type CoreBallMember = {
  id: string; name: string; tokenHash: string; commandSeq: number;
  commandId?: string; payloadHash?: string; ack?: CoreBallCommandAck; removed?: boolean;
};
export type CoreBallLobby = {
  id: string; name: string; normalized_name: string; host_player_id: string; settings: string;
  members: string; game: string | null; discoverable: number; network_hash: string;
  revision: number; created_at: number; updated_at: number;
};
export type CoreBallLobbyDatabase = { prepare(sql: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null> } } };

export async function digestCoreBallToken(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Removed seats retain only their latest receipt for bounded retry recovery. */
export function coreBallLobbyAllMembers(lobby: CoreBallLobby): CoreBallMember[] { return JSON.parse(lobby.members); }
export function coreBallLobbyMembers(lobby: CoreBallLobby): CoreBallMember[] { return coreBallLobbyAllMembers(lobby).filter((member) => !member.removed); }
export function coreBallLobbyGame(lobby: CoreBallLobby): CoreBallGame | null { return lobby.game ? JSON.parse(lobby.game) : null; }
export function coreBallLobbySettings(lobby: CoreBallLobby): { mode: CoreBallMode } { return JSON.parse(lobby.settings); }

export async function authenticateCoreBallToken(secret: string, lobby: CoreBallLobby) {
  if (!/^[a-f0-9]{64}$/.test(secret)) return undefined;
  const hash = await digestCoreBallToken(secret);
  return coreBallLobbyMembers(lobby).find((member) => member.tokenHash === hash);
}

export function coreBallLobbyView(lobby: CoreBallLobby, me: CoreBallMember, receivedAt = Date.now()): CoreBallState {
  return {
    lobby: { id: lobby.id, name: lobby.name, hostPlayerId: lobby.host_player_id, settings: coreBallLobbySettings(lobby), discoverable: Boolean(lobby.discoverable), revision: lobby.revision },
    members: coreBallLobbyMembers(lobby).map(({ id, name }) => ({ id, name })),
    me: { id: me.id, name: me.name, commandSeq: me.commandSeq },
    game: coreBallLobbyGame(lobby), serverReceivedAt: receivedAt, serverSentAt: Date.now(),
  };
}

export function readCoreBallLobby(id: string, db: CoreBallLobbyDatabase) {
  return db.prepare("SELECT * FROM core_ball_lobbies WHERE id = ?").bind(id).first<CoreBallLobby>();
}
