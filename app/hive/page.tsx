"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, GraduationCap, Hexagon, RotateCcw, Users, X } from "lucide-react";
import { ConfirmDialog, GameBackLink, GameDialog, GameModes, LobbyInviteDialog, LobbyLeaveButton, LobbyToolbar, ResumeSessionDialog, type ResumeLobbyInfo } from "@/components/game-entry";
import { HiveGameUI, HiveRules } from "@/components/hive/game-ui";
import { HiveGlyph } from "@/components/hive/piece";
import { HiveTutorial } from "@/components/hive/tutorial";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { activeHivePlayer, applyHiveAction, createHiveGame, restoreHiveGame, undoHiveTurn, type HiveAction, type HiveGame, type HiveState } from "@/lib/hive";
import { describeLobby, resolveOnlineGameStartup, type GameSession } from "@/lib/game-session";

const SESSION_KEY = "gameson-hive-session-v1";
const LOCAL_KEY = "gameson-hive-local-v1";
type EntryMode = "home" | "create" | "join" | "local";
type NearbyLobby = { id: string; name: string; player_count: number };
type ResponseData = { session?: GameSession; state?: HiveState; left?: boolean; error?: string };
class ApiError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000), ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new ApiError(data.error || "Die Anfrage konnte nicht abgeschlossen werden.", response.status);
  return data;
}

