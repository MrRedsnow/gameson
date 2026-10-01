import type { CatanAction } from "./catan";
import type { CatanLobbyState } from "./catan-live";

type MapVoteAction = Extract<CatanAction, { type: "map_vote" }>;
export class CatanMapVoteError extends Error {}

/** Only retry a revision conflict for the same ballot, never a new map or match. */
export async function submitCatanMapVote<T>(move: MapVoteAction, gameId: string, environment: {
  readState: () => CatanLobbyState | null;
  submit: (revision: number) => Promise<T>;
  refresh: () => Promise<void>;
  isConflict: (error: unknown) => boolean;
}): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    const state = environment.readState(); const game = state?.game;
    if (!state || game?.id !== gameId || game.phase !== "map_vote" || game.mapVote?.id !== move.mapId) {
      throw new CatanMapVoteError("Die Karte hat sich geändert. Bitte prüfe den aktuellen Spielstand.");
    }
    if (Object.hasOwn(game.mapVote.votes, state.me.id)) {
      if (game.mapVote.votes[state.me.id] !== move.accept) throw new CatanMapVoteError("Deine abgegebene Stimme bleibt verbindlich.");
      return null;
    }
    try { return await environment.submit(state.lobby.revision); }
    catch (error) {
      if (attempt >= 3 || !environment.isConflict(error)) throw error;
      await environment.refresh();
    }
  }
}
