// Deterministic local QA; this fixture is never shipped as an application route.
import { useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CatanGameUI } from "../../components/catan/game-ui";
import { CatanDiceOverlay } from "../../components/catan/dice";
import { CatanAmbientIsland } from "../../components/catan/ambient-island";
import { CatanSeaBackground } from "../../components/catan/sea-background";
import { BuildingPiece, HarborIllustration, HarborSeaClip, Landscape, LandscapeDefinitions } from "../../components/catan/landscape";
import { harborLayout } from "../../lib/catan-harbor";
import { acceptMap } from "../catan-helpers.mjs";
import { PLAYER_COLORS, RESOURCES, applyCatanAction, catanView, createCatanGame, legalRoads, legalSettlements, type CatanAction, type CatanView } from "../../lib/catan";
import type { AmbientKind } from "../../lib/catan-ambient";

const seats = ["Anna", "Ben", "Clara"].map((name, index) => ({ id: `details-${index}`, name }));
const ambientKinds: AmbientKind[] = ["gull", "forest_bird", "butterfly", "dolphin", "sheep", "pedestrian", "smoke", "wind", "ore_wildlife", "clay_wildlife", "grain_wildlife", "forest_wildlife"];
// Bookmarkable visual checks, without depending on the testing toolbar.
const previewParams = new URLSearchParams(window.location.search);
const requestedKind = previewParams.get("ambient") as AmbientKind | null;
const previewKind = requestedKind && ambientKinds.includes(requestedKind) ? requestedKind : null;
function initial() {
  let game = acceptMap(createCatanGame(seats, 12, () => 0), applyCatanAction);
  const harborVertex = game.board.edges[game.board.harbors[0].edge].a;
  while (game.phase.startsWith("setup")) {
    const actor = game.players[game.currentPlayer].id;
    const road = game.phase === "setup_road";
    const options = road ? legalRoads(game, actor, game.setupVertex) : legalSettlements(game, actor, true);
    const position = game.setupIndex === 0 && !road ? harborVertex : options[0];
    game = applyCatanAction(game, actor, { type: "build", building: road ? "road" : "settlement", position }, () => 0);
  }
  game.phase = "main"; game.turn = 3; game.dice = null;
  for (const player of game.players) for (const resource of RESOURCES) {
    game.bank[resource] += player.resources[resource];
    player.resources[resource] = player.id === seats[0].id ? 6 : 1;
    game.bank[resource] -= player.resources[resource];
  }
  game.players[0].development.push({ id: "fixture-knight", type: "knight", boughtOnTurn: 1 });
  if (previewParams.has("roads")) {
    for (let index = 0; index < 6; index++) {
      const options = legalRoads(game, seats[0].id);
      if (!options.length) break;
      game = applyCatanAction(game, seats[0].id, { type: "build", building: "road", position: options[0] });
    }
  }
  return game;
}

function IslandLab({ game, ambientKind, labKey }: { game: CatanView; ambientKind: AmbientKind; labKey: number }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 360, height: 300 });
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      const { width, height } = viewport.getBoundingClientRect();
      if (width > 0 && height > 0) setSize({ width, height });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  return <div ref={viewportRef} className="catan-board-viewport" style={{ width: "100%", height: "85vh", flex: "none" }}>
    <CatanSeaBackground width={size.width} height={size.height} size={Math.max(size.width, size.height)} x={0} y={0} active ambientEnabled />
    <svg className="catan-board catan-ambient-lab" viewBox="-420 -370 840 740" style={{ width: "100%", height: "100%", display: "block" }}>
      <defs><LandscapeDefinitions id="details-lab" cleanPasture /><HarborSeaClip id="details-lab" board={game.board} bounds={{ x: -420, y: -370, width: 840, height: 740 }} />{game.board.hexes.map((hex) => <clipPath key={hex.id} id={`details-lab-hex-${hex.id}`}><polygon points={hex.vertices.map((id) => `${game.board.vertices[id].x},${game.board.vertices[id].y}`).join(" ")} /></clipPath>)}</defs>
      {game.board.hexes.map((hex) => <g key={hex.id} clipPath={`url(#details-lab-hex-${hex.id})`}><Landscape id="details-lab" resource={hex.resource} x={hex.x} y={hex.y} /></g>)}
      <CatanAmbientIsland key={labKey} game={{ ...game, id: `${game.id}:lab-${labKey}` }} artId="details-lab" viewBox="-420 -370 840 740" active interacting={false} enabled previewKind={ambientKind} externalPedestrians />
      {game.board.hexes.filter((hex) => hex.number).map((hex) => <text key={`number-${hex.id}`} className="catan-number-label" x={hex.x} y={hex.y + 12} textAnchor="middle">{hex.number}</text>)}
      {game.board.harbors.map((harbor) => <HarborIllustration key={harbor.edge} id="details-lab" layout={harborLayout(game.board, harbor.edge)} phase={harbor.edge} />)}
      {game.board.edges.filter((edge) => edge.owner).map((edge) => {
        const a = game.board.vertices[edge.a]; const b = game.board.vertices[edge.b];
        return <line key={edge.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={PLAYER_COLORS[game.players.find((player) => player.id === edge.owner)!.color]} strokeWidth={4} strokeLinecap="round" />;
      })}
      <use className="catan-ambient-pedestrians" href="#details-lab-ambient-pedestrians" pointerEvents="none" aria-hidden="true" />
      {game.board.vertices.filter((vertex) => vertex.owner).map((vertex) => <BuildingPiece key={vertex.id} id="details-lab" building={vertex.building === "city" ? "city" : "settlement"} colorIndex={game.players.find((player) => player.id === vertex.owner)!.color} x={vertex.x} y={vertex.y} />)}
    </svg>
  </div>;
}

