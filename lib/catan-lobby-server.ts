import { catanView, type CatanGame } from "./catan";
import type { CatanLobbyState } from "./catan-live";

export type CatanLobbyMember = { id: string; name: string; tokenHash: string };
export type CatanLobby = {
  id: string; name: string; normalized_name: string; host_player_id: string; target_points: number;
  members: string; game: string | null; discoverable: number; network_hash: string;
  revision: number; created_at: number; updated_at: number;
};

export async function catanTokenDigest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function catanLobbyMembers(lobby: CatanLobby): CatanLobbyMember[] { return JSON.parse(lobby.members); }
export function catanLobbyGame(lobby: CatanLobby): CatanGame | null { return lobby.game ? JSON.parse(lobby.game) : null; }

export async function authenticateCatanToken(secret: string, lobby: CatanLobby) {
  if (!/^[a-f0-9]{64}$/.test(secret)) return undefined;
  const hash = await catanTokenDigest(secret);
  return catanLobbyMembers(lobby).find((member) => member.tokenHash === hash);
}

export async function authenticateCatanRequest(request: Request, lobby: CatanLobby) {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? authenticateCatanToken(header.slice(7), lobby) : undefined;
}

/** Only this viewer's hand and receipts are projected into HTTP and live responses. */
export function catanLobbyView(lobby: CatanLobby, me: CatanLobbyMember): CatanLobbyState {
  const game = catanLobbyGame(lobby);
  return {
    lobby: { id: lobby.id, name: lobby.name, hostPlayerId: lobby.host_player_id, targetPoints: lobby.target_points, discoverable: Boolean(lobby.discoverable), revision: lobby.revision },
    members: catanLobbyMembers(lobby).map(({ id, name }) => ({ id, name })),
    me: { id: me.id, name: me.name },
    game: game ? catanView(game, me.id) : null,
  };
}

export type CatanLobbyDatabase = { prepare(sql: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null> } } };

export function readCatanLobby(id: string, db: CatanLobbyDatabase) {
  return db.prepare("SELECT * FROM catan_lobbies WHERE id = ?").bind(id).first<CatanLobby>();
}
