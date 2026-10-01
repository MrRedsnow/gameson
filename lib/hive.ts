export const HIVE_KINDS = ["queen", "beetle", "grasshopper", "spider", "ant"] as const;
export type HiveKind = typeof HIVE_KINDS[number];
export type HiveColor = "white" | "black";
export type Hex = { q: number; r: number };
export const HIVE_PIECES: Record<HiveKind, { name: string; count: number; color: string; rule: string }> = {
  queen: { name: "Königin", count: 1, color: "#e9ad38", rule: "Gleitet genau ein Feld. Muss spätestens in deinem vierten Zug gesetzt werden." },
  beetle: { name: "Käfer", count: 2, color: "#a38dd7", rule: "Zieht ein Feld und darf auf andere Steine klettern. Nur der oberste Stein kann ziehen." },
  grasshopper: { name: "Grashüpfer", count: 3, color: "#93b861", rule: "Springt gerade über mindestens einen Stein bis zum ersten freien Feld." },
  spider: { name: "Spinne", count: 2, color: "#d18062", rule: "Gleitet genau drei Felder am Schwarm entlang, ohne ein Feld zweimal zu betreten." },
  ant: { name: "Ameise", count: 3, color: "#66b8c7", rule: "Gleitet beliebig weit am Schwarm entlang, solange der Weg frei ist." },
};
export type HivePlayer = { id: string; name: string; color: HiveColor; turns: number };
export type HivePiece = { id: string; ownerId: string; kind: HiveKind; position: Hex | null; level: number };
export type HiveTurn = { ply: number; playerId: string; type: "place" | "move" | "pass"; pieceId?: string; from?: Hex; to?: Hex };
export type HiveResult = { winnerId: string | null; reason: "surrounded" | "both-surrounded" | "resigned" | "agreement" };
export type HiveGame = {
  version: 1; id: string; players: [HivePlayer, HivePlayer]; pieces: HivePiece[]; currentPlayer: number;
  ply: number; phase: "playing" | "finished"; result: HiveResult | null; drawOffer: string | null; history: HiveTurn[];
};
type TurnGuard = { gameId: string; ply: number };
export type HiveAction = TurnGuard & (
  | { type: "place" | "move"; pieceId: string; to: Hex }
  | { type: "pass" | "resign" | "offer-draw" | "cancel-draw" }
  | { type: "answer-draw"; accept: boolean }
);
export type HiveState = {
  lobby: { id: string; name: string; hostPlayerId: string; discoverable: boolean; revision: number };
  members: { id: string; name: string }[]; me: { id: string; name: string }; game: HiveGame | null;
};
export const HEX_DIRECTIONS: readonly Hex[] = [{ q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 }];
export const hexKey = ({ q, r }: Hex) => `${q},${r}`;
export const sameHex = (a: Hex, b: Hex) => a.q === b.q && a.r === b.r;
export const hexNeighbors = (position: Hex): Hex[] => HEX_DIRECTIONS.map((d) => ({ q: position.q + d.q, r: position.r + d.r }));
type Board = Map<string, HivePiece[]>;

export function hiveBoard(game: HiveGame): Board {
  const board: Board = new Map();
  for (const piece of game.pieces) {
    if (!piece.position) continue;
    const key = hexKey(piece.position);
    const stack = board.get(key) ?? []; stack.push(piece); board.set(key, stack);
  }
  for (const stack of board.values()) stack.sort((a, b) => a.level - b.level);
  return board;
}
export const activeHivePlayer = (game: HiveGame) => game.players[game.currentPlayer];
export const queenPlaced = (game: HiveGame, playerId: string) => game.pieces.some((p) => p.ownerId === playerId && p.kind === "queen" && p.position !== null);
export const queenRequired = (game: HiveGame, playerId = activeHivePlayer(game).id) => !queenPlaced(game, playerId) && (game.players.find((p) => p.id === playerId)?.turns ?? 0) >= 3;

