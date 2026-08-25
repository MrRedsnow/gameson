"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ROLE_INFO,
  SELECTABLE_ROLES,
  buildRoleDeck,
  defaultWolfCount,
  determineWinner,
  maxWolfCount,
  minimumPlayersForRole,
  phaseAfterDawn,
  roleTeam,
  validateRoleSetup,
  weightedVoteLeaders,
  type Winner,
  type WerewolfPhase,
  type WerewolfRole,
  type WerewolfTeam,
} from "../../lib/werewolf";
import { SECRET_AUDIO_PHASES, playWerewolfPhaseCue, playWerewolfWinnerCue, unlockWerewolfAudio } from "../../lib/werewolf-audio";

type Screen = "home" | "create" | "join" | "local";
type Session = { lobbyId: string; token: string };
type NearbyLobby = { id: string; name: string; player_count: number };
type PlayerView = { id: string; name: string; isHost: boolean; alive: boolean; online: boolean; role?: WerewolfRole; knownRole?: WerewolfRole; charmed?: boolean };
type PrivateRole = { role: WerewolfRole; label: string; description: string; team: WerewolfTeam; lover: string | null; roleModel: string | null; charmed: boolean; elderShield: boolean; healPotion: boolean; poisonPotion: boolean; reserveRoles?: WerewolfRole[] };
type LobbyState = {
  lobby: { id: string; name: string; status: "waiting" | "playing" | "results"; phase: WerewolfPhase; wolfCount: number; selectedRoles: WerewolfRole[]; mayorEnabled: boolean; mayorPlayerId: string | null; discoverable: boolean; audioMode: "all" | "host"; revision: number; matchNumber: number; night: number; winner: Winner; phaseStartedAt: number };
  me: { id: string; name: string; isHost: boolean; alive: boolean };
  players: PlayerView[];
  privateRole: PrivateRole | null;
  action: { phase: WerewolfPhase; candidates: { id: string; name: string }[]; maxTargets: number; wolfVictimId?: string | null; canHeal?: boolean; canPoison?: boolean } | null;
  ownSubmission: unknown;
  actionResult: { seenLabel?: string; name?: string } | null;
  progress: { submitted: number; required: number };
  canSkip: boolean;
  canClaimHost: boolean;
  serverTime: number;
};

const PHASE_COPY: Record<WerewolfPhase, { title: string; text: string }> = {
  waiting: { title: "Das Dorf versammelt sich.", text: "Stellt eure Rollen zusammen und startet, sobald alle da sind." },
  mayor_vote: { title: "Wählt den Bürgermeister.", text: "Seine Stimme zählt bei jeder Dorfabstimmung doppelt." },
  thief: { title: "Der Dieb entscheidet.", text: "Eine geheime Rolle kann jetzt getauscht werden." },
  cupid: { title: "Amor spannt den Bogen.", text: "Zwei Schicksale werden miteinander verbunden." },
  wild_child: { title: "Das Wolfskind wählt.", text: "Ein Vorbild entscheidet über sein späteres Schicksal." },
  healer: { title: "Der Heiler wacht.", text: "Eine Person wird vor dem Rudel geschützt." },
  seer: { title: "Die Seherin blickt tiefer.", text: "Eine verborgene Rolle wird erkannt." },
  wolves: { title: "Das Rudel erwacht.", text: "Die Werwölfe wählen ihr nächtliches Opfer." },
  witch: { title: "Die Hexe öffnet ihre Tränke.", text: "Heilen, vergiften oder die Nacht geschehen lassen." },
  white_werewolf: { title: "Die Weiße Werwölfin jagt.", text: "Auch das Rudel ist vor ihr nicht sicher." },
  piper: { title: "Eine fremde Melodie erklingt.", text: "Bis zu zwei Personen werden verzaubert." },
  dawn: { title: "Der Morgen graut.", text: "Das Dorf erfährt, was in der Nacht oder bei der Abstimmung geschah." },
  discussion: { title: "Wem könnt ihr trauen?", text: "Diskutiert, beschuldigt und verteidigt euch – aber verratet eure Rolle nicht leichtfertig." },
  day_vote: { title: "Das Dorf stimmt ab.", text: "Wählt die Person, die ihr für am gefährlichsten haltet." },
  runoff: { title: "Der Stichentscheid.", text: "Nur die Personen mit den meisten Stimmen stehen noch zur Wahl." },
  hunter: { title: "Der letzte Schuss.", text: "Der Jäger nimmt eine lebende Person mit in den Tod." },
  results: { title: "Die Partie ist entschieden.", text: "Alle Rollen sind nun bekannt." },
};

const WINNER_COPY: Record<string, string> = { village: "Das Dorf gewinnt", wolves: "Das Rudel gewinnt", piper: "Der Flötenspieler gewinnt", white_werewolf: "Die Weiße Werwölfin gewinnt" };

function randomIndex(length: number) { if (length <= 1) return 0; const limit = Math.floor(0x100000000 / length) * length; const values = new Uint32Array(1); do crypto.getRandomValues(values); while (values[0] >= limit); return values[0] % length; }

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) }, cache: "no-store" });
  const data = await response.json() as T & { error?: string }; if (!response.ok) throw new Error(data.error || "Etwas ist schiefgelaufen."); return data;
}

function WolfMark() { return <div className="wolf-mark" aria-hidden="true"><span>☾</span></div>; }
function Connection({ online }: { online: boolean }) { return <span className={`connection-pill ${online ? "" : "offline"}`}><i />{online ? "online" : "offline"}</span>; }
function Notice({ message, clear }: { message: string; clear: () => void }) { useEffect(() => { const timer = window.setTimeout(clear, 4200); return () => clearTimeout(timer); }, [clear]); return <button className="notice" onClick={clear}>{message}<span>×</span></button>; }
function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (value: number) => void }) { return <div className="stepper"><button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>−</button><strong>{value}</strong><button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>+</button></div>; }

function WolfTopbar({ title, onBack, online = true }: { title: string; onBack?: () => void; online?: boolean }) {
  return <header className="topbar wolf-topbar">{onBack ? <button className="icon-button" onClick={onBack} aria-label="Zurück">←</button> : <WolfMark />}<strong className="topbar-title">{title}</strong><Connection online={online} /></header>;
}

