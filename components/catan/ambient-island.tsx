"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  AMBIENT_DOLPHIN_SIZE, AMBIENT_WALK_REST, AMBIENT_WILDLIFE_BOB, AMBIENT_WILDLIFE_SPRITES, AmbientSchedule, ambientBounds, ambientHarborExclusions, ambientPathPoint, ambientRandom, ambientSceneValid, ambientSheep, createAmbientScene, isAmbientWildlifeKind,
  type AmbientGame, type AmbientKind, type AmbientScene, type WildlifeSpecies,
} from "@/lib/catan-ambient";

// A 4 × 3 atlas has 100-unit square cells irrespective of its pixel dimensions.
const SPRITE_CELLS: Partial<Record<AmbientKind, readonly [number, number]>> = {
  gull: [0, 1], forest_bird: [2, 3], butterfly: [4, 5], dolphin: [6, 7], sheep: [8, 9], pedestrian: [10, 11],
};
const SPRITE_SIZES: Partial<Record<AmbientKind, number>> = { gull: 28, forest_bird: 24, butterfly: 12, dolphin: AMBIENT_DOLPHIN_SIZE, sheep: 18, pedestrian: 26 };

function Sprite({ artId, kind, wildlifeSpecies, staticPose = false }: { artId: string; kind: AmbientKind; wildlifeSpecies?: WildlifeSpecies; staticPose?: boolean }) {
  const wildlife = wildlifeSpecies && isAmbientWildlifeKind(kind) ? AMBIENT_WILDLIFE_SPRITES[wildlifeSpecies] : undefined;
  const cells = wildlife?.cells ?? SPRITE_CELLS[kind]; const size = wildlife?.size ?? SPRITE_SIZES[kind];
  if (!cells || !size) return null;
  return <g className={`catan-ambient-sprite catan-ambient-${kind}${wildlife ? ` catan-ambient-wildlife catan-ambient-${wildlifeSpecies}` : ""}${staticPose ? " is-static" : ""}`}>
    {(staticPose ? cells.slice(0, 1) : cells).map((cell, index) => <svg key={cell} className={`catan-ambient-pose${index ? " is-secondary" : ""}`} x={-size / 2} y={-size * .72} width={size} height={size} viewBox={wildlife?.viewBoxes?.[index] ?? `${cell % 4 * 100} ${Math.floor(cell / 4) * 100} 100 100`} overflow="hidden">
      <use href={`#${artId}-${wildlife?.atlas ?? "ambient"}-atlas`} />
    </svg>)}
  </g>;
}

function Wind({ game, artId, scene }: { game: AmbientGame; artId: string; scene: AmbientScene }) {
  return <>{scene.windFields?.map((hexId, index) => {
    const hex = game.board.hexes[hexId];
    return <g key={hexId} clipPath={`url(#${artId}-hex-${hexId})`}>
      <g transform={`translate(${hex.x} ${hex.y})${hex.id % 2 ? " scale(-1 1)" : ""}`} mask={`url(#${artId}-ambient-wind-mask)`}>
        <use className={`catan-ambient-wind-patch on-${hex.resource}`} href={`#${artId}-${hex.resource}`} style={{ "--ambient-wind-delay": `${index * -800}ms` } as CSSProperties} />
      </g>
    </g>;
  })}</>;
}

function Scene({ game, artId, scene }: { game: AmbientGame; artId: string; scene: AmbientScene }) {
  if (scene.kind === "wind") return <g className="catan-ambient-wind-scene" data-ambient-scene={scene.id}><Wind game={game} artId={artId} scene={scene} /></g>;
  if (scene.kind === "smoke") return <g data-ambient-scene={scene.id} data-ambient-kind="smoke" className="catan-ambient-smoke" transform={`translate(${scene.point!.x} ${scene.point!.y})`}>
    {[0, 1, 2].map((index) => <ellipse key={index} className="catan-ambient-smoke-puff" cx={0} cy={0} rx={2.8 + index * .3} ry={1.9 + index * .2} style={{ animationDelay: `${index * 700}ms` }} />)}
  </g>;
  const start = scene.path?.[0] ?? scene.point!;
  const next = scene.path?.[1];
  const groundDirection = next ? Math.abs(next.x - start.x) > .001 ? next.x - start.x : next.y - start.y : 1;
  const flip = scene.kind === "sheep" ? ((scene.sheepIndex ?? 0) % 2 ? -1 : 1) : scene.wildlifeSpecies || scene.kind === "pedestrian" ? groundDirection < 0 ? -1 : 1 : scene.path && scene.path[scene.path.length - 1].x < start.x ? -1 : 1;
  return <g data-ambient-scene={scene.id} data-ambient-kind={scene.kind} data-wildlife-species={scene.wildlifeSpecies} data-ambient-hex={scene.hexId} transform={`translate(${start.x} ${start.y})`} style={{ "--ambient-scene-duration": `${scene.duration}ms` } as CSSProperties}>
    <g className="catan-ambient-body" transform={`scale(${flip} 1)`}><Sprite artId={artId} kind={scene.kind} wildlifeSpecies={scene.wildlifeSpecies} /></g>
  </g>;
}

