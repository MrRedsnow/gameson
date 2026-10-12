"use client";

import { useState, type ReactNode } from "react";
import { ArrowRightLeft, ChevronRight, Landmark, Tag, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLAYER_COLORS, RESOURCES, RESOURCE_INFO, canAfford, emptyResources, isTradeRecipient, resourceCount, tradeRatio, type CatanView, type Resource, type Resources } from "@/lib/catan";
import { missingResources } from "@/lib/catan-ux";
import { ResourceIcon } from "./board";
import { BagText, ResourceAmounts, ResourceChoices, Screen, type Send } from "./play-primitives";

export function TradeInventoryPreview({ resources, give, receive, unavailable }: { resources: Resources; give: Partial<Resources>; receive: Partial<Resources>; unavailable?: string }) {
  const reason = unavailable || missingResources(resources, give);
  return <section className="catan-trade-result" aria-label="Dein Bestand nach dem Handel">
    <h3>Nach dem Tausch</h3>
    <div>{RESOURCES.filter((r) => (receive[r] ?? 0) !== (give[r] ?? 0)).map((r) => {
      const change = (receive[r] ?? 0) - (give[r] ?? 0);
      return <span key={r} className={change > 0 ? "is-gain" : "is-loss"}><ResourceIcon resource={r} /><strong>{RESOURCE_INFO[r].label}</strong><b>{`${change > 0 ? "+" : "-"}${Math.abs(change)}`}</b><small>{reason ? "Danach —" : `Danach ${resources[r] + change}`}</small></span>;
    })}</div>
    {reason && <p className="catan-inline-hint" role="status">{reason}</p>}
  </section>;
}

type View = "choice" | "offers" | "bank" | "who" | "give" | "receive" | "review";
type TradeFilter = "all" | "bank" | "players" | "offers";
const TRADE_FILTERS: { id: TradeFilter; label: string }[] = [
  { id: "all", label: "Alle" }, { id: "bank", label: "Bank & Hafen" },
  { id: "players", label: "Mitspielende" }, { id: "offers", label: "Meine Angebote" },
];
const TRADE_SUBTITLE = "Tausche Ressourcen mit Bank, Hafen oder Mitspielenden";