export default function WerewolfHome() {
  const [screen, setScreen] = useState<Screen>("home"); const [session, setSession] = useState<Session | null>(null); const [state, setState] = useState<LobbyState | null>(null);
  const [nearby, setNearby] = useState<NearbyLobby[]>([]); const [inviteLobbyId, setInviteLobbyId] = useState(""); const [notice, setNotice] = useState(""); const [online, setOnline] = useState(true); const [busy, setBusy] = useState(false);
  const showError = useCallback((error: unknown) => setNotice(error instanceof Error ? error.message : "Etwas ist schiefgelaufen."), []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine); window.addEventListener("online", update); window.addEventListener("offline", update);
    const timer = window.setTimeout(() => { setOnline(navigator.onLine); const params = new URLSearchParams(window.location.search); const invited = params.get("lobby"); if (invited) { setInviteLobbyId(invited); setScreen("join"); } else if (params.get("local") === "1") setScreen("local"); else if (params.get("join") === "1") setScreen("join"); else { try { const stored = localStorage.getItem("gameson:werewolf:session"); if (stored) setSession(JSON.parse(stored)); } catch { /* ignore */ } } }, 0);
    return () => { clearTimeout(timer); window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => { if (!session) return; localStorage.setItem("gameson:werewolf:session", JSON.stringify(session)); window.history.replaceState({}, "", `/werwolf?lobby=${encodeURIComponent(session.lobbyId)}`); }, [session]);
  useEffect(() => { if (session || !online || (screen !== "home" && screen !== "join")) return; let active = true; const load = () => api<{ lobbies: NearbyLobby[] }>("/api/werwolf?action=nearby").then((data) => { if (active) setNearby(data.lobbies); }).catch(() => undefined); load(); const timer = setInterval(load, 10000); return () => { active = false; clearInterval(timer); }; }, [online, screen, session]);

  const fetchState = useCallback(async (quiet = false) => {
    if (!session) return; try { const data = await api<LobbyState>(`/api/werwolf?action=state&lobbyId=${encodeURIComponent(session.lobbyId)}`, { headers: { Authorization: `Bearer ${session.token}` } }); setState(data); setOnline(true); }
    catch (error) { setOnline(false); if (!quiet) showError(error); if (error instanceof Error && error.message.includes("Sitzung")) { localStorage.removeItem("gameson:werewolf:session"); setSession(null); setState(null); window.history.replaceState({}, "", "/werwolf"); } }
  }, [session, showError]);
  useEffect(() => { if (!session) return; const first = setTimeout(() => fetchState(), 0); const timer = setInterval(() => fetchState(true), document.hidden ? 5000 : 1500); return () => { clearTimeout(first); clearInterval(timer); }; }, [session, fetchState]);
  const post = useCallback(async (action: string, values: Record<string, unknown> = {}) => { if (!session) return; setBusy(true); try { await api("/api/werwolf", { method: "POST", headers: { Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ action, lobbyId: session.lobbyId, ...values }) }); await fetchState(); } catch (error) { showError(error); } finally { setBusy(false); } }, [session, fetchState, showError]);
  const leave = async () => {
    if (state?.me.isHost && (state.lobby.status === "waiting" || state.lobby.status === "results")) {
      const message = state.lobby.status === "results" ? "Lobby beenden und alle Spieldaten löschen?" : "Dorf schließen? Alle Mitspieler werden getrennt.";
      if (!window.confirm(message)) return;
      if (session) {
        setBusy(true);
        try { await api("/api/werwolf", { method: "POST", headers: { Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ action: "close", lobbyId: session.lobbyId }) }); }
        catch (error) { showError(error); setBusy(false); return; }
        setBusy(false);
      }
    } else if (state?.lobby.status === "playing" && !window.confirm("Werwolf-Partie wirklich verlassen? Deine Rolle bleibt in der Lobby.")) return;
    localStorage.removeItem("gameson:werewolf:session"); setSession(null); setState(null); window.history.replaceState({}, "", "/werwolf");
  };

  if (session) return <OnlineGame state={state} session={session} online={online} busy={busy} post={post} leave={leave} showError={showError} />;
  if (screen === "create") return <LobbyForm kind="create" onBack={() => setScreen("home")} onDone={setSession} showError={showError} />;
  if (screen === "join") return <LobbyForm kind="join" nearby={nearby} inviteLobbyId={inviteLobbyId} onPick={setInviteLobbyId} onBack={() => { setInviteLobbyId(""); setScreen("home"); window.history.replaceState({}, "", "/werwolf"); }} onDone={setSession} showError={showError} />;
  if (screen === "local") return <LocalWerewolf onBack={() => setScreen("home")} showError={showError} />;

  return <main className="werewolf-home">
    <div className="night-haze" aria-hidden="true" />
    {/* Hosted vinext navigation currently requires a full page load between game routes. */}
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
    <a className="collection-back light-back" href="/">← Gameson</a>
    <header className="wolf-brand-row"><div className="wolf-brand"><WolfMark /><span>WERWOLF<small>Ein Gameson-Spiel</small></span></div><Connection online={online} /></header>
    <section className="wolf-hero"><span className="wolf-kicker">Wenn das Dorf schläft, beginnt die Jagd.</span><h1>WER<br />WOLF</h1><p>Findet das Rudel, bevor die Nacht euch verschlingt. Die App führt euch durch jede Rolle.</p></section>
    <section className="wolf-mode-panel" aria-label="Spielmodus auswählen">
      <button onClick={() => setScreen("create")}><i>◉</i><span><strong>Lobby erstellen</strong><small>Jede Person mit eigenem Handy</small></span><b>→</b></button>
      <button onClick={() => setScreen("join")}><i>↗</i><span><strong>Lobby beitreten</strong><small>{nearby.length ? `${nearby.length} ${nearby.length === 1 ? "Dorf" : "Dörfer"} in deiner Nähe` : "Per Name, Link oder QR-Code"}</small></span><b>→</b></button>
      <button onClick={() => setScreen("local")}><i>▣</i><span><strong>Ein Gerät</strong><small>Handy weiterreichen · ab 3 Personen</small></span><b>→</b></button>
    </section>
    {notice && <Notice message={notice} clear={() => setNotice("")} />}
  </main>;
}

function LobbyForm({ kind, nearby = [], inviteLobbyId = "", onPick, onBack, onDone, showError }: { kind: "create" | "join"; nearby?: NearbyLobby[]; inviteLobbyId?: string; onPick?: (id: string) => void; onBack: () => void; onDone: (session: Session) => void; showError: (error: unknown) => void }) {
  const [groupName, setGroupName] = useState(""); const [playerName, setPlayerName] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); try { onDone(await api<Session>("/api/werwolf", { method: "POST", body: JSON.stringify({ action: kind, groupName, playerName, lobbyId: inviteLobbyId || undefined }) })); } catch (error) { showError(error); } finally { setBusy(false); } };
  return <main className="app-shell werewolf-shell"><WolfTopbar title={kind === "create" ? "Neues Dorf" : "Dorf beitreten"} onBack={onBack} /><section className="page-intro"><span className="step-label wolf-step">01 · {kind === "create" ? "Versammeln" : "Beitreten"}</span><h2>{kind === "create" ? "Gebt eurem Dorf einen Namen." : inviteLobbyId ? "Du wurdest ins Dorf gerufen." : "Finde dein Dorf."}</h2><p>Keine Konten – nur ein Name für diese Runde.</p></section>{kind === "join" && !inviteLobbyId && nearby.length > 0 && <section className="nearby-section"><div className="section-heading"><strong>In deiner Nähe</strong><span>automatisch erkannt</span></div><div className="nearby-list">{nearby.map((item) => <button key={item.id} onClick={() => onPick?.(item.id)}><span className="nearby-pulse" /><span><strong>{item.name}</strong><small>{item.player_count} Personen</small></span><b>→</b></button>)}</div></section>}<form className="form-card wolf-form" onSubmit={submit}>{(kind === "create" || !inviteLobbyId) && <label>Dorfname<input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="z. B. Mondhain" maxLength={28} /></label>}<label>Dein Name<input value={playerName} onChange={(event) => setPlayerName(event.target.value)} placeholder="z. B. Robin" maxLength={24} autoComplete="nickname" /></label><button className="primary-button wolf-primary" disabled={busy}>{busy ? "Wird verbunden …" : kind === "create" ? "Dorf gründen →" : "Dorf betreten →"}</button></form></main>;
}

