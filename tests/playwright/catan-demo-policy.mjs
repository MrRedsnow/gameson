// A fair, deliberately simple bot for the visible demo. The real game still
// creates the board, rolls dice and draws cards; this module only chooses moves.
const RESOURCE_WEIGHT = { wood: 1, brick: 1, wool: 1, grain: 1.4, ore: 1.5 };
const pips = (number) => number ? 6 - Math.abs(7 - number) : 0;
const otherEnd = (edge, vertex) => edge.a === vertex ? edge.b : edge.a;

function production(game, actor, rules) {
  const result = rules.emptyResources();
  for (const vertex of game.board.vertices) {
    if (vertex.owner !== actor) continue;
    for (const id of vertex.hexes) {
      const hex = game.board.hexes[id];
      if (hex.resource !== "desert") result[hex.resource] += pips(hex.number) * (vertex.building === "city" ? 2 : 1);
    }
  }
  return result;
}

function settlementScore(game, position, rates) {
  let score = 0;
  for (const id of game.board.vertices[position].hexes) {
    const hex = game.board.hexes[id];
    if (hex.resource === "desert") continue;
    // Secure every resource, then prefer frequent numbers and city materials.
    score += pips(hex.number) * RESOURCE_WEIGHT[hex.resource] * (1 + 5 / (rates[hex.resource] + 5));
    if (!rates[hex.resource]) score += 4;
  }
  for (const harbor of game.board.harbors) {
    const edge = game.board.edges[harbor.edge];
    if (edge.a === position || edge.b === position) score += harbor.resource === "any" ? 2 : 1;
  }
  return score;
}

function best(values, score) {
  return values.reduce((chosen, value) => chosen === undefined || score(value) > score(chosen) ? value : chosen, undefined);
}

// Find an actual route to a free settlement, respecting enemy roads/buildings.
// Existing roads cost zero; the returned path contains only roads still needed.
function expansionPlan(game, actor, rules, sources) {
  const board = game.board;
  const candidates = rules.legalSettlements(game, actor, true);
  if (!candidates.length) return null;
  const rates = production(game, actor, rules);
  const starts = sources ?? board.vertices.filter((v) => v.owner === actor || (!v.owner && v.edges.some((id) => board.edges[id].owner === actor))).map((v) => v.id);
  const distance = new Map(starts.map((id) => [id, 0]));
  const paths = new Map(starts.map((id) => [id, []]));
  const queue = [...starts];
  while (queue.length) {
    queue.sort((a, b) => distance.get(a) - distance.get(b));
    const from = queue.shift();
    for (const id of board.vertices[from].edges) {
      const edge = board.edges[id];
      if (edge.owner && edge.owner !== actor) continue;
      const to = otherEnd(edge, from);
      if (board.vertices[to].owner && board.vertices[to].owner !== actor) continue;
      const cost = distance.get(from) + (edge.owner ? 0 : 1);
      if (cost >= (distance.get(to) ?? Infinity)) continue;
      distance.set(to, cost);
      paths.set(to, [...paths.get(from), ...(edge.owner ? [] : [id])]);
      if (!queue.includes(to)) queue.push(to);
    }
  }
  const reachable = candidates.filter((id) => paths.has(id));
  const position = best(reachable, (id) => settlementScore(game, id, rates) / (distance.get(id) + 1.5));
  return position === undefined ? null : { position, roads: paths.get(position), score: settlementScore(game, position, rates) };
}

function buildGoal(game, player, rules) {
  const rates = production(game, player.id, rules);
  const cities = rules.legalCities(game, player.id);
  const settlements = rules.legalSettlements(game, player.id);
  const expansion = expansionPlan(game, player.id, rules);
  const goals = [];
  if (cities.length) {
    const position = best(cities, (id) => settlementScore(game, id, rules.emptyResources()));
    goals.push({ action: { type: "build", building: "city", position }, cost: rules.COSTS.city, priority: 4 });
  }
  if (settlements.length) {
    const position = best(settlements, (id) => settlementScore(game, id, rates));
    goals.push({ action: { type: "build", building: "settlement", position }, cost: rules.COSTS.settlement, priority: 3.5 });
  }
  if (game.deck.length) goals.push({ action: { type: "buy_development" }, cost: rules.COSTS.development, priority: 2 });
  if (expansion?.roads.length && rules.legalRoads(game, player.id).includes(expansion.roads[0])) {
    goals.push({ action: { type: "build", building: "road", position: expansion.roads[0] }, cost: rules.COSTS.road, priority: 1.5 });
  }
  // Prefer finished investments, while saving toward cities instead of spending
  // their ore/grain on a new card every turn.
  const affordable = goals.filter((goal) => rules.canAfford(player.resources, goal.cost));
  if (affordable.length) {
    const city = goals.find((goal) => goal.action.building === "city");
    const closeToCity = city && player.resources.ore >= 2 && player.resources.grain >= 1;
    const useful = affordable.filter((goal) => !(closeToCity && goal.action.type === "buy_development"));
    if (useful.length) return best(useful, (goal) => goal.priority);
  }
  return best(goals, (goal) => {
    const shortage = rules.RESOURCES.reduce((sum, r) => sum + Math.max(0, (goal.cost[r] ?? 0) - player.resources[r]) * (rates[r] ? 1 : 1.6), 0);
    return goal.priority / (shortage + 1);
  });
}

