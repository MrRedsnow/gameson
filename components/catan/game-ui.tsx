"use client";

import { useState } from "react";
import { ArrowRightLeft, BookOpen, Castle, Dices, Flag, Hammer, Hand, LockKeyhole, Route, Shield, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CatanBoard, ResourceIcon, boardAction, type BoardMode } from "./board";
import { COSTS, DEVELOPMENT_INFO, MAX_TARGET_POINTS, MIN_TARGET_POINTS, PLAYER_COLORS, PLAYER_COLOR_NAMES, RESOURCES, RESOURCE_INFO, canAfford, emptyResources, legalCities, legalRoads, legalSettlements, resourceCount, tradeRatio, victoryPoints, type CatanAction, type CatanView, type Resource, type Resources } from "@/lib/catan";

type Send = (action: CatanAction) => Promise<boolean>;
export function TargetPoints({ value, onChange, disabled = false }: { value: number; onChange: (value: number) => void; disabled?: boolean }) {
  return <div className="catan-target"><div><strong>Siegpunkte</strong><p>Standard 12 · Original 10</p></div><div className="catan-stepper">
    <Button type="button" variant="outline" aria-label="Siegpunkte verringern" disabled={disabled || value <= MIN_TARGET_POINTS} onClick={() => onChange(value - 1)}>−</Button>
    <output aria-label="Siegpunktziel" aria-live="polite">{value}</output>
    <Button type="button" variant="outline" aria-label="Siegpunkte erhöhen" disabled={disabled || value >= MAX_TARGET_POINTS} onClick={() => onChange(value + 1)}>+</Button>
  </div></div>;
}
export function CatanRules() {
  return <details className="catan-rules"><summary><BookOpen aria-hidden="true" />Spielregeln &amp; Baukosten</summary><div>
    <p>Für 3–4 Personen. Das Siegpunktziel wählt ihr vor dem Start (8–15, Standard 12; Originalregel: 10).</p>
    <ol>
      <li><strong>Gründen:</strong> Reihum je eine Siedlung und Straße setzen, anschließend rückwärts die zweite. Nur die zweite Siedlung bringt Startrohstoffe.</li>
      <li><strong>Würfeln:</strong> Passende Landschaften geben allen angrenzenden Siedlungen einen, Städten zwei Rohstoffe. Der Räuber blockiert sein Feld.</li>
      <li><strong>Bei einer 7:</strong> Wer mehr als sieben Rohstoffkarten hat, gibt die Hälfte ab (abgerundet). Danach Räuber versetzen und eine Karte stehlen.</li>
      <li><strong>Handeln und bauen:</strong> In beliebiger Reihenfolge. Handel mit der Person am Zug oder der Bank: 4:1, mit Häfen 3:1 beziehungsweise 2:1. Zwischen Siedlungen bleibt eine Kreuzung frei.</li>
      <li><strong>Karten und Punkte:</strong> Höchstens eine Entwicklungskarte pro Zug, frühestens im nächsten Zug; auch vor dem Würfeln. Siegpunktkarten zählen verdeckt sofort. Ab fünf zusammenhängenden Straßen bzw. drei Rittern gibt es je zwei Sonderpunkte. Gleichstände behalten die bisherigen Besitzer.</li>
    </ol>
    <p>Du gewinnst, sobald du im eigenen Zug das Ziel erreichst. Vorräte und Bank sind begrenzt.</p>
    <div className="catan-rule-costs">{Object.entries(COSTS).map(([kind, cost]) => <div key={kind}><strong>{BUILDING_NAMES[kind]}</strong><Cost cost={cost} /></div>)}</div>
    <a href="https://www.catan.com/sites/default/files/2021-06/catan_base_rules_2020_200707.pdf" target="_blank" rel="noreferrer">Offizielle Regeln &amp; Almanach (PDF)</a>
  </div></details>;
}
const BUILDING_NAMES: Record<string, string> = { road: "Straße", settlement: "Siedlung", city: "Stadt", development: "Entwicklungskarte" };
const BuildIcon = { road: Route, settlement: Flag, city: Castle };
function Cost({ cost }: { cost: Partial<Resources> }) {
  return <span className="catan-cost">{RESOURCES.filter((r) => cost[r]).map((r) => <span key={r} title={RESOURCE_INFO[r].label}><ResourceIcon resource={r} />{cost[r]}<span className="sr-only"> {RESOURCE_INFO[r].label}</span></span>)}</span>;
}
export function ResourceSelect({ label, value, onChange, disabled = false }: { label: string; value: Resource; onChange: (value: Resource) => void; disabled?: boolean }) {
  return <div className="catan-field"><span>{label}</span><Select value={value} onValueChange={(v) => onChange(v as Resource)} disabled={disabled}>
    <SelectTrigger aria-label={label}><SelectValue /></SelectTrigger><SelectContent className="catan-select">{RESOURCES.map((r) => <SelectItem key={r} value={r}>{RESOURCE_INFO[r].label}</SelectItem>)}</SelectContent>
  </Select></div>;
}
function ResourcePicker({ label, value, maximum, onChange, disabled }: { label: string; value: Resources; maximum: Resources; onChange: (value: Resources) => void; disabled: boolean }) {
  return <fieldset className="catan-resource-picker"><legend>{label}</legend>{RESOURCES.map((r) => <div key={r}>
    <span><ResourceIcon resource={r} />{RESOURCE_INFO[r].label}</span><div className="catan-stepper">
      <Button type="button" variant="outline" disabled={disabled || !value[r]} aria-label={`${label}: weniger ${RESOURCE_INFO[r].label}`} onClick={() => onChange({ ...value, [r]: value[r] - 1 })}>−</Button>
      <output aria-label={`${label}: ${RESOURCE_INFO[r].label}`}>{value[r]}</output>
      <Button type="button" variant="outline" disabled={disabled || value[r] >= maximum[r]} aria-label={`${label}: mehr ${RESOURCE_INFO[r].label}`} onClick={() => onChange({ ...value, [r]: value[r] + 1 })}>+</Button>
    </div>
  </div>)}</fieldset>;
}
function BagText({ bag }: { bag: Resources }) { return <span>{RESOURCES.filter((r) => bag[r]).map((r) => `${bag[r]} ${RESOURCE_INFO[r].label}`).join(", ")}</span>; }

