import { acceptMap } from "../catan-helpers.mjs";
// Deterministic browser QA for the robber beside settlements, cities and construction.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CatanGameUI } from "../../components/catan/game-ui";
import { RESOURCES, RESOURCE_INFO, applyCatanAction, catanView, createCatanGame, legalRoads, legalSettlements, type CatanAction } from "../../lib/catan";

const seats = ["Anna", "Ben", "Clara"].map((name, index) => ({ id: `robber-${index}`, name }));
const viewer = seats[0].id;
function fixture(hexId: number) {
  let game = acceptMap(createCatanGame(seats, 12, () => 0), applyCatanAction);
  const preferred = game.board.hexes[hexId].vertices.filter((_, corner) => corner % 2 === 0);
  while (game.phase.startsWith("setup")) {
    const actor = game.players[game.currentPlayer].id; const road = game.phase === "setup_road";
    const choices = road ? legalRoads(game, actor, game.setupVertex) : legalSettlements(game, actor, true);
    const position = !road && game.setupIndex < 3 ? preferred[game.setupIndex] : choices[0];
    game = applyCatanAction(game, actor, { type: "build", building: road ? "road" : "settlement", position }, () => 0);
  }
  for (const player of game.players) for (const resource of RESOURCES) {
    game.bank[resource] += player.resources[resource]; player.resources[resource] = 5; game.bank[resource] -= 5;
  }
  game.phase = "main"; game.turn = 3; game.dice = [3, 3]; game.robberHex = hexId;
  return { game, city: preferred[0] };
}

function Preview() {
  const [hexId, setHexId] = useState(9);
  const [state, setState] = useState(() => fixture(9));
  const [error, setError] = useState("");
  async function send(action: CatanAction) {
    try { setState({ ...state, game: applyCatanAction(state.game, viewer, action, () => 2) }); setError(""); return true; }
    catch (cause) { setError((cause as Error).message); return false; }
  }
  return <>
    <details className="qa-controls" style={{ top: "auto", bottom: 6, left: 6, right: "auto", maxWidth: "min(320px,calc(100vw - 12px))" }} open>
      <summary>QA · Räuber</summary>
      <label>Räuberfeld<select value={hexId} onChange={(event) => { const id = Number(event.target.value); setHexId(id); setState(fixture(id)); setError(""); }}>
        {state.game.board.hexes.map((hex) => <option key={hex.id} value={hex.id}>Feld {hex.id + 1}: {hex.resource === "desert" ? "Wüste" : RESOURCE_INFO[hex.resource].terrain}{hex.number ? ` · ${hex.number}` : ""}</option>)}
      </select></label>
      <button type="button" disabled={state.game.board.vertices[state.city].building === "city"} onClick={() => void send({ type: "build", building: "city", position: state.city })}>QA: Stadt bauen</button>
      <button type="button" onClick={() => { setState(fixture(hexId)); setError(""); }}>Zurücksetzen</button>
      {error && <p role="alert">{error}</p>}
    </details>
    <div className="catan-theme"><main className="catan-shell catan-shell-wide catan-shell-play">
      <CatanGameUI key={state.game.id} game={catanView(state.game, viewer)} send={send} busy={false} local={false} afterNotificationSequence={state.game.sequence} />
    </main></div>
  </>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
