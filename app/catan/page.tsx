"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Flag, LockKeyhole, LogOut, Plus, RotateCcw, Settings2, Users, X } from "lucide-react";
import { ConfirmDialog, GameBackLink, GameDialog, GameModes, LobbyInviteDialog, LobbyLeaveButton, LobbyToolbar, ResumeSessionDialog, type ResumeLobbyInfo } from "@/components/game-entry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CatanGameUI, CatanRules, TargetPoints } from "@/components/catan/game-ui";
import { CatanDiceOverlay } from "@/components/catan/dice";
import { DEFAULT_TARGET_POINTS, PLAYER_COLORS, applyCatanAction, catanView, createCatanGame, localActorId, type CatanAction, type CatanGame, type CatanView } from "@/lib/catan";
import { localNotificationRecipients } from "@/lib/catan-notifications";
import { describeLobby, resolveOnlineGameStartup, type GameSession } from "@/lib/game-session";

const SESSION_KEY = "gameson-catan-session-v1";
const LOCAL_KEY = "gameson-catan-local-v1";
type LobbyState = { lobby: { id: string; name: string; hostPlayerId: string; targetPoints: number; discoverable: boolean; revision: number }; members: { id: string; name: string }[]; me: { id: string; name: string }; game: CatanView | null };
type ResponseData = { session?: GameSession; state?: LobbyState; left?: boolean; error?: string };
type EntryMode = "home" | "create" | "join" | "local";
type NearbyLobby = { id: string; name: string; player_count: number };
type LocalReceipt = { playerId: string; afterSequence: number };
class ApiError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000), ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new ApiError(data.error || "Die Anfrage konnte nicht abgeschlossen werden.", response.status);
  return data;
}
function loadLocal(): { game: CatanGame; receipts: LocalReceipt[] } | null {
  const raw = localStorage.getItem(LOCAL_KEY); if (!raw) return null;
  const { localReceipts = [], ...value } = JSON.parse(raw) as CatanGame & { localReceipts?: LocalReceipt[] };
  if (value.version !== 1 || !Array.isArray(value.players) || value.players.length < 3 || value.players.length > 4 || value.board?.hexes?.length !== 19 || !value.players[value.currentPlayer]) throw new Error("Die gespeicherte Partie kann nicht gelesen werden. Du kannst eine neue lokale Partie starten.");
  return { game: value, receipts: localReceipts };
}

