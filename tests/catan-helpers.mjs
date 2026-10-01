/** Advance rule/UI fixtures through the real map ballot before testing setup. */
/** @param {import("../lib/catan").CatanGame} game
 * @param {typeof import("../lib/catan").applyCatanAction} apply
 * @returns {import("../lib/catan").CatanGame} */
export function acceptMap(game, apply) {
  for (const player of game.players) {
    game = apply(game, player.id, { type: "map_vote", mapId: game.mapVote.id, accept: true });
  }
  return game;
}
