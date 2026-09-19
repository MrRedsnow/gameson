"use client";

import { useState, type ReactNode } from "react";
import { ArrowRightLeft, ChevronRight, Landmark, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLAYER_COLORS, RESOURCES, RESOURCE_INFO, canAfford, emptyResources, resourceCount, tradeRatio, type CatanView, type Resource, type Resources } from "@/lib/catan";
import { missingResources } from "@/lib/catan-ux";
import { ResourceIcon } from "./board";
import { BagText, PagedItems, ResourceAmounts, ResourceChoices, Screen, type Send } from "./play-primitives";

export function TradeInventoryPreview({ resources, give, receive, unavailable }: { resources: Resources; give: Partial<Resources>; receive: Partial<Resources>; unavailable?: string }) {
  const reason = unavailable || missingResources(resources, give);
  return <section className="catan-trade-result" aria-label="Dein Bestand nach dem Handel">
    <h3>Dein Bestand danach</h3>
    <div>{RESOURCES.map((r) => {
      const change = (receive[r] ?? 0) - (give[r] ?? 0);
      return <span key={r} className={change > 0 ? "is-gain" : change < 0 ? "is-loss" : ""}><ResourceIcon resource={r} /><strong>{reason ? "—" : resources[r] + change}</strong><small>{RESOURCE_INFO[r].label}</small><small>{!reason && change ? `${change > 0 ? "+" : "−"}${Math.abs(change)}` : "·"}</small></span>;
    })}</div>
    {reason && <p className="catan-inline-hint" role="status">{reason}</p>}
  </section>;
}

type View = "choice" | "bank" | "who" | "give" | "receive" | "review";

