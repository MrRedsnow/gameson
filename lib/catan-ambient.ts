import type { Board, CatanView } from "./catan";
import { pointInPolygon, segmentDistance, type AmbientPoint } from "./catan-geometry";
import { HARBOR_BOAT_CLEARANCE, harborLayout } from "./catan-harbor";

export { pointInPolygon, segmentDistance, type AmbientPoint } from "./catan-geometry";
export type AmbientBounds = AmbientPoint & { width: number; height: number };
export type WildlifeKind = "ore_wildlife" | "clay_wildlife" | "grain_wildlife" | "forest_wildlife";
export type AmbientKind = "gull" | "forest_bird" | "butterfly" | "dolphin" | "sheep" | "pedestrian" | "smoke" | "wind" | WildlifeKind;
export type WildlifeSpecies = "deer" | "stag" | "fox" | "boar" | "salamander" | "toad" | "newt" | "hare" | "field_mouse" | "pheasant" | "squirrel" | "badger" | "hedgehog";
export type AmbientGame = Pick<CatanView, "id" | "board" | "robberHex">;
export type AmbientScene = {
  id: string; kind: AmbientKind; startedAt: number; duration: number;
  point?: AmbientPoint; path?: AmbientPoint[]; pathKind?: "bezier" | "polyline"; hexId?: number; sheepIndex?: number;
  roadEdges?: number[]; windFields?: number[]; wildlifeSpecies?: WildlifeSpecies;
};

