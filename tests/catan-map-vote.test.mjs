import assert from "node:assert/strict";
import test from "node:test";
import { createCatanGame, applyCatanAction, mapVoteProgress, localActorId, catanView, legalSettlements, RESOURCES } from "../lib/catan.ts";
import { submitCatanMapVote } from "../lib/catan-map-vote-client.ts";
import { terrainGroups } from "./catan-helpers.mjs";

const seats = ["Anna", "Ben", "Clara", "David"].map((name, i) => ({ id: `p${i}`, name }));
const ballot = (game, id, accept) => applyCatanAction(game, id, { type: "map_vote", mapId: game.mapVote.id, accept });
const decide = (game, id, accept) => applyCatanAction(game, id, { type: "resolve_map_tie", mapId: game.mapVote.id, accept });
function rng(seed) { return (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 4294967296 * n); }; }

test("all three/four-player vote combinations wait for everybody and resolve the majority", () => {
  for (const count of [3, 4]) for (let mask = 0; mask < 2 ** count; mask++) {
    let game = createCatanGame(seats.slice(0, count), 12, rng(mask + 1));
    const initial = structuredClone(game); const mapId = game.mapVote.id;
    for (let i = 0; i < count; i++) {
      game = ballot(game, seats[i].id, Boolean(mask & (1 << i)));
      if (i < count - 1) { assert.equal(game.phase, "map_vote"); assert.equal(game.mapVote.id, mapId); }
    }
    const yes = seats.slice(0, count).filter((_, i) => mask & (1 << i)).length;
    if (yes > count / 2) {
      assert.equal(game.phase, "setup_settlement"); assert.equal(game.mapVote, undefined);
      assert.deepEqual(game.board, initial.board);
      const actor = game.players[0].id;
      assert.equal(applyCatanAction(game, actor, { type: "build", building: "settlement", position: legalSettlements(game, actor, true)[0] }).phase, "setup_road");
    } else if (yes === count / 2) {
      assert.equal(game.phase, "map_vote"); assert.equal(game.mapVote.id, mapId); assert.ok(mapVoteProgress(game).tied);
    } else {
      assert.equal(game.phase, "map_vote"); assert.notEqual(game.mapVote.id, mapId); assert.deepEqual(game.mapVote.votes, {});
    }
    for (const key of ["id", "players", "deck", "bank", "targetPoints", "currentPlayer", "turn", "setupIndex", "setupVertex", "notifications"]) assert.deepEqual(game[key], initial[key], key);
  }
});

test("only the named host decides a completed tie, independently of their original vote", () => {
  for (const hostVote of [false, true]) for (const accept of [false, true]) {
    let game = createCatanGame(seats, 10, rng(9), seats[2].id);
    assert.throws(() => decide(game, seats[2].id, accept), /vollständigen Gleichstand/);
    for (const [i, vote] of [!hostVote, !hostVote, hostVote, hostVote].entries()) game = ballot(game, seats[i].id, vote);
    const before = structuredClone(game);
    assert.throws(() => decide(game, seats[0].id, accept), /nur die Spielleitung/);
    assert.deepEqual(game, before);
    game = decide(game, seats[2].id, accept);
    assert.equal(game.phase, accept ? "setup_settlement" : "map_vote");
    if (!accept) { assert.notEqual(game.mapVote.id, before.mapVote.id); assert.deepEqual(game.mapVote.votes, {}); }
  }
});

