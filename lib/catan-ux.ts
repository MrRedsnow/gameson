import { COSTS, RESOURCE_INFO, RESOURCES, legalCities, legalRoads, legalSettlements, type CatanView, type Resources } from "./catan";

export type BuildKind = keyof typeof COSTS;

export function missingResources(resources: Resources, cost: Partial<Resources>): string | undefined {
  const missing = RESOURCES.filter((r) => resources[r] < (cost[r] ?? 0));
  return missing.length ? `Dir fehlen ${missing.map((r) => `${(cost[r] ?? 0) - resources[r]} ${RESOURCE_INFO[r].label}`).join(", ")}.` : undefined;
}

/** The reason is shared by the build cards and the choice of the next useful screen. */
export function buildUnavailable(game: CatanView, kind: BuildKind): string | undefined {
  const me = game.me!;
  if (game.phase === "finished") return "Die Partie ist beendet.";
  if (game.players[game.currentPlayer].id !== me.id) return "Du kannst in deinem eigenen Zug bauen.";
  if (game.phase === "roll") return "Würfle zuerst.";
  if (game.phase !== "main") return "Schließe zuerst deine aktuelle Aufgabe ab.";
  const pieces = game.players.find((p) => p.id === me.id)!.pieces;
  if (kind === "development" && !game.deckCount) return "Der Kartenstapel ist leer.";
  if (kind !== "development" && pieces[kind] >= { road: 15, settlement: 5, city: 4 }[kind]) return `Keine ${kind === "road" ? "Straßen" : kind === "city" ? "Städte" : "Siedlungen"} mehr im Vorrat.`;
  const missing = missingResources(me.resources, COSTS[kind]);
  if (missing) return missing;
  const positions = kind === "road" ? legalRoads(game, me.id) : kind === "settlement" ? legalSettlements(game, me.id) : kind === "city" ? legalCities(game, me.id) : null;
  if (positions && !positions.length) return kind === "city" ? "Du brauchst eine eigene Siedlung zum Ausbauen." : "Kein gültiger Bauplatz. Erweitere zuerst dein Straßennetz.";
}

export function hasBuildOption(game: CatanView) {
  return (Object.keys(COSTS) as BuildKind[]).some((kind) => !buildUnavailable(game, kind));
}

export function buildingPreview(game: CatanView, kind: "road" | "settlement" | "city" | "robber", id: number) {
  const hexIds = kind === "robber" ? [id] : kind === "road" ? game.board.edges[id].hexes : game.board.vertices[id].hexes;
  const fields = hexIds.map((hexId) => game.board.hexes[hexId]).filter((hex) => hex.resource !== "desert").map((hex) => ({
    id: hex.id, resource: hex.resource as keyof Resources, number: hex.number!, blocked: hex.id === game.robberHex,
    combinations: 6 - Math.abs(7 - hex.number!),
  }));
  const harbor = kind === "settlement" || kind === "city" ? game.board.harbors.find((h) => {
    const edge = game.board.edges[h.edge]; return edge.a === id || edge.b === id;
  }) : undefined;
  const port = harbor ? harbor.resource === "any" ? "Hafen: alle Rohstoffe 3:1." : `${RESOURCE_INFO[harbor.resource].label}-Hafen: 2:1.` : "";
  const hint = kind === "road" ? "Eine Straße erschließt Bauplätze; sie liefert selbst keine Rohstoffe."
    : kind === "robber" ? "Dieses Feld liefert keinen Ertrag, solange der Räuber hier steht."
    : `Bei jeder passenden Zahl: ${kind === "city" ? "2" : "1"} Rohstoff${kind === "city" ? "e" : ""} pro Feld.${game.phase === "setup_settlement" && game.setupIndex >= game.players.length ? " Startrohstoffe sofort." : ""}`;
  return { fields, port, hint };
}
