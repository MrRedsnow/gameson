import type { Board } from "./catan";

/** Join each exposed edge once, so translucent coastal strokes meet without overlaps. */
export function coastlinePath({ vertices, edges }: Pick<Board, "vertices" | "edges">) {
  const coast = edges.filter((edge) => edge.hexes.length === 1);
  const remaining = new Set(coast.map((edge) => edge.id));
  const adjacent = new Map<number, typeof coast>();
  for (const edge of coast) for (const vertex of [edge.a, edge.b]) {
    const connected = adjacent.get(vertex) ?? [];
    connected.push(edge);
    adjacent.set(vertex, connected);
  }
  const contours: string[] = [];
  for (const first of coast) {
    if (!remaining.has(first.id)) continue;
    const start = first.a;
    let current = first.b;
    const points = [vertices[start]];
    remaining.delete(first.id);
    while (current !== start) {
      points.push(vertices[current]);
      const next = adjacent.get(current)?.find((edge) => remaining.has(edge.id));
      // Invalid/open contours should not acquire a synthetic diagonal shoreline.
      if (!next) return "";
      remaining.delete(next.id);
      current = next.a === current ? next.b : next.a;
    }
    contours.push(`M${points.map(({ x, y }) => `${x},${y}`).join("L")}Z`);
  }
  return contours.join(" ");
}
