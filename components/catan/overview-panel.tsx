"use client";

import { type ReactNode } from "react";
import { Bell, BookOpen, CheckCheck, ChevronRight, ScrollText, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GameBackLink } from "@/components/game-entry";
import { COSTS, PLAYER_COLORS, PLAYER_COLOR_NAMES, RESOURCES, RESOURCE_INFO, resourceCount, victoryPoints, type CatanView } from "@/lib/catan";
import { activitySummary, type CatanActivity } from "@/lib/catan-notifications";
import { ResourceIcon } from "./board";
import { BagText, Screen } from "./play-primitives";

const RULES = [
  { title: "Ziel des Spiels", text: "Erreiche das gewählte Siegpunktziel im eigenen Zug. Eine Siedlung zählt 1, eine Stadt 2 Punkte. Verdeckte Siegpunktkarten zählen mit. Die längste Handelsstraße und die größte Rittermacht bringen jeweils 2 Sonderpunkte." },
  { title: "Die ersten Siedlungen", text: "Alle setzen zuerst eine Siedlung und eine angrenzende Straße. Danach geht es in umgekehrter Reihenfolge zurück. Zwischen zwei Siedlungen bleibt immer eine Kreuzung frei. Nur deine zweite Siedlung bringt sofort einen Rohstoff aus jedem angrenzenden Rohstofffeld." },
  { title: "Würfeln und Ernten", text: "Die Summe der beiden Würfel bestimmt die Felder, die Ertrag liefern. Eine angrenzende Siedlung erhält 1, eine Stadt 2 Rohstoffe. Auch außerhalb deines Zuges bekommst du Ertrag. Das Räuberfeld liefert nichts. Ist die Bank knapp, kann Ertrag ausfallen." },
  { title: "Eine 7 und der Räuber", text: "Mit mehr als 7 Rohstoffkarten gibst du die Hälfte ab, abgerundet. Entwicklungskarten zählen nicht mit. Danach versetzt die Person am Zug den Räuber auf ein anderes Feld und stiehlt einer angrenzenden Person eine zufällige Rohstoffkarte." },
  { title: "Bauen", text: "Neue Siedlungen müssen an dein Straßennetz anschließen. Eine Stadt ersetzt eine eigene Siedlung. Du hast 15 Straßen, 5 Siedlungen und 4 Städte." },
  { title: "Handeln", text: "Nach dem Würfeln darfst du in beliebiger Reihenfolge handeln und bauen. Mitspielende handeln mit der Person am Zug. Die Bank tauscht im eigenen Zug 4 gleiche Rohstoffe gegen 1 anderen. Mit einem eigenen Hafen gilt 3:1, beim passenden Rohstoffhafen 2:1." },
  { title: "Entwicklungskarten", text: "Du darfst höchstens eine Entwicklungskarte pro Zug spielen, frühestens im nächsten Zug – auch vor dem Würfeln. Siegpunktkarten zählen sofort und werden nicht ausgespielt. Die Wirkung jeder Karte steht unter „Karten“." },
  { title: "Sonderpunkte", text: "Die längste zusammenhängende Handelsstraße bringt ab 5 Straßen 2 Punkte. Eigene Abzweigungen zählen nicht doppelt; gegnerische Siedlungen unterbrechen den Weg. Die größte Rittermacht bringt ab 3 ausgespielten Rittern 2 Punkte. Bei Gleichstand behält die bisherige Person die Sonderkarte." },
  { title: "Gute Bauplätze erkennen", text: "Unter den Ertragszahlen fallen 6 und 8 am häufigsten: jeweils bei 5 von 36 Würfelkombinationen. 5 und 9 kommen auf 4, 4 und 10 auf 3, 3 und 11 auf 2, 2 und 12 auf 1. Verschiedene Rohstoffe und Zahlen machen dich unabhängiger von einzelnen Würfen." },
];
const BUILDING_NAMES: Record<keyof typeof COSTS, string> = { road: "Straße", settlement: "Siedlung", city: "Stadt", development: "Entwicklungskarte" };
export type OverviewPage = "menu" | "scores" | "log" | "rules" | "activity";

