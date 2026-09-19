"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { BrickWall, ChevronLeft, ChevronRight, Cloud, Map as MapIcon, Mountain, Wheat, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLAYER_COLORS, RESOURCE_INFO, type CatanAction, type CatanView, type Resource } from "@/lib/catan";

/** Stacked firewood logs in the Lucide stroke style: wood is the resource, not the forest. */
export function WoodIcon({ strokeWidth = 2, ...props }: React.SVGProps<SVGSVGElement>) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className="catan-wood-icon" {...props}>
    <circle cx="12" cy="7" r="4.5" /><circle cx="7.5" cy="15.5" r="4.5" /><circle cx="16.5" cy="15.5" r="4.5" />
    <circle cx="12" cy="7" r="1.4" /><circle cx="7.5" cy="15.5" r="1.4" /><circle cx="16.5" cy="15.5" r="1.4" />
  </svg>;
}
const TerrainIcon = { wood: WoodIcon, brick: BrickWall, wool: Cloud, grain: Wheat, ore: Mountain };
export function ResourceIcon({ resource }: { resource: Resource }) {
  const Icon = TerrainIcon[resource];
  return <Icon aria-hidden="true" style={{ color: RESOURCE_INFO[resource].color }} />;
}
export type BoardMode = "road" | "settlement" | "city" | "robber" | null;

