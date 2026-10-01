// Local, deterministic browser QA only; not an application route.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CatanGameUI } from "../../components/catan/game-ui";
import { CatanDiceOverlay } from "../../components/catan/dice";
import { RESOURCES, RESOURCE_INFO, applyCatanAction, catanView, createCatanGame, emptyResources, legalRoads, legalSettlements, resourceCount, type CatanAction, type CatanGame, type Resource, type Resources } from "../../lib/catan";

const seats = ["Anna", "Benjamin Alexander", "Clara", "Dominik Maximilian"].map((name, i) => ({ id: `gain-qa-${i}`, name }));
// With this board seed, hex 1 is wood/6 and hex 9 is wool/6. The reserved
// vertices are not adjacent, and every piece is placed through the rules engine.
const CITY_VERTEX = 8;
const SECOND_VERTEX = 32;
type Scenario = "production" | "second-settlement" | "blocked" | "scarce-bank";
type Fixture = { game: CatanGame; viewer: string; expected: Resources; description: string };
type AnimationObservation = { ms: number; dice: boolean; counts: Resources; total: number; gains: Partial<Record<Resource | "total", string>>; flights: string[]; tab: string };

function observeAnimation(): Omit<AnimationObservation, "ms"> {
  const counts = emptyResources();
  const gains: AnimationObservation["gains"] = {};
  for (const resource of RESOURCES) {
    const cell = document.querySelector<HTMLElement>(`[data-catan-resource="${resource}"]`);
    counts[resource] = Number(cell?.querySelector("b")?.textContent ?? 0);
    const badge = cell?.querySelector<HTMLElement>(".catan-hand-gain");
    if (badge && !badge.hidden && badge.getBoundingClientRect().width && getComputedStyle(badge).opacity !== "0") gains[resource] = badge.textContent ?? "";
  }
  const total = document.querySelector<HTMLElement>(".catan-hand-total");
  const badge = total?.querySelector<HTMLElement>(".catan-hand-gain");
  if (badge && !badge.hidden && badge.getBoundingClientRect().width && getComputedStyle(badge).opacity !== "0") gains.total = badge.textContent ?? "";
  return {
    dice: document.documentElement.classList.contains("catan-dice-rolling"),
    counts,
    total: Number(total?.querySelector("b")?.textContent ?? 0),
    gains,
    flights: [...document.querySelectorAll(".catan-resource-flight svg")].map((icon) => icon.getAttribute("data-resource") ?? "unknown"),
    tab: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() ?? "",
  };
}

function fund(game: CatanGame, playerId: string, resources: Resources) {
  const player = game.players.find((p) => p.id === playerId)!;
  for (const r of RESOURCES) {
    game.bank[r] += player.resources[r];
    player.resources[r] = resources[r];
    game.bank[r] -= resources[r];
  }
}

