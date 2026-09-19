/** Rules engine shared by the authoritative online game and device-local play.
 * Reference: CATAN base rules & almanac (2020), including combined trade/build.
 * Gameson house rule: selectable victory target, default 12 instead of 10.
 */
export const RESOURCES = ["wood", "brick", "wool", "grain", "ore"] as const;
export type Resource = typeof RESOURCES[number];
export type Resources = Record<Resource, number>;
export const RESOURCE_INFO: Record<Resource, { label: string; terrain: string; color: string; symbol: string }> = {
  wood: { label: "Holz", terrain: "Wald", color: "#267957", symbol: "♠" },
  brick: { label: "Lehm", terrain: "Hügelland", color: "#b85b41", symbol: "▰" },
  wool: { label: "Wolle", terrain: "Weideland", color: "#81a94c", symbol: "☁" },
  grain: { label: "Getreide", terrain: "Ackerland", color: "#dbb356", symbol: "✳" },
  ore: { label: "Erz", terrain: "Gebirge", color: "#77879b", symbol: "◆" },
};
export const PLAYER_COLORS = ["#eb7959", "#63a9e9", "#eee7d2", "#b58cdd"];
export const PLAYER_COLOR_NAMES = ["Rot", "Blau", "Weiß", "Violett"];
export const DEFAULT_TARGET_POINTS = 12;
export const MIN_TARGET_POINTS = 8;
export const MAX_TARGET_POINTS = 15;
export const COSTS: Record<"road" | "settlement" | "city" | "development", Partial<Resources>> = {
  road: { wood: 1, brick: 1 }, settlement: { wood: 1, brick: 1, wool: 1, grain: 1 },
  city: { ore: 3, grain: 2 }, development: { ore: 1, wool: 1, grain: 1 },
};
export type Development = "knight" | "road_building" | "plenty" | "monopoly" | "victory";
export const DEVELOPMENT_INFO: Record<Development, { label: string; description: string }> = {
  knight: { label: "Ritter", description: "Versetze den Räuber und stiehl eine zufällige Rohstoffkarte." },
  road_building: { label: "Straßenbau", description: "Baue zwei Straßen kostenlos, soweit dein Vorrat und das Spielfeld es erlauben." },
  plenty: { label: "Erfindung", description: "Nimm zwei verfügbare Rohstoffe deiner Wahl aus der Bank." },
  monopoly: { label: "Monopol", description: "Alle anderen geben dir sämtliche Karten einer Rohstoffart." },
  victory: { label: "Siegpunkt", description: "Zählt verdeckt zu deinen Punkten. Wird am Spielende aufgedeckt." },
};
export type Hex = { id: number; q: number; r: number; x: number; y: number; resource: Resource | "desert"; number: number | null; vertices: number[] };
export type Vertex = { id: number; x: number; y: number; hexes: number[]; edges: number[]; owner: string | null; building: "settlement" | "city" | null };
export type Edge = { id: number; a: number; b: number; hexes: number[]; owner: string | null };
export type Harbor = { edge: number; resource: Resource | "any" };
export type Board = { hexes: Hex[]; vertices: Vertex[]; edges: Edge[]; harbors: Harbor[] };
export type DevCard = { id: string; type: Development; boughtOnTurn: number };
export type CatanPlayer = { id: string; name: string; color: number; resources: Resources; development: DevCard[]; knights: number };
export type CatanPhase = "setup_settlement" | "setup_road" | "roll" | "main" | "discard" | "robber" | "steal" | "free_roads" | "finished";
export type TradeOffer = { id: number; fromId: string; toId: string; give: Resources; receive: Resources };
export type CatanNotification = {
  id: number; actionId?: number; playerId: string | null; kind: "resources" | "card" | "award" | "robber";
  tone: "gain" | "loss" | "info"; title: string; message: string; resources?: Resources;
};
export type CatanGame = {
  version: 1; id: string; board: Board; players: CatanPlayer[]; targetPoints: number; bank: Resources;
  deck: Development[]; currentPlayer: number; phase: CatanPhase; turn: number; setupIndex: number; setupVertex: number | null;
  robberHex: number; dice: [number, number] | null; playedDevelopment: boolean; freeRoads: number; returnPhase: "roll" | "main";
  discards: Record<string, number>; victims: string[]; longestRoad: string | null; largestArmy: string | null;
  trade: TradeOffer | null; winner: string | null; log: { id: number; text: string }[]; sequence: number;
  // Optional for saved games created before notifications were introduced.
  notifications?: CatanNotification[];
};
export type CatanAction =
  | { type: "build"; building: "road" | "settlement" | "city"; position: number }
  | { type: "roll" } | { type: "end_turn" } | { type: "buy_development" }
  | { type: "discard"; resources: Partial<Resources> }
  | { type: "move_robber"; hex: number } | { type: "steal"; victimId: string }
  | { type: "bank_trade"; give: Resource; receive: Resource }
  | { type: "offer_trade"; toId: string; give: Partial<Resources>; receive: Partial<Resources> }
  | { type: "accept_trade"; offerId: number } | { type: "cancel_trade"; offerId: number }
  | { type: "play_development"; cardId: string; resource?: Resource; resources?: Partial<Resources> };

