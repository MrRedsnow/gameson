"use client";

import { useState, type ReactNode } from "react";
import { Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEVELOPMENT_INFO, RESOURCES, RESOURCE_INFO, canAfford, emptyResources, legalRoads, resourceCount, type CatanView, type Resource } from "@/lib/catan";
import { ResourceIcon } from "./board";
import { Pager, ResourceAmounts, ResourceChoices, Screen, type Send } from "./play-primitives";

export function Discard({ game, send, busy }: { game: CatanView; send: Send; busy: boolean }) {
  const [bag, setBag] = useState(emptyResources()); const needed = game.discards[game.me!.id];
  return <Screen title="Rohstoffe abgeben" eyebrow="Eine 7 wurde gewürfelt" className="catan-discard" actions={<Button className="catan-primary" disabled={busy || resourceCount(bag) !== needed || !canAfford(game.me!.resources, bag)} onClick={() => void send({ type: "discard", resources: bag })}>{resourceCount(bag)} / {needed} Karten abgeben</Button>}>
    <p className="catan-inline-hint">Wähle genau <strong>{needed}</strong> Rohstoffe. Entwicklungskarten bleiben bei dir.</p>
    <ResourceAmounts label="Abgeben" value={bag} maximum={game.me!.resources} limit={needed} onChange={setBag} disabled={busy} />
  </Screen>;
}

function DevelopmentCards({ game, busy, send, back, turnActions }: { game: CatanView; busy: boolean; send: Send; back: () => void; turnActions?: ReactNode }) {
  const [index, setIndex] = useState(0); const [choosing, setChoosing] = useState(false);
  const [choiceStep, setChoiceStep] = useState(0);
  const [first, setFirst] = useState<Resource>("wood"); const [second, setSecond] = useState<Resource>("grain");
  const me = game.me!; const page = Math.min(index, Math.max(0, me.development.length - 1)); const card = me.development[page];
  const isTurn = game.players[game.currentPlayer].id === me.id;
  const reason = !isTurn ? "Du kannst Karten in deinem eigenen Zug spielen." : !["roll", "main"].includes(game.phase) ? "Schließe zuerst deine aktuelle Aufgabe ab."
    : game.playedDevelopment ? "Du hast in diesem Zug schon eine Entwicklungskarte gespielt."
    : card?.boughtOnTurn === game.turn ? "Neu gekauft: ab deinem nächsten Zug spielbar."
    : card?.type === "road_building" && !legalRoads(game, me.id).length ? "Es gibt keinen freien Platz für eine weitere Straße." : undefined;
  const required = Math.min(2, resourceCount(game.bank)); const chosen = emptyResources(); if (required > 0) chosen[first]++; if (required > 1) chosen[second]++;
  if (!card) return <Screen title="Entwicklungskarten" back={back} actions={turnActions}><div className="catan-empty-state"><Shield /><h3>Noch keine Entwicklungskarten</h3><p>Du kaufst sie unter „Bauen“. Eine Karte pro Zug ist spielbar, auch vor dem Würfeln.</p></div></Screen>;
  const firstOfTwo = card.type === "plenty" && required > 1 && choiceStep === 0;
  if (choosing && ["plenty", "monopoly"].includes(card.type)) return <Screen title={DEVELOPMENT_INFO[card.type].label} eyebrow={card.type === "plenty" && required > 1 ? `Rohstoff ${choiceStep + 1} von 2` : undefined} back={() => choiceStep ? setChoiceStep(0) : setChoosing(false)} actions={<Button className="catan-primary" disabled={busy || Boolean(reason) || (card.type === "plenty" && (firstOfTwo ? game.bank[first] < 1 : !canAfford(game.bank, chosen)))} onClick={async () => { if (firstOfTwo) setChoiceStep(1); else if (await send({ type: "play_development", cardId: card.id, resource: first, resources: chosen })) { setChoosing(false); setChoiceStep(0); } }}>{firstOfTwo ? "Weiter: Zweiter Rohstoff" : "Karte bestätigen"}</Button>}>
    <p className="catan-inline-hint">{choiceStep ? `Bereits gewählt: 1 ${RESOURCE_INFO[first].label}. Wähle deinen zweiten Rohstoff.` : DEVELOPMENT_INFO[card.type].description}</p>
    <ResourceChoices label={card.type === "monopoly" ? "Diesen Rohstoff fordern" : choiceStep ? "Zweiter Rohstoff" : "Erster Rohstoff"} value={choiceStep ? second : first} onChange={choiceStep ? setSecond : setFirst} counts={card.type === "plenty" ? game.bank : undefined} disabled={busy} />
    <p className="catan-inline-hint" role="status">{reason || (card.type === "plenty" ? !required ? "Die Bank ist leer. Du würdest keine Rohstoffe erhalten." : (firstOfTwo ? !game.bank[first] : !canAfford(game.bank, chosen)) ? "Von dieser Auswahl hat die Bank nicht genug. Die Zahlen zeigen den Bankbestand." : "Die Zahlen zeigen den verfügbaren Bankbestand." : "Alle anderen geben dir ihre Karten dieser Rohstoffart.")}</p>
  </Screen>;
  return <Screen title="Entwicklungskarten" back={back} actions={<>
    {card.type === "victory" ? turnActions : <Button className="catan-primary" disabled={busy || Boolean(reason)} onClick={() => { if (["plenty", "monopoly"].includes(card.type)) { setChoiceStep(0); setChoosing(true); } else void send({ type: "play_development", cardId: card.id }); }}>{DEVELOPMENT_INFO[card.type].label} ausspielen</Button>}
  </>}>
    <article className="catan-development-card"><Shield /><h3>{DEVELOPMENT_INFO[card.type].label}</h3><p>{DEVELOPMENT_INFO[card.type].description}</p><p className="catan-inline-hint">{card.type === "victory" ? "+1 Siegpunkt · bereits in deinem Punktestand enthalten" : reason || "Spielbar · höchstens eine Entwicklungskarte pro Zug"}</p></article>
    <Pager index={page} total={me.development.length} label="Karte" onChange={(next) => { setIndex(next); setChoosing(false); }} />
  </Screen>;
}

