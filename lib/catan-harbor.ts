import type { Board } from "./catan";
import { pointInPolygon, segmentDistance, type AmbientPoint } from "./catan-geometry";

export const HARBOR_BOAT_SIZE = 44;
// Includes all four sprite corners at every +/-5-degree angle, the maximum
// 2.5-unit vertical sway and a reserve beyond the shoreline mask.
export const HARBOR_BOAT_CLEARANCE = Math.ceil(Math.hypot(HARBOR_BOAT_SIZE / 2, HARBOR_BOAT_SIZE / 2) + 2.5 + 1);
export type HarborLayout = {
  coast: AmbientPoint; angle: number; heading: number; boat: AmbientPoint;
  pierAnchor: AmbientPoint; attachment: AmbientPoint;
};
const BOAT_PAINT_CENTERS = [[288, 288.5], [268.5, 277], [242, 281], [274, 235], [282, 221], [248, 220]] as const;
const HARBOR_SWAY_EXTENT = HARBOR_BOAT_SIZE / 2 * (Math.cos(5 * Math.PI / 180) + Math.sin(5 * Math.PI / 180));
const layoutCache = new WeakMap<Board, { geometry: string; layouts: Map<number, HarborLayout> }>();

export function harborBoatClearsLand(board: Board, center: AmbientPoint, clearance = HARBOR_BOAT_CLEARANCE) {
  return board.hexes.every((hex) => {
    const polygon = hex.vertices.map((id) => board.vertices[id]);
    return !pointInPolygon(center, polygon) && polygon.every((point, index) => segmentDistance(center, point, polygon[(index + 1) % polygon.length]) >= clearance);
  });
}

function harborLabelRects(board: Board) {
  return board.harbors.map((harbor) => {
    const edge = board.edges[harbor.edge]; const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
    const x = (a.x + b.x) / 2 * 1.29; const y = (a.y + b.y) / 2 * 1.29;
    return { x: x - 19, y: y - 17, width: 38, height: 34 };
  });
}

function boatClearsLabels(center: AmbientPoint, rectangles: ReturnType<typeof harborLabelRects>) {
  const horizontal = HARBOR_SWAY_EXTENT + 2;
  const vertical = HARBOR_SWAY_EXTENT + 2.5 + 2;
  return rectangles.every((rectangle) => {
    return center.x + horizontal <= rectangle.x || center.x - horizontal >= rectangle.x + rectangle.width ||
      center.y + vertical <= rectangle.y || center.y - vertical >= rectangle.y + rectangle.height;
  });
}

function boatClearsBoats(center: AmbientPoint, occupied: readonly AmbientPoint[]) {
  // These envelopes contain every possible phase independently. A shared
  // timestamp or equal boat periods are never required to keep hulls apart.
  const horizontal = HARBOR_SWAY_EXTENT * 2 + 2;
  const vertical = HARBOR_SWAY_EXTENT * 2 + 4 + 2;
  return occupied.every((other) => Math.abs(center.x - other.x) >= horizontal || Math.abs(center.y - other.y) >= vertical);
}

/** Coast direction chooses a prepainted view; the sprite itself stays world-up. */
function placeHarbor(board: Board, edgeId: number, labels: ReturnType<typeof harborLabelRects>, occupied: readonly AmbientPoint[]): HarborLayout {
  const edge = board.edges[edgeId]; const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
  const coast = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let normal = { x: (b.y - a.y) / length, y: -(b.x - a.x) / length };
  const land = board.hexes[edge.hexes[0]];
  if (normal.x * (coast.x - land.x) + normal.y * (coast.y - land.y) < 0) normal = { x: -normal.x, y: -normal.y };
  const tangent = { x: -normal.y, y: normal.x };
  const angle = Math.atan2(normal.y, normal.x) * 180 / Math.PI;
  const heading = (Math.round(angle / 60) + 6) % 6;
  let boat = { x: coast.x + normal.x * 42 + tangent.x * 38, y: coast.y + normal.y * 42 + tangent.y * 38 };
  const obstaclePoints = [
    ...board.vertices, ...occupied,
    ...labels.flatMap((rectangle) => [{ x: rectangle.x, y: rectangle.y }, { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height }]),
  ];
  const maxOutward = Math.ceil(Math.max(42, ...obstaclePoints.map((point) => Math.hypot(point.x - coast.x, point.y - coast.y))) + HARBOR_BOAT_CLEARANCE * 2);
  // The island has stepped corners. Check every land polygon rather than
  // assuming the selected coast edge is a supporting plane for the whole island.
  // Try small sideways changes before moving farther out to sea, always using
  // the full sway envelope against every plaque and already placed vessel.
  search: for (let outward = 42; outward <= maxOutward + 4; outward += 4) {
    for (let sideways = 38; sideways <= 64; sideways += 2) {
      for (const side of [1, -1]) {
        const candidate = { x: coast.x + normal.x * outward + tangent.x * sideways * side, y: coast.y + normal.y * outward + tangent.y * sideways * side };
        if (boatClearsLabels(candidate, labels) && boatClearsBoats(candidate, occupied) && harborBoatClearsLand(board, candidate)) { boat = candidate; break search; }
      }
    }
  }
  const pierAnchor = { x: coast.x + normal.x * 30 + tangent.x * 8, y: coast.y + normal.y * 30 + tangent.y * 8 };
  const paintCenter = BOAT_PAINT_CENTERS[heading];
  const center = { x: (paintCenter[0] / 512 - .5) * HARBOR_BOAT_SIZE, y: (paintCenter[1] / 512 - .5) * HARBOR_BOAT_SIZE };
  const toward = { x: pierAnchor.x - boat.x - center.x, y: pierAnchor.y - boat.y - center.y };
  const towardLength = Math.hypot(toward.x, toward.y) || 1;
  const attachment = { x: center.x + toward.x / towardLength * 5, y: center.y + toward.y / towardLength * 5 };
  return { coast, angle, heading, boat, pierAnchor, attachment };
}

