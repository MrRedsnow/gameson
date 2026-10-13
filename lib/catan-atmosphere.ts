import type { Board } from "./catan";
import { ambientHarborExclusions, ambientPathPoint, ambientRandom, ambientSeaRectangle, segmentDistance, type AmbientBounds, type AmbientPoint } from "./catan-ambient";

export type CloudSpec = {
  id: string; variant: 0 | 1; duration: number; phase: number;
  path: readonly [AmbientPoint, AmbientPoint]; width: number;
};
export type SurfSpec = {
  id: string; edgeId: number; from: AmbientPoint; to: AmbientPoint; outward: AmbientPoint;
  phase: number; duration: number;
};
export type FogSpec = {
  id: string; path: readonly [AmbientPoint, AmbientPoint]; width: number; height: number;
  duration: number; visibleDuration: number; phase: number;
};
export type AtmosphereSpec = { clouds: readonly [CloudSpec, CloudSpec]; surf: SurfSpec[]; fog: FogSpec | null };
export const ATMOSPHERE_CLOUD_OPACITY = .46;

/** A suspended decoration keeps its place; inactive time never enters its clock. */
export class AtmosphereClock {
  private elapsedMs = 0;
  private previous: number | null = null;
  sample(now: number, running: boolean) {
    if (!Number.isFinite(now)) { this.pause(); return this.elapsedMs; }
    if (this.previous !== null) this.elapsedMs += Math.max(0, now - this.previous);
    this.previous = running ? Math.max(now, this.previous ?? now) : null;
    return this.elapsedMs;
  }
  pause() { this.previous = null; }
  get elapsed() { return this.elapsedMs; }
}

