"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Anchor, LocateFixed, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLAYER_COLORS, RESOURCE_INFO, type CatanAction, type CatanView, type Hex, type Resource } from "@/lib/catan";
import { MAX_BOARD_ZOOM, MIN_BOARD_ZOOM, type BoardCamera } from "@/lib/catan-camera";
import { pointInPolygon, type AmbientPoint } from "@/lib/catan-geometry";
import { seaParallax } from "@/lib/catan-parallax";
import { BuildingPiece, HarborIllustration, HarborSeaClip, Landscape, LandscapeDefinitions, RobberPiece } from "./landscape";
import { HARBOR_BOAT_CLEARANCE, harborLayout } from "@/lib/catan-harbor";
import { ResourceIcon } from "./resource-icon";
import { useBoardCamera } from "./use-board-camera";
import { useConstructionPlayback } from "./use-construction-playback";
import { CatanSeaBackground, type CatanSeaHandle } from "./sea-background";
import { harborOwners } from "./board-effects";
import { useBoardEffects } from "./use-board-effects";
import { CatanAmbientIsland } from "./ambient-island";
import { preloadAmbientArtwork, type AmbientKind } from "@/lib/catan-ambient";
import { NumberBackdrop } from "./number-backdrop";
import { NumberLabel } from "./number-label";

export { ResourceIcon, WoodIcon } from "./resource-icon";
export type BoardMode = "road" | "settlement" | "city" | "robber" | null;
type BoardInspection = { id: number; gameId: string };

function HexNumber({ artId, hex, blocked = false }: { artId: string; hex: Hex; blocked?: boolean }) {
  return hex.number ? <>
    {!blocked && <NumberBackdrop id={artId} resource={hex.resource} x={hex.x} y={hex.y} mirrored={hex.id % 2 === 1} />}
    <NumberLabel number={hex.number} resource={hex.resource} hexId={hex.id} x={hex.x} y={hex.y} blocked={blocked} />
  </> : null;
}

