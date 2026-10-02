import type { Board, CatanView } from "./catan";

export type AmbientPoint = { x: number; y: number };
export type AmbientBounds = AmbientPoint & { width: number; height: number };
export type AmbientKind = "gull" | "forest_bird" | "butterfly" | "dolphin" | "sheep" | "pedestrian" | "smoke" | "wind";
export type AmbientGame = Pick<CatanView, "id" | "board" | "robberHex">;
export type AmbientScene = {
  id: string; kind: AmbientKind; startedAt: number; duration: number;
  point?: AmbientPoint; path?: AmbientPoint[]; hexId?: number; sheepIndex?: number;
  roadEdges?: number[]; windFields?: number[];
};

export const AMBIENT_INTERVALS: Record<AmbientKind, readonly [number, number]> = {
  gull: [25_000, 45_000], forest_bird: [45_000, 75_000], butterfly: [35_000, 60_000],
  dolphin: [90_000, 150_000], sheep: [25_000, 45_000], pedestrian: [50_000, 90_000],
  smoke: [20_000, 40_000], wind: [30_000, 50_000],
};
const KINDS = Object.keys(AMBIENT_INTERVALS) as AmbientKind[];
export const AMBIENT_DURATIONS: Record<AmbientKind, number> = {
  gull: 8000, forest_bird: 5000, butterfly: 6500, dolphin: 5500,
  sheep: 6000, pedestrian: 8500, smoke: 4500, wind: 8500,
};
export const AMBIENT_DOLPHIN_SIZE = 26;
// Sprite corner radius, the sea mask's 11-unit coast exclusion and rounding reserve.
export const AMBIENT_DOLPHIN_CLEARANCE = Math.ceil(Math.hypot(AMBIENT_DOLPHIN_SIZE / 2, AMBIENT_DOLPHIN_SIZE * .72)) + 12;
/** The painted sheep stay available unless both replacement layers have loaded. */
export function preloadAmbientArtwork(onReady: (ready: boolean) => void, createImage: () => Pick<HTMLImageElement, "src" | "onload" | "onerror"> = () => new Image()) {
  const images = [createImage(), createImage()]; const loaded = [false, false];
  let failed = false; let disposed = false;
  images.forEach((image, index) => {
    image.onload = () => { loaded[index] = true; if (!disposed && !failed && loaded.every(Boolean)) onReady(true); };
    image.onerror = () => { failed = true; if (!disposed) onReady(false); };
    image.src = index ? "/catan/ambient-atlas-v1.png" : "/catan/pasture-v1.png";
  });
  return () => { disposed = true; images.forEach((image) => { image.onload = null; image.onerror = null; }); };
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const distance = (a: AmbientPoint, b: AmbientPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const choose = <T,>(items: readonly T[], random: () => number): T | undefined => items[Math.min(items.length - 1, Math.floor(random() * items.length))];

/** Stable local decoration never consumes the game's random source or private hand. */
export function ambientRandom(seed: string) {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i++) value = Math.imul(value ^ seed.charCodeAt(i), 16777619);
  return () => { value += 0x6D2B79F5; let next = value; next = Math.imul(next ^ next >>> 15, next | 1); next ^= next + Math.imul(next ^ next >>> 7, next | 61); return ((next ^ next >>> 14) >>> 0) / 4294967296; };
}

export function ambientBounds(viewBox: string): AmbientBounds | null {
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value)) || parts[2] <= 0 || parts[3] <= 0) return null;
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}
export function pointInAmbientBounds(point: AmbientPoint, bounds: AmbientBounds, padding = 0) {
  return point.x >= bounds.x + padding && point.x <= bounds.x + bounds.width - padding && point.y >= bounds.y + padding && point.y <= bounds.y + bounds.height - padding;
}
export function segmentDistance(point: AmbientPoint, a: AmbientPoint, b: AmbientPoint) {
  const dx = b.x - a.x; const dy = b.y - a.y; const denominator = dx * dx + dy * dy;
  const t = denominator ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator)) : 0;
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}
export function pointInPolygon(point: AmbientPoint, polygon: readonly AmbientPoint[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]; const b = polygon[j];
    if (segmentDistance(point, a, b) < 1e-7) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function harborAmbientPoint(board: Board, edgeId: number) {
  const edge = board.edges[edgeId]; const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
  return { x: (a.x + b.x) / 2 * 1.29, y: (a.y + b.y) / 2 * 1.29 };
}
export function ambientSeaPoint(board: Board, bounds: AmbientBounds, point: AmbientPoint, padding = 15) {
  if (!pointInAmbientBounds(point, bounds, padding)) return false;
  for (const hex of board.hexes) if (pointInPolygon(point, hex.vertices.map((id) => board.vertices[id]))) return false;
  for (const edge of board.edges) if (edge.hexes.length === 1 && segmentDistance(point, board.vertices[edge.a], board.vertices[edge.b]) < padding) return false;
  return board.harbors.every((harbor) => distance(point, harborAmbientPoint(board, harbor.edge)) >= padding + 25);
}

export function ambientPathPoint(points: readonly AmbientPoint[], t: number): AmbientPoint {
  const p = Math.max(0, Math.min(1, t));
  if (points.length === 4) {
    const u = 1 - p; const factors = [u ** 3, 3 * u * u * p, 3 * u * p * p, p ** 3];
    return { x: points.reduce((sum, point, i) => sum + point.x * factors[i], 0), y: points.reduce((sum, point, i) => sum + point.y * factors[i], 0) };
  }
  if (!points.length) return { x: 0, y: 0 };
  if (points.length === 1) return { ...points[0] };
  const lengths = points.slice(1).map((point, i) => distance(points[i], point));
  const total = lengths.reduce((sum, length) => sum + length, 0); let remaining = total * p;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) return { x: lerp(points[i].x, points[i + 1].x, lengths[i] ? remaining / lengths[i] : 0), y: lerp(points[i].y, points[i + 1].y, lengths[i] ? remaining / lengths[i] : 0) };
    remaining -= lengths[i];
  }
  return { ...points[points.length - 1] };
}
export function ambientPath(points: readonly AmbientPoint[]) {
  if (!points.length) return "";
  const pair = (point: AmbientPoint) => `${point.x.toFixed(3)} ${point.y.toFixed(3)}`;
  return `M${pair(points[0])}${points.length === 4 ? `C${points.slice(1).map(pair).join(" ")}` : points.slice(1).map((point) => `L${pair(point)}`).join("")}`;
}

