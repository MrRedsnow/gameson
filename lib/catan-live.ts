import type { CatanView } from "./catan";

export type CatanLobbyState = {
  lobby: { id: string; name: string; hostPlayerId: string; targetPoints: number; discoverable: boolean; revision: number };
  members: { id: string; name: string }[];
  me: { id: string; name: string };
  game: CatanView | null;
};

export type CatanLiveClientMessage = { type: "authenticate"; token: string } | { type: "ping" };
export type CatanLiveServerMessage =
  | { type: "hello" | "state"; state: CatanLobbyState }
  | { type: "pong" }
  | { type: "revoked"; status: 401 | 404; message: string };