export function createHiveGame(players: { id: string; name: string }[]): HiveGame {
  if (players.length !== 2) throw new Error("HIVE wird mit genau zwei Personen gespielt.");
  const seats = players.map((p, i) => ({ id: p.id, name: p.name.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 24), color: i === 0 ? "white" as const : "black" as const, turns: 0 }));
  if (seats.some((p) => !p.id || !p.name) || new Set(seats.map((p) => p.id)).size !== 2 || new Set(seats.map((p) => p.name.toLocaleLowerCase("de"))).size !== 2) throw new Error("Gebt zwei unterschiedliche Namen ein.");
  return {
    version: 1, id: crypto.randomUUID(), players: seats as [HivePlayer, HivePlayer],
    pieces: seats.flatMap((p) => HIVE_KINDS.flatMap((kind) => Array.from({ length: HIVE_PIECES[kind].count }, (_, i) => ({ id: `${p.id}:${kind}:${i}`, ownerId: p.id, kind, position: null, level: 0 })))),
    currentPlayer: 0, ply: 0, phase: "playing", result: null, drawOffer: null, history: [],
  };
}

function connected(board: Board): boolean {
  if (board.size < 2) return true;
  const first = board.values().next().value![0].position!;
  const queue = [first]; const visited = new Set([hexKey(first)]);
  for (let i = 0; i < queue.length; i++) for (const next of hexNeighbors(queue[i])) {
    const key = hexKey(next);
    if (board.has(key) && !visited.has(key)) { visited.add(key); queue.push(next); }
  }
  return visited.size === board.size;
}
export const isHiveConnected = (game: HiveGame) => connected(hiveBoard(game));

export function hivePlacements(game: HiveGame, playerId = activeHivePlayer(game).id): Hex[] {
  const board = hiveBoard(game);
  if (!board.size) return [{ q: 0, r: 0 }];
  const first = !game.pieces.some((p) => p.ownerId === playerId && p.position);
  const candidates = new Map<string, Hex>();
  for (const stack of board.values()) for (const next of hexNeighbors(stack[0].position!)) {
    if (board.has(hexKey(next))) continue;
    const neighbors = hexNeighbors(next).map((n) => board.get(hexKey(n))).filter((s): s is HivePiece[] => Boolean(s));
    if (first || neighbors.every((s) => s[s.length - 1].ownerId === playerId)) candidates.set(hexKey(next), next);
  }
  return [...candidates.values()];
}

// At ground level a sliding piece must keep edge contact and fit through the gate.
// For a climbing beetle the gate is checked at the higher of its two levels.
function steps(board: Board, from: Hex, fromLevel = 1, beetle = false): Hex[] {
  return hexNeighbors(from).filter((to, i) => {
    const destination = board.get(hexKey(to));
    if (destination && !beetle) return false;
    const level = Math.max(fromLevel, (destination?.length ?? 0) + 1);
    const sides = [HEX_DIRECTIONS[(i + 5) % 6], HEX_DIRECTIONS[(i + 1) % 6]].map((d) => board.get(hexKey({ q: from.q + d.q, r: from.r + d.r }))?.length ?? 0);
    if (sides.every((height) => height >= level)) return false;
    if (level === 1 && sides.every((height) => height === 0)) return false;
    return Boolean(destination) || hexNeighbors(to).some((n) => board.has(hexKey(n)));
  });
}

