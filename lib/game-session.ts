export type GameSession = { lobbyId: string; token: string };

export type OnlineGameStartup =
  | { kind: "resume"; session: GameSession }
  | { kind: "choose"; session: GameSession }
  | { kind: "join"; lobbyId: string }
  | { kind: "local" }
  | { kind: "home" };

/** Seconds a stored round stays recoverable after "Neues Spiel starten" was tapped. */
export const RESUME_DISCARD_SECONDS = 5;

export function parseGameSession(rawSession: string | null): GameSession | null {
  if (!rawSession) return null;
  try {
    const value = JSON.parse(rawSession) as Partial<GameSession> | null;
    if (typeof value?.lobbyId !== "string" || !value.lobbyId || typeof value.token !== "string" || !value.token) return null;
    return { lobbyId: value.lobbyId, token: value.token };
  } catch {
    return null;
  }
}

export function resolveOnlineGameStartup(search: string, rawSession: string | null): OnlineGameStartup {
  const params = new URLSearchParams(search);
  const invitedLobbyId = params.get("lobby") ?? "";
  const storedSession = parseGameSession(rawSession);

  if (params.get("local") === "1") return { kind: "local" };
  if (params.get("join") === "1") return { kind: "join", lobbyId: invitedLobbyId };
  // A reload keeps the lobby in the address bar: rejoin it without asking.
  if (storedSession && storedSession.lobbyId === invitedLobbyId) return { kind: "resume", session: storedSession };
  if (invitedLobbyId) return { kind: "join", lobbyId: invitedLobbyId };
  // Arriving from the game library with a stored round: the player decides between that round and a new game.
  if (storedSession) return { kind: "choose", session: storedSession };
  return { kind: "home" };
}

export function describeLobby(playerCount: number, status: string) {
  return `${playerCount} ${playerCount === 1 ? "Person" : "Personen"} · ${status}`;
}