export const AMBIENT_INTERVALS: Record<AmbientKind, readonly [number, number]> = {
  gull: [10_000, 18_000], forest_bird: [12_000, 24_000], butterfly: [12_000, 24_000],
  dolphin: [18_000, 32_000], sheep: [6_000, 12_000], pedestrian: [8000, 14_000],
  smoke: [6000, 10_000], wind: [16_000, 28_000],
  ore_wildlife: [16_000, 28_000], clay_wildlife: [16_000, 28_000],
  grain_wildlife: [16_000, 28_000], forest_wildlife: [16_000, 28_000],
};
export const AMBIENT_FIRST_INTERVALS: Record<AmbientKind, readonly [number, number]> = {
  gull: [2000, 4000], forest_bird: [5000, 8000], butterfly: [6000, 10_000],
  dolphin: [7000, 12_000], sheep: [1000, 3000], pedestrian: [1000, 2000],
  smoke: [3000, 5000], wind: [8000, 12_000],
  ore_wildlife: [6000, 12_000], clay_wildlife: [6000, 12_000],
  grain_wildlife: [6000, 12_000], forest_wildlife: [6000, 12_000],
};
const KINDS = Object.keys(AMBIENT_INTERVALS) as AmbientKind[];
export const AMBIENT_DURATIONS: Record<AmbientKind, number> = {
  gull: 10_000, forest_bird: 7000, butterfly: 6500, dolphin: 8000,
  sheep: 6000, pedestrian: 8500, smoke: 4500, wind: 8500,
  ore_wildlife: 8000, clay_wildlife: 7500,
  grain_wildlife: 7500, forest_wildlife: 8000,
};
/** Geometry protects the full square atlas cell, including both walking poses. */
export const AMBIENT_WILDLIFE_BOB = .6;
export const AMBIENT_WILDLIFE_SPRITES: Record<WildlifeSpecies, { atlas: "wildlife" | "field-forest"; cells: readonly [number, number]; size: number; viewBoxes?: readonly [string, string] }> = {
  deer: { atlas: "wildlife", cells: [0, 1], size: 26 }, stag: { atlas: "wildlife", cells: [2, 3], size: 26 },
  fox: { atlas: "wildlife", cells: [4, 5], size: 24 }, boar: { atlas: "wildlife", cells: [6, 7], size: 24 },
  salamander: { atlas: "wildlife", cells: [8, 9], size: 24 }, toad: { atlas: "wildlife", cells: [10, 11], size: 22 }, newt: { atlas: "wildlife", cells: [12, 13], size: 24 },
  hare: { atlas: "field-forest", cells: [0, 1], size: 24 }, field_mouse: { atlas: "field-forest", cells: [2, 3], size: 22 },
  pheasant: { atlas: "field-forest", cells: [4, 5], size: 26 }, squirrel: { atlas: "field-forest", cells: [6, 7], size: 24 },
  // The badger's nose slightly exceeds the regular cell; matched square crops
  // include both complete poses without admitting the neighboring sprites.
  badger: { atlas: "field-forest", cells: [8, 9], size: 24, viewBoxes: ["0 198 104 104", "102 198 104 104"] }, hedgehog: { atlas: "field-forest", cells: [10, 11], size: 22 },
};
const WILDLIFE_TERRAINS: Record<WildlifeKind, { resource: Board["hexes"][number]["resource"]; species: readonly WildlifeSpecies[] }> = {
  ore_wildlife: { resource: "ore", species: ["deer", "stag", "fox", "boar"] },
  clay_wildlife: { resource: "brick", species: ["salamander", "toad", "newt"] },
  grain_wildlife: { resource: "grain", species: ["hare", "field_mouse", "pheasant"] },
  forest_wildlife: { resource: "wood", species: ["squirrel", "badger", "hedgehog"] },
};
export function isAmbientWildlifeKind(kind: AmbientKind): kind is WildlifeKind { return Object.hasOwn(WILDLIFE_TERRAINS, kind); }
export const AMBIENT_DOLPHIN_SIZE = 40;
// Sprite corner radius, the sea mask's 11-unit coast exclusion and rounding reserve.
export const AMBIENT_DOLPHIN_CLEARANCE = Math.ceil(Math.hypot(AMBIENT_DOLPHIN_SIZE / 2, AMBIENT_DOLPHIN_SIZE * .72)) + 12;
export const AMBIENT_DOLPHIN_JUMP = 10;
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
export function harborAmbientPoint(board: Board, edgeId: number) {
  const edge = board.edges[edgeId]; const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
  return { x: (a.x + b.x) / 2 * 1.29, y: (a.y + b.y) / 2 * 1.29 };
}
/** Keep rendered sea masks and dolphin geometry aligned with both harbor layers. */
export function ambientHarborExclusions(board: Board) {
  return board.harbors.flatMap((harbor) => [
    { point: harborAmbientPoint(board, harbor.edge), radius: 36, edgeId: harbor.edge, kind: "label" as const },
    { point: harborLayout(board, harbor.edge).boat, radius: Math.max(36, HARBOR_BOAT_CLEARANCE), edgeId: harbor.edge, kind: "boat" as const },
  ]);
}
export function ambientSeaPoint(board: Board, bounds: AmbientBounds, point: AmbientPoint, padding = 15) {
  if (!pointInAmbientBounds(point, bounds, padding)) return false;
  for (const hex of board.hexes) if (pointInPolygon(point, hex.vertices.map((id) => board.vertices[id]))) return false;
  for (const edge of board.edges) if (edge.hexes.length === 1 && segmentDistance(point, board.vertices[edge.a], board.vertices[edge.b]) < padding) return false;
  return ambientHarborExclusions(board).every((harbor) => distance(point, harbor.point) >= padding + harbor.radius);
}

