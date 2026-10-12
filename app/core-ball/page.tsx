"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Circle, Minus, Plus, RotateCcw, Users, X } from "lucide-react";
import { ConfirmDialog, GameBackLink, GameDialog, GameModes, LobbyInviteDialog, LobbyLeaveButton, LobbyToolbar, ResumeSessionDialog, type ResumeLobbyInfo } from "@/components/game-entry";
import { CoreBallGameUI, CoreBallRules } from "@/components/core-ball/game-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CORE_BALL_COLORS, activeCoreBallPlayer, applyCoreBallAction, createCoreBallGame, coreBallLocalSnapshot, restoreCoreBallGame, type CoreBallAction, type CoreBallGame, type CoreBallMode } from "@/lib/core-ball";
import type { CoreBallState } from "@/lib/core-ball-lobby-server";
import { coreBallClockSample, coreBallServerNow, startCoreBallLive, type CoreBallClock, type CoreBallLiveConnection } from "@/lib/core-ball-live-client";
import { describeLobby, resolveOnlineGameStartup, type GameSession } from "@/lib/game-session";

const SESSION_KEY = "gameson-core-ball-session-v1";
const LOCAL_KEY = "gameson-core-ball-local-v1";
type EntryMode = "home" | "create" | "join" | "local";
type NearbyLobby = { id: string; name: string; player_count: number };
type ResponseData = { session?: GameSession; state?: CoreBallState; left?: boolean; error?: string };
class ApiError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000), ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new ApiError(data.error || "Die Anfrage konnte nicht abgeschlossen werden.", response.status);
  return data;
}
function ModeChoice({ value, disabled = false, onChange }: { value: CoreBallMode; disabled?: boolean; onChange: (mode: CoreBallMode) => void }) {
  return <fieldset className="core-ball-mode-choice" disabled={disabled}><legend>Wie spielt ihr?</legend>{(["coop", "competitive"] as const).map((mode) => <Button key={mode} type="button" variant="outline" aria-pressed={value === mode} onClick={() => onChange(mode)}><strong>{mode === "coop" ? "Miteinander" : "Gegeneinander"}</strong><small>{mode === "coop" ? "Schafft gemeinsam viele Level." : "Sichert Punkte für eure Kugeln."}</small></Button>)}</fieldset>;
}