function OnlineGame({ state, session, online, busy, post, leave, showError }: { state: LobbyState | null; session: Session; online: boolean; busy: boolean; post: (action: string, values?: Record<string, unknown>) => Promise<void>; leave: () => void; showError: (error: unknown) => void }) {
  const [inviteOpen, setInviteOpen] = useState(false); const [settingsOpen, setSettingsOpen] = useState(false); const [roleOpen, setRoleOpen] = useState(false); const [qr, setQr] = useState("");
  const [audioReady, setAudioReady] = useState(false); const playedCue = useRef(""); const playedWinnerCue = useRef(""); const announcedNight = useRef(""); const announcedInitialSleep = useRef(false);
  const shareUrl = typeof window === "undefined" ? "" : `${window.location.origin}/werwolf?lobby=${session.lobbyId}`;
  useEffect(() => { if (shareUrl) QRCode.toDataURL(shareUrl, { width: 420, margin: 1, color: { dark: "#1a1119", light: "#f5efe6" } }).then(setQr).catch(() => undefined); }, [shareUrl]);
  const enableAudio = useCallback(async () => { try { await unlockWerewolfAudio(); setAudioReady(true); } catch (error) { showError(error); } }, [showError]);
  useEffect(() => {
    if (!state || !audioReady || state.lobby.status !== "playing" || !SECRET_AUDIO_PHASES.includes(state.lobby.phase)) return;
    if (state.lobby.audioMode === "host" && !state.me.isHost) return;
    const cueKey = `${state.lobby.matchNumber}:${state.lobby.night}:${state.lobby.phase}:${state.lobby.phaseStartedAt}`;
    if (playedCue.current === cueKey) return;
    playedCue.current = cueKey;
    const delay = state.lobby.phaseStartedAt + 1800 - state.serverTime;
    const nightKey = `${state.lobby.matchNumber}:${state.lobby.night}`;
    let transition: "sleep-all" | "sleep-again" | "night-start" | "day-start" | null = null;
    if (state.lobby.phase === "dawn") transition = "day-start";
    else if (state.lobby.phase !== "mayor_vote" && state.lobby.phase !== "hunter") {
      if (state.lobby.night > 0 && announcedNight.current !== nightKey) {
        announcedNight.current = nightKey;
        transition = "night-start";
      } else if (state.lobby.night === 0 && !announcedInitialSleep.current) {
        announcedInitialSleep.current = true;
        transition = "sleep-all";
      } else transition = "sleep-again";
    }
    playWerewolfPhaseCue(state.lobby.phase, Math.max(0, delay), transition);
  }, [audioReady, state]);
  useEffect(() => {
    if (!state || !audioReady || state.lobby.status !== "results" || !state.lobby.winner) return;
    if (state.lobby.audioMode === "host" && !state.me.isHost) return;
    const cueKey = `${state.lobby.matchNumber}:${state.lobby.winner}:${state.lobby.phaseStartedAt}`;
    if (playedWinnerCue.current === cueKey) return;
    playedWinnerCue.current = cueKey;
    const delay = state.lobby.phaseStartedAt + 1800 - state.serverTime;
    playWerewolfWinnerCue(state.lobby.winner, Math.max(0, delay));
  }, [audioReady, state]);
  if (!state) return <main className="app-shell werewolf-shell center-shell"><div className="loader" /><p>Das Dorf wird geöffnet …</p></main>;
  const mayor = state.players.find((player) => player.id === state.lobby.mayorPlayerId);
  const shouldPlayHere = state.lobby.audioMode === "all" || state.me.isHost;
  return <main className="app-shell werewolf-shell"><WolfTopbar title={state.lobby.name} onBack={leave} online={online} />
    {state.lobby.status === "waiting" ? <WaitingRoom state={state} busy={busy} post={post} invite={() => setInviteOpen(true)} settings={() => setSettingsOpen(true)} audioReady={audioReady} enableAudio={enableAudio} /> : <><GamePhase state={state} busy={busy} post={post} close={leave} openRole={() => setRoleOpen(true)} mayorName={mayor?.name ?? null} />{shouldPlayHere && !audioReady && <button className="game-audio-enable" type="button" onClick={() => void enableAudio()}>♪ Spielton aktivieren</button>}</>}
    {state.canClaimHost && <button className="claim-host" onClick={() => post("claim_host")}>Host ist weg · Leitung übernehmen</button>}
    {inviteOpen && <InviteSheet qr={qr} name={state.lobby.name} url={shareUrl} close={() => setInviteOpen(false)} showError={showError} />}
    {settingsOpen && <OnlineSettings state={state} busy={busy} post={post} close={() => setSettingsOpen(false)} />}
    {roleOpen && state.privateRole && <RoleSheet role={state.privateRole} close={() => setRoleOpen(false)} />}
  </main>;
}

function WaitingRoom({ state, busy, post, invite, settings, audioReady, enableAudio }: { state: LobbyState; busy: boolean; post: (action: string, values?: Record<string, unknown>) => Promise<void>; invite: () => void; settings: () => void; audioReady: boolean; enableAudio: () => Promise<void> }) {
  const playsHere = state.lobby.audioMode === "all" || state.me.isHost;
  return <><section className="lobby-hero wolf-lobby-hero"><span className="step-label wolf-step">Warteraum</span><h2>Das Dorf füllt sich.</h2><p>Mindestens drei Personen – kleine Runden sind ausdrücklich willkommen.</p><button className="invite-button" onClick={invite}>+ Personen einladen</button></section><section className="player-section"><div className="section-heading"><strong>{state.players.length} Personen</strong><span>{state.players.length < 3 ? `${3 - state.players.length} fehlen noch` : "bereit"}</span></div><div className="player-grid">{state.players.map((player, index) => <div className="player-chip" key={player.id}><span className={`avatar avatar-${index % 5}`}>{player.name.charAt(0)}</span><span><strong>{player.name}</strong><small>{player.isHost ? "Host" : player.online ? "bereit" : "offline"}</small></span>{state.me.isHost && !player.isHost && <button onClick={() => post("remove", { playerId: player.id })}>×</button>}</div>)}</div></section><section className={`wolf-audio-card ${audioReady ? "ready" : ""}`}><span aria-hidden="true">♪</span><div><strong>Akustische Spielleitung</strong><small>{playsHere ? audioReady ? "Spielton ist bereit · jede Rolle hat ein eigenes Signal" : "Einmal antippen, damit dein Browser Spieltöne erlaubt" : "Der Host spielt die Signale für diese Runde ab"}</small></div>{playsHere && <button type="button" disabled={audioReady} onClick={() => void enableAudio()}>{audioReady ? "Bereit ✓" : "Ton aktivieren"}</button>}</section>{state.me.isHost ? <div className="host-actions"><button className="secondary-button" onClick={settings}>Rollen &amp; Regeln</button><button className="primary-button wolf-primary" disabled={busy || state.players.length < 3} onClick={() => post("start")}>Partie starten →</button></div> : <p className="waiting-copy">Der Host stellt die Rollen zusammen.</p>}</>;
}