export default function CatanPage() {
  const [mode, setMode] = useState<EntryMode>("home"); const [ready, setReady] = useState(false);
  const [session, setSession] = useState<GameSession | null>(null); const [state, setState] = useState<LobbyState | null>(null);
  const [localGame, setLocalGame] = useState<CatanGame | null>(null); const [localSaved, setLocalSaved] = useState(false); const [unlocked, setUnlocked] = useState<string | null>(null);
  const [localReceipts, setLocalReceipts] = useState<LocalReceipt[]>([]);
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false); const [connected, setConnected] = useState(true);
  const [playerName, setPlayerName] = useState(""); const [groupName, setGroupName] = useState(""); const [code, setCode] = useState("");
  const [names, setNames] = useState(["", "", ""]); const [target, setTarget] = useState(DEFAULT_TARGET_POINTS);
  const [confirmNew, setConfirmNew] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false); const [settingsOpen, setSettingsOpen] = useState(false); const [leaveOpen, setLeaveOpen] = useState(false);
  const [storedSession, setStoredSession] = useState<GameSession | null>(null); const [storedLobby, setStoredLobby] = useState<ResumeLobbyInfo | null | undefined>(undefined);
  const [nearby, setNearby] = useState<NearbyLobby[]>([]);
  const stateRef = useRef<LobbyState | null>(null); const locked = useRef(false);
  const store = (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { setNotice("Der Browser kann den Spielstand nicht speichern. Halte diese Seite geöffnet, bis die Partie beendet ist."); } };
  const acceptState = useCallback((next: LobbyState) => {
    if (stateRef.current?.lobby.id === next.lobby.id && stateRef.current.lobby.revision > next.lobby.revision) return;
    stateRef.current = next; setState(next); setConnected(true);
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
    try {
      const startup = resolveOnlineGameStartup(window.location.search, localStorage.getItem(SESSION_KEY));
      setLocalSaved(Boolean(localStorage.getItem(LOCAL_KEY)));
      if (startup.kind === "resume") setSession(startup.session);
      if (startup.kind === "choose") setStoredSession(startup.session);
      if (startup.kind === "join") { setMode("join"); setCode(startup.lobbyId); }
      if (startup.kind === "local") { const saved = loadLocal(); if (saved) { setLocalGame(saved.game); setLocalReceipts(saved.receipts); } else setMode("local"); }
    } catch (error) { setNotice(error instanceof Error ? error.message : "Der letzte Spielstand konnte nicht geladen werden."); }
    setReady(true);
    });
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});
    const hide = () => { if (document.hidden) setUnlocked(null); }; document.addEventListener("visibilitychange", hide);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", hide); };
  }, []);
  const refresh = useCallback(async (current: GameSession) => {
    const next = await request<LobbyState>(`/api/catan?lobby=${encodeURIComponent(current.lobbyId)}`, { headers: { Authorization: `Bearer ${current.token}` } });
    acceptState(next);
  }, [acceptState]);
  useEffect(() => {
    if (!session) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await request<LobbyState>(`/api/catan?lobby=${encodeURIComponent(session.lobbyId)}`, { headers: { Authorization: `Bearer ${session.token}` } });
        if (!cancelled) acceptState(next);
      } catch (error) {
        if (cancelled) return;
        setConnected(false);
        if (error instanceof ApiError && [401, 404].includes(error.status)) {
          setSession(null); setState(null); stateRef.current = null;
          store(SESSION_KEY, null); setNotice(error.message); setMode("join"); setCode(session.lobbyId);
          return;
        }
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 2500);
    };
    void poll(); return () => { cancelled = true; clearTimeout(timer); };
  }, [session, acceptState]);
  // Waiting lobbies on the same network are offered under "Lobby beitreten" while this device is not playing.
  useEffect(() => {
    if (session || localGame || (mode !== "home" && mode !== "join")) return;
    let active = true;
    const load = () => request<{ lobbies: NearbyLobby[] }>("/api/catan?nearby=1").then((data) => { if (active) setNearby(data.lobbies); }).catch(() => undefined);
    load(); const timer = setInterval(load, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [session, localGame, mode]);
  // Describe the stored round while the player decides; an invalid session leaves only "new game" to choose.
  useEffect(() => {
    if (!storedSession) return;
    let active = true;
    request<LobbyState>(`/api/catan?lobby=${encodeURIComponent(storedSession.lobbyId)}`, { headers: { Authorization: `Bearer ${storedSession.token}` } })
      .then((next) => { if (active) setStoredLobby({ name: next.lobby.name, detail: describeLobby(next.members.length, next.game ? next.game.phase === "finished" ? "Partie beendet" : "Partie läuft" : "Lobby wartet auf den Start") }); })
      .catch((error: unknown) => { if (active) setStoredLobby(error instanceof ApiError && [401, 404].includes(error.status) ? null : { detail: "Gerade keine Verbindung. Du kannst trotzdem entscheiden." }); });
    return () => { active = false; };
  }, [storedSession]);
  async function enter(kind: "create" | "join") {
    if (locked.current) return; locked.current = true; setBusy(true); setNotice("");
    try {
      const data = await request<ResponseData>("/api/catan", { method: "POST", body: JSON.stringify({ action: kind, playerName, name: groupName, code, targetPoints: target }) });
      if (data.session && data.state) { store(SESSION_KEY, JSON.stringify(data.session)); acceptState(data.state); setSession(data.session); window.history.replaceState({}, "", `/catan?lobby=${data.session.lobbyId}`); }
    } catch (error) { setNotice(error instanceof ApiError ? error.message : "Keine Verbindung. Deine Eingaben bleiben erhalten; versuche es erneut."); }
    finally { locked.current = false; setBusy(false); }
  }
  async function post(action: string, extra: Record<string, unknown> = {}): Promise<boolean> {
    if (locked.current || !session || !stateRef.current) return false;
    locked.current = true; setBusy(true); setNotice("");
    try {
      const data = await request<ResponseData>("/api/catan", { method: "POST", headers: { Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ action, lobbyId: session.lobbyId, revision: stateRef.current.lobby.revision, ...extra }) });
      if (data.state) acceptState(data.state);
      if (data.left) { store(SESSION_KEY, null); setSession(null); setState(null); stateRef.current = null; setMode("home"); window.history.replaceState({}, "", "/catan"); }
      return true;
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : "Die Bestätigung fehlt. Der Spielstand wird neu geladen; prüfe deinen Zug, bevor du ihn erneut sendest.");
      try { await refresh(session); } catch { setConnected(false); }
      return false;
    } finally { locked.current = false; setBusy(false); }
  }
  function startLocal() {
    try {
      const game = createCatanGame(names.map((name, i) => ({ id: `local-${i}`, name })), target);
      store(LOCAL_KEY, JSON.stringify(game)); setLocalGame(game); setLocalReceipts([]); setLocalSaved(true); setUnlocked(null); setNotice("");
      window.history.replaceState({}, "", "/catan?local=1");
    } catch (error) { setNotice((error as Error).message); }
  }
  async function sendLocal(action: CatanAction) {
    if (!localGame || locked.current || localReceipts.length) return false;
    locked.current = true;
    try {
      const previousActor = localActorId(localGame);
      const next = applyCatanAction(localGame, previousActor, action);
      const receipts = localNotificationRecipients(next, previousActor, localGame.sequence).map((playerId) => ({ playerId, afterSequence: localGame.sequence }));
      setLocalReceipts(receipts);
      if ((receipts[0]?.playerId ?? localActorId(next)) !== previousActor) setUnlocked(null);
      store(LOCAL_KEY, JSON.stringify({ ...next, localReceipts: receipts })); setLocalGame(next); return true;
    } catch (error) { setNotice((error as Error).message); return false; }
    finally { locked.current = false; }
  }
  const resumeStoredSession = () => { if (!storedSession) return; setStoredSession(null); setStoredLobby(undefined); setSession(storedSession); window.history.replaceState({}, "", `/catan?lobby=${storedSession.lobbyId}`); };
  const discardStoredSession = () => { store(SESSION_KEY, null); setStoredSession(null); setStoredLobby(undefined); };
  const localReceipt = localReceipts[0];
  const actor = localGame ? localReceipt?.playerId ?? localActorId(localGame) : null;
  const finishLocalReceipt = () => {
    const remaining = localReceipts.slice(1);
    setLocalReceipts(remaining);
    if (localGame) store(LOCAL_KEY, JSON.stringify({ ...localGame, localReceipts: remaining }));
    if (localGame && (remaining[0]?.playerId ?? localActorId(localGame)) !== actor) setUnlocked(null);
  };
  const isHost = Boolean(state && state.me.id === state.lobby.hostPlayerId);
  const inviteUrl = state && typeof window !== "undefined" ? `${window.location.origin}/catan?lobby=${state.lobby.id}&join=1` : "";
  const selectedLobby = mode === "join" ? nearby.find((item) => item.id === code) : undefined;
  const active = localGame || state?.game;
  const needsHandoff = localGame && actor && unlocked !== actor && (localReceipt || localGame.phase !== "finished");
  const back = () => { setMode("home"); setNotice(""); window.history.replaceState({}, "", "/catan"); };
  // A running game owns the whole screen: the page header steps aside, and the way out moves into "Übersicht".
  const playing = Boolean(active) && !needsHandoff;
  return <main className={`catan-shell ${playing ? "catan-shell-wide catan-shell-play" : ""}`}>
    {!playing && <header className="catan-header"><GameBackLink /><div className="catan-brand"><Flag aria-hidden="true" /><span>CATAN <small>by Gameson</small></span></div><span className={`catan-connection ${!connected && session ? "is-offline" : ""}`}>{localGame || mode === "local" ? "Ein Gerät · lokal" : session ? connected ? "Verbunden" : "Verbindung unterbrochen" : "3–4 Personen"}</span></header>}
    {notice && <div className="catan-notice" role="alert"><p>{notice}</p><Button variant="ghost" size="icon" aria-label="Hinweis schließen" onClick={() => setNotice("")}><X /></Button></div>}
    {!ready ? <p role="status">Spiel wird geladen …</p> : session && !state ? <section className="catan-panel"><h1>Lobby wird geladen …</h1><p role="status">{connected ? "Deine letzte Partie wird fortgesetzt." : "Die Verbindung fehlt. Wir versuchen es erneut."}</p><Button variant="outline" onClick={() => { setSession(null); back(); }}>Zur Spielauswahl von Catan</Button></section> : needsHandoff ? <section className="catan-handoff">
      <LockKeyhole aria-hidden="true" /><span className="catan-kicker">Handkarten bleiben geheim</span><h1>Weitergeben an<br /><span style={{ color: PLAYER_COLORS[localGame.players.find((p) => p.id === actor)!.color] }}>{localGame.players.find((p) => p.id === actor)!.name}</span></h1>
      <p>{localReceipt ? "Es gibt neue Meldungen zu Karten oder deinen Rohstoffen." : localGame.phase === "discard" ? "Du musst Rohstoffe abgeben." : localGame.trade ? "Für dich liegt ein Handelsangebot vor." : "Dein nächster Spielzug wartet."} Nur du schaust auf den Bildschirm.</p>
      <Button className="catan-primary" onClick={() => setUnlocked(actor)}>Ich bin {localGame.players.find((p) => p.id === actor)!.name}</Button>
    </section> : active ? <CatanGameUI key={localGame ? `${localGame.id}-${actor}` : state!.game!.id} game={localGame ? catanView(localGame, actor!) : state!.game!} send={localGame ? sendLocal : (move) => post("move", { move })} busy={busy || Boolean(localReceipt) || Boolean(session && !connected)} local={Boolean(localGame)} offline={Boolean(session && !connected)} afterNotificationSequence={localGame ? localReceipt?.afterSequence ?? localGame.sequence : undefined} onNotificationsRead={localReceipt ? finishLocalReceipt : undefined} onHide={() => setUnlocked(null)} onRematch={localGame ? () => { setNames([...localGame.players].sort((a, b) => a.color - b.color).map((p) => p.name)); setTarget(localGame.targetPoints); setLocalGame(null); setMode("local"); store(LOCAL_KEY, null); setLocalSaved(false); } : isHost ? () => void post("reset") : undefined} /> : state ? <>
      <section className="catan-lobby-heading"><span className="catan-kicker">Eure Catan-Lobby</span><h1>{state.lobby.name}</h1><p>Teilt den Code oder Einladungslink. Startet mit drei oder vier Personen.</p></section>
      <LobbyToolbar onInvite={() => setInviteOpen(true)} onSettings={isHost ? () => setSettingsOpen(true) : undefined} busy={busy} />
      <section className="catan-panel"><div className="catan-section-heading"><h2><Users />Mitspielende</h2><span>{state.members.length} / 4</span></div><ul className="catan-lobby-players">{state.members.map((p, i) => <li key={p.id}><span style={{ background: PLAYER_COLORS[i] }}>{p.name.slice(0, 1)}</span><div><strong>{p.name}{p.id === state.me.id ? " (du)" : ""}</strong>{p.id === state.lobby.hostPlayerId && <small>Spielleitung</small>}</div>{isHost && p.id !== state.me.id && <Button variant="ghost" size="icon" disabled={busy} onClick={() => void post("remove", { playerId: p.id })} aria-label={`${p.name} aus der Lobby entfernen`}><X /></Button>}</li>)}</ul>
        <div className="catan-target"><div><strong>Eure Spielregeln</strong><p>Siegpunktziel {state.lobby.targetPoints} · {state.lobby.discoverable ? "in der Nähe sichtbar" : "nicht in der Nähe sichtbar"}</p></div>{isHost && <Button variant="outline" onClick={() => setSettingsOpen(true)}><Settings2 />Bearbeiten</Button>}</div>
        {isHost ? <Button className="catan-primary" disabled={busy || state.members.length < 3} onClick={() => void post("start")}><Flag />{state.members.length < 3 ? `Noch ${3 - state.members.length} ${state.members.length === 2 ? "Person fehlt" : "Personen fehlen"}` : "Partie starten"}</Button> : <p className="catan-muted">Die Spielleitung startet, sobald alle da sind.</p>}
      </section><LobbyLeaveButton busy={busy} onClick={() => setLeaveOpen(true)} /><CatanRules />
      {inviteOpen && <LobbyInviteDialog theme="catan" name={state.lobby.name} code={state.lobby.id} codeLabel="Lobbycode" url={inviteUrl} onClose={() => setInviteOpen(false)} onError={() => setNotice(`Einladungslink: ${inviteUrl}`)} />}
      {settingsOpen && isHost && <GameDialog theme="catan" kicker="Einstellungen" title="Eure Spielregeln" description="Änderungen gelten sofort für die ganze Lobby." busy={busy} onClose={() => setSettingsOpen(false)} closeLabel="Einstellungen schließen" footer={<Button className="game-accept-action" disabled={busy} onClick={() => setSettingsOpen(false)}>Fertig</Button>}>
        <TargetPoints value={state.lobby.targetPoints} onChange={(targetPoints) => void post("settings", { targetPoints })} disabled={busy} />
        <div className="catan-target catan-discoverable"><label htmlFor="catan-discoverable"><strong>Lobby in der Nähe anzeigen</strong><small>Personen im selben Netzwerk sehen eure Lobby unter „Lobby beitreten“.</small></label><Switch id="catan-discoverable" checked={state.lobby.discoverable} disabled={busy} onCheckedChange={(discoverable) => void post("settings", { discoverable })} /></div>
      </GameDialog>}
      {leaveOpen && <ConfirmDialog theme="catan" title="Lobby verlassen?" description={isHost ? "Du gibst deinen Platz frei. Die Spielleitung geht an die nächste Person in der Lobby." : "Du gibst deinen Platz frei. Über den Lobbycode kannst du jederzeit wieder beitreten."} confirmLabel="Lobby verlassen" cancelLabel="In der Lobby bleiben" confirmIcon={<LogOut aria-hidden="true" />} busy={busy} onCancel={() => setLeaveOpen(false)} onConfirm={() => { setLeaveOpen(false); void post("leave"); }} />}
    </> : <>
      <section className="catan-intro"><span className="catan-kicker">Handel · Strategie · Inselglück</span><h1>Die Siedler<br />von <span>Catan.</span></h1><p>Straßen verbinden. Siedlungen wachsen.<br />Wer erreicht zuerst das Punktziel?</p><div className="catan-intro-meta"><span>3–4 Personen</span><span>60–120 Minuten</span><span>Ab 10 Jahren</span></div></section>
      {mode === "home" ? <>
        <GameModes onCreate={() => setMode("create")} onJoin={() => setMode("join")} onLocal={() => setMode("local")} />
        {localSaved && <Button className="catan-resume" variant="outline" onClick={() => { try { const saved = loadLocal(); if (saved) { setLocalGame(saved.game); setLocalReceipts(saved.receipts); setUnlocked(null); window.history.replaceState({}, "", "/catan?local=1"); } else setLocalSaved(false); } catch (error) { setNotice((error as Error).message); } }}><RotateCcw />Lokale Partie fortsetzen</Button>}
      </> : <section className="catan-panel catan-setup"><Button variant="ghost" onClick={back}><ArrowLeft />Zurück</Button><h2>{mode === "create" ? "Lobby erstellen" : mode === "join" ? "Lobby beitreten" : "Ein Gerät für alle"}</h2>
        {mode === "join" && (selectedLobby ? <div className="selected-lobby"><span><small>Ausgewählte Lobby</small><strong>{selectedLobby.name}</strong></span><Button type="button" variant="outline" onClick={() => setCode("")}>Ändern</Button></div> : nearby.length > 0 && <section className="nearby-section" aria-label="Lobbys in deiner Nähe"><div className="section-heading"><strong>In deiner Nähe</strong><span>automatisch erkannt</span></div><div className="nearby-list">{nearby.map((item) => <button type="button" key={item.id} onClick={() => setCode(item.id)}><span className="nearby-pulse" /><span><strong>{item.name}</strong><small>{item.player_count} von 4 Personen</small></span><b>→</b></button>)}</div></section>)}
        {mode === "local" ? <><p>Tragt eure Namen ein. Beim Wechsel verdecken wir die Handkarten, bis die nächste Person übernimmt.</p>{names.map((name, i) => <label className="catan-field" key={i}><span>Person {i + 1}</span><div className="catan-name-field"><Input autoComplete="off" maxLength={24} aria-label={`Name von Person ${i + 1}`} value={name} onChange={(e) => setNames(names.map((n, j) => i === j ? e.target.value : n))} placeholder={`Name ${i + 1}`} />{i === 3 && <Button variant="ghost" size="icon" aria-label="Vierte Person entfernen" onClick={() => setNames(names.slice(0, 3))}><X /></Button>}</div></label>)}
          {names.length < 4 && <Button variant="outline" onClick={() => setNames([...names, ""])}><Plus />Vierte Person hinzufügen</Button>}
          <TargetPoints value={target} onChange={setTarget} /><Button className="catan-primary" disabled={names.some((name) => !name.trim())} onClick={() => { if (localSaved) setConfirmNew(true); else startLocal(); }}>Partie starten</Button>
        </> : <form onSubmit={(e) => { e.preventDefault(); void enter(mode as "create" | "join"); }}><label className="catan-field" htmlFor="catan-player-name"><span>Dein Name</span><Input id="catan-player-name" required maxLength={24} autoComplete="nickname" value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="Wie heißt du?" /></label>
          {mode === "create" ? <><label className="catan-field" htmlFor="catan-group-name"><span>Gruppenname</span><Input id="catan-group-name" required minLength={2} maxLength={32} autoComplete="off" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Zum Beispiel: Inselrunde" /></label><TargetPoints value={target} onChange={setTarget} disabled={busy} /></> : !selectedLobby && <label className="catan-field" htmlFor="catan-join-code"><span>Lobbycode oder Gruppenname</span><Input id="catan-join-code" required maxLength={40} autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code oder Gruppenname" /></label>}
          <Button type="submit" className="catan-primary" disabled={busy}>{busy ? "Verbindung wird hergestellt …" : mode === "create" ? "Lobby erstellen" : "Beitreten"}</Button>
        </form>}
      </section>}
      <CatanRules />
    </>}
    <CatanDiceOverlay game={active} />
    {storedSession && <ResumeSessionDialog theme="catan" lobby={storedLobby} onResume={resumeStoredSession} onDiscard={discardStoredSession} />}
    {confirmNew && <ConfirmDialog theme="catan" title="Neue lokale Partie starten?" description="Die bisher auf diesem Gerät gespeicherte Catan-Partie wird ersetzt." confirmLabel="Neue Partie starten" cancelLabel="Gespeicherte Partie behalten" onCancel={() => setConfirmNew(false)} onConfirm={() => { setConfirmNew(false); startLocal(); }} />}
  </main>;
}
