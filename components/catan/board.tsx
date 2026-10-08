"use client";

import { useEffect, useId, useLayoutEffect, useState, type CSSProperties } from "react";
import { Anchor, ChevronLeft, ChevronRight, LocateFixed, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLAYER_COLORS, RESOURCE_INFO, type CatanAction, type CatanView, type Hex, type Resource } from "@/lib/catan";
import { MAX_BOARD_ZOOM, MIN_BOARD_ZOOM } from "@/lib/catan-camera";
import { seaParallax } from "@/lib/catan-parallax";
import { BuildingPiece, HarborIllustration, HarborSeaMask, Landscape, LandscapeDefinitions, RobberPiece } from "./landscape";
import { HARBOR_BOAT_CLEARANCE, harborLayout } from "@/lib/catan-harbor";
import { ResourceIcon } from "./resource-icon";
import { useBoardCamera } from "./use-board-camera";
import { useConstructionPlayback } from "./use-construction-playback";
import { CatanSeaBackground } from "./sea-background";
import { harborOwners } from "./board-effects";
import { useBoardEffects } from "./use-board-effects";
import { CatanAmbientIsland } from "./ambient-island";
import { preloadAmbientArtwork } from "@/lib/catan-ambient";

export { ResourceIcon, WoodIcon } from "./resource-icon";
export type BoardMode = "road" | "settlement" | "city" | "robber" | null;

function HexNumber({ hex, blocked = false }: { hex: Hex; blocked?: boolean }) {
  return hex.number ? <text className={`catan-number-label${[6, 8].includes(hex.number) ? " is-frequent" : ""}${hex.resource === "grain" && !blocked ? " on-grain" : ""}${blocked ? " is-blocked" : ""}`} data-catan-number={hex.id} x={hex.x} y={hex.y + (blocked ? 36 : 12)} textAnchor="middle" aria-hidden="true">{hex.number}</text> : null;
}