test("rerolls preserve the match and generator invariants, clear votes and invalidate old ballots", () => {
  let game = createCatanGame(seats, 15, rng(10)); const initial = structuredClone(game);
  for (let cycle = 0; cycle < 5; cycle++) {
    const oldId = game.mapVote.id; const previous = structuredClone(game.board);
    for (const p of seats) game = applyCatanAction(game, p.id, { type: "map_vote", mapId: oldId, accept: false }, rng(20 + cycle));
    assert.notDeepEqual(game.board, previous); assert.deepEqual(game.mapVote.votes, {});
    assert.notDeepEqual(game.board.hexes.map((hex) => hex.resource), previous.hexes.map((hex) => hex.resource));
    assert.ok(terrainGroups(game.board).every((group) => group.length <= 3));
    assert.deepEqual([game.board.hexes.length, game.board.vertices.length, game.board.edges.length, game.board.harbors.length], [19, 54, 72, 9]);
    assert.deepEqual(RESOURCES.map((r) => game.board.hexes.filter((h) => h.resource === r).length), [4, 3, 4, 4, 3]);
    assert.equal(game.robberHex, game.board.hexes.find((h) => h.resource === "desert").id);
    assert.deepEqual(game.board.hexes.map((h) => h.number).filter(Boolean).sort((a, b) => a - b), [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
    for (const edge of game.board.edges.filter((e) => e.hexes.length === 2)) assert.ok(!edge.hexes.every((id) => [6, 8].includes(game.board.hexes[id].number)));
    assert.ok(game.board.vertices.every((v) => v.owner === null)); assert.ok(game.board.edges.every((e) => e.owner === null));
    for (const type of ["map_vote", "resolve_map_tie"]) assert.throws(() => applyCatanAction(game, seats[0].id, { type, mapId: oldId, accept: true }), /nicht mehr aktuell/);
    for (const key of ["id", "players", "deck", "bank", "targetPoints", "currentPlayer"]) assert.deepEqual(game[key], initial[key]);
  }
  assert.ok(game.sequence > initial.sequence);
});

test("eine abgelehnte gespeicherte Karte ändert die Landschaften trotz identischer Zufallsquelle", () => {
  let game = createCatanGame(seats.slice(0, 3), 12, () => 0);
  for (let cycle = 0; cycle < 3; cycle++) {
    game = JSON.parse(JSON.stringify(game)); const before = structuredClone(game);
    for (const player of game.players) game = applyCatanAction(game, player.id, { type: "map_vote", mapId: game.mapVote.id, accept: false }, () => 0);
    assert.notDeepEqual(game.board.hexes.map((hex) => hex.resource), before.board.hexes.map((hex) => hex.resource));
    assert.ok(terrainGroups(game.board).every((group) => group.length <= 3));
    assert.equal(game.robberHex, game.board.hexes.find((hex) => hex.resource === "desert").id);
    for (const key of ["id", "version", "players", "bank", "deck", "targetPoints", "currentPlayer"]) assert.deepEqual(game[key], before[key]);
  }
});

test("votes are immutable and idempotent; regular, malformed and unauthorized actions do not mutate state", () => {
  let game = createCatanGame(seats, 12, rng(1)); const before = structuredClone(game);
  for (const type of ["build", "roll", "end_turn", "buy_development", "discard", "move_robber", "steal", "bank_trade", "offer_trade", "accept_trade", "cancel_trade", "play_development"]) {
    assert.throws(() => applyCatanAction(game, seats[1].id, { type }), /Stimmt zuerst/);
  }
  for (const accept of [null, "true", 1, undefined]) assert.throws(() => ballot(game, seats[1].id, accept), /Wähle/);
  assert.throws(() => ballot(game, "outsider", true), /nicht Teil/);
  assert.throws(() => createCatanGame(seats, 12, rng(1), "outsider"), /Spielleitung/);
  assert.deepEqual(game, before);
  game = ballot(game, seats[1].id, false);
  assert.deepEqual(ballot(game, seats[1].id, false), game);
  assert.throws(() => ballot(game, seats[1].id, true), /verbindlich/);
  assert.equal(mapVoteProgress(game).rejected, 1);
});

test("local ballots follow entry order despite randomized turns and resume votes and ties from JSON", () => {
  let game = createCatanGame(seats, 12, (n) => n - 1);
  assert.notEqual(game.players[0].id, seats[0].id);
  for (let i = 0; i < seats.length; i++) {
    assert.equal(localActorId(game), seats[i].id);
    game = JSON.parse(JSON.stringify(ballot(game, localActorId(game), i < 2)));
    const publicView = catanView(game, seats[i].id);
    assert.deepEqual(publicView.mapVote, game.mapVote);
    assert.equal(publicView.deck, undefined); assert.ok(publicView.players.every((p) => p.resources === undefined));
  }
  assert.equal(localActorId(game), seats[0].id);
  const accepted = decide(game, localActorId(game), true);
  const legacy = JSON.parse(JSON.stringify(accepted)); delete legacy.mapVote;
  assert.equal(localActorId(legacy), legacy.players[0].id);
  assert.equal(applyCatanAction(legacy, localActorId(legacy), { type: "build", building: "settlement", position: legalSettlements(legacy, localActorId(legacy), true)[0] }).phase, "setup_road");
});

function client(game = createCatanGame(seats)) {
  let current = { lobby: { revision: 1 }, me: { id: seats[0].id }, game: catanView(game, seats[0].id) };
  let submissions = 0; let refreshes = 0; let onRefresh = () => {};
  const revisions = []; const conflict = new Error("conflict");
  const env = {
    readState: () => current,
    submit: async (revision) => { revisions.push(revision); submissions++; throw conflict; },
    refresh: async () => { refreshes++; onRefresh(); },
    isConflict: (error) => error === conflict,
  };
  const move = { type: "map_vote", mapId: game.mapVote.id, accept: true };
  return { game, move, env, setState(value) { current = value; }, state: () => current, onRefresh(fn) { onRefresh = fn; }, counts: () => ({ submissions, refreshes }), revisions, conflict };
}

test("client retries at most three times and uses the freshly loaded revision", async () => {
  const c = client(); c.onRefresh(() => { c.state().lobby.revision++; });
  await assert.rejects(submitCatanMapVote(c.move, c.game.id, c.env), (e) => e === c.conflict);
  assert.deepEqual(c.counts(), { submissions: 4, refreshes: 3 }); assert.deepEqual(c.revisions, [1, 2, 3, 4]);
});

test("client stops when the same ballot is already confirmed or the map/match changes", async () => {
  for (const change of ["confirmed", "new-map", "new-match", "setup", "revoked", "opposite"]) {
    const c = client(); c.onRefresh(() => {
      if (change === "confirmed" || change === "opposite") c.state().game.mapVote.votes[seats[0].id] = change === "confirmed";
      if (change === "new-map") c.state().game.mapVote.id = "new-map";
      if (change === "new-match") c.state().game.id = "new-match";
      if (change === "setup") c.state().game.phase = "setup_settlement";
      if (change === "revoked") c.setState(null);
    });
    if (change === "confirmed") assert.equal(await submitCatanMapVote(c.move, c.game.id, c.env), null);
    else await assert.rejects(submitCatanMapVote(c.move, c.game.id, c.env));
    assert.deepEqual(c.counts(), { submissions: 1, refreshes: 1 });
  }
});

test("client does not retry network failures or retry after refresh fails", async () => {
  for (const duringRefresh of [false, true]) {
    const c = client(); const offline = new Error("offline");
    if (duringRefresh) c.env.refresh = async () => { throw offline; };
    else c.env.submit = async () => { throw offline; };
    await assert.rejects(submitCatanMapVote(c.move, c.game.id, c.env), (e) => e === offline);
  }
});
