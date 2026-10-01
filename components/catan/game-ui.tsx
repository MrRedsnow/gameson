"use client";

import { useCallback, useState, type ReactNode } from "react";
import { ArrowRightLeft, BookOpen, Castle, ChevronDown, CircleHelp, Dices, Flag, Hammer, LockKeyhole, Map as MapIcon, Maximize2, Minimize2, Shield, Users, Volume2, VolumeX, WalletCards, WifiOff, X, type LucideIcon } from "lucide-react";
import { Popover, Tabs as TabsPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { CatanBoard, ResourceIcon, boardAction, type BoardMode } from "./board";
import { CatanDice } from "./dice";
import { CatanResourceHand } from "./resource-hand";
import { useCatanActivity } from "./activity";
import { ActivityNotice } from "./activity-notice";
import { useCatanSounds } from "./sound";
import { CardsPanel } from "./cards-panel";
import { OverviewPanel, type OverviewPage } from "./overview-panel";
import { Screen, type Send } from "./play-primitives";
import { SetupGuide } from "./setup-guide";
import { TradePanel } from "./trade-panel";
import { useIslandFullscreen } from "./use-island-fullscreen";
import { COSTS, MAX_TARGET_POINTS, MIN_TARGET_POINTS, PLAYER_COLORS, RESOURCES, RESOURCE_INFO, canAfford, legalCities, legalRoads, legalSettlements, victoryPoints, type CatanView, type Resources } from "@/lib/catan";
import { buildingPreview, buildPhaseUnavailable, buildUnavailable, type BuildKind } from "@/lib/catan-ux";
export { TradePanel } from "./trade-panel";

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
    <div className="catan-rule-legend">{RESOURCES.map((r) => <span key={r}><ResourceIcon resource={r} />{RESOURCE_INFO[r].label}</span>)}<span><b>R</b> Räuber</span></div>
    <a href="https://www.catan.com/sites/default/files/2021-06/catan_base_rules_2020_200707.pdf" target="_blank" rel="noreferrer">Offizielle Regeln &amp; Almanach (PDF)</a>
  </div></details>;
}
const BUILDING_NAMES: Record<string, string> = { road: "Straße", settlement: "Siedlung", city: "Stadt", development: "Entwicklungskarte" };
const BuildIcon = { road: MapIcon, settlement: Flag, city: Castle, development: Shield };
function Cost({ cost }: { cost: Partial<Resources> }) {
  return <span className="catan-cost">{RESOURCES.filter((r) => cost[r]).map((r) => <span key={r} title={RESOURCE_INFO[r].label}><ResourceIcon resource={r} />{cost[r]}<span className="sr-only"> {RESOURCE_INFO[r].label}</span></span>)}</span>;
}
export function turnGuidance(game: CatanView): { title: string; text: string } {
  const active = game.players[game.currentPlayer]; const own = active.id === game.me?.id; const who = own ? "Du bist" : `${active.name} ist`;
  if (game.phase === "finished") return { title: `${game.players.find((p) => p.id === game.winner)!.name} gewinnt!`, text: `Das Ziel von ${game.targetPoints} Siegpunkten ist erreicht. Alle Punktestände sind aufgedeckt.` };
  if (game.phase === "setup_settlement") return { title: `${who} mit der Gründung dran`, text: `${game.setupIndex < game.players.length ? "Erste" : "Zweite"} Siedlung: ${own ? "Wähle" : "Wartet auf"} eine markierte Kreuzung. Zwischen Siedlungen bleibt eine Kreuzung frei.` };
  if (game.phase === "setup_road") return { title: `${who} mit einer Straße dran`, text: "Die Straße muss direkt an die soeben gegründete Siedlung anschließen." };
  if (game.phase === "discard") return { title: "Eine 7: Rohstoffe abgeben", text: Object.entries(game.discards).map(([id, n]) => `${game.players.find((p) => p.id === id)!.name}: ${n} Karten`).join(" · ") };
  if (game.phase === "robber") return { title: `${who} mit dem Räuber dran`, text: "Wähle ein anderes Landfeld. Dort werden bis zum nächsten Versetzen keine Rohstoffe verteilt." };
  if (game.phase === "steal") return { title: `${who} mit Stehlen dran`, text: "Wähle eine Person am Räuberfeld. Eine zufällige Rohstoffkarte wechselt die Hand." };
  if (game.phase === "free_roads") return { title: `${game.freeRoads} kostenlose ${game.freeRoads === 1 ? "Straße" : "Straßen"}`, text: `${own ? "Baue" : active.name + " baut"} an den markierten Wegen weiter.` };
  if (game.phase === "roll") return { title: `${who} am Zug`, text: own ? "Würfle für die Rohstofferträge. Du darfst vorher eine ältere Entwicklungskarte spielen." : "Warte auf den Würfelwurf. Deine Handkarten siehst nur du." };
  return { title: `${who} am Zug`, text: own ? "Handle und baue in beliebiger Reihenfolge. Beende deinen Zug, sobald du fertig bist." : `Du kannst ${active.name} ein Handelsangebot machen.` };
}

