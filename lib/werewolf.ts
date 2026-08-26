export type WerewolfRole =
  | "werewolf"
  | "villager"
  | "seer"
  | "witch"
  | "hunter"
  | "cupid"
  | "thief"
  | "healer"
  | "piper"
  | "wild_child"
  | "elder"
  | "scapegoat"
  | "white_werewolf";

export type WerewolfTeam = "village" | "wolf" | "solo";
export type DeathCause =
  | "wolf_attack"
  | "witch_poison"
  | "white_werewolf"
  | "village_vote"
  | "scapegoat"
  | "hunter_shot"
  | "heartbreak";
export type WerewolfPhase =
  | "waiting"
  | "role_reveal"
  | "mayor_vote"
  | "thief"
  | "cupid"
  | "wild_child"
  | "healer"
  | "seer"
  | "wolves"
  | "witch"
  | "white_werewolf"
  | "piper"
  | "dawn"
  | "discussion"
  | "day_vote"
  | "runoff"
  | "hunter"
  | "results";

export type WerewolfPlayerState = {
  id: string;
  role: WerewolfRole;
  alive: boolean;
  team: WerewolfTeam;
  charmed?: boolean;
  loverId?: string | null;
  roleModelId?: string | null;
  elderShield?: boolean;
};

export const ROLE_INFO: Record<WerewolfRole, { label: string; team: WerewolfTeam; description: string }> = {
  werewolf: { label: "Werwolf", team: "wolf", description: "Wählt jede Nacht gemeinsam ein Opfer aus dem Dorf." },
  villager: { label: "Dorfbewohner", team: "village", description: "Findet in der Diskussion die Werwölfe und stimmt sie aus dem Dorf." },
  seer: { label: "Seherin", team: "village", description: "Erkennt jede Nacht die genaue Rolle einer lebenden Person." },
  witch: { label: "Hexe", team: "village", description: "Besitzt einmalig einen Heiltrank und einen Gifttrank. Beide dürfen in derselben Nacht eingesetzt werden." },
  hunter: { label: "Jäger", team: "village", description: "Nimmt beim eigenen Tod sofort eine lebende Person mit." },
  cupid: { label: "Amor", team: "village", description: "Verbindet in der ersten Nacht zwei Personen. Stirbt eine, stirbt auch die andere." },
  thief: { label: "Dieb", team: "village", description: "Darf zu Beginn die eigene Rolle behalten oder eine von zwei verdeckten Reservekarten übernehmen." },
  healer: { label: "Heiler", team: "village", description: "Schützt jede Nacht eine Person vor dem Wolfsangriff, aber nie dieselbe Person zweimal hintereinander." },
  piper: { label: "Flötenspieler", team: "solo", description: "Verzaubert jede Nacht bis zu zwei Personen und gewinnt, wenn alle anderen Lebenden verzaubert sind." },
  wild_child: { label: "Wolfskind", team: "village", description: "Wählt ein Vorbild und wird nach dessen Tod ab der folgenden Nacht zum Werwolf." },
  elder: { label: "Der Alte", team: "village", description: "Überlebt den ersten Angriff des Werwolfrudels." },
  scapegoat: { label: "Sündenbock", team: "village", description: "Stirbt, wenn auch der Stichentscheid der Dorfabstimmung unentschieden endet." },
  white_werewolf: { label: "Weiße Werwölfin", team: "solo", description: "Jagt mit dem Rudel, tötet in jeder zweiten Nacht zusätzlich einen Wolf und gewinnt nur allein." },
};

export const DEATH_CAUSE_INFO: Record<DeathCause, { label: string; shortLabel: string }> = {
  wolf_attack: { label: "Vom Werwolfrudel gerissen", shortLabel: "Wolfsangriff" },
  witch_poison: { label: "Vom Gifttrank der Hexe vergiftet", shortLabel: "Hexengift" },
  white_werewolf: { label: "Von der Weißen Werwölfin getötet", shortLabel: "Weiße Werwölfin" },
  village_vote: { label: "Durch die Entscheidung des Dorfs gestorben", shortLabel: "Dorfentscheidung" },
  scapegoat: { label: "Als Sündenbock für den Gleichstand gestorben", shortLabel: "Sündenbock" },
  hunter_shot: { label: "Vom letzten Schuss des Jägers getroffen", shortLabel: "Jägerschuss" },
  heartbreak: { label: "Aus Liebeskummer gestorben", shortLabel: "Liebeskummer" },
};

export function parseDeathCauses(value: unknown): DeathCause[] {
  const valid = new Set(Object.keys(DEATH_CAUSE_INFO));
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((cause): cause is DeathCause => typeof cause === "string" && valid.has(cause)) : [];
  } catch {
    return [];
  }
}

export function countVillageDecisionDeaths(players: { deathCauses: readonly DeathCause[] }[]) {
  return players.filter((player) => player.deathCauses.some((cause) => cause === "village_vote" || cause === "scapegoat")).length;
}

