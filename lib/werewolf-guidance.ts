import type { WerewolfPhase } from "./werewolf";

export type Guidance = {
  status: "action" | "waiting" | "confirmed";
  label: string;
  title: string;
  instruction: string;
  requiresConfirmation: boolean;
};

export const ACTION_INSTRUCTIONS: Partial<Record<WerewolfPhase, { title: string; instruction: string }>> = {
  mayor_vote: { title: "Wähle euren Bürgermeister.", instruction: "Seine Stimme zählt bei Dorfabstimmungen doppelt." },
  day_vote: { title: "Wen verdächtigst du?", instruction: "Wähle die Person, die das Dorf verlassen soll." },
  runoff: { title: "Entscheide die Stichwahl.", instruction: "Zur Wahl stehen nur die Personen mit den meisten Stimmen." },
  wolves: { title: "Wähle das Opfer des Rudels.", instruction: "Die Werwölfe stimmen gemeinsam über ihr nächtliches Opfer ab." },
  seer: { title: "Wessen Rolle möchtest du sehen?", instruction: "Wähle eine Person. Nach deiner Bestätigung erfährst du ihre Rolle." },
  healer: { title: "Wen möchtest du beschützen?", instruction: "Deine Wahl schützt diese Person in dieser Nacht vor dem Rudel." },
  cupid: { title: "Verbinde zwei Personen.", instruction: "Wähle genau zwei unterschiedliche Personen als Liebespaar." },
  wild_child: { title: "Wähle dein Vorbild.", instruction: "Stirbt dein Vorbild, wechselst du auf die Seite der Werwölfe." },
  hunter: { title: "Auf wen fällt dein letzter Schuss?", instruction: "Deine Wahl scheidet mit dir aus. Diese Entscheidung musst du selbst bestätigen." },
  white_werewolf: { title: "Jagen oder diese Nacht auslassen?", instruction: "Du kannst einen anderen Wolf wählen oder ohne Opfer fortfahren." },
  piper: { title: "Wen möchtest du verzaubern?", instruction: "Wähle eine oder zwei Personen, die noch nicht verzaubert sind." },
  thief: { title: "Welche Rolle möchtest du spielen?", instruction: "Wähle eine Rollenkarte. Erst mit deiner Bestätigung wird sie übernommen." },
  witch: { title: "Möchtest du einen Trank einsetzen?", instruction: "Jeder Trank ist nur einmal verfügbar. Du kannst auch beide aufbewahren." },
};

export function getGameGuidance({ phase, alive, isHost, submitted, hasAction, seerResult, startsNight = false, hostName = "Die Spielleitung" }: {
  phase: WerewolfPhase; alive: boolean; isHost: boolean; submitted: boolean;
  hasAction: boolean; seerResult?: boolean; startsNight?: boolean; hostName?: string;
}): Guidance {
  const waiting = (title: string, instruction: string): Guidance => ({ status: "waiting", label: "Nichts zu bestätigen", title, instruction, requiresConfirmation: false });
  const action = (title: string, instruction: string): Guidance => ({ status: "action", label: "Du bist dran", title, instruction, requiresConfirmation: true });
  const confirmed = (title: string, instruction: string): Guidance => ({ status: "confirmed", label: "Bestätigt", title, instruction, requiresConfirmation: false });

  if (phase === "results") return isHost
    ? action("Bereit für eine neue Partie?", "Mit „Neue Partie vorbereiten“ kommt ihr zurück in die Lobby.")
    : waiting("Die Partie ist vorbei.", `${hostName} kann eine neue Partie vorbereiten. Du musst nichts bestätigen.`);
  if (phase === "role_reveal") return submitted
    ? confirmed("Du bist bereit.", "Du musst nichts mehr antippen. Sobald alle ihre Rolle bestätigt haben, beginnt die Partie automatisch.")
    : action("Sieh dir deine geheime Rolle an.", "Öffne deine Rollenkarte. Lies sie und bestätige anschließend, dass du bereit bist.");
  if (!alive && !(phase === "hunter" && hasAction && !submitted) && !(phase === "discussion" && isHost)) return waiting("Du schaust als Geist zu.", "Du bist ausgeschieden und musst nichts bestätigen. Verrate den anderen keine geheimen Informationen.");
  if (phase === "dawn") return submitted
    ? confirmed(startsNight ? "Du bist bereit für die Nacht." : "Du bist aufgestanden.", "Du musst nichts mehr antippen. Sobald alle bereit sind, geht es automatisch weiter.")
    : action(startsNight ? "Bestätige, dass du bereit bist." : "Bestätige, dass du aufgewacht bist.", startsNight ? "Beende deine Gespräche. Tippe unten auf „Bereit für die Nacht“ und schließe danach die Augen." : "Lies, was im Dorf passiert ist. Tippe dann unten auf „Ich bin aufgestanden“.");
  if (phase === "discussion") return isHost
    ? action("Sprecht über euren Verdacht.", "Du leitest die Runde. Wenn alle fertig diskutiert haben, tippe unten auf „Abstimmung starten“.")
    : waiting("Diskutiert jetzt gemeinsam.", `${hostName} startet anschließend die Abstimmung. Auf deinem Gerät ist keine Bestätigung nötig.`);
  if (phase === "seer" && submitted && seerResult) return action("Lies das Ergebnis und bestätige es.", "Die Nacht wartet auf dich. Tippe anschließend auf „Ergebnis gelesen“.");
  if (submitted) return confirmed("Deine Entscheidung ist bestätigt.", "Du musst nichts mehr antippen. Der nächste Schritt öffnet sich automatisch, sobald alle fertig sind.");
  if (hasAction) {
    const copy = ACTION_INSTRUCTIONS[phase];
    return action(copy?.title ?? "Triff jetzt deine Entscheidung.", copy?.instruction ?? "Wähle eine Person und bestätige deine Auswahl unten.");
  }
  return waiting("Eine andere Rolle ist dran.", "Du musst nichts antippen oder bestätigen. Warte auf das nächste Signal; die Ansicht wechselt automatisch.");
}

export function getSelectionGuidance(phase: WerewolfPhase, names: string[]) {
  const needsPair = phase === "cupid";
  const mayPass = phase === "white_werewolf";
  const valid = names.length > 0 && (!needsPair || names.length === 2);
  return {
    valid: valid || mayPass,
    summary: names.length ? names.join(" & ") : mayPass ? "Diese Nacht ohne Opfer" : "Noch keine Auswahl",
    instruction: valid || mayPass ? "Noch nicht bestätigt. Tippe auf den blauen Knopf." : needsPair && names.length === 1 ? "Wähle noch eine zweite Person." : needsPair ? "Wähle zuerst zwei Personen." : "Wähle zuerst eine Person aus.",
    buttonLabel: mayPass && !names.length ? "Ohne Opfer bestätigen" : ["mayor_vote", "day_vote", "runoff", "wolves"].includes(phase) ? "Stimme bestätigen" : "Auswahl bestätigen",
  };
}