export function emptyResources(value = 0): Resources { return { wood: value, brick: value, wool: value, grain: value, ore: value }; }
export function resourceCount(resources: Partial<Resources>) { return RESOURCES.reduce((n, key) => n + (resources[key] ?? 0), 0); }
export function canAfford(resources: Resources, cost: Partial<Resources>) { return RESOURCES.every((r) => resources[r] >= (cost[r] ?? 0)); }
export function validateTargetPoints(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_TARGET_POINTS || value > MAX_TARGET_POINTS) throw new Error(`Wählt ${MIN_TARGET_POINTS} bis ${MAX_TARGET_POINTS} Siegpunkte.`);
  return value;
}
export function randomIndex(length: number): number {
  if (length <= 1) return 0;
  const limit = Math.floor(0x100000000 / length) * length;
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value); while (value[0] >= limit);
  return value[0] % length;
}
type Random = (length: number) => number;
function shuffled<T>(values: T[], random: Random): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) { const j = random(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function isResource(value: unknown): value is Resource { return RESOURCES.includes(value as Resource); }
function readResources(value: unknown): Resources {
  assert(value && typeof value === "object" && !Array.isArray(value), "Wähle gültige Rohstoffe.");
  const object = value as Record<string, unknown>;
  assert(Object.keys(object).every(isResource), "Unbekannter Rohstoff.");
  const result = emptyResources();
  for (const r of RESOURCES) {
    const n = object[r] ?? 0;
    assert(typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 19, "Die Rohstoffmenge muss zwischen 0 und 19 liegen.");
    result[r] = n;
  }
  return result;
}

export function createBoard(random: Random = randomIndex): Board {
  const board: Board = { hexes: [], vertices: [], edges: [], harbors: [] };
  const vertexMap = new Map<string, number>(); const edgeMap = new Map<string, number>();
  const terrain = shuffled<Resource | "desert">(["wood", "wood", "wood", "wood", "brick", "brick", "brick", "wool", "wool", "wool", "wool", "grain", "grain", "grain", "grain", "ore", "ore", "ore", "desert"], random);
  for (let r = -2; r <= 2; r++) for (let q = -2; q <= 2; q++) {
    if (Math.abs(q + r) > 2) continue;
    const id = board.hexes.length; const x = Math.sqrt(3) * 54 * (q + r / 2); const y = 81 * r;
    const hex: Hex = { id, q, r, x, y, resource: terrain[id], number: null, vertices: [] };
    for (let corner = 0; corner < 6; corner++) {
      const angle = (60 * corner - 30) * Math.PI / 180;
      const vx = x + 54 * Math.cos(angle); const vy = y + 54 * Math.sin(angle);
      const key = `${Math.round(vx * 1000)},${Math.round(vy * 1000)}`;
      let vertexId = vertexMap.get(key);
      if (vertexId === undefined) {
        vertexId = board.vertices.length; vertexMap.set(key, vertexId);
        board.vertices.push({ id: vertexId, x: vx, y: vy, hexes: [], edges: [], owner: null, building: null });
      }
      board.vertices[vertexId].hexes.push(id); hex.vertices.push(vertexId);
    }
    for (let i = 0; i < 6; i++) {
      const a = hex.vertices[i]; const b = hex.vertices[(i + 1) % 6]; const key = [a, b].sort((a, b) => a - b).join(":");
      let edgeId = edgeMap.get(key);
      if (edgeId === undefined) {
        edgeId = board.edges.length; edgeMap.set(key, edgeId);
        board.edges.push({ id: edgeId, a, b, hexes: [], owner: null });
        board.vertices[a].edges.push(edgeId); board.vertices[b].edges.push(edgeId);
      }
      board.edges[edgeId].hexes.push(id);
    }
    board.hexes.push(hex);
  }
  // Pick four nonadjacent red tokens first. Backtracking stays bounded even with
  // a deterministic random source; the remaining tokens can be freely shuffled.
  const productive = shuffled(board.hexes.filter((h) => h.resource !== "desert"), random);
  const adjacent = (a: Hex, b: Hex) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r)) === 1;
  function chooseRed(start: number, chosen: Hex[]): Hex[] | null {
    if (chosen.length === 4) return chosen;
    for (let i = start; i < productive.length; i++) {
      if (chosen.some((h) => adjacent(h, productive[i]))) continue;
      const result = chooseRed(i + 1, [...chosen, productive[i]]); if (result) return result;
    }
    return null;
  }
  const red = chooseRed(0, [])!; const redNumbers = shuffled([6, 6, 8, 8], random);
  red.forEach((hex, i) => { hex.number = redNumbers[i]; });
  const numbers = shuffled([2, 3, 3, 4, 4, 5, 5, 9, 9, 10, 10, 11, 11, 12], random);
  productive.filter((hex) => !red.includes(hex)).forEach((hex, i) => { hex.number = numbers[i]; });
  const coast = board.edges.filter((edge) => edge.hexes.length === 1);
  const perimeter: Edge[] = [coast[0]]; let end = coast[0].b;
  while (perimeter.length < coast.length) {
    const edge = coast.find((e) => !perimeter.includes(e) && (e.a === end || e.b === end))!;
    perimeter.push(edge); end = edge.a === end ? edge.b : edge.a;
  }
  const harbors = shuffled<Resource | "any">(["any", "any", "any", "any", ...RESOURCES], random);
  board.harbors = [0, 3, 7, 10, 13, 17, 20, 23, 27].map((index, i) => ({ edge: perimeter[index].id, resource: harbors[i] }));
  return board;
}