export function resourceGainFixture(scenario: Scenario): Fixture {
  let game = createCatanGame(seats, 12, () => 0);
  const viewer = game.players[0].id;
  const reserved = new Set([CITY_VERTEX, SECOND_VERTEX]);
  for (const id of [...reserved]) for (const edgeId of game.board.vertices[id].edges) {
    const edge = game.board.edges[edgeId]; reserved.add(edge.a); reserved.add(edge.b);
  }
  while (game.phase.startsWith("setup")) {
    const actor = game.players[game.currentPlayer].id;
    if (scenario === "second-settlement" && game.setupIndex === 7 && game.phase === "setup_settlement") {
      const expected = emptyResources();
      for (const id of game.board.vertices[SECOND_VERTEX].hexes) {
        const resource = game.board.hexes[id].resource;
        if (resource !== "desert") expected[resource]++;
      }
      return { game, viewer, expected, description: "Zweite Siedlung: Wolle +1, Getreide +1, Erz +1; gesamt +3." };
    }
    const road = game.phase === "setup_road";
    const choices = road ? legalRoads(game, actor, game.setupVertex) : legalSettlements(game, actor, true);
    const position = road ? choices[0] : actor === viewer ? (game.setupIndex === 0 ? CITY_VERTEX : SECOND_VERTEX)
      : choices.find((id) => !reserved.has(id) && !game.board.vertices[id].hexes.some((hex) => game.board.hexes[hex].number === 6));
    if (position === undefined || !choices.includes(position)) throw new Error("QA-Gründung hat keinen gültigen Bauplatz.");
    game = applyCatanAction(game, actor, { type: "build", building: road ? "road" : "settlement", position }, () => 0);
  }
  game.phase = "main";
  fund(game, viewer, emptyResources(5));
  game = applyCatanAction(game, viewer, { type: "build", building: "city", position: CITY_VERTEX });
  fund(game, viewer, emptyResources(5));
  game.phase = "roll";
  game.dice = null;
  game.turn = 3;
  let expected = { ...emptyResources(), wood: 2, wool: 1 };
  let description = "Wurf 6: Stadt liefert Holz +2, Siedlung Wolle +1; gesamt +3.";
  if (scenario === "blocked") {
    game.robberHex = 1;
    expected = { ...emptyResources(), wool: 1 };
    description = "Räuber auf Holz/6: nur Wolle +1; keine Holz-Flüge.";
  }
  if (scenario === "scarce-bank") {
    const removed = game.bank.wood - 1;
    game.players[1].resources.wood += removed;
    game.bank.wood = 1;
    expected = { ...emptyResources(), wood: 1, wool: 1 };
    description = "Bank hat nur ein Holz: Stadt erhält Holz +1, Wolle +1; gesamt +2.";
  }
  return { game, viewer, expected, description };
}

function describe(resources: Partial<Resources>) {
  return RESOURCES.filter((r) => resources[r]).map((r) => `${RESOURCE_INFO[r].label} ${resources[r]! > 0 ? "+" : ""}${resources[r]}`).join(", ");
}