function Discard({ game, send, busy }: { game: CatanView; send: Send; busy: boolean }) {
  const [bag, setBag] = useState(emptyResources()); const needed = game.discards[game.me!.id];
  return <section className="catan-panel"><h2>Rohstoffe abgeben</h2><p>Wähle genau <strong>{needed}</strong> Karten. Entwicklungskarten zählen nicht mit.</p>
    <ResourcePicker label="Abgeben" value={bag} maximum={game.me!.resources} onChange={setBag} disabled={busy} />
    <Button className="catan-primary" disabled={busy || resourceCount(bag) !== needed || !canAfford(game.me!.resources, bag)} onClick={() => void send({ type: "discard", resources: bag })}>{resourceCount(bag)} / {needed} Karten abgeben</Button>
  </section>;
}
export function TradePanel({ game, send, busy }: { game: CatanView; send: Send; busy: boolean }) {
  const me = game.me!; const active = game.players[game.currentPlayer]; const isTurn = active.id === me.id;
  const recipients = game.players.filter((p) => p.id !== me.id && (isTurn || p.id === active.id));
  const [toId, setToId] = useState(recipients[0]?.id ?? "");
  const [give, setGive] = useState<Resource>("wood"); const [receive, setReceive] = useState<Resource>("brick");
  const [offered, setOffered] = useState(emptyResources()); const [wanted, setWanted] = useState(emptyResources());
  const selectedTo = recipients.some((p) => p.id === toId) ? toId : recipients[0]?.id;
  const ratio = tradeRatio(game, me.id, give); const offer = game.trade;
  return <div className="catan-trade-panel">
    {offer && <section className="catan-offer" aria-label="Aktuelles Handelsangebot"><strong>{game.players.find((p) => p.id === offer.fromId)!.name} → {game.players.find((p) => p.id === offer.toId)!.name}</strong>
      <p>Gibt <BagText bag={offer.give} /><br />Möchte <BagText bag={offer.receive} /></p>
      <div className="catan-button-row">{offer.toId === me.id && <Button disabled={busy || !canAfford(me.resources, offer.receive)} onClick={() => void send({ type: "accept_trade", offerId: offer.id })}>Handel annehmen</Button>}
        {[offer.fromId, offer.toId, active.id].includes(me.id) && <Button variant="outline" disabled={busy} onClick={() => void send({ type: "cancel_trade", offerId: offer.id })}>{offer.fromId === me.id ? "Zurückziehen" : "Ablehnen"}</Button>}</div>
      {offer.toId === me.id && !canAfford(me.resources, offer.receive) && <p className="catan-muted">Dir fehlen die gewünschten Rohstoffe. Du kannst ablehnen oder ein Gegenangebot machen.</p>}
    </section>}
    <Tabs defaultValue={offer || !isTurn ? "players" : "bank"}><TabsList className="catan-tabs"><TabsTrigger value="bank">Bank &amp; Häfen</TabsTrigger><TabsTrigger value="players">Mitspielende</TabsTrigger></TabsList>
      <TabsContent value="bank"><p className="catan-muted">Dein Kurs für {RESOURCE_INFO[give].label}: <strong>{ratio}:1</strong></p>
        <div className="catan-two-fields"><ResourceSelect label={`Ich gebe ${ratio}`} value={give} onChange={setGive} disabled={busy} /><ResourceSelect label="Ich erhalte 1" value={receive} onChange={setReceive} disabled={busy} /></div>
        <Button className="catan-primary" disabled={busy || !isTurn || give === receive || me.resources[give] < ratio || !game.bank[receive]} onClick={() => void send({ type: "bank_trade", give, receive })}><ArrowRightLeft />{ratio}:1 tauschen</Button>
        {!isTurn && <p className="catan-muted">Mit der Bank handelst du nur im eigenen Zug.</p>}
      </TabsContent>
      <TabsContent value="players"><div className="catan-field"><span>Handel mit</span><Select value={selectedTo} onValueChange={setToId} disabled={busy}><SelectTrigger aria-label="Handel mit"><SelectValue /></SelectTrigger><SelectContent className="catan-select">{recipients.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
        <ResourcePicker label="Ich gebe" value={offered} maximum={me.resources} onChange={setOffered} disabled={busy} />
        <ResourcePicker label="Ich möchte" value={wanted} maximum={emptyResources(19)} onChange={setWanted} disabled={busy} />
        <Button className="catan-primary" disabled={busy || !selectedTo || !resourceCount(offered) || !resourceCount(wanted) || !canAfford(me.resources, offered) || RESOURCES.some((r) => offered[r] && wanted[r]) || Boolean(offer && ![offer.fromId, offer.toId].includes(me.id))} onClick={async () => { if (await send({ type: "offer_trade", toId: selectedTo, give: offered, receive: wanted })) { setOffered(emptyResources()); setWanted(emptyResources()); } }}>{offer?.toId === me.id ? "Gegenangebot senden" : "Handel anbieten"}</Button>
      </TabsContent>
    </Tabs>
  </div>;
}
function DevelopmentCards({ game, busy, send }: { game: CatanView; busy: boolean; send: Send }) {
  const [chosenId, setChosenId] = useState<string | null>(null); const [first, setFirst] = useState<Resource>("wood"); const [second, setSecond] = useState<Resource>("grain");
  const me = game.me!; const isTurn = game.players[game.currentPlayer].id === me.id;
  const allowed = isTurn && ["roll", "main"].includes(game.phase) && !game.playedDevelopment;
  const card = me.development.find((c) => c.id === chosenId);
  const required = Math.min(2, resourceCount(game.bank)); const chosen = emptyResources(); if (required > 0) chosen[first]++; if (required > 1) chosen[second]++;
  return <div className="catan-development"><p className="catan-muted">Eine Karte pro Zug, auch vor dem Würfeln. Neue Karten sind ab deinem nächsten Zug spielbar.</p>
    {!me.development.length && <p>Noch keine Entwicklungskarten auf der Hand.</p>}
    {me.development.map((c) => <div className="catan-dev-card" key={c.id}><div><strong>{DEVELOPMENT_INFO[c.type].label}</strong><p>{DEVELOPMENT_INFO[c.type].description}</p></div>
      {c.type === "victory" ? <span className="catan-tag">+1 verdeckt</span> : <Button variant="outline" disabled={busy || !allowed || c.boughtOnTurn === game.turn || (c.type === "road_building" && !legalRoads(game, me.id).length)} onClick={() => { if (["plenty", "monopoly"].includes(c.type)) setChosenId(c.id); else void send({ type: "play_development", cardId: c.id }); }}>{c.boughtOnTurn === game.turn ? "Neu gekauft" : "Ausspielen"}</Button>}
    </div>)}
    {card && ["plenty", "monopoly"].includes(card.type) && <section className="catan-panel"><h3>{DEVELOPMENT_INFO[card.type].label}</h3>
      <ResourceSelect label={card.type === "monopoly" ? "Alle Karten dieser Art nehmen" : "Erster Rohstoff"} value={first} onChange={setFirst} disabled={busy} />
      {card.type === "plenty" && required > 1 && <ResourceSelect label="Zweiter Rohstoff" value={second} onChange={setSecond} disabled={busy} />}
      <Button className="catan-primary" disabled={busy || !allowed || (card.type === "plenty" && !canAfford(game.bank, chosen))} onClick={async () => { if (await send({ type: "play_development", cardId: card.id, resource: first, resources: chosen })) setChosenId(null); }}>Karte bestätigen</Button>
    </section>}
  </div>;
}

export function turnGuidance(game: CatanView): { title: string; text: string } {
  const active = game.players[game.currentPlayer]; const own = active.id === game.me?.id; const who = own ? "Du bist" : `${active.name} ist`;
  if (game.phase === "finished") return { title: `${game.players.find((p) => p.id === game.winner)!.name} gewinnt!`, text: `Das Ziel von ${game.targetPoints} Siegpunkten ist erreicht. Alle Punktestände sind aufgedeckt.` };
  if (game.phase === "setup_settlement") return { title: `${who} mit Gründen dran`, text: `${game.setupIndex < game.players.length ? "Erste" : "Zweite"} Siedlung: ${own ? "Wähle" : "Wartet auf"} eine markierte Kreuzung. Zwischen Siedlungen bleibt eine Kreuzung frei.` };
  if (game.phase === "setup_road") return { title: `${who} mit einer Straße dran`, text: "Die Straße muss direkt an die soeben gegründete Siedlung anschließen." };
  if (game.phase === "discard") return { title: "Eine 7: Rohstoffe abgeben", text: Object.entries(game.discards).map(([id, n]) => `${game.players.find((p) => p.id === id)!.name}: ${n} Karten`).join(" · ") };
  if (game.phase === "robber") return { title: `${who} mit dem Räuber dran`, text: "Wähle ein anderes Landfeld. Dort werden bis zum nächsten Versetzen keine Rohstoffe verteilt." };
  if (game.phase === "steal") return { title: `${who} mit Stehlen dran`, text: "Wähle eine Person am Räuberfeld. Eine zufällige Rohstoffkarte wechselt die Hand." };
  if (game.phase === "free_roads") return { title: `${game.freeRoads} kostenlose ${game.freeRoads === 1 ? "Straße" : "Straßen"}`, text: `${own ? "Baue" : active.name + " baut"} an den markierten Wegen weiter.` };
  if (game.phase === "roll") return { title: `${who} am Zug`, text: own ? "Würfle für die Rohstofferträge. Du darfst vorher eine ältere Entwicklungskarte spielen." : "Warte auf den Würfelwurf. Deine Handkarten siehst nur du." };
  return { title: `${who} am Zug`, text: own ? "Handle und baue in beliebiger Reihenfolge. Beende deinen Zug, sobald du fertig bist." : `Du kannst ${active.name} ein Handelsangebot machen.` };
}

export function CatanGameUI({ game, send, busy, local, onHide, onRematch }: { game: CatanView; send: Send; busy: boolean; local: boolean; onHide?: () => void; onRematch?: () => void }) {
  const [build, setBuild] = useState<BoardMode>(null); const [selection, setSelection] = useState<{ mode: BoardMode; id: number; phase: string; turn: number } | null>(null);
  const me = game.me!; const isTurn = game.players[game.currentPlayer].id === me.id; const guidance = turnGuidance(game);
  let mode: BoardMode = null;
  if (isTurn) {
    if (game.phase === "setup_settlement") mode = "settlement";
    else if (game.phase === "setup_road" || game.phase === "free_roads") mode = "road";
    else if (game.phase === "robber") mode = "robber";
    else if (game.phase === "main") mode = build;
  }
  const choices = mode === "road" ? legalRoads(game, me.id, game.phase === "setup_road" ? game.setupVertex : null) : mode === "settlement" ? legalSettlements(game, me.id, game.phase === "setup_settlement") : mode === "city" ? legalCities(game, me.id) : mode === "robber" ? game.board.hexes.filter((h) => h.id !== game.robberHex).map((h) => h.id) : [];
  const selected = selection && selection.mode === mode && selection.turn === game.turn && selection.phase === game.phase && choices.includes(selection.id) ? selection.id : null;
  const canBuild = game.phase !== "main" || (mode && mode !== "robber" && canAfford(me.resources, COSTS[mode]));
  const commit = async () => { if (selected === null) return; const action = boardAction(mode, selected); if (action && await send(action)) { setSelection(null); setBuild(null); } };
  return <div className="catan-play">
    <section className={`catan-turn ${isTurn ? "is-yours" : ""}`} aria-live="polite"><div><span className="catan-kicker">{game.turn ? `Zug ${game.turn}` : "Gründungsphase"} · Ziel {game.targetPoints} Punkte</span><h1>{guidance.title}</h1><p>{guidance.text}</p></div>
      {game.dice && <div className="catan-dice" aria-label={`Würfel: ${game.dice[0]} und ${game.dice[1]}, Summe ${game.dice[0] + game.dice[1]}`}><span>{["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"][game.dice[0]]}</span><span>{["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"][game.dice[1]]}</span></div>}
    </section>
    <section className="catan-players" aria-label="Spielende und Punktestände">{game.players.map((p) => <div key={p.id} className={game.players[game.currentPlayer].id === p.id ? "is-active" : ""} style={{ "--player-color": PLAYER_COLORS[p.color] } as React.CSSProperties}>
      <div><span className="catan-player-dot" /><strong>{p.name}{p.id === me.id ? " (du)" : ""}</strong><b>{p.id === me.id ? victoryPoints(game, me) : p.points}<small> / {game.targetPoints}</small></b></div>
      <p>{PLAYER_COLOR_NAMES[p.color]} · {p.resourceCount} Rohstoffe · {p.developmentCount} Karten</p>
      <div className="catan-player-bonuses"><span title="Länge der Handelsstraße"><Route />{p.roadLength}</span><span title="Ausgespielte Ritter"><Shield />{p.knights}</span>{game.longestRoad === p.id && <span className="catan-award">Straße +2</span>}{game.largestArmy === p.id && <span className="catan-award">Ritter +2</span>}</div>
    </div>)}</section>
    <div className="catan-table">
      <div className="catan-map-column"><CatanBoard game={game} mode={mode} choices={choices} selected={selected} onSelect={(id) => setSelection({ mode, id, phase: game.phase, turn: game.turn })} disabled={busy} />
        {mode && <div className="catan-build-confirm" aria-live="polite"><p>{selected === null ? `Wähle ${mode === "robber" ? "ein Feld" : "einen markierten Bauplatz"}. Bei Bedarf vergrößern.` : `${mode === "robber" ? "Räuber: Feld" : mode === "road" ? "Straße: Weg" : BUILDING_NAMES[mode] + ": Kreuzung"} ${selected + 1}`}</p><Button disabled={busy || selected === null || !canBuild} onClick={() => void commit()}>{mode === "robber" ? "Räuber versetzen" : "Bauen bestätigen"}</Button>{game.phase === "main" && <Button variant="ghost" onClick={() => { setBuild(null); setSelection(null); }}>Abbrechen</Button>}</div>}
        <details className="catan-bank"><summary>Bank &amp; Vorräte</summary><div>{RESOURCES.map((r) => <span key={r}><ResourceIcon resource={r} />{RESOURCE_INFO[r].label}<strong>{game.bank[r]}</strong></span>)}</div><p>{game.deckCount} Entwicklungskarten im Stapel · Dein Vorrat: {15 - game.players.find((p) => p.id === me.id)!.pieces.road} Straßen, {5 - game.players.find((p) => p.id === me.id)!.pieces.settlement} Siedlungen, {4 - game.players.find((p) => p.id === me.id)!.pieces.city} Städte</p></details>
        <details className="catan-log"><summary>Spielverlauf</summary><ol>{[...game.log].reverse().map((entry) => <li key={entry.id}>{entry.text}</li>)}</ol></details>
      </div>
      <aside className="catan-sidebar" aria-label="Deine Aktionen">
        {game.phase === "finished" ? <section className="catan-panel catan-victory"><Trophy /><h2>Die Insel hat einen Sieger.</h2><p>{game.players.find((p) => p.id === game.winner)!.name} hat das Ziel erreicht.</p>{onRematch && <Button className="catan-primary" disabled={busy} onClick={onRematch}>Neue Partie vorbereiten</Button>}</section> : <>
          <section className="catan-hand"><div className="catan-section-heading"><h2><Hand />Deine Rohstoffe</h2>{local && onHide && <Button variant="ghost" size="icon" onClick={onHide} aria-label="Handkarten verdecken"><LockKeyhole /></Button>}</div>
            <div className="catan-resource-hand">{RESOURCES.map((r) => <div key={r}><ResourceIcon resource={r} /><strong>{me.resources[r]}</strong><span>{RESOURCE_INFO[r].label}</span></div>)}</div>
            <p className="catan-muted"><LockKeyhole />Nur für {me.name} · Deine Punkte enthalten verdeckte Siegpunktkarten.</p>
          </section>
          {game.phase === "discard" && game.discards[me.id] > 0 && <Discard key={`${game.turn}-${me.id}`} game={game} send={send} busy={busy} />}
          {isTurn && game.phase === "steal" && <section className="catan-panel"><h2>Wen möchtest du bestehlen?</h2>{game.victims.map((id) => <Button className="catan-primary" variant="outline" key={id} disabled={busy} onClick={() => void send({ type: "steal", victimId: id })}>{game.players.find((p) => p.id === id)!.name}</Button>)}</section>}
          {isTurn && game.phase === "roll" && <Button className="catan-primary catan-roll-button" disabled={busy} onClick={() => void send({ type: "roll" })}><Dices />Würfeln</Button>}
          {game.phase === "main" && <Tabs defaultValue={isTurn && !game.trade ? "build" : "trade"} key={`${game.turn}-${Boolean(game.trade)}`}><TabsList className="catan-tabs">
            <TabsTrigger value="build"><Hammer />Bauen</TabsTrigger><TabsTrigger value="trade"><ArrowRightLeft />Handeln</TabsTrigger><TabsTrigger value="cards"><Shield />Karten</TabsTrigger></TabsList>
            <TabsContent value="build"><div className="catan-build-actions">{(["road", "settlement", "city"] as const).map((kind) => { const Icon = BuildIcon[kind]; const legal = kind === "road" ? legalRoads(game, me.id) : kind === "city" ? legalCities(game, me.id) : legalSettlements(game, me.id);
              return <Button variant="outline" className={mode === kind ? "is-selected" : ""} key={kind} disabled={busy || !isTurn || !canAfford(me.resources, COSTS[kind]) || !legal.length} onClick={() => { setBuild(kind); setSelection(null); }}><Icon /><span><strong>{BUILDING_NAMES[kind]}</strong><Cost cost={COSTS[kind]} /></span></Button>;
            })}<Button variant="outline" disabled={busy || !isTurn || !game.deckCount || !canAfford(me.resources, COSTS.development)} onClick={() => void send({ type: "buy_development" })}><Shield /><span><strong>Entwicklungskarte kaufen</strong><Cost cost={COSTS.development} /></span></Button></div>
              <p className="catan-muted">Ein Bauwerk wählen, dann den markierten Platz auf der Insel bestätigen.</p>
            </TabsContent><TabsContent value="trade"><TradePanel game={game} send={send} busy={busy} /></TabsContent><TabsContent value="cards"><DevelopmentCards game={game} send={send} busy={busy} /></TabsContent>
          </Tabs>}
          {game.phase === "roll" && <details className="catan-rules"><summary><Shield />Entwicklungskarten ({me.development.length})</summary><DevelopmentCards game={game} send={send} busy={busy} /></details>}
          {isTurn && game.phase === "main" && <Button className="catan-end-turn" disabled={busy} onClick={() => void send({ type: "end_turn" })}>Zug beenden →</Button>}
          {!["main", "roll", "finished"].includes(game.phase) && <p className="catan-wait-hint">{isTurn || game.discards[me.id] ? "Folge der Aufgabe über dem Spielfeld." : "Der Spielstand aktualisiert sich automatisch."}</p>}
        </>}
        <CatanRules />
      </aside>
    </div>
  </div>;
}
