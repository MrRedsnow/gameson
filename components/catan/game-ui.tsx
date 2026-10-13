"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowRightLeft, BookOpen, Castle, Check, ChevronRight, CircleHelp, Dices, Flag, Hammer, Map as MapIcon, Maximize2, Minimize2, Route, Shield, Users, Volume2, VolumeX, WalletCards, WifiOff, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CatanBoard, ResourceIcon, boardAction, type BoardMode } from "./board";
import { CatanDice } from "./dice";
import { CatanResourceHand } from "./resource-hand";
import { useCatanActivity } from "./activity";
import { useCatanSounds } from "./sound";
import { useAmbientPreference } from "./use-ambient-preference";
import { useWaterPreference } from "./use-water-preference";
import { CatanEventNotice } from "./event-notice";
import { CardsPanel } from "./cards-panel";
import { OverviewPanel, type OverviewPage } from "./overview-panel";
import { Screen, type Send } from "./play-primitives";
import { SetupGuide } from "./setup-guide";
import { MapVoteActions, MapVotePanel } from "./map-vote";
import { TradePanel } from "./trade-panel";
import { useIslandFullscreen } from "./use-island-fullscreen";
import { useFullscreenMenu, type FullscreenMenu } from "./use-fullscreen-menu";
import { COSTS, MAX_TARGET_POINTS, MIN_TARGET_POINTS, PLAYER_COLORS, RESOURCES, RESOURCE_INFO, canAfford, isTradeRecipient, legalCities, legalRoads, legalSettlements, mapVoteProgress, resourceCount, victoryPoints, type CatanView, type Resources } from "@/lib/catan";
import { buildPhaseUnavailable, buildUnavailable, missingResources, type BuildKind } from "@/lib/catan-ux";
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
    <p><strong>Kartenabstimmung:</strong> Vor jeder Partie stimmen alle über die Karte ab. Nach allen Stimmen gilt die Mehrheit; bei 2:2 entscheidet die Spielleitung. Bei Ablehnung wird eine neue Karte erzeugt und erneut abgestimmt. Lokal ist die zuerst eingetragene Person die Spielleitung.</p>
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
const BuildIcon = { road: Route, settlement: Flag, city: Castle, development: Shield };
const BUILDING_DESCRIPTIONS: Record<BuildKind, string> = {
  road: "Verbindet Siedlungen und erweitert dein Netz.",
  settlement: "Bringt dir Siegpunkte und neue Rohstoffe.",
  city: "Ersetzt eine Siedlung. Doppelte Rohstofferträge!",
  development: "Zieh eine Entwicklungskarte.",
};
function Cost({ cost, available }: { cost: Partial<Resources>; available?: Resources }) {
  return <span className="catan-cost">{RESOURCES.filter((r) => cost[r]).map((r) => {
    const missing = available !== undefined && available[r] < cost[r]!;
    return <span key={r} data-catan-cost={r} title={RESOURCE_INFO[r].label}><ResourceIcon resource={r} /><b className={missing ? "is-missing" : undefined}>{cost[r]}</b><span className="sr-only"> {RESOURCE_INFO[r].label}{missing ? ` benötigt, ${available[r]} vorhanden` : ""}</span></span>;
  })}</span>;
}
export type CatanTab = "insel" | "karten" | "bauen" | "handel" | "uebersicht";
export const CATAN_TABS: { id: CatanTab; label: string; Icon: LucideIcon }[] = [
  { id: "insel", label: "Insel", Icon: MapIcon }, { id: "karten", label: "Karten", Icon: WalletCards },
  { id: "bauen", label: "Bauen", Icon: Hammer }, { id: "handel", label: "Handel", Icon: ArrowRightLeft }, { id: "uebersicht", label: "Übersicht", Icon: Users },
];
export function suggestedTab(game: CatanView): CatanTab {
  if (game.phase === "finished") return "uebersicht";
  if (game.phase === "discard" && game.discards[game.me!.id] > 0) return "karten";
  if (game.trade && (game.trade.fromId === game.me!.id || isTradeRecipient(game.trade, game.me!.id))) return "handel";
  // Rolling never replaces the island with a screen of unavailable buildings.
  return "insel";
}
export function navigationTask(game: CatanView): { key: string; tab: CatanTab } | null {
  const own = game.players[game.currentPlayer].id === game.me!.id;
  if (game.phase === "map_vote") return { key: `map:${game.mapVote!.id}:${Object.keys(game.mapVote!.votes).length === game.players.length ? "tie" : "vote"}`, tab: "insel" };
  if (game.phase === "finished") return { key: "finished", tab: "uebersicht" };
  if (game.phase === "discard" && game.discards[game.me!.id] > 0) return { key: `discard:${game.turn}`, tab: "karten" };
  if (game.trade && isTradeRecipient(game.trade, game.me!.id)) return { key: `offer:${game.trade.id}`, tab: "handel" };
  if (own && (game.phase.startsWith("setup") || ["robber", "steal", "free_roads"].includes(game.phase))) return { key: `${game.turn}:${game.phase}:${game.setupIndex}`, tab: "insel" };
  return null;
}

