// Local browser QA only. This file is not an application route or part of a deployment.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CatanGameUI } from "../../components/catan/game-ui";
import { RESOURCES, applyCatanAction, catanView, createCatanGame, legalRoads, legalSettlements, type CatanAction } from "../../lib/catan";

const seats = ["Anna", "Benjamin Alexander", "Clara", "Dominik Maximilian"].map((name, i) => ({ id: `qa-${i}`, name }));
function fixture(name: string) {
  let game = createCatanGame(seats, 12, () => 0);
  if (name === "setup") return { game, viewer: game.players[0].id };
  while (game.phase.startsWith("setup")) {
    const id = game.players[game.currentPlayer].id; const road = game.phase === "setup_road";
    game = applyCatanAction(game, id, { type: "build", building: road ? "road" : "settlement", position: road ? legalRoads(game, id, game.setupVertex)[0] : legalSettlements(game, id, true)[0] }, () => 0);
  }
  game.turn = 3;
  for (const p of game.players) for (const r of RESOURCES) {
    game.bank[r] += p.resources[r]; p.resources[r] = name === "poor" ? 0 : p.id === game.players[0].id ? 5 : 1; game.bank[r] -= p.resources[r];
  }
  game.phase = name === "roll" ? "roll" : "main"; game.dice = name === "roll" ? null : [3, 3];
  let viewer = game.players[0].id;
  if (["cards", "empty-bank"].includes(name)) {
    for (const type of ["knight", "plenty", "monopoly", "road_building", "victory", ...Array(10).fill("knight")] as const) {
      game.players[0].development.push({ id: `card-${game.players[0].development.length}`, type, boughtOnTurn: 1 });
      const i = game.deck.indexOf(type); if (i >= 0) game.deck.splice(i, 1);
    }
    game.players[0].development.push({ id: "new-card", type: "knight", boughtOnTurn: game.turn });
  }
  if (name === "empty-bank") for (const r of RESOURCES) { game.players[1].resources[r] += game.bank[r]; game.bank[r] = 0; }
  if (name === "discard") { game.phase = "discard"; game.discards = { [viewer]: 12 }; game.dice = [3, 4]; }
  if (name === "robber") game.phase = "robber";
  if (name === "steal") { game.phase = "steal"; game.victims = game.players.slice(1).map((p) => p.id); }
  if (name === "free-roads") { game.phase = "free_roads"; game.freeRoads = 2; }
  if (["incoming", "outgoing"].includes(name)) {
    game = applyCatanAction(game, viewer, { type: "offer_trade", toId: game.players[1].id, give: { wood: 1, brick: 1 }, receive: { wool: 1, grain: 1, ore: 1 } });
    if (name === "incoming") viewer = game.players[1].id;
  }
  if (name === "waiting") viewer = game.players[1].id;
  if (name === "finished") { game.phase = "finished"; game.winner = viewer; game.players[0].development.push(...Array.from({ length: 10 }, (_, i) => ({ id: `point-${i}`, type: "victory" as const, boughtOnTurn: 1 }))); }
  if (name === "history") game.log.push(...Array.from({ length: 60 }, (_, i) => ({ id: ++game.sequence, text: `${i + 1}. Benjamin Alexander und Dominik Maximilian handeln miteinander. Anschließend wird eine neue Straße gebaut.` })));
  return { game, viewer };
}

function Preview() {
  const [scenario, setScenario] = useState("rich");
  const [state, setState] = useState(() => fixture("rich"));
  const [error, setError] = useState("");
  const [largeText, setLargeText] = useState(false);
  async function send(action: CatanAction) {
    try { setState({ ...state, game: applyCatanAction(state.game, state.viewer, action, () => 2) }); setError(""); return true; }
    catch (e) { setError((e as Error).message); return false; }
  }
  return <><style>{`html { font-size:${largeText ? 32 : 16}px; }`}</style><details className="qa-controls"><summary>QA</summary><label>Prüfsituation<select value={scenario} onChange={(e) => { setScenario(e.target.value); setState(fixture(e.target.value)); setError(""); }}>{["rich", "poor", "setup", "roll", "discard", "robber", "steal", "free-roads", "cards", "empty-bank", "incoming", "outgoing", "waiting", "finished", "history"].map((name) => <option key={name}>{name}</option>)}</select></label><label><input type="checkbox" checked={largeText} onChange={(e) => setLargeText(e.target.checked)} />Text 200%</label>{error && <p role="alert">{error}</p>}</details>
    <div className="catan-theme"><main className="catan-shell catan-shell-wide catan-shell-play"><CatanGameUI key={`${scenario}:${state.game.id}`} game={catanView(state.game, state.viewer)} send={send} busy={false} local={false} afterNotificationSequence={0} onRematch={() => setState(fixture("setup"))} /></main></div>
  </>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
