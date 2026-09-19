"use client";

import { useState, type ReactNode } from "react";
import { Bell, BookOpen, CheckCheck, LockKeyhole, ScrollText, Trophy, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GameBackLink } from "@/components/game-entry";
import { PLAYER_COLORS, PLAYER_COLOR_NAMES, resourceCount, victoryPoints, type CatanView } from "@/lib/catan";
import { type CatanActivity } from "@/lib/catan-notifications";
import { BagText, Pager, Screen } from "./play-primitives";

const RULES = [
  { title: "Ziel des Spiels", text: "Erreiche das gewählte Siegpunktziel im eigenen Zug. Eine Siedlung zählt 1, eine Stadt 2 Punkte. Verdeckte Siegpunktkarten zählen mit. Die längste Handelsstraße und die größte Rittermacht bringen jeweils 2 Sonderpunkte." },
  { title: "Die ersten Siedlungen", text: "Alle setzen zuerst eine Siedlung und eine angrenzende Straße. Danach geht es in umgekehrter Reihenfolge zurück. Zwischen zwei Siedlungen bleibt immer eine Kreuzung frei. Nur deine zweite Siedlung bringt sofort einen Rohstoff aus jedem angrenzenden Rohstofffeld." },
  { title: "Würfeln und Ernten", text: "Die Summe der beiden Würfel bestimmt die Felder, die Ertrag liefern. Eine angrenzende Siedlung erhält 1, eine Stadt 2 Rohstoffe. Auch außerhalb deines Zuges bekommst du Ertrag. Das Räuberfeld liefert nichts. Ist die Bank knapp, kann Ertrag ausfallen." },
  { title: "Eine 7 und der Räuber", text: "Mit mehr als 7 Rohstoffkarten gibst du die Hälfte ab, abgerundet. Entwicklungskarten zählen nicht mit. Danach versetzt die Person am Zug den Räuber auf ein anderes Feld und stiehlt einer angrenzenden Person eine zufällige Rohstoffkarte." },
  { title: "Bauen", text: "Straße: 1 Holz + 1 Lehm. Siedlung: je 1 Holz, Lehm, Wolle und Getreide. Stadt: 2 Getreide + 3 Erz. Neue Siedlungen müssen an dein Straßennetz anschließen. Eine Stadt ersetzt eine eigene Siedlung. Du hast 15 Straßen, 5 Siedlungen und 4 Städte." },
  { title: "Handeln", text: "Nach dem Würfeln darfst du in beliebiger Reihenfolge handeln und bauen. Mitspielende handeln mit der Person am Zug. Die Bank tauscht im eigenen Zug 4 gleiche Rohstoffe gegen 1 anderen. Mit einem eigenen Hafen gilt 3:1, beim passenden Rohstoffhafen 2:1." },
  { title: "Entwicklungskarten", text: "Eine Karte kostet 1 Wolle + 1 Getreide + 1 Erz. Du darfst höchstens eine Entwicklungskarte pro Zug spielen, frühestens im nächsten Zug – auch vor dem Würfeln. Siegpunktkarten zählen sofort und werden nicht ausgespielt. Die Wirkung jeder Karte steht unter „Karten“." },
  { title: "Sonderpunkte", text: "Die längste zusammenhängende Handelsstraße bringt ab 5 Straßen 2 Punkte. Eigene Abzweigungen zählen nicht doppelt; gegnerische Siedlungen unterbrechen den Weg. Die größte Rittermacht bringt ab 3 ausgespielten Rittern 2 Punkte. Bei Gleichstand behält die bisherige Person die Sonderkarte." },
  { title: "Gute Bauplätze erkennen", text: "Unter den Ertragszahlen fallen 6 und 8 am häufigsten: jeweils bei 5 von 36 Würfelkombinationen. 5 und 9 kommen auf 4, 4 und 10 auf 3, 3 und 11 auf 2, 2 und 12 auf 1. Verschiedene Rohstoffe und Zahlen machen dich unabhängiger von einzelnen Würfen." },
];
export type OverviewPage = "menu" | "scores" | "log" | "rules" | "activity";

