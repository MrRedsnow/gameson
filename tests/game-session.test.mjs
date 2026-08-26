import assert from "node:assert/strict";
import test from "node:test";
import { parseGameSession, resolveOnlineGameStartup } from "../lib/game-session.ts";

const session = { lobbyId: "lobby-123", token: "secret-token" };
const stored = JSON.stringify(session);

test("stellt eine gespeicherte Lobby nach einem Seitenreload wieder her", () => {
  assert.deepEqual(resolveOnlineGameStartup("?lobby=lobby-123", stored), { kind: "resume", session });
  assert.deepEqual(resolveOnlineGameStartup("", stored), { kind: "resume", session });
});

test("behandelt einen Link zu einer anderen Lobby weiterhin als Einladung", () => {
  assert.deepEqual(resolveOnlineGameStartup("?lobby=other-lobby", stored), { kind: "join", lobbyId: "other-lobby" });
});

test("respektiert explizit gewählte Spielmodi", () => {
  assert.deepEqual(resolveOnlineGameStartup("?join=1", stored), { kind: "join", lobbyId: "" });
  assert.deepEqual(resolveOnlineGameStartup("?local=1", stored), { kind: "local" });
});

test("ignoriert beschädigte oder unvollständige Sitzungsdaten", () => {
  assert.equal(parseGameSession("kein json"), null);
  assert.equal(parseGameSession(JSON.stringify({ lobbyId: "lobby-123" })), null);
  assert.deepEqual(resolveOnlineGameStartup("?lobby=lobby-123", "kein json"), { kind: "join", lobbyId: "lobby-123" });
});