function sharedHarborLayouts(board: Board) {
  const geometry = `${board.vertices.map((vertex) => `${vertex.x},${vertex.y}`).join(";")}|${board.hexes.map((hex) => `${hex.x},${hex.y}:${hex.vertices.join(",")}`).join(";")}|${board.edges.map((edge) => `${edge.a},${edge.b}:${edge.hexes.join(",")}`).join(";")}|${board.harbors.map((harbor) => harbor.edge).sort((a, b) => a - b).join(",")}`;
  const saved = layoutCache.get(board);
  if (saved?.geometry === geometry) return saved.layouts;
  const labels = harborLabelRects(board);
  const layouts = new Map<number, HarborLayout>(); const occupied: AmbientPoint[] = [];
  // Order is independent of transport/map array ordering and public ownership.
  for (const edgeId of [...new Set(board.harbors.map((harbor) => harbor.edge))].sort((a, b) => a - b)) {
    const layout = placeHarbor(board, edgeId, labels, occupied);
    layouts.set(edgeId, layout); occupied.push(layout.boat);
  }
  layoutCache.set(board, { geometry, layouts });
  return layouts;
}

function copyLayout(layout: HarborLayout): HarborLayout {
  return { ...layout, coast: { ...layout.coast }, boat: { ...layout.boat }, pierAnchor: { ...layout.pierAnchor }, attachment: { ...layout.attachment } };
}

/** All real harbors share one deterministic, mutually collision-free layout. */
export function harborLayouts(board: Board): HarborLayout[] {
  const layouts = sharedHarborLayouts(board);
  return board.harbors.map((harbor) => copyLayout(layouts.get(harbor.edge)!));
}

/** Compatible single-edge API used by board bounds, rendering and dolphin guards. */
export function harborLayout(board: Board, edgeId: number): HarborLayout {
  const layouts = sharedHarborLayouts(board);
  const layout = layouts.get(edgeId);
  // Non-harbor coast edges remain useful for geometry QA and do not reserve
  // phantom boats or influence the actual island decoration.
  return layout ? copyLayout(layout) : placeHarbor(board, edgeId, harborLabelRects(board), []);
}

export function harborMooringPath(layout: HarborLayout, progress: number | null = null) {
  const angle = (progress === null ? 0 : -5 + 10 * progress) * Math.PI / 180;
  const lift = progress === null ? 0 : -1.5 + 4 * progress;
  const end = {
    x: layout.boat.x + layout.attachment.x * Math.cos(angle) - layout.attachment.y * Math.sin(angle),
    y: layout.boat.y + layout.attachment.x * Math.sin(angle) + layout.attachment.y * Math.cos(angle) + lift,
  };
  const anchor = layout.pierAnchor;
  const control = { x: (anchor.x + end.x) / 2, y: (anchor.y + end.y) / 2 + 4 };
  return `M${anchor.x.toFixed(4)} ${anchor.y.toFixed(4)}Q${control.x.toFixed(4)} ${control.y.toFixed(4)} ${end.x.toFixed(4)} ${end.y.toFixed(4)}`;
}