export function createCatanGame(seats: { id: string; name: string }[], targetPoints = DEFAULT_TARGET_POINTS, random: Random = randomIndex): CatanGame {
  assert(seats.length >= 3 && seats.length <= 4, "Catan wird mit 3 bis 4 Personen gespielt.");
  assert(new Set(seats.map((p) => p.id)).size === seats.length, "Jede Person braucht einen eigenen Platz.");
  const names = seats.map((p) => p.name.trim().normalize("NFKC").toLocaleLowerCase("de"));
  assert(names.every((name) => name.length >= 1 && name.length <= 24) && new Set(names).size === names.length, "Bitte gebt unterschiedliche Namen mit 1 bis 24 Zeichen ein.");
  const board = createBoard(random); const start = random(seats.length);
  const players = seats.map((p, color) => ({ id: p.id, name: p.name.trim(), color, resources: emptyResources(), development: [], knights: 0 }));
  const game: CatanGame = {
    version: 1, id: crypto.randomUUID(), board, players: [...players.slice(start), ...players.slice(0, start)], targetPoints: validateTargetPoints(targetPoints), bank: emptyResources(19),
    deck: shuffled<Development>([...Array<Development>(14).fill("knight"), ...Array<Development>(5).fill("victory"), "road_building", "road_building", "plenty", "plenty", "monopoly", "monopoly"], random),
    currentPlayer: 0, phase: "setup_settlement", turn: 0, setupIndex: 0, setupVertex: null, robberHex: board.hexes.find((h) => h.resource === "desert")!.id,
    dice: null, playedDevelopment: false, freeRoads: 0, returnPhase: "main", discards: {}, victims: [], longestRoad: null, largestArmy: null, trade: null, winner: null, log: [], sequence: 0, notifications: [],
  };
  addLog(game, `${game.players[0].name} beginnt. Gründet zuerst reihum, dann in umgekehrter Reihenfolge.`);
  return game;
}

