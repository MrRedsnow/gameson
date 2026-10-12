"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, ChevronRight, Circle, Flag, MoreHorizontal, RotateCcw, SkipForward, Trophy } from "lucide-react";
import { ConfirmDialog, GameBackLink, GameDialog } from "@/components/game-entry";
import { Button } from "@/components/ui/button";
import { CORE_BALL_SHOT_MS, activeCoreBallPlayer, canCoreBallHandoff, type CoreBallAction, type CoreBallGame } from "@/lib/core-ball";
import { CoreBallBoard, type CoreBallFlight } from "./board";

const defaultNow = () => Date.now();
export function coreBallInputAllowed(game: CoreBallGame, meId: string, local: boolean, busy: boolean, connected: boolean, clockReady: boolean, now: number, blocked = false) {
  return game.phase === "playing" && (local || game.activePlayerId === meId) && !busy && connected && clockReady && !blocked && now >= game.lockedUntil;
}
export function coreBallFlightRemaining(firedAt: number, now: number) { return Math.min(CORE_BALL_SHOT_MS, Math.max(0, firedAt + CORE_BALL_SHOT_MS - now)); }
export function coreBallRemoteFlight(previous: CoreBallGame, next: CoreBallGame, baselineEventId: string | null, now: number): CoreBallFlight | null {
  const event = next.lastEvent;
  if (previous.id !== next.id || !event || event.id === baselineEventId || event.id === previous.lastEvent?.id || !["shot", "collision", "level-complete"].includes(event.type) || now >= event.at + CORE_BALL_SHOT_MS) return null;
  return { game: previous, firedAt: event.at, playerId: event.playerId };
}
export function CoreBallRulesContent() {
  return <div className="core-ball-rules-content"><p>Tippe, um eine Kugel an den rotierenden Kreis zu setzen. Triff keine vorhandene Kugel – das richtige Timing zählt.</p><ol>
    <li><strong>Gemeinsam am selben Kreis</strong><p>Nur die aktive Person setzt Kugeln. Nach einem geschafften Level übernimmt automatisch die nächste Person.</p></li>
    <li><strong>Du entscheidest, wann du abgibst</strong><p>Nach deiner ersten erfolgreichen Kugel kannst du an jede andere Person abgeben. Der Kreis pausiert, bis sie „Bereit“ drückt.</p></li>
    <li><strong>Eine Kollision? Neuer Versuch.</strong><p>Dieses Level beginnt vollständig neu und die nächste Person übernimmt. Geschaffte Level bleiben erhalten.</p></li>
    <li><strong>Miteinander oder gegeneinander</strong><p>Miteinander zählt euer gemeinsamer Levelstand. Gegeneinander bringt jede Kugel einen vorläufigen Punkt; erst ein geschafftes Level sichert diese Punkte. Bei einer Kollision verfallen alle vorläufigen Punkte des Levels.</p></li>
  </ol><p className="core-ball-muted">Es gibt kein Zeitlimit. Spielt so lange ihr möchtet. Die Spielleitung kann beenden oder eine abwesende Person überspringen. Mit einem gemeinsamen Gerät stehen diese Befehle der Gruppe zur Verfügung.</p></div>;
}
export function CoreBallRules() {
  return <details className="core-ball-rules"><summary><BookOpen aria-hidden="true" /><span>So funktioniert Core Ball</span><ChevronRight aria-hidden="true" /></summary><CoreBallRulesContent /></details>;
}
export function CoreBallGameUI({ game, meId, local = false, busy = false, connected = true, clockReady = true, clockRevision = 0, now = defaultNow, baselineEventId = null, hostPlayerId = game.hostPlayerId, onAction, onRematch }: {
  game: CoreBallGame; meId: string; local?: boolean; busy?: boolean; connected?: boolean; clockReady?: boolean; clockRevision?: number; now?: () => number; baselineEventId?: string | null; hostPlayerId?: string;
  onAction: (action: CoreBallAction) => Promise<boolean>; onRematch: () => void;
}) {
  const [dialog, setDialog] = useState<"rules" | "menu" | "handoff" | "finish" | "skip" | null>(null);
  const [flight, setFlight] = useState<CoreBallFlight | null>(null);
  const [remoteFlight, setRemoteFlight] = useState<CoreBallFlight | null>(null);
  const [pending, setPending] = useState(false);
  const [timeLocked, setTimeLocked] = useState(false);
  const pendingRef = useRef(false); const flightRef = useRef(false); const flightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousGame = useRef(game); const remoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = activeCoreBallPlayer(game); const isHost = local || meId === hostPlayerId;
  const turn = local || meId === current.id;
  const visibleFlight = flight ?? remoteFlight;
  const usable = !busy && !pending && connected && clockReady && !timeLocked && !visibleFlight && now() >= game.lockedUntil;
  const playable = coreBallInputAllowed(game, meId, local, busy || pending, connected, clockReady, now(), Boolean(dialog || visibleFlight || timeLocked));
  const identity = `${game.id}:${game.attemptId}:${game.turnId}`;
  useEffect(() => {
    const frame = requestAnimationFrame(() => setTimeLocked(now() < game.lockedUntil));
    const timer = setTimeout(() => setTimeLocked(false), Math.min(CORE_BALL_SHOT_MS + 50, Math.max(0, game.lockedUntil - now())));
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [game.lockedUntil, now, connected, clockReady, clockRevision]);
  useEffect(() => {
    const previous = previousGame.current; previousGame.current = game;
    const next = coreBallRemoteFlight(previous, game, baselineEventId, now());
    if (!next || flightRef.current) return;
    if (remoteTimer.current) clearTimeout(remoteTimer.current);
    const frame = requestAnimationFrame(() => setRemoteFlight(next));
    remoteTimer.current = setTimeout(() => { setRemoteFlight(null); remoteTimer.current = null; }, coreBallFlightRemaining(next.firedAt, now()));
    return () => cancelAnimationFrame(frame);
  }, [game, baselineEventId, now]);
  useEffect(() => () => { if (flightTimer.current) clearTimeout(flightTimer.current); if (remoteTimer.current) clearTimeout(remoteTimer.current); }, []);
  const command = useCallback(async (action: CoreBallAction) => {
    if (pendingRef.current) return false;
    pendingRef.current = true; setPending(true);
    try { return await onAction(action); }
    finally { pendingRef.current = false; setPending(false); }
  }, [onAction]);
  const move = (type: "ready" | "finish" | "skip-player") => ({ type, gameId: game.id, attemptId: game.attemptId, turnId: game.turnId } as CoreBallAction);
  const shoot = useCallback(async () => {
    if (pendingRef.current || flightRef.current || !playable) return;
    flightRef.current = true;
    const firedAt = now(); setFlight({ game, firedAt, playerId: current.id });
    await command({ type: "shoot", gameId: game.id, attemptId: game.attemptId, turnId: game.turnId, firedAt });
    const remaining = coreBallFlightRemaining(firedAt, now());
    flightTimer.current = setTimeout(() => { flightRef.current = false; setFlight(null); flightTimer.current = null; }, remaining);
  }, [playable, now, game, current.id, command]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== " " && event.key !== "Enter") return;
      const target = event.target;
      if (dialog || target instanceof Element && target.closest("button, a, input, select, textarea, summary, [contenteditable=true], [role=dialog]")) return;
      if (!playable) return;
      event.preventDefault(); if (!event.repeat) void shoot();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [dialog, playable, shoot]);
  async function ready() { if (turn && usable && !flight && await command(move("ready"))) setDialog(null); }
  async function handoff(targetPlayerId: string) {
    if (!turn || !usable || flight || !canCoreBallHandoff(game)) return;
    if (await command({ type: "handoff", targetPlayerId, gameId: game.id, attemptId: game.attemptId, turnId: game.turnId })) setDialog(null);
  }
  async function hostAction(type: "finish" | "skip-player") {
    if (isHost && usable && !flight && await command(move(type))) setDialog(null);
  }
  const event = game.lastEvent;
  const reason = event?.type === "collision" ? "Kollision – das Level startet neu." : event?.type === "level-complete" ? `Level ${game.level - 1} geschafft!` : event?.type === "skip" ? "Die Spielleitung hat weitergegeben." : event?.type === "handoff" ? "Der Kreis wartet auf die nächste Person." : "Euer Kreis ist bereit.";
  const winners = game.players.filter((p) => game.result?.winnerIds.includes(p.id));
  return <section className="core-ball-play" aria-label="Core-Ball-Partie">
    <header className="core-ball-play-header"><div><span className="core-ball-kicker">{local ? "Ein Gerät" : "Online"} · {game.mode === "coop" ? "Miteinander" : "Gegeneinander"}</span><h1>{game.phase === "finished" ? "Eure Runde" : `${current.name} ist dran`}</h1>{game.mode === "competitive" && game.phase !== "finished" && <p className="core-ball-active-score" aria-label={`Punkte von ${current.name}`}><span><b>{current.score}</b> gesichert</span><span><b>+{game.contributions[current.id] ?? 0}</b> vorläufig</span></p>}</div><div className="core-ball-play-tools"><Button type="button" variant="outline" size="icon" aria-label="Spielregeln öffnen" onClick={() => setDialog("rules")}><BookOpen /></Button><Button type="button" variant="outline" size="icon" aria-label="Partiemenü öffnen" onClick={() => setDialog("menu")}><MoreHorizontal /></Button></div></header>
    {game.phase === "finished" ? <div className="core-ball-result" role="status"><span className="core-ball-result-icon"><Trophy aria-hidden="true" /></span><span className="core-ball-kicker">{game.mode === "coop" ? "Gemeinsam geschafft" : "Endstand"}</span><h2>{game.mode === "coop" ? `${game.completedLevels} ${game.completedLevels === 1 ? "Level" : "Level"} geschafft` : winners.length === 1 ? `${winners[0].name} gewinnt!` : "Gemeinsamer Sieg!"}</h2><p>{game.mode === "competitive" && winners.length > 1 ? `${winners.map((p) => p.name).join(" und ")} liegen gleichauf. ` : ""}{game.mode === "competitive" ? `${game.completedLevels} Level gemeinsam geschafft. Ihr wart in Level ${game.level}. Unfertige Punkte sind verfallen.` : `Ihr wart in Level ${game.level}. Beim nächsten Mal geht noch mehr.`}</p>{game.mode === "competitive" && <ol className="core-ball-ranking">{[...game.players].sort((a, b) => b.score - a.score).map((player) => <li key={player.id}><span className="core-ball-player-dot" style={{ background: player.color }} /><strong>{player.name}</strong><b>{player.score}<small> Punkte</small></b></li>)}</ol>}{isHost ? <Button type="button" className="core-ball-primary" disabled={!usable} onClick={onRematch}><RotateCcw />{local ? "Neue Runde vorbereiten" : "Zurück in die Lobby"}</Button> : <p className="core-ball-muted">Die Spielleitung kann eine neue Runde vorbereiten.</p>}<GameBackLink /></div> : <>
      <div className="core-ball-play-grid"><div className="core-ball-arena-panel"><div className="core-ball-arena-top"><span>LEVEL <strong>{game.level}</strong></span><span><strong>{game.remaining}</strong> KUGELN ÜBRIG</span></div><CoreBallBoard game={game} now={now} flight={visibleFlight} disabled={!playable} onShoot={() => void shoot()} baselineEventId={baselineEventId} />
        <div className="core-ball-action-dock">
          {game.phase === "awaiting-ready" && !visibleFlight ? <div className="core-ball-ready" key={identity}><span className="core-ball-player-dot" style={{ background: current.color }} /><h2>{local ? `Weitergeben an ${current.name}` : turn ? "Dein Kreis wartet." : `${current.name} übernimmt`}</h2><p>{reason} {turn ? "Die Rotation startet erst, wenn du bereit bist." : "Du kannst live zuschauen, sobald es weitergeht."}</p><Button type="button" className="core-ball-primary core-ball-shoot" disabled={!turn || !usable} onClick={() => void ready()}>{turn ? "Bereit" : `Warten auf ${current.name}`}<ArrowRight /></Button></div> : <><Button type="button" className="core-ball-primary core-ball-shoot" aria-label="Kugel setzen" disabled={!playable} onClick={() => void shoot()} onKeyDown={(e) => { if (e.repeat && (e.key === " " || e.key === "Enter")) e.preventDefault(); }}><Circle aria-hidden="true" />{visibleFlight || pending ? "Kugel unterwegs …" : turn ? "Kugel setzen" : `${current.name} spielt`}</Button><p className="core-ball-tap-hint">{!connected ? "Verbindung fehlt. Eingaben warten auf den Abgleich." : !clockReady ? "Das Timing wird abgeglichen …" : turn ? "Tippe aufs Spielfeld oder drücke die Leertaste." : "Du siehst denselben Kreis live. Dein Zug kommt wieder."}</p><Button type="button" className="core-ball-handoff-button" variant="outline" disabled={!playable || !canCoreBallHandoff(game)} onClick={() => setDialog("handoff")}><ArrowRight />Abgeben</Button>{turn && !canCoreBallHandoff(game) && <p className="core-ball-small-hint">Nach deiner ersten erfolgreichen Kugel kannst du abgeben.</p>}</>}
        </div></div>
        <aside className="core-ball-player-panel"><div className="core-ball-section-label"><h2>Eure Crew</h2><span>{game.completedLevels} Level geschafft</span></div><ol className="core-ball-player-list">{game.players.map((player, index) => <li key={player.id} className={player.id === current.id ? "is-current" : ""}><span className="core-ball-player-dot" style={{ background: player.color }}>{index + 1}</span><div><strong>{player.name}{!local && player.id === meId ? " (du)" : ""}</strong><small>{player.id === current.id ? game.phase === "awaiting-ready" ? "übernimmt gleich" : "spielt gerade" : "wartet auf den nächsten Zug"}</small></div>{game.mode === "competitive" && <span className="core-ball-score"><b>{player.score}</b><small>+{game.contributions[player.id] ?? 0} vorläufig</small></span>}</li>)}</ol><div className="core-ball-mode-note"><strong>{game.mode === "coop" ? "Jede Kugel bringt euch weiter." : "Erst ein ganzes Level sichert eure Punkte."}</strong><p>{game.mode === "coop" ? "Findet euren Rhythmus und gebt rechtzeitig weiter. Es gibt kein Zeitlimit." : "Eine Kollision verwirft alle vorläufigen Punkte dieses Levels. Bereits gesicherte Punkte bleiben."}</p></div></aside></div>
    </>}
    {dialog === "rules" && <GameDialog theme="core-ball" title="So funktioniert Core Ball" kicker="Ein Tipp. Gutes Timing." onClose={() => setDialog(null)}><CoreBallRulesContent /></GameDialog>}
    {dialog === "handoff" && <GameDialog theme="core-ball" title="An wen gibst du ab?" description="Der Kreis pausiert an seiner aktuellen Position. Die gewählte Person startet mit „Bereit“." busy={pending || busy} onClose={() => setDialog(null)}><div className="core-ball-handoff-options">{game.players.filter((p) => p.id !== current.id).map((player, index) => <Button key={player.id} type="button" variant="outline" disabled={!usable || Boolean(flight)} onClick={() => void handoff(player.id)}><span className="core-ball-player-dot" style={{ background: player.color }}>{game.players.findIndex((p) => p.id === player.id) + 1}</span><strong>{player.name}</strong><ArrowRight /><span className="sr-only">Empfänger {index + 1}</span></Button>)}</div></GameDialog>}
    {dialog === "menu" && <GameDialog theme="core-ball" title="Eure Partie" kicker="Core Ball" onClose={() => setDialog(null)}>{isHost && game.phase !== "finished" && <><Button type="button" variant="outline" disabled={!usable || Boolean(flight)} onClick={() => setDialog("skip")}><SkipForward />{current.name} überspringen</Button><Button type="button" variant="outline" disabled={!usable || Boolean(flight)} onClick={() => setDialog("finish")}><Flag />Partie beenden</Button></>}<GameBackLink /><p className="core-ball-muted">Eure Partie bleibt gespeichert, wenn du zur Spielauswahl zurückkehrst.</p></GameDialog>}
    {dialog === "finish" && <ConfirmDialog theme="core-ball" title="Eure Partie beenden?" description={game.mode === "competitive" ? "Die gesicherten Punkte zählen für den Endstand. Alle vorläufigen Punkte des laufenden Levels verfallen." : "Eure gemeinsam geschafften Level werden im Ergebnis angezeigt."} confirmLabel="Partie beenden" busy={!usable || Boolean(flight)} onCancel={() => setDialog(null)} onConfirm={() => void hostAction("finish")} />}
    {dialog === "skip" && <ConfirmDialog theme="core-ball" title={`${current.name} überspringen?`} description="Die nächste Person übernimmt. Der Kreis und alle bisherigen Beiträge bleiben erhalten und warten auf „Bereit“." confirmLabel="Weitergeben" tone="accept" busy={!usable || Boolean(flight)} onCancel={() => setDialog(null)} onConfirm={() => void hostAction("skip-player")} />}
  </section>;
}