export function CatanBoard({ game, mode, choices, selected, onSelect, disabled, onInspect, islandVisible = true, animationBaseline = 0, ambientEnabled = true, seaTarget, ambientPreviewKind, ambientPreviewAtmosphere = false }: {
  game: CatanView; mode: BoardMode; choices: number[]; selected: number | null;
  onSelect: (id: number) => void; disabled: boolean; onInspect?: (resource: Resource) => void; expanded?: boolean; islandVisible?: boolean; animationBaseline?: number; ambientEnabled?: boolean; seaTarget?: HTMLElement | null;
  ambientPreviewKind?: AmbientKind; ambientPreviewAtmosphere?: boolean;
}) {
  const artId = `catan-${useId().replace(/:/g, "")}`;
  const { svgRef, effectsRef } = useConstructionPlayback(game, islandVisible, animationBaseline);
  const { boardEffectsRef, effectsBusy } = useBoardEffects(svgRef, game, islandVisible, animationBaseline);
  const [pastureReady, setPastureReady] = useState(false);
  useEffect(() => preloadAmbientArtwork(setPastureReady), []);
  const [size, setSize] = useState({ width: 360, height: 300, measured: false });
  const [worldSize, setWorldSize] = useState({ width: 360, height: 300, measured: false });
  const [inspect, setInspect] = useState<BoardInspection | null>(null);
  const seaRef = useRef<CatanSeaHandle>(null);
  const infoRef = useRef<HTMLParagraphElement>(null);
  const { board } = game;
  const inspection = inspect?.gameId === game.id ? inspect : null;
  const inspectedBuilding = inspection ? board.vertices[inspection.id] : null;
  const inspectedOwner = game.players.find((player) => player.id === inspectedBuilding?.owner);
  const infoId = `${artId}-inspection`;
  const harborLayouts = board.harbors.map((harbor) => harborLayout(board, harbor.edge));
  const buildingPreview = !disabled && game.me && (mode === "settlement" || mode === "city") && selected !== null && choices.includes(selected) ? board.vertices[selected] : null;
  const robberHex = board.hexes[game.robberHex];
  // Shared edges form one continuous seam, so neighboring hexes never double its opacity.
  const seamPath = board.edges.map((edge) => {
    const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
    return `M${a.x},${a.y}L${b.x},${b.y}`;
  }).join(" ");
  const selectedHex = mode === "robber" && selected !== null && choices.includes(selected) ? board.hexes[selected] : null;
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
  // Passing ships can occupy the extra sea in portrait/landscape letterboxing.
  // A stable vector clip covers their offshore routes throughout navigation.
  const seaClipBounds = { x: left - width, y: top - height, width: width * 3, height: height * 3 };
  // The painted sea covers the shared world; the SVG keeps its own input viewport.
  const seaViewport = seaTarget ? worldSize : size;
  const paintCamera = useCallback(({ camera: nextCamera, viewBox: nextViewBox, scale: nextScale }: { camera: BoardCamera; viewBox: string; scale: number }) => {
    const svg = svgRef.current;
    if (!svg) return;
    if (svg.getAttribute("viewBox") !== nextViewBox) svg.setAttribute("viewBox", nextViewBox);
    const nextZoom = String(nextCamera.zoom);
    if (svg.getAttribute("data-zoom") !== nextZoom) svg.setAttribute("data-zoom", nextZoom);
    svg.style.setProperty("--catan-camera-scale", String(nextScale));
    const nextSea = seaParallax({ x: left, y: top, width, height }, seaViewport, nextCamera);
    seaRef.current?.setCameraLayout(nextSea);
  }, [svgRef, left, top, width, height, seaViewport]);
  const { camera, viewBox, scale, reset, zoomBy, viewportProps, viewportRef, interactionActive } = useBoardCamera(boardBounds, size, { onFrame: paintCamera });
  const sea = seaParallax(boardBounds, seaViewport, camera);
  const seaStyle = size.measured ? { "--catan-sea-size": `${sea.size}px`, "--catan-sea-x": `${sea.x}px`, "--catan-sea-y": `${sea.y}px` } as CSSProperties : undefined;
  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      if (width && height) setSize((previous) => previous.measured && previous.width === width && previous.height === height ? previous : { width, height, measured: true });
      if (seaTarget) {
        const { width: worldWidth, height: worldHeight } = seaTarget.getBoundingClientRect();
        if (worldWidth && worldHeight) setWorldSize((previous) => previous.measured && previous.width === worldWidth && previous.height === worldHeight ? previous : { width: worldWidth, height: worldHeight, measured: true });
      }
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(node);
    if (seaTarget) observer.observe(seaTarget);
    return () => observer.disconnect();
  }, [viewportRef, seaTarget]);
  useLayoutEffect(() => {
    const node = viewportRef.current;
    const info = infoRef.current;
    if (!node || !info) return;
    const hand = node.closest(".catan-play")?.querySelector<HTMLElement>(".catan-hand-bar");
    const measure = () => {
      const viewport = node.getBoundingClientRect(); const handBounds = hand?.getBoundingClientRect(); const infoBounds = info.getBoundingClientRect();
      const overlapsHand = handBounds && handBounds.bottom > viewport.top && handBounds.top < viewport.bottom && handBounds.right > infoBounds.left && handBounds.left < infoBounds.right;
      node.style.setProperty("--catan-inspection-top", `${overlapsHand ? Math.max(8, handBounds.bottom - viewport.top + 8) : 8}px`);
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(node); observer.observe(info); if (hand) observer.observe(hand);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [viewportRef, inspection]);
  const color = (id: string) => PLAYER_COLORS[game.players.find((p) => p.id === id)!.color];
  const inspectBuilding = (id: number) => setInspect({ id, gameId: game.id });
  const activate = (id: number) => {
    if (disabled) return;
    if (mode === "city" && board.vertices[id]?.owner) inspectBuilding(id);
    onSelect(id);
  };
  const hitRadius = 24 / scale;
  const buildingTargets = board.vertices.filter((vertex) => vertex.owner && vertex.building).map((vertex) => {
    const size = Math.max(vertex.building === "city" ? 56 : 44, hitRadius * 2);
    return { vertex, x: vertex.x - size / 2, y: vertex.y - size / 2 - 6, size };
  });
  const placementPoints = choices.map((id) => {
    if (mode === "road") {
      const edge = board.edges[id]; const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
      return { id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    const point = mode === "robber" ? board.hexes[id] : board.vertices[id];
    return { id, x: point.x, y: point.y };
  });
  const tapPoint = (event: React.MouseEvent<SVGGElement>) => {
    const svg = event.currentTarget.ownerSVGElement; const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    return point.matrixTransform(matrix.inverse());
  };
  const inspectBuildingAt = (point: AmbientPoint) => {
    const hits = buildingTargets.filter((target) => point.x >= target.x && point.x <= target.x + target.size && point.y >= target.y && point.y <= target.y + target.size);
    if (!hits.length) { setInspect(null); return; }
    const nearest = hits.reduce((best, target) => Math.hypot(target.vertex.x - point.x, target.vertex.y - 6 - point.y) < Math.hypot(best.vertex.x - point.x, best.vertex.y - 6 - point.y) ? target : best);
    inspectBuilding(nearest.vertex.id);
  };
  // Overlapping touch areas resolve to the closest marked place, rather than SVG paint order.
  const activateAt = (point: AmbientPoint, robberTarget?: number) => {
    if (!mode || !placementPoints.length) return;
    if (mode === "robber") {
      // Building hit areas sit above terrain; preserve the underlying field choice.
      const hex = robberTarget === undefined ? board.hexes.slice().reverse().find((hex) => choices.includes(hex.id) && pointInPolygon(point, hex.vertices.map((id) => board.vertices[id]))) : board.hexes[robberTarget];
      if (hex) activate(hex.id);
      return;
    }
    const nearest = placementPoints.reduce((best, target) => Math.hypot(target.x - point.x, target.y - point.y) < Math.hypot(best.x - point.x, best.y - point.y) ? target : best);
    if (Math.hypot(nearest.x - point.x, nearest.y - point.y) <= Math.max(22, hitRadius)) activate(nearest.id);
  };
  const activateFromTap = (id: number, event: React.MouseEvent<SVGGElement> | null) => {
    if (!event || event.detail === 0) {
      if (mode === "robber") setInspect(null);
      activate(id); return;
    }
    const point = tapPoint(event);
    if (!point) return;
    inspectBuildingAt(point);
    activateAt(point, mode === "robber" ? id : undefined);
  };
  const inspectFromTap = (id: number, event: React.MouseEvent<SVGGElement> | null) => {
    if (!event || event.detail === 0) {
      inspectBuilding(id);
      if (mode === "city" && choices.includes(id)) activate(id);
      return;
    }
    const point = tapPoint(event);
    if (!point) return;
    inspectBuildingAt(point);
    activateAt(point);
  };
  const interactive = (id: number, label: string, run?: (event: React.MouseEvent<SVGGElement> | null) => void) => ({
    role: "button" as const, tabIndex: disabled ? -1 : 0, "aria-label": label, "aria-pressed": run ? undefined : selected === id, "aria-disabled": disabled,
    onClick: (event: React.MouseEvent<SVGGElement>) => { if (!disabled) { event.stopPropagation(); if (run) run(event); else activateFromTap(id, event); } },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!disabled) { if (run) run(null); else activateFromTap(id, null); } } },
  });
  const seaSurface = <CatanSeaBackground ref={seaRef} width={seaViewport.width} height={seaViewport.height} size={sea.size} x={sea.x} y={sea.y} active={islandVisible && seaViewport.measured} interacting={interactionActive} ambientEnabled={ambientEnabled} />;
  return <section className="catan-board-panel" aria-label="Catan-Spielbrett">
    <div className="catan-board-map"><div ref={viewportRef} className="catan-board-viewport" role="presentation" style={seaStyle} data-interacting={interactionActive} {...viewportProps} onClick={() => setInspect(null)}>
      {seaTarget ? createPortal(seaSurface, seaTarget) : seaTarget === undefined ? seaSurface : null}
      <svg ref={svgRef} className="catan-board" viewBox={viewBox} style={{ "--catan-camera-scale": scale } as CSSProperties} role="group" aria-label="Insel mit Landschaften, Häfen, Straßen und Siedlungen" aria-describedby={`${artId}-navigation-hint`} data-zoom={camera.zoom} data-catan-ambient-active={ambientEnabled && islandVisible && !interactionActive && !effectsBusy} data-catan-atmosphere-active={ambientEnabled && islandVisible}>
        <title>Catan – Spielbrett</title>
        <defs>
          <LandscapeDefinitions id={artId} cleanPasture={pastureReady} />
          <HarborSeaClip id={artId} board={board} bounds={seaClipBounds} />
          {board.hexes.map((hex) => <clipPath key={hex.id} id={`${artId}-hex-${hex.id}`}><polygon points={hex.vertices.map((id) => `${board.vertices[id].x},${board.vertices[id].y}`).join(" ")} /></clipPath>)}
        </defs>
        <g aria-hidden="true" className="catan-shoreline">{board.edges.filter((edge) => edge.hexes.length === 1).map((edge) => {
          const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
          return <line key={edge.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#bad0c3" strokeOpacity=".3" strokeWidth="7" strokeLinecap="round" />;
        })}</g>
        {board.hexes.map((hex) => {
          const enabled = mode === "robber" && choices.includes(hex.id);
          const name = hex.resource === "desert" ? "Wüste" : RESOURCE_INFO[hex.resource].terrain;
          const playable = !mode && hex.resource !== "desert";
          const regionAction = () => { setInspect(null); if (hex.resource !== "desert") onInspect?.(hex.resource); };
          return <g key={hex.id} className={enabled || playable ? "catan-map-target" : undefined} {...(enabled ? interactive(hex.id, `Räuber auf Feld ${hex.id + 1}: ${name}${hex.number ? `, Zahl ${hex.number}` : ""}`) : playable ? interactive(hex.id, `Rohstoffton abspielen: ${RESOURCE_INFO[hex.resource as Resource].label}, Feld ${hex.id + 1}`, regionAction) : {})}>
            <title>{`Feld ${hex.id + 1}: ${name}${hex.number ? ` (${hex.number})` : ""}${hex.id === game.robberHex ? " – Räuber blockiert den Ertrag" : ""}`}</title>
            <g clipPath={`url(#${artId}-hex-${hex.id})`}><Landscape id={artId} resource={hex.resource} x={hex.x} y={hex.y} mirrored={hex.id % 2 === 1} blocked={hex.id === game.robberHex} /></g>
            <polygon className="catan-hex-border" points={hex.vertices.map((id) => `${board.vertices[id].x},${board.vertices[id].y}`).join(" ")} fill="transparent" stroke="none" strokeWidth="3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </g>;
        })}
        <g className="catan-hex-seams" aria-hidden="true" pointerEvents="none">
          <path className="catan-hex-seam-shadow" d={seamPath} fill="none" vectorEffect="non-scaling-stroke" />
          <path className="catan-hex-seam-light" d={seamPath} fill="none" vectorEffect="non-scaling-stroke" />
        </g>
        <CatanAmbientIsland game={game} artId={artId} viewBox={viewBox} boardBounds={boardBounds} scale={scale} active={islandVisible} interacting={interactionActive} enabled={ambientEnabled} effectsBusy={effectsBusy} cleanPasture={pastureReady} externalPedestrians previewKind={ambientPreviewKind} previewAtmosphere={ambientPreviewAtmosphere} />
        {board.hexes.filter((hex) => hex.resource === "desert" && hex.id !== game.robberHex).map((hex) => <text key={`desert-${hex.id}`} x={hex.x} y={hex.y + 32} fill="#283132" fontSize="13" textAnchor="middle" pointerEvents="none" aria-hidden="true">Wüste</text>)}
        {board.hexes.filter((hex) => hex.id !== game.robberHex).map((hex) => <HexNumber key={hex.id} artId={artId} hex={hex} />)}
        {mode === "robber" && board.hexes.filter((hex) => choices.includes(hex.id) && hex.id !== selected).map((hex) => <circle key={`robber-choice-${hex.id}`} cx={hex.x} cy={hex.y} r="46" fill="none" stroke="#fff5c3" strokeDasharray="4 6" strokeWidth="2" pointerEvents="none" aria-hidden="true" />)}
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
        {buildingTargets.map(({ vertex, x, y, size }) => {
          const owner = game.players.find((player) => player.id === vertex.owner)!;
          const label = `${vertex.building === "city" ? "Stadt" : "Siedlung"} · ${owner.name}`;
          return <g key={vertex.id} className="catan-map-target" data-catan-building-target={vertex.id} {...interactive(vertex.id, `Besitzer ansehen: ${label}, Kreuzung ${vertex.id + 1}`, (event) => inspectFromTap(vertex.id, event))} aria-expanded={inspection?.id === vertex.id} aria-controls={infoId}>
            <rect className="catan-building-hit-area" x={x} y={y} width={size} height={size} fill="transparent" />
            <rect className="catan-target-focus" x={x} y={y} width={size} height={size} rx="5" fill="none" stroke="#fff5c3" strokeWidth="2" vectorEffect="non-scaling-stroke" pointerEvents="none" />
          </g>;
        })}
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
          <HexNumber artId={artId} hex={robberHex} blocked />
          {robberHex.resource === "desert" && <text className="catan-blocked-desert-label" x={robberHex.x} y={robberHex.y + 29} fontSize="13" textAnchor="middle" aria-hidden="true">Wüste</text>}
        </g>
      </svg>
      {inspectedBuilding?.building && inspectedOwner && <p ref={infoRef} id={infoId} className="catan-board-field-info" style={{ top: "var(--catan-inspection-top,8px)" }} role="status" aria-atomic="true">{inspectedBuilding.building === "city" ? "Stadt" : "Siedlung"} · {inspectedOwner.name}</p>}
    </div>
    <div className="catan-board-controls">
      <div className="catan-board-zoom" role="group" aria-label="Kartenzoom">
      <Button type="button" variant="outline" size="icon" aria-label="Insel vergrößern" title="Vergrößern" disabled={camera.zoom >= MAX_BOARD_ZOOM} onClick={() => zoomBy(1.35)}><Plus /></Button>
      <Button type="button" variant="outline" size="icon" aria-label="Insel verkleinern" title="Verkleinern" disabled={camera.zoom <= MIN_BOARD_ZOOM} onClick={() => zoomBy(1 / 1.35)}><Minus /></Button>
      </div>
      <Button type="button" variant="outline" size="icon" className="catan-map-overview" aria-label="Ganze Insel anzeigen und zentrieren" title="Ganze Insel zentrieren" onClick={() => { reset(); setInspect(null); }}><LocateFixed /></Button>
      <span className="sr-only" id={`${artId}-navigation-hint`}>Insel verschieben und mit zwei Fingern zoomen.</span>
    </div></div>
  </section>;
}

export function boardAction(mode: BoardMode, position: number): CatanAction | null {
  if (!mode) return null;
  return mode === "robber" ? { type: "move_robber", hex: position } : { type: "build", building: mode, position };
}
