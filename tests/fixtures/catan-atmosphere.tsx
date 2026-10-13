// Deterministic scenery QA only; not an application route.
import { useCallback, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { CatanBoard, type BoardMode } from "../../components/catan/board";
import { useAmbientPreference } from "../../components/catan/use-ambient-preference";
import { useIslandFullscreen } from "../../components/catan/use-island-fullscreen";
import { applyCatanAction, catanView, createCatanGame, legalRoads, legalSettlements } from "../../lib/catan";
import type { AmbientKind } from "../../lib/catan-ambient";
import { acceptMap } from "../catan-helpers.mjs";

const seats = ["Anna", "Ben", "Clara"].map((name, index) => ({ id: `atmosphere-${index}`, name }));
const viewer = seats[0].id;
function initial() {
  let game = acceptMap(createCatanGame(seats, 12, () => 0), applyCatanAction);
  game.id = "atmosphere-preview";
  while (game.phase.startsWith("setup")) {
    const actor = game.players[game.currentPlayer].id;
    const road = game.phase === "setup_road";
    const position = road ? legalRoads(game, actor, game.setupVertex)[0] : legalSettlements(game, actor, true)[0];
    game = applyCatanAction(game, actor, { type: "build", building: road ? "road" : "settlement", position });
  }
  // Keep the desert available for its dust preview while preserving a real
  // robber and complete road/building geometry for pointer regression checks.
  game.robberHex = game.board.hexes.find((hex) => hex.resource === "ore")!.id;
  game.phase = "main"; game.turn = 3; game.dice = [3, 3];
  return game;
}

function Preview() {
  const [game] = useState(initial);
  const view = useMemo(() => catanView(game, viewer), [game]);
  const [kind, setKind] = useState<AmbientKind | "">("");
  const [atmosphere, setAtmosphere] = useState(true);
  const [mode, setMode] = useState<BoardMode>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [selections, setSelections] = useState(0);
  const [generation, setGeneration] = useState(0);
  const [active, setActive] = useState(true);
  const ambient = useAmbientPreference();
  const collapse = useCallback(() => {}, []);
  const fullscreen = useIslandFullscreen(collapse);
  const choices = mode === "road" ? legalRoads(game, viewer) : mode === "settlement" ? legalSettlements(game, viewer, true)
    : mode === "robber" ? game.board.hexes.filter((hex) => hex.id !== game.robberHex).map((hex) => hex.id) : [];
  return <>
    <style>{`
      .qa-atmosphere { display:flex; flex-direction:column; height:100dvh; padding:56px 8px 8px; background:#0b2938; }
      .qa-atmosphere .catan-board-panel { flex:1 1 0; min-height:0; }
      .qa-atmosphere .catan-board-map { flex:1 1 0; min-height:0; }
      .qa-atmosphere-toolbar { position:fixed; inset:4px auto auto 8px; display:flex; align-items:center; gap:8px; z-index:100; color:#e2edf1; font:12px Arial; }
      .qa-atmosphere-toolbar button { min-height:44px; padding:4px 8px; border:1px solid #608b9f; border-radius:8px; background:#0b2e40; }
      .qa-atmosphere .qa-controls { max-width:min(260px,calc(100vw - 16px)); }
      .qa-atmosphere.is-expanded { padding:52px 0 0; }
    `}</style>
    <main className={`catan-theme qa-atmosphere${fullscreen.expanded ? " is-expanded" : ""}`} data-qa-expanded={fullscreen.expanded}>
      <div className="qa-atmosphere-toolbar">
        <button type="button" onClick={fullscreen.toggle} aria-label={fullscreen.expanded ? "Vollbild der Insel schließen" : "Insel im Vollbild öffnen"}>{fullscreen.expanded ? "Vollbild schließen" : "Vollbild"}</button>
        <output data-qa-selections aria-label="Kartenauswahlen">{selections}</output>
      </div>
      <details className="qa-controls">
        <summary>QA · Atmosphäre</summary>
        <label>Passiver Effekt<select aria-label="Passiver Effekt" value={kind} onChange={(event) => setKind(event.target.value as AmbientKind | "")}>
          <option value="">Automatisch</option><option value="sailboat">Segelboot</option><option value="pirate_ship">Piratenschiff</option><option value="gull">Möwenschwarm</option><option value="desert_dust">Wüstenstaub</option><option value="wind">Windböe</option>
        </select></label>
        <label><input type="checkbox" checked={atmosphere} onChange={(event) => setAtmosphere(event.target.checked)} />Nebel ohne Wartezeit zeigen</label>
        <label><input type="checkbox" checked={ambient.enabled} onChange={(event) => ambient.setEnabled(event.target.checked)} />Insel beleben</label>
        <label><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />Insel sichtbar</label>
        <label>Kartenaktion<select aria-label="Kartenaktion" value={mode ?? ""} onChange={(event) => { setMode(event.target.value as BoardMode || null); setSelected(null); }}>
          <option value="">Betrachten</option><option value="road">Straße bauen</option><option value="settlement">Siedlung bauen</option><option value="robber">Räuber versetzen</option>
        </select></label>
        <button type="button" onClick={() => setGeneration((value) => value + 1)}>Vorschau neu starten</button>
        <output data-qa-selected>{selected ?? ""}</output>
      </details>
      <CatanBoard key={generation} game={view} mode={mode} choices={choices} selected={selected} disabled={false} onSelect={(id) => { setSelected(id); setSelections((value) => value + 1); }}
        ambientEnabled={ambient.enabled} islandVisible={active} animationBaseline={game.sequence} ambientPreviewKind={kind || undefined} ambientPreviewAtmosphere={atmosphere} />
    </main>
  </>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
