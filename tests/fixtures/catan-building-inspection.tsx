// Deterministic browser QA only; exercises the real game UI without a server session.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CatanGameUI } from "../../components/catan/game-ui";
import { RESOURCES, applyCatanAction, catanView, createCatanGame, legalRoads, legalSettlements, type CatanAction } from "../../lib/catan";
import { acceptMap } from "../catan-helpers.mjs";

const seats = ["Anna", "BenjaminAlexanderWagner", "Clara"].map((name, index) => ({ id: `inspection-${index}`, name }));
const viewer = seats[0].id;
function initial() {
  let game = acceptMap(createCatanGame(seats, 12, () => 0), applyCatanAction);
  while (game.phase.startsWith("setup")) {
    const actor = game.players[game.currentPlayer].id;
    const road = game.phase === "setup_road";
    const position = road ? legalRoads(game, actor, game.setupVertex)[0] : legalSettlements(game, actor, true)[0];
    game = applyCatanAction(game, actor, { type: "build", building: road ? "road" : "settlement", position });
  }
  for (const player of game.players) for (const resource of RESOURCES) {
    game.bank[resource] += player.resources[resource]; player.resources[resource] = player.id === viewer ? 10 : 2; game.bank[resource] -= player.resources[resource];
  }
  game.phase = "main"; game.turn = 3; game.dice = [3, 3];
  for (let step = 0; step < 10 && !legalSettlements(game, viewer).length; step++) {
    game = applyCatanAction(game, viewer, { type: "build", building: "road", position: legalRoads(game, viewer)[0] });
  }
  game.board.vertices.find((vertex) => vertex.owner === seats[2].id)!.building = "city";
  return game;
}

function Preview() {
  const [game, setGame] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [largeText, setLargeText] = useState(false);
  const [actions, setActions] = useState(0);
  const [error, setError] = useState("");
  const phase = game.phase === "robber" ? "robber" : game.currentPlayer === 1 ? "waiting" : "main";
  async function send(action: CatanAction) {
    try {
      setGame(applyCatanAction(game, viewer, action, () => 2)); setActions((value) => value + 1); setError("");
      return true;
    } catch (cause) { setError((cause as Error).message); return false; }
  }
  return <>
    <style>{`html { font-size:${largeText ? 32 : 16}px; }`}</style>
    <details className="qa-controls">
      <summary>QA · Besitzeranzeige</summary>
      <label>Prüfphase<select value={phase} onChange={(event) => {
        const next = structuredClone(game); next.currentPlayer = event.target.value === "waiting" ? 1 : 0;
        next.phase = event.target.value === "robber" ? "robber" : "main"; setGame(next);
      }}><option value="main">Normal</option><option value="robber">Räuber</option><option value="waiting">Warten</option></select></label>
      <label><input type="checkbox" checked={busy} onChange={(event) => setBusy(event.target.checked)} />Aktion blockieren</label>
      <label><input type="checkbox" checked={largeText} onChange={(event) => setLargeText(event.target.checked)} />Text 200%</label>
      <button type="button" onClick={() => setGame((previous) => {
        const next = structuredClone(previous); next.players[1].name = "Mara"; return next;
      })}>Name ändern</button>
      <button type="button" onClick={() => { setGame(initial()); setActions(0); setError(""); }}>Neue Partie</button>
      <output data-qa-actions>{actions}</output>
      {error && <p role="alert">{error}</p>}
    </details>
    <div className="catan-theme"><main className="catan-shell catan-shell-wide catan-shell-play">
      <CatanGameUI game={catanView(game, viewer)} send={send} busy={busy} local={false} afterNotificationSequence={game.sequence} />
    </main></div>
  </>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