export function CatanBoard({ game, mode, choices, selected, onSelect, disabled, expanded = false }: {
  game: CatanView; mode: BoardMode; choices: number[]; selected: number | null;
  onSelect: (id: number) => void; disabled: boolean; expanded?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 360, height: 300 });
  const [overview, setOverview] = useState<string | null>(null);
  const [inspect, setInspect] = useState<number | null>(null);
  const selectionKey = `${mode}:${selected}`;
  const selectedPoint = selected === null ? null : mode === "road" ? {
    x: (game.board.vertices[game.board.edges[selected].a].x + game.board.vertices[game.board.edges[selected].b].x) / 2,
    y: (game.board.vertices[game.board.edges[selected].a].y + game.board.vertices[game.board.edges[selected].b].y) / 2,
  } : mode === "robber" ? game.board.hexes[selected] : game.board.vertices[selected];
  const focus = selectedPoint && overview !== selectionKey ? selectedPoint : !mode && inspect !== null ? game.board.hexes[inspect] : null;
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const measure = () => { if (node.clientWidth && node.clientHeight) setSize({ width: node.clientWidth, height: node.clientHeight }); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // A focused target is always at least 52 CSS pixels across, independent of the phone's size.
  const cameraWidth = size.width / 1.3; const cameraHeight = size.height / 1.3;
  const index = selected === null ? -1 : choices.indexOf(selected);
  const { board } = game;
  const bounds = [...board.vertices.map((v) => ({ x: v.x, y: v.y })), ...board.harbors.flatMap((h) => {
    const edge = board.edges[h.edge]; const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
    const x = (a.x + b.x) / 2 * 1.20; const y = (a.y + b.y) / 2 * 1.20;
    return [{ x: x - 21, y: y - 19 }, { x: x + 21, y: y + 19 }];
  })];
  const left = Math.min(...bounds.map((p) => p.x)) - 12; const top = Math.min(...bounds.map((p) => p.y)) - 12;
  const width = Math.max(...bounds.map((p) => p.x)) - left + 12; const height = Math.max(...bounds.map((p) => p.y)) - top + 12;
  const viewBox = focus ? `${focus.x - cameraWidth / 2} ${focus.y - cameraHeight / 2} ${cameraWidth} ${cameraHeight}` : `${left} ${top} ${width} ${height}`;
  const largeOverview = expanded && !focus;
  useLayoutEffect(() => {
    const node = viewport.current;
    if (node) node.scrollTo(largeOverview ? (node.scrollWidth - node.clientWidth) / 2 : 0, largeOverview ? (node.scrollHeight - node.clientHeight) / 2 : 0);
  }, [largeOverview, size.width, size.height]);
  const color = (id: string) => PLAYER_COLORS[game.players.find((p) => p.id === id)!.color];
  const activate = (id: number) => { if (!disabled) { setOverview(null); onSelect(id); } };
  const interactive = (id: number, label: string, run = () => activate(id)) => ({
    role: "button" as const, tabIndex: disabled ? -1 : 0, "aria-label": label, "aria-pressed": selected === id, "aria-disabled": disabled,
    onClick: run, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); run(); } },
  });
  return <section className="catan-board-panel" aria-label="Catan-Spielbrett">
    <div ref={viewport} className={`catan-board-viewport${largeOverview ? " is-expanded" : ""}`}>
      <svg className="catan-board" style={largeOverview ? { width: Math.max(size.width, 560), height: Math.max(size.height, 560 * height / width), maxWidth: "none" } : undefined} viewBox={viewBox} role="group" aria-label="Insel mit Landschaften, Häfen, Straßen und Siedlungen" data-focused={Boolean(focus)}>
        <title>Catan – Spielbrett</title>
        <defs><radialGradient id="catan-sea"><stop stopColor="#224b5b" /><stop offset="1" stopColor="#142b35" /></radialGradient></defs>
        <rect x="-306" y="-278" width="612" height="556" rx="22" fill="url(#catan-sea)" />
        {board.hexes.map((hex) => {
          const enabled = mode === "robber" && choices.includes(hex.id); const picked = enabled && selected === hex.id;
          const Icon = hex.resource === "desert" ? null : TerrainIcon[hex.resource];
          const name = hex.resource === "desert" ? "Wüste" : RESOURCE_INFO[hex.resource].terrain;
          const localChoices = mode === "road" ? choices.filter((id) => board.edges[id].hexes.includes(hex.id)) : mode === "settlement" || mode === "city" ? choices.filter((id) => board.vertices[id].hexes.includes(hex.id)) : [];
          const coarse = !focus && localChoices.length > 0;
          const inspectable = !mode;
          const regionAction = () => { if (disabled) return; if (coarse) activate(localChoices[0]); else setInspect(hex.id); };
          return <g key={hex.id} className={enabled || coarse || inspectable ? "catan-map-target" : undefined} {...(enabled ? interactive(hex.id, `Räuber auf Feld ${hex.id + 1}: ${name}${hex.number ? `, Zahl ${hex.number}` : ""}`) : coarse || inspectable ? interactive(hex.id, `${coarse ? "Bauplätze" : "Feld"} ansehen: ${name}, ${hex.number ?? "Wüste"}, Feld ${hex.id + 1}`, regionAction) : {})}>
            <title>{`Feld ${hex.id + 1}: ${name}${hex.number ? ` (${hex.number})` : ""}${hex.id === game.robberHex ? " – Räuber blockiert den Ertrag" : ""}`}</title>
            <polygon points={hex.vertices.map((id) => `${board.vertices[id].x},${board.vertices[id].y}`).join(" ")} fill={hex.resource === "desert" ? "#c0aa79" : RESOURCE_INFO[hex.resource].color} stroke={picked ? "#fff5c3" : "#193840"} strokeWidth={picked ? 5 : 3} />
            {Icon && <Icon x={hex.x - 12} y={hex.y - 34} width="24" height="24" color="#ffffffa8" strokeWidth="1.5" />}
            {hex.number && <><circle cx={hex.x} cy={hex.y + 10} r="20" fill="#fff2d7" stroke="#1d2939" strokeWidth="1.5" />
              <text x={hex.x} y={hex.y + 14} textAnchor="middle" fontSize="22" fontWeight="800" fill={[6, 8].includes(hex.number) ? "#a62f25" : "#25313b"}>{hex.number}</text>
              <text x={hex.x} y={hex.y + 25} textAnchor="middle" fontSize="10" letterSpacing="1" fill={[6, 8].includes(hex.number) ? "#a62f25" : "#25313b"}>{"•".repeat(6 - Math.abs(7 - hex.number))}</text></>}
            {hex.id === game.robberHex && <g aria-label="Räuber"><circle cx={hex.x + 23} cy={hex.y - 1} r="14" fill="#172129" stroke="#fff2d7" strokeWidth="2" /><text x={hex.x + 23} y={hex.y + 5} textAnchor="middle" fill="#fff2d7" fontSize="17" fontWeight="800">R</text></g>}
            {enabled && !picked && <circle cx={hex.x} cy={hex.y} r="46" fill="none" stroke="#fff5c3" strokeDasharray="4 6" strokeWidth="2" />}
            {hex.resource === "desert" && <text x={hex.x} y={hex.y + 32} fill="#283132" fontSize="13" textAnchor="middle">Wüste</text>}
          </g>;
        })}
        {board.harbors.map((harbor) => {
          const edge = board.edges[harbor.edge]; const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
          const x = (a.x + b.x) / 2 * 1.20; const y = (a.y + b.y) / 2 * 1.20;
          const label = harbor.resource === "any" ? "3:1" : "2:1";
          const Icon = harbor.resource === "any" ? null : TerrainIcon[harbor.resource];
          return <g key={harbor.edge}><title>{harbor.resource === "any" ? "Hafen für alle Rohstoffe, 3 zu 1" : `${RESOURCE_INFO[harbor.resource].label}-Hafen, 2 zu 1`}</title>
            <path d={`M${a.x},${a.y}L${x},${y}L${b.x},${b.y}`} fill="none" stroke="#bacbd0" strokeWidth="2" />
            <rect x={x - 21} y={y - 19} width="42" height="38" rx="9" fill="#11232c" stroke="#80959d" />
            {Icon && <Icon x={x - 7} y={y - 15} width="14" height="14" color="#f3dfaf" />}
            <text x={x} y={y + (Icon ? 13 : 5)} fill="#f3dfaf" textAnchor="middle" fontSize="17" fontWeight="700">{label}</text>
          </g>;
        })}
        {board.edges.filter((e) => e.owner).map((edge) => {
          const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
          return <g key={edge.id}><title>{`${game.players.find((p) => p.id === edge.owner)!.name}: Straße ${edge.id + 1}`}</title>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#16232e" strokeWidth="13" strokeLinecap="round" />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color(edge.owner!)} strokeWidth="9" strokeLinecap="round" />
          </g>;
        })}
        {board.vertices.filter((v) => v.owner).map((v) => <g key={v.id}>
          <title>{`${game.players.find((p) => p.id === v.owner)!.name}: ${v.building === "city" ? "Stadt" : "Siedlung"} auf Kreuzung ${v.id + 1}`}</title>
          <path d={v.building === "city" ? `M${v.x - 16},${v.y + 12}v-24h10v6h12v-6h10v24Z` : `M${v.x - 13},${v.y + 12}v-17l13,-11 13,11v17Z`} fill={color(v.owner!)} stroke="#18252a" strokeWidth="3" />
          <text x={v.x} y={v.y + 8} textAnchor="middle" fontSize="16" fontWeight="900" fill="#111f2b">{v.building === "city" ? "2" : "1"}</text>
        </g>)}
        {mode === "road" && choices.map((id) => {
          const edge = board.edges[id]; const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
          return <g key={id} className="catan-map-target" {...interactive(id, `Straße auf Weg ${id + 1} bauen`)}>
            <circle cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} r="22" fill="transparent" />
            <line x1={a.x * .8 + b.x * .2} y1={a.y * .8 + b.y * .2} x2={b.x * .8 + a.x * .2} y2={b.y * .8 + a.y * .2} stroke={selected === id ? "#fff5c3" : "#ffe3a4a0"} strokeWidth="12" strokeLinecap="round" />
            <line x1={a.x * .8 + b.x * .2} y1={a.y * .8 + b.y * .2} x2={b.x * .8 + a.x * .2} y2={b.y * .8 + a.y * .2} stroke="transparent" strokeWidth="28" />
          </g>;
        })}
        {(mode === "settlement" || mode === "city") && choices.map((id) => {
          const v = board.vertices[id];
          return <g key={id} className="catan-map-target" {...interactive(id, `${mode === "city" ? "Stadt" : "Siedlung"} auf Kreuzung ${id + 1} bauen`)}>
            <circle cx={v.x} cy={v.y} r="22" fill="transparent" /><circle cx={v.x} cy={v.y} r={focus || selected === id ? 18 : 5} fill={selected === id ? "#ffe7a1" : "#162b34"} stroke="#ffe7a1" strokeWidth="3" />
            {(focus || selected === id) && <text x={v.x} y={v.y + 5} fontSize="18" textAnchor="middle" fill={selected === id ? "#162b34" : "#ffe7a1"}>{selected === id ? "✓" : "+"}</text>}
          </g>;
        })}
      </svg>
    </div>
    <div className="catan-board-controls">
      {mode ? <>
        <Button variant="outline" size="icon" aria-label="Vorheriger Bauplatz oder Räuberplatz" disabled={disabled || index <= 0} onClick={() => activate(choices[index - 1])}><ChevronLeft /></Button>
        <Button variant="outline" className="catan-map-overview" disabled={disabled || !choices.length} onClick={() => { if (focus) setOverview(selectionKey); else activate(selected ?? choices[0]); }}>{focus ? <MapIcon /> : <ZoomIn />}<span>{focus ? "Inselübersicht" : "Bauplätze ansehen"}<small>{largeOverview ? "Insel verschieben · Platz antippen" : index >= 0 ? `Platz ${index + 1} / ${choices.length}` : `${choices.length} mögliche Plätze`}</small></span></Button>
        <Button variant="outline" size="icon" aria-label="Nächster Bauplatz oder Räuberplatz" disabled={disabled || index >= choices.length - 1} onClick={() => activate(choices[index + 1])}><ChevronRight /></Button>
      </> : <>
        <Button variant="outline" size="icon" aria-label="Vorheriges Landschaftsfeld" disabled={inspect === null || inspect === 0} onClick={() => setInspect((inspect ?? 1) - 1)}><ChevronLeft /></Button>
        <Button variant="outline" className="catan-map-overview" onClick={() => setInspect(inspect === null ? 9 : null)}>{inspect !== null ? <MapIcon /> : <ZoomIn />}<span>{inspect !== null ? "Inselübersicht" : "Felder ansehen"}<small>{inspect !== null ? `${board.hexes[inspect].resource === "desert" ? "Wüste" : RESOURCE_INFO[board.hexes[inspect].resource as Resource].terrain} · ${board.hexes[inspect].number ?? "kein Ertrag"}` : largeOverview ? "Insel verschieben · Feld antippen" : "Feld antippen zum Vergrößern"}</small></span></Button>
        <Button variant="outline" size="icon" aria-label="Nächstes Landschaftsfeld" disabled={inspect === 18} onClick={() => setInspect((inspect ?? -1) + 1)}><ChevronRight /></Button>
      </>}
    </div>
  </section>;
}

export function boardAction(mode: BoardMode, position: number): CatanAction | null {
  if (!mode) return null;
  return mode === "robber" ? { type: "move_robber", hex: position } : { type: "build", building: mode, position };
}
