"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, DoorOpen, LogOut, PencilLine, Plus, Settings2, Users, X } from "lucide-react";
import { ConfirmDialog, GameBackLink, GameDialog, LobbyInviteDialog, LobbyLeaveButton, LobbyToolbar, ResumeSessionDialog, type ResumeLobbyInfo } from "@/components/game-entry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SlfAnswerSheet, SlfReview, SlfRules, SlfScoreboard, SlfSettingsForm, SlfTimerBar, SlfTimerDialog, useServerNow, type ServerClock } from "@/components/stadt-land-fluss/game-ui";
import { describeLobby, resolveOnlineGameStartup, type GameSession } from "@/lib/game-session";
import { DEFAULT_COLUMNS, DEFAULT_TIMER_SECONDS, formatTime, type SlfState } from "@/lib/stadt-land-fluss";

const SESSION_KEY = "gameson-slf-session-v1";
const API = "/api/stadt-land-fluss";
type ResponseData = { session?: GameSession; state?: SlfState; left?: boolean; error?: string };
type Nearby = { id: string; name: string; player_count: number };
class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
async function request<T>(url: string, options?: RequestInit): Promise<{ data: T; elapsed: number; received: number }> {
  const started = performance.now();
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000), ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const data = await response.json() as T & { error?: string }; const received = performance.now();
  if (!response.ok) throw new ApiError(data.error || "Die Anfrage konnte nicht abgeschlossen werden.", response.status);
  return { data, elapsed: received - started, received };
}