export default function HivePage() {
  const [mode, setMode] = useState<EntryMode>("home"); const [ready, setReady] = useState(false);
  const [session, setSession] = useState<GameSession | null>(null); const [state, setState] = useState<HiveState | null>(null);
  const [localGame, setLocalGame] = useState<HiveGame | null>(null); const [localSaved, setLocalSaved] = useState(false);
  const [tutorial, setTutorial] = useState(false);
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false); const [connected, setConnected] = useState(true);
  const [playerName, setPlayerName] = useState(""); const [groupName, setGroupName] = useState(""); const [code, setCode] = useState("");
  const [names, setNames] = useState(["", ""]); const [nearby, setNearby] = useState<NearbyLobby[]>([]);
  const [dialog, setDialog] = useState<"invite" | "settings" | "leave" | "new" | null>(null);
  const [storedSession, setStoredSession] = useState<GameSession | null>(null); const [storedLobby, setStoredLobby] = useState<ResumeLobbyInfo | null | undefined>(undefined);
  const stateRef = useRef<HiveState | null>(null); const localRef = useRef<HiveGame | null>(null); const locked = useRef(false);
  const store = useCallback((key: string, value: string | null) => {
    try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
    catch { setNotice("Der Browser kann den Spielstand nicht speichern. Halte diese Seite geöffnet, bis die Partie beendet ist."); }
  }, []);
  const acceptState = useCallback((next: HiveState) => {
    if (stateRef.current?.lobby.id === next.lobby.id && stateRef.current.lobby.revision > next.lobby.revision) return;
    stateRef.current = next; setState(next); setConnected(true);
  }, []);
  const acceptLocal = useCallback((game: HiveGame) => { localRef.current = game; setLocalGame(game); setLocalSaved(true); store(LOCAL_KEY, JSON.stringify(game)); }, [store]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = localStorage.getItem(LOCAL_KEY); setLocalSaved(Boolean(saved));
        if (new URLSearchParams(window.location.search).get("tutorial") === "1") setTutorial(true);
        else {
          const startup = resolveOnlineGameStartup(window.location.search, localStorage.getItem(SESSION_KEY));
          if (startup.kind === "resume") setSession(startup.session);
          if (startup.kind === "choose") setStoredSession(startup.session);
          if (startup.kind === "join") { setMode("join"); setCode(startup.lobbyId); }
          if (startup.kind === "local") { if (saved) { const game = restoreHiveGame(saved); localRef.current = game; setLocalGame(game); } else setMode("local"); }
        }
      } catch (error) { setNotice(error instanceof Error ? error.message : "Der letzte Spielstand konnte nicht geladen werden."); }
      setReady(true);
    });
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => cancelAnimationFrame(frame);
  }, []);
  const refresh = useCallback(async (current: GameSession) => {
    const next = await request<HiveState>(`/api/hive?lobby=${encodeURIComponent(current.lobbyId)}`, { headers: { Authorization: `Bearer ${current.token}` } }); acceptState(next);
  }, [acceptState]);
  useEffect(() => {
    if (!session) return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await request<HiveState>(`/api/hive?lobby=${encodeURIComponent(session.lobbyId)}`, { headers: { Authorization: `Bearer ${session.token}` } }); if (active) acceptState(next);
      } catch (error) {
        if (!active) return;
        setConnected(false);
        if (error instanceof ApiError && [401, 404].includes(error.status)) {
          store(SESSION_KEY, null); setSession(null); setState(null); stateRef.current = null;
          setNotice(error.message); setMode("join"); setCode(session.lobbyId); return;
        }
      }
      if (active) timer = setTimeout(() => void poll(), 2000);
    };
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [session, acceptState, store]);
  useEffect(() => {
    if (tutorial || session || localGame || (mode !== "home" && mode !== "join")) return;
    let active = true;
    const load = () => request<{ lobbies: NearbyLobby[] }>("/api/hive?nearby=1").then((data) => { if (active) setNearby(data.lobbies); }).catch(() => undefined);
    void load(); const timer = setInterval(() => void load(), 10000);
    return () => { active = false; clearInterval(timer); };
  }, [session, localGame, mode, tutorial]);
  useEffect(() => {
    if (!storedSession) return;
    let active = true;
    request<HiveState>(`/api/hive?lobby=${encodeURIComponent(storedSession.lobbyId)}`, { headers: { Authorization: `Bearer ${storedSession.token}` } })
      .then((next) => { if (active) setStoredLobby({ name: next.lobby.name, detail: describeLobby(next.members.length, next.game ? next.game.phase === "finished" ? "Partie beendet" : "Partie läuft" : "Lobby wartet auf den Start") }); })
      .catch((error: unknown) => { if (active) setStoredLobby(error instanceof ApiError && [401, 404].includes(error.status) ? null : { detail: "Gerade keine Verbindung. Du kannst trotzdem entscheiden." }); });
    return () => { active = false; };
  }, [storedSession]);
  async function enter(kind: "create" | "join") {
    if (locked.current) return; locked.current = true; setBusy(true); setNotice("");
    try {
      const data = await request<ResponseData>("/api/hive", { method: "POST", body: JSON.stringify({ action: kind, playerName, name: groupName, code }) });
      if (data.session && data.state) { store(SESSION_KEY, JSON.stringify(data.session)); acceptState(data.state); setSession(data.session); window.history.replaceState({}, "", `/hive?lobby=${data.session.lobbyId}`); }
    } catch (error) { setNotice(error instanceof ApiError ? error.message : "Keine Verbindung. Deine Eingaben bleiben erhalten; versuche es erneut."); }
    finally { locked.current = false; setBusy(false); }
  }
  async function post(action: string, extra: Record<string, unknown> = {}): Promise<boolean> {
    if (locked.current || !session || !stateRef.current) return false;
    locked.current = true; setBusy(true); setNotice("");
    try {
      const data = await request<ResponseData>("/api/hive", { method: "POST", headers: { Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ action, lobbyId: session.lobbyId, revision: stateRef.current.lobby.revision, ...extra }) });
      if (data.state) acceptState(data.state);
      if (data.left) { store(SESSION_KEY, null); setSession(null); setState(null); stateRef.current = null; setMode("home"); window.history.replaceState({}, "", "/hive"); }
      return true;
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : "Die Zugbestätigung fehlt. Der Spielstand wird neu geladen; prüfe deinen Zug, bevor du ihn erneut sendest.");
      try { await refresh(session); } catch { setConnected(false); }
      return false;
    } finally { locked.current = false; setBusy(false); }
  }
  function startLocal() {
    try { acceptLocal(createHiveGame(names.map((name, i) => ({ id: `local-${i}`, name })))); setNotice(""); window.history.replaceState({}, "", "/hive?local=1"); }
    catch (error) { setNotice((error as Error).message); }
  }
  function resumeLocal() {
    try { const raw = localStorage.getItem(LOCAL_KEY); if (raw) { const game = restoreHiveGame(raw); localRef.current = game; setLocalGame(game); setNotice(""); window.history.replaceState({}, "", "/hive?local=1"); } else setLocalSaved(false); }
    catch (error) { setNotice((error as Error).message); }
  }
  async function sendLocal(action: HiveAction): Promise<boolean> {
    const game = localRef.current; if (!game || locked.current) return false;
    locked.current = true;
    try {
      let next = applyHiveAction(game, activeHivePlayer(game).id, action);
      if (action.type === "offer-draw") next = applyHiveAction(next, next.players.find((p) => p.id !== next.drawOffer)!.id, { type: "answer-draw", accept: true, gameId: next.id, ply: next.ply });
      acceptLocal(next); setNotice(""); return true;
    } catch (error) { setNotice((error as Error).message); return false; }
    finally { locked.current = false; }
  }
  function undoLocal(): boolean {
    if (!localRef.current || locked.current) return false;
    try { acceptLocal(undoHiveTurn(localRef.current)); setNotice(""); return true; }
    catch (error) { setNotice((error as Error).message); return false; }
  }
  const active = localGame ?? state?.game;
  const activeGameId = active?.id;
  useEffect(() => { if (activeGameId) window.scrollTo({ top: 0 }); }, [activeGameId]);
  const isHost = Boolean(state && state.me.id === state.lobby.hostPlayerId);
  const inviteUrl = state && typeof window !== "undefined" ? `${window.location.origin}/hive?lobby=${state.lobby.id}&join=1` : "";
  const selectedLobby = mode === "join" ? nearby.find((item) => item.id === code) : undefined;
  const back = () => { setMode("home"); setNotice(""); window.history.replaceState({}, "", "/hive"); };
  const openTutorial = () => { setTutorial(true); setNotice(""); window.history.replaceState({}, "", "/hive?tutorial=1"); window.scrollTo({ top: 0 }); };
  const closeTutorial = () => { setTutorial(false); window.history.replaceState({}, "", localGame ? "/hive?local=1" : session ? `/hive?lobby=${session.lobbyId}` : "/hive"); window.scrollTo({ top: 0 }); };

  return <main className={`hive-shell${active || tutorial ? " hive-shell-playing" : ""}`}>
    <header className="hive-header"><GameBackLink /><a className="hive-brand" href="/hive"><Hexagon aria-hidden="true" /><span>HIVE<small>by Gameson</small></span></a><span className="hive-header-meta">{tutorial ? "Interaktive Übung" : localGame || mode === "local" ? "Ein Gerät · lokal" : session ? connected ? "Verbunden" : "Verbindung fehlt" : "Strategie für zwei"}</span></header>
    {notice && <div className="hive-notice" role="alert"><p>{notice}</p><Button type="button" variant="ghost" size="icon" aria-label="Hinweis schließen" onClick={() => setNotice("")}><X /></Button></div>}
    {session && !connected && <p className="hive-offline" role="status">Die Verbindung ist unterbrochen. Wir verbinden dich automatisch wieder. Online-Züge sind möglich, sobald die Verbindung zurück ist.</p>}
    {!ready ? <p role="status">HIVE wird geladen …</p> : tutorial ? <HiveTutorial onClose={closeTutorial} /> : session && !state ? <section className="hive-panel"><h1>Lobby wird geladen …</h1><p role="status">Deine Verbindung wird geprüft.</p></section> : active ? <HiveGameUI key={active.id} game={active} meId={localGame ? activeHivePlayer(active).id : state!.me.id} local={Boolean(localGame)} busy={busy} connected={localGame ? true : connected} isHost={isHost} onAction={localGame ? sendLocal : (move) => post("move", { move })} onUndo={localGame ? undoLocal : undefined} onTutorial={openTutorial} onRematch={() => { if (localGame) acceptLocal(createHiveGame([...localGame.players].reverse())); else void post("reset", { gameId: active.id }); }} /> : state ? <>
      <section className="hive-lobby-heading"><span className="hive-kicker">Eure HIVE-Lobby</span><h1>{state.lobby.name}</h1><p>Zwei Farben. 22 Steine. Wer umzingelt die andere Königin zuerst?</p></section>
      <section className="hive-panel hive-lobby"><LobbyToolbar onInvite={() => setDialog("invite")} onSettings={isHost ? () => setDialog("settings") : undefined} busy={busy} />
        <div className="hive-section-label"><h2><Users aria-hidden="true" />Eure Plätze</h2><span>{state.members.length} / 2</span></div>
        <ul className="hive-lobby-players">{state.members.map((member, i) => <li key={member.id}><span className={`hive-color-dot is-${i === 0 ? "white" : "black"}`} aria-hidden="true" /><div><strong>{member.name}{member.id === state.me.id ? " (du)" : ""}</strong><small>{i === 0 ? "Weiß · beginnt" : "Schwarz"}{member.id === state.lobby.hostPlayerId ? " · Lobby-Master" : ""}</small></div>{isHost && member.id !== state.me.id && <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={`${member.name} aus der Lobby entfernen`} onClick={() => void post("remove", { playerId: member.id })}><X /></Button>}</li>)}{state.members.length < 2 && <li className="hive-empty-seat"><span>?</span><div><strong>Ein Platz ist noch frei</strong><small>Lade deine Mitspielerin oder deinen Mitspieler ein.</small></div></li>}</ul>
        {isHost ? <><Button type="button" className="hive-primary hive-full" disabled={busy || !connected || state.members.length !== 2} onClick={() => void post("start")}>{busy ? "Wird gestartet …" : "Partie starten"}<ArrowRight /></Button>{state.members.length < 2 && <p className="hive-muted">Die Partie kann starten, sobald ihr zu zweit seid.</p>}</> : <p className="hive-muted" role="status">Der Lobby-Master startet eure Partie.</p>}
        <LobbyLeaveButton busy={busy} onClick={() => setDialog("leave")} />
      </section><HiveRules />
    </> : <>
      <section className="hive-intro"><div className="hive-hero-art" aria-hidden="true"><span className="hive-hero-tile is-white"><HiveGlyph kind="ant" /></span><span className="hive-hero-tile is-black"><HiveGlyph kind="queen" /></span><span className="hive-hero-tile is-white"><HiveGlyph kind="beetle" /></span></div><span className="hive-kicker">Ein Duell. Kein Spielbrett.</span><h1>Kleine Steine.<br />Große Züge.</h1><p>Baue den Schwarm, nutze deine Insekten und umzingele die gegnerische Königin.</p><div className="hive-intro-meta"><span>2 Personen</span><span>ca. 20 Minuten</span><span>5 Insektenarten</span></div></section>
      {mode === "home" ? <><GameModes onCreate={() => setMode("create")} onJoin={() => setMode("join")} onLocal={() => setMode("local")} />{localSaved && <Button type="button" className="hive-resume" variant="outline" onClick={resumeLocal}><RotateCcw />Lokale Partie fortsetzen</Button>}</> : <section className="hive-panel hive-entry-form"><Button type="button" variant="ghost" className="hive-form-back" onClick={back}><ArrowLeft />Zurück</Button><h2>{mode === "create" ? "Lobby erstellen" : mode === "join" ? "Lobby beitreten" : "Ein Gerät für zwei"}</h2>
        {mode === "join" && nearby.length > 0 && <section className="hive-nearby" aria-label="Lobbys in deiner Nähe"><h3>In deiner Nähe</h3>{nearby.map((item) => <Button key={item.id} type="button" variant="outline" aria-pressed={code === item.id} onClick={() => setCode(item.id)}><span><strong>{item.name}</strong><small>{item.player_count} / 2 Personen</small></span><ArrowRight /></Button>)}</section>}
        {mode === "local" ? <form onSubmit={(e) => { e.preventDefault(); if (localSaved) setDialog("new"); else startLocal(); }}><p>Alle Steine sind offen sichtbar. Ihr zieht abwechselnd und könnt das Gerät zwischen euch legen.</p>{names.map((name, i) => <label className="hive-field" key={i} htmlFor={`hive-local-name-${i}`}><span>{i === 0 ? "Weiß · beginnt" : "Schwarz"}</span><Input id={`hive-local-name-${i}`} required maxLength={24} autoComplete="off" value={name} onChange={(e) => setNames(names.map((n, j) => i === j ? e.target.value : n))} placeholder={`Name von Person ${i + 1}`} /></label>)}<Button type="submit" className="hive-primary hive-full">Partie starten<ArrowRight /></Button><p className="hive-muted">Dein Spielstand wird nach jedem Zug auf diesem Gerät gespeichert.</p></form> : <form onSubmit={(e) => { e.preventDefault(); void enter(mode as "create" | "join"); }}><label className="hive-field" htmlFor="hive-player-name"><span>Dein Name</span><Input id="hive-player-name" required maxLength={24} autoComplete="nickname" value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="Wie heißt du?" /></label>{mode === "create" ? <label className="hive-field" htmlFor="hive-group-name"><span>Gruppenname</span><Input id="hive-group-name" required minLength={2} maxLength={32} autoComplete="off" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Zum Beispiel: Königinnenduell" /></label> : <label className="hive-field" htmlFor="hive-join-code"><span>{selectedLobby ? `Ausgewählt: ${selectedLobby.name}` : "Lobbycode oder Gruppenname"}</span><Input id="hive-join-code" required maxLength={40} autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code oder Gruppenname" /></label>}<Button type="submit" className="hive-primary hive-full" disabled={busy}>{busy ? "Verbindung wird hergestellt …" : mode === "create" ? "Lobby erstellen" : "Beitreten"}<ArrowRight /></Button></form>}
      </section>}
      <Button type="button" variant="outline" className="hive-learn-entry" onClick={openTutorial}><GraduationCap /><span><strong>HIVE Schritt für Schritt lernen</strong><small>Sechs kurze Übungen mit echten Spielzügen.</small></span><ArrowRight /></Button>
      <HiveRules />
    </>}
    {dialog === "invite" && state && <LobbyInviteDialog theme="hive" name={state.lobby.name} code={state.lobby.id} codeLabel="Lobbycode" url={inviteUrl} onClose={() => setDialog(null)} onError={() => setNotice("Der Link konnte nicht geteilt werden. Verwende den Lobbycode.")} />}
    {dialog === "settings" && state && <GameDialog theme="hive" kicker="Lobby" title="Einstellungen" onClose={() => setDialog(null)}><label className="hive-switch" htmlFor="hive-discoverable"><span><strong>Lobby in der Nähe anzeigen</strong><small>Auf Geräten im selben Netzwerk finden.</small></span><Switch id="hive-discoverable" checked={state.lobby.discoverable} disabled={busy} onCheckedChange={(discoverable) => void post("settings", { discoverable })} /></label></GameDialog>}
    {dialog === "leave" && <ConfirmDialog theme="hive" title="Lobby verlassen?" description="Dein Platz wird frei. Du kannst später wieder per Einladung oder Code beitreten." confirmLabel="Lobby verlassen" busy={busy} onCancel={() => setDialog(null)} onConfirm={async () => { if (await post("leave")) setDialog(null); }} />}
    {dialog === "new" && <ConfirmDialog theme="hive" title="Neue lokale Partie starten?" description="Die bisher auf diesem Gerät gespeicherte HIVE-Partie wird ersetzt." confirmLabel="Neue Partie starten" cancelLabel="Gespeicherte Partie behalten" onCancel={() => setDialog(null)} onConfirm={() => { setDialog(null); startLocal(); }} />}
    {storedSession && <ResumeSessionDialog theme="hive" lobby={storedLobby} onResume={() => { setSession(storedSession); setStoredSession(null); setStoredLobby(undefined); window.history.replaceState({}, "", `/hive?lobby=${storedSession.lobbyId}`); }} onDiscard={() => { store(SESSION_KEY, null); setStoredSession(null); setStoredLobby(undefined); }} />}
  </main>;
}