export function TradePanel({ game, send, busy, turnActions }: { game: CatanView; send: Send; busy: boolean; turnActions?: ReactNode }) {
  const me = game.me!; const active = game.players[game.currentPlayer]; const isTurn = active.id === me.id; const open = game.phase === "main";
  const recipients = game.players.filter((p) => p.id !== me.id && (isTurn || p.id === active.id));
  const [view, setView] = useState<View>("choice"); const [toId, setToId] = useState("");
  const [bankStep, setBankStep] = useState<"give" | "receive" | "review">("give");
  const [give, setGive] = useState<Resource>("wood"); const [receive, setReceive] = useState<Resource>("brick");
  const [offered, setOffered] = useState(emptyResources()); const [wanted, setWanted] = useState(emptyResources());
  const offer = game.trade; const partner = recipients.find((p) => p.id === toId);
  const ratio = tradeRatio(game, me.id, give); const bestRatio = Math.min(...RESOURCES.map((r) => tradeRatio(game, me.id, r)));
  const mixed = RESOURCES.some((r) => offered[r] && wanted[r]) ? "Geben und Erhalten müssen unterschiedliche Rohstoffarten sein." : undefined;
  const reset = () => { setView("choice"); setOffered(emptyResources()); setWanted(emptyResources()); };
  const selectPartner = (id: string) => { setToId(id); setView("give"); };
  const counter = () => {
    if (!offer) return;
    setOffered({ ...(offer.toId === me.id ? offer.receive : offer.give) });
    setWanted({ ...(offer.toId === me.id ? offer.give : offer.receive) });
    selectPartner(offer.toId === me.id ? offer.fromId : offer.toId);
  };

  if (!open) return <Screen title="Handeln" actions={turnActions}>
    <div className="catan-empty-state"><ArrowRightLeft /><h3>{game.phase === "finished" ? "Die Partie ist beendet." : "Nach dem Würfeln wird gehandelt."}</h3><p>{game.phase === "roll" && isTurn ? "Würfle zuerst. Danach kannst du mit der Bank oder Mitspielenden tauschen." : "Schließt zuerst die aktuelle Spielaufgabe ab."}</p></div>
  </Screen>;

  if (offer && view === "choice") {
    const ownOffer = offer.fromId === me.id; const incoming = offer.toId === me.id; const involved = ownOffer || incoming;
    const from = game.players.find((p) => p.id === offer.fromId)!; const to = game.players.find((p) => p.id === offer.toId)!;
    const payment = incoming ? offer.receive : offer.give; const receipt = incoming ? offer.give : offer.receive;
    return <Screen title={incoming ? `Angebot von ${from.name}` : ownOffer ? `Angebot an ${to.name}` : `${from.name} handelt mit ${to.name}`} eyebrow="Offener Handel" actions={<>
      {(involved || isTurn) && <Button variant="outline" disabled={busy} onClick={() => void send({ type: "cancel_trade", offerId: offer.id })}>{ownOffer ? "Zurückziehen" : "Ablehnen"}</Button>}
      {involved && <Button variant="outline" disabled={busy} onClick={counter}>{incoming ? "Gegenangebot" : "Ändern"}</Button>}
      {incoming && <Button className="catan-primary" disabled={busy || !canAfford(me.resources, payment)} onClick={async () => { if (await send({ type: "accept_trade", offerId: offer.id })) reset(); }}>Annehmen</Button>}
    </>}>
      <PagedItems items={[
        <div className="catan-exchange" key="exchange"><p><span>{involved ? "Du gibst" : `${from.name} gibt`}</span><strong><BagText bag={payment} /></strong></p><p><span>{involved ? "Du erhältst" : `${from.name} erhält`}</span><strong><BagText bag={receipt} /></strong></p></div>,
        ...(involved ? [<TradeInventoryPreview key="inventory" resources={me.resources} give={payment} receive={receipt} />] : []),
        ...(incoming ? [] : [<p key="hint" className="catan-inline-hint">{ownOffer ? `${to.name} entscheidet über dein Angebot.` : "Dieser Handel muss zuerst abgeschlossen werden."}</p>]),
      ]} render={(item) => item} />
    </Screen>;
  }

  if (view === "bank") {
    const reason = give === receive ? "Wähle zwei unterschiedliche Rohstoffe." : !game.bank[receive] ? `Die Bank hat kein ${RESOURCE_INFO[receive].label} mehr.` : missingResources(me.resources, { [give]: ratio });
    return <Screen title={bankStep === "give" ? "Was gibst du der Bank?" : bankStep === "receive" ? "Was möchtest du erhalten?" : "Dein Banktausch"} eyebrow={`Hafen & Bank · Schritt ${bankStep === "give" ? 1 : bankStep === "receive" ? 2 : 3} von 3`} back={() => bankStep === "give" ? setView("choice") : setBankStep(bankStep === "review" ? "receive" : "give")} actions={bankStep === "review" ? <Button className="catan-primary" disabled={busy || !isTurn || Boolean(reason)} onClick={async () => { if (await send({ type: "bank_trade", give, receive })) { setBankStep("give"); setView("choice"); } }}><ArrowRightLeft />Tausch bestätigen</Button> : <Button className="catan-primary" disabled={busy || (bankStep === "give" ? Boolean(missingResources(me.resources, { [give]: ratio })) : Boolean(reason))} onClick={() => setBankStep(bankStep === "give" ? "receive" : "review")}>{bankStep === "give" ? "Weiter: Rohstoff erhalten" : "Tausch prüfen"}<ChevronRight /></Button>}>
      {bankStep === "give" ? <><ResourceChoices label={`Du gibst ${ratio}`} value={give} counts={me.resources} onChange={setGive} disabled={busy} /><p>Dein Kurs für {RESOURCE_INFO[give].label}: <strong>{ratio}:1</strong></p><p className="catan-inline-hint" role="status">{missingResources(me.resources, { [give]: ratio }) || `Du tauschst ${ratio} ${RESOURCE_INFO[give].label} gegen 1 anderen Rohstoff.`}</p></>
        : bankStep === "receive" ? <><ResourceChoices label="Du erhältst 1" value={receive} counts={game.bank} onChange={setReceive} disabled={busy} /><p className="catan-inline-hint" role="status">{reason || "Die Zahlen zeigen, wie viele Rohstoffe die Bank noch hat."}</p></>
        : <><div className="catan-exchange"><p><span>Du gibst</span><strong>{ratio} {RESOURCE_INFO[give].label}</strong></p><p><span>Du erhältst</span><strong>1 {RESOURCE_INFO[receive].label}</strong></p></div><TradeInventoryPreview resources={me.resources} give={{ [give]: ratio }} receive={{ [receive]: 1 }} unavailable={reason} /></>}
    </Screen>;
  }

  if (view === "who" || (["give", "receive", "review"].includes(view) && !partner)) return <Screen title="Mit wem handelst du?" eyebrow="Schritt 1 von 4" back={() => setView("choice")}>
    <PagedItems items={recipients} itemHeight={76} render={(p) => <button type="button" className="catan-person-choice" key={p.id} style={{ "--player-color": PLAYER_COLORS[p.color] } as React.CSSProperties} disabled={busy} onClick={() => selectPartner(p.id)}><i className="catan-player-dot" /><span><strong>{p.name}</strong><small>{p.resourceCount} Rohstoffkarten · {p.developmentCount} Entwicklungskarten</small></span><ChevronRight /></button>} />
  </Screen>;

  if (view === "give") return <Screen title={`Was gibst du ${partner!.name}?`} eyebrow="Schritt 2 von 4" back={() => setView("who")} actions={<Button className="catan-primary" disabled={busy || !resourceCount(offered) || !canAfford(me.resources, offered)} onClick={() => setView("receive")}>Weiter: Was möchtest du?<ChevronRight /></Button>}>
    <ResourceAmounts label="Ich gebe" value={offered} maximum={me.resources} onChange={setOffered} disabled={busy} />
    {missingResources(me.resources, offered) && <p className="catan-inline-hint" role="status">{missingResources(me.resources, offered)}</p>}
  </Screen>;

  if (view === "receive") return <Screen title={`Was möchtest du von ${partner!.name}?`} eyebrow="Schritt 3 von 4" back={() => setView("give")} actions={<Button className="catan-primary" disabled={busy || !resourceCount(wanted) || Boolean(mixed)} onClick={() => setView("review")}>Angebot prüfen<ChevronRight /></Button>}>
    <ResourceAmounts label="Ich möchte" value={wanted} maximum={emptyResources(19)} availabilityLabel="maximal" onChange={setWanted} disabled={busy} />
    <p className="catan-inline-hint" role="status">{mixed || "Die andere Person entscheidet, ob sie tauschen kann und möchte."}</p>
  </Screen>;

  if (view === "review") return <Screen title={`Dein Angebot an ${partner!.name}`} eyebrow="Schritt 4 von 4" back={() => setView("receive")} actions={<Button className="catan-primary" disabled={busy || !resourceCount(offered) || !resourceCount(wanted) || !canAfford(me.resources, offered) || Boolean(mixed) || Boolean(offer && ![offer.fromId, offer.toId].includes(me.id))} onClick={async () => { if (await send({ type: "offer_trade", toId: partner!.id, give: offered, receive: wanted })) reset(); }}>{offer?.toId === me.id ? "Gegenangebot senden" : "Handel anbieten"}</Button>}>
    <PagedItems items={[
      <div className="catan-exchange" key="exchange"><p><span>Du gibst</span><strong><BagText bag={offered} /></strong></p><p><span>Du erhältst</span><strong><BagText bag={wanted} /></strong></p></div>,
      <TradeInventoryPreview key="inventory" resources={me.resources} give={offered} receive={wanted} unavailable={mixed} />,
    ]} render={(item) => item} />
  </Screen>;

  return <Screen title="Handeln" actions={turnActions}><div className="catan-trade-options">
    <button type="button" className="catan-trade-option" disabled={busy || !isTurn || Boolean(offer)} onClick={() => setView("bank")}><Landmark /><span><strong>Hafen & Bank</strong><small>Fester Kurs ab {bestRatio}:1{!isTurn ? " · nur im eigenen Zug" : ""}</small></span><ChevronRight /></button>
    <button type="button" className="catan-trade-option" disabled={busy || !recipients.length || Boolean(offer)} onClick={() => setView("who")}><Users /><span><strong>Mitspielende</strong><small>{isTurn ? "Angebot an eine Person am Tisch" : `Angebot an ${active.name} senden`}</small></span><ChevronRight /></button>
  </div></Screen>;
}