export default function CoreBallPage() {
  const [mode, setMode] = useState<EntryMode>("home"); const [ready, setReady] = useState(false);
  const [session, setSession] = useState<GameSession | null>(null); const [state, setState] = useState<CoreBallState | null>(null);
  const [localGame, setLocalGame] = useState<CoreBallGame | null>(null); const [localSaved, setLocalSaved] = useState(false);
  const [gameMode, setGameMode] = useState<CoreBallMode>("coop"); const [discoverable, setDiscoverable] = useState(true);
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false); const [connected, setConnected] = useState(false); const [clockReady, setClockReady] = useState(false);
  const [clockRevision, setClockRevision] = useState(0);
  const [playerName, setPlayerName] = useState(""); const [groupName, setGroupName] = useState(""); const [code, setCode] = useState("");
  const [names, setNames] = useState(["", ""]); const [nearby, setNearby] = useState<NearbyLobby[]>([]);
  const [dialog, setDialog] = useState<"invite" | "settings" | "leave" | "new" | null>(null);
  const [storedSession, setStoredSession] = useState<GameSession | null>(null); const [storedLobby, setStoredLobby] = useState<ResumeLobbyInfo | null | undefined>(undefined);
  const [baselineEventId, setBaselineEventId] = useState<string | null>(null);
  const stateRef = useRef<CoreBallState | null>(null); const localRef = useRef<CoreBallGame | null>(null); const locked = useRef(false);
  const liveRef = useRef<CoreBallLiveConnection | null>(null); const clockRef = useRef<CoreBallClock | null>(null);
  const localAnchor = useRef<{ server: number; at: number } | null>(null);
  const pending = useRef<{ session: GameSession; body: Record<string, unknown>; commandSeq: number } | null>(null);
  const posting = useRef(false);
  const leaving = useRef(false);
  const store = useCallback((key: string, value: string | null) => {
    try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
    catch { setNotice("Der Browser kann den Spielstand nicht speichern. Halte diese Seite geöffnet, bis die Partie beendet ist."); }
  }, []);
  const onlineNow = useCallback(() => clockRef.current ? coreBallServerNow(clockRef.current) : Date.now(), []);
  const localNow = useCallback(() => {
    if (!localAnchor.current) localAnchor.current = { server: Date.now(), at: performance.now() };
    return localAnchor.current.server + Math.max(0, performance.now() - localAnchor.current.at);
  }, []);
  const acceptClock = useCallback((clock: CoreBallClock) => { clockRef.current = clock; setClockReady(true); setClockRevision((value) => value + 1); }, []);
  const acceptState = useCallback((next: CoreBallState, baseline = false) => {
    const previous = stateRef.current;
    if (previous?.lobby.id === next.lobby.id && previous.lobby.revision > next.lobby.revision) return;
    if (baseline) setBaselineEventId(next.game?.lastEvent?.id ?? null);
    stateRef.current = next; setState(next);
    // A lost response is reconciled by the server's persisted command sequence before new actions.
    if (!posting.current && pending.current?.session.lobbyId === next.lobby.id && next.me.commandSeq >= pending.current.commandSeq) {
      pending.current = null; locked.current = false; setBusy(false);
    }
  }, []);
  const acceptLocal = useCallback((game: CoreBallGame) => {
    localRef.current = game; setLocalGame(game); setLocalSaved(true); store(LOCAL_KEY, JSON.stringify(coreBallLocalSnapshot(game, localNow())));
  }, [store, localNow]);
  const clearOnline = useCallback(() => {
    store(SESSION_KEY, null); setSession(null); stateRef.current = null; setState(null); setConnected(false); setClockReady(false); clockRef.current = null;
    pending.current = null; locked.current = false; setBusy(false); setMode("home"); window.history.replaceState({}, "", "/core-ball");
  }, [store]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = localStorage.getItem(LOCAL_KEY); setLocalSaved(Boolean(saved));
        const startup = resolveOnlineGameStartup(window.location.search, localStorage.getItem(SESSION_KEY));
        if (startup.kind === "resume") setSession(startup.session);
        if (startup.kind === "choose") setStoredSession(startup.session);
        if (startup.kind === "join") { setMode("join"); setCode(startup.lobbyId); }
        if (startup.kind === "local") { if (saved) { const game = restoreCoreBallGame(saved, localNow()); localRef.current = game; setLocalGame(game); setBaselineEventId(game.lastEvent?.id ?? null); } else setMode("local"); }
      } catch (error) { setNotice(error instanceof Error ? error.message : "Der letzte Spielstand konnte nicht geladen werden."); }
      setReady(true);
    });
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});
    const save = () => { if (localRef.current) store(LOCAL_KEY, JSON.stringify(coreBallLocalSnapshot(localRef.current, localNow()))); };
    window.addEventListener("pagehide", save);
    const visibility = () => { if (document.hidden) { save(); setClockReady(false); } };
    document.addEventListener("visibilitychange", visibility);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("pagehide", save); document.removeEventListener("visibilitychange", visibility); };
  }, [localNow, store]);
  const refresh = useCallback(async (current: GameSession) => {
    const sent = performance.now();
    const next = await request<CoreBallState>(`/api/core-ball?lobby=${encodeURIComponent(current.lobbyId)}`, { headers: { Authorization: `Bearer ${current.token}` } });
    const sample = coreBallClockSample(sent, performance.now(), next); if (sample) acceptClock(sample); acceptState(next, true); setConnected(true);
    return next;
  }, [acceptClock, acceptState]);
  useEffect(() => {
    if (!session) return;
    const connection = startCoreBallLive(session, {
      initialState: stateRef.current,
      onState: (next, { baseline }) => acceptState(next, baseline),
      // Keep the monotonic drawing anchor during an outage. Readiness gates input;
      // falling back to the device wall clock here would distort in-flight timers.
      onConnection: (value) => { setConnected(value); if (!value) setClockReady(false); },
      onClock: acceptClock,
      onRevoked: (_status, message) => { const wasLeaving = leaving.current; clearOnline(); if (!wasLeaving) { setNotice(message); setMode("join"); setCode(session.lobbyId); } },
    });
    liveRef.current = connection;
    return () => { connection.dispose(); if (liveRef.current === connection) liveRef.current = null; };
  }, [session, acceptState, acceptClock, clearOnline]);
  useEffect(() => {
    if (session || localGame || (mode !== "home" && mode !== "join")) return;
    let active = true;
    const load = () => request<{ lobbies: NearbyLobby[] }>("/api/core-ball?nearby=1").then((data) => { if (active) setNearby(data.lobbies); }).catch(() => undefined);
    void load(); const timer = setInterval(() => void load(), 10000);
    return () => { active = false; clearInterval(timer); };
  }, [session, localGame, mode]);
  useEffect(() => {
    if (!storedSession) return;
    let active = true;
    request<CoreBallState>(`/api/core-ball?lobby=${encodeURIComponent(storedSession.lobbyId)}`, { headers: { Authorization: `Bearer ${storedSession.token}` } })
      .then((next) => { if (active) setStoredLobby({ name: next.lobby.name, detail: describeLobby(next.members.length, next.game ? next.game.phase === "finished" ? "Partie beendet" : "Partie läuft" : "Lobby wartet auf den Start") }); })
      .catch((error: unknown) => { if (active) setStoredLobby(error instanceof ApiError && [401, 404].includes(error.status) ? null : { detail: "Gerade keine Verbindung. Du kannst trotzdem entscheiden." }); });
    return () => { active = false; };
  }, [storedSession]);
  useEffect(() => {
    if (!busy || !session) return;
    let active = true;
    const reconcile = async () => {
      const command = pending.current;
      if (!active || !command || posting.current || command.session !== session) return;
      posting.current = true;
      try {
        const next = await refresh(session);
        if (!active || pending.current !== command) return;
        if (next.me.commandSeq < command.commandSeq) {
          const sent = performance.now();
          const data = await request<ResponseData>("/api/core-ball", { method: "POST", headers: { Authorization: `Bearer ${session.token}` }, body: JSON.stringify(command.body) });
          if (!active || pending.current !== command) return;
          if (data.state) { const sample = coreBallClockSample(sent, performance.now(), data.state); if (sample) acceptClock(sample); acceptState(data.state, true); }
          if (data.left) clearOnline();
        }
        if (pending.current === command) pending.current = null;
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError) {
          if ([401, 404].includes(error.status)) clearOnline();
          else { if (pending.current === command) pending.current = null; setNotice(error.message); void liveRef.current?.refresh({ baseline: true }); }
        } else { setConnected(false); setClockReady(false); }
      } finally {
        posting.current = false;
        if (active && !pending.current) { locked.current = false; setBusy(false); }
      }
    };
    const timer = setInterval(() => void reconcile(), 2500);
    return () => { active = false; clearInterval(timer); };
  }, [busy, session, refresh, acceptClock, acceptState, clearOnline]);
  async function enter(kind: "create" | "join") {
    if (locked.current) return; locked.current = true; setBusy(true); setNotice("");
    try {
      const sent = performance.now();
      const data = await request<ResponseData>("/api/core-ball", { method: "POST", body: JSON.stringify({ action: kind, playerName, name: groupName, code, mode: gameMode, discoverable }) });
      if (data.session && data.state) {
        const sample = coreBallClockSample(sent, performance.now(), data.state); if (sample) acceptClock(sample);
        store(SESSION_KEY, JSON.stringify(data.session)); acceptState(data.state, true); setSession(data.session); window.history.replaceState({}, "", `/core-ball?lobby=${data.session.lobbyId}`);
      }
    } catch (error) { setNotice(error instanceof ApiError ? error.message : "Keine Verbindung. Deine Eingaben bleiben erhalten; versuche es erneut."); }
    finally { locked.current = false; setBusy(false); }
  }
  const post = useCallback(async (action: string, extra: Record<string, unknown> = {}): Promise<boolean> => {
    const current = stateRef.current;
    if (locked.current || !session || !current || !connected || !clockReady || pending.current) return false;
    locked.current = true; posting.current = true; setBusy(true); setNotice("");
    const body = { action, lobbyId: session.lobbyId, revision: current.lobby.revision, commandId: crypto.randomUUID(), commandSeq: current.me.commandSeq + 1, ...extra };
    const command = { session, body, commandSeq: current.me.commandSeq + 1 }; pending.current = command;
    leaving.current = action === "leave";
    try {
      const sent = performance.now();
      const data = await request<ResponseData>("/api/core-ball", { method: "POST", headers: { Authorization: `Bearer ${session.token}` }, body: JSON.stringify(body) });
      if (data.state) { const sample = coreBallClockSample(sent, performance.now(), data.state); if (sample) acceptClock(sample); acceptState(data.state); }
      if (data.left) clearOnline();
      if (pending.current === command) pending.current = null; return true;
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : "Die Bestätigung fehlt. Wir gleichen den Spielstand ab, bevor du weiterspielst.");
      if (error instanceof ApiError && pending.current === command) pending.current = null;
      try {
        const next = await refresh(session);
        if (next.me.commandSeq >= command.commandSeq) { if (pending.current === command) pending.current = null; return true; }
      } catch { setConnected(false); setClockReady(false); void liveRef.current?.refresh({ baseline: true }); }
      return false;
    } finally {
      posting.current = false; leaving.current = false;
      if (!pending.current) { locked.current = false; setBusy(false); }
    }
  }, [session, connected, clockReady, acceptClock, acceptState, clearOnline, refresh]);
  function startLocal() {
    if (locked.current) return;
    try { acceptLocal(createCoreBallGame(names.map((name, i) => ({ id: `local-${i}`, name })), gameMode, "local-0", localNow())); setNotice(""); setDialog(null); window.history.replaceState({}, "", "/core-ball?local=1"); }
    catch (error) { setNotice((error as Error).message); }
  }
  function resumeLocal() {
    try { const raw = localStorage.getItem(LOCAL_KEY); if (raw) { const game = restoreCoreBallGame(raw, localNow()); acceptLocal(game); setBaselineEventId(game.lastEvent?.id ?? null); setNotice(""); window.history.replaceState({}, "", "/core-ball?local=1"); } else setLocalSaved(false); }
    catch (error) { setNotice((error as Error).message); }
  }
  async function sendLocal(move: CoreBallAction): Promise<boolean> {
    const game = localRef.current; if (!game || locked.current) return false;
    locked.current = true;
    try { const actor = move.type === "finish" || move.type === "skip-player" ? game.hostPlayerId : game.activePlayerId; acceptLocal(applyCoreBallAction(game, actor, move, localNow())); setNotice(""); return true; }
    catch (error) { setNotice((error as Error).message); return false; }
    finally { locked.current = false; }
  }
  const active = localGame ?? state?.game;
  const activeGameId = active?.id;
  useEffect(() => { if (activeGameId) window.scrollTo({ top: 0 }); }, [activeGameId]);
  const isHost = Boolean(state && state.me.id === state.lobby.hostPlayerId);
  const inviteUrl = state && typeof window !== "undefined" ? `${window.location.origin}/core-ball?lobby=${state.lobby.id}&join=1` : "";
  const selectedLobby = mode === "join" ? nearby.find((item) => item.id === code) : undefined;
  const back = () => { setMode("home"); setNotice(""); window.history.replaceState({}, "", "/core-ball"); };
  return <main className={`core-ball-shell${active ? " core-ball-shell-playing" : ""}`}>
    <header className="core-ball-header"><GameBackLink /><a className="core-ball-brand" href="/core-ball"><Circle aria-hidden="true" /><span>CORE BALL<small>by Gameson</small></span></a><span className="core-ball-header-meta">{localGame || mode === "local" ? "Ein Gerät · lokal" : session ? connected ? "Verbunden" : "Verbindung fehlt" : "2–8 Personen"}</span></header>
    {notice && <div className="core-ball-notice" role="alert"><p>{notice}</p><Button type="button" variant="ghost" size="icon" aria-label="Hinweis schließen" onClick={() => setNotice("")}><X /></Button></div>}
    {session && !connected && <p className="core-ball-offline" role="status">Die Verbindung fehlt. Euer Spielstand wird automatisch abgeglichen, sobald du wieder verbunden bist.</p>}
    {!ready ? <p role="status">Core Ball wird geladen …</p> : session && !state ? <section className="core-ball-panel"><h1>Lobby wird geladen …</h1><p role="status">Deine letzte Partie wird abgeglichen.</p></section> : active ? <CoreBallGameUI key={active.id} game={active} meId={localGame ? activeCoreBallPlayer(active).id : state!.me.id} local={Boolean(localGame)} busy={busy} connected={localGame ? true : connected} clockReady={localGame ? true : clockReady} clockRevision={localGame ? 0 : clockRevision} now={localGame ? localNow : onlineNow} baselineEventId={baselineEventId} hostPlayerId={localGame ? localGame.hostPlayerId : state!.lobby.hostPlayerId} onAction={localGame ? sendLocal : (move) => post("play", { move })} onRematch={() => { if (localGame) { setNames(localGame.players.map((p) => p.name)); setGameMode(localGame.mode); localRef.current = null; setLocalGame(null); setMode("local"); store(LOCAL_KEY, null); setLocalSaved(false); window.history.replaceState({}, "", "/core-ball?local=1"); } else void post("reset", { gameId: active.id }); }} /> : state ? <>
      <section className="core-ball-lobby-heading"><span className="core-ball-kicker">Eure Core-Ball-Lobby</span><h1>{state.lobby.name}</h1><p>Ein Kreis für alle. Findet euren Rhythmus und gebt weiter.</p></section>
      <section className="core-ball-panel core-ball-lobby"><LobbyToolbar onInvite={() => setDialog("invite")} onSettings={isHost ? () => setDialog("settings") : undefined} busy={busy} /><div className="core-ball-section-label"><h2><Users aria-hidden="true" />Eure Plätze</h2><span>{state.members.length} / 8</span></div><ol className="core-ball-lobby-players">{state.members.map((member, i) => <li key={member.id}><span className="core-ball-player-dot" style={{ background: CORE_BALL_COLORS[i] }}>{i + 1}</span><div><strong>{member.name}{member.id === state.me.id ? " (du)" : ""}</strong><small>{i === 0 ? "Beginnt" : `Platz ${i + 1}`}{member.id === state.lobby.hostPlayerId ? " · Spielleitung" : ""}</small></div>{isHost && member.id !== state.me.id && <Button type="button" variant="ghost" size="icon" disabled={busy || !connected} aria-label={`${member.name} aus der Lobby entfernen`} onClick={() => void post("remove", { playerId: member.id })}><X /></Button>}</li>)}</ol><div className="core-ball-lobby-setting"><strong>{state.lobby.settings.mode === "coop" ? "Miteinander" : "Gegeneinander"}</strong><p>{state.lobby.settings.mode === "coop" ? "Euer gemeinsamer Levelstand zählt." : "Ein geschafftes Level sichert eure Punkte."} · {state.lobby.discoverable ? "In der Nähe sichtbar" : "Per Einladung erreichbar"}</p></div>{isHost ? <><Button type="button" className="core-ball-primary core-ball-full" disabled={busy || !connected || !clockReady || state.members.length < 2} onClick={() => void post("start")}>{busy ? "Wird gestartet …" : "Partie starten"}<ArrowRight /></Button>{state.members.length < 2 && <p className="core-ball-muted">Lade mindestens eine weitere Person ein.</p>}</> : <p className="core-ball-muted" role="status">Die Spielleitung startet, sobald alle da sind.</p>}<LobbyLeaveButton busy={busy} onClick={() => setDialog("leave")} /></section><CoreBallRules />
    </> : <>
      <section className="core-ball-intro"><div className="core-ball-hero-art" aria-hidden="true"><svg viewBox="0 0 250 250"><circle className="core-ball-hero-orbit" cx="125" cy="125" r="95" />{Array.from({ length: 9 }, (_, i) => { const angle = (i * 2 * Math.PI) / 9; const x = 125 + Math.cos(angle) * 78; const y = 125 + Math.sin(angle) * 78; return <g key={i}><line x1="125" y1="125" x2={x} y2={y} /><circle cx={x} cy={y} r="8" fill={i > 5 ? CORE_BALL_COLORS[i - 6] : "#f2f4ed"} /></g>; })}<circle className="core-ball-hero-core" cx="125" cy="125" r="33" /><text x="125" y="127">01</text></svg></div><span className="core-ball-kicker">Euer Rhythmus. Euer Kreis.</span><h1>Ein Tipp.<br /><span>Gutes Timing.</span></h1><p>Setzt Kugeln an den rotierenden Kreis. Schafft Level zusammen – und gebt ab, wenn es spannend wird.</p><div className="core-ball-intro-meta"><span>2–8 Personen</span><span>Miteinander oder gegeneinander</span><span>Spielt so lange ihr wollt</span></div></section>
      {mode === "home" ? <><GameModes onCreate={() => setMode("create")} onJoin={() => setMode("join")} onLocal={() => setMode("local")} />{localSaved && <Button type="button" className="core-ball-resume" variant="outline" onClick={resumeLocal}><RotateCcw />Lokale Partie fortsetzen</Button>}</> : <section className="core-ball-panel core-ball-entry-form"><Button type="button" variant="ghost" className="core-ball-form-back" onClick={back}><ArrowLeft />Zurück</Button><h2>{mode === "create" ? "Lobby erstellen" : mode === "join" ? "Lobby beitreten" : "Ein Gerät für alle"}</h2>
        {mode === "join" && nearby.length > 0 && <section className="core-ball-nearby" aria-label="Lobbys in deiner Nähe"><h3>In deiner Nähe</h3>{nearby.map((item) => <Button key={item.id} type="button" variant="outline" aria-pressed={code === item.id} onClick={() => setCode(item.id)}><span><strong>{item.name}</strong><small>{item.player_count} / 8 Personen</small></span><ArrowRight /></Button>)}</section>}
        {mode === "local" ? <form onSubmit={(e) => { e.preventDefault(); if (localSaved) setDialog("new"); else startLocal(); }}><p className="core-ball-muted">Reicht das Handy weiter. Beim Wechsel pausiert der Kreis, bis die nächste Person bereit ist.</p>{names.map((name, i) => <label className="core-ball-field" key={i} htmlFor={`core-ball-local-name-${i}`}><span><i className="core-ball-player-dot" style={{ background: CORE_BALL_COLORS[i] }}>{i + 1}</i>{i === 0 ? "Erste Person · beginnt" : `Person ${i + 1}`}</span><Input id={`core-ball-local-name-${i}`} required maxLength={24} autoComplete="off" value={name} onChange={(e) => setNames(names.map((n, j) => i === j ? e.target.value : n))} placeholder={`Name von Person ${i + 1}`} /></label>)}<div className="core-ball-name-controls"><Button type="button" variant="outline" disabled={names.length >= 8} onClick={() => setNames([...names, ""])}><Plus />Person hinzufügen</Button><Button type="button" variant="ghost" disabled={names.length <= 2} aria-label="Letzte Person entfernen" onClick={() => setNames(names.slice(0, -1))}><Minus /></Button></div><ModeChoice value={gameMode} onChange={setGameMode} /><Button type="submit" className="core-ball-primary core-ball-full">Partie starten<ArrowRight /></Button></form> : <form onSubmit={(e) => { e.preventDefault(); void enter(mode === "create" ? "create" : "join"); }}><label className="core-ball-field" htmlFor="core-ball-player-name"><span>Dein Name</span><Input id="core-ball-player-name" required maxLength={24} value={playerName} onChange={(e) => setPlayerName(e.target.value)} autoComplete="nickname" placeholder="Wie heißt du?" /></label>{mode === "create" ? <><label className="core-ball-field" htmlFor="core-ball-group-name"><span>Gruppenname</span><Input id="core-ball-group-name" required maxLength={40} value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Zum Beispiel: Orbit Crew" /></label><ModeChoice value={gameMode} disabled={busy} onChange={setGameMode} /><label htmlFor="core-ball-create-discoverable" className="core-ball-switch"><span><strong>In der Nähe sichtbar</strong><small>Andere im selben Netzwerk finden eure wartende Lobby.</small></span><Switch id="core-ball-create-discoverable" checked={discoverable} onCheckedChange={setDiscoverable} disabled={busy} /></label></> : <label className="core-ball-field" htmlFor="core-ball-join-code"><span>Gruppenname oder Lobby-Code</span><Input id="core-ball-join-code" required maxLength={80} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" placeholder="Gruppenname eingeben" />{selectedLobby && <small>{selectedLobby.name} ist ausgewählt.</small>}</label>}<Button type="submit" className="core-ball-primary core-ball-full" disabled={busy}>{busy ? "Verbindung wird aufgebaut …" : mode === "create" ? "Lobby erstellen" : "Beitreten"}<ArrowRight /></Button></form>}
      </section>}<CoreBallRules />
    </>}
    {dialog === "invite" && state && <LobbyInviteDialog theme="core-ball" name={state.lobby.name} code={state.lobby.name} url={inviteUrl} onClose={() => setDialog(null)} onError={() => setNotice("Der Link konnte nicht geteilt werden. Du kannst den Gruppennamen weitergeben.")} />}
    {dialog === "settings" && state && <GameDialog theme="core-ball" title="Eure Einstellungen" kicker="Vor dem Spielstart" busy={busy} onClose={() => setDialog(null)}><ModeChoice value={state.lobby.settings.mode} disabled={busy || !connected} onChange={(next) => void post("settings", { mode: next, discoverable: state.lobby.discoverable })} /><label htmlFor="core-ball-settings-discoverable" className="core-ball-switch"><span><strong>In der Nähe sichtbar</strong><small>Nur wartende Lobbys werden angezeigt.</small></span><Switch id="core-ball-settings-discoverable" checked={state.lobby.discoverable} disabled={busy || !connected} onCheckedChange={(next) => void post("settings", { mode: state.lobby.settings.mode, discoverable: next })} /></label></GameDialog>}
    {dialog === "leave" && <ConfirmDialog theme="core-ball" title="Lobby verlassen?" description="Du verlässt diese Lobby. Wenn du die Spielleitung bist, übernimmt die nächste Person." confirmLabel="Lobby verlassen" busy={busy} onCancel={() => setDialog(null)} onConfirm={() => { void post("leave").then((done) => { if (done) setDialog(null); }); }} />}
    {dialog === "new" && <ConfirmDialog theme="core-ball" title="Neue lokale Partie starten?" description="Der bisherige lokale Spielstand wird durch die neue Partie ersetzt." confirmLabel="Neue Partie starten" tone="accept" onCancel={() => setDialog(null)} onConfirm={startLocal} />}
    {storedSession && <ResumeSessionDialog theme="core-ball" lobby={storedLobby} onResume={() => { setSession(storedSession); setStoredSession(null); setStoredLobby(undefined); window.history.replaceState({}, "", `/core-ball?lobby=${storedSession.lobbyId}`); }} onDiscard={() => { store(SESSION_KEY, null); setStoredSession(null); setStoredLobby(undefined); }} />}
  </main>;
}
