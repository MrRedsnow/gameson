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

/** Connected terrain groups use shared field edges, independently of generator scoring. */
export function terrainGroups(board) {
  const remaining = new Set(board.hexes.map((hex) => hex.id)); const groups = [];
  while (remaining.size) {
    const first = remaining.values().next().value; const group = [first]; remaining.delete(first);
    for (const id of group) for (const edge of board.edges) {
      if (edge.hexes.length !== 2 || !edge.hexes.includes(id)) continue;
      const next = edge.hexes.find((hexId) => hexId !== id);
      if (remaining.has(next) && board.hexes[next].resource === board.hexes[first].resource) {
        remaining.delete(next); group.push(next);
      }
    }
    groups.push(group);
  }
  return groups;
}