export function ambientPathPoint(points: readonly AmbientPoint[], t: number, pathKind: AmbientScene["pathKind"] = points.length === 4 ? "bezier" : "polyline"): AmbientPoint {
  const p = Math.max(0, Math.min(1, t));
  if (points.length === 4 && pathKind === "bezier") {
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
export function ambientPath(points: readonly AmbientPoint[], pathKind: AmbientScene["pathKind"] = points.length === 4 ? "bezier" : "polyline") {
  if (!points.length) return "";
  const pair = (point: AmbientPoint) => `${point.x.toFixed(3)} ${point.y.toFixed(3)}`;
  return `M${pair(points[0])}${points.length === 4 && pathKind === "bezier" ? `C${points.slice(1).map(pair).join(" ")}` : points.slice(1).map((point) => `L${pair(point)}`).join("")}`;
}
export function ambientPolylineLength(points: readonly AmbientPoint[]) { return points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0); }
export const AMBIENT_WALK_SPEED = 20;
export const AMBIENT_WALK_REST = 1200;
export function ambientSceneDuration(kind: AmbientKind, details: Pick<AmbientScene, "path">) {
  // Even a single starting road gives a villager enough time to be noticed.
  return kind === "pedestrian" && details.path ? Math.max(7000, Math.round(ambientPolylineLength(details.path) / AMBIENT_WALK_SPEED * 1000) + AMBIENT_WALK_REST) : AMBIENT_DURATIONS[kind];
}

function segmentHitsRectangle(a: AmbientPoint, b: AmbientPoint, bounds: AmbientBounds) {
  let lower = 0; let upper = 1; const dx = b.x - a.x; const dy = b.y - a.y;
  if (Math.abs(dx) < 1e-9) { if (a.x < bounds.x || a.x > bounds.x + bounds.width) return false; }
  else {
    const first = (bounds.x - a.x) / dx; const second = (bounds.x + bounds.width - a.x) / dx;
    lower = Math.max(lower, Math.min(first, second)); upper = Math.min(upper, Math.max(first, second));
    if (lower > upper) return false;
  }
  if (Math.abs(dy) < 1e-9) { if (a.y < bounds.y || a.y > bounds.y + bounds.height) return false; }
  else {
    const first = (bounds.y - a.y) / dy; const second = (bounds.y + bounds.height - a.y) / dy;
    lower = Math.max(lower, Math.min(first, second)); upper = Math.min(upper, Math.max(first, second));
    if (lower > upper) return false;
  }
  return true;
}
type DolphinGeometry = {
  coast: { a: AmbientPoint; b: AmbientPoint }[]; harbors: ReturnType<typeof ambientHarborExclusions>;
  land: { bounds: AmbientBounds; polygon: AmbientPoint[] }[];
};
function publicBoardGeometryKey(board: Board) {
  return `${board.vertices.map((vertex) => `${vertex.x},${vertex.y}`).join(";")}|${board.hexes.map((hex) => `${hex.x},${hex.y}:${hex.vertices.join(",")}`).join(";")}|${board.edges.filter((edge) => edge.hexes.length === 1).map((edge) => `${edge.a},${edge.b},${edge.hexes[0]}`).join(";")}|${board.harbors.map((harbor) => harbor.edge).join(",")}`;
}
const dolphinGeometryCache = new Map<string, DolphinGeometry>();
function dolphinGeometry(board: Board): DolphinGeometry {
  const key = publicBoardGeometryKey(board); const saved = dolphinGeometryCache.get(key); if (saved) return saved;
  const geometry = {
    coast: board.edges.filter((edge) => edge.hexes.length === 1).map((edge) => ({ a: { x: board.vertices[edge.a].x, y: board.vertices[edge.a].y }, b: { x: board.vertices[edge.b].x, y: board.vertices[edge.b].y } })),
    harbors: ambientHarborExclusions(board),
    land: board.hexes.map((hex) => {
      const polygon = hex.vertices.map((id) => ({ x: board.vertices[id].x, y: board.vertices[id].y }));
      const x = Math.min(...polygon.map((point) => point.x)); const y = Math.min(...polygon.map((point) => point.y));
      return { polygon, bounds: { x, y, width: Math.max(...polygon.map((point) => point.x)) - x, height: Math.max(...polygon.map((point) => point.y)) - y } };
    }),
  };
  if (dolphinGeometryCache.size >= 12) dolphinGeometryCache.delete(dolphinGeometryCache.keys().next().value!);
  dolphinGeometryCache.set(key, geometry); return geometry;
}
function dolphinPosition(geometry: DolphinGeometry, bounds: AmbientBounds, point: AmbientPoint) {
  const sprite = { x: point.x - AMBIENT_DOLPHIN_SIZE / 2, y: point.y - AMBIENT_DOLPHIN_SIZE * .72, width: AMBIENT_DOLPHIN_SIZE, height: AMBIENT_DOLPHIN_SIZE };
  if (!pointInAmbientBounds(sprite, bounds, 1) || !pointInAmbientBounds({ x: sprite.x + sprite.width, y: sprite.y + sprite.height }, bounds, 1)) return false;
  // The expanded rectangle excludes the painted sea mask's 11-unit coastal
  // band plus a reserve; slab intersection checks the entire edge, not corners.
  const coastGuard = { x: sprite.x - 12, y: sprite.y - 12, width: sprite.width + 24, height: sprite.height + 24 };
  const clearsHarbors = geometry.harbors.every((harbor) => {
    const harborPoint = harbor.point;
    const dx = Math.max(sprite.x - harborPoint.x, 0, harborPoint.x - sprite.x - sprite.width);
    const dy = Math.max(sprite.y - harborPoint.y, 0, harborPoint.y - sprite.y - sprite.height);
    return Math.hypot(dx, dy) >= harbor.radius + 1;
  });
  if (!clearsHarbors) return false;
  for (const edge of geometry.coast) if (segmentHitsRectangle(edge.a, edge.b, coastGuard)) return false;
  for (const hex of geometry.land) if (pointInAmbientBounds(point, hex.bounds) && pointInPolygon(point, hex.polygon)) return false;
  return true;
}
/** Full axis-aligned sprite rectangle; its horizontal mirror has identical bounds. */
export function ambientDolphinPosition(board: Board, bounds: AmbientBounds, point: AmbientPoint) { return dolphinPosition(dolphinGeometry(board), bounds, point); }
/** Sample the complete sprite and airborne arc more finely than the clearance reserve. */
export function validDolphinPath(board: Board, bounds: AmbientBounds, points: readonly AmbientPoint[]) {
  return dolphinPathClear(dolphinGeometry(board), bounds, points);
}
function dolphinPathClear(geometry: DolphinGeometry, bounds: AmbientBounds, points: readonly AmbientPoint[]) {
  if (points.length !== 4 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
  const polygonLength = points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0);
  const steps = Math.max(80, Math.ceil((polygonLength * 3 + Math.PI * AMBIENT_DOLPHIN_JUMP) / 1.5));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps; const point = ambientPathPoint(points, t);
    if (!dolphinPosition(geometry, bounds, point) || !dolphinPosition(geometry, bounds, { ...point, y: point.y - Math.sin(t * Math.PI) * AMBIENT_DOLPHIN_JUMP })) return false;
  }
  return true;
}
// Transport snapshots recreate Board objects. Cache by public geometry rather
// than identity, excluding owners/resources so ordinary turns keep the pool.
const dolphinRouteCache = new Map<string, AmbientPoint[][]>();
function dolphinRoutes(board: Board, bounds: AmbientBounds): AmbientPoint[][] {
  const geometry = publicBoardGeometryKey(board);
  const key = `${geometry}|${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`;
  const saved = dolphinRouteCache.get(key); if (saved) return saved;
  const coast = board.edges.filter((edge) => edge.hexes.length === 1);
  const prepared = dolphinGeometry(board);
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
  const routes: AmbientPoint[][] = [];
  for (const edge of coast) {
    let found: AmbientPoint[] | undefined;
    for (const offset of [52, 58, 64, 70, 76, 82, 88, 94, 100, 106, 112, 118, 124, 130, 136]) {
      for (const length of [42, 54, 30]) {
        const points = candidate(edge, offset, length);
        if (dolphinPathClear(prepared, bounds, points)) { found = points; break; }
      }
      if (found) break;
    }
    if (found) routes.push(found);
  }
  if (dolphinRouteCache.size >= 12) dolphinRouteCache.delete(dolphinRouteCache.keys().next().value!);
  dolphinRouteCache.set(key, routes); return routes;
}
function dolphinPath(board: Board, bounds: AmbientBounds, random: () => number): AmbientPoint[] | null {
  // Choose a compass sector first, then a valid coast route. Narrow harbor gaps
  // cannot bias every fallback to the first coast edge or one repeated corner.
  const sectors = new Map<number, AmbientPoint[][]>();
  for (const path of dolphinRoutes(board, bounds)) {
    const midpoint = ambientPathPoint(path, .5); const angle = Math.atan2(midpoint.y, midpoint.x);
    const sector = Math.floor(((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4));
    const paths = sectors.get(sector) ?? []; paths.push(path); sectors.set(sector, paths);
  }
  const group = choose([...sectors.values()], random); const route = group && choose(group, random);
  if (!route) return null;
  const result = route.map((point) => ({ ...point })); return random() < .5 ? result.reverse() : result;
}

export function ambientSheep(board: Board) {
  const offsets = [{ x: -23, y: -17 }, { x: 23, y: -19 }, { x: -23, y: 20 }, { x: 23, y: 21 }];
  return board.hexes.filter((hex) => hex.resource === "wool").flatMap((hex) => offsets.map((offset, index) => ({
    hexId: hex.id, sheepIndex: index, point: { x: hex.x + offset.x * (hex.id % 2 ? -1 : 1), y: hex.y + offset.y },
  })));
}
function wildlifeRectangle(point: AmbientPoint, size: number): AmbientBounds {
  return { x: point.x - size / 2, y: point.y - size * .72 - AMBIENT_WILDLIFE_BOB, width: size, height: size + AMBIENT_WILDLIFE_BOB };
}
function wildlifeRectangleClear(board: Board, hex: Board["hexes"][number], bounds: AmbientBounds, rectangle: AmbientBounds) {
  const polygon = hex.vertices.map((id) => board.vertices[id]);
  const corners = [
    { x: rectangle.x, y: rectangle.y }, { x: rectangle.x + rectangle.width, y: rectangle.y },
    { x: rectangle.x, y: rectangle.y + rectangle.height }, { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height },
  ];
  if (!corners.every((point) => pointInAmbientBounds(point, bounds, 1) && pointInPolygon(point, polygon) && polygon.every((a, index) => segmentDistance(point, a, polygon[(index + 1) % polygon.length]) >= .75))) return false;
  // Protect the complete number disc, including when its centre meets the
  // middle of a sprite edge while all four sprite corners miss the disc.
  const dx = Math.max(rectangle.x - hex.x, 0, hex.x - rectangle.x - rectangle.width);
  const dy = Math.max(rectangle.y - hex.y, 0, hex.y - rectangle.y - rectangle.height);
  return Math.hypot(dx, dy) >= 18.75 - 1e-7;
}
function wildlifeRoute(kind: WildlifeKind, game: AmbientGame, bounds: AmbientBounds, random: () => number) {
  const { resource, species } = WILDLIFE_TERRAINS[kind];
  const wildlifeSpecies = choose(species, random)!;
  const size = AMBIENT_WILDLIFE_SPRITES[wildlifeSpecies].size;
  const fields = game.board.hexes.filter((hex) => hex.resource === resource && hex.id !== game.robberHex);
  const paths: { hexId: number; path: AmbientPoint[] }[] = [];
  for (const hex of fields) {
    const tracks = [
      { x: -(18.75 + size / 2), y: size * .22 + AMBIENT_WILDLIFE_BOB / 2, vertical: true },
      { x: 18.75 + size / 2, y: size * .22 + AMBIENT_WILDLIFE_BOB / 2, vertical: true },
      { x: 0, y: -18.75 - size * .28, vertical: false },
      { x: 0, y: 18.75 + size * .72 + AMBIENT_WILDLIFE_BOB, vertical: false },
    ];
    for (const track of tracks) for (const travel of [18, 16, 14, 12]) {
      const start = { x: hex.x + track.x - (track.vertical ? 0 : travel / 2), y: hex.y + track.y - (track.vertical ? travel / 2 : 0) };
      const end = { x: start.x + (track.vertical ? 0 : travel), y: start.y + (track.vertical ? travel : 0) };
      const sprite = wildlifeRectangle(start, size);
      const swept = { ...sprite, width: sprite.width + (track.vertical ? 0 : travel), height: sprite.height + (track.vertical ? travel : 0) };
      // Convex hexes contain the full swept rectangle, rather than merely
      // sampled path centres. The mirror and both atlas poses share this box.
      if (!wildlifeRectangleClear(game.board, hex, bounds, swept)) continue;
      paths.push({ hexId: hex.id, path: [start, end, { ...start }] });
      break;
    }
  }
  const hexId = choose([...new Set(paths.map((route) => route.hexId))], random);
  const route = choose(paths.filter((item) => item.hexId === hexId), random);
  if (!route) return null;
  const path = route.path.map((point) => ({ ...point }));
  if (random() < .5) { const end = path[1]; path[1] = path[0]; path[0] = end; path[2] = { ...end }; }
  return { hexId: route.hexId, wildlifeSpecies, pathKind: "polyline" as const, path };
}
function terrainRoute(game: AmbientGame, bounds: AmbientBounds, resources: string[], random: () => number) {
  const fields = game.board.hexes.filter((hex) => resources.includes(hex.resource) && hex.id !== game.robberHex && pointInAmbientBounds(hex, bounds, 35));
  const hex = choose(fields, random); if (!hex) return null;
  const side = random() < .5 ? -1 : 1;
  const destination = resources.includes("wood") ? choose(fields.filter((other) => other.id !== hex.id && distance(hex, other) <= 190), random) : undefined;
  if (destination) {
    const start = { x: hex.x - 23 * side, y: hex.y - 16 }; const end = { x: destination.x + 23 * side, y: destination.y - 16 };
    return { hexId: hex.id, pathKind: "bezier" as const, path: [start, { x: lerp(start.x, end.x, .32), y: lerp(start.y, end.y, .32) - 22 }, { x: lerp(start.x, end.x, .68), y: lerp(start.y, end.y, .68) - 22 }, end] };
  }
  return { hexId: hex.id, pathKind: "bezier" as const, path: [
    { x: hex.x - 27 * side, y: hex.y - 18 }, { x: hex.x - 18 * side, y: hex.y - 39 },
    { x: hex.x + 22 * side, y: hex.y - 33 }, { x: hex.x + 29 * side, y: hex.y - 17 },
  ] };
}
export function ambientRoadRoute(board: Board, bounds: AmbientBounds, random: () => number) {
  const roads = board.edges.filter((edge) => edge.owner && [edge.a, edge.b].every((id) => !board.vertices[id].owner || board.vertices[id].owner === edge.owner));
  const remaining = new Set(roads.map((edge) => edge.id));
  const components: typeof roads[] = [];
  while (remaining.size) {
    const first = roads.find((edge) => remaining.has(edge.id))!; const component = [first]; remaining.delete(first.id);
    for (const edge of component) for (const next of roads) {
      if (remaining.has(next.id) && next.owner === first.owner && [edge.a, edge.b].some((id) => next.a === id || next.b === id)) { component.push(next); remaining.delete(next.id); }
    }
    if (component.some((edge) => [edge.a, edge.b].some((id) => pointInAmbientBounds(board.vertices[id], bounds, 12)))) components.push(component);
  }
  const owner = choose([...new Set(components.map((component) => component[0].owner))], random);
  const networks = components.filter((component) => component[0].owner === owner);
  const longest = Math.max(0, ...networks.map((component) => component.length));
  const network = choose(networks.filter((component) => component.length === longest), random); if (!network) return null;
  const vertices = [...new Set(network.flatMap((edge) => [edge.a, edge.b]))];
  const ownsBuilding = (id: number) => board.vertices[id].owner === owner && Boolean(board.vertices[id].building);
  const ends = vertices.filter((id) => network.filter((edge) => edge.a === id || edge.b === id).length === 1);
  const visibleEnds = ends.filter((id) => pointInAmbientBounds(board.vertices[id], bounds, 12));
  const ownEnds = ends.filter(ownsBuilding); const visibleOwnEnds = visibleEnds.filter(ownsBuilding);
  const homes = vertices.filter(ownsBuilding); const visibleHomes = homes.filter((id) => pointInAmbientBounds(board.vertices[id], bounds, 12));
  const visibleVertices = vertices.filter((id) => pointInAmbientBounds(board.vertices[id], bounds, 12));
  // Beginning at an outer end covers a whole strand without retracing it. Prefer
  // the owner's end house; a loop has no ends, so it can begin at another home.
  const start = choose(visibleOwnEnds.length ? visibleOwnEnds : visibleEnds.length ? visibleEnds : ownEnds.length ? ownEnds : ends.length ? ends : visibleHomes.length ? visibleHomes : homes.length ? homes : visibleVertices.length ? visibleVertices : vertices, random)!;
  const order = [...network];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const visited = new Set<number>(); const roadEdges: number[] = []; const routeVertices = [start];
  function walk(id: number) {
    for (const edge of order.filter((item) => item.a === id || item.b === id)) {
      if (visited.has(edge.id)) continue;
      visited.add(edge.id); const next = edge.a === id ? edge.b : edge.a;
      roadEdges.push(edge.id); routeVertices.push(next); walk(next);
      // Return over the same confirmed road only when another branch remains.
      if (visited.size < network!.length) { roadEdges.push(edge.id); routeVertices.push(id); }
    }
  }
  walk(start);
  // Plan the whole network first. A newly reached own house may be this walk's
  // destination, but unbuilt junctions never shorten a long strand. Evaluate a
  // house only once so branching backtracks cannot repeatedly force a short stop.
  const consideredHomes = new Set([start]); let destination = routeVertices.length - 1;
  for (let index = 1; index < routeVertices.length - 1; index++) {
    const id = routeVertices[index]; if (!ownsBuilding(id) || consideredHomes.has(id)) continue;
    consideredHomes.add(id);
    if (index >= 2 && random() < .25) { destination = index; break; }
  }
  return { roadEdges: roadEdges.slice(0, destination), pathKind: "polyline" as const, path: routeVertices.slice(0, destination + 1).map((id) => ({ x: board.vertices[id].x, y: board.vertices[id].y })) };
}

export function createAmbientScene(kind: AmbientKind, game: AmbientGame, bounds: AmbientBounds, random: () => number): Omit<AmbientScene, "id" | "startedAt" | "duration" | "kind"> | null {
  if (isAmbientWildlifeKind(kind)) return wildlifeRoute(kind, game, bounds, random);
  if (kind === "dolphin") { const path = dolphinPath(game.board, bounds, random); return path ? { path, pathKind: "bezier" } : null; }
  if (kind === "pedestrian") return ambientRoadRoute(game.board, bounds, random);
  if (kind === "butterfly" || kind === "forest_bird") return terrainRoute(game, bounds, kind === "butterfly" ? ["wool", "grain"] : ["wood"], random);
  if (kind === "sheep") {
    const sheep = choose(ambientSheep(game.board).filter((item) => item.hexId !== game.robberHex && pointInAmbientBounds(item.point, bounds, 16)), random);
    if (!sheep) return null;
    const hex = game.board.hexes[sheep.hexId]; const step = 12 + random() * 2;
    const side = sheep.point.x < hex.x ? -1 : 1; const dx = side * (1 + random() * 2);
    const dy = Math.sqrt(step * step - dx * dx) * (sheep.point.y < hex.y ? 1 : -1);
    // Stay alongside the number and return to the resting position without a teleport.
    return { ...sheep, pathKind: "polyline", path: [sheep.point, { x: sheep.point.x + dx, y: sheep.point.y + dy }, sheep.point] };
  }
  if (kind === "smoke") {
    // The atlas chimneys include BuildingPiece's +11-unit structure offset.
    // Reserve the whole rising plume, rather than only the building vertex.
    const chimneys = game.board.vertices.filter((vertex) => vertex.owner && (vertex.building === "settlement" || vertex.building === "city")).map((building) => ({
      point: { x: building.x - (building.building === "city" ? 2 : 4.75), y: building.y - (building.building === "city" ? 30.25 : 18.4) },
    })).filter(({ point }) => pointInAmbientBounds(point, bounds, 26));
    return choose(chimneys, random) ?? null;
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
  return path.every((point) => pointInAmbientBounds(point, bounds, 12)) ? { path, pathKind: "bezier" } : null;
}

export type AmbientScheduleState = { available: boolean; blocked: boolean; mobile: boolean };
/** Public board changes can invalidate a decorative route while it is running. */
export function ambientSceneValid(scene: AmbientScene, game: AmbientGame, cleanPasture = true) {
  if (isAmbientWildlifeKind(scene.kind)) {
    const { resource, species } = WILDLIFE_TERRAINS[scene.kind];
    return Boolean(scene.wildlifeSpecies && species.includes(scene.wildlifeSpecies) && scene.hexId !== game.robberHex && game.board.hexes[scene.hexId!]?.resource === resource);
  }
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
  private delay(kind: AmbientKind, first = false) { const [min, max] = (first ? AMBIENT_FIRST_INTERVALS : AMBIENT_INTERVALS)[kind]; return lerp(min, max, this.random()); }
  reset(now: number) { this.scenes = []; this.deadlines = new Map(KINDS.map((kind) => [kind, now + this.delay(kind, true)])); }
  tick(now: number, state: AmbientScheduleState, create: (kind: AmbientKind) => ReturnType<typeof createAmbientScene>): AmbientScene[] {
    if (this.disposed) return [];
    if (!state.available) { this.available = false; this.scenes = []; this.deadlines.clear(); return []; }
    if (!this.available) { this.available = true; this.reset(now); }
    this.scenes = this.scenes.filter((scene) => scene.startedAt + scene.duration > now);
    const cap = state.mobile ? 2 : 3;
    // A resize keeps the oldest scenes and the independent two-patch breeze.
    this.scenes = this.scenes.filter((scene, index, scenes) => scene.kind === "wind" || scenes.slice(0, index + 1).filter((item) => item.kind !== "wind").length <= cap);
    // An action pauses spawning, without destroying the order of waiting kinds.
    // Hidden/disabled views above still discard the queue completely.
    if (state.blocked) return [...this.scenes];
    const due = [...this.deadlines].filter(([, deadline]) => deadline <= now).sort((a, b) => a[1] - b[1]);
    for (const [kind] of due) {
      const running = this.scenes.find((scene) => scene.kind === kind);
      if (running) {
        // A long walk finishes before another of the same kind is queued.
        this.deadlines.set(kind, running.startedAt + running.duration + this.delay(kind));
        continue;
      }
      const allowed = kind === "wind" ? !this.scenes.some((scene) => scene.kind === "wind") : this.scenes.filter((scene) => scene.kind !== "wind").length < cap;
      // Keep a waiting scene's original deadline. Resetting every waiting kind
      // to the same time let birds repeatedly jump ahead of people and wildlife.
      if (!allowed) continue;
      const details = create(kind);
      this.deadlines.set(kind, now + (details ? this.delay(kind) : 10_000));
      if (details) this.scenes.push({ ...details, id: `ambient-${++this.counter}`, kind, startedAt: now, duration: ambientSceneDuration(kind, details) });
    }
    return [...this.scenes];
  }
  /** Render fixtures may request one immediate scene; production has no trigger UI. */
  preview(kind: AmbientKind, now: number, state: AmbientScheduleState, create: (kind: AmbientKind) => ReturnType<typeof createAmbientScene>): AmbientScene[] {
    if (this.disposed || !state.available || state.blocked) return [...this.scenes];
    const details = create(kind);
    if (!details) return [...this.scenes];
    this.scenes = [{ ...details, id: `ambient-preview-${++this.counter}`, kind, startedAt: now, duration: ambientSceneDuration(kind, details) }];
    return [...this.scenes];
  }
  get running() { return this.available && !this.disposed; }
  dispose() { this.disposed = true; this.available = false; this.scenes = []; this.deadlines.clear(); }
}
