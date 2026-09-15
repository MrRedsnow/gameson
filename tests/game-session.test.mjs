import assert from "node:assert/strict";
import test from "node:test";
import { RESUME_DISCARD_SECONDS, describeLobby, parseGameSession, resolveOnlineGameStartup } from "../lib/game-session.ts";

const session = { lobbyId: "lobby-123", token: "secret-token" };
const stored = JSON.stringify(session);

test("stellt eine gespeicherte Lobby nach einem Seitenreload ohne Rückfrage wieder her", () => {
  assert.deepEqual(resolveOnlineGameStartup("?lobby=lobby-123", stored), { kind: "resume", session });
});

test("lässt beim Start aus der Spielauswahl zwischen alter Runde und neuem Spiel wählen", () => {
  assert.deepEqual(resolveOnlineGameStartup("", stored), { kind: "choose", session });
  assert.deepEqual(resolveOnlineGameStartup("", null), { kind: "home" });
  assert.equal(RESUME_DISCARD_SECONDS, 5);
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
  assert.deepEqual(resolveOnlineGameStartup("", "kein json"), { kind: "home" });
});

test("beschreibt eine Lobby mit Personenzahl und Stand", () => {
  assert.equal(describeLobby(1, "Runde läuft"), "1 Person · Runde läuft");
  assert.equal(describeLobby(5, "Abstimmung läuft"), "5 Personen · Abstimmung läuft");
});