export function hiveTargets(game: HiveGame, pieceId: string): Hex[] {
  const piece = game.pieces.find((p) => p.id === pieceId);
  if (!piece || game.phase !== "playing" || piece.ownerId !== activeHivePlayer(game).id) return [];
  if (!piece.position) return queenRequired(game) && piece.kind !== "queen" ? [] : hivePlacements(game);
  if (!queenPlaced(game, piece.ownerId)) return [];
  const board = hiveBoard(game); const source = hexKey(piece.position); const stack = board.get(source)!;
  if (stack[stack.length - 1].id !== piece.id) return [];
  const level = stack.length;
  if (level === 1) board.delete(source); else board.set(source, stack.slice(0, -1));
  if (!connected(board)) return [];
  if (piece.kind === "queen") return steps(board, piece.position);
  if (piece.kind === "beetle") return steps(board, piece.position, level, true);
  if (piece.kind === "grasshopper") return HEX_DIRECTIONS.flatMap((d) => {
    let next = { q: piece.position!.q + d.q, r: piece.position!.r + d.r };
    if (!board.has(hexKey(next))) return [];
    while (board.has(hexKey(next))) next = { q: next.q + d.q, r: next.r + d.r };
    return [next];
  });
  const targets = new Map<string, Hex>();
  if (piece.kind === "spider") {
    const walk = (from: Hex, visited: Set<string>, remaining: number) => {
      if (!remaining) { targets.set(hexKey(from), from); return; }
      for (const next of steps(board, from)) if (!visited.has(hexKey(next))) walk(next, new Set([...visited, hexKey(next)]), remaining - 1);
    };
    walk(piece.position, new Set([source]), 3);
  } else {
    const queue = [piece.position]; const visited = new Set([source]);
    for (let i = 0; i < queue.length; i++) for (const next of steps(board, queue[i])) {
      const key = hexKey(next); if (visited.has(key)) continue;
      visited.add(key); targets.set(key, next); queue.push(next);
    }
  }
  return [...targets.values()];
}
export const canHivePass = (game: HiveGame) => game.phase === "playing" && game.pieces.filter((p) => p.ownerId === activeHivePlayer(game).id).every((p) => !hiveTargets(game, p.id).length);

export type HivePieceHint = {
  code: "queen-required" | "queen-missing" | "covered" | "split" | "placement" | "gate" | "surrounded" | "spider-path" | "jump" | "contact";
  message: string; highlights: Hex[]; groups?: Hex[][];
};
function hiveGroups(board: Board): Hex[][] {
  const remaining = new Set(board.keys()); const groups: Hex[][] = [];
  while (remaining.size) {
    const first = board.get(remaining.values().next().value!)![0].position!;
    const queue = [first]; remaining.delete(hexKey(first));
    for (let i = 0; i < queue.length; i++) for (const neighbor of hexNeighbors(queue[i])) {
      if (remaining.delete(hexKey(neighbor))) queue.push(neighbor);
    }
    groups.push(queue);
  }
  return groups;
}
/** Explain the first rule preventing a move, with the actual affected board cells. */
export function hivePieceHint(game: HiveGame, pieceId: string): HivePieceHint | null {
  const piece = game.pieces.find((p) => p.id === pieceId);
  if (!piece || game.phase !== "playing" || piece.ownerId !== activeHivePlayer(game).id) return null;
  if (!piece.position) {
    if (queenRequired(game) && piece.kind !== "queen") return { code: "queen-required", message: "Du bist im vierten Zug: Jetzt muss deine Königin auf das Spielfeld.", highlights: [] };
    if (!hivePlacements(game).length) return { code: "placement", message: "Kein Platz zum Anlegen: Ein neuer Stein darf nach deinem ersten Zug keine gegnerische Farbe berühren. Bei Stapeln zählt die Farbe oben.", highlights: [...hiveBoard(game).values()].filter((s) => s.at(-1)!.ownerId !== piece.ownerId).map((s) => s[0].position!) };
    return null;
  }
  if (!queenPlaced(game, piece.ownerId)) return { code: "queen-missing", message: "Setze zuerst deine Königin. Bis dahin dürfen deine Steine auf dem Spielfeld noch nicht ziehen.", highlights: [] };
  const board = hiveBoard(game); const stack = board.get(hexKey(piece.position))!; const level = stack.length;
  if (stack.at(-1)!.id !== piece.id) return { code: "covered", message: `Dieser Stein liegt unter einem Käfer. Nur der oberste Stein im Stapel darf ziehen.`, highlights: [piece.position] };
  if (level === 1) board.delete(hexKey(piece.position)); else board.set(hexKey(piece.position), stack.slice(0, -1));
  const groups = hiveGroups(board);
  if (groups.length > 1) return { code: "split", message: `Dieser Stein verbindet den Schwarm. Wenn du ihn anhebst, entstehen ${groups.length} getrennte Gruppen. Die Nummern zeigen, welche Steine zusammenbleiben.`, highlights: groups.flat(), groups };
  if (hiveTargets(game, piece.id).length) return null;
  const adjacent = hexNeighbors(piece.position);
  if (piece.kind === "grasshopper") return { code: "jump", message: "Keine Sprungreihe: Der Grashüpfer braucht direkt neben sich mindestens einen Stein, über den er gerade springen kann.", highlights: [] };
  const gates = adjacent.flatMap((to, i) => {
    const destination = board.get(hexKey(to)); if (destination && piece.kind !== "beetle") return [];
    const height = Math.max(level, (destination?.length ?? 0) + 1);
    const sides = [HEX_DIRECTIONS[(i + 5) % 6], HEX_DIRECTIONS[(i + 1) % 6]].map((d) => ({ q: piece.position!.q + d.q, r: piece.position!.r + d.r }));
    return sides.every((p) => (board.get(hexKey(p))?.length ?? 0) >= height) ? sides : [];
  });
  if (!steps(board, piece.position, level, piece.kind === "beetle").length && gates.length) return { code: "gate", message: "Die Lücke ist zu eng. Die orange markierten Steine bilden geschlossene Tore; dein Stein passt auf seiner Höhe nicht hindurch.", highlights: [...new Map(gates.map((p) => [hexKey(p), p])).values()] };
  if (adjacent.every((p) => board.has(hexKey(p))) && piece.kind !== "beetle") return { code: "surrounded", message: "Alle sechs Nachbarfelder sind besetzt. Dieser Stein kann weder darüber klettern noch hindurchgleiten.", highlights: adjacent };
  if (piece.kind === "spider") return { code: "spider-path", message: "Kein Weg mit genau drei Schritten: Die Spinne darf kein Feld doppelt betreten und muss die ganze Zeit am Schwarm bleiben.", highlights: adjacent.filter((p) => board.has(hexKey(p))) };
  return { code: "contact", message: "Kein freier Schritt mit Kontakt zum Schwarm. Beim Gleiten muss dein Stein immer an einem anderen Stein entlanglaufen.", highlights: adjacent.filter((p) => board.has(hexKey(p))) };
}