function developmentAction(game, player, goal, rules) {
  if (game.playedDevelopment) return null;
  const cards = player.development.filter((card) => card.type !== "victory" && card.boughtOnTurn < game.turn);
  const card = best(cards, (value) => ({ plenty: 5, monopoly: 4, road_building: 3, knight: 2 })[value.type]);
  if (!card) return null;
  const action = { type: "play_development", cardId: card.id };
  if (card.type === "road_building" && !rules.legalRoads(game, player.id).length) return null;
  if (card.type === "plenty") {
    const resources = rules.emptyResources();
    for (let i = 0; i < Math.min(2, rules.resourceCount(game.bank)); i++) {
      const available = rules.RESOURCES.filter((r) => game.bank[r] > resources[r]);
      const resource = best(available, (r) => Math.max(0, (goal?.cost[r] ?? 0) - player.resources[r] - resources[r]) * 10 + RESOURCE_WEIGHT[r]);
      resources[resource]++;
    }
    return { ...action, resources };
  }
  if (card.type === "monopoly") {
    const resource = best(rules.RESOURCES, (r) => game.players.filter((p) => p.id !== player.id).reduce((sum, p) => sum + p.resources[r], 0) + Math.max(0, (goal?.cost[r] ?? 0) - player.resources[r]) * .5);
    return { ...action, resource };
  }
  return action;
}

function discardAction(game, player, goal, rules) {
  const resources = rules.emptyResources();
  const rates = production(game, player.id, rules);
  for (let i = 0; i < game.discards[player.id]; i++) {
    const available = rules.RESOURCES.filter((r) => player.resources[r] > resources[r]);
    const resource = best(available, (r) => (player.resources[r] - resources[r] - (goal?.cost[r] ?? 0)) * 10 + rates[r]);
    resources[resource]++;
  }
  return { type: "discard", resources };
}

export function chooseDemoAction(game, rules) {
  if (game.phase === "finished") return null;
  const actor = rules.localActorId(game);
  const player = game.players.find((p) => p.id === actor);
  if (game.phase === "map_vote") return { type: rules.mapVoteProgress(game).tied ? "resolve_map_tie" : "map_vote", mapId: game.mapVote.id, accept: true };
  if (game.phase === "setup_settlement") {
    const position = best(rules.legalSettlements(game, actor, true), (id) => settlementScore(game, id, production(game, actor, rules)));
    return { type: "build", building: "settlement", position };
  }
  if (game.phase === "setup_road" || game.phase === "free_roads") {
    const setup = game.phase === "setup_road";
    const legal = rules.legalRoads(game, actor, setup ? game.setupVertex : null);
    const plan = expansionPlan(game, actor, rules, setup ? [game.setupVertex] : undefined);
    const position = plan?.roads.find((id) => legal.includes(id)) ?? legal[0];
    return { type: "build", building: "road", position };
  }
  const goal = buildGoal(game, player, rules);
  if (game.phase === "discard") return discardAction(game, player, goal, rules);
  if (game.phase === "robber") {
    // Moving back to the desert is legal and keeps the demonstration flowing.
    const desert = game.board.hexes.find((hex) => hex.resource === "desert" && hex.id !== game.robberHex);
    const hex = desert ?? best(game.board.hexes.filter((hex) => hex.id !== game.robberHex), (candidate) => {
      const owned = candidate.vertices.filter((id) => game.board.vertices[id].owner === actor).length;
      const opponents = candidate.vertices.filter((id) => game.board.vertices[id].owner && game.board.vertices[id].owner !== actor).length;
      return opponents * 2 - owned * 20 - pips(candidate.number);
    });
    return { type: "move_robber", hex: hex.id };
  }
  if (game.phase === "steal") return { type: "steal", victimId: game.victims[0] };
  if (game.trade) return { type: rules.canAfford(player.resources, game.trade.receive) ? "accept_trade" : "cancel_trade", offerId: game.trade.id };
  const development = developmentAction(game, player, goal, rules);
  if (development) return development;
  if (game.phase === "roll") return { type: "roll" };
  if (goal && rules.canAfford(player.resources, goal.cost)) return goal.action;
  if (goal) {
    const lacking = rules.RESOURCES.filter((r) => player.resources[r] < (goal.cost[r] ?? 0) && game.bank[r] > 0);
    const give = best(rules.RESOURCES.filter((r) => player.resources[r] - (goal.cost[r] ?? 0) >= rules.tradeRatio(game, actor, r)), (r) => (player.resources[r] - (goal.cost[r] ?? 0)) / rules.tradeRatio(game, actor, r));
    if (give && lacking.length) {
      const receive = best(lacking, (r) => (goal.cost[r] - player.resources[r]) * RESOURCE_WEIGHT[r]);
      return { type: "bank_trade", give, receive };
    }
  }
  return { type: "end_turn" };
}