export function OverviewPanel({ game, page, setPage, activity, unread, onRead, local, onHide, onRematch, busy, turnActions }: {
  game: CatanView; page: OverviewPage; setPage: (page: OverviewPage) => void; activity: CatanActivity[]; unread: number; onRead: () => void;
  local: boolean; onHide?: () => void; onRematch?: () => void; busy: boolean; turnActions?: ReactNode;
}) {
  const [rule, setRule] = useState(0); const [event, setEvent] = useState(0);
  const me = game.me!; const back = () => setPage("menu");
  if (page === "rules") return <Screen title={RULES[rule].title} eyebrow="Spielregeln" back={back}>
    <p className="catan-rule-page">{RULES[rule].text}</p>
    {rule === 0 && <p className="catan-inline-hint">Euer Ziel: {game.targetPoints} Punkte.</p>}
    <Pager index={rule} total={RULES.length} onChange={setRule} />
  </Screen>;
  if (page === "log") return <Screen title="Spielverlauf" back={back}>{[...game.log].reverse().map((entry) => <p className="catan-log-entry" key={entry.id}>{entry.text}</p>)}</Screen>;
  if (page === "activity") {
    const entries = [...activity].reverse(); const index = Math.min(event, Math.max(0, entries.length - 1)); const entry = entries[index];
    return <Screen title="Deine Meldungen" back={back} headingAction={unread ? <Button variant="outline" size="icon" aria-label="Alle Meldungen als gelesen markieren" title="Alle als gelesen markieren" onClick={onRead}><CheckCheck /></Button> : undefined}>
      {entry ? <><article className="catan-activity-entry"><h3>{entry.title}</h3><p>{entry.message}</p>{resourceCount(entry.losses) > 0 && <p className="is-loss"><strong>Abgegeben:</strong> <BagText bag={entry.losses} /></p>}{resourceCount(entry.gains) > 0 && <p className="is-gain"><strong>Erhalten:</strong> <BagText bag={entry.gains} /></p>}</article><Pager index={index} total={entries.length} label="Meldung" onChange={setEvent} /></> : <p>Noch keine Meldungen. Deine Rohstoffe werden immer sofort aktualisiert.</p>}
    </Screen>;
  }
  if (page === "scores") return <Screen title="Punktestand" back={back}><div className="catan-score-list">{game.players.map((p) => <details className="catan-player-card" key={p.id} style={{ "--player-color": PLAYER_COLORS[p.color] } as React.CSSProperties}>
    <summary><i className="catan-player-dot" /><strong>{p.name}{p.id === me.id ? " (du)" : ""}</strong><b>{p.id === me.id ? victoryPoints(game, me) : p.points} / {game.targetPoints}</b><small>{p.resourceCount} Karten · {p.knights} Ritter · Straße {p.roadLength}</small></summary>
    <div><p>{PLAYER_COLOR_NAMES[p.color]} · {p.resourceCount} Rohstoffkarten · {p.developmentCount} Entwicklungskarten</p>
      <p>{game.longestRoad === p.id ? "Längste Straße: +2 Punkte. " : ""}{game.largestArmy === p.id ? "Größte Rittermacht: +2 Punkte." : ""}</p>
      <p>Vorrat: {15 - p.pieces.road} Straßen · {5 - p.pieces.settlement} Siedlungen · {4 - p.pieces.city} Städte</p></div>
  </details>)}</div></Screen>;
  const finished = game.phase === "finished"; const winner = game.players.find((p) => p.id === game.winner);
  return <Screen title={finished ? `${winner?.name} gewinnt!` : "Übersicht"} actions={finished && onRematch ? <Button className="catan-primary" disabled={busy} onClick={onRematch}>Neue Partie vorbereiten</Button> : turnActions}>
    {finished && <p className="catan-inline-hint"><Trophy /> {game.targetPoints} Punkte erreicht.</p>}
    <div className="catan-overview-menu">{([{ id: "scores", title: "Punktestand", Icon: Users }, { id: "log", title: "Spielverlauf", Icon: ScrollText }, { id: "rules", title: "Spielregeln & Baukosten", Icon: BookOpen }, { id: "activity", title: unread ? `Meldungen · ${unread} neu` : "Deine Meldungen", Icon: Bell }] as const).map(({ id, title, Icon }) => <Button variant="outline" key={id} onClick={() => setPage(id)}><Icon />{title}</Button>)}</div>
    <div className="catan-overview-exit">{local && onHide && !finished && <Button variant="ghost" onClick={onHide}><LockKeyhole />Hand verdecken</Button>}<GameBackLink /></div>
  </Screen>;
}