export type CatanTab = "insel" | "karten" | "bauen" | "handel" | "uebersicht";
export const CATAN_TABS: { id: CatanTab; label: string; Icon: LucideIcon }[] = [
  { id: "insel", label: "Insel", Icon: MapIcon }, { id: "karten", label: "Karten", Icon: WalletCards },
  { id: "bauen", label: "Bauen", Icon: Hammer }, { id: "handel", label: "Handel", Icon: ArrowRightLeft }, { id: "uebersicht", label: "Übersicht", Icon: Users },
];
export function suggestedTab(game: CatanView): CatanTab {
  if (game.phase === "finished") return "uebersicht";
  if (game.phase === "discard" && game.discards[game.me!.id] > 0) return "karten";
  if (game.trade && [game.trade.toId, game.trade.fromId].includes(game.me!.id)) return "handel";
  // Rolling never replaces the island with a screen of unavailable buildings.
  return "insel";
}
export function navigationTask(game: CatanView): { key: string; tab: CatanTab } | null {
  const own = game.players[game.currentPlayer].id === game.me!.id;
  if (game.phase === "finished") return { key: "finished", tab: "uebersicht" };
  if (game.phase === "discard" && game.discards[game.me!.id] > 0) return { key: `discard:${game.turn}`, tab: "karten" };
  if (game.trade?.toId === game.me!.id) return { key: `offer:${game.trade.id}`, tab: "handel" };
  if (own && (game.phase.startsWith("setup") || ["robber", "steal", "free_roads"].includes(game.phase))) return { key: `${game.turn}:${game.phase}:${game.setupIndex}`, tab: "insel" };
  return null;
}

export function resolveNavigation(game: CatanView, state: { task: string | null; tab: CatanTab }) {
  const task = navigationTask(game);
  if (task?.key === state.task || (!task && state.task === null)) return state;
  return { task: task?.key ?? null, tab: task?.tab ?? state.tab };
}

function BuildChoices({ game, busy, onBuild }: { game: CatanView; busy: boolean; onBuild: (kind: BuildKind) => void }) {
  const restriction = buildPhaseUnavailable(game);
  return <>
    {restriction && <p className="catan-inline-hint" role="status">{restriction}</p>}
    <div className="catan-build-list">{(Object.keys(COSTS) as BuildKind[]).map((kind) => {
      const Icon = BuildIcon[kind]; const reason = buildUnavailable(game, kind);
      return <button type="button" className="catan-build-choice" key={kind} aria-disabled={busy || Boolean(reason)} onClick={() => { if (!busy && !reason) onBuild(kind); }}>
        <Icon /><span><strong>{BUILDING_NAMES[kind]}{kind === "development" ? " kaufen" : ""}</strong><Cost cost={COSTS[kind]} />
          {reason && !restriction && <small className="is-unavailable">{reason}</small>}
          {kind === "development" && <small>{game.deckCount} im Stapel</small>}
        </span>
      </button>;
    })}</div>
  </>;
}

