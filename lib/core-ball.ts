export const CORE_BALL_SHOT_MS = 150;
export const CORE_BALL_PIN_RADIUS = 0.11;
export const CORE_BALL_CORE_RADIUS = 0.35;
export const CORE_BALL_COLORS = ["#38bdf8", "#fb7185", "#a78bfa", "#fbbf24", "#34d399", "#fb923c", "#e879f9", "#a3e635"] as const;

export type CoreBallMode = "coop" | "competitive";
export type CoreBallPlayer = { id: string; name: string; color: string; score: number };
export type CoreBallPin = { angle: number; playerId: string | null };
export type CoreBallEvent = {
  id: string; type: "shot" | "collision" | "level-complete" | "handoff" | "ready" | "skip" | "finish";
  at: number; playerId: string; level: number; angle?: number;
};
export type CoreBallResult = { winnerIds: string[]; completedLevels: number };
export type CoreBallGame = {
  version: 1; id: string; mode: CoreBallMode; players: CoreBallPlayer[]; hostPlayerId: string;
  phase: "awaiting-ready" | "playing" | "finished"; level: number; attemptId: number; turnId: number;
  activePlayerId: string; pins: CoreBallPin[]; remaining: number; contributions: Record<string, number>;
  turnHits: number; elapsedMs: number; runningSince: number | null; lockedUntil: number;
  completedLevels: number; collisions: number; lastEvent: CoreBallEvent | null; result: CoreBallResult | null;
};
type TurnGuard = { gameId: string; attemptId: number; turnId: number };
export type CoreBallAction = TurnGuard & (
  | { type: "ready" | "skip-player" | "finish" }
  | { type: "shoot"; firedAt: number }
  | { type: "handoff"; targetPlayerId: string }
);
export type CoreBallLevel = {
  initialPins: number; newPins: number; f: number; a: number; T: number; phi: number; b: number; s: number; theta0: number;
};

const TAU = 2 * Math.PI;
const normalize = (angle: number) => ((angle % TAU) + TAU) % TAU;
const finiteTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const count = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && (value as number) >= minimum;
const cleanName = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 24);
const textId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 128;

/** A bounded, deterministic generator: all later levels reuse the same geometric limits. */
export function coreBallLevel(level: number): CoreBallLevel {
  if (!count(level, 1)) throw new Error("Dieses Level ist ungültig.");
  const difficulty = Math.min(8, Math.floor((level - 1) / 3));
  const f = 0.22 + 0.0225 * difficulty;
  const a = level <= 9 ? 0 : level <= 15 ? 0.25 : 1.4;
  return {
    initialPins: 4 + Math.floor(difficulty / 2), newPins: 8 + difficulty,
    f, a, T: 8 + ((level - 1) % 5), phi: TAU * ((level - 1) % 8) / 8,
    b: f / (1 + a), s: level <= 9 || level % 2 === 1 ? 1 : -1,
    theta0: normalize(Math.PI / 4 + (level - 1) * 2.39996323),
  };
}

function initialPins(level: number): CoreBallPin[] {
  const { initialPins: amount } = coreBallLevel(level);
  return Array.from({ length: amount }, (_, index) => ({ angle: TAU * index / amount, playerId: null }));
}

export function createCoreBallGame(
  players: { id: string; name: string }[], mode: CoreBallMode = "coop", hostPlayerId: string = players[0]?.id ?? "", now = Date.now(),
): CoreBallGame {
  if (!Array.isArray(players) || players.length < 2 || players.length > CORE_BALL_COLORS.length) throw new Error("Core Ball wird mit 2 bis 8 Personen gespielt.");
  if (!["coop", "competitive"].includes(mode) || !finiteTime(now)) throw new Error("Die Spieleinstellungen sind ungültig.");
  const seats = players.map((player, index) => {
    if (!player || !textId(player.id) || typeof player.name !== "string") throw new Error("Gebt unterschiedliche Namen ein.");
    return { id: player.id, name: cleanName(player.name), color: CORE_BALL_COLORS[index], score: 0 };
  });
  if (seats.some((player) => !player.name) || new Set(seats.map((player) => player.id)).size !== seats.length || new Set(seats.map((player) => player.name.toLocaleLowerCase("de"))).size !== seats.length) throw new Error("Gebt unterschiedliche Namen ein.");
  if (!seats.some((player) => player.id === hostPlayerId)) throw new Error("Die Spielleitung muss mitspielen.");
  return {
    version: 1, id: crypto.randomUUID(), mode, players: seats, hostPlayerId,
    phase: "awaiting-ready", level: 1, attemptId: 1, turnId: 1, activePlayerId: seats[0].id,
    pins: initialPins(1), remaining: coreBallLevel(1).newPins,
    contributions: Object.fromEntries(seats.map((player) => [player.id, 0])), turnHits: 0,
    elapsedMs: 0, runningSince: null, lockedUntil: 0, completedLevels: 0, collisions: 0, lastEvent: null, result: null,
  };
}

