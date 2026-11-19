"use client";

import { useState, type ReactNode } from "react";
import { ArrowRightLeft, ChevronRight, Landmark, Minus, Plus, Tag, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLAYER_COLORS, RESOURCES, RESOURCE_CARDS_PER_TYPE, RESOURCE_INFO, canAfford, emptyResources, isTradeRecipient, resourceCount, tradeRatio, type CatanView, type Resource, type Resources } from "@/lib/catan";
import { missingResources } from "@/lib/catan-ux";
import { ResourceIcon } from "./board";
import { BagText, ResourceChoices, Screen, type Send } from "./play-primitives";

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

type View = "choice" | "offers" | "bank" | "who" | "compose";
type TradeFilter = "all" | "bank" | "players" | "offers";
const TRADE_FILTERS: { id: TradeFilter; label: string }[] = [
  { id: "all", label: "Alle" }, { id: "bank", label: "Bank & Hafen" },
  { id: "players", label: "Mitspielende" }, { id: "offers", label: "Meine Angebote" },
];
const TRADE_SUBTITLE = "Tausche Ressourcen mit Bank, Hafen oder Mitspielenden";

function signedQuantity(quantity: number) {
  if (quantity === 0) return "0";
  return `${quantity < 0 ? "−" : "+"}${Math.abs(quantity)}`;
}

function summarizeQuantities(quantities: Resources, sign: -1 | 1) {
  return RESOURCES.filter((resource) => quantities[resource] * sign > 0)
    .map((resource) => `${signedQuantity(quantities[resource])} ${RESOURCE_INFO[resource].label}`)
    .join(", ") || "Noch nichts gewählt";
}