function Details() {
  const [game, setGame] = useState(initial);
  const [viewer, setViewer] = useState(seats[0].id);
  const [baseline, setBaseline] = useState(0);
  const [lab, setLab] = useState(Boolean(previewKind));
  const [ambientKind, setAmbientKind] = useState<AmbientKind>(previewKind ?? "dolphin");
  const [labKey, setLabKey] = useState(Number(previewParams.get("seed")) || 0);
  const [error, setError] = useState("");
  const view = catanView(game, viewer);
  function move(action: CatanAction) {
    try { setGame(applyCatanAction(game, viewer, action, () => 2)); setError(""); return Promise.resolve(true); }
    catch (cause) { setError((cause as Error).message); return Promise.resolve(false); }
  }
  function demonstrate(type: string) {
    try {
      const next = structuredClone(game); const actor = seats[0].id;
      next.currentPlayer = 0; next.phase = "main"; next.discards = {}; next.playedDevelopment = false;
      if (type === "roll" || type === "seven") {
        next.phase = "roll"; next.turn++; let face = 2;
        setGame(applyCatanAction(next, actor, { type: "roll" }, () => type === "seven" ? face++ : 2));
      } else if (type === "robber") {
        next.phase = "robber";
        setGame(applyCatanAction(next, actor, { type: "move_robber", hex: next.board.hexes.find((hex) => hex.resource === "wool" && hex.id !== next.robberHex)!.id }));
      } else if (type === "card") setGame(applyCatanAction(next, actor, { type: "buy_development" }, () => 0));
      else if (type === "cost") setGame(applyCatanAction(next, actor, { type: "bank_trade", give: "wood", receive: "ore" }));
      else if (type === "roads") {
        let extended = next;
        for (let index = 0; index < 6; index++) {
          const options = legalRoads(extended, actor);
          if (!options.length || !extended.players[0].resources.wood || !extended.players[0].resources.brick) break;
          extended = applyCatanAction(extended, actor, { type: "build", building: "road", position: options[0] });
        }
        setGame(extended);
      }
      else if (type === "award") {
        next.players[0].knights = 2;
        if (!next.players[0].development.some((card) => card.id === "fixture-knight")) next.players[0].development.push({ id: "fixture-knight", type: "knight", boughtOnTurn: 1 });
        setGame(applyCatanAction(next, actor, { type: "play_development", cardId: "fixture-knight" }));
      } else if (type === "gross") {
        const actionId = ++next.sequence;
        for (const tone of ["gain", "loss"] as const) (next.notifications ??= []).push({ id: ++next.sequence, actionId, playerId: actor, kind: "resources", tone, title: "Gebündelter Handel", message: "Prüfung getrennter Gewinne und Ausgaben", resources: { wood: 10, brick: 0, wool: 0, grain: 0, ore: 0 } });
        setGame(next);
      }
      setError("");
    } catch (cause) { setError((cause as Error).message); }
  }
  return <>
    <details className="qa-controls"><summary>Detail-QA</summary>
      {[['roll', 'Wurf 6'], ['seven', 'Wurf 7'], ['robber', 'Räuber'], ['card', 'Kartenkauf'], ['cost', 'Rohstoffkosten'], ['award', 'Sonderkarte'], ['gross', 'Plus und Minus'], ['roads', 'Straßennetz erweitern']].map(([type, label]) => <button key={type} onClick={() => demonstrate(type)}>{label}</button>)}
      <button onClick={() => setViewer(viewer === seats[0].id ? seats[1].id : seats[0].id)}>Spielerwechsel</button>
      <button onClick={() => setBaseline((value) => value + 1)}>Reconnect</button>
      <button onClick={() => { setGame(initial()); setViewer(seats[0].id); setError(""); }}>Neue Partie</button>
      <label><input type="checkbox" checked={lab} onChange={(event) => setLab(event.target.checked)} />Insel-Labor</label>
      <label>Inselmotiv<select value={ambientKind} onChange={(event) => { setAmbientKind(event.target.value as AmbientKind); setLabKey((value) => value + 1); }}>{ambientKinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
      <button onClick={() => setLabKey((value) => value + 1)}>Motiv wiederholen</button>
    </details>
    <div className="catan-theme"><main className="catan-shell catan-shell-wide catan-shell-play">
      {error && <div role="alert">{error}</div>}
      {lab ? <IslandLab game={view} ambientKind={ambientKind} labKey={labKey} /> : <CatanGameUI key={`${game.id}:${viewer}`} game={view} animationBaseline={baseline} send={move} busy={false} local onHide={() => setViewer(seats[1].id)} />}
    </main></div>
    {!lab && <CatanDiceOverlay game={game} animationBaseline={baseline} />}
  </>;
}
createRoot(document.getElementById("root")!).render(<Details />);