export function pieceCounts(game: Pick<CatanGame, "board">, playerId: string) {
  return {
    road: game.board.edges.filter((e) => e.owner === playerId).length,
    settlement: game.board.vertices.filter((v) => v.owner === playerId && v.building === "settlement").length,
    city: game.board.vertices.filter((v) => v.owner === playerId && v.building === "city").length,
  };
}
export function legalSettlements(game: Pick<CatanGame, "board">, playerId: string, setup = false): number[] {
  if (pieceCounts(game, playerId).settlement >= 5) return [];
  return game.board.vertices.filter((v) => !v.owner
    && v.edges.every((id) => { const e = game.board.edges[id]; return !game.board.vertices[e.a === v.id ? e.b : e.a].owner; })
    && (setup || v.edges.some((id) => game.board.edges[id].owner === playerId))).map((v) => v.id);
}
export function legalRoads(game: Pick<CatanGame, "board">, playerId: string, setupVertex?: number | null): number[] {
  if (pieceCounts(game, playerId).road >= 15) return [];
  return game.board.edges.filter((e) => {
    if (e.owner) return false;
    if (setupVertex != null) return e.a === setupVertex || e.b === setupVertex;
    return [e.a, e.b].some((id) => {
      const v = game.board.vertices[id];
      return v.owner === playerId || (!v.owner && v.edges.some((edgeId) => game.board.edges[edgeId].owner === playerId));
    });
  }).map((e) => e.id);
}
export function legalCities(game: Pick<CatanGame, "board">, playerId: string): number[] {
  return pieceCounts(game, playerId).city >= 4 ? [] : game.board.vertices.filter((v) => v.owner === playerId && v.building === "settlement").map((v) => v.id);
}
export function longestRoadLength(board: Board, playerId: string): number {
  function walk(vertexId: number, used: Set<number>): number {
    const vertex = board.vertices[vertexId];
    if (used.size && vertex.owner && vertex.owner !== playerId) return 0;
    let best = 0;
    for (const edgeId of vertex.edges) {
      const edge = board.edges[edgeId]; if (edge.owner !== playerId || used.has(edgeId)) continue;
      used.add(edgeId); best = Math.max(best, 1 + walk(edge.a === vertexId ? edge.b : edge.a, used)); used.delete(edgeId);
    }
    return best;
  }
  return Math.max(0, ...board.vertices.map((v) => walk(v.id, new Set())));
}
export function victoryPoints(game: Pick<CatanGame, "board" | "longestRoad" | "largestArmy">, player: CatanPlayer, includeHidden = true): number {
  const pieces = pieceCounts(game, player.id);
  return pieces.settlement + 2 * pieces.city + (game.longestRoad === player.id ? 2 : 0) + (game.largestArmy === player.id ? 2 : 0)
    + (includeHidden ? player.development.filter((card) => card.type === "victory").length : 0);
}
export function tradeRatio(game: Pick<CatanGame, "board">, playerId: string, resource: Resource): number {
  let ratio = 4;
  for (const harbor of game.board.harbors) {
    const edge = game.board.edges[harbor.edge];
    if (![edge.a, edge.b].some((id) => game.board.vertices[id].owner === playerId)) continue;
    if (harbor.resource === resource) return 2;
    if (harbor.resource === "any") ratio = 3;
  }
  return ratio;
}
function addLog(game: CatanGame, text: string) { game.log.push({ id: ++game.sequence, text }); game.log = game.log.slice(-50); }
function transfer(from: Resources, to: Resources, amounts: Partial<Resources>) {
  assert(canAfford(from, amounts), "Dafür fehlen Rohstoffe.");
  for (const r of RESOURCES) { const n = amounts[r] ?? 0; from[r] -= n; to[r] += n; }
}
function updateAwards(game: CatanGame) {
  function holder(previous: string | null, minimum: number, scores: number[]) {
    const best = Math.max(...scores); if (best < minimum) return null;
    const leaders = game.players.filter((_, i) => scores[i] === best);
    if (leaders.some((p) => p.id === previous)) return previous;
    return leaders.length === 1 ? leaders[0].id : null;
  }
  const road = holder(game.longestRoad, 5, game.players.map((p) => longestRoadLength(game.board, p.id)));
  const army = holder(game.largestArmy, 3, game.players.map((p) => p.knights));
  if (road !== game.longestRoad) addLog(game, road ? `${game.players.find((p) => p.id === road)!.name} erhält die Längste Handelsstraße (+2).` : "Die Längste Handelsstraße ist wieder unbesetzt.");
  if (army !== game.largestArmy && army) addLog(game, `${game.players.find((p) => p.id === army)!.name} erhält die Größte Rittermacht (+2).`);
  game.longestRoad = road; game.largestArmy = army;
}
function checkWinner(game: CatanGame) {
  if (game.phase.startsWith("setup")) return;
  const active = game.players[game.currentPlayer];
  if (victoryPoints(game, active) < game.targetPoints) return;
  game.winner = active.id; game.phase = "finished"; game.trade = null;
  addLog(game, `${active.name} gewinnt mit ${victoryPoints(game, active)} Siegpunkten!`);
}
function produce(game: CatanGame, roll: number) {
  const demand = game.players.map(() => emptyResources());
  for (const hex of game.board.hexes) {
    if (hex.number !== roll || hex.id === game.robberHex || hex.resource === "desert") continue;
    for (const vertexId of hex.vertices) {
      const vertex = game.board.vertices[vertexId]; if (!vertex.owner) continue;
      const i = game.players.findIndex((p) => p.id === vertex.owner);
      demand[i][hex.resource] += vertex.building === "city" ? 2 : 1;
    }
  }
  for (const r of RESOURCES) {
    const recipients = game.players.map((_, i) => i).filter((i) => demand[i][r] > 0);
    const total = demand.reduce((sum, bag) => sum + bag[r], 0);
    if (total > game.bank[r] && recipients.length > 1) { addLog(game, `Die Bank hat zu wenig ${RESOURCE_INFO[r].label}: Niemand erhält diesen Rohstoff.`); continue; }
    for (const i of recipients) transfer(game.bank, game.players[i].resources, { [r]: Math.min(demand[i][r], game.bank[r]) });
  }
}

