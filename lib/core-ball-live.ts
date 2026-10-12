import type { CoreBallState } from "./core-ball-lobby-server";

export type { CoreBallState } from "./core-ball-lobby-server";
export type CoreBallLiveClientMessage = { type: "authenticate"; token: string } | { type: "ping" };
export type CoreBallLiveServerMessage =
  | { type: "hello" | "state"; state: CoreBallState }
  | { type: "pong" }
  | { type: "revoked"; status: 401 | 404; message: string };
