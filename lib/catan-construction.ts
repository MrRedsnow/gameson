import type { CatanView } from "./catan";

export const CONSTRUCTION_ROAD_MS = 700;
export const CONSTRUCTION_BUILDING_MS = 750;
export const CONSTRUCTION_HANDOFF_MS = 800;

export type ConstructionSnapshot = Pick<CatanView, "id" | "sequence" | "board">;
export type ConstructionEvent = { id: string; kind: "road" | "settlement" | "city"; position: number; ownerId: string };
export type ConstructionBatch = { id: string; events: ConstructionEvent[] };

/** Public, confirmed board differences work for every owner, including remote players. */
export function constructionBatch(previous: ConstructionSnapshot | null, current: ConstructionSnapshot): ConstructionBatch | null {
  if (!previous || previous.id !== current.id || current.sequence <= previous.sequence) return null;
  const id = `${current.id}:${previous.sequence}:${current.sequence}`;
  const events: ConstructionEvent[] = [];
  const oldEdges = new Map(previous.board.edges.map((edge) => [edge.id, edge]));
  const oldVertices = new Map(previous.board.vertices.map((vertex) => [vertex.id, vertex]));
  for (const edge of current.board.edges) {
    const before = oldEdges.get(edge.id);
    if (before && !before.owner && edge.owner) events.push({ id: `${id}:road:${edge.id}`, kind: "road", position: edge.id, ownerId: edge.owner });
  }
  for (const vertex of current.board.vertices) {
    const before = oldVertices.get(vertex.id);
    if (!before || !vertex.owner || !vertex.building) continue;
    const newlyBuilt = !before.owner && !before.building;
    const upgraded = before.owner === vertex.owner && before.building === "settlement" && vertex.building === "city";
    if (newlyBuilt || upgraded) events.push({ id: `${id}:${vertex.building}:${vertex.id}`, kind: vertex.building, position: vertex.id, ownerId: vertex.owner });
  }
  return events.length ? { id, events } : null;
}