/** Record each confirmed action, so opposite changes between two polls cannot cancel out. */
function recordNotifications(before: CatanGame, game: CatanGame, actorId: string, action: CatanAction) {
  const actor = before.players.find((p) => p.id === actorId)!;
  const actionId = game.sequence;
  const add = (notice: Omit<CatanNotification, "id">) => {
    (game.notifications ??= []).push({ ...notice, actionId, id: ++game.sequence });
  };
  let source = "Rohstoffe";
  let message = "Dein Rohstoffbestand hat sich geändert.";
  switch (action.type) {
    case "build":
      source = before.phase === "setup_settlement" ? "Startrohstoffe" : "Baukosten";
      message = before.phase === "setup_settlement" ? "Deine zweite Siedlung bringt dir Startrohstoffe." : `${actor.name} baut ${action.building === "road" ? "eine Straße" : action.building === "city" ? "eine Stadt" : "eine Siedlung"}.`;
      break;
    case "roll": source = "Würfelertrag"; message = `Gewürfelt: ${game.dice![0] + game.dice![1]}. Deine Siedlungen und Städte liefern Rohstoffe.`; break;
    case "discard": source = "Räuber · Abgabe"; message = "Eine 7 wurde gewürfelt. Du gibst die Hälfte deiner Rohstoffkarten ab."; break;
    case "steal": source = "Räuber · Diebstahl"; message = `${actor.name} stiehlt ${game.players.find((p) => p.id === action.victimId)!.name} eine Rohstoffkarte.`; break;
    case "bank_trade": source = tradeRatio(before, actorId, action.give) < 4 ? "Hafenhandel" : "Bankhandel"; message = "Dein Tausch ist abgeschlossen."; break;
    case "accept_trade": source = "Handel"; message = `${game.players.find((p) => p.id === before.trade!.fromId)!.name} und ${actor.name} haben getauscht.`; break;
    case "buy_development": {
      source = "Entwicklungskarte · Kauf"; message = "Du bezahlst eine Entwicklungskarte.";
      const card = game.players.find((p) => p.id === actorId)!.development.at(-1)!;
      add({ playerId: actorId, kind: "card", tone: "gain", title: `Neue Karte: ${DEVELOPMENT_INFO[card.type].label}`, message: DEVELOPMENT_INFO[card.type].description });
      break;
    }
    case "play_development": {
      const card = actor.development.find((c) => c.id === action.cardId)!;
      source = DEVELOPMENT_INFO[card.type].label;
      message = `${actor.name} spielt „${source}“${card.type === "monopoly" ? ` und fordert ${RESOURCE_INFO[action.resource!].label}` : ""}.`;
      add({ playerId: null, kind: "card", tone: "info", title: source, message: `${message} ${DEVELOPMENT_INFO[card.type].description}` });
      break;
    }
    case "move_robber":
      add({ playerId: null, kind: "robber", tone: "info", title: "Räuber versetzt", message: `${actor.name} setzt den Räuber auf Feld ${action.hex + 1}. Dieses Feld liefert keine Rohstoffe, solange der Räuber dort steht.` });
      break;
  }
  for (const player of game.players) {
    const previous = before.players.find((p) => p.id === player.id)!;
    const gains = emptyResources(); const losses = emptyResources();
    for (const r of RESOURCES) {
      gains[r] = Math.max(0, player.resources[r] - previous.resources[r]);
      losses[r] = Math.max(0, previous.resources[r] - player.resources[r]);
    }
    // A trade has two receipts: its payment must stay visible alongside its gain.
    for (const [tone, resources] of [["loss", losses], ["gain", gains]] as const) {
      if (resourceCount(resources)) add({ playerId: player.id, kind: "resources", tone, title: source, message, resources });
    }
  }
  for (const [key, title] of [["longestRoad", "Längste Handelsstraße"], ["largestArmy", "Größte Rittermacht"]] as const) {
    if (before[key] === game[key]) continue;
    if (before[key]) add({ playerId: before[key], kind: "award", tone: "loss", title: "Sonderkarte verloren", message: `Du verlierst „${title}“ und damit 2 Siegpunkte.` });
    add({ playerId: null, kind: "award", tone: "info", title, message: game[key] ? `${game.players.find((p) => p.id === game[key])!.name} erhält diese Sonderkarte und 2 Siegpunkte.` : "Diese Sonderkarte ist jetzt unbesetzt." });
  }
  if (game.phase === "finished") for (const player of game.players) {
    const points = player.development.filter((card) => card.type === "victory").length;
    if (points) add({ playerId: null, kind: "card", tone: "info", title: "Siegpunktkarten aufgedeckt", message: `${player.name} deckt ${points} Siegpunktkarte${points === 1 ? "" : "n"} auf.` });
  }
  game.notifications = (game.notifications ?? []).slice(-256);
}