export function CatanBoard({ game, mode, choices, selected, onSelect, disabled, onInspect, expanded = false, islandVisible = true, animationBaseline = 0, ambientEnabled = true }: {
  game: CatanView; mode: BoardMode; choices: number[]; selected: number | null;
  onSelect: (id: number) => void; disabled: boolean; onInspect?: (resource: Resource) => void; expanded?: boolean; islandVisible?: boolean; animationBaseline?: number; ambientEnabled?: boolean;
}) {
  const artId = `catan-${useId().replace(/:/g, "")}`;
  const { svgRef, effectsRef } = useConstructionPlayback(game, islandVisible, animationBaseline);
  const { boardEffectsRef, effectsBusy } = useBoardEffects(svgRef, game, islandVisible, animationBaseline);
  const [pastureReady, setPastureReady] = useState(false);
  useEffect(() => preloadAmbientArtwork(setPastureReady), []);
  const [size, setSize] = useState({ width: 360, height: 300, measured: false });
  const [inspect, setInspect] = useState<number | null>(null);
  const index = selected === null ? -1 : choices.indexOf(selected);
  const { board } = game;
  const harborLayouts = board.harbors.map((harbor) => harborLayout(board, harbor.edge));
  const buildingPreview = !disabled && game.me && (mode === "settlement" || mode === "city") && selected !== null && choices.includes(selected) ? board.vertices[selected] : null;
  const robberHex = board.hexes[game.robberHex];
  // Shared edges form one continuous seam, so neighboring hexes never double its opacity.
  const seamPath = board.edges.map((edge) => {
    const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
    return `M${a.x},${a.y}L${b.x},${b.y}`;
  }).join(" ");
  const selectedHex = mode === "robber" && selected !== null && choices.includes(selected) ? board.hexes[selected]
    : !mode && inspect !== null ? board.hexes[inspect] : null;
  const bounds = [...board.vertices.map((v) => ({ x: v.x, y: v.y })), ...board.harbors.flatMap((h) => {
    const edge = board.edges[h.edge]; const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
    const x = (a.x + b.x) / 2 * 1.29; const y = (a.y + b.y) / 2 * 1.29;
    return [{ x: x - 23, y: y - 20 }, { x: x + 23, y: y + 20 }];
  }), ...harborLayouts.flatMap((layout) => [{ x: layout.boat.x - HARBOR_BOAT_CLEARANCE, y: layout.boat.y - HARBOR_BOAT_CLEARANCE }, { x: layout.boat.x + HARBOR_BOAT_CLEARANCE, y: layout.boat.y + HARBOR_BOAT_CLEARANCE }])];
  // Leave visible water on every coast for the larger swimming sprites.
  const padding = 32;
  const left = Math.min(...bounds.map((p) => p.x)) - padding; const top = Math.min(...bounds.map((p) => p.y)) - padding;
  const width = Math.max(...bounds.map((p) => p.x)) - left + padding; const height = Math.max(...bounds.map((p) => p.y)) - top + padding;
  const boardBounds = { x: left, y: top, width, height };
  const { camera, viewBox, scale, reset, zoomBy, viewportProps, viewportRef, interactionActive } = useBoardCamera(boardBounds, size);
  const sea = seaParallax(boardBounds, size, camera);
  const seaStyle = size.measured ? { "--catan-sea-size": `${sea.size}px`, "--catan-sea-x": `${sea.x}px`, "--catan-sea-y": `${sea.y}px` } as CSSProperties : undefined;
  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      if (width && height) setSize({ width, height, measured: true });
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, [viewportRef]);
  const color = (id: string) => PLAYER_COLORS[game.players.find((p) => p.id === id)!.color];
  const activate = (id: number) => { if (!disabled) onSelect(id); };
  const hitRadius = 24 / scale;
  const placementPoints = choices.map((id) => {
    if (mode === "road") {
      const edge = board.edges[id]; const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
      return { id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    const point = mode === "robber" ? board.hexes[id] : board.vertices[id];
    return { id, x: point.x, y: point.y };
  });
  // Overlapping touch areas resolve to the closest marked place, rather than SVG paint order.
  const activateFromTap = (id: number, event: React.MouseEvent<SVGGElement>) => {
    if (event.detail === 0 || mode === "robber") { activate(id); return; }
    const svg = event.currentTarget.ownerSVGElement; const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return;
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    const nearest = placementPoints.reduce((best, point) => Math.hypot(point.x - local.x, point.y - local.y) < Math.hypot(best.x - local.x, best.y - local.y) ? point : best);
    if (Math.hypot(nearest.x - local.x, nearest.y - local.y) <= Math.max(22, hitRadius)) activate(nearest.id);
  };
  const interactive = (id: number, label: string, run?: () => void) => ({
    role: "button" as const, tabIndex: disabled ? -1 : 0, "aria-label": label, "aria-pressed": run ? inspect === id : selected === id, "aria-disabled": disabled,
    onClick: (event: React.MouseEvent<SVGGElement>) => { if (!disabled) { if (run) run(); else activateFromTap(id, event); } },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!disabled) { if (run) run(); else activate(id); } } },
  });
  return <section className="catan-board-panel" aria-label="Catan-Spielbrett">
    <div className="catan-board-map"><div ref={viewportRef} className="catan-board-viewport" style={seaStyle} data-interacting={interactionActive} {...viewportProps}>
      <CatanSeaBackground width={size.width} height={size.height} size={sea.size} x={sea.x} y={sea.y} active={islandVisible && size.measured} ambientEnabled={ambientEnabled} />
      <svg ref={svgRef} className="catan-board" viewBox={viewBox} role="group" aria-label="Insel mit Landschaften, Häfen, Straßen und Siedlungen" aria-describedby={`${artId}-navigation-hint`} data-zoom={camera.zoom} data-catan-ambient-active={ambientEnabled && islandVisible && !interactionActive && !effectsBusy}>
        <title>Catan – Spielbrett</title>
        <defs>
          <LandscapeDefinitions id={artId} cleanPasture={pastureReady} />
          <HarborSeaMask id={artId} board={board} bounds={boardBounds} />
          {board.hexes.map((hex) => <clipPath key={hex.id} id={`${artId}-hex-${hex.id}`}><polygon points={hex.vertices.map((id) => `${board.vertices[id].x},${board.vertices[id].y}`).join(" ")} /></clipPath>)}
        </defs>
        <g aria-hidden="true" className="catan-shoreline">{board.edges.filter((edge) => edge.hexes.length === 1).map((edge) => {
          const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
          return <line key={edge.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#bad0c3" strokeOpacity=".3" strokeWidth="7" strokeLinecap="round" />;
        })}</g>
        {board.hexes.map((hex) => {
          const enabled = mode === "robber" && choices.includes(hex.id); const picked = enabled && selected === hex.id;
          const name = hex.resource === "desert" ? "Wüste" : RESOURCE_INFO[hex.resource].terrain;
          const inspectable = !mode;
          const regionAction = () => { setInspect(hex.id); if (hex.resource !== "desert") onInspect?.(hex.resource); };
          return <g key={hex.id} className={enabled || inspectable ? "catan-map-target" : undefined} {...(enabled ? interactive(hex.id, `Räuber auf Feld ${hex.id + 1}: ${name}${hex.number ? `, Zahl ${hex.number}` : ""}`) : inspectable ? interactive(hex.id, `Feld ansehen: ${name}, ${hex.number ?? "Wüste"}, Feld ${hex.id + 1}`, regionAction) : {})}>
            <title>{`Feld ${hex.id + 1}: ${name}${hex.number ? ` (${hex.number})` : ""}${hex.id === game.robberHex ? " – Räuber blockiert den Ertrag" : ""}`}</title>
            <g clipPath={`url(#${artId}-hex-${hex.id})`}><Landscape id={artId} resource={hex.resource} x={hex.x} y={hex.y} mirrored={hex.id % 2 === 1} blocked={hex.id === game.robberHex} /></g>
            <polygon className="catan-hex-border" points={hex.vertices.map((id) => `${board.vertices[id].x},${board.vertices[id].y}`).join(" ")} fill="transparent" stroke="none" strokeWidth="3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {enabled && !picked && <circle cx={hex.x} cy={hex.y} r="46" fill="none" stroke="#fff5c3" strokeDasharray="4 6" strokeWidth="2" />}
          </g>;
        })}
        <g className="catan-hex-seams" aria-hidden="true" pointerEvents="none">
          <path className="catan-hex-seam-shadow" d={seamPath} fill="none" vectorEffect="non-scaling-stroke" />
          <path className="catan-hex-seam-light" d={seamPath} fill="none" vectorEffect="non-scaling-stroke" />
        </g>
        <CatanAmbientIsland game={game} artId={artId} viewBox={viewBox} active={islandVisible} interacting={interactionActive} enabled={ambientEnabled} effectsBusy={effectsBusy} cleanPasture={pastureReady} externalPedestrians />
        {board.hexes.filter((hex) => hex.resource === "desert" && hex.id !== game.robberHex).map((hex) => <text key={`desert-${hex.id}`} x={hex.x} y={hex.y + 32} fill="#283132" fontSize="13" textAnchor="middle" pointerEvents="none" aria-hidden="true">Wüste</text>)}
        {board.hexes.filter((hex) => hex.id !== game.robberHex).map((hex) => <HexNumber key={hex.id} hex={hex} />)}
        {selectedHex && <polygon className="catan-hex-selection" points={selectedHex.vertices.map((id) => `${board.vertices[id].x},${board.vertices[id].y}`).join(" ")} fill="none" stroke="#fff5c3" strokeWidth="3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" pointerEvents="none" aria-hidden="true" />}
        <g ref={boardEffectsRef} className="catan-board-effects" pointerEvents="none" aria-hidden="true" />
        {board.harbors.map((harbor, harborIndex) => {
          const edge = board.edges[harbor.edge]; const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
          const coastX = (a.x + b.x) / 2; const coastY = (a.y + b.y) / 2;
          const x = coastX * 1.29; const y = coastY * 1.29;
          const label = harbor.resource === "any" ? "3:1" : "2:1";
          const owners = harborOwners(board, harbor.edge);
          const ownerColors = owners.map(color);
          const ownerGradient = `${artId}-harbor-owners-${harbor.edge}`;
          const anchorPaint = owners.length > 1 ? `url(#${ownerGradient}-anchor)` : ownerColors[0];
          const coursePaint = owners.length > 1 ? `url(#${ownerGradient}-course)` : ownerColors[0];
          const harborTitle = `${harbor.resource === "any" ? "Hafen für alle Rohstoffe, 3 zu 1" : `${RESOURCE_INFO[harbor.resource].label}-Hafen, 2 zu 1`}${owners.length ? ` · erschlossen von ${owners.map((owner) => game.players.find((player) => player.id === owner)?.name).join(", ")}` : ""}`;
          return <g key={harbor.edge} className="catan-harbor" data-catan-harbor={harbor.edge}><title>{harborTitle}</title>
            <HarborIllustration id={artId} layout={harborLayouts[harborIndex]} phase={harbor.edge} />
            {owners.length > 1 && <defs>{[{ part: "anchor", left: 0, right: 24 }, { part: "course", left: x - 19, right: x + 19 }].map(({ part, left, right }) => <linearGradient key={part} id={`${ownerGradient}-${part}`} gradientUnits="userSpaceOnUse" x1={left} y1="0" x2={right} y2="0">
              <stop offset="0%" stopColor={ownerColors[0]} /><stop offset="50%" stopColor={ownerColors[0]} />
              <stop offset="50%" stopColor={ownerColors[1]} /><stop offset="100%" stopColor={ownerColors[1]} />
            </linearGradient>)}</defs>}
            <g className="catan-harbor-label">
              <rect x={x - 19} y={y - 17} width="38" height="34" rx="4" fill="#132b32" fillOpacity=".78" />
              <Anchor x={x - (harbor.resource === "any" ? 7 : 15)} y={y - 14} width="14" height="14" stroke={anchorPaint ?? "#dfdac7"} strokeWidth="1.5" />
              {harbor.resource !== "any" && <ResourceIcon resource={harbor.resource} x={x + 1} y={y - 15} width="16" height="16" />}
              <text x={x} y={y + 12} fill={coursePaint ?? "#f2ecda"} textAnchor="middle" fontSize="15" fontWeight="600">{label}</text>
            </g>
          </g>;
        })}
        {board.edges.filter((e) => e.owner).map((edge) => {
          const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
          return <g key={edge.id} data-catan-road={edge.id}><title>{`${game.players.find((p) => p.id === edge.owner)!.name}: Straße ${edge.id + 1}`}</title>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#1d2926" strokeOpacity=".8" strokeWidth="6" strokeLinecap="round" />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color(edge.owner!)} strokeWidth="4" strokeLinecap="round" />
          </g>;
        })}
        <use className="catan-ambient-pedestrians" href={`#${artId}-ambient-pedestrians`} pointerEvents="none" aria-hidden="true" />
        {board.vertices.filter((v) => v.owner && !(mode === "city" && buildingPreview?.id === v.id)).map((v) => <g key={v.id} data-catan-building={v.id}>
          <title>{`${game.players.find((p) => p.id === v.owner)!.name}: ${v.building === "city" ? "Stadt" : "Siedlung"} auf Kreuzung ${v.id + 1}`}</title>
          <BuildingPiece id={artId} building={v.building === "city" ? "city" : "settlement"} colorIndex={game.players.find((p) => p.id === v.owner)!.color} x={v.x} y={v.y} />
        </g>)}
        {buildingPreview && game.me && (mode === "settlement" || mode === "city") && <g className="catan-building-preview" pointerEvents="none" aria-hidden="true" data-catan-building-preview={buildingPreview.id}>
          <BuildingPiece id={artId} building={mode} colorIndex={game.me.color} x={buildingPreview.x} y={buildingPreview.y} />
        </g>}
        {mode === "road" && choices.map((id) => {
          const edge = board.edges[id]; const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
          return <g key={id} className="catan-map-target" {...interactive(id, `Straße auf Weg ${id + 1} bauen`)}>
            <circle cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} r={Math.max(22, hitRadius)} fill="transparent" />
            <line className="catan-target-focus" x1={a.x * .8 + b.x * .2} y1={a.y * .8 + b.y * .2} x2={b.x * .8 + a.x * .2} y2={b.y * .8 + a.y * .2} fill="none" stroke="#fff5c3" strokeWidth={(selected === id ? 9 : 6) * scale + 6} strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />
            <line className="catan-road-target" x1={a.x * .8 + b.x * .2} y1={a.y * .8 + b.y * .2} x2={b.x * .8 + a.x * .2} y2={b.y * .8 + a.y * .2} stroke={selected === id ? "#ffe7a1" : "#ffe3a4a0"} strokeWidth={selected === id ? 9 : 6} strokeLinecap="round" />
          </g>;
        })}
        {(mode === "settlement" || mode === "city") && choices.map((id) => {
          const v = board.vertices[id];
          const radius = camera.zoom >= 2 || selected === id ? 18 : 7;
          return <g key={id} className="catan-map-target" {...interactive(id, `${mode === "city" ? "Stadt" : "Siedlung"} auf Kreuzung ${id + 1} bauen`)}>
            <circle cx={v.x} cy={v.y} r={Math.max(22, hitRadius)} fill="transparent" />
            <circle className="catan-target-focus" cx={v.x} cy={v.y} r={radius + 5} fill="none" stroke="#fff5c3" strokeWidth="2" vectorEffect="non-scaling-stroke" pointerEvents="none" />
            <circle className="catan-vertex-target" cx={v.x} cy={v.y} r={radius} fill={buildingPreview?.id === id ? "transparent" : selected === id ? "#ffe7a1" : "#162b34"} stroke="#ffe7a1" strokeWidth="3" />
            {(camera.zoom >= 2 || selected === id) && <text x={v.x} y={v.y + (buildingPreview?.id === id ? 29 : 5)} fontSize={buildingPreview?.id === id ? 13 : 18} textAnchor="middle" fill={selected === id && buildingPreview?.id !== id ? "#162b34" : "#ffe7a1"}>{selected === id ? "✓" : "+"}</text>}
          </g>;
        })}
        <g ref={effectsRef} className="catan-construction-effects" pointerEvents="none" aria-hidden="true" />
        <g className="catan-robber-layer" data-catan-robber={robberHex.id} role="img" aria-label={`Räuber auf Feld ${robberHex.id + 1} – blockiert den Ertrag`} pointerEvents="none">
          <RobberPiece id={artId} x={robberHex.x} y={robberHex.y} />
          <HexNumber hex={robberHex} blocked />
          {robberHex.resource === "desert" && <text className="catan-blocked-desert-label" x={robberHex.x} y={robberHex.y + 29} fontSize="13" textAnchor="middle" aria-hidden="true">Wüste</text>}
        </g>
      </svg>
      {!mode && inspect !== null && <p className="catan-board-field-info" role="status">{board.hexes[inspect].resource === "desert" ? "Wüste" : RESOURCE_INFO[board.hexes[inspect].resource as Resource].terrain} · {board.hexes[inspect].number ? `Zahl ${board.hexes[inspect].number}` : "kein Ertrag"}{inspect === game.robberHex ? " · Räuber blockiert den Ertrag" : ""}</p>}
    </div>
    <div className="catan-board-controls">
      <Button type="button" variant="outline" size="icon" aria-label="Insel verkleinern" title="Verkleinern" disabled={camera.zoom <= MIN_BOARD_ZOOM} onClick={() => zoomBy(1 / 1.35)}><Minus /></Button>
      <Button type="button" variant="outline" size="icon" className="catan-map-overview" aria-label="Ganze Insel anzeigen und zentrieren" title="Ganze Insel zentrieren" onClick={() => { reset(); setInspect(null); }}><LocateFixed /></Button>
      <Button type="button" variant="outline" size="icon" aria-label="Insel vergrößern" title="Vergrößern" disabled={camera.zoom >= MAX_BOARD_ZOOM} onClick={() => zoomBy(1.35)}><Plus /></Button>
      <span className="sr-only" id={`${artId}-navigation-hint`}>Insel verschieben und mit zwei Fingern zoomen.</span>
    </div></div>
    {mode && !expanded && <div className="catan-board-selection">
      <Button type="button" variant="ghost" size="icon" aria-label="Vorheriger Bauplatz oder Räuberplatz" disabled={disabled || index <= 0} onClick={() => activate(choices[index - 1])}><ChevronLeft /></Button>
      <span>{index >= 0 ? `Platz ${index + 1} / ${choices.length}` : `${choices.length} mögliche Plätze`}</span>
      <Button type="button" variant="ghost" size="icon" aria-label="Nächster Bauplatz oder Räuberplatz" disabled={disabled || !choices.length || index >= choices.length - 1} onClick={() => activate(choices[index + 1])}><ChevronRight /></Button>
    </div>}
  </section>;
}

export function boardAction(mode: BoardMode, position: number): CatanAction | null {
  if (!mode) return null;
  return mode === "robber" ? { type: "move_robber", hex: position } : { type: "build", building: mode, position };
}