export function OverviewPanel({ game, page, setPage, activity, unreadActivity, unread, onRead, onRematch, busy, turnActions }: {
  game: CatanView; page: OverviewPage; setPage: (page: OverviewPage) => void; activity: CatanActivity[]; unreadActivity?: CatanActivity[]; unread: number; onRead: () => void;
  local: boolean; onHide?: () => void; onRematch?: () => void; busy: boolean; turnActions?: ReactNode;
}) {
  const me = game.me!; const back = () => setPage("menu");
  if (page === "rules") return <Screen title="Spielregeln & Baukosten" back={back} actions={turnActions}>
    <div className="catan-rule-list">
      <details className="catan-rule-section" open><summary>Baukosten</summary><div className="catan-rule-costs">{(Object.keys(COSTS) as (keyof typeof COSTS)[]).map((kind) => <div key={kind}><strong>{BUILDING_NAMES[kind]}</strong><span className="catan-cost">{RESOURCES.filter((resource) => COSTS[kind][resource]).map((resource) => <span key={resource} title={RESOURCE_INFO[resource].label}><ResourceIcon resource={resource} />{COSTS[kind][resource]}<span className="sr-only"> {RESOURCE_INFO[resource].label}</span></span>)}</span></div>)}</div></details>
      {RULES.map((rule, index) => <details className="catan-rule-section" key={rule.title}><summary>{rule.title}</summary><div><p>{rule.text}</p>{index === 0 && <p>Euer Ziel: {game.targetPoints} Punkte.</p>}</div></details>)}
    </div>
  </Screen>;
  if (page === "log") return <Screen title="Spielverlauf" back={back} actions={turnActions}>{[...game.log].reverse().map((entry) => <p className="catan-log-entry" key={entry.id}>{entry.text}</p>)}</Screen>;
  if (page === "activity") {
    const entries = [...activity].reverse(); const unreadIds = new Set((unreadActivity ?? entries.slice(0, unread)).map((entry) => entry.id));
    return <Screen title="Deine Meldungen" back={back} actions={turnActions} headingAction={unread ? <Button variant="outline" size="icon" aria-label="Alle Meldungen als gelesen markieren" title="Alle als gelesen markieren" onClick={onRead}><CheckCheck /></Button> : undefined}>
      {entries.length ? <div className="catan-activity-list">{entries.map((entry) => <details className={`catan-activity-item${unreadIds.has(entry.id) ? " is-unread" : ""}`} key={entry.id}>
        <summary><span><strong>{entry.title}</strong><small>{activitySummary(entry)}</small></span>{unreadIds.has(entry.id) && <span className="catan-activity-unread">Neu</span>}</summary>
        <div><p>{entry.message}</p>{resourceCount(entry.losses) > 0 && <p className="is-loss"><strong>Abgegeben:</strong> <BagText bag={entry.losses} /></p>}{resourceCount(entry.gains) > 0 && <p className="is-gain"><strong>Erhalten:</strong> <BagText bag={entry.gains} /></p>}</div>
      </details>)}</div> : <p>Noch keine Meldungen.</p>}
    </Screen>;
  }
  const finished = game.phase === "finished"; const winner = game.players.find((p) => p.id === game.winner);
  return <Screen title={finished ? `${winner?.name} gewinnt!` : "Übersicht"} actions={finished && onRematch ? <Button className="catan-primary" disabled={busy} onClick={onRematch}>Neue Partie vorbereiten</Button> : turnActions}>
    {finished && <p className="catan-inline-hint"><Trophy /> {game.targetPoints} Punkte erreicht.</p>}
    <div className="catan-score-list">{game.players.map((p) => <details className="catan-player-card" key={p.id} style={{ "--player-color": PLAYER_COLORS[p.color] } as React.CSSProperties}>
      <summary><i className="catan-player-dot" aria-hidden="true" /><strong>{p.name}{p.id === me.id ? " (du)" : ""}<span className="sr-only"> · {PLAYER_COLOR_NAMES[p.color]}</span></strong><b>{p.id === me.id ? victoryPoints(game, me) : p.points} / {game.targetPoints}</b><small>{p.resourceCount} Rohstoffkarten · {p.knights} Ritter · Straße {p.roadLength}</small></summary>
      <div><p>{p.developmentCount} Entwicklungskarten</p>
        {(game.longestRoad === p.id || game.largestArmy === p.id) && <p>{game.longestRoad === p.id ? "Längste Straße: +2 Punkte. " : ""}{game.largestArmy === p.id ? "Größte Rittermacht: +2 Punkte." : ""}</p>}
        <p>Vorrat: {15 - p.pieces.road} Straßen · {5 - p.pieces.settlement} Siedlungen · {4 - p.pieces.city} Städte</p></div>
    </details>)}</div>
    <div className="catan-overview-links">{([{ id: "log", title: "Spielverlauf", Icon: ScrollText }, { id: "activity", title: "Deine Meldungen", Icon: Bell }, { id: "rules", title: "Spielregeln & Baukosten", Icon: BookOpen }] as const).map(({ id, title, Icon }) => <button type="button" className="catan-overview-link" key={id} onClick={() => setPage(id)}><Icon /><span>{title}</span>{id === "activity" && unread > 0 && <b>{unread} neu</b>}<ChevronRight /></button>)}</div>
    <div className="catan-overview-exit"><GameBackLink /></div>
  </Screen>;
}