/**
 * Mount inside the board SVG after landscapes and before all play markings.
 * External pedestrian use instances sit above roads and below buildings;
 * their animated source nodes remain here inside the single scheduler layer.
 * The parent SVG's data-catan-effect-active flag pauses new scenery events;
 * data-catan-ambient-active controls the separate harbor-boat CSS wrapper.
 * Clean pasture is opt-in after the replacement image successfully loads.
 * CSS is loaded by app/catan/layout.tsx so SSR/test bundles need no CSS loader.
 */
export function CatanAmbientIsland({ game, artId, viewBox, active, interacting, enabled, effectsBusy = false, cleanPasture = true, previewKind, externalPedestrians = false }: {
  game: AmbientGame; artId: string; viewBox: string; active: boolean; interacting: boolean; enabled: boolean;
  effectsBusy?: boolean; cleanPasture?: boolean; previewKind?: AmbientKind; externalPedestrians?: boolean;
}) {
  const layer = useRef<SVGGElement>(null);
  const latest = useRef({ game, viewBox, cleanPasture, active, interacting, enabled, effectsBusy, previewKind });
  const tickRef = useRef<(() => void) | null>(null);
  const playbackRef = useRef<((running: boolean) => void) | null>(null);
  const playbackAllowed = useRef(active && enabled && !interacting);
  const [scenes, setScenes] = useState<AmbientScene[]>([]);
  const sceneKey = scenes.map((scene) => scene.id).join(":");
  useLayoutEffect(() => {
    latest.current = { game, viewBox, cleanPasture, active, interacting, enabled, effectsBusy, previewKind };
  }, [game, viewBox, cleanPasture, active, interacting, enabled, effectsBusy, previewKind]);
  useLayoutEffect(() => {
    tickRef.current?.();
  // Camera frames only update the latest bounds. They must not restart the
  // scheduler, validate routes or publish scenes while a gesture is moving.
  }, [game, cleanPasture, active, interacting, enabled, effectsBusy, previewKind]);

  useEffect(() => {
    const svg = layer.current?.ownerSVGElement;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const compact = window.matchMedia("(max-width: 639px)");
    const random = ambientRandom(`${game.id}:ambient-motion`);
    const schedule = new AmbientSchedule(random);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previousIds = ""; let previewed: AmbientKind | undefined; let disposed = false;
    let validatedGame: AmbientGame | undefined; let validatedPasture: boolean | undefined;
    const publish = (next: AmbientScene[]) => {
      const ids = next.map((scene) => scene.id).join(":");
      if (ids !== previousIds) { previousIds = ids; setScenes(next); }
    };
    const tick = () => {
      if (disposed) return;
      if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
      const current = latest.current;
      const available = current.active && current.enabled && !document.hidden && !motion.matches;
      playbackAllowed.current = available && !current.interacting;
      playbackRef.current?.(playbackAllowed.current);
      // Preserve current scenery during navigation, but leave no timer or SVG
      // animation frame competing with the camera. The end-of-gesture tick
      // expires old scenes and reads the final visible bounds in one pass.
      if (available && current.interacting) {
        svg?.setAttribute("data-catan-ambient-active", "false");
        return;
      }
      const blocked = current.interacting || current.effectsBusy || document.documentElement.classList.contains("catan-dice-rolling") ||
        svg?.getAttribute("data-catan-effect-active") === "true" || Boolean(svg?.querySelector(".catan-construction-effect")) ||
        Boolean(svg?.closest(".catan-play")?.querySelector(".catan-event-notice:not([hidden])"));
      svg?.setAttribute("data-catan-ambient-active", String(available && !blocked));
      const bounds = ambientBounds(current.viewBox); const now = performance.now();
      const state = { available, blocked, mobile: compact.matches };
      const create = (kind: AmbientKind) => {
        if (!bounds || (kind === "sheep" && !current.cleanPasture)) return null;
        return createAmbientScene(kind, current.game, bounds, random);
      };
      if (current.game !== validatedGame || current.cleanPasture !== validatedPasture) {
        schedule.prune((scene) => ambientSceneValid(scene, current.game, current.cleanPasture));
        validatedGame = current.game; validatedPasture = current.cleanPasture;
      }
      let next = schedule.tick(now, state, create);
      if (!current.previewKind) previewed = undefined;
      if (current.previewKind && current.previewKind !== previewed && available && !blocked) {
        next = schedule.preview(current.previewKind, now, state, create);
        if (next.some((scene) => scene.kind === current.previewKind)) previewed = current.previewKind;
      }
      publish(next);
      // Exactly one timer, and none at all while hidden, reduced, disabled or off-island.
      if (available) timer = setTimeout(tick, 800);
    };
    tickRef.current = tick; tick();
    document.addEventListener("visibilitychange", tick);
    motion.addEventListener("change", tick); compact.addEventListener("change", tick);
    return () => {
      disposed = true; schedule.dispose(); if (timer !== undefined) clearTimeout(timer);
      playbackAllowed.current = false; playbackRef.current?.(false);
      tickRef.current = null;
      svg?.setAttribute("data-catan-ambient-active", "false");
      document.removeEventListener("visibilitychange", tick);
      motion.removeEventListener("change", tick); compact.removeEventListener("change", tick);
      setScenes([]);
    };
  }, [game.id]);

  useLayoutEffect(() => {
    if (!layer.current || !scenes.length) return;
    const nodes = new Map([...layer.current.querySelectorAll<SVGGElement>("[data-ambient-scene]")].map((node) => [node.getAttribute("data-ambient-scene"), { node, body: node.querySelector<SVGGElement>(".catan-ambient-body") }]));
    let frame = 0; let disposed = false; let finished = false;
    const paint = (now: number) => {
      frame = 0;
      if (disposed || !playbackAllowed.current || latest.current.interacting) return;
      let running = false;
      for (const scene of scenes) {
        const entry = nodes.get(scene.id); if (!entry) continue;
        const { node, body } = entry;
        const progress = Math.max(0, Math.min(1, (now - scene.startedAt) / scene.duration));
        running ||= progress < 1;
        const elapsed = Math.max(0, now - scene.startedAt);
        const walkDuration = Math.max(1, scene.duration - AMBIENT_WALK_REST);
        const pathProgress = scene.kind === "pedestrian" ? Math.min(1, elapsed / walkDuration) : progress;
        const resting = scene.kind === "pedestrian" && elapsed >= walkDuration;
        node.classList.toggle("is-resting", resting);
        const settling = scene.kind === "sheep" && scene.duration - elapsed <= 250;
        node.classList.toggle("is-settling", settling);
        const point = scene.path ? ambientPathPoint(scene.path, pathProgress, scene.pathKind) : scene.point;
        if (point) {
          const settle = Math.max(0, Math.min(1, (scene.duration - elapsed) / 450));
          const settleWalk = Math.max(0, Math.min(1, (walkDuration - elapsed) / 250));
          const lift = scene.kind === "dolphin" ? Math.sin(progress * Math.PI) * 10 : scene.kind === "pedestrian" ? Math.sin(elapsed / 105) * .7 * settleWalk : scene.kind === "sheep" ? Math.abs(Math.sin(elapsed / 145)) * .85 * settle : scene.wildlifeSpecies ? Math.abs(Math.sin(elapsed / 210)) * AMBIENT_WILDLIFE_BOB : 0;
          node.setAttribute("transform", `translate(${point.x} ${point.y - lift})`);
          if (scene.path && pathProgress < 1) {
            const ahead = ambientPathPoint(scene.path, Math.min(1, pathProgress + .002), scene.pathKind);
            const dx = ahead.x - point.x; const dy = ahead.y - point.y;
            // Ground figures turn on vertical roads and safe wildlife corridors
            // without rotating their upright silhouettes.
            const direction = (scene.wildlifeSpecies || scene.kind === "pedestrian") && Math.abs(dx) <= .001 ? dy : dx;
            if (body && Math.abs(direction) > .001) {
              const facing = settling ? ((scene.sheepIndex ?? 0) % 2 ? -1 : 1) : direction < 0 ? -1 : 1;
              // Dolphins use an axis-aligned water clearance for their full sprite.
              const airborne = ["gull", "forest_bird", "butterfly"].includes(scene.kind);
              const angle = airborne ? Math.max(-25, Math.min(25, Math.atan2(dy, Math.abs(dx)) * 180 / Math.PI * facing)) : 0;
              body.setAttribute("transform", `rotate(${angle}) scale(${facing} 1)`);
            }
          }
          if (settling) body?.setAttribute("transform", `scale(${(scene.sheepIndex ?? 0) % 2 ? -1 : 1} 1)`);
        }
        // A long walk still becomes fully visible at its first road junction.
        // Sheep replace an identical resting sprite and need no fading gap.
        node.style.opacity = String(scene.kind === "sheep" ? 1 : Math.max(0, Math.min(1, elapsed / 400, (scene.duration - elapsed) / 400)));
      }
      if (running) frame = requestAnimationFrame(paint);
      else finished = true;
    };
    const playback = (running: boolean) => {
      if (!running) { cancelAnimationFrame(frame); frame = 0; }
      else if (!disposed && !finished && !frame) frame = requestAnimationFrame(paint);
    };
    playbackRef.current = playback;
    playback(playbackAllowed.current);
    return () => {
      disposed = true; cancelAnimationFrame(frame);
      if (playbackRef.current === playback) playbackRef.current = null;
    };
  // Frames mutate only SVG presentation; IDs, rather than game polls, own playback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey]);

  const bounds = ambientBounds(viewBox);
  const movingSheep = new Set(scenes.filter((scene) => scene.kind === "sheep").map((scene) => `${scene.hexId}:${scene.sheepIndex}`));
  return <g ref={layer} className="catan-ambient-island" aria-hidden="true" pointerEvents="none">
    <defs>
      <image id={`${artId}-ambient-atlas`} href="/catan/ambient-atlas-v1.png" width={400} height={300} preserveAspectRatio="none" />
      <image id={`${artId}-wildlife-atlas`} href="/catan/wildlife-atlas-v1.png" width={400} height={400} preserveAspectRatio="none" />
      <image id={`${artId}-field-forest-atlas`} href="/catan/field-forest-wildlife-v1.png" width={400} height={400} preserveAspectRatio="none" />
      <g id={`${artId}-ambient-pedestrians`}>
        {scenes.filter((scene) => scene.kind === "pedestrian").map((scene) => <Scene key={scene.id} game={game} artId={artId} scene={scene} />)}
      </g>
      <radialGradient id={`${artId}-ambient-wind-feather`}><stop offset="0" stopColor="white" /><stop offset=".55" stopColor="white" /><stop offset="1" stopColor="black" /></radialGradient>
      <mask id={`${artId}-ambient-wind-mask`} maskUnits="userSpaceOnUse" x={-54} y={-54} width={108} height={108}>
        <rect x={-54} y={-54} width={108} height={108} fill="black" />
        <ellipse cx={-24} cy={-23} rx={20} ry={15} fill={`url(#${artId}-ambient-wind-feather)`} />
        <ellipse cx={24} cy={21} rx={20} ry={15} fill={`url(#${artId}-ambient-wind-feather)`} />
        <circle r={18} fill="black" />
      </mask>
      {bounds && <mask id={`${artId}-ambient-sea-mask`} maskUnits="userSpaceOnUse" x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height}>
        <rect {...bounds} fill="white" />
        {game.board.hexes.map((hex) => <polygon key={hex.id} points={hex.vertices.map((id) => `${game.board.vertices[id].x},${game.board.vertices[id].y}`).join(" ")} fill="black" stroke="black" strokeWidth={22} strokeLinejoin="round" />)}
        {ambientHarborExclusions(game.board).map(({ point, radius, kind, edgeId }) => <circle key={`${kind}-${edgeId}`} cx={point.x} cy={point.y} r={radius} fill="black" />)}
      </mask>}
    </defs>
    {cleanPasture && ambientSheep(game.board).filter((sheep) => !movingSheep.has(`${sheep.hexId}:${sheep.sheepIndex}`)).map((sheep) => <g key={`${sheep.hexId}:${sheep.sheepIndex}`} clipPath={`url(#${artId}-hex-${sheep.hexId})`} className={`catan-ambient-standing-sheep${sheep.hexId === game.robberHex ? " is-blocked" : ""}`}>
      <g transform={`translate(${sheep.point.x} ${sheep.point.y}) scale(${sheep.sheepIndex % 2 ? -1 : 1} 1)`}><Sprite artId={artId} kind="sheep" staticPose /></g>
    </g>)}
    {scenes.filter((scene) => scene.kind !== "pedestrian").map((scene) => <g key={scene.id} mask={scene.kind === "dolphin" ? `url(#${artId}-ambient-sea-mask)` : undefined} clipPath={scene.kind === "sheep" && scene.hexId !== undefined ? `url(#${artId}-hex-${scene.hexId})` : undefined}>
      {scene.kind === "dolphin" && scene.path && [scene.path[0], scene.path[scene.path.length - 1]].map((point, index) => <ellipse key={index} className="catan-ambient-water-ring" cx={point.x} cy={point.y} rx={11} ry={4.4} style={{ animationDelay: `${index * Math.max(0, scene.duration - 1800)}ms`, transformOrigin: `${point.x}px ${point.y}px` }} />)}
      <Scene game={game} artId={artId} scene={scene} />
    </g>)}
    {!externalPedestrians && <use className="catan-ambient-pedestrians" href={`#${artId}-ambient-pedestrians`} />}
  </g>;
}