export function villageGuiltIntensity(deathCount: number) {
  if (!Number.isFinite(deathCount) || deathCount < 1) return 0;
  return 1 + Math.log2(deathCount) * 1.75;
}

export const SELECTABLE_ROLES: WerewolfRole[] = [
  "seer", "witch", "hunter", "cupid", "thief", "healer", "piper", "wild_child", "elder", "scapegoat", "white_werewolf",
];

export function defaultWolfCount(players: number) {
  return Math.max(1, Math.floor(players / 4));
}

export function maxWolfCount(players: number) {
  return Math.max(1, Math.floor((players - 1) / 2));
}

export function minimumPlayersForRole(role: WerewolfRole) {
  if (role === "thief") return 4;
  if (role === "piper" || role === "white_werewolf") return 5;
  return 3;
}

export function validateRoleSetup(players: number, wolfCount: number, roles: WerewolfRole[]) {
  if (!Number.isInteger(players) || players < 3 || players > 22) return "Werwolf ist für 3 bis 22 Personen ausgelegt.";
  if (!Number.isInteger(wolfCount) || wolfCount < 1 || wolfCount > maxWolfCount(players)) return `Wähle zwischen 1 und ${maxWolfCount(players)} Wolfsslots.`;
  const unique = new Set(roles);
  if (unique.size !== roles.length || roles.some((role) => !SELECTABLE_ROLES.includes(role))) return "Die Rollenauswahl ist ungültig.";
  const unavailable = roles.find((role) => players < minimumPlayersForRole(role));
  if (unavailable) return `${ROLE_INFO[unavailable].label} ist erst ab ${minimumPlayersForRole(unavailable)} Personen verfügbar.`;
  if (unique.has("white_werewolf") && wolfCount < 2) return "Die Weiße Werwölfin benötigt mindestens zwei Wolfsslots.";
  const villageSpecials = roles.filter((role) => role !== "white_werewolf").length;
  if (wolfCount + villageSpecials > players - 1) return "Mindestens eine Person muss einfacher Dorfbewohner bleiben.";
  return null;
}

export function buildRoleDeck(players: number, wolfCount: number, roles: WerewolfRole[], randomIndex: (length: number) => number = (length) => Math.floor(Math.random() * length)) {
  const error = validateRoleSetup(players, wolfCount, roles);
  if (error) throw new Error(error);
  const deck: WerewolfRole[] = [];
  if (roles.includes("white_werewolf")) {
    deck.push("white_werewolf");
    deck.push(...Array.from({ length: wolfCount - 1 }, () => "werewolf" as const));
  } else {
    deck.push(...Array.from({ length: wolfCount }, () => "werewolf" as const));
  }
  deck.push(...roles.filter((role) => role !== "white_werewolf"));
  while (deck.length < players) deck.push("villager");
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swap = randomIndex(index + 1);
    if (!Number.isInteger(swap) || swap < 0 || swap > index) throw new Error("Die Zufallsauswahl lieferte einen ungültigen Index.");
    [deck[index], deck[swap]] = [deck[swap], deck[index]];
  }
  return deck;
}

export function roleTeam(role: WerewolfRole): WerewolfTeam {
  return ROLE_INFO[role].team;
}

export function weightedVoteLeaders(votes: { voterId: string; targetId: string }[], mayorId: string | null) {
  const totals = new Map<string, number>();
  for (const vote of votes) totals.set(vote.targetId, (totals.get(vote.targetId) ?? 0) + (vote.voterId === mayorId ? 2 : 1));
  const max = Math.max(0, ...totals.values());
  return { max, leaders: [...totals.entries()].filter(([, count]) => count === max).map(([id]) => id), totals: Object.fromEntries(totals) };
}

export type Winner = "village" | "wolves" | "piper" | "white_werewolf" | null;

export function determineWinner(players: WerewolfPlayerState[]): Winner {
  const living = players.filter((player) => player.alive);
  const white = living.find((player) => player.role === "white_werewolf");
  if (living.length === 1 && white) return "white_werewolf";
  const piper = living.find((player) => player.role === "piper");
  if (piper && living.filter((player) => player.id !== piper.id).every((player) => player.charmed)) return "piper";
  const pack = living.filter((player) => player.team === "wolf");
  const wolfAligned = living.filter((player) => player.team === "wolf" || player.role === "white_werewolf");
  if (wolfAligned.length === 0) return "village";
  if (!white && pack.length >= living.length - pack.length) return "wolves";
  return null;
}

export function nextNightPhase(roles: WerewolfRole[], night: number): WerewolfPhase[] {
  const phases: WerewolfPhase[] = [];
  if (roles.includes("healer")) phases.push("healer");
  if (roles.includes("seer")) phases.push("seer");
  phases.push("wolves");
  if (roles.includes("witch")) phases.push("witch");
  if (roles.includes("white_werewolf") && night % 2 === 0) phases.push("white_werewolf");
  if (roles.includes("piper")) phases.push("piper");
  return phases;
}

export function phaseAfterDawn(resolutionSource: "night" | "day") {
  return resolutionSource === "night" ? "discussion" as const : "night" as const;
}