export function activeCoreBallPlayer(game: CoreBallGame): CoreBallPlayer {
  return game.players.find((player) => player.id === game.activePlayerId)!;
}

export function coreBallElapsed(game: CoreBallGame, now: number): number {
  return game.elapsedMs + (game.phase === "playing" && game.runningSince !== null ? Math.max(0, now - game.runningSince) : 0);
}

/** Clockwise radians in screen coordinates, integrated analytically rather than per frame. */
export function coreBallAngleAt(level: number, elapsedMs: number): number {
  const { theta0, s, b, a, T, phi } = coreBallLevel(level);
  const t = elapsedMs / 1000;
  return normalize(theta0 + s * (TAU * b * t + a * b * T * (Math.sin(TAU * t / T + phi) - Math.sin(phi))));
}

export const coreBallAngle = (game: CoreBallGame, now: number) => coreBallAngleAt(game.level, coreBallElapsed(game, now));
export const coreBallShotAngle = (game: CoreBallGame, firedAt: number) => normalize(Math.PI / 2 - coreBallAngle(game, firedAt + CORE_BALL_SHOT_MS));
export const canCoreBallHandoff = (game: CoreBallGame) => game.phase === "playing" && game.turnHits >= 1;

function pause(game: CoreBallGame, now: number) {
  game.elapsedMs = coreBallElapsed(game, now);
  game.runningSince = null;
  game.phase = "awaiting-ready";
}

function nextPlayer(game: CoreBallGame): string {
  return game.players[(game.players.findIndex((player) => player.id === game.activePlayerId) + 1) % game.players.length].id;
}

function resetAttempt(game: CoreBallGame, level: number) {
  game.activePlayerId = nextPlayer(game);
  game.level = level;
  game.attemptId++;
  game.turnId++;
  game.pins = initialPins(level);
  game.remaining = coreBallLevel(level).newPins;
  game.contributions = Object.fromEntries(game.players.map((player) => [player.id, 0]));
  game.turnHits = 0;
  game.elapsedMs = 0;
  game.runningSince = null;
  game.phase = "awaiting-ready";
}

function outcome(game: CoreBallGame): CoreBallResult {
  const highest = Math.max(...game.players.map((player) => player.score));
  return { winnerIds: game.mode === "competitive" ? game.players.filter((player) => player.score === highest).map((player) => player.id) : [], completedLevels: game.completedLevels };
}