export function resolveNavigation(game: CatanView, state: { task: string | null; tab: CatanTab }) {
  const task = navigationTask(game);
  if (task?.key === state.task || (!task && state.task === null)) return state;
  return { task: task?.key ?? null, tab: task?.tab ?? state.tab };
}

function BuildChoices({ game, busy, selected, onBuild }: { game: CatanView; busy: boolean; selected: BuildKind | null; onBuild: (kind: BuildKind) => void }) {
  const restriction = buildPhaseUnavailable(game);
  return <>
    {restriction && <p className="catan-inline-hint" role="status">{restriction}</p>}
    <div className="catan-build-list">{(Object.keys(COSTS) as BuildKind[]).map((kind) => {
      const Icon = BuildIcon[kind]; const reason = buildUnavailable(game, kind);
      const missing = missingResources(game.me!.resources, COSTS[kind]);
      return <button type="button" className="catan-build-choice" key={kind} aria-pressed={selected === kind} aria-disabled={busy || Boolean(reason)} onClick={() => { if (!busy && !reason) onBuild(kind); }}>
        <Icon /><span><strong>{BUILDING_NAMES[kind]}{kind === "development" ? " kaufen" : ""}</strong><Cost cost={COSTS[kind]} available={game.me!.resources} />
          <small>{BUILDING_DESCRIPTIONS[kind]}</small>
          {reason && !restriction && reason !== missing && <small className="is-unavailable">{reason}</small>}
          {kind === "development" && <small>{game.deckCount} im Stapel</small>}
        </span>{selected === kind ? <Check aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
      </button>;
    })}</div>
  </>;
}

function RobberFieldPreview({ game, selected }: { game: CatanView; selected: number }) {
  const hex = game.board.hexes[selected];
  return <aside className="catan-robber-preview" aria-label="Vorschau des gewählten Räuberfelds" aria-live="polite">
    <strong>{hex.resource === "desert" ? "Wüste · kein Ertrag" : <><ResourceIcon resource={hex.resource} />{RESOURCE_INFO[hex.resource].terrain} · Zahl {hex.number}</>}</strong>
    <p>{hex.resource === "desert" ? "Auf der Wüste wird kein Rohstoffertrag blockiert." : "Dieses Feld liefert keinen Ertrag, solange der Räuber hier steht."}</p>
  </aside>;
}

export function CatanGameUI({ game, send: sendAction, busy: externalBusy, local, offline = false, onHide, onRematch, afterNotificationSequence, onActivityRead, animationBaseline = 0 }: {
  game: CatanView; send: Send; busy: boolean; local: boolean; offline?: boolean; onHide?: () => void; onRematch?: () => void;
  afterNotificationSequence?: number; onActivityRead?: (sequence: number) => void;
  animationBaseline?: number;
}) {
  const playRef = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const [inFlight, setInFlight] = useState(false);
  const busy = externalBusy || inFlight;
  const [build, setBuild] = useState<{ mode: BoardMode; context: string } | null>(null);
  const [buildChoice, setBuildChoice] = useState<{ context: string; kind: BuildKind } | null>(null);
  const [guideDismissed, setGuideDismissed] = useState(false);
  const [guideRequested, setGuideRequested] = useState(false);
  const [selection, setSelection] = useState<{ mode: BoardMode; id: number; context: string } | null>(null);
  const [victimChoice, setVictimChoice] = useState<{ id: string; context: string } | null>(null);
  const [choice, setChoice] = useState(() => ({ task: navigationTask(game)?.key ?? null, tab: suggestedTab(game) }));
  const menuId = useId();
  const [seaTarget, setSeaTarget] = useState<HTMLDivElement | null>(null);
  const [controlsTarget, setControlsTarget] = useState<HTMLDivElement | null>(null);
  const [overviewChoice, setOverviewChoice] = useState<{ finished: boolean; page: OverviewPage }>({ finished: game.phase === "finished", page: "menu" });
  const overviewPage = overviewChoice.finished === (game.phase === "finished") ? overviewChoice.page : "menu";
  const setOverviewPage = (page: OverviewPage) => setOverviewChoice({ finished: game.phase === "finished", page });
  const voting = game.phase === "map_vote";
  const me = game.me!; const active = game.players[game.currentPlayer]; const own = !voting && active.id === me.id;
  const buildContext = JSON.stringify([game.id, me.id, active.id, game.turn, game.phase]);
  const victimContext = JSON.stringify([buildContext, game.robberHex]);
  const selectedVictim = own && game.phase === "steal" && victimChoice?.context === victimContext && game.victims.includes(victimChoice.id) ? victimChoice.id : null;
  if (victimChoice && selectedVictim === null) setVictimChoice(null);
  const chosenBuild = buildChoice?.context === buildContext && !buildUnavailable(game, buildChoice.kind) ? buildChoice.kind : null;
  if (buildChoice && chosenBuild === null) setBuildChoice(null);
  const navigation = resolveNavigation(game, choice);
  if (navigation !== choice) setChoice(navigation);
  const tab = navigation.tab;
  const collapseMenu = useCallback(() => setChoice((current) => ({ ...current, tab: "insel" })), []);
  const fullscreen = useIslandFullscreen(collapseMenu);
  const { expanded } = fullscreen;
  const selectTab = useCallback((next: CatanTab) => setChoice({ task: navigation.task, tab: next }), [navigation.task]);
  const activeMenu = tab !== "insel" ? tab : null;
  const selectMenu = useCallback((next: FullscreenMenu | null) => selectTab(next ?? "insel"), [selectTab]);
  const { bindNav: menuNavRef, bindBoard: menuBoardRef, close: closeMenu, click: clickMenu } = useFullscreenMenu(activeMenu, selectMenu, expanded, navigation.task);
  const panelProps = (id: FullscreenMenu) => ({
    "data-state": activeMenu === id ? "active" : "inactive",
    "data-catan-menu-panel": id,
    "data-catan-fullscreen-panel": id,
    id: `${menuId}-${id}`,
    role: "dialog",
    "aria-label": CATAN_TABS.find((item) => item.id === id)!.label,
    "aria-labelledby": undefined,
    tabIndex: -1,
  });
  const activity = useCatanActivity(game, afterNotificationSequence, onActivityRead);
  const sounds = useCatanSounds(game, animationBaseline);
  const ambient = useAmbientPreference();
  const water = useWaterPreference();
  const send: Send = async (action) => {
    if (externalBusy || pending.current) return false;
    pending.current = true; setInFlight(true);
    try {
      const accepted = await sendAction(action);
      if (!accepted) sounds.cue("ui_error");
      else if (action.type === "cancel_trade") sounds.cue("ui_cancel");
      return accepted;
    } catch (error) { sounds.cue("ui_error"); throw error; }
    finally { pending.current = false; setInFlight(false); }
  };
  const finished = game.phase === "finished"; const needsDiscard = game.phase === "discard" && game.discards[me.id] > 0;
  const statusTitle = voting ? "Kartenabstimmung" : finished ? `${game.players.find((p) => p.id === game.winner)!.name} gewinnt!` : own ? "Du bist am Zug" : `${active.name} ist am Zug`;
  const setup = own && game.phase.startsWith("setup");
  const guideOpen = setup && (guideRequested || (!guideDismissed && game.players.find((p) => p.id === me.id)!.pieces.settlement === 0));
  const closeGuide = () => { setGuideDismissed(true); setGuideRequested(false); };
  let mode: BoardMode = null;
  if (own) {
    if (game.phase === "setup_settlement") mode = "settlement";
    else if (game.phase === "setup_road" || game.phase === "free_roads") mode = "road";
    else if (game.phase === "robber") mode = "robber";
    else if (game.phase === "main" && build?.context === buildContext) mode = build.mode;
  }
  const choices = mode === "road" ? legalRoads(game, me.id, game.phase === "setup_road" ? game.setupVertex : null) : mode === "settlement" ? legalSettlements(game, me.id, game.phase === "setup_settlement") : mode === "city" ? legalCities(game, me.id) : mode === "robber" ? game.board.hexes.filter((h) => h.id !== game.robberHex).map((h) => h.id) : [];
  const selected = selection && selection.mode === mode && selection.context === buildContext && choices.includes(selection.id) ? selection.id : null;
  if (selection && selected === null) setSelection(null);
  const selectPlace = (id: number) => { if (!busy) { closeGuide(); setSelection({ mode, id, context: buildContext }); } };
  const canBuild = game.phase !== "main" || (mode && mode !== "robber" && canAfford(me.resources, COSTS[mode]));
  const cancelBuild = () => {
    if (busy) return;
    setBuild(null); setSelection(null);
    selectTab("bauen");
  };
  const startBuild = async (kind: BuildKind) => {
    if (busy || buildUnavailable(game, kind)) return;
    if (kind === "development") {
      if (await send({ type: "buy_development" })) { setBuildChoice(null); selectTab("insel"); }
    } else {
      setBuildChoice(null);
      setBuild({ mode: kind, context: buildContext }); setSelection(null); selectTab("insel");
    }
  };
  const commit = async () => { if (busy) return; const action = selected === null ? null : boardAction(mode, selected); if (action && await send(action)) { setBuild(null); setSelection(null); selectTab("insel"); } };
  const hideHand = () => { fullscreen.close(); onHide?.(); };
  const endTurn = <Button variant="outline" className="catan-end-turn" disabled={busy} onClick={async () => { if (await send({ type: "end_turn" })) { setBuild(null); setSelection(null); } }}><Check />Zug beenden</Button>;
  const canEndTurn = own && game.phase === "main" && !game.trade && !mode;
  const go = (target: CatanTab, text: string) => <Button className="catan-primary" onClick={() => selectTab(target)}>{text}</Button>;
  let turnActions: ReactNode;
  if (voting) turnActions = !Object.hasOwn(game.mapVote!.votes, me.id) || (mapVoteProgress(game).tied && me.id === game.mapVote!.hostPlayerId) ? <MapVoteActions game={game} send={send} busy={busy} /> : undefined;
  else if (needsDiscard) turnActions = go("karten", `${game.discards[me.id]} Karten abgeben`);
  else if (mode && mode !== "robber") turnActions = go("insel", `${BUILDING_NAMES[mode]} auf der Insel setzen`);
  else if (own && game.phase === "steal") turnActions = go("insel", "Person zum Bestehlen wählen");
  else if (own && game.phase === "roll") turnActions = <Button className="catan-primary catan-roll-button" disabled={busy} onClick={() => void send({ type: "roll" })}><Dices />Würfeln</Button>;
  else if (own && game.phase === "main" && game.trade) turnActions = go("handel", "Offenen Handel ansehen");

  let islandActions = canEndTurn ? endTurn : turnActions;
  if (mode) islandActions = <>{game.phase === "main" && <Button variant="outline" data-catan-sound="cancel" disabled={busy} onClick={cancelBuild}>Abbrechen</Button>}<Button className="catan-primary" disabled={busy || selected === null || !canBuild} onClick={() => void commit()}>{mode === "robber" ? "Räuber versetzen" : expanded ? "Bauen" : "Bauen bestätigen"}</Button></>;
  else if (own && game.phase === "steal") islandActions = <Button className="catan-primary" disabled={busy || selectedVictim === null} onClick={async () => { if (selectedVictim && await send({ type: "steal", victimId: selectedVictim })) setVictimChoice(null); }}>Karte stehlen</Button>;
  const islandTitle = voting ? "Eure Karte prüfen" : mode === "settlement" && game.phase === "setup_settlement" ? `${game.setupIndex < game.players.length ? "Erste" : "Zweite"} Siedlung setzen`
    : mode ? `${mode === "robber" ? "Räuber" : BUILDING_NAMES[mode]} platzieren` : own && game.phase === "steal" ? "Wen möchtest du bestehlen?" : "Eure Insel";
  const cardCount = resourceCount(me.resources);
  const buildCount = (Object.keys(COSTS) as BuildKind[]).filter((kind) => !buildUnavailable(game, kind)).length;
  const cardDescription = [
    `${cardCount} Rohstoffkarten`,
    me.development.length ? `${me.development.length} Entwicklungskarten` : null,
    needsDiscard ? `${game.discards[me.id]} Rohstoffkarten abgeben` : cardCount > 7 ? `Mehr als sieben Karten: Bei einer 7 musst du ${Math.floor(cardCount / 2)} abgeben.` : null,
  ].filter(Boolean).join(", ");
  const badges: Partial<Record<CatanTab, { text?: string; tone: string; description: string }>> = {
    karten: voting ? undefined : { text: String(cardCount), tone: needsDiscard ? "is-alert" : cardCount > 7 ? "is-warn" : "", description: cardDescription },
    bauen: voting ? undefined : { text: String(buildCount), tone: buildCount ? "is-ready" : "", description: `${buildCount} ${buildCount === 1 ? "Bau- oder Kaufoption" : "Bau- oder Kaufoptionen"} mit deinen Rohstoffen verfügbar` },
    handel: isTradeRecipient(game.trade, me.id) ? { text: "1", tone: "is-alert", description: "Ein Handelsangebot wartet auf deine Antwort" } : game.trade?.fromId === me.id ? { tone: "is-dot", description: "Dein Angebot ist noch offen" } : undefined,
    insel: mode || (own && game.phase === "steal") ? { tone: "is-dot", description: "Die Insel wartet auf deine Auswahl" } : undefined,
    uebersicht: activity.unread.length ? { text: String(activity.unread.length), tone: "", description: "Neue Meldungen" } : undefined,
  };
  useEffect(() => {
    if (!expanded && !activeMenu) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !(event.target instanceof Node) || !playRef.current?.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest("[data-radix-popper-content-wrapper]")) return;
      event.preventDefault();
      if (activeMenu) { event.stopPropagation(); closeMenu(true); }
      else fullscreen.close();
      sounds.cue("ui_cancel");
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [expanded, activeMenu, closeMenu, fullscreen, sounds]);
  return <div ref={playRef} role="region" aria-label="Catan-Spiel" data-catan-sequence={game.sequence} className={`catan-play${voting ? " is-map-vote" : ""}${expanded ? " is-board-expanded" : ""}${activeMenu ? " is-menu-open" : ""}`} onClickCapture={(event) => {
    const control = event.target instanceof Element ? event.target.closest("button, [role='button']") : null;
    if (control?.getAttribute("data-catan-sound") === "cancel" && !control.hasAttribute("disabled") && control.getAttribute("aria-disabled") !== "true") sounds.cue("ui_cancel");
  }}>
    {/* Status stays display-only in every phase, including while a menu is open. */}
    <div className={`catan-status ${own ? "is-yours" : ""}`} style={{ "--player-color": PLAYER_COLORS[active.color] } as React.CSSProperties}>
      <div className="catan-status-main" aria-live="polite" aria-atomic="true"><span className="catan-status-copy"><span><i className="catan-player-dot" aria-hidden="true" /><strong>{statusTitle}</strong></span></span></div>
      {offline && <span className="catan-status-offline" role="status" aria-label="Verbindung unterbrochen"><WifiOff /></span>}
      {!voting && <div className="catan-status-roll">{game.dice ? <CatanDice dice={game.dice} /> : <Dices aria-hidden="true" />}</div>}
      {!voting && <div className="catan-status-points" role="status" aria-label={`Punktestand: Du hast ${victoryPoints(game, me)} von ${game.targetPoints} Siegpunkten`}><span>{victoryPoints(game, me)}<small> / {game.targetPoints}</small></span><span className="catan-status-points-label">Punkte</span></div>}
    </div>
    <div className="catan-world">
    <div ref={setSeaTarget} className="catan-world-sea" aria-hidden="true" />
    {!voting && <CatanResourceHand game={game} islandVisible animationBaseline={animationBaseline} />}
    {!voting && <CatanEventNotice game={game} animationBaseline={animationBaseline} />}

    <div ref={menuBoardRef} className="catan-menu-stage">
    <div data-state="active" className="catan-tab-panel catan-tab-insel">
      <section className="catan-screen catan-island-screen" inert={activeMenu !== null}>
        <div className="catan-island-canvas">
          <CatanBoard key={game.mapVote?.id ?? "accepted"} game={game} mode={mode} choices={choices} selected={selected} onSelect={selectPlace} disabled={busy} onInspect={sounds.preview} islandVisible animationBaseline={animationBaseline} ambientEnabled={ambient.enabled} waterEnabled={water.enabled} seaTarget={seaTarget} controlsTarget={controlsTarget} />
        </div>
        <section className={`catan-island-dock${own && game.phase === "steal" ? " is-steal" : ""}`} aria-label={islandTitle} data-menu-hidden={activeMenu ? "true" : undefined} aria-hidden={activeMenu ? true : undefined} inert={activeMenu !== null}>
          <div className="catan-island-context">
            {voting && <MapVotePanel game={game} />}
            {mode && <div className="catan-placement-controls">
              <header className="catan-placement-heading"><div><h2>{mode === "robber" ? "Räuber versetzen" : islandTitle}</h2><p role="status">{selected === null ? mode === "robber" ? "Tippe ein anderes Feld auf der Karte an." : "Wähle einen markierten Bauplatz auf der Karte." : "Auswahl bereit · Bestätige deinen Zug."}</p></div>{setup && <Button variant="ghost" size="icon" aria-label="Starthilfe zur Gründung" aria-expanded={guideOpen} onClick={() => guideOpen ? closeGuide() : setGuideRequested(true)}><CircleHelp /></Button>}</header>
              {mode === "robber" && selected !== null && <RobberFieldPreview game={game} selected={selected} />}
            </div>}
            {own && game.phase === "steal" && <div className="catan-steal-panel">
              <header className="catan-placement-heading"><div><h2>Wen möchtest du bestehlen?</h2><p>Wähle eine Person. Du stiehlst eine zufällige Rohstoffkarte.</p></div></header>
              <div className="catan-victim-choices" role="group" aria-label="Person zum Bestehlen auswählen">{game.victims.map((id) => {
                const player = game.players.find((entry) => entry.id === id)!;
                return <button type="button" className="catan-victim-choice" key={id} style={{ "--player-color": PLAYER_COLORS[player.color] } as React.CSSProperties} aria-label={`${player.name} zum Bestehlen auswählen`} aria-pressed={selectedVictim === id} disabled={busy} onClick={() => setVictimChoice({ id, context: victimContext })}>
                  <span className="catan-victim-avatar" aria-hidden="true">{player.name.slice(0, 1)}</span><span className="catan-victim-copy"><strong>{player.name}</strong><small>{player.resourceCount} {player.resourceCount === 1 ? "Rohstoffkarte" : "Rohstoffkarten"}</small></span><Check className="catan-choice-check" aria-hidden="true" />
                </button>;
              })}</div>
            </div>}
            {game.phase === "discard" && !needsDiscard && <p className="catan-inline-hint">Andere geben Rohstoffe ab. Danach geht es weiter.</p>}
            {guideOpen && <SetupGuide onClose={closeGuide} />}
            {!canBuild && mode && mode !== "robber" && <p className="catan-inline-hint" role="status">{buildUnavailable(game, mode)}</p>}
          </div>
          <div className="catan-island-toolbar">
            <div ref={setControlsTarget} className="catan-island-map-controls" />
            <footer className={`catan-screen-actions${mode ? " catan-placement-actions" : ""}`}>{islandActions}</footer>
            <div className="catan-island-tools">
              <Button variant="ghost" size="icon" className="catan-sound-toggle" aria-label={sounds.enabled ? "Soundeffekte ausschalten" : "Soundeffekte einschalten"} aria-pressed={sounds.enabled} title="Soundeffekte für Rohstoffe, Würfeln, Bauen, Handel und Spielaktionen" onClick={() => void sounds.toggle()}>{sounds.enabled ? <Volume2 /> : <VolumeX />}</Button>
              <Button variant="outline" size="icon" aria-label={expanded ? "Vollbild der Insel schließen" : "Insel im Vollbild öffnen"} aria-pressed={expanded} title={expanded ? "Zurück zur Spielansicht (Esc)" : "Insel maximieren"} onClick={() => { if (!expanded) closeGuide(); fullscreen.toggle(); }}>{expanded ? <Minimize2 /> : <Maximize2 />}</Button>
            </div>
          </div>
        </section>
      </section>
    </div>
    <div className="catan-tab-panel is-game-menu" {...panelProps("karten")}><CardsPanel onClose={() => closeMenu(true)} game={game} send={send} busy={busy} /></div>
    <div className="catan-tab-panel is-game-menu" {...panelProps("bauen")}><Screen onClose={() => closeMenu(true)} title="Bauen" subtitle="Wähle, was du errichten möchtest" headingIcon={<Hammer />} actions={<Button className="catan-primary" disabled={busy || chosenBuild === null} onClick={() => { if (chosenBuild) void startBuild(chosenBuild); }}><Hammer />Auswählen</Button>}>
      <BuildChoices game={game} busy={busy} selected={chosenBuild} onBuild={(kind) => setBuildChoice({ context: buildContext, kind })} />
    </Screen></div>
    <div className="catan-tab-panel is-game-menu" {...panelProps("handel")}><TradePanel onClose={() => closeMenu(true)} game={game} send={send} busy={busy} /></div>
    <div className="catan-tab-panel is-game-menu" {...panelProps("uebersicht")}><OverviewPanel onClose={() => closeMenu(true)} game={game} page={overviewPage} setPage={setOverviewPage} activity={activity.all} unreadActivity={activity.unread} unread={activity.unread.length} onRead={activity.read} local={local} onHide={onHide ? hideHand : undefined} onRematch={onRematch} busy={busy} ambientEnabled={ambient.enabled} onAmbientChange={ambient.setEnabled} waterEnabled={water.enabled} onWaterChange={water.setEnabled} /></div>
    </div>
    </div>
    <nav ref={menuNavRef} className="catan-nav" aria-label={expanded ? "Vollbild-Spielmenü" : "Spielmenü"}><div className="catan-nav-list">{CATAN_TABS.map(({ id, label, Icon }) => {
      const badge = badges[id]; const unavailable = voting && ["karten", "bauen", "handel"].includes(id);
      return <Button key={id} type="button" variant="ghost" disabled={unavailable} className="catan-nav-tab" data-state={tab === id ? "active" : "inactive"} data-catan-menu-trigger={id} data-catan-fullscreen-trigger={expanded && id !== "insel" ? id : undefined} aria-label={`${label}${id === "insel" ? " anzeigen" : " öffnen"}${badge ? `, ${badge.description}` : ""}`} aria-haspopup={id === "insel" ? undefined : "dialog"} aria-expanded={id === "insel" ? undefined : activeMenu === id} aria-pressed={id === "insel" ? tab === "insel" : undefined} aria-controls={id === "insel" ? undefined : `${menuId}-${id}`} onClick={() => id === "insel" ? closeMenu() : clickMenu(id)}>
        <span className="catan-nav-icon"><Icon />{badge && <span className={`catan-nav-badge ${badge.tone}${id === "karten" ? " catan-hand-total" : ""}`} aria-hidden="true" title={id === "karten" || id === "bauen" ? badge.description : undefined}>{id === "karten" ? <><b className="catan-hand-count">{badge.text}</b><span className="catan-hand-feedback"><em className="catan-hand-gain" hidden aria-hidden="true" /><em className="catan-hand-loss" hidden aria-hidden="true" /></span></> : badge.text}</span>}</span><span className="catan-nav-label">{label}</span>{badge && <span className="sr-only">, {badge.description}</span>}
      </Button>;
    })}</div></nav>
  </div>;
}
