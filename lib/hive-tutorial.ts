import { activeHivePlayer, applyHiveAction, createHiveGame, type Hex, type HiveGame, type HiveKind } from "./hive";

export const HIVE_LESSONS: { title: string; instruction: string; success: string; kind: "place" | "blocked" | "move" | "stack"; piece: HiveKind; to?: Hex }[] = [
  { title: "Setze deine Königin", instruction: "Wähle die Königin und tippe auf das markierte Feld. Die Vorschau wird erst mit deiner Bestätigung zum echten Zug.", success: "Deine Königin liegt. Jetzt dürfen deine Steine auch ziehen. Spätestens im vierten eigenen Zug muss die Königin gesetzt sein.", kind: "place", piece: "queen", to: { q: 0, r: 0 } },
  { title: "Lege an deine Farbe an", instruction: "Beispiel hat seine Königin angelegt. Setze deinen Käfer auf das markierte Feld links: Er berührt dort nur deine Farbe.", success: "Richtig angelegt. Nur beim ersten Stein darfst du die andere Farbe berühren. Danach zählen die sichtbaren Farben der Nachbarsteine.", kind: "place", piece: "beetle", to: { q: -1, r: 0 } },
  { title: "Halte den Schwarm zusammen", instruction: "Tippe auf deine weiße Königin in der Mitte. Schau dir an, warum sie in dieser Stellung nicht ziehen darf.", success: "Die Königin ist hier die Verbindung. Beim Anheben würde der Schwarm in die zwei nummerierten Gruppen zerfallen – dieser Zug ist deshalb blockiert.", kind: "blocked", piece: "queen" },
  { title: "Klettere mit dem Käfer", instruction: "Wähle deinen Käfer links und ziehe ihn auf deine Königin. Käfer dürfen auf andere Steine steigen und bleiben dabei am Schwarm.", success: "Dein Käfer liegt jetzt oben. Er blockiert die Königin darunter; seine Farbe zählt für neue Steine, die an den Stapel angelegt werden.", kind: "move", piece: "beetle", to: { q: 0, r: 0 } },
  { title: "Schau unter den Käfer", instruction: "Tippe auf den Stapel mit der kleinen 2. Die Stapelansicht zeigt alle Steine von oben nach unten.", success: "Oben liegt dein Käfer, darunter deine Königin. Auch eine verdeckte Königin kann umzingelt werden; nur der oberste Stein kann ziehen.", kind: "stack", piece: "beetle" },
  { title: "Schließe die letzte Lücke", instruction: "Neue Übungsstellung: Die schwarze Königin hat nur noch eine freie Seite. Ziehe deinen Käfer oben rechts auf das markierte Feld neben ihr.", success: "Gewonnen! Alle sechs Seiten der schwarzen Königin sind besetzt. Dafür zählen Steine beider Farben. Werden beide Königinnen gleichzeitig eingeschlossen, ist es ein Remis.", kind: "move", piece: "beetle", to: { q: 1, r: 0 } },
];

export function createHiveLesson(index: number): { game: HiveGame; pieceId: string } {
  if (!HIVE_LESSONS[index]) throw new Error("Diesen Übungsschritt gibt es nicht.");
  let game = createHiveGame([{ id: "learn-white", name: "Du" }, { id: "learn-black", name: "Beispiel" }]);
  const pieceId = (ownerId: string, kind: HiveKind) => game.pieces.find((p) => p.ownerId === ownerId && p.kind === kind)!.id;
  const play = (kind: HiveKind, type: "place" | "move", to: Hex) => {
    game = applyHiveAction(game, activeHivePlayer(game).id, { type, pieceId: pieceId(activeHivePlayer(game).id, kind), to, gameId: game.id, ply: game.ply });
  };
  if (index === 5) {
    const setup: [string, HiveKind, number, number][] = [["learn-black", "queen", 0, 0], ["learn-white", "queen", 0, 1], ["learn-white", "ant", -1, 1], ["learn-white", "ant", -1, 0], ["learn-white", "spider", 0, -1], ["learn-white", "grasshopper", 1, -1], ["learn-white", "beetle", 2, -1]];
    for (const [ownerId, kind, q, r] of setup) {
      const piece = game.pieces.find((p) => p.ownerId === ownerId && p.kind === kind && !p.position)!;
      piece.position = { q, r }; piece.level = 1;
    }
  } else {
    if (index >= 1) { play("queen", "place", { q: 0, r: 0 }); play("queen", "place", { q: 1, r: 0 }); }
    if (index >= 2) { play("beetle", "place", { q: -1, r: 0 }); play("ant", "place", { q: 2, r: 0 }); }
    if (index >= 4) { play("beetle", "move", { q: 0, r: 0 }); play("grasshopper", "place", { q: 3, r: 0 }); }
  }
  return { game, pieceId: pieceId("learn-white", HIVE_LESSONS[index].piece) };
}