function PlacementPreview({ game, mode, selected, compact = false }: { game: CatanView; mode: NonNullable<BoardMode>; selected: number; compact?: boolean }) {
  const preview = buildingPreview(game, mode, selected);
  const content = <>
    <div className="catan-placement-fields">{preview.fields.map((field) => <span key={field.id}><strong><ResourceIcon resource={field.resource} />{RESOURCE_INFO[field.resource].label} · {field.number}</strong><small>{field.blocked && mode !== "robber" ? "Räuber blockiert" : `${field.combinations} / 36 Würfe`}</small></span>)}{!preview.fields.length && <span>Hier gibt es keine Rohstofffelder.</span>}</div>
    <p>{preview.hint} {preview.port}</p>
  </>;
  return compact ? <details className="catan-placement-preview catan-placement-detail" aria-label="Vorschau des gewählten Bauplatzes">
    <summary>{mode === "robber" ? "Räuberfeld" : BUILDING_NAMES[mode]} · Details <ChevronDown /></summary>{content}
  </details> : <aside className="catan-placement-preview" aria-label="Vorschau des gewählten Bauplatzes" aria-live="polite">{content}</aside>;
}

export function CatanGameUI({ game, send, busy, local, offline = false, onHide, onRematch, afterNotificationSequence, onActivityRead }: {
  game: CatanView; send: Send; busy: boolean; local: boolean; offline?: boolean; onHide?: () => void; onRematch?: () => void;
  afterNotificationSequence?: number; onActivityRead?: (sequence: number) => void;
}) {
  const [build, setBuild] = useState<{ mode: BoardMode; turn: number } | null>(null);
  const [buildMenuOpen, setBuildMenuOpen] = useState(false);
  const [guideDismissed, setGuideDismissed] = useState(false);
  const [guideRequested, setGuideRequested] = useState(false);
  const [selection, setSelection] = useState<{ mode: BoardMode; id: number; phase: string; turn: number } | null>(null);
  const [choice, setChoice] = useState(() => ({ task: navigationTask(game)?.key ?? null, tab: suggestedTab(game) }));
  const [overviewChoice, setOverviewChoice] = useState<{ finished: boolean; page: OverviewPage }>({ finished: game.phase === "finished", page: "menu" });
  const overviewPage = overviewChoice.finished === (game.phase === "finished") ? overviewChoice.page : "menu";
  const setOverviewPage = (page: OverviewPage) => setOverviewChoice({ finished: game.phase === "finished", page });
  const me = game.me!; const active = game.players[game.currentPlayer]; const own = active.id === me.id;
  const navigation = resolveNavigation(game, choice);
  if (navigation !== choice) setChoice(navigation);
  const tab = navigation.tab;
  const collapseBuildMenu = useCallback(() => setBuildMenuOpen(false), []);
  const fullscreen = useIslandFullscreen(tab === "insel", collapseBuildMenu);
  const { expanded } = fullscreen;
  const selectTab = (next: CatanTab) => { if (next !== "insel") fullscreen.close(); setChoice({ task: navigation.task, tab: next }); };
  const showOverview = (page: OverviewPage) => { setOverviewPage(page); selectTab("uebersicht"); };
  const activity = useCatanActivity(game, afterNotificationSequence, onActivityRead);
  const sounds = useCatanSounds(game);
  const guidance = turnGuidance(game);
  const finished = game.phase === "finished"; const needsDiscard = game.phase === "discard" && game.discards[me.id] > 0;
  const setup = own && game.phase.startsWith("setup");
  const guideOpen = setup && (guideRequested || (!guideDismissed && game.players.find((p) => p.id === me.id)!.pieces.settlement === 0));
  const closeGuide = () => { setGuideDismissed(true); setGuideRequested(false); };
  let mode: BoardMode = null;
  if (own) {
    if (game.phase === "setup_settlement") mode = "settlement";
    else if (game.phase === "setup_road" || game.phase === "free_roads") mode = "road";
    else if (game.phase === "robber") mode = "robber";
    else if (game.phase === "main" && build?.turn === game.turn) mode = build.mode;
  }
  const choices = mode === "road" ? legalRoads(game, me.id, game.phase === "setup_road" ? game.setupVertex : null) : mode === "settlement" ? legalSettlements(game, me.id, game.phase === "setup_settlement") : mode === "city" ? legalCities(game, me.id) : mode === "robber" ? game.board.hexes.filter((h) => h.id !== game.robberHex).map((h) => h.id) : [];
  const selected = selection && selection.mode === mode && selection.phase === game.phase && selection.turn === game.turn && choices.includes(selection.id) ? selection.id : null;
  const canBuild = game.phase !== "main" || (mode && mode !== "robber" && canAfford(me.resources, COSTS[mode]));
  const cancelBuild = () => {
    if (busy) return;
    setBuild(null); setSelection(null);
    if (expanded) setBuildMenuOpen(true);
    else selectTab("bauen");
  };
  const startBuild = async (kind: BuildKind) => {
    if (busy || buildUnavailable(game, kind)) return;
    if (kind === "development") {
      if (await send({ type: "buy_development" })) setBuildMenuOpen(false);
    } else {
      setBuild({ mode: kind, turn: game.turn }); setSelection(null); setBuildMenuOpen(false); selectTab("insel");
    }
  };
  const commit = async () => { const action = selected === null ? null : boardAction(mode, selected); if (action && await send(action)) { setBuild(null); setSelection(null); selectTab("insel"); } };
  const hideHand = () => { fullscreen.close(); onHide?.(); };
  const endTurn = <Button variant="outline" className="catan-end-turn" disabled={busy} onClick={async () => { if (await send({ type: "end_turn" })) { setBuild(null); setSelection(null); } }}>Zug beenden</Button>;
  const go = (target: CatanTab, text: string) => <Button className="catan-primary" onClick={() => selectTab(target)}>{text}</Button>;
  let turnActions: ReactNode;
  if (needsDiscard) turnActions = go("karten", `${game.discards[me.id]} Karten abgeben`);
  else if (mode) turnActions = go("insel", `${mode === "robber" ? "Räuber" : BUILDING_NAMES[mode]} auf der Insel setzen`);
  else if (own && game.phase === "steal") turnActions = go("insel", "Person zum Bestehlen wählen");
  else if (own && game.phase === "roll") turnActions = <Button className="catan-primary catan-roll-button" disabled={busy} onClick={() => void send({ type: "roll" })}><Dices />Würfeln</Button>;
  else if (own && game.phase === "main" && !game.trade) turnActions = endTurn;
  else if (own && game.phase === "main" && game.trade) turnActions = go("handel", "Offenen Handel ansehen");

  let islandActions = turnActions;
  if (mode) islandActions = <>{game.phase === "main" && <Button variant="outline" disabled={busy} onClick={cancelBuild}>Abbrechen</Button>}<Button className="catan-primary" disabled={busy || selected === null || !canBuild} onClick={() => void commit()}>{mode === "robber" ? "Räuber versetzen" : expanded ? "Bauen" : "Bauen bestätigen"}</Button></>;
  else if (own && game.phase === "steal") islandActions = undefined;
  const islandTitle = mode === "settlement" && game.phase === "setup_settlement" ? `${game.setupIndex < game.players.length ? "Erste" : "Zweite"} Siedlung setzen`
    : mode ? `${mode === "robber" ? "Räuber" : BUILDING_NAMES[mode]} platzieren` : own && game.phase === "steal" ? "Wen möchtest du bestehlen?" : "Eure Insel";
  const badges: Partial<Record<CatanTab, { text?: string; tone: string; description: string }>> = {
    karten: needsDiscard ? { text: String(game.discards[me.id]), tone: "is-alert", description: `${game.discards[me.id]} Rohstoffkarten abgeben` } : me.development.length ? { text: String(me.development.length), tone: "", description: `${me.development.length} Entwicklungskarten` } : undefined,
    handel: game.trade?.toId === me.id ? { text: "1", tone: "is-alert", description: "Ein Handelsangebot wartet auf deine Antwort" } : game.trade?.fromId === me.id ? { tone: "is-dot", description: "Dein Angebot ist noch offen" } : undefined,
    insel: mode || (own && game.phase === "steal") ? { tone: "is-dot", description: "Die Insel wartet auf deine Auswahl" } : undefined,
    uebersicht: activity.unread.length ? { text: String(activity.unread.length), tone: "", description: "Neue Meldungen" } : undefined,
  };
  const notice = <ActivityNotice scope={JSON.stringify([game.id, me.id])} unread={activity.unread} onOpen={() => showOverview("activity")} onRead={activity.read} />;
  return <TabsPrimitive.Root className={`catan-play${expanded ? " is-board-expanded" : ""}`} value={tab} onKeyDown={(event) => {
    if (event.key === "Escape" && expanded && !event.defaultPrevented && !(event.target instanceof Element && event.target.closest("[data-radix-popper-content-wrapper]"))) {
      event.preventDefault(); fullscreen.close();
    }
  }} onValueChange={(next) => selectTab(next as CatanTab)}>
    <div className={`catan-status ${own ? "is-yours" : ""}`} style={{ "--player-color": PLAYER_COLORS[active.color] } as React.CSSProperties}>
      <Popover.Root><Popover.Trigger asChild><button type="button" className="catan-status-main" aria-label={`${guidance.title}, Zug erklären`}><i className="catan-player-dot" /><strong>{guidance.title}</strong><ChevronDown /></button></Popover.Trigger><Popover.Portal><Popover.Content className="catan-phase-help" sideOffset={8} collisionPadding={16}><h2>{guidance.title}</h2><p>{guidance.text}</p><Popover.Close aria-label="Erklärung schließen"><X /></Popover.Close></Popover.Content></Popover.Portal></Popover.Root>
      {offline && <span className="catan-status-offline" role="status" aria-label="Verbindung unterbrochen"><WifiOff /></span>}
      <CatanDice dice={game.dice} />
      {expanded && !mode && turnActions && <div className="catan-status-actions">{turnActions}</div>}
      <button type="button" className="catan-status-points" aria-label={`Punktestand öffnen: Du hast ${victoryPoints(game, me)} von ${game.targetPoints} Siegpunkten`} onClick={() => showOverview("scores")}>{victoryPoints(game, me)}<small>/{game.targetPoints}</small></button>
      {local && onHide && !finished && <Button variant="ghost" size="icon" className="catan-hide-button" onClick={hideHand} aria-label="Handkarten verdecken"><LockKeyhole /></Button>}
    </div>
    <CatanResourceHand game={game} islandVisible={tab === "insel"} />
    {notice}

    <TabsPrimitive.Content value="insel" forceMount className="catan-tab-panel catan-tab-insel">
      <Screen title={islandTitle} className="catan-island-screen" actions={expanded && !mode ? undefined : islandActions} headingAction={<div className="catan-island-tools">{setup && <Button variant="ghost" size="icon" aria-label="Starthilfe zur Gründung" aria-expanded={guideOpen} onClick={() => guideOpen ? closeGuide() : setGuideRequested(true)}><CircleHelp /></Button>}<Button variant="ghost" size="icon" className="catan-sound-toggle" aria-label={sounds.enabled ? "Soundeffekte ausschalten" : "Soundeffekte einschalten"} aria-pressed={sounds.enabled} title="Schaf-Mäh und Holzhacken bei Rohstofferträgen und beim Ansehen eines Feldes" onClick={() => void sounds.toggle()}>{sounds.enabled ? <Volume2 /> : <VolumeX />}</Button><Button variant="outline" size="icon" aria-label={expanded ? "Vollbild der Insel schließen" : "Insel im Vollbild öffnen"} aria-pressed={expanded} title={expanded ? "Zurück zur Spielansicht (Esc)" : "Insel maximieren"} onClick={() => { if (!expanded) closeGuide(); fullscreen.toggle(); }}>{expanded ? <Minimize2 /> : <Maximize2 />}</Button></div>}>
        <CatanBoard game={game} mode={mode} choices={choices} selected={selected} onSelect={(id) => { closeGuide(); setSelection({ mode, id, phase: game.phase, turn: game.turn }); }} disabled={busy} onInspect={sounds.preview} expanded={expanded} />
        <div className="catan-island-context">
          {expanded && mode && <p className="catan-fullscreen-task" role="status">{islandTitle}{selected === null ? " · Wähle einen markierten Platz" : " · Platz gewählt"}</p>}
          {own && game.phase === "steal" && <div className="catan-victim-choices">{game.victims.map((id) => <Button variant="outline" key={id} disabled={busy} onClick={() => void send({ type: "steal", victimId: id })}>{game.players.find((p) => p.id === id)!.name} bestehlen</Button>)}</div>}
          {game.phase === "discard" && !needsDiscard && <p className="catan-inline-hint">Andere geben Rohstoffe ab. Danach geht es weiter.</p>}
          {guideOpen && <SetupGuide onClose={closeGuide} />}
          {mode && selected !== null && <PlacementPreview game={game} mode={mode} selected={selected} compact={expanded} />}
          {!canBuild && mode && mode !== "robber" && <p className="catan-inline-hint" role="status">{buildUnavailable(game, mode)}</p>}
        </div>
        {expanded && <Popover.Root open={buildMenuOpen} onOpenChange={setBuildMenuOpen}>
          <Popover.Trigger asChild><Button type="button" variant="outline" size="icon" className="catan-floating-build" aria-label="Baumenü öffnen"><Hammer /></Button></Popover.Trigger>
          <Popover.Portal><Popover.Content className="catan-theme catan-build-popover" side="top" align="end" sideOffset={12} collisionPadding={12} aria-label="Baumenü">
            <header><h2>Was möchtest du bauen?</h2><Popover.Close asChild><Button variant="ghost" size="icon" aria-label="Baumenü schließen"><X /></Button></Popover.Close></header>
            <BuildChoices game={game} busy={busy} onBuild={(kind) => void startBuild(kind)} />
          </Popover.Content></Popover.Portal>
        </Popover.Root>}
      </Screen>
    </TabsPrimitive.Content>
    <TabsPrimitive.Content value="karten" forceMount className="catan-tab-panel"><CardsPanel game={game} send={send} busy={busy} turnActions={turnActions} /></TabsPrimitive.Content>
    <TabsPrimitive.Content value="bauen" forceMount className="catan-tab-panel"><Screen title="Was möchtest du bauen?" actions={turnActions}>
      <BuildChoices game={game} busy={busy} onBuild={(kind) => void startBuild(kind)} />
    </Screen></TabsPrimitive.Content>
    <TabsPrimitive.Content value="handel" forceMount className="catan-tab-panel"><TradePanel game={game} send={send} busy={busy} turnActions={turnActions} /></TabsPrimitive.Content>
    <TabsPrimitive.Content value="uebersicht" forceMount className="catan-tab-panel"><OverviewPanel game={game} page={overviewPage} setPage={setOverviewPage} activity={activity.all} unreadActivity={activity.unread} unread={activity.unread.length} onRead={activity.read} local={local} onHide={onHide ? hideHand : undefined} onRematch={onRematch} busy={busy} turnActions={turnActions} /></TabsPrimitive.Content>
    <nav className="catan-nav" aria-label="Spielmenü"><TabsPrimitive.List className="catan-nav-list" aria-label="Bereiche">{CATAN_TABS.map(({ id, label, Icon }) => { const badge = badges[id]; return <TabsPrimitive.Trigger key={id} value={id} className="catan-nav-tab"><span className="catan-nav-icon"><Icon />{badge && <span className={`catan-nav-badge ${badge.tone}`} aria-hidden="true">{badge.text}</span>}</span><span className="catan-nav-label">{label}</span>{badge && <span className="sr-only">, {badge.description}</span>}</TabsPrimitive.Trigger>; })}</TabsPrimitive.List></nav>
  </TabsPrimitive.Root>;
}