function GamePhase({ state, busy, post, close, openRole, mayorName }: { state: LobbyState; busy: boolean; post: (action: string, values?: Record<string, unknown>) => Promise<void>; close: () => void; openRole: () => void; mayorName: string | null }) {
  const copy = PHASE_COPY[state.lobby.phase]; const dead = state.players.filter((player) => !player.alive); const isPassive = ["dawn", "discussion", "results"].includes(state.lobby.phase);
  return <section className={`wolf-phase phase-${state.lobby.phase}`}><div className="phase-moon" aria-hidden="true">{state.lobby.phase === "discussion" || state.lobby.phase === "day_vote" ? "☀" : "☾"}</div><div className="page-intro"><span className="step-label wolf-step">{state.lobby.night ? `Nacht ${state.lobby.night}` : "Vor der ersten Nacht"} · {state.progress.submitted}/{state.progress.required}</span><h2>{copy.title}</h2><p>{copy.text}</p></div>{state.privateRole && <button className="my-role-button" onClick={openRole}><span>{ROLE_INFO[state.privateRole.role].label.charAt(0)}</span><b>Meine Rolle</b><small>{state.me.alive ? "privat ansehen" : "ausgeschieden"}</small><i>→</i></button>}{mayorName && <p className="public-status">Bürgermeister: <strong>{mayorName}</strong> · doppelte Stimme</p>}
    {state.lobby.phase === "dawn" && <DeathBoard players={dead} />}
    {state.lobby.phase === "results" ? <ResultsBoard state={state} post={post} close={close} busy={busy} /> : state.action ? <ActionPanel key={state.lobby.phase} state={state} busy={busy} post={post} /> : !isPassive ? <div className="night-wait"><i /><p>{state.me.alive ? "Eine andere Rolle ist gerade an der Reihe." : "Du schaust dieser Partie als Geist zu."}</p><small>{state.progress.submitted} von {state.progress.required} Aktionen abgeschlossen</small></div> : null}
    {state.me.isHost && state.lobby.phase === "dawn" && <button className="primary-button wolf-primary" onClick={() => post("advance")}>Weiter →</button>}{state.me.isHost && state.lobby.phase === "discussion" && <button className="primary-button wolf-primary" onClick={() => post("advance")}>Abstimmung starten →</button>}{state.canSkip && <button className="secondary-button skip-phase" onClick={() => post("skip")}>Ausstehende Aktion überspringen</button>}
  </section>;
}