/** Sample more finely than the coast clearance, including the dolphin's airborne arc. */
export function validDolphinPath(board: Board, bounds: AmbientBounds, points: readonly AmbientPoint[]) {
  if (points.length !== 4 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
  const polygonLength = points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0);
  const steps = Math.max(80, Math.ceil(polygonLength / 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps; const point = ambientPathPoint(points, t);
    if (!ambientSeaPoint(board, bounds, point, AMBIENT_DOLPHIN_CLEARANCE) || !ambientSeaPoint(board, bounds, { ...point, y: point.y - Math.sin(t * Math.PI) * 10 }, AMBIENT_DOLPHIN_CLEARANCE)) return false;
  }
  return true;
}
function dolphinPath(board: Board, bounds: AmbientBounds, random: () => number): AmbientPoint[] | null {
  const coast = board.edges.filter((edge) => edge.hexes.length === 1);
  const candidate = (edge: Board["edges"][number], offset: number, length: number) => {
    const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const outwardLength = Math.hypot(midpoint.x, midpoint.y) || 1;
    const outward = { x: midpoint.x / outwardLength, y: midpoint.y / outwardLength };
    const tangent = { x: -outward.y, y: outward.x };
    const center = { x: midpoint.x + outward.x * offset, y: midpoint.y + outward.y * offset };
    return [
      { x: center.x - tangent.x * length / 2, y: center.y - tangent.y * length / 2 },
      { x: center.x - tangent.x * length / 6 + outward.x * 8, y: center.y - tangent.y * length / 6 + outward.y * 8 },
      { x: center.x + tangent.x * length / 6 + outward.x * 8, y: center.y + tangent.y * length / 6 + outward.y * 8 },
      { x: center.x + tangent.x * length / 2, y: center.y + tangent.y * length / 2 },
    ];
  };
  for (let attempt = 0; attempt < 100; attempt++) {
    const edge = choose(coast, random); if (!edge) return null;
    const points = candidate(edge, 27 + random() * 42, 36 + random() * 24);
    if (validDolphinPath(board, bounds, points)) return random() < .5 ? points.reverse() : points;
  }
  // Fitted square views have narrow safe water gaps. A bounded fallback scan
  // finds those gaps without weakening clearance or expanding the map camera.
  for (const edge of coast) for (const offset of [36, 42, 48, 54, 60, 66]) for (const length of [30, 42, 54]) {
    const points = candidate(edge, offset, length);
    if (validDolphinPath(board, bounds, points)) return random() < .5 ? points.reverse() : points;
  }
  return null;
}

export function ambientSheep(board: Board) {
  const offsets = [{ x: -23, y: -17 }, { x: 23, y: -19 }, { x: -23, y: 20 }, { x: 23, y: 21 }];
  return board.hexes.filter((hex) => hex.resource === "wool").flatMap((hex) => offsets.map((offset, index) => ({
    hexId: hex.id, sheepIndex: index, point: { x: hex.x + offset.x * (hex.id % 2 ? -1 : 1), y: hex.y + offset.y },
  })));
}
function terrainRoute(game: AmbientGame, bounds: AmbientBounds, resources: string[], random: () => number) {
  const fields = game.board.hexes.filter((hex) => resources.includes(hex.resource) && hex.id !== game.robberHex && pointInAmbientBounds(hex, bounds, 35));
  const hex = choose(fields, random); if (!hex) return null;
  const side = random() < .5 ? -1 : 1;
  return { hexId: hex.id, path: [
    { x: hex.x - 27 * side, y: hex.y - 18 }, { x: hex.x - 18 * side, y: hex.y - 39 },
    { x: hex.x + 22 * side, y: hex.y - 33 }, { x: hex.x + 29 * side, y: hex.y - 17 },
  ] };
}
export function ambientRoadRoute(board: Board, bounds: AmbientBounds, random: () => number) {
  const edges = board.edges.filter((edge) => edge.owner && pointInAmbientBounds(board.vertices[edge.a], bounds, 18) && pointInAmbientBounds(board.vertices[edge.b], bounds, 18));
  const first = choose(edges, random); if (!first) return null;
  const startId = random() < .5 ? first.a : first.b; const endId = startId === first.a ? first.b : first.a;
  const start = board.vertices[startId]; const end = board.vertices[endId];
  if ((start.owner && start.owner !== first.owner) || (end.owner && end.owner !== first.owner)) return null;
  const inset = (a: AmbientPoint, b: AmbientPoint) => ({ x: lerp(a.x, b.x, .25), y: lerp(a.y, b.y, .25) });
  const next = !end.owner ? choose(edges.filter((edge) => edge.id !== first.id && edge.owner === first.owner && (edge.a === endId || edge.b === endId)), random) : undefined;
  if (!next) return { roadEdges: [first.id], path: [inset(start, end), inset(end, start)] };
  const last = board.vertices[next.a === endId ? next.b : next.a];
  if (last.owner && last.owner !== first.owner) return { roadEdges: [first.id], path: [inset(start, end), inset(end, start)] };
  return { roadEdges: [first.id, next.id], path: [inset(start, end), { x: end.x, y: end.y }, inset(last, end)] };
}

export function createAmbientScene(kind: AmbientKind, game: AmbientGame, bounds: AmbientBounds, random: () => number): Omit<AmbientScene, "id" | "startedAt" | "duration" | "kind"> | null {
  if (kind === "dolphin") { const path = dolphinPath(game.board, bounds, random); return path ? { path } : null; }
  if (kind === "pedestrian") return ambientRoadRoute(game.board, bounds, random);
  if (kind === "butterfly" || kind === "forest_bird") return terrainRoute(game, bounds, kind === "butterfly" ? ["wool", "grain"] : ["wood"], random);
  if (kind === "sheep") {
    const sheep = choose(ambientSheep(game.board).filter((item) => item.hexId !== game.robberHex && pointInAmbientBounds(item.point, bounds, 16)), random);
    if (!sheep) return null;
    const direction = random() < .5 ? -1 : 1;
    // A few grazing steps return to the original place before the resting sprite reappears.
    return { ...sheep, path: [sheep.point, { x: sheep.point.x + direction * 4, y: sheep.point.y + 1.5 }, sheep.point] };
  }
  if (kind === "smoke") {
    const building = choose(game.board.vertices.filter((vertex) => vertex.owner && pointInAmbientBounds(vertex, bounds, 25)), random);
    return building ? { point: { x: building.x - (building.building === "city" ? 5 : 4), y: building.y - (building.building === "city" ? 31 : 25) } } : null;
  }
  if (kind === "wind") {
    const fields = game.board.hexes.filter((hex) => ["wood", "grain"].includes(hex.resource) && hex.id !== game.robberHex && pointInAmbientBounds(hex, bounds, 35));
    const first = choose(fields, random); if (!first) return null;
    const next = choose(fields.filter((hex) => hex.id !== first.id), random);
    return { windFields: [first.id, ...(next ? [next.id] : [])] };
  }
  const coast = choose(game.board.edges.filter((edge) => edge.hexes.length === 1 && pointInAmbientBounds(harborAmbientPoint(game.board, edge.id), bounds, 20)), random);
  if (!coast) return null;
  const center = harborAmbientPoint(game.board, coast.id); const radius = Math.hypot(center.x, center.y) || 1;
  const tangent = { x: -center.y / radius, y: center.x / radius };
  const path = [
    { x: center.x - tangent.x * 27, y: center.y - tangent.y * 27 },
    { x: center.x - tangent.x * 12 + center.x / radius * 12, y: center.y - tangent.y * 12 + center.y / radius * 12 },
    { x: center.x + tangent.x * 12 + center.x / radius * 12, y: center.y + tangent.y * 12 + center.y / radius * 12 },
    { x: center.x + tangent.x * 27, y: center.y + tangent.y * 27 },
  ];
  return path.every((point) => pointInAmbientBounds(point, bounds, 12)) ? { path } : null;
}

export type AmbientScheduleState = { available: boolean; blocked: boolean; mobile: boolean };
/** Public board changes can invalidate a decorative route while it is running. */
export function ambientSceneValid(scene: AmbientScene, game: AmbientGame, cleanPasture = true) {
  if (scene.kind === "sheep") return cleanPasture && scene.hexId !== game.robberHex && game.board.hexes[scene.hexId!]?.resource === "wool";
  if (scene.kind === "wind") return Boolean(scene.windFields?.every((id) => id !== game.robberHex && ["wood", "grain"].includes(game.board.hexes[id]?.resource)));
  if (scene.kind === "pedestrian") {
    const edges = scene.roadEdges?.map((id) => game.board.edges[id]);
    const owner = edges?.[0]?.owner;
    return Boolean(owner && edges?.every((edge) => edge?.owner === owner && [edge.a, edge.b].every((id) => !game.board.vertices[id].owner || game.board.vertices[id].owner === owner)));
  }
  return true;
}
/** One deadline queue for every transient; inactive time is never replayed. */
export class AmbientSchedule {
  private deadlines = new Map<AmbientKind, number>();
  private scenes: AmbientScene[] = [];
  private counter = 0;
  private available = false;
  private disposed = false;
  constructor(private random: () => number = Math.random) {}
  prune(keep: (scene: AmbientScene) => boolean) { this.scenes = this.scenes.filter(keep); }
  private delay(kind: AmbientKind) { const [min, max] = AMBIENT_INTERVALS[kind]; return lerp(min, max, this.random()); }
  reset(now: number) { this.scenes = []; this.deadlines = new Map(KINDS.map((kind) => [kind, now + this.delay(kind)])); }
  tick(now: number, state: AmbientScheduleState, create: (kind: AmbientKind) => ReturnType<typeof createAmbientScene>): AmbientScene[] {
    if (this.disposed) return [];
    if (!state.available) { this.available = false; this.scenes = []; this.deadlines.clear(); return []; }
    if (!this.available) { this.available = true; this.reset(now); }
    this.scenes = this.scenes.filter((scene) => scene.startedAt + scene.duration > now);
    const cap = state.mobile ? 2 : 3;
    // A resize keeps the oldest scenes and the independent two-patch breeze.
    this.scenes = this.scenes.filter((scene, index, scenes) => scene.kind === "wind" || scenes.slice(0, index + 1).filter((item) => item.kind !== "wind").length <= cap);
    if (state.blocked) {
      for (const [kind, deadline] of this.deadlines) if (deadline <= now) this.deadlines.set(kind, now + 2000);
      return [...this.scenes];
    }
    const due = [...this.deadlines].filter(([, deadline]) => deadline <= now).sort((a, b) => a[1] - b[1]);
    for (const [kind] of due) {
      const allowed = kind === "wind" ? !this.scenes.some((scene) => scene.kind === "wind") : this.scenes.filter((scene) => scene.kind !== "wind").length < cap;
      if (!allowed || this.scenes.some((scene) => scene.kind === kind)) { this.deadlines.set(kind, now + 2000); continue; }
      const details = create(kind);
      this.deadlines.set(kind, now + (details ? this.delay(kind) : 10_000));
      if (details) this.scenes.push({ ...details, id: `ambient-${++this.counter}`, kind, startedAt: now, duration: AMBIENT_DURATIONS[kind] });
    }
    return [...this.scenes];
  }
  /** Render fixtures may request one immediate scene; production has no trigger UI. */
  preview(kind: AmbientKind, now: number, state: AmbientScheduleState, create: (kind: AmbientKind) => ReturnType<typeof createAmbientScene>): AmbientScene[] {
    if (this.disposed || !state.available || state.blocked) return [...this.scenes];
    const details = create(kind);
    if (!details) return [...this.scenes];
    this.scenes = [{ ...details, id: `ambient-preview-${++this.counter}`, kind, startedAt: now, duration: AMBIENT_DURATIONS[kind] }];
    return [...this.scenes];
  }
  get running() { return this.available && !this.disposed; }
  dispose() { this.disposed = true; this.available = false; this.scenes = []; this.deadlines.clear(); }
}
