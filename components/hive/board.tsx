"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { LocateFixed, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GameDialog } from "@/components/game-entry";
import { HEX_POINTS, HiveGlyph } from "./piece";
import { activeHivePlayer, hexKey, hiveBoard, hiveMovePath, HIVE_PIECES, sameHex, type Hex, type HiveGame, type HivePieceHint } from "@/lib/hive";

const point = ({ q, r }: Hex) => ({ x: Math.sqrt(3) * 38 * (q + r / 2), y: 57 * r });
export function HiveBoard({ game, selectedId, targets, pending, busy, hint = null, onSelect, onTarget, onInspectStack }: {
  game: HiveGame; selectedId: string | null; targets: Hex[]; pending: Hex | null; busy: boolean;
  hint?: HivePieceHint | null; onSelect: (pieceId: string) => void; onTarget: (position: Hex) => void; onInspectStack?: (position: Hex) => void;
}) {
  const [camera, setCamera] = useState({ zoom: 1, x: 0, y: 0 });
  const [inspectedKey, setInspectedKey] = useState<string | null>(null);
  const previousGame = useRef(game); const movingPiece = useRef<SVGGElement | null>(null);
  const drag = useRef<{ x: number; y: number; cameraX: number; cameraY: number; moved: boolean; pointerId: number } | null>(null);
  const suppressClick = useRef(false);
  const board = hiveBoard(game); const stacks = [...board.values()];
  const last = game.history[game.history.length - 1];
  const positions = [...stacks.map((stack) => stack[0].position!), ...targets, ...(last?.from ? [last.from] : [])];
  if (!positions.length) positions.push({ q: 0, r: 0 });
  const points = positions.map(point);
  const minX = Math.min(...points.map((p) => p.x)) - 70; const maxX = Math.max(...points.map((p) => p.x)) + 70;
  const minY = Math.min(...points.map((p) => p.y)) - 70; const maxY = Math.max(...points.map((p) => p.y)) + 70;
  const baseWidth = Math.max(370, maxX - minX); const baseHeight = Math.max(330, maxY - minY);
  const width = baseWidth / camera.zoom; const height = baseHeight / camera.zoom;
  const left = (minX + maxX - width) / 2 + camera.x; const top = (minY + maxY - height) / 2 + camera.y;
  const selectedPiece = game.pieces.find((p) => p.id === selectedId);
  const previewPath = selectedPiece && pending ? hiveMovePath(game, selectedPiece.id, pending) : [];
  const inspected = inspectedKey ? board.get(inspectedKey) : undefined;
  const inspect = (position: Hex) => { setInspectedKey(hexKey(position)); onInspectStack?.(position); };
  useEffect(() => {
    const before = previousGame.current; previousGame.current = game;
    const element = movingPiece.current;
    if (!element || before.id !== game.id || game.ply !== before.ply + 1 || !last?.pieceId || !last.to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const destination = point(last.to); const piece = game.pieces.find((p) => p.id === last.pieceId)!;
    const path = last.from ? hiveMovePath(before, last.pieceId, last.to) : [];
    let frames: Keyframe[] = path.map((p) => { const origin = point(p); return { transform: `translate(${origin.x - destination.x}px, ${origin.y - destination.y}px)` }; });
    if (piece.kind === "grasshopper" && path.length === 2) {
      const from = point(path[0]); frames.splice(1, 0, { transform: `translate(${(from.x - destination.x) / 2}px, ${(from.y - destination.y) / 2 - 28}px)` });
    }
    if (!frames.length) frames = [{ opacity: 0, transform: "scale(.8)" }, { opacity: 1, transform: "scale(1)" }];
    const animation = element.animate(frames, { duration: 450, easing: "ease-in-out" });
    return () => animation.cancel();
  }, [game, last]);
  const zoom = (factor: number) => setCamera((c) => ({ ...c, zoom: Math.max(.65, Math.min(3.5, c.zoom * factor)) }));
  const movePointer = (event: PointerEvent<SVGSVGElement>) => {
    const start = drag.current; if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x; const dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 7) return;
    start.moved = true; suppressClick.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(rect.width / width, rect.height / height);
    setCamera((c) => ({ ...c, x: start.cameraX - dx / scale, y: start.cameraY - dy / scale }));
  };
  const keyActivate = (event: React.KeyboardEvent<SVGGElement>, action: () => void) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action(); } };
  return <section className="hive-board-panel" aria-label="HIVE-Spielfeld">
    <div className="hive-board-top"><span>DER SCHWARM</span><span>{game.pieces.filter((p) => p.position).length} / 22 Steine</span></div>
    <div className="hive-board-controls" aria-label="Spielfeldansicht">
      <Button type="button" variant="outline" size="icon" aria-label="Spielfeld verkleinern" onClick={() => zoom(1 / 1.3)} disabled={camera.zoom <= .65}><Minus /></Button>
      <Button type="button" variant="outline" size="icon" aria-label="Spielfeld vergrößern" onClick={() => zoom(1.3)} disabled={camera.zoom >= 3.5}><Plus /></Button>
      <Button type="button" variant="outline" size="icon" aria-label="Gesamten Schwarm anzeigen" onClick={() => setCamera({ zoom: 1, x: 0, y: 0 })}><LocateFixed /></Button>
    </div>
    <svg className="hive-board" viewBox={`${left} ${top} ${width} ${height}`} role="group" aria-label="Wähle einen Stein und dann ein markiertes Zielfeld"
      onPointerDown={(e) => { if (e.pointerType === "mouse" && e.button !== 0) return; suppressClick.current = false; drag.current = { x: e.clientX, y: e.clientY, cameraX: camera.x, cameraY: camera.y, moved: false, pointerId: e.pointerId }; }}
      onPointerMove={movePointer} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <defs><pattern id="hive-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="12" cy="12" r=".8" fill="currentColor" opacity=".12" /></pattern></defs>
      <rect x={left} y={top} width={width} height={height} fill="url(#hive-grid)" />
      {last?.from && !board.has(hexKey(last.from)) && <g transform={`translate(${point(last.from).x} ${point(last.from).y})`} className="hive-last-origin" aria-hidden="true"><polygon points={HEX_POINTS} /><circle r="4" /></g>}
      {previewPath.length > 1 && <polyline className="hive-preview-path" points={previewPath.map((p) => { const { x, y } = point(p); return `${x},${y}`; }).join(" ")} aria-hidden="true" />}
      {!stacks.length && !targets.length && <g className="hive-board-empty" aria-hidden="true"><polygon points={HEX_POINTS} /><text textAnchor="middle" y="4">+</text></g>}
      {stacks.map((stack) => {
        const piece = stack[stack.length - 1]; const pos = piece.position!; const { x, y } = point(pos);
        const owner = game.players.find((p) => p.id === piece.ownerId)!; const isTarget = targets.some((t) => sameHex(t, pos));
        const isPending = pending && sameHex(pending, pos); const selected = selectedId === piece.id;
        const blocked = hint?.highlights.some((p) => sameHex(p, pos));
        const group = hint?.groups?.findIndex((positions) => positions.some((p) => sameHex(p, pos))) ?? -1;
        const label = `${HIVE_PIECES[piece.kind].name} von ${owner.name}, Feld ${pos.q}, ${pos.r}${stack.length > 1 ? `, Stapel aus ${stack.length} Steinen` : ""}${isTarget ? ", erlaubtes Zielfeld" : ""}${group >= 0 ? `, Gruppe ${group + 1}` : blocked ? ", markierter blockierender Stein" : ""}`;
        const activate = () => { if (isTarget) onTarget(pos); else if (stack.length > 1) inspect(pos); else onSelect(piece.id); };
        const action = () => { if (!busy && !suppressClick.current) activate(); };
        return <g key={hexKey(pos)} transform={`translate(${x} ${y})`} className={`hive-board-piece is-${owner.color}${selected ? " is-selected" : ""}${isTarget ? " is-target" : ""}${isPending ? " is-pending" : ""}${blocked ? " is-blocker" : ""}${pending && selected ? " is-preview-source" : ""}${last?.pieceId === piece.id ? " is-last" : ""}`}
          style={group >= 0 ? { "--hive-hint-color": ["#c47928", "#ad4b43", "#517fa2", "#7865a7", "#548051", "#aa6681"][group] } as CSSProperties : undefined}
          role="button" tabIndex={busy ? -1 : 0} aria-label={label} aria-pressed={selected || Boolean(isPending)} aria-disabled={busy} onClick={action} onKeyDown={(e) => keyActivate(e, () => { if (!busy) activate(); })}>
          <title>{label + (stack.length > 1 ? ` · Unten: ${stack.slice(0, -1).map((p) => `${HIVE_PIECES[p.kind].name} (${game.players.find((owner) => owner.id === p.ownerId)!.name})`).join(", ")}` : "")}</title>
          <g ref={last?.pieceId === piece.id ? movingPiece : undefined}>
          {stack.length > 1 && <polygon points={HEX_POINTS} className="hive-stack-shadow" transform="translate(0 8)" />}
          <polygon points={HEX_POINTS} className="hive-tile-shadow" transform="translate(0 4)" />
          <polygon points={HEX_POINTS} className="hive-tile-face" />
          <svg x="-23" y="-23" width="46" height="46" viewBox="0 0 48 48" aria-hidden="true"><HiveGlyph kind={piece.kind} /></svg>
          {stack.length > 1 && <g className="hive-stack-count" transform="translate(21 -20)"><circle r="10" /><text y="4" textAnchor="middle">{stack.length}</text></g>}
          {last?.pieceId === piece.id && <circle className="hive-last-dot" cx="0" cy="27" r="2.5" aria-hidden="true" />}
          {group >= 0 && <g className="hive-group-label" transform="translate(-22 20)"><circle r="9" /><text textAnchor="middle" y="3.5">{group + 1}</text></g>}
          </g>
        </g>;
      })}
      {targets.filter((pos) => !board.has(hexKey(pos))).map((pos) => {
        const { x, y } = point(pos); const chosen = pending && sameHex(pending, pos);
        const action = () => { if (!busy && !suppressClick.current) onTarget(pos); };
        return <g key={hexKey(pos)} transform={`translate(${x} ${y})`} className={`hive-board-target${chosen ? " is-pending" : ""}`} role="button" tabIndex={busy ? -1 : 0} aria-label={`Erlaubtes Zielfeld ${pos.q}, ${pos.r}`} aria-pressed={Boolean(chosen)} aria-disabled={busy}
          onClick={action} onKeyDown={(e) => keyActivate(e, () => { if (!busy) onTarget(pos); })}>
          <polygon points={HEX_POINTS} /><text textAnchor="middle" y="6" aria-hidden="true">{chosen ? "✓" : "+"}</text>
        </g>;
      })}
      {pending && selectedPiece && <g className={`hive-board-piece hive-move-preview is-${game.players.find((p) => p.id === selectedPiece.ownerId)!.color}`} transform={`translate(${point(pending).x} ${point(pending).y - (board.has(hexKey(pending)) ? 9 : 0)})`} role="img" aria-label={`Zugvorschau: ${HIVE_PIECES[selectedPiece.kind].name}`}>
        <polygon className="hive-tile-shadow" points={HEX_POINTS} transform="translate(0 4)" /><polygon className="hive-tile-face" points={HEX_POINTS} />
        <svg x="-23" y="-23" width="46" height="46" viewBox="0 0 48 48" aria-hidden="true"><HiveGlyph kind={selectedPiece.kind} /></svg>
        <text className="hive-preview-label" textAnchor="middle" y="52">Vorschau</text>
      </g>}
    </svg>
    <p className="hive-board-hint">{hint?.groups ? "Nummerierte Gruppen würden voneinander getrennt." : hint?.highlights.length ? "Markierte Steine erklären die Blockade." : !stacks.length ? `${activeHivePlayer(game).name} setzt den ersten Stein.` : "Ziehen zum Verschieben · + / − zum Zoomen · Stapel antippen"}</p>
    {inspected && <GameDialog theme="hive" kicker={`${inspected.length} Steine · Feld ${inspected[0].position!.q}, ${inspected[0].position!.r}`} title="Dieser Stapel" description="Von oben nach unten. Nur der oberste Stein kann ziehen; seine Farbe zählt beim Anlegen." onClose={() => setInspectedKey(null)}>
      <ol className="hive-stack-list">{[...inspected].reverse().map((piece, i) => {
        const owner = game.players.find((p) => p.id === piece.ownerId)!;
        return <li key={piece.id}><Button type="button" variant="outline" className={`hive-stack-piece is-${owner.color}`} disabled={busy} onClick={() => { onSelect(piece.id); setInspectedKey(null); }} aria-label={`${HIVE_PIECES[piece.kind].name} von ${owner.name}, Ebene ${piece.level}, ${i === 0 ? "oben" : "verdeckt"}, ansehen`}><span className="hive-mini-tile"><HiveGlyph kind={piece.kind} /></span><span><strong>{HIVE_PIECES[piece.kind].name} · {owner.name}</strong><small>Ebene {piece.level} · {i === 0 ? "Oben – bestimmt die Farbe" : "Verdeckt – kann nicht ziehen"}</small></span></Button></li>;
      })}</ol>
    </GameDialog>}
  </section>;
}