/** Throws before returning an updated snapshot. The caller's state is never mutated. */
export function applyCatanAction(original: CatanGame, actorId: string, action: CatanAction, random: Random = randomIndex): CatanGame {
  assert(action && typeof action === "object" && typeof action.type === "string", "Ungültiger Spielzug.");
  assert(original.phase !== "finished", "Diese Partie ist bereits beendet.");
  const game = structuredClone(original); const player = game.players.find((p) => p.id === actorId);
  assert(player, "Du bist nicht Teil dieser Partie.");
  const active = game.players[game.currentPlayer];
  const outOfTurn = ["discard", "offer_trade", "accept_trade", "cancel_trade"].includes(action.type);
  assert(outOfTurn || active.id === actorId, "Du bist noch nicht am Zug.");
  const main = () => assert(game.phase === "main", "Würfle zuerst und schließe die aktuelle Aufgabe ab.");
  switch (action.type) {
    case "build": {
      assert(Number.isInteger(action.position), "Wähle einen Bauplatz auf der Insel.");
      const setup = game.phase.startsWith("setup"); const free = game.phase === "free_roads";
      if (!setup && !free) main();
      if (action.building === "road") {
        assert(!setup || game.phase === "setup_road", "Gründe zuerst deine Siedlung.");
        assert(legalRoads(game, actorId, setup ? game.setupVertex : null).includes(action.position), "Hier kannst du keine Straße bauen.");
        if (!setup && !free) transfer(player.resources, game.bank, COSTS.road);
        game.board.edges[action.position].owner = actorId;
        addLog(game, `${player.name} baut eine Straße.`);
        if (setup) {
          game.setupIndex++; game.setupVertex = null;
          if (game.setupIndex === game.players.length * 2) { game.phase = "roll"; game.currentPlayer = 0; game.turn = 1; addLog(game, "Die Gründung ist abgeschlossen. Das Spiel beginnt."); }
          else { game.currentPlayer = game.setupIndex < game.players.length ? game.setupIndex : game.players.length * 2 - 1 - game.setupIndex; game.phase = "setup_settlement"; }
        } else if (free) {
          game.freeRoads--;
          if (!game.freeRoads || !legalRoads(game, actorId).length) { game.freeRoads = 0; game.phase = game.returnPhase; }
        }
      } else if (action.building === "settlement") {
        assert(!free && (!setup || game.phase === "setup_settlement"), "Baue jetzt eine Straße.");
        assert(legalSettlements(game, actorId, setup).includes(action.position), "Hier fehlt der Anschluss oder der Abstand zur nächsten Siedlung.");
        if (!setup) transfer(player.resources, game.bank, COSTS.settlement);
        const vertex = game.board.vertices[action.position]; vertex.owner = actorId; vertex.building = "settlement";
        addLog(game, `${player.name} gründet eine Siedlung.`);
        if (setup) {
          game.setupVertex = vertex.id; game.phase = "setup_road";
          if (game.setupIndex >= game.players.length) for (const id of vertex.hexes) {
            const r = game.board.hexes[id].resource; if (r !== "desert") transfer(game.bank, player.resources, { [r]: 1 });
          }
        }
      } else if (action.building === "city") {
        assert(!setup && !free, "Städte kannst du erst nach der Gründung bauen.");
        assert(legalCities(game, actorId).includes(action.position), "Wähle eine eigene Siedlung. Du darfst höchstens vier Städte haben.");
        transfer(player.resources, game.bank, COSTS.city); game.board.vertices[action.position].building = "city";
        addLog(game, `${player.name} baut eine Siedlung zur Stadt aus.`);
      } else throw new Error("Unbekanntes Bauwerk.");
      game.trade = null; updateAwards(game); break;
    }
    case "roll": {
      assert(game.phase === "roll", "Du hast bereits gewürfelt oder musst erst deine Aufgabe abschließen.");
      game.dice = [random(6) + 1, random(6) + 1]; const roll = game.dice[0] + game.dice[1];
      addLog(game, `${player.name} würfelt ${roll} (${game.dice.join(" + ")}).`);
      if (roll === 7) {
        game.discards = Object.fromEntries(game.players.filter((p) => resourceCount(p.resources) > 7).map((p) => [p.id, Math.floor(resourceCount(p.resources) / 2)]));
        game.returnPhase = "main"; game.phase = Object.keys(game.discards).length ? "discard" : "robber";
      } else { produce(game, roll); game.phase = "main"; }
      break;
    }
    case "discard": {
      assert(game.phase === "discard" && game.discards[actorId] > 0, "Du musst gerade keine Rohstoffe abgeben.");
      const bag = readResources(action.resources);
      assert(resourceCount(bag) === game.discards[actorId], `Gib genau ${game.discards[actorId]} Rohstoffkarten ab.`);
      transfer(player.resources, game.bank, bag); delete game.discards[actorId];
      addLog(game, `${player.name} gibt ${resourceCount(bag)} Rohstoffkarten ab.`);
      if (!Object.keys(game.discards).length) game.phase = "robber";
      break;
    }
    case "move_robber": {
      assert(game.phase === "robber", "Der Räuber wird gerade nicht versetzt.");
      assert(Number.isInteger(action.hex) && game.board.hexes[action.hex] && action.hex !== game.robberHex, "Wähle ein anderes Landfeld für den Räuber.");
      game.robberHex = action.hex;
      const owners = new Set(game.board.hexes[action.hex].vertices.map((id) => game.board.vertices[id].owner));
      game.victims = game.players.filter((p) => p.id !== actorId && owners.has(p.id) && resourceCount(p.resources) > 0).map((p) => p.id);
      game.phase = game.victims.length ? "steal" : game.returnPhase;
      addLog(game, `${player.name} versetzt den Räuber auf Feld ${action.hex + 1}.`); break;
    }
    case "steal": {
      assert(game.phase === "steal" && game.victims.includes(action.victimId), "Wähle eine Person am Räuberfeld mit Rohstoffkarten.");
      const victim = game.players.find((p) => p.id === action.victimId)!;
      let index = random(resourceCount(victim.resources));
      for (const r of RESOURCES) { if (index < victim.resources[r]) { transfer(victim.resources, player.resources, { [r]: 1 }); break; } index -= victim.resources[r]; }
      addLog(game, `${player.name} stiehlt ${victim.name} eine verdeckte Rohstoffkarte.`);
      game.victims = []; game.phase = game.returnPhase; break;
    }
    case "bank_trade": {
      main(); assert(isResource(action.give) && isResource(action.receive) && action.give !== action.receive, "Wähle zwei unterschiedliche Rohstoffarten.");
      assert(game.bank[action.receive] > 0, "Dieser Rohstoff ist in der Bank aufgebraucht.");
      const ratio = tradeRatio(game, actorId, action.give);
      transfer(player.resources, game.bank, { [action.give]: ratio }); transfer(game.bank, player.resources, { [action.receive]: 1 });
      game.trade = null; addLog(game, `${player.name} tauscht ${ratio} ${RESOURCE_INFO[action.give].label} gegen 1 ${RESOURCE_INFO[action.receive].label}.`); break;
    }
    case "offer_trade": {
      main(); const to = game.players.find((p) => p.id === action.toId);
      assert(to && to.id !== actorId && (active.id === actorId || active.id === to.id), "Ein Handel muss die Person am Zug einschließen.");
      assert(!game.trade || game.trade.fromId === actorId || game.trade.toId === actorId, "Warte, bis der laufende Handel beendet ist.");
      const give = readResources(action.give); const receive = readResources(action.receive);
      assert(resourceCount(give) > 0 && resourceCount(receive) > 0, "Beide Seiten müssen Rohstoffe tauschen.");
      assert(RESOURCES.every((r) => !give[r] || !receive[r]), "Gleiche Rohstoffarten dürfen nicht auf beiden Seiten stehen.");
      assert(canAfford(player.resources, give), "Du besitzt die angebotenen Rohstoffe nicht.");
      addLog(game, `${player.name} bietet ${to.name} einen Handel an.`);
      game.trade = { id: game.sequence, fromId: actorId, toId: to.id, give, receive }; break;
    }
    case "accept_trade": {
      main(); const offer = game.trade;
      assert(offer && offer.id === action.offerId && offer.toId === actorId, "Dieses Angebot ist nicht mehr für dich verfügbar.");
      const from = game.players.find((p) => p.id === offer.fromId)!;
      assert(canAfford(from.resources, offer.give) && canAfford(player.resources, offer.receive), "Mindestens einer Seite fehlen inzwischen die Rohstoffe.");
      transfer(from.resources, player.resources, offer.give); transfer(player.resources, from.resources, offer.receive);
      addLog(game, `${from.name} und ${player.name} handeln miteinander.`); game.trade = null; break;
    }
    case "cancel_trade": {
      main(); assert(game.trade && game.trade.id === action.offerId && [game.trade.fromId, game.trade.toId, active.id].includes(actorId), "Dieses Angebot kannst du nicht schließen.");
      addLog(game, `${player.name} beendet das Handelsangebot.`); game.trade = null; break;
    }
    case "buy_development": {
      main(); assert(game.deck.length, "Alle Entwicklungskarten wurden gekauft.");
      transfer(player.resources, game.bank, COSTS.development);
      player.development.push({ id: `${game.id}-${game.deck.length}`, type: game.deck.pop()!, boughtOnTurn: game.turn });
      game.trade = null; addLog(game, `${player.name} kauft eine verdeckte Entwicklungskarte.`); break;
    }
    case "play_development": {
      assert(game.phase === "roll" || game.phase === "main", "Schließe zuerst die aktuelle Aufgabe ab.");
      assert(!game.playedDevelopment, "Du darfst pro Zug nur eine Entwicklungskarte ausspielen.");
      const card = player.development.find((c) => c.id === action.cardId);
      assert(card && card.type !== "victory", "Siegpunktkarten zählen automatisch und bleiben bis zum Ende verdeckt.");
      assert(card.boughtOnTurn < game.turn, "Neu gekaufte Entwicklungskarten darfst du erst in einem späteren Zug ausspielen.");
      game.returnPhase = game.phase;
      if (card.type === "knight") { player.knights++; game.phase = "robber"; updateAwards(game); }
      if (card.type === "road_building") {
        assert(legalRoads(game, actorId).length, "Du hast keine Straße oder keinen freien Bauplatz mehr.");
        game.freeRoads = Math.min(2, 15 - pieceCounts(game, actorId).road); game.phase = "free_roads";
      }
      if (card.type === "plenty") {
        const bag = readResources(action.resources);
        assert(resourceCount(bag) === Math.min(2, resourceCount(game.bank)), "Wähle zwei verfügbare Rohstoffe aus der Bank.");
        transfer(game.bank, player.resources, bag);
      }
      if (card.type === "monopoly") {
        assert(isResource(action.resource), "Wähle eine Rohstoffart für das Monopol.");
        for (const other of game.players) if (other.id !== actorId) transfer(other.resources, player.resources, { [action.resource]: other.resources[action.resource] });
      }
      player.development = player.development.filter((c) => c.id !== card.id); game.playedDevelopment = true; game.trade = null;
      addLog(game, `${player.name} spielt „${DEVELOPMENT_INFO[card.type].label}“.`); break;
    }
    case "end_turn": {
      main(); game.currentPlayer = (game.currentPlayer + 1) % game.players.length; game.turn++; game.phase = "roll";
      game.playedDevelopment = false; game.dice = null; game.trade = null;
      addLog(game, `${game.players[game.currentPlayer].name} ist am Zug.`); break;
    }
    default: throw new Error("Unbekannter Spielzug.");
  }
  checkWinner(game); recordNotifications(original, game, actorId, action); return game;
}