/** A legal path for the selected preview and for animating a confirmed movement. */
export function hiveMovePath(game: HiveGame, pieceId: string, to: Hex): Hex[] {
  const piece = game.pieces.find((p) => p.id === pieceId);
  if (!piece?.position || !hiveTargets(game, pieceId).some((p) => sameHex(p, to))) return [];
  const from = piece.position;
  if (["queen", "beetle", "grasshopper"].includes(piece.kind)) return [from, to];
  const board = hiveBoard(game); const stack = board.get(hexKey(from))!;
  if (stack.length === 1) board.delete(hexKey(from)); else board.set(hexKey(from), stack.slice(0, -1));
  if (piece.kind === "spider") {
    const walk = (path: Hex[]): Hex[] => {
      if (path.length === 4) return sameHex(path.at(-1)!, to) ? path : [];
      for (const next of steps(board, path.at(-1)!)) if (!path.some((p) => sameHex(p, next))) {
        const found = walk([...path, next]); if (found.length) return found;
      }
      return [];
    };
    return walk([from]);
  }
  const queue: Hex[][] = [[from]]; const visited = new Set([hexKey(from)]);
  for (let i = 0; i < queue.length; i++) for (const next of steps(board, queue[i].at(-1)!)) {
    if (visited.has(hexKey(next))) continue;
    const path = [...queue[i], next]; if (sameHex(next, to)) return path;
    visited.add(hexKey(next)); queue.push(path);
  }
  return [];
}