function ActionPanel({ state, busy, post }: { state: LobbyState; busy: boolean; post: (action: string, values?: Record<string, unknown>) => Promise<void> }) {
  const action = state.action!; const [first, setFirst] = useState(""); const [second, setSecond] = useState(""); const [heal, setHeal] = useState(false);
  if (state.ownSubmission) return <div className="action-card submitted-action"><span>✓</span><h3>Deine Entscheidung steht.</h3>{state.actionResult?.seenLabel && <p>{state.actionResult.name} ist <strong>{state.actionResult.seenLabel}</strong>.</p>}<small>Warte, bis alle ihre geheime Aktion abgeschlossen haben.</small></div>;
  if (action.phase === "thief") return <div className="action-card"><h3>Welche Rolle behältst du?</h3><div className="role-choice-grid">{["thief", ...(state.privateRole?.reserveRoles ?? [])].map((role, index) => <button key={`${role}-${index}`} onClick={() => post("act", { phase: action.phase, matchNumber: state.lobby.matchNumber, choice: role })}><strong>{ROLE_INFO[role as WerewolfRole].label}</strong><small>{index ? "Verdeckte Reserve" : "Eigene Rolle"}</small></button>)}</div></div>;
  if (action.phase === "witch") {
    const victim = state.players.find((player) => player.id === action.wolfVictimId);
    return <div className="action-card"><h3>Die Tränke der Hexe</h3><p>{victim ? `Das Rudel hat ${victim.name} gewählt.` : "Das Rudel hat kein Opfer gefunden."}</p>{action.canHeal && victim && <div className="switch-row compact-switch"><span><strong>{victim.name} heilen</strong><small>Heiltrank einmalig einsetzen</small></span><input id="online-witch-heal" aria-label={`${victim.name} heilen`} type="checkbox" checked={heal} onChange={(event) => setHeal(event.target.checked)} /><i /></div>}{action.canPoison && <div className="select-field"><span>Gifttrank</span><select id="online-witch-poison" aria-label="Ziel für den Gifttrank" value={second} onChange={(event) => setSecond(event.target.value)}><option value="">Niemanden vergiften</option>{action.candidates.filter((candidate) => !heal || candidate.id !== action.wolfVictimId).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></div>}<button className="primary-button wolf-primary" disabled={busy} onClick={() => post("act", { phase: action.phase, matchNumber: state.lobby.matchNumber, heal, target2Id: second || undefined })}>Entscheidung bestätigen</button></div>;
  }
  const isVote = ["mayor_vote", "wolves", "day_vote", "runoff"].includes(action.phase); const multi = action.maxTargets === 2; const canPass = action.phase === "white_werewolf";
  const toggle = (id: string) => { if (first === id) { setFirst(second); setSecond(""); } else if (second === id) setSecond(""); else if (!first) setFirst(id); else if (multi) setSecond(id); else setFirst(id); };
  return <div className="action-card"><h3>{multi ? "Wähle bis zu zwei Personen" : "Wähle eine Person"}</h3><div className="target-list">{action.candidates.map((candidate) => <button className={first === candidate.id || second === candidate.id ? "selected" : ""} key={candidate.id} onClick={() => toggle(candidate.id)}><span>{candidate.name.charAt(0)}</span><strong>{candidate.name}</strong><i>{first === candidate.id || second === candidate.id ? "✓" : ""}</i></button>)}</div><button className="primary-button wolf-primary" disabled={busy || (!first && !canPass)} onClick={() => post(isVote ? "vote" : "act", { phase: action.phase, matchNumber: state.lobby.matchNumber, targetId: first || undefined, target2Id: second || undefined })}>{canPass && !first ? "Diese Nacht passen" : "Entscheidung bestätigen"}</button></div>;
}

function DeathBoard({ players }: { players: PlayerView[] }) { return <div className="death-board"><h3>{players.length ? "Diese Rollen sind gefallen" : "Noch lebt das ganze Dorf"}</h3>{players.length ? players.map((player) => <div key={player.id}><span>{player.name.charAt(0)}</span><strong>{player.name}</strong><small>{player.role ? ROLE_INFO[player.role].label : "Unbekannt"}</small></div>) : <p>In dieser Auflösung ist niemand ausgeschieden.</p>}</div>; }
function ResultsBoard({ state, post, close, busy }: { state: LobbyState; post: (action: string) => Promise<void>; close: () => void; busy: boolean }) { return <div className="wolf-results"><span className="result-stamp">Entschieden</span><h3>{WINNER_COPY[state.lobby.winner ?? ""] ?? "Die Partie endet"}</h3><div className="role-reveal-list">{state.players.map((player) => <div key={player.id} className={player.alive ? "survivor" : ""}><span>{player.name.charAt(0)}</span><strong>{player.name}</strong><small>{player.role ? ROLE_INFO[player.role].label : "Unbekannt"}</small></div>)}</div>{state.me.isHost ? <><button className="primary-button wolf-primary" disabled={busy} onClick={() => post("new_match")}>Neue Partie vorbereiten →</button><button className="secondary-button" disabled={busy} onClick={close}>Lobby beenden</button></> : <p className="waiting-copy">Der Host kann eine neue Partie vorbereiten.</p>}</div>; }

function InviteSheet({ qr, name, url, close, showError }: { qr: string; name: string; url: string; close: () => void; showError: (error: unknown) => void }) { const share = async () => { try { if (navigator.share) await navigator.share({ title: `Werwolf-Dorf ${name}`, text: `Komm in unser Werwolf-Dorf „${name}“`, url }); else await navigator.clipboard.writeText(url); } catch (error) { if ((error as Error).name !== "AbortError") showError(error); } }; return <div className="sheet-backdrop"><section className="bottom-sheet invite-sheet wolf-sheet"><button className="sheet-close" onClick={close}>×</button><span className="step-label wolf-step">Einladen</span><h3>Ruft das Dorf zusammen.</h3>{qr && <Image src={qr} alt={`QR-Code für ${name}`} width={300} height={300} unoptimized />}<strong className="group-code">{name}</strong><button className="primary-button wolf-primary" onClick={share}>Einladung teilen</button></section></div>; }
function RoleSheet({ role, close }: { role: PrivateRole; close: () => void }) { return <div className="sheet-backdrop"><section className="bottom-sheet wolf-sheet role-sheet"><button className="sheet-close" onClick={close}>×</button><span className="step-label wolf-step">Nur für dich</span><div className={`role-orb team-${role.team}`}>{role.label.charAt(0)}</div><h3>{role.label}</h3><p>{role.description}</p><div className="role-facts"><span><b>Team</b>{role.team === "village" ? "Dorf" : role.team === "wolf" ? "Rudel" : "Eigenes Ziel"}</span>{role.lover && <span><b>Verliebt mit</b>{role.lover}</span>}{role.roleModel && <span><b>Vorbild</b>{role.roleModel}</span>}{role.charmed && <span><b>Status</b>Verzaubert</span>}{role.role === "witch" && <span><b>Tränke</b>{role.healPotion ? "Heilung bereit" : "Heilung verbraucht"} · {role.poisonPotion ? "Gift bereit" : "Gift verbraucht"}</span>}{role.role === "elder" && <span><b>Wolfsangriff</b>{role.elderShield ? "Schutz ist bereit" : "Schutz verbraucht"}</span>}</div><button className="primary-button wolf-primary" onClick={close}>Verstanden</button></section></div>; }

function RoleSelector({ count, wolves, roles, setRoles }: { count: number; wolves: number; roles: WerewolfRole[]; setRoles: (roles: WerewolfRole[]) => void }) {
  const toggle = (role: WerewolfRole) => { if (roles.includes(role)) return setRoles(roles.filter((item) => item !== role)); const next = [...roles, role]; if (!validateRoleSetup(Math.max(3, count), wolves, next)) setRoles(next); };
  return <div className="role-selector">{SELECTABLE_ROLES.map((role) => { const min = minimumPlayersForRole(role); const selected = roles.includes(role); const unavailable = count < min || (role === "white_werewolf" && wolves < 2) || (!selected && Boolean(validateRoleSetup(Math.max(3, count), wolves, [...roles, role]))); return <button type="button" key={role} className={selected ? "selected" : ""} disabled={unavailable && !selected} onClick={() => toggle(role)}><span>{ROLE_INFO[role].label.charAt(0)}</span><b>{ROLE_INFO[role].label}</b><small>{unavailable && !selected ? `ab ${min}` : ROLE_INFO[role].team === "solo" ? "eigenes Ziel" : ROLE_INFO[role].team === "wolf" ? "Rudel" : "Dorf"}</small><i>{selected ? "✓" : "+"}</i></button>; })}</div>;
}

function OnlineSettings({ state, busy, post, close }: { state: LobbyState; busy: boolean; post: (action: string, values?: Record<string, unknown>) => Promise<void>; close: () => void }) {
  const count = state.players.length;
  const [wolves, setWolves] = useState(Math.min(state.lobby.wolfCount, maxWolfCount(Math.max(3, count))));
  const [roles, setRoles] = useState(state.lobby.selectedRoles);
  const [mayor, setMayor] = useState(state.lobby.mayorEnabled);
  const [discoverable, setDiscoverable] = useState(state.lobby.discoverable);
  const [audioMode, setAudioMode] = useState<"all" | "host">(state.lobby.audioMode);
  const save = async () => { await post("settings", { wolfCount: wolves, selectedRoles: roles, mayorEnabled: mayor, discoverable, audioMode }); close(); };
  return <div className="sheet-backdrop"><section className="bottom-sheet settings-sheet wolf-sheet"><button className="sheet-close" onClick={close}>×</button><span className="step-label wolf-step">Rollen &amp; Regeln</span><h3>Wer lebt in eurem Dorf?</h3><div className="settings-row"><span><strong>Wolfsslots</strong><small>Standard: {defaultWolfCount(Math.max(3, count))}</small></span><Stepper value={wolves} min={1} max={maxWolfCount(Math.max(3, count))} onChange={(value) => { setWolves(value); if (value < 2) setRoles(roles.filter((role) => role !== "white_werewolf")); }} /></div><div className="settings-block"><span className="settings-label">Zusatzrollen · Mehrfachauswahl</span><RoleSelector count={count} wolves={wolves} roles={roles} setRoles={setRoles} /></div><div className="settings-block"><span className="settings-label">Akustische Spielleitung</span><div className="segmented audio-mode-choice"><button type="button" className={audioMode === "all" ? "active" : ""} onClick={() => setAudioMode("all")}><strong>Alle Geräte</strong><small>gleichzeitig · Rollen bleiben unortbar</small></button><button type="button" className={audioMode === "host" ? "active" : ""} onClick={() => setAudioMode("host")}><strong>Nur Host</strong><small>ein zentraler Spielleiter-Ton</small></button></div></div><div className="switch-row"><span><strong>Bürgermeister wählen</strong><small>Öffentlich · Stimme zählt doppelt</small></span><input id="online-mayor" aria-label="Bürgermeister wählen" type="checkbox" checked={mayor} onChange={(event) => setMayor(event.target.checked)} /><i /></div><div className="switch-row"><span><strong>In der Nähe sichtbar</strong><small>Zeigt das Dorf im gleichen Netz</small></span><input id="online-discoverable" aria-label="In der Nähe sichtbar" type="checkbox" checked={discoverable} onChange={(event) => setDiscoverable(event.target.checked)} /><i /></div><button className="primary-button wolf-primary" disabled={busy || Boolean(validateRoleSetup(Math.max(3, count), wolves, roles))} onClick={save}>Einstellungen übernehmen</button></section></div>;
}

type LocalPlayer = { id: string; name: string; role: WerewolfRole; team: WerewolfTeam; alive: boolean; loverId: string | null; roleModelId: string | null; charmed: boolean; elderShield: boolean; healPotion: boolean; poisonPotion: boolean; lastProtectedId: string | null };
type LocalTurn = { kind: WerewolfPhase; actorId: string; candidates?: string[] };
type LocalDraft = { votes: { voterId: string; targetId: string }[]; wolfVotes: { voterId: string; targetId: string }[]; healId: string | null; witchHeal: boolean; poisonId: string | null; whiteId: string | null };
const EMPTY_DRAFT: LocalDraft = { votes: [], wolfVotes: [], healId: null, witchHeal: false, poisonId: null, whiteId: null };

function LocalWerewolf({ onBack, showError }: { onBack: () => void; showError: (error: unknown) => void }) {
  const [phase, setPhase] = useState<"setup" | "reveal" | "turn" | "dawn" | "discussion" | "results">("setup"); const [names, setNames] = useState(["", "", ""]); const [wolves, setWolves] = useState(1); const [roles, setRoles] = useState<WerewolfRole[]>([]); const [mayorEnabled, setMayorEnabled] = useState(true);
  const [players, setPlayers] = useState<LocalPlayer[]>([]); const [mayorId, setMayorId] = useState<string | null>(null); const [night, setNight] = useState(0); const [revealIndex, setRevealIndex] = useState(0); const [ready, setReady] = useState(false); const [queue, setQueue] = useState<LocalTurn[]>([]); const [turnIndex, setTurnIndex] = useState(0); const [purpose, setPurpose] = useState<"mayor" | "initial" | "night" | "day" | "runoff" | "hunter">("initial"); const [draft, setDraft] = useState<LocalDraft>(EMPTY_DRAFT); const [first, setFirst] = useState(""); const [second, setSecond] = useState(""); const [witchHeal, setWitchHeal] = useState(false); const [resolutionSource, setResolutionSource] = useState<"night" | "day">("night"); const [winner, setWinner] = useState<Winner>(null); const [infoOpen, setInfoOpen] = useState(false); const [infoPlayer, setInfoPlayer] = useState("");
  const [audioReady, setAudioReady] = useState(false); const localCue = useRef(""); const localWinnerCue = useRef(""); const localAnnouncedNight = useRef(""); const localInitialSleep = useRef(false);
  useEffect(() => { const timer = setTimeout(() => { try { const stored = localStorage.getItem("gameson:werewolf:local-names"); if (stored) { const parsed = JSON.parse(stored); if (Array.isArray(parsed) && parsed.length >= 3) setNames(parsed); } } catch { /* ignore */ } }, 0); return () => clearTimeout(timer); }, []);
  useEffect(() => { localStorage.setItem("gameson:werewolf:local-names", JSON.stringify(names)); }, [names]);
  useEffect(() => {
    const cue = phase === "turn" ? queue[turnIndex]?.kind : phase === "dawn" ? "dawn" : null;
    if (!audioReady || !cue || !SECRET_AUDIO_PHASES.includes(cue)) return;
    const cueKey = `${night}:${purpose}:${cue}`;
    if (localCue.current === cueKey) return;
    localCue.current = cueKey;
    const nightKey = `local:${night}`;
    let transition: "sleep-all" | "sleep-again" | "night-start" | "day-start" | null = null;
    if (cue === "dawn") transition = "day-start";
    else if (cue !== "mayor_vote" && cue !== "hunter") {
      if (night > 0 && localAnnouncedNight.current !== nightKey) {
        localAnnouncedNight.current = nightKey;
        transition = "night-start";
      } else if (night === 0 && !localInitialSleep.current) {
        localInitialSleep.current = true;
        transition = "sleep-all";
      } else transition = "sleep-again";
    }
    playWerewolfPhaseCue(cue, 120, transition);
  }, [audioReady, night, phase, purpose, queue, turnIndex]);
  useEffect(() => {
    if (!audioReady || phase !== "results" || !winner) return;
    const cueKey = `${night}:${winner}`;
    if (localWinnerCue.current === cueKey) return;
    localWinnerCue.current = cueKey;
    playWerewolfWinnerCue(winner, 120);
  }, [audioReady, night, phase, winner]);
  const validNames = names.map((name) => name.trim()).filter(Boolean); const maxWolves = maxWolfCount(Math.max(3, validNames.length)); const effectiveWolves = Math.min(wolves, maxWolves);

  const beginQueue = (turns: LocalTurn[], nextPurpose: typeof purpose, nextPlayers = players, nextDraft = EMPTY_DRAFT) => { setPlayers(nextPlayers); setQueue(turns); setPurpose(nextPurpose); setTurnIndex(0); setDraft(nextDraft); setFirst(""); setSecond(""); setReady(false); setPhase("turn"); if (!turns.length) finishQueue(nextPurpose, nextPlayers, nextDraft); };
  const start = () => { if (validNames.length < 3) return showError(new Error("Füge mindestens drei Namen hinzu.")); if (new Set(validNames.map((name) => name.toLocaleLowerCase("de"))).size !== validNames.length) return showError(new Error("Jeder Name darf nur einmal vorkommen.")); const error = validateRoleSetup(validNames.length, effectiveWolves, roles); if (error) return showError(new Error(error)); void unlockWerewolfAudio().then(() => setAudioReady(true)).catch(showError); localCue.current = ""; localWinnerCue.current = ""; localAnnouncedNight.current = ""; localInitialSleep.current = false; const deck = buildRoleDeck(validNames.length, effectiveWolves, roles, randomIndex); const next = validNames.map((name, index) => { const role = deck[index]; return { id: crypto.randomUUID(), name, role, team: roleTeam(role), alive: true, loverId: null, roleModelId: null, charmed: false, elderShield: role === "elder", healPotion: role === "witch", poisonPotion: role === "witch", lastProtectedId: null }; }); setPlayers(next); setMayorId(null); setNight(0); setWinner(null); setRevealIndex(0); setReady(false); setPhase("reveal"); };
  const initialTurns = (list: LocalPlayer[]) => (["thief", "cupid", "wild_child"] as WerewolfPhase[]).flatMap((kind) => list.filter((player) => player.alive && player.role === kind).map((player) => ({ kind, actorId: player.id })));
  const mayorTurns = (list: LocalPlayer[]) => list.filter((player) => player.alive).map((player) => ({ kind: "mayor_vote" as const, actorId: player.id }));
  const startAfterReveal = () => mayorEnabled ? beginQueue(mayorTurns(players), "mayor", players) : beginQueue(initialTurns(players), "initial", players);
  const startNight = (list = players) => { const nextNight = night + 1; setNight(nextNight); const living = list.filter((player) => player.alive); const turns: LocalTurn[] = []; const addRole = (kind: WerewolfPhase, role: WerewolfRole) => { const actor = living.find((player) => player.role === role); if (actor) turns.push({ kind, actorId: actor.id }); }; addRole("healer", "healer"); addRole("seer", "seer"); living.filter((player) => player.team === "wolf" || player.role === "white_werewolf").forEach((player) => turns.push({ kind: "wolves", actorId: player.id })); addRole("witch", "witch"); if (nextNight % 2 === 0) addRole("white_werewolf", "white_werewolf"); addRole("piper", "piper"); beginQueue(turns, "night", list, EMPTY_DRAFT); };
  const startDayVote = (list = players, runoffCandidates?: string[]) => { const living = list.filter((player) => player.alive); beginQueue(living.map((player) => ({ kind: runoffCandidates ? "runoff" as const : "day_vote" as const, actorId: player.id, candidates: runoffCandidates })), runoffCandidates ? "runoff" : "day", list, EMPTY_DRAFT); };
  const finalizeDeaths = (list: LocalPlayer[], source: "night" | "day") => { const dead = new Set(list.filter((player) => !player.alive).map((player) => player.id)); const transformed = list.map((player) => player.alive && player.role === "wild_child" && player.roleModelId && dead.has(player.roleModelId) ? { ...player, team: "wolf" as const } : player); if (mayorId && dead.has(mayorId)) setMayorId(null); const outcome = determineWinner(transformed); setPlayers(transformed); if (outcome) { setWinner(outcome); setPhase("results"); } else { setResolutionSource(source); setPhase("dawn"); } };
  const killLocal = (list: LocalPlayer[], ids: string[], source: "night" | "day", afterHunter = false) => { const deaths = new Set(ids); let changed = true; while (changed) { changed = false; for (const id of [...deaths]) { const lover = list.find((player) => player.id === id)?.loverId; if (lover && list.find((player) => player.id === lover)?.alive && !deaths.has(lover)) { deaths.add(lover); changed = true; } } } const next = list.map((player) => deaths.has(player.id) ? { ...player, alive: false } : player); const hunter = [...deaths].map((id) => next.find((player) => player.id === id)).find((player) => player?.role === "hunter"); if (hunter && !afterHunter) { setResolutionSource(source); beginQueue([{ kind: "hunter", actorId: hunter.id }], "hunter", next, EMPTY_DRAFT); } else finalizeDeaths(next, source); };
  const resolveNight = (list: LocalPlayer[], result: LocalDraft) => { const leaders = weightedVoteLeaders(result.wolfVotes, null).leaders; const victimId = leaders.length ? leaders[randomIndex(leaders.length)] : null; let next = list; const deaths: string[] = []; if (victimId && victimId !== result.healId && !result.witchHeal) { const victim = next.find((player) => player.id === victimId); if (victim?.role === "elder" && victim.elderShield) next = next.map((player) => player.id === victimId ? { ...player, elderShield: false } : player); else deaths.push(victimId); } if (result.poisonId) deaths.push(result.poisonId); if (result.whiteId) deaths.push(result.whiteId); killLocal(next, [...new Set(deaths)], "night"); };
  function finishQueue(donePurpose: typeof purpose, list: LocalPlayer[], result: LocalDraft) { if (donePurpose === "mayor") { const leaders = weightedVoteLeaders(result.votes, null).leaders; setMayorId(leaders.length ? leaders[randomIndex(leaders.length)] : list.find((player) => player.alive)?.id ?? null); if (night === 0) beginQueue(initialTurns(list), "initial", list); else startDayVote(list); } else if (donePurpose === "initial") startNight(list); else if (donePurpose === "night") resolveNight(list, result); else if (donePurpose === "day") { const leaders = weightedVoteLeaders(result.votes, mayorId).leaders; if (leaders.length === 1) killLocal(list, leaders, "day"); else if (leaders.length > 1) startDayVote(list, leaders); else killLocal(list, [], "day"); } else if (donePurpose === "runoff") { const leaders = weightedVoteLeaders(result.votes, mayorId).leaders; if (leaders.length === 1) killLocal(list, leaders, "day"); else { const scapegoat = list.find((player) => player.alive && player.role === "scapegoat"); killLocal(list, scapegoat ? [scapegoat.id] : [], "day"); } } else if (donePurpose === "hunter") killLocal(list, result.whiteId ? [result.whiteId] : [], resolutionSource, true); }
  const submitTurn = () => { const turn = queue[turnIndex]; const actor = players.find((player) => player.id === turn.actorId)!; let nextPlayers = players.map((player) => ({ ...player })); const nextDraft: LocalDraft = { ...draft, votes: [...draft.votes], wolfVotes: [...draft.wolfVotes] }; const requireFirst = !["witch", "white_werewolf"].includes(turn.kind); if (requireFirst && !first) return showError(new Error("Wähle zuerst eine Person oder Rolle."));
    if (turn.kind === "mayor_vote" || turn.kind === "day_vote" || turn.kind === "runoff") nextDraft.votes.push({ voterId: actor.id, targetId: first });
    else if (turn.kind === "wolves") nextDraft.wolfVotes.push({ voterId: actor.id, targetId: first });
    else if (turn.kind === "thief") { const role = first as WerewolfRole; nextPlayers = nextPlayers.map((player) => player.id === actor.id ? { ...player, role, team: roleTeam(role) } : player); }
    else if (turn.kind === "cupid") { if (!second || first === second) return showError(new Error("Amor verbindet zwei unterschiedliche Personen.")); nextPlayers = nextPlayers.map((player) => player.id === first ? { ...player, loverId: second } : player.id === second ? { ...player, loverId: first } : player); }
    else if (turn.kind === "wild_child") nextPlayers = nextPlayers.map((player) => player.id === actor.id ? { ...player, roleModelId: first } : player);
    else if (turn.kind === "healer") { nextDraft.healId = first; nextPlayers = nextPlayers.map((player) => player.id === actor.id ? { ...player, lastProtectedId: first } : player); }
    else if (turn.kind === "seer") { const target = nextPlayers.find((player) => player.id === first); window.alert(`${target?.name} ist ${target ? ROLE_INFO[target.role].label : "unbekannt"}.`); }
    else if (turn.kind === "witch") { nextDraft.witchHeal = witchHeal; nextDraft.poisonId = second || null; nextPlayers = nextPlayers.map((player) => player.id === actor.id ? { ...player, healPotion: witchHeal ? false : player.healPotion, poisonPotion: second ? false : player.poisonPotion } : player); }
    else if (turn.kind === "white_werewolf") nextDraft.whiteId = first || null;
    else if (turn.kind === "piper") { if (!second && !first) return; nextPlayers = nextPlayers.map((player) => player.id === first || player.id === second ? { ...player, charmed: true } : player); }
    else if (turn.kind === "hunter") nextDraft.whiteId = first;
    setPlayers(nextPlayers); setDraft(nextDraft); setFirst(""); setSecond(""); setWitchHeal(false); setReady(false); if (turnIndex === queue.length - 1) finishQueue(purpose, nextPlayers, nextDraft); else setTurnIndex(turnIndex + 1);
  };

  if (phase === "setup") return <main className="app-shell werewolf-shell"><WolfTopbar title="Ein Gerät" onBack={onBack} online={false} /><section className="page-intro"><span className="step-label wolf-step">Offline · Vorbereitung</span><h2>Wer lebt im Dorf?</h2><p>Das Handy wird für Rollen und Entscheidungen weitergereicht.</p></section><section className="local-setup"><div className="name-list">{names.map((name, index) => <div key={index}><span>{index + 1}</span><input value={name} onChange={(event) => setNames(names.map((item, position) => position === index ? event.target.value : item))} placeholder="Name eingeben" maxLength={24} aria-label={`Name ${index + 1}`} />{names.length > 3 && <button onClick={() => setNames(names.filter((_, position) => position !== index))}>×</button>}</div>)}</div>{names.length < 22 && <button className="add-person" onClick={() => setNames([...names, ""])}>+ Person hinzufügen</button>}<div className="local-options wolf-local-options"><div className="settings-row"><span><strong>Wolfsslots</strong><small>Standard: {defaultWolfCount(Math.max(3, validNames.length))}</small></span><Stepper value={effectiveWolves} min={1} max={maxWolves} onChange={setWolves} /></div><span className="settings-label">Zusatzrollen</span><RoleSelector count={validNames.length} wolves={effectiveWolves} roles={roles} setRoles={setRoles} /><div className="switch-row"><span><strong>Bürgermeister wählen</strong><small>Öffentliche Zusatzfunktion</small></span><input id="local-mayor" aria-label="Bürgermeister wählen" type="checkbox" checked={mayorEnabled} onChange={(event) => setMayorEnabled(event.target.checked)} /><i /></div><p className="local-audio-note">♪ Beim Start werden die akustischen Rollensignale aktiviert.</p></div><button className="primary-button wolf-primary" onClick={start}>Rollen verteilen →</button></section></main>;
  if (phase === "reveal") { const player = players[revealIndex]; const pack = players.filter((item) => item.id !== player.id && (item.team === "wolf" || item.role === "white_werewolf")).map((item) => item.name).join(", "); return <main className="app-shell werewolf-shell pass-shell"><WolfTopbar title={`Rolle ${revealIndex + 1}/${players.length}`} online={false} /><section className="handover wolf-handover"><span className="step-label wolf-step">Gerät weitergeben</span><h2>{ready ? `${player.name}, nur du darfst schauen.` : `Gib das Handy an ${player.name}.`}</h2>{!ready ? <button className="primary-button wolf-primary" onClick={() => setReady(true)}>Ich bin {player.name}</button> : <LocalSecret player={player} pack={pack} onDone={() => { setReady(false); if (revealIndex === players.length - 1) startAfterReveal(); else setRevealIndex(revealIndex + 1); }} />}</section></main>; }
  if (phase === "turn") { const turn = queue[turnIndex]; const actor = players.find((player) => player.id === turn.actorId)!; const living = players.filter((player) => player.alive); let candidates = living.filter((player) => player.id !== actor.id); if (turn.kind === "mayor_vote") candidates = living; if (turn.kind === "wolves") candidates = living.filter((player) => player.team !== "wolf" && player.role !== "white_werewolf"); if (turn.kind === "healer") candidates = living.filter((player) => player.id !== actor.lastProtectedId); if (turn.kind === "white_werewolf") candidates = living.filter((player) => player.team === "wolf" && player.id !== actor.id); if (turn.kind === "piper") candidates = candidates.filter((player) => !player.charmed); if (turn.candidates) candidates = candidates.filter((player) => turn.candidates!.includes(player.id)); const multi = turn.kind === "cupid" || turn.kind === "piper"; const reserve = turn.kind === "thief" ? (["thief", "villager", randomIndex(2) ? "werewolf" : "villager"] as WerewolfRole[]) : null; const wolfVictim = weightedVoteLeaders(draft.wolfVotes, null).leaders[0]; return <main className="app-shell werewolf-shell pass-shell"><WolfTopbar title={`${PHASE_COPY[turn.kind].title}`} online={false} /><section className="handover wolf-handover"><span className="step-label wolf-step">Geheime Aktion {turnIndex + 1}/{queue.length}</span><h2>{ready ? `${actor.name}, du bist dran.` : `Gib das Handy an ${actor.name}.`}</h2>{!ready ? <button className="primary-button wolf-primary" onClick={() => setReady(true)}>Ich bin {actor.name}</button> : <div className="local-action-panel"><p>{PHASE_COPY[turn.kind].text}</p>{turn.kind === "witch" ? <><p>{wolfVictim ? `Das Rudel wählte ${players.find((player) => player.id === wolfVictim)?.name}.` : "Noch kein Wolfsopfer."}</p>{actor.healPotion && wolfVictim && <div className="switch-row"><span><strong>Heiltrank einsetzen</strong></span><input id="local-witch-heal" aria-label="Heiltrank einsetzen" type="checkbox" checked={witchHeal} onChange={(event) => setWitchHeal(event.target.checked)} /><i /></div>}{actor.poisonPotion && <div className="select-field"><span>Gifttrank</span><select id="local-witch-poison" aria-label="Ziel für den Gifttrank" value={second} onChange={(event) => setSecond(event.target.value)}><option value="">Niemand</option>{candidates.filter((player) => !witchHeal || player.id !== wolfVictim).map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></div>}</> : reserve ? <div className="target-list">{reserve.map((role, index) => <button key={`${role}-${index}`} className={first === role ? "selected" : ""} onClick={() => setFirst(role)}><span>{ROLE_INFO[role].label.charAt(0)}</span><strong>{ROLE_INFO[role].label}</strong><i>{first === role ? "✓" : ""}</i></button>)}</div> : <div className="target-list">{candidates.map((player) => <button key={player.id} className={first === player.id || second === player.id ? "selected" : ""} onClick={() => { if (first === player.id) { setFirst(second); setSecond(""); } else if (multi && first) setSecond(player.id); else setFirst(player.id); }}><span>{player.name.charAt(0)}</span><strong>{player.name}</strong><i>{first === player.id || second === player.id ? "✓" : ""}</i></button>)}</div>}<button className="primary-button wolf-primary" disabled={!first && !["witch", "white_werewolf"].includes(turn.kind)} onClick={submitTurn}>{turn.kind === "white_werewolf" && !first ? "Diese Nacht passen" : "Geheim bestätigen"}</button></div>}</section></main>; }
  const dead = players.filter((player) => !player.alive); return <main className="app-shell werewolf-shell"><WolfTopbar title={phase === "results" ? "Ergebnis" : phase === "discussion" ? "Dorfversammlung" : "Auflösung"} onBack={phase === "results" ? onBack : undefined} online={false} /><section className="wolf-phase"><div className="phase-moon">{phase === "discussion" ? "☀" : "☾"}</div><div className="page-intro"><span className="step-label wolf-step">{night ? `Nacht ${night}` : "Dorf"}</span><h2>{phase === "results" ? WINNER_COPY[winner ?? ""] : phase === "discussion" ? "Wem könnt ihr trauen?" : "Der Morgen graut."}</h2><p>{phase === "discussion" ? "Diskutiert gemeinsam. Wenn ihr bereit seid, beginnt die geheime Abstimmung." : phase === "results" ? "Alle Rollen werden aufgedeckt." : "Seht nach, wer das Dorf verlassen musste."}</p></div>{phase !== "discussion" && <DeathBoard players={dead.map((player) => ({ ...player, isHost: false, online: false }))} />}{phase === "results" && <div className="role-reveal-list">{players.map((player) => <div key={player.id}><span>{player.name.charAt(0)}</span><strong>{player.name}</strong><small>{ROLE_INFO[player.role].label}</small></div>)}</div>}<button className="secondary-button" onClick={() => setInfoOpen(true)}>Private Rolleninfo öffnen</button>{phase === "dawn" && <button className="primary-button wolf-primary" onClick={() => phaseAfterDawn(resolutionSource) === "discussion" ? setPhase("discussion") : startNight(players)}>Weiter →</button>}{phase === "discussion" && <button className="primary-button wolf-primary" onClick={() => mayorEnabled && !mayorId ? beginQueue(mayorTurns(players), "mayor", players) : startDayVote(players)}>Abstimmung starten →</button>}{phase === "results" && <button className="primary-button wolf-primary" onClick={() => setPhase("setup")}>Neue Partie →</button>}</section>{infoOpen && <LocalInfoSheet players={players} selected={infoPlayer} setSelected={setInfoPlayer} close={() => { setInfoOpen(false); setInfoPlayer(""); }} />}</main>;
}

function LocalSecret({ player, pack, onDone }: { player: LocalPlayer; pack: string; onDone: () => void }) { const [holding, setHolding] = useState(false); const [seen, setSeen] = useState(false); return <section className={`local-secret-card ${holding ? "revealed" : ""}`}><div className="role-orb">{holding ? ROLE_INFO[player.role].label.charAt(0) : "?"}</div><h3>{holding ? ROLE_INFO[player.role].label : "Noch geheim"}</h3><p>{holding ? ROLE_INFO[player.role].description : "Halte den Knopf gedrückt, um deine Rolle zu sehen."}</p>{holding && pack && (player.team === "wolf" || player.role === "white_werewolf") && <small>Dein Rudel: {pack}</small>}<button onPointerDown={() => { setHolding(true); setSeen(true); }} onPointerUp={() => setHolding(false)} onPointerLeave={() => setHolding(false)}>{holding ? "Loslassen zum Verbergen" : "Gedrückt halten"}</button><button className="text-button light" disabled={!seen} onClick={onDone}>Gesehen &amp; weiter →</button></section>; }
function LocalInfoSheet({ players, selected, setSelected, close }: { players: LocalPlayer[]; selected: string; setSelected: (id: string) => void; close: () => void }) { const player = players.find((item) => item.id === selected); return <div className="sheet-backdrop"><section className="bottom-sheet wolf-sheet role-sheet"><button className="sheet-close" onClick={close}>×</button><span className="step-label wolf-step">Private Rolleninfo</span>{!player ? <><h3>Wer möchte nachsehen?</h3><div className="target-list">{players.map((item) => <button key={item.id} onClick={() => setSelected(item.id)}><span>{item.name.charAt(0)}</span><strong>{item.name}</strong><i>→</i></button>)}</div></> : <LocalSecret player={player} pack="" onDone={close} />}</section></div>; }