export function TradePanel({ game, send, busy, turnActions }: { game: CatanView; send: Send; busy: boolean; turnActions?: ReactNode }) {
  const me = game.me!; const active = game.players[game.currentPlayer]; const isTurn = active.id === me.id; const open = game.phase === "main";
  const recipients = game.players.filter((p) => p.id !== me.id && (isTurn || p.id === active.id));
  const [view, setView] = useState<View>("choice"); const [toId, setToId] = useState<string | null>("");
  const [filter, setFilter] = useState<TradeFilter>("all");
  const [give, setGive] = useState<Resource>("wood"); const [receive, setReceive] = useState<Resource>("brick");
  const [offered, setOffered] = useState(emptyResources()); const [wanted, setWanted] = useState(emptyResources());
  const offer = game.trade; const partner = recipients.find((p) => p.id === toId); const toAll = toId === null && isTurn;
  const incoming = isTradeRecipient(offer, me.id);
  const incomingOfferId = offer && incoming ? offer.id : null;
  const [navigation, setNavigation] = useState({ turn: game.turn, incomingOfferId });
  const turnChanged = navigation.turn !== game.turn;
  const newIncomingOffer = incomingOfferId !== null && navigation.incomingOfferId !== incomingOfferId;
  if (turnChanged || newIncomingOffer) {
    setNavigation({ turn: game.turn, incomingOfferId: incomingOfferId ?? navigation.incomingOfferId });
    setView("choice"); setFilter("all");
    if (turnChanged) { setToId(""); setOffered(emptyResources()); setWanted(emptyResources()); }
  }
  const ratio = tradeRatio(game, me.id, give); const bestRatio = Math.min(...RESOURCES.map((r) => tradeRatio(game, me.id, r)));
  const mixed = RESOURCES.some((r) => offered[r] && wanted[r]) ? "Geben und Erhalten müssen unterschiedliche Rohstoffarten sein." : undefined;
  const reset = () => { setView("choice"); setFilter("all"); setOffered(emptyResources()); setWanted(emptyResources()); };
  const selectPartner = (id: string | null) => { setToId(id); setView("give"); };
  const counter = () => {
    if (!offer) return;
    setOffered({ ...(incoming ? offer.receive : offer.give) });
    setWanted({ ...(incoming ? offer.give : offer.receive) });
    selectPartner(incoming ? offer.fromId : offer.toId);
  };
  if (!open) return <Screen title="Handeln" subtitle={TRADE_SUBTITLE} headingIcon={<ArrowRightLeft />} actions={turnActions}>
    <div className="catan-empty-state"><ArrowRightLeft /><h3>{game.phase === "finished" ? "Die Partie ist beendet." : "Nach dem Würfeln wird gehandelt."}</h3><p>{game.phase === "roll" && isTurn ? "Würfle zuerst. Danach kannst du mit der Bank oder Mitspielenden tauschen." : "Schließt zuerst die aktuelle Spielaufgabe ab."}</p></div>
  </Screen>;

  if (offer && ((view === "offers" && offer.fromId === me.id) || (view === "choice" && offer.fromId !== me.id))) {
    const ownOffer = offer.fromId === me.id; const involved = ownOffer || incoming;
    const from = game.players.find((p) => p.id === offer.fromId)!; const toName = offer.toId === null ? "alle" : game.players.find((p) => p.id === offer.toId)!.name;
    const waitingNames = game.players.filter((p) => isTradeRecipient(offer, p.id)).map((p) => p.name).join(", ");
    const payment = incoming ? offer.receive : offer.give; const receipt = incoming ? offer.give : offer.receive;
    return <Screen title={incoming ? `Angebot von ${from.name}` : ownOffer ? `Angebot an ${toName}` : offer.toId === null ? `${from.name} bietet allen einen Handel an` : `${from.name} handelt mit ${toName}`} eyebrow="Offener Handel" subtitle={involved ? "Prüfe die Rohstoffe für beide Seiten" : "Ein Handel am Tisch ist noch offen"} headingIcon={<ArrowRightLeft />} back={ownOffer ? () => setView("choice") : undefined} actions={<>
      {(involved || isTurn) && <Button variant="outline" disabled={busy} onClick={async () => { if (await send({ type: "cancel_trade", offerId: offer.id })) reset(); }}>{ownOffer ? "Zurückziehen" : "Ablehnen"}</Button>}
      {involved && <Button variant="outline" disabled={busy} onClick={counter}>{incoming ? "Gegenangebot" : "Ändern"}</Button>}
      {incoming && <Button className="catan-primary" disabled={busy || !canAfford(me.resources, payment)} onClick={async () => { if (await send({ type: "accept_trade", offerId: offer.id })) reset(); }}>Annehmen</Button>}
    </>}>
      <div className="catan-exchange"><p><span>{involved ? "Du gibst" : `${from.name} gibt`}</span><strong><BagText bag={payment} /></strong></p><p><span>{involved ? "Du erhältst" : `${from.name} erhält`}</span><strong><BagText bag={receipt} /></strong></p></div>
      {involved && <TradeInventoryPreview resources={me.resources} give={payment} receive={receipt} />}
      {offer.toId === null ? <p className="catan-inline-hint">{ownOffer ? `${waitingNames} können dein Angebot annehmen. Die erste Annahme schließt den Tausch ab.` : incoming ? "Die erste Annahme schließt den Tausch ab. Wenn du ablehnst, bleibt das Angebot für die anderen offen." : "Du hast dieses Angebot abgelehnt. Die anderen können weiterhin antworten."}</p> : !incoming && <p className="catan-inline-hint">{ownOffer ? `${toName} entscheidet über dein Angebot.` : "Dieser Handel muss zuerst abgeschlossen werden."}</p>}
    </Screen>;
  }

  if (view === "offers") return <Screen title="Eigene Angebote" subtitle="Deine laufenden Handelsangebote" headingIcon={<Tag />} back={() => setView("choice")} actions={turnActions}>
    <div className="catan-empty-state"><Tag /><h3>Keine offenen Angebote</h3><p>Wähle Mitspielende, um einen Handel anzubieten.</p></div>
  </Screen>;

  if (view === "bank") {
    const reason = offer ? "Schließe zuerst das offene Handelsangebot ab." : give === receive ? "Wähle zwei unterschiedliche Rohstoffe." : !game.bank[receive] ? `Die Bank hat kein ${RESOURCE_INFO[receive].label} mehr.` : missingResources(me.resources, { [give]: ratio });
    return <Screen title="Hafen & Bank" subtitle={`Tausche zum Kurs ${ratio}:1`} headingIcon={<Landmark />} back={() => setView("choice")} actions={<Button className="catan-primary" disabled={busy || !isTurn || Boolean(reason)} onClick={() => void send({ type: "bank_trade", give, receive })}><ArrowRightLeft />Tausch bestätigen</Button>}>
      <div className="catan-bank-selection">
        <ResourceChoices label={`Du gibst ${ratio}`} value={give} onChange={setGive} disabled={busy} />
        <ResourceChoices label="Du erhältst 1 · Bankvorrat" value={receive} counts={game.bank} onChange={setReceive} disabled={busy} />
      </div>
      {!reason && <p className="catan-inline-hint">{ratio}:1 · {ratio < 4 ? "Hafenkurs" : "Bankkurs"}</p>}
      <TradeInventoryPreview resources={me.resources} give={{ [give]: ratio }} receive={{ [receive]: 1 }} unavailable={reason} />
    </Screen>;
  }

  if (view === "who" || (["give", "receive", "review"].includes(view) && !partner && !toAll)) return <Screen title="Mit wem handelst du?" eyebrow="Schritt 1 von 4" subtitle={isTurn ? "Schicke dein Angebot an alle oder wähle eine Person" : "Wähle eine Person für dein Angebot"} headingIcon={<Users />} back={() => setView("choice")} actions={turnActions}>
    {isTurn && <button type="button" className="catan-person-choice" disabled={busy} onClick={() => selectPartner(null)}><Users /><span><strong>An alle schicken</strong><small>Alle anderen Mitspielenden erhalten dasselbe Angebot.</small></span><ChevronRight /></button>}
    {recipients.map((p) => <button type="button" className="catan-person-choice" key={p.id} style={{ "--player-color": PLAYER_COLORS[p.color] } as React.CSSProperties} disabled={busy} onClick={() => selectPartner(p.id)}><i className="catan-player-dot" /><span><strong>{p.name}</strong><small>{p.resourceCount} Rohstoffkarten</small></span><ChevronRight /></button>)}
  </Screen>;

  if (view === "give") return <Screen title={toAll ? "Was bietest du allen an?" : `Was gibst du ${partner!.name}?`} eyebrow="Schritt 2 von 4" subtitle="Wähle Rohstoffe aus deinem Vorrat" headingIcon={<ArrowRightLeft />} back={() => setView("who")} actions={<Button className="catan-primary" disabled={busy || !resourceCount(offered) || !canAfford(me.resources, offered)} onClick={() => setView("receive")}>Weiter: Was möchtest du?<ChevronRight /></Button>}>
    <ResourceAmounts label="Ich gebe" value={offered} maximum={me.resources} onChange={setOffered} disabled={busy} />
    {missingResources(me.resources, offered) && <p className="catan-inline-hint" role="status">{missingResources(me.resources, offered)}</p>}
  </Screen>;

  if (view === "receive") return <Screen title={toAll ? "Was möchtest du erhalten?" : `Was möchtest du von ${partner!.name}?`} eyebrow="Schritt 3 von 4" subtitle="Wähle die Rohstoffe, die du erhalten möchtest" headingIcon={<ArrowRightLeft />} back={() => setView("give")} actions={<Button className="catan-primary" disabled={busy || !resourceCount(wanted) || Boolean(mixed)} onClick={() => setView("review")}>Angebot prüfen<ChevronRight /></Button>}>
    <ResourceAmounts label="Ich möchte" value={wanted} maximum={emptyResources(19)} availabilityLabel="maximal" onChange={setWanted} disabled={busy} />
    <p className="catan-inline-hint" role="status">{mixed || (toAll ? "Alle anderen entscheiden, ob sie tauschen können und möchten. Die erste Annahme schließt den Tausch ab." : "Die andere Person entscheidet, ob sie tauschen kann und möchte.")}</p>
  </Screen>;

  if (view === "review") return <Screen title={`Dein Angebot an ${toAll ? "alle" : partner!.name}`} eyebrow="Schritt 4 von 4" subtitle="Prüfe deinen Tausch vor dem Senden" headingIcon={<ArrowRightLeft />} back={() => setView("receive")} actions={<Button className="catan-primary" disabled={busy || !resourceCount(offered) || !resourceCount(wanted) || !canAfford(me.resources, offered) || Boolean(mixed) || Boolean(offer && offer.fromId !== me.id && !incoming)} onClick={async () => { if (await send({ type: "offer_trade", toId: toAll ? null : partner!.id, give: offered, receive: wanted })) reset(); }}>{incoming ? "Gegenangebot senden" : "Handel anbieten"}</Button>}>
    <div className="catan-exchange"><p><span>Du gibst</span><strong><BagText bag={offered} /></strong></p><p><span>Du erhältst</span><strong><BagText bag={wanted} /></strong></p></div>
    <TradeInventoryPreview resources={me.resources} give={offered} receive={wanted} unavailable={mixed} />
    {toAll && <p className="catan-inline-hint">Alle anderen Mitspielenden erhalten dieses Angebot. Die erste Annahme schließt den Tausch ab.</p>}
  </Screen>;

  return <Screen title="Handeln" subtitle={TRADE_SUBTITLE} headingIcon={<ArrowRightLeft />} actions={turnActions}>
    <div className="catan-trade-filters" role="group" aria-label="Handelsbereiche filtern">{TRADE_FILTERS.map(({ id, label }) => <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div>
    <div className="catan-trade-options">
      {(filter === "all" || filter === "bank") && <button type="button" className="catan-trade-option catan-menu-choice" disabled={busy || !isTurn || Boolean(offer)} onClick={() => setView("bank")}><Landmark /><span><strong>Hafen & Bank</strong><small>Tausche mit der Bank oder nutze deine Hafen-Boni. Fester Kurs ab {bestRatio}:1{!isTurn ? " · nur im eigenen Zug" : ""}</small></span><ChevronRight /></button>}
      {(filter === "all" || filter === "players") && <button type="button" className="catan-trade-option catan-menu-choice" disabled={busy || !recipients.length || Boolean(offer)} onClick={() => setView("who")}><Users /><span><strong>Mitspielende</strong><small>{isTurn ? "Handle direkt mit einer anderen Person am Tisch." : `Angebot an ${active.name} senden`}</small></span><ChevronRight /></button>}
      {(filter === "all" || filter === "offers") && <button type="button" className="catan-trade-option catan-menu-choice" disabled={busy} onClick={() => setView("offers")}><Tag /><span><strong>Eigene Angebote</strong><small>{offer?.fromId === me.id ? "1 offenes Angebot · Verwalte deinen laufenden Handel." : "Verwalte deine laufenden Angebote und tausche mit anderen."}</small></span><ChevronRight /></button>}
    </div>
  </Screen>;
}
