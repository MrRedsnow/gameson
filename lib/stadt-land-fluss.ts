export const DEFAULT_COLUMNS = ["Stadt", "Land", "Fluss", "Tier", "Beruf"];
export const DEFAULT_TIMER_SECONDS = 120;
export const MAX_PLAYERS = 22;
export const LETTERS = "ABCDEFGHIJKLMNOPRSTUW";
export type SlfSettings = { columns: string[]; timerSeconds: number | null; rounds: number };
export type SlfPlayer = { id: string; name: string };
export type SlfAnswers = { values: string[]; sequence: number; submitted: boolean };
export type SlfChallenge = { playerId: string; column: number; votes: Record<string, boolean> };
export type SlfRound = {
  id: string; number: number; letter: string; columns: string[]; startedAt: number; endsAt: number | null;
  stoppedAt: number | null; stopReason: "timer" | "host" | "submitted" | null;
  answers: Record<string, SlfAnswers>; challenges: Record<string, SlfChallenge>; ready: string[];
  points: Record<string, number[]>;
};
export type SlfGame = {
  id: string; phase: "writing" | "review" | "results" | "finished"; players: SlfPlayer[];
  rounds: number; usedLetters: string[]; scores: Record<string, number>; round: SlfRound;
  history: { number: number; letter: string; scores: Record<string, number> }[];
};
// The same shape is used in the browser, but during writing answers contains only the viewer's row.
export type SlfView = SlfGame & { progress: { id: string; submitted: boolean }[] };
export type SlfState = {
  serverNow: number;
  lobby: { id: string; name: string; hostPlayerId: string; settings: SlfSettings; discoverable: boolean; revision: number };
  members: SlfPlayer[]; me: SlfPlayer; game: SlfView | null;
};
export type SlfAction =
  | { type: "answers"; roundId: string; values: string[]; sequence: number; submit?: boolean }
  | { type: "stop"; roundId: string }
  | { type: "challenge"; roundId: string; playerId: string; column: number }
  | { type: "vote"; roundId: string; playerId: string; column: number; valid: boolean }
  | { type: "ready"; roundId: string }
  | { type: "score"; roundId: string; force?: boolean }
  | { type: "next"; roundId: string };

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
export function normalizedAnswer(value: string) { return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("de").replace(/ß/g, "ss").trim().replace(/\s+/g, " "); }
export function validInitial(value: string, letter: string) { return normalizedAnswer(value).startsWith(letter.toLowerCase()); }
export function validateColumns(value: unknown): string[] {
  check(Array.isArray(value) && value.length >= 2 && value.length <= 12, "Wähle 2 bis 12 Spalten.");
  const columns = value.map((item: unknown) => {
    check(typeof item === "string", "Jede Spalte braucht einen Namen.");
    const name = item.normalize("NFKC").trim().replace(/\s+/g, " ");
    check(name.length > 0 && name.length <= 30, "Spaltennamen müssen 1 bis 30 Zeichen lang sein.");
    return name;
  });
  check(new Set(columns.map(normalizedAnswer)).size === columns.length, "Jede Spalte braucht einen anderen Namen.");
  return columns;
}
export function validateTimer(value: unknown): number | null {
  if (value === null) return null;
  check(typeof value === "number" && Number.isInteger(value) && value >= 15 && value <= 1800, "Der Timer muss zwischen 15 und 1800 Sekunden liegen.");
  return value;
}
export function validateSettings(value: unknown): SlfSettings {
  check(value && typeof value === "object" && !Array.isArray(value), "Ungültige Spieleinstellungen.");
  const data = value as Record<string, unknown>;
  check(typeof data.rounds === "number" && Number.isInteger(data.rounds) && data.rounds >= 1 && data.rounds <= 20, "Wähle 1 bis 20 Runden.");
  return { columns: validateColumns(data.columns), timerSeconds: validateTimer(data.timerSeconds), rounds: data.rounds };
}
export function randomIndex(length: number) {
  const values = new Uint32Array(1); const limit = Math.floor(0x100000000 / length) * length;
  do { crypto.getRandomValues(values); } while (values[0] >= limit);
  return values[0] % length;
}
function newRound(players: SlfPlayer[], settings: SlfSettings, number: number, used: string[], now: number, random: (length: number) => number): SlfRound {
  const available = [...LETTERS].filter((letter) => !used.includes(letter));
  return { id: crypto.randomUUID(), number, letter: available[random(available.length)], columns: [...settings.columns], startedAt: now,
    endsAt: settings.timerSeconds === null ? null : now + settings.timerSeconds * 1000, stoppedAt: null, stopReason: null,
    answers: Object.fromEntries(players.map((p) => [p.id, { values: settings.columns.map(() => ""), sequence: 0, submitted: false }])), challenges: {}, ready: [], points: {} };
}
export function createSlfGame(players: SlfPlayer[], settings: SlfSettings, now = Date.now(), random = randomIndex): SlfGame {
  validateSettings(settings);
  check(players.length >= 2 && players.length <= MAX_PLAYERS, `Ihr braucht 2 bis ${MAX_PLAYERS} Personen.`);
  check(new Set(players.map((p) => p.id)).size === players.length, "Die Plätze müssen unterschiedlich sein.");
  const round = newRound(players, settings, 1, [], now, random);
  return { id: crypto.randomUUID(), phase: "writing", players: players.map(({ id, name }) => ({ id, name })), rounds: settings.rounds,
    usedLetters: [round.letter], scores: Object.fromEntries(players.map((p) => [p.id, 0])), round, history: [] };
}
function stopRound(game: SlfGame, now: number, reason: SlfRound["stopReason"]) { game.phase = "review"; game.round.stoppedAt = now; game.round.stopReason = reason; }
/** Called before every server read/write: the deadline is enforced even if nobody sends a stop action. */
export function expireSlfRound(game: SlfGame, now: number): boolean {
  if (game.phase !== "writing" || game.round.endsAt === null || now < game.round.endsAt) return false;
  stopRound(game, game.round.endsAt, "timer"); return true;
}
export function changeSlfTimer(game: SlfGame, seconds: number | null, now: number) {
  validateTimer(seconds);
  if (game.phase === "writing") game.round.endsAt = seconds === null ? null : now + seconds * 1000;
}
export function challengeKey(playerId: string, column: number) { return `${playerId}:${column}`; }
export function voteSummary(challenge: SlfChallenge) {
  const votes = Object.values(challenge.votes); const yes = votes.filter(Boolean).length;
  return { yes, no: votes.length - yes, total: votes.length, valid: yes >= votes.length - yes };
}
export function answerIsValid(game: SlfGame, playerId: string, column: number) {
  const value = game.round.answers[playerId]?.values[column] ?? "";
  if (!validInitial(value, game.round.letter)) return false;
  const challenge = game.round.challenges[challengeKey(playerId, column)];
  return !challenge || voteSummary(challenge).valid;
}
export function calculateSlfPoints(game: SlfGame): Record<string, number[]> {
  return Object.fromEntries(game.players.map((player) => [player.id, game.round.columns.map((_, column) => {
    if (!answerIsValid(game, player.id, column)) return 0;
    const valid = game.players.filter((p) => answerIsValid(game, p.id, column));
    if (valid.length === 1) return 20;
    const answer = normalizedAnswer(game.round.answers[player.id].values[column]);
    return valid.filter((p) => normalizedAnswer(game.round.answers[p.id].values[column]) === answer).length > 1 ? 5 : 10;
  })]));
}
/** Work on the latest committed game. Callers retry CAS conflicts, never replace another person's answers. */
export function applySlfAction(input: SlfGame, actorId: string, hostId: string, action: SlfAction, settings: SlfSettings, now = Date.now(), random = randomIndex): SlfGame {
  const game = structuredClone(input); const round = game.round;
  check(game.players.some((p) => p.id === actorId), "Du spielst in dieser Partie nicht mit.");
  check(action && typeof action === "object" && action.roundId === round.id, "Diese Runde ist nicht mehr aktuell.");
  expireSlfRound(game, now);
  const host = () => check(actorId === hostId, "Das kann nur der Lobby-Master tun.");
  const review = () => check(game.phase === "review", "Die Abstimmung ist gerade nicht geöffnet.");
  const target = (playerId: string, column: number) => {
    check(typeof playerId === "string" && game.players.some((p) => p.id === playerId) && Number.isInteger(column) && column >= 0 && column < round.columns.length, "Diese Antwort gibt es nicht.");
    check(validInitial(round.answers[playerId].values[column], round.letter), "Leere Antworten und falsche Anfangsbuchstaben zählen automatisch 0 Punkte.");
    return challengeKey(playerId, column);
  };
  switch (action.type) {
    case "answers": {
      check(game.phase === "writing", "Die Schreibzeit ist vorbei. Gewertet werden die zuletzt gespeicherten Antworten.");
      const row = round.answers[actorId];
      check(Array.isArray(action.values) && action.values.length === round.columns.length && action.values.every((v) => typeof v === "string" && v.length <= 80), "Bitte gib höchstens 80 Zeichen pro Antwort ein.");
      check(Number.isSafeInteger(action.sequence) && action.sequence > 0, "Ungültige Eingabefolge.");
      check(action.submit === undefined || typeof action.submit === "boolean", "Ungültige Abgabe.");
      // A delayed autosave or duplicate submission may never overwrite a newer row or unlock a submitted row.
      if (row.submitted || action.sequence <= row.sequence) return game;
      row.values = action.values.map((v) => v.normalize("NFKC").trim().replace(/\s+/g, " "));
      row.sequence = action.sequence; row.submitted = action.submit === true;
      if (game.players.every((p) => round.answers[p.id].submitted)) stopRound(game, now, "submitted");
      break;
    }
    case "stop": host(); check(game.phase === "writing", "Die Schreibphase ist bereits vorbei."); stopRound(game, now, "host"); break;
    case "challenge": {
      review(); const key = target(action.playerId, action.column);
      if (!round.challenges[key]) { round.challenges[key] = { playerId: action.playerId, column: action.column, votes: {} }; round.ready = []; }
      break;
    }
    case "vote": {
      review(); const key = target(action.playerId, action.column);
      check(typeof action.valid === "boolean" && round.challenges[key], "Zweifle die Antwort zuerst an.");
      round.challenges[key].votes[actorId] = action.valid; round.ready = round.ready.filter((id) => id !== actorId); break;
    }
    case "ready": {
      review(); check(Object.values(round.challenges).every((c) => typeof c.votes[actorId] === "boolean"), "Stimme zuerst über alle angezweifelten Antworten ab.");
      if (!round.ready.includes(actorId)) round.ready.push(actorId); break;
    }
    case "score": {
      host(); review(); check(action.force === undefined || typeof action.force === "boolean", "Ungültige Wertung.");
      check(action.force === true || game.players.every((p) => round.ready.includes(p.id)), "Noch nicht alle haben die Wertung bestätigt.");
      round.points = calculateSlfPoints(game);
      const scores: Record<string, number> = {};
      for (const p of game.players) { scores[p.id] = round.points[p.id].reduce((a, b) => a + b, 0); game.scores[p.id] += scores[p.id]; }
      game.history.push({ number: round.number, letter: round.letter, scores });
      game.phase = round.number >= game.rounds ? "finished" : "results"; break;
    }
    case "next": {
      host(); check(game.phase === "results", "Wertet zuerst die aktuelle Runde aus.");
      game.round = newRound(game.players, settings, round.number + 1, game.usedLetters, now, random);
      game.usedLetters.push(game.round.letter); game.phase = "writing"; break;
    }
    default: throw new Error("Unbekannte Spielaktion.");
  }
  return game;
}
export function slfView(game: SlfGame, viewerId: string): SlfView {
  const copy = structuredClone(game);
  if (game.phase === "writing") copy.round.answers = game.round.answers[viewerId] ? { [viewerId]: structuredClone(game.round.answers[viewerId]) } : {};
  return { ...copy, progress: game.players.map((p) => ({ id: p.id, submitted: game.round.answers[p.id].submitted })) };
}
export function remainingSeconds(endsAt: number | null, serverNow: number) { return endsAt === null ? null : Math.max(0, Math.ceil((endsAt - serverNow) / 1000)); }
export function formatTime(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