function Preview() {
  const [scenario, setScenario] = useState<Scenario>("production");
  const [state, setState] = useState(() => resourceGainFixture("production"));
  const [largeText, setLargeText] = useState(false);
  const [lastChange, setLastChange] = useState("");
  const [error, setError] = useState("");
  const [animationEvents, setAnimationEvents] = useState("[]");
  const observation = useRef({ frame: 0, events: [] as AnimationObservation[] });
  useEffect(() => () => cancelAnimationFrame(observation.current.frame), []);
  function startObservation() {
    cancelAnimationFrame(observation.current.frame);
    observation.current.events = [];
    setAnimationEvents("[]");
    const started = performance.now();
    let previous = "";
    const sample = (now: number) => {
      const current = observeAnimation();
      const key = JSON.stringify(current);
      if (key !== previous) {
        previous = key;
        observation.current.events.push({ ms: Math.round(now - started), ...current });
      }
      if (now - started < 8000) observation.current.frame = requestAnimationFrame(sample);
      else { observation.current.frame = 0; setAnimationEvents(JSON.stringify(observation.current.events)); }
    };
    sample(started);
  }
  const me = state.game.players.find((player) => player.id === state.viewer)!;
  const latestGains = state.game.notifications?.filter((notice) => notice.playerId === state.viewer && notice.tone === "gain" && notice.kind === "resources").at(-1);
  function reset(next: Scenario = scenario) {
    cancelAnimationFrame(observation.current.frame); observation.current.frame = 0; observation.current.events = []; setAnimationEvents("[]");
    setScenario(next); setState(resourceGainFixture(next)); setError(""); setLastChange("");
  }
  async function send(action: CatanAction) {
    startObservation();
    try {
      const before = state.game.players.find((player) => player.id === state.viewer)!.resources;
      const game = applyCatanAction(state.game, state.viewer, action, () => 2);
      const after = game.players.find((player) => player.id === state.viewer)!.resources;
      const delta = Object.fromEntries(RESOURCES.map((r) => [r, after[r] - before[r]])) as Resources;
      setLastChange(`${describe(delta)} · gesamt ${resourceCount(delta) >= 0 ? "+" : ""}${resourceCount(delta)}`);
      setState({ ...state, game }); setError(""); return true;
    } catch (cause) { setError((cause as Error).message); return false; }
  }
  const tradeGive = RESOURCES.find((r) => r !== "ore" && me.resources[r] >= 4) as Resource | undefined;
  return <>
    <style>{`
      html { font-size:${largeText ? 32 : 16}px; }
      .qa-gains-controls.qa-controls { top:auto; bottom:calc(72px + env(safe-area-inset-bottom)); left:6px; right:auto; max-width:min(315px,calc(100vw - 12px)); border:1px solid #8790a3; border-radius:8px; padding:6px 8px; background:#202838f2; font:12px/1.4 Arial,sans-serif; }
      .qa-gains-controls summary { cursor:pointer; }
      .qa-gains-controls[open] { max-height:40vh; overflow:auto; }
      .qa-gains-controls label { display:flex; gap:6px; align-items:center; margin:8px 0; }
      .qa-gains-controls select,.qa-gains-controls button { font:inherit; background:#334459; color:white; border:1px solid #738399; border-radius:4px; padding:5px 6px; }
      .qa-gains-controls button:disabled { opacity:.4; }
      .qa-gains-actions { display:flex; flex-wrap:wrap; gap:5px; }
      .qa-gains-controls p { margin:7px 0; }
      .qa-gains-controls output { display:block; }
      .qa-gains-controls [data-qa-animation-events] { overflow-wrap:anywhere; white-space:pre-wrap; }
    `}</style>
    <details className="qa-controls qa-gains-controls"><summary>QA · Rohstoffertrag</summary>
      <label>Szenario<select value={scenario} onChange={(event) => reset(event.target.value as Scenario)}>
        <option value="production">Stadt + Siedlung</option><option value="second-settlement">Zweite Siedlung</option><option value="blocked">Räuber blockiert</option><option value="scarce-bank">Bank: nur ein Holz</option>
      </select></label>
      <p>{state.description}</p>
      <div className="qa-gains-actions">
        <button type="button" onClick={() => reset()}>Zurücksetzen</button>
        <button type="button" disabled={state.game.phase !== "roll"} onClick={() => void send({ type: "roll" })}>QA: Wurf 6</button>
        <button type="button" disabled={state.game.phase !== "setup_settlement" || state.game.setupIndex !== 7} onClick={() => void send({ type: "build", building: "settlement", position: SECOND_VERTEX })}>QA: Zweite Siedlung</button>
        <button type="button" disabled={state.game.phase !== "main" || !tradeGive} onClick={() => tradeGive && void send({ type: "bank_trade", give: tradeGive, receive: "ore" })}>QA: Banktausch → Erz</button>
        <button type="button" onClick={() => setAnimationEvents(JSON.stringify(observation.current.events))}>QA: Auswertung</button>
      </div>
      <label><input type="checkbox" checked={largeText} onChange={(event) => setLargeText(event.target.checked)} />Text 200%</label>
      <output data-qa-resources={JSON.stringify(me.resources)}>Bestand: {describe(me.resources)} · gesamt {resourceCount(me.resources)}</output>
      <output data-qa-expected={JSON.stringify(state.expected)}>Erwarteter Ertrag: {describe(state.expected)} · +{resourceCount(state.expected)}</output>
      <output data-qa-last-change>{lastChange}</output>
      <output data-qa-gain-count={resourceCount(latestGains?.resources ?? {})}>Letzte Ertragsmeldung: {describe(latestGains?.resources ?? {})}</output>
      <output data-qa-animation-events>{animationEvents}</output>
      {error && <p role="alert">{error}</p>}
    </details>
    <CatanDiceOverlay game={state.game} />
    <div className="catan-theme"><main className="catan-shell catan-shell-wide catan-shell-play">
      <CatanGameUI key={state.game.id} game={catanView(state.game, state.viewer)} send={send} busy={false} local={false} afterNotificationSequence={state.game.sequence} />
    </main></div>
  </>;
}

if (typeof document !== "undefined") createRoot(document.getElementById("root")!).render(<Preview />);