export function CardsPanel({ game, busy, send, turnActions }: { game: CatanView; busy: boolean; send: Send; turnActions?: ReactNode }) {
  const [page, setPage] = useState<"resources" | "development" | "bank">("resources");
  const me = game.me!; const count = resourceCount(me.resources);
  if (game.phase === "discard" && game.discards[me.id] > 0) return <Discard key={`${game.turn}-${me.id}`} game={game} busy={busy} send={send} />;
  if (page === "development") return <DevelopmentCards game={game} busy={busy} send={send} back={() => setPage("resources")} turnActions={turnActions} />;
  const bag = page === "bank" ? game.bank : me.resources;
  return <Screen title={page === "bank" ? "Bankbestand" : "Deine Rohstoffe"} back={page === "bank" ? () => setPage("resources") : undefined} actions={turnActions}>
    <div className="catan-resource-hand">{RESOURCES.map((r) => <div key={r}><ResourceIcon resource={r} /><strong>{bag[r]}</strong><span>{RESOURCE_INFO[r].label}</span></div>)}</div>
    <p className="catan-inline-hint">{page === "bank" ? `${game.deckCount} Entwicklungskarten liegen noch im Stapel. Rohstoffvorräte sind begrenzt.` : count > 7 ? `Mehr als sieben Karten: Bei einer 7 musst du ${Math.floor(count / 2)} abgeben.` : `${count} Rohstoffkarten · Nur du siehst deine Hand.`}</p>
    {page === "resources" && <div className="catan-card-links"><Button variant="outline" onClick={() => setPage("development")}>Entwicklungskarten <strong>{me.development.length}</strong></Button><Button variant="outline" onClick={() => setPage("bank")}>Bankbestand ansehen</Button></div>}
  </Screen>;
}