export default function StadtLandFlussPage() {
  const [mode, setMode] = useState<"home" | "create" | "join">("home"); const [ready, setReady] = useState(false);
  const [session, setSession] = useState<GameSession | null>(null); const [state, setState] = useState<SlfState | null>(null);
  const [clock, setClock] = useState<ServerClock>({ server: 0, at: 0 }); const now = useServerNow(clock);
  const [connected, setConnected] = useState(true); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [playerName, setPlayerName] = useState(""); const [groupName, setGroupName] = useState(""); const [code, setCode] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false); const [timerOpen, setTimerOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false); const [leaveOpen, setLeaveOpen] = useState(false);
  const [nearby, setNearby] = useState<Nearby[]>([]); const [storedSession, setStoredSession] = useState<GameSession | null>(null); const [storedLobby, setStoredLobby] = useState<ResumeLobbyInfo | null | undefined>();
  const latest = useRef<SlfState | null>(null); const locked = useRef(false); const activeSession = useRef<GameSession | null>(null);
  const lastContact = useRef(0);
  const store = useCallback((value: GameSession | null) => {
    try { if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value)); else localStorage.removeItem(SESSION_KEY); }
    catch { setNotice("Dein Browser kann die Lobby nicht speichern. Lass die Seite während des Spiels geöffnet."); }
  }, []);
  const acceptState = useCallback((next: SlfState, elapsed: number, received: number) => {
    lastContact.current = received; setConnected(true);
    if (latest.current?.lobby.id === next.lobby.id && (latest.current.lobby.revision > next.lobby.revision || latest.current.lobby.revision === next.lobby.revision && latest.current.serverNow > next.serverNow)) return;
    latest.current = next; setState(next);
    // Anchor to a monotonic clock, independent of device date/time. Half the round-trip estimates transit time.
    setClock({ server: next.serverNow + elapsed / 2, at: received });
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const startup = resolveOnlineGameStartup(window.location.search, localStorage.getItem(SESSION_KEY));
        if (startup.kind === "resume") { activeSession.current = startup.session; setSession(startup.session); }
        if (startup.kind === "choose") setStoredSession(startup.session);
        if (startup.kind === "join") { setMode("join"); setCode(startup.lobbyId); }
      } catch { setNotice("Der gespeicherte Zugang konnte nicht gelesen werden. Du kannst eine neue Lobby erstellen."); }
      setReady(true);
    });
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (!session) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>; let polling = false;
    const poll = async () => {
      if (polling || cancelled) return; polling = true; clearTimeout(timer);
      try {
        const result = await request<SlfState>(`${API}?lobby=${encodeURIComponent(session.lobbyId)}`, { headers: { Authorization: `Bearer ${session.token}` } });
        if (!cancelled) acceptState(result.data, result.elapsed, result.received);
      } catch (error) {
        if (cancelled) return; setConnected(false);
        if (error instanceof ApiError && [401, 404].includes(error.status)) { activeSession.current = null; latest.current = null; setSession(null); setState(null); store(null); setMode("join"); setCode(session.lobbyId); setNotice(error.message); }
      } finally { polling = false; }
      if (!cancelled) timer = setTimeout(() => void poll(), latest.current?.game?.phase === "writing" ? 750 : 1200);
    };
    const foreground = () => { if (!document.hidden) void poll(); };
    const offline = () => setConnected(false);
    const watchdog = setInterval(() => { if (performance.now() - lastContact.current > 6000) setConnected(false); }, 1000);
    void poll(); window.addEventListener("online", foreground); window.addEventListener("offline", offline); document.addEventListener("visibilitychange", foreground);
    return () => { cancelled = true; clearTimeout(timer); clearInterval(watchdog); window.removeEventListener("online", foreground); window.removeEventListener("offline", offline); document.removeEventListener("visibilitychange", foreground); };
  }, [session, acceptState, store]);
  useEffect(() => {
    if (session || mode === "create") return;
    let active = true;
    const load = () => request<{ lobbies: Nearby[] }>(`${API}?nearby=1`).then(({ data }) => { if (active) setNearby(data.lobbies); }).catch(() => undefined);
    void load(); const timer = setInterval(load, 10000); return () => { active = false; clearInterval(timer); };
  }, [mode, session]);
  useEffect(() => {
    if (!storedSession) return; let active = true;
    void request<SlfState>(`${API}?lobby=${encodeURIComponent(storedSession.lobbyId)}`, { headers: { Authorization: `Bearer ${storedSession.token}` } })
      .then(({ data }) => { if (active) setStoredLobby({ name: data.lobby.name, detail: describeLobby(data.members.length, data.game ? data.game.phase === "finished" ? "Partie beendet" : `Runde ${data.game.round.number} läuft` : "Lobby wartet") }); })
      .catch((e) => { if (active) setStoredLobby(e instanceof ApiError && [401, 404].includes(e.status) ? null : { detail: "Gerade keine Verbindung. Dein Zugang bleibt gespeichert." }); });
    return () => { active = false; };
  }, [storedSession]);
  async function enter() {
    if (locked.current) return; locked.current = true; setBusy(true); setNotice("");
    try {
      const result = await request<ResponseData>(API, { method: "POST", body: JSON.stringify({ action: mode, playerName, name: groupName, code }) });
      if (result.data.session && result.data.state) {
        const next = result.data.session; store(next); activeSession.current = next; setSession(next); acceptState(result.data.state, result.elapsed, result.received);
        window.history.replaceState({}, "", `/stadt-land-fluss?lobby=${next.lobbyId}`);
      }
    } catch (e) { setNotice(e instanceof ApiError ? e.message : "Keine Verbindung. Deine Eingaben bleiben erhalten; versuche es erneut."); }
    finally { locked.current = false; setBusy(false); }
  }
  const send = useCallback(async (action: string, extra: Record<string, unknown> = {}, quiet = false): Promise<boolean> => {
    const current = activeSession.current;
    if (!current || (!quiet && locked.current)) return false;
    if (!quiet) { locked.current = true; setBusy(true); setNotice(""); }
    try {
      const result = await request<ResponseData>(API, { method: "POST", headers: { Authorization: `Bearer ${current.token}` }, body: JSON.stringify({ action, lobbyId: current.lobbyId, ...extra }) });
      if (activeSession.current !== current) return false;
      if (result.data.state) acceptState(result.data.state, result.elapsed, result.received);
      if (result.data.left) { store(null); activeSession.current = null; latest.current = null; setSession(null); setState(null); setMode("home"); window.history.replaceState({}, "", "/stadt-land-fluss"); }
      return true;
    } catch (e) {
      if (!(e instanceof ApiError)) setConnected(false);
      if (!quiet) setNotice(e instanceof ApiError ? e.message : "Die Bestätigung fehlt. Der Spielstand wird neu geladen. Prüfe ihn, bevor du erneut tippst.");
      return false;
    } finally { if (!quiet) { locked.current = false; setBusy(false); } }
  }, [acceptState, store]);
  const inviteUrl = state && typeof window !== "undefined" ? `${location.origin}/stadt-land-fluss?lobby=${state.lobby.id}` : "";
  const game = state?.game; const isHost = !!state && state.me.id === state.lobby.hostPlayerId;
  const resumeStoredSession = () => { if (!storedSession) return; activeSession.current = storedSession; setSession(storedSession); setStoredSession(null); setStoredLobby(undefined); window.history.replaceState({}, "", `/stadt-land-fluss?lobby=${storedSession.lobbyId}`); };
  const discardStoredSession = () => { store(null); setStoredSession(null); setStoredLobby(undefined); };
  return <main className={`slf-shell${state ? " has-timer" : ""}`}>
    {state && <SlfTimerBar state={state} now={now} connected={connected} onEdit={() => setTimerOpen(true)} />}
    <header className="slf-header"><GameBackLink /><span className="slf-brand"><PencilLine aria-hidden="true" />STADT LAND FLUSS</span></header>
    {notice && <div className="slf-notice" role="alert"><p>{notice}</p><Button type="button" size="icon" variant="ghost" aria-label="Hinweis schließen" onClick={() => setNotice("")}><X aria-hidden="true" /></Button></div>}
    {!ready || session && !state ? <section className="slf-panel"><h1>Die Runde wird geladen …</h1><p>{connected ? "Einen Moment, wir verbinden dich mit der Lobby." : "Die Verbindung wird wiederhergestellt. Dein gespeicherter Zugang bleibt erhalten."}</p></section> : state ? <>
      {!connected && <div className="slf-offline" role="status">Verbindung unterbrochen. Wir verbinden dich erneut. Der Timer läuft weiter; nur rechtzeitig gespeicherte Antworten zählen.</div>}
      {!game ? <>
        <section className="slf-lobby-heading"><span className="slf-kicker">Gleich geht’s los</span><h1>{state.lobby.name}</h1><p>{isHost ? "Du bist der Lobby-Master. Lade deine Gruppe ein und lege eure Spalten fest." : "Der Lobby-Master legt die Spalten fest und startet das Spiel."}</p></section>
        <LobbyToolbar onInvite={() => setInviteOpen(true)} onSettings={isHost ? () => setSettingsOpen(true) : undefined} busy={busy} />
        <div className="slf-lobby-grid"><section className="slf-panel"><div className="slf-section-heading"><h2><Users aria-hidden="true" />Eure Runde</h2><span>{state.members.length} / 22</span></div>
          <ul className="slf-lobby-players">{state.members.map((p, i) => <li key={p.id}><span className="slf-avatar" data-color={i % 4}>{p.name.slice(0, 1).toUpperCase()}</span><div><strong>{p.name}{p.id === state.me.id && " (du)"}</strong><small>{p.id === state.lobby.hostPlayerId ? "Lobby-Master" : "Mit dabei"}</small></div>{isHost && p.id !== state.me.id && <Button type="button" size="icon" variant="ghost" disabled={busy} aria-label={`${p.name} entfernen`} onClick={() => void send("remove", { playerId: p.id })}><X aria-hidden="true" /></Button>}</li>)}</ul>
        </section><section className="slf-panel"><div className="slf-section-heading"><h2><Settings2 aria-hidden="true" />Eure Spielregeln</h2>{isHost && <Button type="button" variant="outline" onClick={() => setSettingsOpen(true)}><Settings2 aria-hidden="true" />Bearbeiten</Button>}</div><div className="slf-category-chips">{state.lobby.settings.columns.map((column, i) => <span key={column}><small>{i + 1}</small>{column}</span>)}</div><div className="slf-rule-summary"><span>{state.lobby.settings.rounds} Runden</span><span>{state.lobby.settings.timerSeconds === null ? "Ohne Zeitlimit" : `${formatTime(state.lobby.settings.timerSeconds)} pro Runde`}</span></div>
          {isHost ? <><Button type="button" className="slf-primary" disabled={busy || state.members.length < 2 || !connected} onClick={() => void send("start")}>Spiel starten<ArrowRight aria-hidden="true" /></Button>{state.members.length < 2 && <p className="slf-small slf-muted">Noch eine Person, dann könnt ihr starten.</p>}</> : <p className="slf-waiting">Warte auf den Start durch den Lobby-Master …</p>}
        </section></div><LobbyLeaveButton busy={busy} onClick={() => setLeaveOpen(true)} />
        {inviteOpen && <LobbyInviteDialog theme="slf" name={state.lobby.name} code={state.lobby.id} codeLabel="Lobbycode" url={inviteUrl} onClose={() => setInviteOpen(false)} onError={() => setNotice(`Einladungslink: ${inviteUrl}`)} />}
      </> : <>
        {game.phase === "writing" ? <SlfAnswerSheet key={game.round.id} game={game} meId={state.me.id} now={now} send={send} connected={connected} isHost={isHost} /> : <>
          {(game.phase === "results" || game.phase === "finished") && <><div className="slf-results-heading"><span className="slf-kicker">{game.phase === "finished" ? "Das war eure Partie" : "Runde geschafft"}</span><h1>{game.phase === "finished" ? "Wer hat die besten Wörter?" : "Jedes Wort zählt."}</h1></div><SlfScoreboard game={game} />
            {isHost ? <div className="slf-next-actions">{game.phase === "results" ? <><Button type="button" className="slf-primary" disabled={busy || !connected} onClick={() => void send("move", { move: { type: "next", roundId: game.round.id } })}>Runde {game.round.number + 1} starten<ArrowRight aria-hidden="true" /></Button><Button type="button" variant="outline" onClick={() => setSettingsOpen(true)}><Settings2 aria-hidden="true" />Spalten &amp; Timer bearbeiten</Button></> : <Button type="button" className="slf-primary" disabled={busy || !connected} onClick={() => void send("reset", { gameId: game.id })}><Plus aria-hidden="true" />Zur Lobby – neue Partie</Button>}</div> : <p className="slf-waiting">{game.phase === "finished" ? "Der Lobby-Master kann eine neue Partie öffnen." : "Der Lobby-Master startet die nächste Runde."}</p>}
          </>}
          <SlfReview key={game.round.id} game={game} meId={state.me.id} isHost={isHost} busy={busy || !connected} send={send} />
        </>}
        {game.phase === "review" && <SlfScoreboard game={game} />}
      </>}
      <SlfRules />
    </> : <>
      <section className="slf-intro"><span className="slf-kicker">Ein Buchstabe. Tausend Ideen.</span><div className="slf-hero-title"><h1>Stadt.<br />Land.<br /><em>Los!</em></h1><div className="slf-paper" aria-hidden="true"><span>STADT · LAND · FLUSS</span><strong>B<span>Berlin<br />Brasilien<br />Bode</span></strong><i /><i /><i /><b>Dein Kopf.<br />Deine Wörter.</b></div></div><p>Der Klassiker für euren Spieleabend. Alle tippen gleichzeitig. Über knifflige Antworten entscheidet ihr zusammen.</p><div className="slf-intro-meta"><span>2–22 Personen</span><span>Ein Handy pro Person</span><span>Eigene Spalten</span></div></section>
      {mode === "home" ? <div className="slf-entry-modes"><button type="button" className="slf-entry-primary" onClick={() => setMode("create")}><Users aria-hidden="true" /><span><strong>Lobby erstellen</strong><small>Deine Runde. Eure Regeln.</small></span><ArrowRight aria-hidden="true" /></button><button type="button" onClick={() => setMode("join")}><DoorOpen aria-hidden="true" /><span><strong>Lobby beitreten</strong><small>Per Link, Code oder Gruppenname.</small></span><ArrowRight aria-hidden="true" /></button></div> : <section className="slf-panel slf-entry-form"><Button type="button" variant="ghost" onClick={() => setMode("home")}><ArrowLeft aria-hidden="true" />Zurück</Button><h2>{mode === "create" ? "Eure Runde beginnt hier." : "Setz dich dazu."}</h2>
        {mode === "join" && nearby.length > 0 && <div className="slf-nearby"><strong>In deiner Nähe</strong>{nearby.map((item) => <button type="button" key={item.id} onClick={() => setCode(item.id)} aria-pressed={code === item.id}><span>{item.name}<small>{item.player_count} Personen</small></span>{code === item.id ? <Check aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}</button>)}</div>}
        <form onSubmit={(e) => { e.preventDefault(); void enter(); }}><label className="slf-field" htmlFor="slf-player-name"><span>Dein Name</span><Input id="slf-player-name" required maxLength={24} value={playerName} autoComplete="nickname" placeholder="Wie heißt du?" onChange={(e) => setPlayerName(e.target.value)} /></label>
          {mode === "create" ? <label className="slf-field" htmlFor="slf-group-name"><span>Gruppenname</span><Input id="slf-group-name" required minLength={2} maxLength={32} autoComplete="off" value={groupName} placeholder="Zum Beispiel: Wortakrobaten" onChange={(e) => setGroupName(e.target.value)} /></label> : <label className="slf-field" htmlFor="slf-join-code"><span>Lobbycode oder Gruppenname</span><Input id="slf-join-code" required maxLength={40} autoComplete="off" value={code} placeholder="Code oder Gruppenname" onChange={(e) => setCode(e.target.value)} /></label>}
          {mode === "create" && <p className="slf-small slf-muted">Startet mit {DEFAULT_COLUMNS.join(", ")} und {formatTime(DEFAULT_TIMER_SECONDS)} Minuten. Spalten und Timer kannst du anschließend in der Lobby bearbeiten.</p>}
          <Button type="submit" className="slf-primary" disabled={busy}>{busy ? "Wird verbunden …" : mode === "create" ? "Lobby erstellen" : "Beitreten"}<ArrowRight aria-hidden="true" /></Button>
        </form>
      </section>}
      <SlfRules />
    </>}
    {storedSession && <ResumeSessionDialog theme="slf" lobby={storedLobby} onResume={resumeStoredSession} onDiscard={discardStoredSession} />}
    {state && timerOpen && isHost && <SlfTimerDialog key={state.game?.round.id ?? "lobby"} state={state} send={send} busy={busy} onClose={() => setTimerOpen(false)} />}
    {settingsOpen && isHost && state && <GameDialog theme="slf" kicker="Einstellungen" title="Eure Spielregeln" description="Legt eure Spalten und das Tempo fest. Änderungen gelten für die nächste Runde." busy={busy} closeLabel="Einstellungen schließen" onClose={() => setSettingsOpen(false)}>
      <label className="slf-switch" htmlFor="slf-discoverable"><span>Lobby in der Nähe anzeigen</span><Switch id="slf-discoverable" checked={state.lobby.discoverable} disabled={busy} onCheckedChange={(discoverable) => void send("settings", { discoverable })} aria-label="Lobby in der Nähe anzeigen" /></label>
      <SlfSettingsForm key={JSON.stringify(state.lobby.settings)} value={state.lobby.settings} busy={busy} roundsLocked={!!game} onSave={(settings) => send("settings", { settings }).then((ok) => { if (ok) setSettingsOpen(false); return ok; })} />
    </GameDialog>}
    {leaveOpen && <ConfirmDialog theme="slf" title="Lobby verlassen?" description={isHost ? "Du gibst deinen Platz frei. Die Lobby-Leitung geht an die nächste Person in der Runde." : "Du gibst deinen Platz frei. Über den Lobbycode kannst du jederzeit wieder beitreten."} confirmLabel="Lobby verlassen" cancelLabel="In der Lobby bleiben" confirmIcon={<LogOut aria-hidden="true" />} busy={busy} onCancel={() => setLeaveOpen(false)} onConfirm={() => { setLeaveOpen(false); void send("leave"); }} />}
  </main>;
}