export type PublicCatanPlayer = { id: string; name: string; color: number; resourceCount: number; developmentCount: number; knights: number; points: number; roadLength: number; pieces: ReturnType<typeof pieceCounts> };
export type CatanView = Omit<CatanGame, "players" | "deck"> & { players: PublicCatanPlayer[]; deckCount: number; me: CatanPlayer | null };
/** Explicit projection: opponents' hands, hidden VP and deck order never leave the server. */
export function catanView(game: CatanGame, viewerId: string): CatanView {
  const { players, deck, notifications, ...publicGame } = game;
  return {
    ...structuredClone(publicGame), deckCount: deck.length,
    notifications: structuredClone((notifications ?? []).filter((notice) => notice.playerId === null || notice.playerId === viewerId)),
    players: players.map((p) => ({ id: p.id, name: p.name, color: p.color, resourceCount: resourceCount(p.resources), developmentCount: p.development.length, knights: p.knights,
      points: victoryPoints(game, p, game.phase === "finished"), roadLength: longestRoadLength(game.board, p.id), pieces: pieceCounts(game, p.id) })),
    me: structuredClone(players.find((p) => p.id === viewerId) ?? null),
  };
}
export function localActorId(game: Pick<CatanGame, "phase" | "players" | "discards" | "trade" | "currentPlayer">): string {
  if (game.phase === "discard") return game.players.find((p) => game.discards[p.id] > 0)!.id;
  if (game.trade) return game.trade.toId;
  return game.players[game.currentPlayer].id;
}