/** Cloud and boat failures are independent: one missing image never removes the other. */
export function preloadAtmosphereArtwork(onReady: (asset: "clouds" | "sailboat" | "pirate_ship", ready: boolean) => void, createImage: () => Pick<HTMLImageElement, "src" | "onload" | "onerror"> = () => new Image()) {
  let disposed = false;
  const images = (["clouds", "sailboat", "pirate_ship"] as const).map((asset) => {
    const image = createImage();
    image.onload = () => { if (!disposed) onReady(asset, true); };
    image.onerror = () => { if (!disposed) onReady(asset, false); };
    image.src = asset === "clouds" ? "/catan/clouds-atlas-v1.png" : asset === "sailboat" ? "/catan/sailboats-directions-v1.png" : "/catan/pirate-ships-directions-v1.png";
    return image;
  });
  return () => { disposed = true; images.forEach((image) => { image.onload = null; image.onerror = null; }); };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const cycle = (elapsed: number, duration: number, phase: number) => ((Math.max(0, elapsed) / duration + phase) % 1 + 1) % 1;
const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const fade = (progress: number, fraction = .12) => smooth(Math.min(progress / fraction, (1 - progress) / fraction));

/** Stable world routes depend on geometry and a local seed, never the live camera. */
export function createAtmosphere(board: Board, bounds: AmbientBounds, seed: string): AtmosphereSpec {
  const random = ambientRandom(`${seed}:atmosphere`);
  const clouds = [0, 1].map((variant) => {
    const width = 150 + random() * 60;
    const startY = bounds.y + bounds.height * (variant ? .30 : .50);
    return {
      id: `atmosphere-cloud-${variant}`, variant: variant as 0 | 1,
      duration: 70_000 + random() * 40_000, phase: (variant ? .70 : .42) + random() * .08,
      path: [{ x: bounds.x - width / 2, y: startY }, { x: bounds.x + bounds.width + width / 2, y: startY - bounds.height * .1 }] as const,
      width,
    };
  }) as [CloudSpec, CloudSpec];
  const harbors = ambientHarborExclusions(board);
  const coast = board.edges.filter((edge) => edge.hexes.length === 1).map((edge) => {
    const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let outward = { x: (b.y - a.y) / length, y: -(b.x - a.x) / length };
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; const land = board.hexes[edge.hexes[0]];
    if (outward.x * (middle.x - land.x) + outward.y * (middle.y - land.y) < 0) outward = { x: -outward.x, y: -outward.y };
    return { edge, a, b, middle, outward, tangent: { x: (b.x - a.x) / length, y: (b.y - a.y) / length } };
  });
  const surfCandidates = coast.flatMap(({ edge, a, b, outward }) => {
    if (board.harbors.some((harbor) => harbor.edge === edge.id)) return [];
    // The short stroke stays seaward, including its round ends and two-unit surge.
    const from = { x: lerp(a.x, b.x, .2) + outward.x * 5, y: lerp(a.y, b.y, .2) + outward.y * 5 };
    const to = { x: lerp(a.x, b.x, .8) + outward.x * 5, y: lerp(a.y, b.y, .8) + outward.y * 5 };
    if (harbors.some((harbor) => segmentDistance(harbor.point, from, to) < harbor.radius + 5)) return [];
    return [{ id: `atmosphere-surf-${edge.id}`, edgeId: edge.id, from, to, outward, phase: random(), duration: 8000 + random() * 4000 }];
  });
  const surf: SurfSpec[] = [];
  while (surf.length < 2 && surfCandidates.length) surf.push(surfCandidates.splice(Math.floor(random() * surfCandidates.length), 1)[0]);

  const fogCandidates: Omit<FogSpec, "id" | "duration" | "visibleDuration" | "phase">[] = [];
  for (const { middle, outward, tangent } of coast) {
    let found: Omit<FogSpec, "id" | "duration" | "visibleDuration" | "phase"> | undefined;
    for (const offset of [100, 120, 140, 160]) {
      const center = { x: middle.x + outward.x * offset, y: middle.y + outward.y * offset };
      const path = [{ x: center.x - tangent.x * 6, y: center.y - tangent.y * 6 }, { x: center.x + tangent.x * 6, y: center.y + tangent.y * 6 }] as const;
      for (const width of [120, 100, 80]) {
        const height = 18;
        const safe = Array.from({ length: 13 }, (_, step) => ambientPathPoint(path, step / 12, "polyline")).every((point) => ambientSeaRectangle(board, bounds, { x: point.x - width / 2, y: point.y - height / 2, width, height }, 18));
        if (safe) { found = { path, width, height }; break; }
      }
      if (found) break;
    }
    if (found) fogCandidates.push(found);
  }
  const fogRoute = fogCandidates[Math.floor(random() * fogCandidates.length)];
  const visibleDuration = 25_000 + random() * 15_000; const quietDuration = 120_000 + random() * 60_000;
  const duration = visibleDuration + quietDuration;
  const fog = fogRoute ? { ...fogRoute, id: "atmosphere-fog", duration, visibleDuration, phase: (visibleDuration + quietDuration * (.1 + random() * .8)) / duration } : null;
  return { clouds, surf, fog };
}

export function atmosphereCloudFrame(spec: CloudSpec, elapsed: number, scale: number, mobile: boolean) {
  const density = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const progress = cycle(elapsed, spec.duration, spec.phase);
  const screenWidth = Math.max(90, Math.min(mobile ? 140 : 220, spec.width * density));
  return { point: ambientPathPoint(spec.path, progress, "polyline"), width: screenWidth / density, opacity: ATMOSPHERE_CLOUD_OPACITY * fade(progress) };
}

export function atmosphereSurfOpacity(spec: SurfSpec, elapsed: number) {
  return .08 + .32 * Math.sin(Math.PI * cycle(elapsed, spec.duration, spec.phase)) ** 4;
}

/** The same slow position remains bounded while a quiet interval hides the fog. */
export function atmosphereFogFrame(spec: FogSpec, elapsed: number, preview = false) {
  const progress = cycle(elapsed, spec.duration, spec.phase);
  const travel = (1 - Math.cos(progress * Math.PI * 2)) / 2;
  const visibleProgress = progress * spec.duration / spec.visibleDuration;
  const opacity = preview ? .11 : visibleProgress < 1 - 1e-9 ? .11 * fade(visibleProgress, .18) : 0;
  return { point: ambientPathPoint(spec.path, travel, "polyline"), width: spec.width, height: spec.height, opacity };
}