export const canUndoHiveTurn = (game: HiveGame) => game.history.length > 0 && (game.phase === "playing" || ["surrounded", "both-surrounded"].includes(game.result?.reason ?? ""));
/** Local play only. Undo derives the previous stack height from the remaining pieces. */
export function undoHiveTurn(game: HiveGame): HiveGame {
  if (!canUndoHiveTurn(game)) throw new Error("Es gibt keinen Spielzug, den du zurücknehmen kannst.");
  const next = structuredClone(game); const turn = next.history.pop()!;
  if (turn.pieceId) {
    const piece = next.pieces.find((p) => p.id === turn.pieceId)!;
    piece.position = null; piece.level = 0;
    if (turn.from) { piece.level = (hiveBoard(next).get(hexKey(turn.from))?.length ?? 0) + 1; piece.position = { ...turn.from }; }
  }
  next.ply--; next.currentPlayer = next.players.findIndex((p) => p.id === turn.playerId); next.players[next.currentPlayer].turns--;
  next.phase = "playing"; next.result = null; next.drawOffer = null;
  return next;
}

export function queenSurroundCount(game: HiveGame, playerId: string): number {
  const queen = game.pieces.find((p) => p.ownerId === playerId && p.kind === "queen");
  if (!queen?.position) return 0;
  const board = hiveBoard(game);
  return hexNeighbors(queen.position).filter((n) => board.has(hexKey(n))).length;
}
export function hiveOutcome(game: HiveGame): HiveResult | null {
  const surrounded = game.players.filter((p) => queenPlaced(game, p.id) && queenSurroundCount(game, p.id) === 6);
  if (!surrounded.length) return null;
  return surrounded.length === 2 ? { winnerId: null, reason: "both-surrounded" } : { winnerId: game.players.find((p) => p.id !== surrounded[0].id)!.id, reason: "surrounded" };
}

export function applyHiveAction(game: HiveGame, actorId: string, action: HiveAction): HiveGame {
  if (!action || typeof action !== "object" || action.gameId !== game.id || action.ply !== game.ply) throw new Error("Dieser Zug ist nicht mehr aktuell. Der Spielstand wurde neu geladen.");
  if (game.phase !== "playing") throw new Error("Die Partie ist bereits beendet.");
  const actor = game.players.find((p) => p.id === actorId);
  if (!actor) throw new Error("Du spielst in dieser Partie nicht mit.");
  const next = structuredClone(game);
  if (action.type === "resign") {
    next.result = { winnerId: game.players.find((p) => p.id !== actorId)!.id, reason: "resigned" }; next.phase = "finished"; next.drawOffer = null; return next;
  }
  if (action.type === "answer-draw") {
    if (!game.drawOffer || game.drawOffer === actorId || typeof action.accept !== "boolean") throw new Error("Es liegt kein Remis-Angebot für dich vor.");
    next.drawOffer = null;
    if (action.accept) { next.phase = "finished"; next.result = { winnerId: null, reason: "agreement" }; }
    return next;
  }
  if (action.type === "cancel-draw") {
    if (game.drawOffer !== actorId) throw new Error("Du hast kein Remis angeboten.");
    next.drawOffer = null; return next;
  }
  if (activeHivePlayer(game).id !== actorId) throw new Error("Die andere Person ist am Zug.");
  if (action.type === "offer-draw") {
    if (game.drawOffer) throw new Error("Es liegt bereits ein Remis-Angebot vor.");
    next.drawOffer = actorId; return next;
  }
  let turn: HiveTurn;
  if (action.type === "pass") {
    if (!canHivePass(game)) throw new Error("Du kannst nur passen, wenn du weder setzen noch ziehen kannst.");
    turn = { ply: game.ply + 1, playerId: actorId, type: "pass" };
  } else if (action.type === "place" || action.type === "move") {
    const piece = next.pieces.find((p) => p.id === action.pieceId);
    if (!piece || piece.ownerId !== actorId || (action.type === "place") !== (piece.position === null)) throw new Error("Wähle einen eigenen, verfügbaren Stein.");
    if (!action.to || !Number.isSafeInteger(action.to.q) || !Number.isSafeInteger(action.to.r) || !hiveTargets(game, piece.id).some((p) => sameHex(p, action.to))) throw new Error("Dieses Feld ist für den Stein nicht erlaubt.");
    turn = { ply: game.ply + 1, playerId: actorId, type: action.type, pieceId: piece.id, ...(piece.position ? { from: { ...piece.position } } : {}), to: { ...action.to } };
    piece.level = (hiveBoard(game).get(hexKey(action.to))?.length ?? 0) + 1;
    piece.position = { ...action.to };
  } else throw new Error("Unbekannte Spielaktion.");
  next.history.push(turn); next.ply++; next.players[next.currentPlayer].turns++; next.currentPlayer = 1 - next.currentPlayer; next.drawOffer = null;
  next.result = hiveOutcome(next); if (next.result) next.phase = "finished";
  return next;
}