/** Accepts one guarded action and returns a new JSON-serializable state; errors never mutate the input. */
export function applyCoreBallAction(game: CoreBallGame, actorId: string, action: CoreBallAction, now = Date.now()): CoreBallGame {
  if (!action || typeof action !== "object" || action.gameId !== game.id || action.attemptId !== game.attemptId || action.turnId !== game.turnId) throw new Error("Dieser Zug ist nicht mehr aktuell. Lade den Spielstand neu.");
  if (!finiteTime(now)) throw new Error("Die Zeitangabe ist ungültig.");
  if (game.phase === "finished") throw new Error("Das Spiel ist bereits beendet.");
  if (!game.players.some((player) => player.id === actorId)) throw new Error("Du spielst in dieser Runde nicht mit.");
  if (now < game.lockedUntil) throw new Error("Warte, bis der Punkt angekommen ist.");
  const isHostAction = action.type === "skip-player" || action.type === "finish";
  if (isHostAction ? actorId !== game.hostPlayerId : actorId !== game.activePlayerId) throw new Error(isHostAction ? "Nur die Spielleitung kann das machen." : "Eine andere Person ist dran.");
  const next = structuredClone(game);
  let event: CoreBallEvent = { id: crypto.randomUUID(), type: "ready", at: now, playerId: actorId, level: game.level };

  if (action.type === "ready") {
    if (game.phase !== "awaiting-ready") throw new Error("Das Spiel läuft bereits.");
    next.phase = "playing";
    next.runningSince = now;
  } else if (action.type === "shoot") {
    if (game.phase !== "playing" || game.runningSince === null) throw new Error("Bestätige zuerst, dass du bereit bist.");
    if (!finiteTime(action.firedAt) || action.firedAt < now - 1000 || action.firedAt > now + 50 || action.firedAt < game.runningSince || action.firedAt < game.lockedUntil) throw new Error("Der Schuss ist nicht mehr aktuell. Lade den Spielstand neu.");
    const angle = coreBallShotAngle(game, action.firedAt);
    const collision = game.pins.some((pin) => Math.hypot(Math.cos(angle) - Math.cos(pin.angle), Math.sin(angle) - Math.sin(pin.angle)) <= 2 * CORE_BALL_PIN_RADIUS + 1e-12);
    next.lockedUntil = Math.max(now, action.firedAt + CORE_BALL_SHOT_MS);
    event = { ...event, type: collision ? "collision" : "shot", at: action.firedAt, angle };
    if (collision) {
      next.collisions++;
      resetAttempt(next, game.level);
    } else {
      next.pins.push({ angle, playerId: actorId });
      next.remaining--;
      next.contributions[actorId]++;
      next.turnHits++;
      if (next.remaining === 0) {
        if (next.mode === "competitive") for (const player of next.players) player.score += next.contributions[player.id];
        next.completedLevels++;
        event.type = "level-complete";
        resetAttempt(next, game.level + 1);
      }
    }
  } else if (action.type === "handoff") {
    if (!canCoreBallHandoff(game)) throw new Error("Setze zuerst einen Punkt, bevor du abgibst.");
    if (action.targetPlayerId === actorId || !game.players.some((player) => player.id === action.targetPlayerId)) throw new Error("Wähle eine andere Person aus.");
    pause(next, now);
    next.activePlayerId = action.targetPlayerId;
    next.turnHits = 0;
    next.turnId++;
    event.type = "handoff";
  } else if (action.type === "skip-player") {
    pause(next, now);
    next.activePlayerId = nextPlayer(game);
    next.turnHits = 0;
    next.turnId++;
    event.type = "skip";
  } else if (action.type === "finish") {
    pause(next, now);
    next.phase = "finished";
    next.result = outcome(next);
    event.type = "finish";
  } else {
    throw new Error("Diese Aktion ist ungültig.");
  }
  next.lastEvent = event;
  return next;
}

/** Persist a local round at its current angle without handing the turn to another person. */
export function coreBallLocalSnapshot(game: CoreBallGame, now: number): CoreBallGame {
  const next = structuredClone(game);
  if (next.phase === "playing") pause(next, now);
  return next;
}

