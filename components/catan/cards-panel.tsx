"use client";

import { useState, type ReactNode } from "react";
import { Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEVELOPMENT_INFO, RESOURCE_INFO, canAfford, emptyResources, resourceCount, type CatanView, type Development, type Resource } from "@/lib/catan";
import { developmentGroups } from "@/lib/catan-ux";
import { ResourceAmounts, ResourceChoices, Screen, type Send } from "./play-primitives";

export function Discard({ game, send, busy }: { game: CatanView; send: Send; busy: boolean }) {
  const [bag, setBag] = useState(emptyResources()); const needed = game.discards[game.me!.id];
  return <Screen title="Rohstoffe abgeben" eyebrow="Eine 7 wurde gewürfelt" className="catan-discard" actions={<Button className="catan-primary" disabled={busy || resourceCount(bag) !== needed || !canAfford(game.me!.resources, bag)} onClick={() => void send({ type: "discard", resources: bag })}>Abgabe bestätigen</Button>}>
    <p className="catan-inline-hint">Wähle genau <strong>{needed}</strong> Rohstoffe. Entwicklungskarten bleiben bei dir.</p>
    <ResourceAmounts label="Abgeben" value={bag} maximum={game.me!.resources} limit={needed} onChange={setBag} disabled={busy} />
  </Screen>;
}

function DevelopmentCards({ game, busy, send, turnActions }: { game: CatanView; busy: boolean; send: Send; turnActions?: ReactNode }) {
  const [selected, setSelected] = useState<Development | null>(null); const [choosing, setChoosing] = useState(false);
  const [choiceStep, setChoiceStep] = useState(0);
  const [first, setFirst] = useState<Resource>("wood"); const [second, setSecond] = useState<Resource>("grain");
  const groups = developmentGroups(game); const group = groups.find((item) => item.type === selected); const card = group?.card; const reason = group?.reason;
  const list = () => { setSelected(null); setChoosing(false); setChoiceStep(0); };
  const required = Math.min(2, resourceCount(game.bank)); const chosen = emptyResources(); if (required > 0) chosen[first]++; if (required > 1) chosen[second]++;
  if (!groups.length) return <Screen title="Entwicklungskarten" actions={turnActions}><div className="catan-empty-state"><Shield /><h3>Noch keine Entwicklungskarten</h3><p>Eine Karte pro Zug ist spielbar, auch vor dem Würfeln.</p></div></Screen>;
  if (!card) return <Screen title="Entwicklungskarten" actions={turnActions}><div className="catan-development-list">{groups.map((item) => <button type="button" className="catan-development-choice" key={item.type} onClick={() => { setSelected(item.type); setChoosing(false); setChoiceStep(0); }}>
    <Shield /><span><strong>{DEVELOPMENT_INFO[item.type].label}</strong><small>{item.reason || "Spielbar"}{item.fresh && item.type !== "victory" ? ` · ${item.fresh} neu gekauft` : ""}</small></span><b aria-label={`${item.count} ${item.count === 1 ? "Karte" : "Karten"}`}>{item.count}×</b>
  </button>)}</div></Screen>;
  const firstOfTwo = card.type === "plenty" && required > 1 && choiceStep === 0;
  if (choosing && ["plenty", "monopoly"].includes(card.type)) return <Screen title={DEVELOPMENT_INFO[card.type].label} eyebrow={card.type === "plenty" && required > 1 ? `Rohstoff ${choiceStep + 1} von 2` : undefined} back={() => choiceStep ? setChoiceStep(0) : setChoosing(false)} actions={<Button className="catan-primary" disabled={busy || Boolean(reason) || (card.type === "plenty" && (firstOfTwo ? game.bank[first] < 1 : !canAfford(game.bank, chosen)))} onClick={async () => { if (firstOfTwo) setChoiceStep(1); else if (await send({ type: "play_development", cardId: card.id, resource: first, resources: chosen })) list(); }}>{firstOfTwo ? "Weiter: Zweiter Rohstoff" : "Karte bestätigen"}</Button>}>
    <p className="catan-inline-hint">{choiceStep ? `Bereits gewählt: 1 ${RESOURCE_INFO[first].label}. Wähle deinen zweiten Rohstoff.` : DEVELOPMENT_INFO[card.type].description}</p>
    <ResourceChoices label={card.type === "monopoly" ? "Diesen Rohstoff fordern" : choiceStep ? "Zweiter Rohstoff" : "Erster Rohstoff"} value={choiceStep ? second : first} onChange={choiceStep ? setSecond : setFirst} counts={card.type === "plenty" ? game.bank : undefined} disabled={busy} />
    <p className="catan-inline-hint" role="status">{reason || (card.type === "plenty" ? !required ? "Die Bank ist leer. Du würdest keine Rohstoffe erhalten." : (firstOfTwo ? !game.bank[first] : !canAfford(game.bank, chosen)) ? "Von dieser Auswahl hat die Bank nicht genug. Die Zahlen zeigen den Bankbestand." : "Die Zahlen zeigen den verfügbaren Bankbestand." : "Alle anderen geben dir ihre Karten dieser Rohstoffart.")}</p>
  </Screen>;
  return <Screen title="Entwicklungskarten" back={list} actions={<>
    {card.type === "victory" ? turnActions : <Button className="catan-primary" disabled={busy || Boolean(reason)} onClick={async () => { if (["plenty", "monopoly"].includes(card.type)) { setChoiceStep(0); setChoosing(true); } else if (await send({ type: "play_development", cardId: card.id })) list(); }}>{DEVELOPMENT_INFO[card.type].label} ausspielen</Button>}
  </>}>
    <article className="catan-development-card"><Shield /><h3>{DEVELOPMENT_INFO[card.type].label} · {group!.count}×</h3><p>{DEVELOPMENT_INFO[card.type].description}</p><p className="catan-inline-hint">{card.type === "victory" ? `+${group!.count} Siegpunkte · bereits in deinem Punktestand enthalten` : reason || "Spielbar · höchstens eine Entwicklungskarte pro Zug"}</p></article>
  </Screen>;
}

export function CardsPanel({ game, busy, send, turnActions }: { game: CatanView; busy: boolean; send: Send; turnActions?: ReactNode }) {
  const me = game.me!;
  if (game.phase === "discard" && game.discards[me.id] > 0) return <Discard key={`${game.turn}-${me.id}`} game={game} busy={busy} send={send} />;
  return <DevelopmentCards game={game} busy={busy} send={send} turnActions={turnActions} />;
}