export function restoreHiveGame(raw: string): HiveGame {
  const value = JSON.parse(raw) as HiveGame;
  const invalid = () => { throw new Error("Die gespeicherte HIVE-Partie kann nicht gelesen werden. Starte eine neue Partie."); };
  if (!value || value.version !== 1 || typeof value.id !== "string" || !Array.isArray(value.players) || value.players.length !== 2 || ![0, 1].includes(value.currentPlayer) || !Number.isSafeInteger(value.ply) || value.ply < 0 || !["playing", "finished"].includes(value.phase) || !Array.isArray(value.pieces) || value.pieces.length !== 22 || !Array.isArray(value.history)) return invalid();
  if (value.players.some((p) => !p || typeof p.id !== "string" || !p.id || typeof p.name !== "string" || !p.name || !["white", "black"].includes(p.color) || !Number.isSafeInteger(p.turns) || p.turns < 0) || new Set(value.players.map((p) => p.id)).size !== 2) return invalid();
  if (value.players[0].color !== "white" || value.players[1].color !== "black" || value.players.reduce((sum, p) => sum + p.turns, 0) !== value.ply || value.history.length !== value.ply || (value.drawOffer !== null && !value.players.some((p) => p.id === value.drawOffer)) || (value.phase === "playing" && value.result !== null)) return invalid();
  if (new Set(value.pieces.map((p) => p?.id)).size !== 22) return invalid();
  for (const piece of value.pieces) {
    if (!piece || typeof piece.id !== "string" || !value.players.some((p) => p.id === piece.ownerId) || !HIVE_KINDS.includes(piece.kind) || !Number.isSafeInteger(piece.level)) return invalid();
    if (piece.position === null ? piece.level !== 0 : !piece.position || !Number.isSafeInteger(piece.position.q) || !Number.isSafeInteger(piece.position.r) || piece.level < 1 || piece.level > 5) return invalid();
  }
  for (const player of value.players) for (const kind of HIVE_KINDS) if (value.pieces.filter((p) => p.ownerId === player.id && p.kind === kind).length !== HIVE_PIECES[kind].count) return invalid();
  for (const stack of hiveBoard(value).values()) if (stack.some((p, i) => p.level !== i + 1 || (i > 0 && p.kind !== "beetle"))) return invalid();
  for (const [i, entry] of value.history.entries()) {
    if (!entry || entry.ply !== i + 1 || !value.players.some((p) => p.id === entry.playerId) || !["place", "move", "pass"].includes(entry.type)) return invalid();
    if (entry.type !== "pass" && (!value.pieces.some((p) => p.id === entry.pieceId && p.ownerId === entry.playerId) || !entry.to || !Number.isSafeInteger(entry.to.q) || !Number.isSafeInteger(entry.to.r))) return invalid();
    if (entry.type === "move" && (!entry.from || !Number.isSafeInteger(entry.from.q) || !Number.isSafeInteger(entry.from.r))) return invalid();
  }
  if (!isHiveConnected(value) || (value.phase === "finished" && (!value.result || !["surrounded", "both-surrounded", "resigned", "agreement"].includes(value.result.reason) || (value.result.winnerId !== null && !value.players.some((p) => p.id === value.result!.winnerId))))) return invalid();
  return value;
}