/** Validate stored local data, strip unknown fields, and require readiness before rotation resumes. */
export function restoreCoreBallGame(raw: unknown, now = Date.now()): CoreBallGame {
  const invalid = (): never => { throw new Error("Die gespeicherte Core-Ball-Runde kann nicht gelesen werden. Starte eine neue Runde."); };
  let value: CoreBallGame;
  try {
    if (typeof raw === "string" && raw.length > 65536) return invalid();
    value = (typeof raw === "string" ? JSON.parse(raw) : raw) as CoreBallGame;
  } catch { return invalid(); }
  if (!finiteTime(now) || !value || value.version !== 1 || !textId(value.id) || !["coop", "competitive"].includes(value.mode) || !Array.isArray(value.players) || value.players.length < 2 || value.players.length > 8 || !["awaiting-ready", "playing", "finished"].includes(value.phase)) return invalid();
  if (value.players.some((player, index) => !player || !textId(player.id) || typeof player.name !== "string" || !player.name || player.name !== cleanName(player.name) || player.color !== CORE_BALL_COLORS[index] || !count(player.score) || (value.mode === "coop" && player.score !== 0)) || new Set(value.players.map((player) => player.id)).size !== value.players.length || new Set(value.players.map((player) => player.name.toLocaleLowerCase("de"))).size !== value.players.length) return invalid();
  const ids = new Set(value.players.map((player) => player.id));
  if (!ids.has(value.hostPlayerId) || !ids.has(value.activePlayerId) || !count(value.level, 1) || !count(value.attemptId, 1) || !count(value.turnId, value.attemptId) || !count(value.completedLevels) || value.completedLevels !== value.level - 1 || !count(value.collisions) || value.attemptId !== value.completedLevels + value.collisions + 1 || !finiteTime(value.elapsedMs) || !finiteTime(value.lockedUntil) || (value.phase === "playing" ? !finiteTime(value.runningSince) : value.runningSince !== null)) return invalid();
  const layout = coreBallLevel(value.level);
  if (!Array.isArray(value.pins) || value.pins.length < layout.initialPins || value.pins.length > layout.initialPins + layout.newPins || !count(value.remaining, 1) || value.remaining !== layout.initialPins + layout.newPins - value.pins.length || !value.contributions || typeof value.contributions !== "object" || Array.isArray(value.contributions) || Object.keys(value.contributions).length !== ids.size) return invalid();
  for (const [index, pin] of value.pins.entries()) {
    if (!pin || !finiteTime(pin.angle) || pin.angle >= TAU || (index < layout.initialPins ? pin.playerId !== null || Math.abs(pin.angle - TAU * index / layout.initialPins) > 1e-10 : !ids.has(pin.playerId!))) return invalid();
    if (value.pins.slice(0, index).some((other) => Math.hypot(Math.cos(pin.angle) - Math.cos(other.angle), Math.sin(pin.angle) - Math.sin(other.angle)) <= 2 * CORE_BALL_PIN_RADIUS + 1e-12)) return invalid();
  }
  for (const id of ids) if (!Object.hasOwn(value.contributions, id) || !count(value.contributions[id]) || value.contributions[id] !== value.pins.filter((pin) => pin.playerId === id).length) return invalid();
  if (!count(value.turnHits) || value.turnHits > value.contributions[value.activePlayerId]) return invalid();
  if (value.lastEvent !== null) {
    const event = value.lastEvent;
    if (!event || !textId(event.id) || !["shot", "collision", "level-complete", "handoff", "ready", "skip", "finish"].includes(event.type) || !finiteTime(event.at) || !ids.has(event.playerId) || !count(event.level, 1) || event.level > value.level || (["shot", "collision", "level-complete"].includes(event.type) ? !finiteTime(event.angle) || event.angle >= TAU : event.angle !== undefined)) return invalid();
  }
  if (value.phase === "finished") {
    if (!value.result || !Array.isArray(value.result.winnerIds) || value.result.completedLevels !== value.completedLevels || JSON.stringify(value.result.winnerIds) !== JSON.stringify(outcome(value).winnerIds)) return invalid();
  } else if (value.result !== null) return invalid();
  const sanitized: CoreBallGame = {
    version: 1, id: value.id, mode: value.mode, players: value.players.map(({ id, name, color, score }) => ({ id, name, color, score })), hostPlayerId: value.hostPlayerId,
    phase: value.phase, level: value.level, attemptId: value.attemptId, turnId: value.turnId, activePlayerId: value.activePlayerId,
    pins: value.pins.map(({ angle, playerId }) => ({ angle, playerId })), remaining: value.remaining, contributions: Object.fromEntries([...ids].map((id) => [id, value.contributions[id]])),
    turnHits: value.turnHits, elapsedMs: value.elapsedMs, runningSince: value.runningSince, lockedUntil: value.lockedUntil,
    completedLevels: value.completedLevels, collisions: value.collisions,
    lastEvent: value.lastEvent === null ? null : { id: value.lastEvent.id, type: value.lastEvent.type, at: value.lastEvent.at, playerId: value.lastEvent.playerId, level: value.lastEvent.level, ...(value.lastEvent.angle === undefined ? {} : { angle: value.lastEvent.angle }) },
    result: value.result === null ? null : { winnerIds: [...value.result.winnerIds], completedLevels: value.result.completedLevels },
  };
  return coreBallLocalSnapshot(sanitized, now);
}
