import assert from "node:assert/strict";
import test from "node:test";
import { RESOURCES, COSTS, DEFAULT_TARGET_POINTS, createBoard, createCatanGame, applyCatanAction, legalSettlements, legalRoads, legalCities, pieceCounts, longestRoadLength, victoryPoints, tradeRatio, resourceCount, emptyResources, canAfford, catanView, localActorId } from "../lib/catan.ts";

const seats = ["Anna", "Ben", "Clara", "David"].map((name, i) => ({ id: `p${i}`, name }));
function rng(seed = 19) { return (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 4294967296 * n); }; }
function fresh(count = 4, points = 12) { return createCatanGame(seats.slice(0, count), points, rng()); }
function active(g) { return g.players[g.currentPlayer]; }
function act(g, action, random = rng()) { return applyCatanAction(g, active(g).id, action, random); }
function started(count = 4, points = 12) {
  let g = fresh(count, points);
  while (g.phase.startsWith("setup")) {
    const road = g.phase === "setup_road"; const choices = road ? legalRoads(g, active(g).id, g.setupVertex) : legalSettlements(g, active(g).id, true);
    g = act(g, { type: "build", building: road ? "road" : "settlement", position: choices[0] });
  }
  return g;
}
function fund(g, id, bag) { const p = g.players.find((p) => p.id === id); for (const r of RESOURCES) { g.bank[r] += p.resources[r]; p.resources[r] = bag[r] ?? 0; g.bank[r] -= p.resources[r]; } }
function card(g, type) { const index = g.deck.indexOf(type); assert.ok(index >= 0); g.deck.splice(index, 1); active(g).development.push({ type, id: type, boughtOnTurn: 0 }); }
function invariant(g) {
  for (const r of RESOURCES) {
    assert.equal(g.bank[r] + g.players.reduce((n, p) => n + p.resources[r], 0), 19, r);
    assert.ok(g.bank[r] >= 0 && g.players.every((p) => Number.isInteger(p.resources[r]) && p.resources[r] >= 0));
  }
  for (const p of g.players) { const n = pieceCounts(g, p.id); assert.ok(n.road <= 15 && n.settlement <= 5 && n.city <= 4); }
}

