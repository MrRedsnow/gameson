export type GameSession = { lobbyId: string; token: string };

export type OnlineGameStartup =
  | { kind: "resume"; session: GameSession }
  | { kind: "join"; lobbyId: string }
  | { kind: "local" }
  | { kind: "home" };

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
  if (storedSession && (!invitedLobbyId || storedSession.lobbyId === invitedLobbyId)) return { kind: "resume", session: storedSession };
  if (invitedLobbyId) return { kind: "join", lobbyId: invitedLobbyId };
  return { kind: "home" };
}