export function TradePanel({ game, send, busy, turnActions, onClose }: { game: CatanView; send: Send; busy: boolean; turnActions?: ReactNode; onClose?: () => void }) {
  const me = game.me!; const active = game.players[game.currentPlayer]; const isTurn = active.id === me.id; const open = game.phase === "main";
  const recipients = game.players.filter((p) => p.id !== me.id && (isTurn || p.id === active.id));
  const [view, setView] = useState<View>("choice"); const [toId, setToId] = useState<string | null>("");
  const [filter, setFilter] = useState<TradeFilter>("all");
  const [give, setGive] = useState<Resource>("wood"); const [receive, setReceive] = useState<Resource>("brick");
  const [quantities, setQuantities] = useState(emptyResources);
  const offer = game.trade; const partner = recipients.find((p) => p.id === toId); const toAll = toId === null && isTurn;
  const recipientName = toAll ? "alle" : partner?.name;
  const incoming = isTradeRecipient(offer, me.id);
  const incomingOfferId = offer && incoming ? offer.id : null;
  const [navigation, setNavigation] = useState({ turn: game.turn, incomingOfferId });
  const turnChanged = navigation.turn !== game.turn;
  const newIncomingOffer = incomingOfferId !== null && navigation.incomingOfferId !== incomingOfferId;
  if (turnChanged || newIncomingOffer) {
    setNavigation({ turn: game.turn, incomingOfferId: incomingOfferId ?? navigation.incomingOfferId });
    setView("choice"); setFilter("all");
    if (turnChanged) { setToId(""); setQuantities(emptyResources()); }
  }
  const ratio = tradeRatio(game, me.id, give); const bestRatio = Math.min(...RESOURCES.map((r) => tradeRatio(game, me.id, r)));
  const reset = () => { setView("choice"); setFilter("all"); setToId(""); setQuantities(emptyResources()); };
  const selectPartner = (id: string | null) => { setToId(id); setView("compose"); };
  const reviseOffer = () => {
    if (!offer) return;
    const payment = incoming ? offer.receive : offer.give;
    const receipt = incoming ? offer.give : offer.receive;
    const draft = emptyResources();
    for (const resource of RESOURCES) draft[resource] = receipt[resource] - payment[resource];
    setQuantities(draft);
    selectPartner(incoming ? offer.fromId : offer.toId);
  };
  if (!open) return <Screen onClose={onClose} title="Handeln" subtitle={TRADE_SUBTITLE} headingIcon={<ArrowRightLeft />} actions={turnActions}>
    <div className="catan-empty-state"><ArrowRightLeft /><h3>{game.phase === "finished" ? "Die Partie ist beendet." : "Nach dem Würfeln wird gehandelt."}</h3><p>{game.phase === "roll" && isTurn ? "Würfle zuerst. Danach kannst du mit der Bank oder Mitspielenden tauschen." : "Schließt zuerst die aktuelle Spielaufgabe ab."}</p></div>
  </Screen>;

  if (offer && ((view === "offers" && offer.fromId === me.id) || (view === "choice" && offer.fromId !== me.id))) {
    const ownOffer = offer.fromId === me.id; const involved = ownOffer || incoming;
    const from = game.players.find((p) => p.id === offer.fromId)!; const toName = offer.toId === null ? "alle" : game.players.find((p) => p.id === offer.toId)!.name;
    const waitingNames = game.players.filter((p) => isTradeRecipient(offer, p.id)).map((p) => p.name).join(", ");
    const payment = incoming ? offer.receive : offer.give; const receipt = incoming ? offer.give : offer.receive;
    return <Screen onClose={onClose} title={incoming ? `Angebot von ${from.name}` : ownOffer ? `Angebot an ${toName}` : offer.toId === null ? `${from.name} bietet allen einen Handel an` : `${from.name} handelt mit ${toName}`} eyebrow="Offener Handel" subtitle={involved ? "Prüfe die Rohstoffe für beide Seiten" : "Ein Handel am Tisch ist noch offen"} headingIcon={<ArrowRightLeft />} back={ownOffer ? () => setView("choice") : undefined} actions={<>
      {(involved || isTurn) && <Button variant="outline" disabled={busy} onClick={async () => { if (await send({ type: "cancel_trade", offerId: offer.id })) reset(); }}>{ownOffer ? "Zurückziehen" : "Ablehnen"}</Button>}
      {involved && <Button variant="outline" disabled={busy} onClick={reviseOffer}>{incoming ? "Gegenangebot" : "Ändern"}</Button>}
      {incoming && <Button className="catan-primary" disabled={busy || !canAfford(me.resources, payment)} onClick={async () => { if (await send({ type: "accept_trade", offerId: offer.id })) reset(); }}>Annehmen</Button>}
    </>}>
      <div className="catan-exchange"><p><span>{involved ? "Du gibst" : `${from.name} gibt`}</span><strong><BagText bag={payment} /></strong></p><p><span>{involved ? "Du erhältst" : `${from.name} erhält`}</span><strong><BagText bag={receipt} /></strong></p></div>
      {involved && <TradeInventoryPreview resources={me.resources} give={payment} receive={receipt} />}
      {offer.toId === null ? <p className="catan-inline-hint">{ownOffer ? `${waitingNames} können dein Angebot annehmen. Die erste Annahme schließt den Tausch ab.` : incoming ? "Die erste Annahme schließt den Tausch ab. Wenn du ablehnst, bleibt das Angebot für die anderen offen." : "Du hast dieses Angebot abgelehnt. Die anderen können weiterhin antworten."}</p> : !incoming && <p className="catan-inline-hint">{ownOffer ? `${toName} entscheidet über dein Angebot.` : "Dieser Handel muss zuerst abgeschlossen werden."}</p>}
    </Screen>;
  }

  if (view === "offers") return <Screen onClose={onClose} title="Eigene Angebote" subtitle="Deine laufenden Handelsangebote" headingIcon={<Tag />} back={() => setView("choice")} actions={turnActions}>
    <div className="catan-empty-state"><Tag /><h3>Keine offenen Angebote</h3><p>Wähle Mitspielende, um einen Handel anzubieten.</p></div>
  </Screen>;

  if (view === "bank") {
    const reason = offer ? "Schließe zuerst das offene Handelsangebot ab." : give === receive ? "Wähle zwei unterschiedliche Rohstoffe." : !game.bank[receive] ? `Die Bank hat kein ${RESOURCE_INFO[receive].label} mehr.` : missingResources(me.resources, { [give]: ratio });
    return <Screen onClose={onClose} title="Hafen & Bank" subtitle={`Tausche zum Kurs ${ratio}:1`} headingIcon={<Landmark />} back={() => setView("choice")} actions={<Button className="catan-primary" disabled={busy || !isTurn || Boolean(reason)} onClick={() => void send({ type: "bank_trade", give, receive })}><ArrowRightLeft />Tausch bestätigen</Button>}>
      <div className="catan-bank-selection">
        <ResourceChoices label={`Du gibst ${ratio}`} value={give} onChange={setGive} disabled={busy} />
        <ResourceChoices label="Du erhältst 1 · Bankvorrat" value={receive} counts={game.bank} onChange={setReceive} disabled={busy} />
      </div>
      {!reason && <p className="catan-inline-hint">{ratio}:1 · {ratio < 4 ? "Hafenkurs" : "Bankkurs"}</p>}
      <TradeInventoryPreview resources={me.resources} give={{ [give]: ratio }} receive={{ [receive]: 1 }} unavailable={reason} />
    </Screen>;
  }

  if (view === "who" || (view === "compose" && !recipientName)) return <Screen onClose={onClose} title="Mit wem handelst du?" subtitle={isTurn ? "Schicke dein Angebot an alle oder wähle eine Person" : "Wähle eine Person für dein Angebot"} headingIcon={<Users />} back={() => setView("choice")} actions={turnActions}>
    {isTurn && <button type="button" className="catan-person-choice" disabled={busy} onClick={() => selectPartner(null)}><Users /><span><strong>An alle schicken</strong><small>Alle anderen Mitspielenden erhalten dasselbe Angebot.</small></span><ChevronRight /></button>}
    {recipients.map((p) => <button type="button" className="catan-person-choice" key={p.id} style={{ "--player-color": PLAYER_COLORS[p.color] } as React.CSSProperties} disabled={busy} onClick={() => selectPartner(p.id)}><i className="catan-player-dot" /><span><strong>{p.name}</strong><small>{p.resourceCount} Rohstoffkarten</small></span><ChevronRight /></button>)}
  </Screen>;

  if (view === "compose") {
    const offered = emptyResources();
    const wanted = emptyResources();
    for (const resource of RESOURCES) {
      offered[resource] = Math.max(0, -quantities[resource]);
      wanted[resource] = Math.max(0, quantities[resource]);
    }
    const ownOffer = offer?.fromId === me.id;
    const blockedByOffer = offer && !ownOffer && !incoming;
    const reason = blockedByOffer ? "Schließe zuerst das offene Handelsangebot ab." : missingResources(me.resources, offered);
    const canSend = !busy && !reason && resourceCount(offered) > 0 && resourceCount(wanted) > 0;
    const submitLabel = incoming ? "Gegenangebot senden" : ownOffer ? "Änderung senden" : "Handel anbieten";
    const changeQuantity = (resource: Resource, step: -1 | 1) => {
      setQuantities((current) => ({ ...current, [resource]: current[resource] + step }));
    };
    return <Screen className="catan-trade-compose" onClose={onClose} title={`Angebot an ${recipientName}`} back={() => setView("who")} actions={
      <Button className="catan-primary" disabled={!canSend} onClick={async () => { if (await send({ type: "offer_trade", toId, give: offered, receive: wanted })) reset(); }}>{submitLabel}</Button>
    }>
      <div className="catan-trade-composition-summary" aria-live="polite">
        <section className="is-loss"><h3>− Du gibst ab</h3><strong>{summarizeQuantities(quantities, -1)}</strong></section>
        <section className="is-gain"><h3>+ Du erhältst</h3><strong>{summarizeQuantities(quantities, 1)}</strong></section>
      </div>
      {reason && <p className="catan-inline-hint" role="status">{reason}</p>}
      <div className="catan-trade-quantities" role="group" aria-label="Rohstoffmengen für den Tausch">
        {RESOURCES.map((resource) => {
          const quantity = quantities[resource];
          const { label } = RESOURCE_INFO[resource];
          const available = me.resources[resource];
          const minimum = -Math.min(available, RESOURCE_CARDS_PER_TYPE);
          const tone = quantity < 0 ? " is-loss" : quantity > 0 ? " is-gain" : "";
          return <div className={`catan-trade-quantity${tone}`} key={resource}>
            <ResourceIcon resource={resource} />
            <div className="catan-trade-quantity-label"><strong>{label}</strong><small>{available} verfügbar</small></div>
            <div className="catan-stepper">
              <Button type="button" variant="outline" size="icon" aria-label={`${label}: Minus`} disabled={busy || quantity <= minimum} onClick={() => changeQuantity(resource, -1)}><Minus /></Button>
              <output aria-label={`${label}: Tauschmenge`} aria-live="off">{signedQuantity(quantity)}</output>
              <Button type="button" variant="outline" size="icon" aria-label={`${label}: Plus`} disabled={busy || quantity >= RESOURCE_CARDS_PER_TYPE} onClick={() => changeQuantity(resource, 1)}><Plus /></Button>
            </div>
          </div>;
        })}
      </div>
      {toAll && <p className="catan-inline-hint">Die erste Annahme schließt den Tausch ab.</p>}
    </Screen>;
  }

  return <Screen onClose={onClose} title="Handeln" subtitle={TRADE_SUBTITLE} headingIcon={<ArrowRightLeft />} actions={turnActions}>
    <div className="catan-trade-filters" role="group" aria-label="Handelsbereiche filtern">{TRADE_FILTERS.map(({ id, label }) => <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div>
    <div className="catan-trade-options">
      {(filter === "all" || filter === "bank") && <button type="button" className="catan-trade-option catan-menu-choice" disabled={busy || !isTurn || Boolean(offer)} onClick={() => setView("bank")}><Landmark /><span><strong>Hafen & Bank</strong><small>Tausche mit der Bank oder nutze deine Hafen-Boni. Fester Kurs ab {bestRatio}:1{!isTurn ? " · nur im eigenen Zug" : ""}</small></span><ChevronRight /></button>}
      {(filter === "all" || filter === "players") && <button type="button" className="catan-trade-option catan-menu-choice" disabled={busy || !recipients.length || Boolean(offer)} onClick={() => setView("who")}><Users /><span><strong>Mitspielende</strong><small>{isTurn ? "Handle direkt mit einer anderen Person am Tisch." : `Angebot an ${active.name} senden`}</small></span><ChevronRight /></button>}
      {(filter === "all" || filter === "offers") && <button type="button" className="catan-trade-option catan-menu-choice" disabled={busy} onClick={() => setView("offers")}><Tag /><span><strong>Eigene Angebote</strong><small>{offer?.fromId === me.id ? "1 offenes Angebot · Verwalte deinen laufenden Handel." : "Verwalte deine laufenden Angebote und tausche mit anderen."}</small></span><ChevronRight /></button>}
    </div>
  </Screen>;
}
