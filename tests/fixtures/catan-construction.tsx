import { acceptMap } from "../catan-helpers.mjs";
// Deterministic browser QA only; not an application route.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CatanGameUI } from "../../components/catan/game-ui";
import { RESOURCES, applyCatanAction, catanView, createCatanGame, legalRoads, legalSettlements, type CatanAction, type CatanGame } from "../../lib/catan";

const seats = ["Anna", "Ben", "Clara"].map((name, index) => ({ id: `construction-${index}`, name }));
const viewer = seats[0].id;
type Scenario = "settlement" | "road" | "city" | "remote";
type Fixture = { game: CatanGame; action: CatanAction; actor: string; description: string };
function setupAction(game: CatanGame): CatanAction {
  const actor = game.players[game.currentPlayer].id;
  return game.phase === "setup_road"
    ? { type: "build", building: "road", position: legalRoads(game, actor, game.setupVertex)[0] }
    : { type: "build", building: "settlement", position: legalSettlements(game, actor, true)[0] };
}
function fixture(scenario: Scenario): Fixture {
  let game = acceptMap(createCatanGame(seats, 12, () => 0), applyCatanAction);
  if (scenario === "road" || scenario === "remote") game = applyCatanAction(game, viewer, setupAction(game));
  if (scenario === "remote") game = applyCatanAction(game, viewer, setupAction(game));
  if (scenario === "city") {
    while (game.phase.startsWith("setup")) game = applyCatanAction(game, game.players[game.currentPlayer].id, setupAction(game));
    const player = game.players[0];
    for (const resource of RESOURCES) { game.bank[resource] += player.resources[resource]; player.resources[resource] = 5; game.bank[resource] -= 5; }
    game.phase = "main";
    const vertex = game.board.vertices.find((item) => item.owner === viewer && item.building === "settlement")!;
    return { game, actor: viewer, action: { type: "build", building: "city", position: vertex.id }, description: "Bestätigter Ausbau: Stadt wächst 750 ms aus der Grundfläche." };
  }
  return { game, actor: game.players[game.currentPlayer].id, action: setupAction(game), description: scenario === "road" ? "Bestätigte Straße: Beide Striche rollen 700 ms aus." : scenario === "remote" ? "Ben baut aus der Ferne; Anna bleibt unverändert die betrachtende Person." : "Bestätigte Siedlung: Aufstieg, Grundfläche und Staub über 750 ms." };
}

function Preview() {
  const [scenario, setScenario] = useState<Scenario>("settlement");
  const [state, setState] = useState(() => fixture("settlement"));
  const [baseline, setBaseline] = useState(0);
  const [played, setPlayed] = useState(false);
  const [error, setError] = useState("");
  const [observations, setObservations] = useState("[]");
  const observation = useRef({ frame: 0, samples: [] as { ms: number; buildings: string[]; roads: string[]; effects: number }[] });
  useEffect(() => () => cancelAnimationFrame(observation.current.frame), []);
  function observe() {
    cancelAnimationFrame(observation.current.frame); observation.current.samples = [];
    const started = performance.now(); let previous = "";
    const sample = (now: number) => {
      const current = {
        buildings: [...document.querySelectorAll(".catan-building-structure[transform]")].map((node) => node.getAttribute("transform") ?? ""),
        roads: [...document.querySelectorAll("[data-catan-road] > line[stroke-dashoffset]")].map((node) => node.getAttribute("stroke-dashoffset") ?? ""),
        effects: document.querySelectorAll(".catan-construction-effect").length,
      };
      const key = JSON.stringify(current);
      if (key !== previous) { observation.current.samples.push({ ms: Math.round(now - started), ...current }); previous = key; }
      if (now - started < 1300) observation.current.frame = requestAnimationFrame(sample);
      else { observation.current.frame = 0; setObservations(JSON.stringify(observation.current.samples)); }
    };
    observation.current.frame = requestAnimationFrame(sample);
  }
  function reset(next = scenario) {
    cancelAnimationFrame(observation.current.frame); observation.current.frame = 0;
    setScenario(next); setState(fixture(next)); setBaseline((value) => value + 1); setPlayed(false); setError(""); setObservations("[]");
  }
  async function send(action: CatanAction, actorId = viewer) {
    try { observe(); const game = applyCatanAction(state.game, actorId, action, () => 2); setState({ ...state, game }); setError(""); return true; }
    catch (cause) { setError((cause as Error).message); return false; }
  }
  return <>
    <details className="qa-controls" style={{ top: "auto", bottom: 6, left: 6, right: "auto", maxWidth: "min(320px,calc(100vw - 12px))", maxHeight: "40vh", overflow: "auto" }} open>
      <summary>QA · Bauanimation</summary>
      <label>Szenario<select value={scenario} onChange={(event) => reset(event.target.value as Scenario)}><option value="settlement">Siedlung</option><option value="road">Straße</option><option value="city">Stadt</option><option value="remote">Gegnerische Siedlung</option></select></label>
      <p>{state.description}</p>
      <button type="button" disabled={played} onClick={async () => { if (await send(state.action, state.actor)) setPlayed(true); }}>QA: Bau bestätigen</button>
      <button type="button" onClick={() => reset()}>Zurücksetzen</button>
      <button type="button" onClick={() => { setBaseline((value) => value + 1); }}>QA: Reconnect-Baseline</button>
      <output data-qa-construction style={{ display: "block", overflowWrap: "anywhere" }}>{observations}</output>
      {error && <p role="alert">{error}</p>}
    </details>
    <div className="catan-theme"><main className="catan-shell catan-shell-wide catan-shell-play">
      <CatanGameUI game={catanView(state.game, viewer)} send={send} busy={false} local={false} afterNotificationSequence={state.game.sequence} animationBaseline={baseline} />
    </main></div>
  </>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