test("Catan hat exakt die Basisspiel-Geometrie, Vorräte und nicht benachbarte rote Zahlen", () => {
  for (let seed = 1; seed <= 25; seed++) {
    const b = createBoard(rng(seed));
    assert.deepEqual([b.hexes.length, b.vertices.length, b.edges.length, b.harbors.length], [19, 54, 72, 9]);
    assert.deepEqual(RESOURCES.map((r) => b.hexes.filter((h) => h.resource === r).length), [4, 3, 4, 4, 3]);
    assert.equal(b.hexes.filter((h) => h.resource === "desert" && h.number === null).length, 1);
    assert.deepEqual(b.hexes.map((h) => h.number).filter(Boolean).sort((a, b) => a - b), [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
    for (const edge of b.edges.filter((e) => e.hexes.length === 2)) assert.ok(!edge.hexes.every((id) => [6, 8].includes(b.hexes[id].number)));
    assert.equal(new Set(b.harbors.flatMap((h) => [b.edges[h.edge].a, b.edges[h.edge].b])).size, 18);
    assert.equal(b.harbors.filter((h) => h.resource === "any").length, 4);
  }
  const g = fresh(); assert.equal(g.deck.length, 25); assert.equal(g.deck.filter((c) => c === "knight").length, 14);
  assert.equal(g.deck.filter((c) => c === "victory").length, 5); assert.equal(resourceCount(g.bank), 95);
});

test("nur 3–4 Personen, eindeutige Namen und ein gültiges wählbares Punktziel", () => {
  assert.equal(DEFAULT_TARGET_POINTS, 12);
  assert.equal(createCatanGame(seats).targetPoints, 12);
  for (const n of [8, 10, 12, 15]) assert.equal(fresh(3, n).targetPoints, n);
  for (const n of [0, 7, 16, 10.5, "12", null, NaN]) assert.throws(() => fresh(4, n), /Siegpunkte/);
  assert.throws(() => createCatanGame(seats.slice(0, 2)), /3 bis 4/);
  assert.throws(() => createCatanGame([...seats, { id: "p4", name: "Eva" }]), /3 bis 4/);
  assert.throws(() => createCatanGame([{ id: "a", name: "Anna" }, { id: "b", name: " anna " }, { id: "c", name: "Ben" }]), /unterschiedliche/);
});

test("Gründung läuft vorwärts/rückwärts und nur die zweite Siedlung erhält Ressourcen", () => {
  let g = fresh(); const ids = g.players.map((p) => p.id); const order = [];
  for (let i = 0; i < 8; i++) {
    const id = active(g).id; order.push(id); const v = legalSettlements(g, id, true)[0]; const expected = emptyResources();
    for (const hex of g.board.vertices[v].hexes) { const r = g.board.hexes[hex].resource; if (r !== "desert") expected[r]++; }
    const before = { ...active(g).resources };
    g = act(g, { type: "build", building: "settlement", position: v });
    assert.deepEqual(active(g).resources, i < 4 ? before : expected);
    assert.equal(g.phase, "setup_road");
    assert.throws(() => act(g, { type: "build", building: "settlement", position: legalSettlements(g, id, true)[0] }), /Straße/);
    g = act(g, { type: "build", building: "road", position: legalRoads(g, id, v)[0] });
  }
  assert.deepEqual(order, [...ids, ...ids.toReversed()]); assert.equal(active(g).id, ids[0]); assert.equal(g.phase, "roll");
  for (const p of g.players) assert.deepEqual(pieceCounts(g, p.id), { road: 2, settlement: 2, city: 0 }); invariant(g);
});

test("ungültige Bauzüge ändern weder Ressourcen noch Spielstand", () => {
  let g = started(); const snapshot = structuredClone(g);
  assert.throws(() => act(g, { type: "end_turn" }), /Würfle/);
  assert.throws(() => applyCatanAction(g, g.players[1].id, { type: "roll" }), /noch nicht/);
  assert.throws(() => act(g, { type: "build", building: "road", position: -1 }), /Würfle/);
  assert.deepEqual(g, snapshot);
  g.phase = "main"; fund(g, active(g).id, {});
  const v = g.board.vertices.find((v) => v.owner); const e = g.board.edges[v.edges[0]]; const neighbor = e.a === v.id ? e.b : e.a;
  assert.ok(!legalSettlements(g, active(g).id, true).includes(neighbor));
  assert.throws(() => act(g, { type: "build", building: "road", position: legalRoads(g, active(g).id)[0] }), /fehlen/);
  fund(g, active(g).id, { ore: 3, grain: 2 });
  g = act(g, { type: "build", building: "city", position: legalCities(g, active(g).id)[0] });
  assert.deepEqual(pieceCounts(g, active(g).id), { road: 2, settlement: 1, city: 1 }); invariant(g);
});

test("Erträge gelten für alle, Städte produzieren doppelt und der Räuber sperrt sein Feld", () => {
  let g = fresh(); g.phase = "roll"; g.turn = 1;
  const hex = g.board.hexes.find((h) => h.number === 6); const [a, b] = g.players;
  Object.assign(g.board.vertices[hex.vertices[0]], { owner: a.id, building: "city" });
  Object.assign(g.board.vertices[hex.vertices[2]], { owner: b.id, building: "settlement" });
  let produced = act(g, { type: "roll" }, () => 2);
  assert.equal(produced.players[0].resources[hex.resource], 2); assert.equal(produced.players[1].resources[hex.resource], 1); invariant(produced);
  g.robberHex = hex.id; produced = act(g, { type: "roll" }, () => 2);
  assert.equal(produced.players[0].resources[hex.resource], 0); assert.equal(produced.players[1].resources[hex.resource], 0);
});

test("Bankknappheit blockiert mehrere Empfänger, ein einzelner bekommt den Rest", () => {
  let g = fresh(); g.phase = "roll"; g.turn = 1;
  const hex = g.board.hexes.find((h) => h.number === 6); const r = hex.resource;
  Object.assign(g.board.vertices[hex.vertices[0]], { owner: g.players[0].id, building: "city" });
  Object.assign(g.board.vertices[hex.vertices[2]], { owner: g.players[1].id, building: "settlement" });
  fund(g, g.players[3].id, { [r]: 18 });
  const none = act(g, { type: "roll" }, () => 2); assert.equal(none.players[0].resources[r], 0); assert.equal(none.players[1].resources[r], 0); invariant(none);
  Object.assign(g.board.vertices[hex.vertices[2]], { owner: null, building: null });
  const rest = act(g, { type: "roll" }, () => 2); assert.equal(rest.players[0].resources[r], 1); assert.equal(rest.bank[r], 0); invariant(rest);
});

test("7: alle werfen korrekt ab, danach muss der Räuber ziehen und eine zufällige Karte stehlen", () => {
  let g = started(); const [a, b] = g.players;
  fund(g, a.id, { wood: 9 }); fund(g, b.id, { brick: 8 });
  let die = 0; g = act(g, { type: "roll" }, () => die++ ? 3 : 2);
  assert.equal(g.phase, "discard"); assert.equal(g.discards[a.id], 4); assert.equal(g.discards[b.id], 4);
  assert.throws(() => act(g, { type: "move_robber", hex: 1 }), /gerade nicht/);
  assert.throws(() => applyCatanAction(g, a.id, { type: "discard", resources: { wood: 3 } }), /genau 4/);
  g = applyCatanAction(g, b.id, { type: "discard", resources: { brick: 4 } }); assert.equal(g.phase, "discard");
  g = applyCatanAction(g, a.id, { type: "discard", resources: { wood: 4 } }); assert.equal(g.phase, "robber");
  assert.throws(() => act(g, { type: "move_robber", hex: g.robberHex }), /anderes/);
  const hex = g.board.hexes.find((h) => h.id !== g.robberHex && h.vertices.some((id) => g.board.vertices[id].owner === b.id));
  g = act(g, { type: "move_robber", hex: hex.id }); assert.ok(g.victims.includes(b.id));
  assert.throws(() => act(g, { type: "steal", victimId: a.id }), /Person/);
  g = act(g, { type: "steal", victimId: b.id }, () => 0);
  assert.equal(g.phase, "main"); assert.equal(g.players.find((p) => p.id === a.id).resources.brick, 1); assert.equal(g.players.find((p) => p.id === b.id).resources.brick, 3); invariant(g);
});

test("Bank und Häfen erlauben 4:1, 3:1 und passende 2:1-Tausche", () => {
  let g = fresh(); g.phase = "main"; g.turn = 1; const p = active(g);
  assert.equal(tradeRatio(g, p.id, "wood"), 4);
  const general = g.board.harbors.find((h) => h.resource === "any"); const specific = g.board.harbors.find((h) => h.resource === "wood");
  Object.assign(g.board.vertices[g.board.edges[general.edge].a], { owner: p.id, building: "settlement" }); assert.equal(tradeRatio(g, p.id, "wood"), 3);
  Object.assign(g.board.vertices[g.board.edges[specific.edge].a], { owner: p.id, building: "settlement" }); assert.equal(tradeRatio(g, p.id, "wood"), 2);
  assert.equal(tradeRatio(g, p.id, "ore"), 3);
  fund(g, p.id, { wood: 2 }); g = act(g, { type: "bank_trade", give: "wood", receive: "ore" });
  assert.equal(active(g).resources.wood, 0); assert.equal(active(g).resources.ore, 1); invariant(g);
  assert.throws(() => act(g, { type: "bank_trade", give: "ore", receive: "ore" }), /unterschiedliche/);
});

test("Spielerhandel braucht beide Seiten, kann gekontert werden und erlaubt keine Geschenke", () => {
  let g = fresh(); g.phase = "main"; g.turn = 1; const [a, b, c] = g.players;
  fund(g, a.id, { wood: 3 }); fund(g, b.id, { ore: 2 });
  assert.throws(() => applyCatanAction(g, b.id, { type: "offer_trade", toId: c.id, give: { ore: 1 }, receive: { wood: 1 } }), /am Zug/);
  assert.throws(() => act(g, { type: "offer_trade", toId: b.id, give: { wood: 1 }, receive: {} }), /Beide/);
  assert.throws(() => act(g, { type: "offer_trade", toId: b.id, give: { wood: 1 }, receive: { wood: 1 } }), /Gleiche/);
  g = act(g, { type: "offer_trade", toId: b.id, give: { wood: 1 }, receive: { ore: 1 } });
  assert.equal(localActorId(g), b.id); const oldId = g.trade.id;
  assert.throws(() => applyCatanAction(g, c.id, { type: "accept_trade", offerId: oldId }), /verfügbar/);
  g = applyCatanAction(g, b.id, { type: "offer_trade", toId: a.id, give: { ore: 1 }, receive: { wood: 2 } });
  assert.throws(() => applyCatanAction(g, b.id, { type: "accept_trade", offerId: oldId }), /verfügbar/);
  g = act(g, { type: "accept_trade", offerId: g.trade.id });
  assert.equal(g.trade, null); assert.equal(active(g).resources.wood, 1); assert.equal(active(g).resources.ore, 1); invariant(g);
});

test("Entwicklungskarten: nicht neu, höchstens eine; Ritter vor dem Würfeln kehrt zum Würfeln zurück", () => {
  let g = started(); const id = active(g).id; card(g, "knight"); card(g, "monopoly");
  g = act(g, { type: "play_development", cardId: "knight" }); assert.equal(g.phase, "robber");
  const hex = g.board.hexes.find((h) => h.id !== g.robberHex && !h.vertices.some((id) => g.board.vertices[id].owner));
  g = act(g, { type: "move_robber", hex: hex.id }); assert.equal(g.phase, "roll");
  assert.throws(() => act(g, { type: "play_development", cardId: "monopoly", resource: "wood" }), /nur eine/);
  assert.equal(g.players.find((p) => p.id === id).knights, 1);
  g = act(g, { type: "roll" }, () => 0); g.playedDevelopment = false;
  fund(g, id, COSTS.development); g.deck.push("knight");
  g = act(g, { type: "buy_development" }); const bought = active(g).development.at(-1);
  assert.throws(() => act(g, { type: "play_development", cardId: bought.id }), /Neu gekaufte/);
});

test("Erfindung, Monopol und Straßenbau beachten Bank, Straße und Phasen", () => {
  let g = started(); g.phase = "main"; card(g, "plenty");
  g = act(g, { type: "play_development", cardId: "plenty", resources: { wood: 2 } }); invariant(g);
  assert.equal(g.phase, "main");
  g.playedDevelopment = false; card(g, "monopoly"); fund(g, g.players[1].id, { ore: 3 });
  g = act(g, { type: "play_development", cardId: "monopoly", resource: "ore" });
  assert.equal(g.players[1].resources.ore, 0); assert.ok(active(g).resources.ore >= 3); invariant(g);
  g.playedDevelopment = false; card(g, "road_building"); const hand = structuredClone(active(g).resources);
  g = act(g, { type: "play_development", cardId: "road_building" }); assert.equal(g.phase, "free_roads");
  assert.throws(() => act(g, { type: "end_turn" }), /Würfle/);
  for (let i = 0; i < 2; i++) g = act(g, { type: "build", building: "road", position: legalRoads(g, active(g).id)[0] });
  assert.equal(g.phase, "main"); assert.deepEqual(active(g).resources, hand); invariant(g);
});

test("Längste Straße zählt Kanten einmal, keine Verzweigungen zusammen, fremde Gebäude unterbrechen", () => {
  function graph(edges) {
    const vertices = Array.from({ length: 10 }, (_, id) => ({ id, owner: null, edges: [] }));
    const links = edges.map(([a, b], id) => { vertices[a].edges.push(id); vertices[b].edges.push(id); return { id, a, b, owner: "a" }; });
    return { vertices, edges: links, hexes: [], harbors: [] };
  }
  const fork = graph([[0, 1], [1, 2], [2, 3], [3, 4], [2, 5], [5, 6]]); assert.equal(longestRoadLength(fork, "a"), 4);
  const loop = graph([[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [0, 6]]); assert.equal(longestRoadLength(loop, "a"), 7);
  const line = graph([[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]]); line.vertices[3].owner = "b"; assert.equal(longestRoadLength(line, "a"), 3);
});

test("Siegpunkte bleiben verdeckt; Sieg nur im eigenen Zug, auch durch frisch gekaufte Karte", () => {
  let g = fresh(3, 8); g.phase = "main"; g.turn = 1;
  const [a, b] = g.players;
  for (const v of g.board.vertices.slice(0, 3)) Object.assign(v, { owner: a.id, building: "city" });
  a.development.push({ id: "secret-point", type: "victory", boughtOnTurn: 0 });
  g.deck = ["victory"]; fund(g, a.id, COSTS.development);
  const hidden = catanView(g, b.id); assert.equal(hidden.players.find((p) => p.id === a.id).points, 6);
  assert.ok(!JSON.stringify(hidden).includes("secret-point")); assert.equal(hidden.deck, undefined); assert.equal(hidden.players[0].resources, undefined);
  g = act(g, { type: "buy_development" }); assert.equal(g.winner, a.id); assert.equal(g.phase, "finished");
  assert.equal(catanView(g, b.id).players.find((p) => p.id === a.id).points, 8);
  assert.throws(() => act(g, { type: "roll" }), /beendet/);
  g = fresh(3, 8); g.phase = "main"; g.turn = 1;
  for (const v of g.board.vertices.slice(0, 4)) Object.assign(v, { owner: g.players[1].id, building: "city" });
  assert.equal(g.winner, null); g = act(g, { type: "end_turn" }); assert.equal(g.winner, g.players[1].id);
});

test("untrusted actions cannot create resources or reveal seat credentials", () => {
  let g = fresh(); g.phase = "main"; g.turn = 1;
  for (const value of [-1, .5, Infinity, "2", null]) {
    if (value === null) continue;
    assert.throws(() => act(g, { type: "offer_trade", toId: g.players[1].id, give: { wood: value }, receive: { ore: 1 } }));
  }
  assert.throws(() => act(g, { type: "offer_trade", toId: g.players[1].id, give: { gold: 1 }, receive: { ore: 1 } }));
  assert.throws(() => act(g, { type: "roll", dice: [6, 6] }), /bereits/);
  const game = createCatanGame(seats.map((p) => ({ ...p, tokenHash: "never-copy" })));
  assert.ok(!JSON.stringify(game).includes("never-copy"));
});

test("vollständige Partien zu dritt und zu viert erreichen 12 Punkte ohne Sackgasse oder verlorene Rohstoffe", () => {
  for (const count of [3, 4]) {
    const random = rng(71 + count); let g = createCatanGame(seats.slice(0, count), 12, random); let moves = 0;
    const score = (v) => g.board.vertices[v].hexes.reduce((n, h) => n + (g.board.hexes[h].number ? 6 - Math.abs(7 - g.board.hexes[h].number) : 0), 0);
    const chooseSettlement = (list) => [...list].sort((a, b) => score(b) - score(a))[0];
    const chooseRoad = (list) => {
      const sites = new Set(legalSettlements(g, active(g).id, true));
      const rank = (e) => Math.max(...[e.a, e.b].map((id) => (sites.has(id) ? 30 : 0) + score(id))) + random(8);
      return list.map((id) => ({ id, score: rank(g.board.edges[id]) })).sort((a, b) => b.score - a.score)[0].id;
    };
    while (!g.winner && moves++ < 6500) {
      const p = active(g); let action; let actor = p.id;
      if (g.phase === "setup_settlement") action = { type: "build", building: "settlement", position: chooseSettlement(legalSettlements(g, p.id, true)) };
      else if (g.phase === "setup_road") action = { type: "build", building: "road", position: chooseRoad(legalRoads(g, p.id, g.setupVertex)) };
      else if (g.phase === "roll") action = { type: "roll" };
      else if (g.phase === "discard") {
        actor = Object.keys(g.discards)[0]; const hand = { ...g.players.find((p) => p.id === actor).resources }; const bag = emptyResources();
        for (let i = 0; i < g.discards[actor]; i++) { const r = [...RESOURCES].sort((a, b) => hand[b] - hand[a])[0]; bag[r]++; hand[r]--; }
        action = { type: "discard", resources: bag };
      } else if (g.phase === "robber") {
        const hex = g.board.hexes.filter((h) => h.id !== g.robberHex).map((h) => ({ id: h.id, score: h.vertices.reduce((n, id) => n + (g.board.vertices[id].owner ? g.board.vertices[id].owner === p.id ? -5 : 2 : 0), 0) })).sort((a, b) => b.score - a.score)[0];
        action = { type: "move_robber", hex: hex.id };
      } else if (g.phase === "steal") action = { type: "steal", victimId: g.victims[0] };
      else if (g.phase === "free_roads") action = { type: "build", building: "road", position: chooseRoad(legalRoads(g, p.id)) };
      else {
        const development = !g.playedDevelopment && p.development.find((c) => c.type !== "victory" && c.boughtOnTurn < g.turn && (c.type !== "road_building" || legalRoads(g, p.id).length));
        if (development) {
          const chosen = emptyResources();
          for (let i = 0; i < Math.min(2, resourceCount(g.bank)); i++) { const r = [...RESOURCES].filter((r) => g.bank[r] > chosen[r]).sort((a, b) => p.resources[a] + chosen[a] - p.resources[b] - chosen[b])[0]; chosen[r]++; }
          const monopoly = [...RESOURCES].sort((a, b) => g.players.filter((q) => q.id !== p.id).reduce((n, q) => n + q.resources[b] - q.resources[a], 0))[0];
          action = { type: "play_development", cardId: development.id, resource: monopoly, resources: chosen };
        } else {
          const options = [
            { kind: "city", positions: legalCities(g, p.id) }, { kind: "settlement", positions: legalSettlements(g, p.id) },
            { kind: "road", positions: legalRoads(g, p.id) }, { kind: "development", positions: g.deck.length ? [0] : [] },
          ].filter((o) => o.positions.length);
          const affordable = options.find((o) => canAfford(p.resources, COSTS[o.kind]));
          if (affordable) action = affordable.kind === "development" ? { type: "buy_development" } : { type: "build", building: affordable.kind, position: affordable.kind === "road" ? chooseRoad(affordable.positions) : chooseSettlement(affordable.positions) };
          else {
            for (const option of options) {
              const cost = COSTS[option.kind]; const receive = RESOURCES.find((r) => p.resources[r] < (cost[r] ?? 0) && g.bank[r] > 0);
              const give = [...RESOURCES].filter((r) => r !== receive && p.resources[r] - (cost[r] ?? 0) >= tradeRatio(g, p.id, r)).sort((a, b) => p.resources[b] - p.resources[a])[0];
              if (receive && give) { action = { type: "bank_trade", give, receive }; break; }
            }
            action ??= { type: "end_turn" };
          }
        }
      }
      g = applyCatanAction(g, actor, action, random); invariant(g);
    }
    assert.ok(g.winner, `${count} players failed to finish in ${moves} moves; scores ${g.players.map((p) => victoryPoints(g, p))}`);
    assert.equal(g.phase, "finished"); assert.ok(victoryPoints(g, active(g)) >= 12);
  }
});
