"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { CATEGORIES, WORD_PAIRS, defaultImposterCount, maxImposterCount, type ContentMode } from "../../lib/game";
import { resolveOnlineGameStartup } from "../../lib/game-session";

type Screen = "home" | "create" | "join" | "local";
type Session = { lobbyId: string; token: string };
type Player = { id: string; name: string; isHost: boolean; online: boolean };
type LobbyState = {
  lobby: { id: string; name: string; status: "waiting" | "revealing" | "voting" | "results"; contentMode: ContentMode; pool: string; imposterCount: number; discoverable: boolean; revision: number; roundNumber: number };
  me: { id: string; name: string; isHost: boolean };
  players: Player[];
  votesSubmitted: number;
  ownVote: string | null;
  results: { playerId: string; name: string; votes: number }[] | null;
  customPairs?: { id: string; crew_word: string; imposter_word: string; rating: ContentMode }[];
  canClaimHost: boolean;
};
type Assignment = { role: "crew" | "imposter"; word: string };
type LocalPlayer = { id: string; name: string; role: "crew" | "imposter"; word: string };
type NearbyLobby = { id: string; name: string; player_count: number };

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function randomIndex(length: number) {
  if (length <= 1) return 0;
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % length;
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) }, cache: "no-store" });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Etwas ist schiefgelaufen.");
  return data;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-lockup ${compact ? "compact" : ""}`}>
      <div className="brand-mark" aria-hidden="true"><span /><span /></div>
      <span>{compact ? "IMPOSTER" : "Das Gesellschaftsspiel"}</span>
    </div>
  );
}

function Topbar({ title, onBack, online }: { title?: string; onBack?: () => void; online?: boolean }) {
  return (
    <header className="topbar">
      {onBack ? <button className="icon-button" onClick={onBack} aria-label="Zurück">←</button> : <Brand compact />}
      {title && <strong className="topbar-title">{title}</strong>}
      <span className={`connection-pill ${online === false ? "offline" : ""}`}><i />{online === false ? "offline" : "online"}</span>
    </header>
  );
}

function Notice({ message, clear }: { message: string; clear: () => void }) {
  useEffect(() => { const id = window.setTimeout(clear, 4200); return () => window.clearTimeout(id); }, [clear]);
  return <button className="notice" type="button" onClick={clear} aria-live="polite">{message}<span>×</span></button>;
}

function HoldCard({ assignment, playerName, onSeen }: { assignment: Assignment; playerName?: string; onSeen?: () => void }) {
  const [holding, setHolding] = useState(false);
  const [seen, setSeen] = useState(false);
  const reveal = () => { setHolding(true); setSeen(true); };
  const hide = () => setHolding(false);
  return (
    <section className={`secret-card ${holding ? "is-revealed" : ""}`}>
      <div className="secret-top"><span>{holding ? (assignment.role === "imposter" ? "Du bist Imposter" : "Du gehörst zur Gruppe") : "Deine geheime Rolle"}</span><i /></div>
      <div className="secret-center">
        {holding ? <><small>{assignment.role === "imposter" ? "Dein ähnliches Wort" : "Das geheime Wort"}</small><strong>{assignment.word}</strong></> : <><div className="fingerprint" aria-hidden="true">◎</div><strong className="hidden-label">Noch geheim</strong><small>{playerName ? `${playerName}, ` : ""}halte gedrückt, um aufzudecken</small></>}
      </div>
      <button className="hold-button" type="button" onPointerDown={reveal} onPointerUp={hide} onPointerCancel={hide} onPointerLeave={hide} onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") reveal(); }} onKeyUp={hide}>
        {holding ? "Loslassen zum Verbergen" : "Gedrückt halten"}
      </button>
      {onSeen && <button className={`text-button light seen-next ${seen ? "is-visible" : ""}`} type="button" disabled={!seen} onClick={onSeen}>Gesehen &amp; weiter →</button>}
    </section>
  );
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <div className="stepper"><button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Weniger">−</button><strong>{value}</strong><button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Mehr">+</button></div>;
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("home");
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<LobbyState | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [nearby, setNearby] = useState<NearbyLobby[]>([]);
  const [inviteLobbyId, setInviteLobbyId] = useState("");
  const [notice, setNotice] = useState("");
  const [online, setOnline] = useState(true);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [busy, setBusy] = useState(false);

  const showError = useCallback((error: unknown) => setNotice(error instanceof Error ? error.message : "Etwas ist schiefgelaufen."), []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    const install = (event: Event) => { event.preventDefault(); setInstallEvent(event as InstallEvent); };
    window.addEventListener("online", update); window.addEventListener("offline", update); window.addEventListener("beforeinstallprompt", install);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const hydrate = window.setTimeout(() => {
      setOnline(navigator.onLine);
      let stored: string | null = null;
      try { stored = localStorage.getItem("gameson:imposter:session") ?? localStorage.getItem("imposter-session"); } catch { /* storage unavailable */ }
      const startup = resolveOnlineGameStartup(window.location.search, stored);
      if (startup.kind === "resume") {
        try { localStorage.setItem("gameson:imposter:session", JSON.stringify(startup.session)); localStorage.removeItem("imposter-session"); } catch { /* storage unavailable */ }
        setSession(startup.session);
      } else if (startup.kind === "join") {
        setInviteLobbyId(startup.lobbyId); setScreen("join");
      } else if (startup.kind === "local") setScreen("local");
    }, 0);
    return () => { window.clearTimeout(hydrate); window.removeEventListener("online", update); window.removeEventListener("offline", update); window.removeEventListener("beforeinstallprompt", install); };
  }, []);

  useEffect(() => {
    if (!session) return;
    localStorage.setItem("gameson:imposter:session", JSON.stringify(session));
    window.history.replaceState({}, "", `/imposter?lobby=${encodeURIComponent(session.lobbyId)}`);
  }, [session]);

  useEffect(() => {
    if (session || !online || (screen !== "home" && screen !== "join")) return;
    let active = true;
    const load = () => api<{ lobbies: NearbyLobby[] }>("/api/game?action=nearby").then((data) => { if (active) setNearby(data.lobbies); }).catch(() => undefined);
    load(); const id = window.setInterval(load, 10000);
    return () => { active = false; window.clearInterval(id); };
  }, [online, screen, session]);

  const fetchState = useCallback(async (quiet = false) => {
    if (!session) return;
    try {
      const data = await api<LobbyState>(`/api/game?action=state&lobbyId=${encodeURIComponent(session.lobbyId)}`, { headers: { Authorization: `Bearer ${session.token}` } });
      setState(data); setOnline(true);
      if (data.lobby.status === "revealing" && !assignment) {
        const role = await api<{ assignment: Assignment }>(`/api/game?action=role&lobbyId=${encodeURIComponent(session.lobbyId)}`, { headers: { Authorization: `Bearer ${session.token}` } });
        setAssignment(role.assignment);
      }
      if (data.lobby.status === "waiting" || data.lobby.status === "results") setAssignment(null);
    } catch (error) {
      setOnline(false);
      if (!quiet) showError(error);
      if (error instanceof Error && error.message.includes("Sitzung")) { localStorage.removeItem("gameson:imposter:session"); setSession(null); setState(null); window.history.replaceState({}, "", "/imposter"); }
    }
  }, [assignment, session, showError]);

  useEffect(() => {
    if (!session) return;
    const initial = window.setTimeout(() => fetchState(), 0);
    const id = window.setInterval(() => fetchState(true), document.hidden ? 5000 : 1500);
    return () => { window.clearTimeout(initial); window.clearInterval(id); };
  }, [session, fetchState]);

  const post = useCallback(async (action: string, values: Record<string, unknown> = {}) => {
    if (!session) return;
    setBusy(true);
    try {
      await api("/api/game", { method: "POST", headers: { Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ action, lobbyId: session.lobbyId, ...values }) });
      await fetchState();
    } catch (error) { showError(error); } finally { setBusy(false); }
  }, [fetchState, session, showError]);

  const leaveToHome = async () => {
    if (state?.me.isHost && (state.lobby.status === "waiting" || state.lobby.status === "results")) {
      const message = state.lobby.status === "results" ? "Lobby beenden und alle Spieldaten löschen?" : "Lobby schließen? Alle Mitspieler werden getrennt.";
      if (!window.confirm(message)) return;
      if (session) {
        setBusy(true);
        try {
          await api("/api/game", { method: "POST", headers: { Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ action: "close", lobbyId: session.lobbyId }) });
        } catch (error) { showError(error); setBusy(false); return; }
        setBusy(false);
      }
    } else if (state && state.lobby.status !== "waiting" && state.lobby.status !== "results" && !window.confirm("Runde wirklich verlassen? Dein Platz bleibt in der Lobby.")) return;
    setSession(null); setState(null); setAssignment(null); localStorage.removeItem("gameson:imposter:session"); window.history.replaceState({}, "", "/imposter"); setScreen("home");
  };

  if (session) return <MultiGame state={state} assignment={assignment} session={session} online={online} busy={busy} post={post} onBack={leaveToHome} showError={showError} />;
  if (screen === "create") return <CreateLobby onBack={() => setScreen("home")} onCreated={setSession} showError={showError} />;
  if (screen === "join") return <JoinLobby nearby={nearby} inviteLobbyId={inviteLobbyId} onSelectLobby={setInviteLobbyId} onBack={() => { setInviteLobbyId(""); setScreen("home"); window.history.replaceState({}, "", "/imposter"); }} onJoined={setSession} showError={showError} />;
  if (screen === "local") return <LocalGame online={online} onBack={() => setScreen("home")} showError={showError} />;

  return (
    <main className="home-shell">
      <div className="ambient ambient-one" aria-hidden="true" /><div className="ambient ambient-two" aria-hidden="true" />
      {/* Hosted vinext navigation currently requires a full page load between game routes. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a className="collection-back" href="/">← Gameson</a>
      <header className="brand-row"><Brand /><span className={`connection-pill ${online ? "" : "offline"}`}><i />{online ? "online" : "offline"}</span></header>
      <section className="hero-copy" aria-labelledby="home-title"><p className="kicker">Einer kennt nur die halbe Wahrheit.</p><h1 id="home-title">IMPOSTER</h1><p className="hero-subtitle">Finde heraus, wer blufft – bevor die Gruppe dir auf die Schliche kommt.</p></section>
      <section className="mode-panel" aria-label="Spielmodus auswählen">
        <button className="mode-card mode-card-primary" onClick={() => setScreen("create")}><span className="mode-icon">◎</span><span className="mode-copy"><strong>Lobby erstellen</strong><small>Mit mehreren Handys spielen</small></span><span className="arrow">→</span></button>
        <button className="mode-card" onClick={() => setScreen("join")}><span className="mode-icon">↗</span><span className="mode-copy"><strong>Lobby beitreten</strong><small>{nearby.length ? `${nearby.length} ${nearby.length === 1 ? "Gruppe" : "Gruppen"} in deiner Nähe` : "Per Name, Link oder QR-Code"}</small></span><span className="arrow">→</span></button>
        <button className="mode-card" onClick={() => setScreen("local")}><span className="mode-icon">▣</span><span className="mode-copy"><strong>Ein Gerät</strong><small>Handy weiterreichen &amp; offline spielen</small></span><span className="arrow">→</span></button>
      </section>
      <footer className="home-footer">{installEvent ? <button className="install-link" onClick={async () => { await installEvent.prompt(); await installEvent.userChoice; setInstallEvent(null); }}>App installieren</button> : <><span className="status-dot" /><span>Bereit für eure nächste Runde</span></>}</footer>
      {notice && <Notice message={notice} clear={() => setNotice("")} />}
    </main>
  );
}

function CreateLobby({ onBack, onCreated, showError }: { onBack: () => void; onCreated: (session: Session) => void; showError: (error: unknown) => void }) {
  const [groupName, setGroupName] = useState(""); const [playerName, setPlayerName] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); try { onCreated(await api<Session>("/api/game", { method: "POST", body: JSON.stringify({ action: "create", groupName, playerName }) })); } catch (error) { showError(error); } finally { setBusy(false); } };
  return <main className="app-shell"><Topbar title="Neue Lobby" onBack={onBack} /><section className="page-intro"><span className="step-label">01 · Gruppe</span><h2>Gebt eurer Runde einen Namen.</h2><p>Danach kannst du Spieler einladen und die Wörter einstellen.</p></section><form className="form-card" onSubmit={submit}><label>Gruppenname<input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="z. B. Wohnzimmer" maxLength={28} autoComplete="off" /></label><label>Dein Name<input value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="z. B. Mia" maxLength={24} autoComplete="nickname" /></label><button className="primary-button" disabled={busy}>{busy ? "Wird erstellt …" : "Lobby erstellen →"}</button><p className="privacy-note">Keine Konten. Beendete Lobbys werden nach 30 Minuten, inaktive nach 12 Stunden gelöscht.</p></form></main>;
}

function JoinLobby({ nearby, inviteLobbyId, onSelectLobby, onBack, onJoined, showError }: { nearby: NearbyLobby[]; inviteLobbyId: string; onSelectLobby: (id: string) => void; onBack: () => void; onJoined: (session: Session) => void; showError: (error: unknown) => void }) {
  const [groupName, setGroupName] = useState(""); const [playerName, setPlayerName] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); try { onJoined(await api<Session>("/api/game", { method: "POST", body: JSON.stringify({ action: "join", lobbyId: inviteLobbyId || undefined, groupName, playerName }) })); } catch (error) { showError(error); } finally { setBusy(false); } };
  return <main className="app-shell"><Topbar title="Beitreten" onBack={onBack} /><section className="page-intro"><span className="step-label">01 · Beitreten</span><h2>{inviteLobbyId ? "Einladung erhalten." : "Finde deine Gruppe."}</h2><p>{inviteLobbyId ? "Nur noch deinen Namen eingeben – dann bist du dabei." : "Wähle eine nahe Lobby oder gib ihren Gruppennamen ein."}</p></section>{!inviteLobbyId && nearby.length > 0 && <section className="nearby-section"><div className="section-heading"><strong>In deiner Nähe</strong><span>automatisch erkannt</span></div><div className="nearby-list">{nearby.map((item) => <button key={item.id} type="button" onClick={() => onSelectLobby(item.id)}><span className="nearby-pulse" /><span><strong>{item.name}</strong><small>{item.player_count} {item.player_count === 1 ? "Person" : "Personen"}</small></span><b>→</b></button>)}</div></section>}<form className="form-card" onSubmit={submit}>{!inviteLobbyId && <label>Gruppenname<input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Gruppenname" maxLength={28} autoComplete="off" /></label>}<label>Dein Name<input value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="Dein Spielername" maxLength={24} autoComplete="nickname" /></label><button className="primary-button" disabled={busy}>{busy ? "Wird verbunden …" : "Lobby beitreten →"}</button></form></main>;
}

function MultiGame({ state, assignment, session, online, busy, post, onBack, showError }: { state: LobbyState | null; assignment: Assignment | null; session: Session; online: boolean; busy: boolean; post: (action: string, values?: Record<string, unknown>) => Promise<void>; onBack: () => void; showError: (error: unknown) => void }) {
  const [qr, setQr] = useState("");
  const shareUrl = typeof window === "undefined" ? "" : `${window.location.origin}/imposter?lobby=${session.lobbyId}`;
  useEffect(() => { if (shareUrl) QRCode.toDataURL(shareUrl, { width: 420, margin: 1, color: { dark: "#171713", light: "#f4f0e7" } }).then(setQr).catch(() => undefined); }, [shareUrl]);
  if (!state) return <main className="app-shell center-shell"><div className="loader" /><p>Lobby wird geöffnet …</p></main>;
  const isBetween = state.lobby.status === "waiting" || state.lobby.status === "results";
  return (
    <main className="app-shell game-shell">
      <Topbar title={state.lobby.name} onBack={onBack} online={online} />
      {!online && <div className="offline-banner">Verbindung unterbrochen – wir versuchen es weiter.</div>}
      {state.lobby.status === "waiting" && <LobbyRoom state={state} qr={qr} shareUrl={shareUrl} busy={busy} post={post} showError={showError} />}
      {state.lobby.status === "revealing" && <section className="round-screen"><div className="round-meta"><span>Runde {state.lobby.roundNumber}</span><span>{state.players.length} Spieler</span></div>{assignment ? <HoldCard assignment={assignment} playerName={state.me.name} /> : <div className="loader" />}{state.me.isHost ? <div className="host-action"><p>Wenn alle ihr Wort gesehen haben, öffne die Abstimmung.</p><button className="primary-button coral" disabled={busy} onClick={() => post("open_vote")}>Abstimmung starten</button></div> : <p className="waiting-copy">Besprecht eure Begriffe. Der Host öffnet gleich die Abstimmung.</p>}</section>}
      {state.lobby.status === "voting" && <Voting state={state} busy={busy} post={post} />}
      {state.lobby.status === "results" && <Results state={state} busy={busy} post={post} close={onBack} />}
      {isBetween && state.canClaimHost && <button className="claim-button" onClick={() => post("claim_host")}>Host ist weg – Leitung übernehmen</button>}
    </main>
  );
}

function LobbyRoom({ state, qr, shareUrl, busy, post, showError }: { state: LobbyState; qr: string; shareUrl: string; busy: boolean; post: (action: string, values?: Record<string, unknown>) => Promise<void>; showError: (error: unknown) => void }) {
  const [settingsOpen, setSettingsOpen] = useState(false); const [inviteOpen, setInviteOpen] = useState(false);
  const indexedPlayers = state.players.map((player, index) => ({ player, index }));
  const readyPlayers = indexedPlayers.filter(({ player }) => player.online);
  const waitingPlayers = indexedPlayers.filter(({ player }) => !player.online);
  const renderPlayer = ({ player, index }: (typeof indexedPlayers)[number]) => <div className={`player-row ${player.online ? "is-online" : "is-offline"}`} key={player.id}>
    <span className={`avatar avatar-${index % 5}`}>{player.name.charAt(0).toUpperCase()}</span>
    <span><strong>{player.name}{player.id === state.me.id && " (du)"}</strong><small>{player.isHost ? "Host" : player.online ? "bereit" : "nicht bereit"}</small></span>
    {state.me.isHost && player.id !== state.me.id ? <button aria-label={`${player.name} entfernen`} onClick={() => post("remove", { playerId: player.id })}>×</button> : <i className={player.online ? "online-dot" : "offline-dot"} />}
  </div>;
  return <><section className="lobby-hero"><span className="live-badge"><i /> Lobby offen</span><h2>{state.players.length}<small>/22</small></h2><p>{state.players.length === 1 ? "Du bist zuerst da" : "Spieler sind bereit"}</p><div className="lobby-actions"><button onClick={() => setInviteOpen(true)}>QR &amp; Link</button>{state.me.isHost && <button onClick={() => setSettingsOpen(true)}>Einstellungen</button>}</div></section><section className="player-section"><div className="section-heading"><strong>Mitspieler</strong><span>mindestens 3</span></div><div className="player-groups"><section className="player-group" aria-labelledby="imposter-ready-players"><header className="player-group-heading is-ready"><h3 id="imposter-ready-players"><i />Online &amp; spielbereit</h3><span>{readyPlayers.length}</span></header><div className="player-list">{readyPlayers.map(renderPlayer)}</div></section><section className="player-group" aria-labelledby="imposter-waiting-players"><header className="player-group-heading is-waiting"><h3 id="imposter-waiting-players"><i />Nicht bereit</h3><span>{waitingPlayers.length}</span></header>{waitingPlayers.length ? <div className="player-list">{waitingPlayers.map(renderPlayer)}</div> : <p className="player-group-empty">Alle in der Lobby sind spielbereit.</p>}</section></div></section>{state.me.isHost ? <div className="sticky-action"><div><span>Wortpool</span><strong>{CATEGORIES.find((item) => item.id === state.lobby.pool)?.label ?? "Zufällig"} · {state.lobby.imposterCount} Imposter</strong></div><button className="primary-button coral" disabled={busy || state.players.length < 3} onClick={() => post("start")}>{state.players.length < 3 ? `Noch ${3 - state.players.length} ${3 - state.players.length === 1 ? "Person" : "Personen"}` : "Runde starten →"}</button></div> : <div className="sticky-action waiting"><div className="loader small" /><span>Der Host stellt die Runde ein …</span></div>}{inviteOpen && <InviteSheet name={state.lobby.name} qr={qr} shareUrl={shareUrl} close={() => setInviteOpen(false)} showError={showError} />}{settingsOpen && <SettingsSheet state={state} busy={busy} post={post} close={() => setSettingsOpen(false)} />}</>;
}

function InviteSheet({ name, qr, shareUrl, close, showError }: { name: string; qr: string; shareUrl: string; close: () => void; showError: (error: unknown) => void }) {
  const share = async () => { try { if (navigator.share) await navigator.share({ title: `Imposter-Lobby ${name}`, text: `Komm in meine Imposter-Lobby „${name}“`, url: shareUrl }); else { await navigator.clipboard.writeText(shareUrl); } } catch (error) { if ((error as Error).name !== "AbortError") showError(error); } };
  return <div className="sheet-backdrop"><section className="bottom-sheet invite-sheet" aria-modal="true" role="dialog"><button className="sheet-close" onClick={close} aria-label="Einladung schließen">×</button><span className="step-label">Einladen</span><h3>Handy draufhalten.</h3>{qr && <Image src={qr} alt={`QR-Code zur Lobby ${name}`} width={300} height={300} unoptimized />}<p>Oder Gruppenname eingeben:</p><strong className="group-code">{name}</strong><button className="primary-button" onClick={share}>Link teilen</button></section></div>;
}

function SettingsSheet({ state, busy, post, close }: { state: LobbyState; busy: boolean; post: (action: string, values?: Record<string, unknown>) => Promise<void>; close: () => void }) {
  const [mode, setMode] = useState<ContentMode>(state.lobby.contentMode); const [pool, setPool] = useState(state.lobby.pool); const [imposters, setImposters] = useState(state.lobby.imposterCount); const [discoverable, setDiscoverable] = useState(state.lobby.discoverable); const [adultConfirmed, setAdultConfirmed] = useState(mode === "adult");
  const [crewWord, setCrewWord] = useState(""); const [imposterWord, setImposterWord] = useState("");
  const max = maxImposterCount(state.players.length);
  const chooseMode = (next: ContentMode) => { if (next === "adult" && !adultConfirmed) { if (!window.confirm("Ich bestätige, dass alle Mitspieler mindestens 18 Jahre alt sind.")) return; setAdultConfirmed(true); } setMode(next); if (next === "family" && CATEGORIES.find((item) => item.id === pool)?.rating === "adult") setPool("random"); };
  const save = async () => { await post("settings", { contentMode: mode, pool, imposterCount: imposters, discoverable, adultConfirmed: adultConfirmed || mode === "family" }); close(); };
  const addPair = async () => { await post("add_pair", { crewWord, imposterWord, rating: mode }); setCrewWord(""); setImposterWord(""); };
  return <div className="sheet-backdrop"><section className="bottom-sheet settings-sheet" role="dialog" aria-modal="true"><button className="sheet-close" onClick={close} aria-label="Einstellungen schließen">×</button><span className="step-label">Rundeneinstellungen</span><h3>So spielt ihr.</h3><div className="settings-block"><span className="settings-label">Inhalte</span><div className="segmented"><button className={mode === "family" ? "active" : ""} onClick={() => chooseMode("family")}>Jugendfrei</button><button className={mode === "adult" ? "active" : ""} onClick={() => chooseMode("adult")}>Erwachsene 18+</button></div></div><div className="settings-block"><label htmlFor="pool">Wortpool</label><select id="pool" value={pool} onChange={(e) => setPool(e.target.value)}>{CATEGORIES.filter((item) => item.rating === "family" || mode === "adult").map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></div><div className="settings-row"><span><strong>Imposter</strong><small>weniger als die Hälfte</small></span><Stepper value={imposters} min={1} max={max} onChange={setImposters} /></div><label className="switch-row" htmlFor="discoverable-toggle"><span><strong>In der Nähe sichtbar</strong><small>Zeigt die Lobby im gleichen Netz</small></span><input id="discoverable-toggle" aria-label="In der Nähe sichtbar" type="checkbox" checked={discoverable} onChange={(e) => setDiscoverable(e.target.checked)} /><i /></label><details className="custom-words"><summary>Eigenes Wortpaar hinzufügen <span>+</span></summary><div><input aria-label="Wort für die Gruppe" value={crewWord} onChange={(e) => setCrewWord(e.target.value)} placeholder="Wort für die Gruppe" maxLength={40} /><input aria-label="Ähnliches Imposter-Wort" value={imposterWord} onChange={(e) => setImposterWord(e.target.value)} placeholder="Ähnliches Imposter-Wort" maxLength={40} /><button className="secondary-button" disabled={busy || !crewWord || !imposterWord} onClick={addPair}>Wortpaar speichern</button><small>{state.customPairs?.length ?? 0} eigene Wortpaare in dieser Lobby</small></div></details><button className="primary-button coral" disabled={busy} onClick={save}>Einstellungen übernehmen</button></section></div>;
}

function Voting({ state, busy, post }: { state: LobbyState; busy: boolean; post: (action: string, values?: Record<string, unknown>) => Promise<void> }) {
  const [choice, setChoice] = useState(state.ownVote ?? "");
  return <section className="vote-screen"><div className="page-intro"><span className="step-label">Runde {state.lobby.roundNumber} · Abstimmung</span><h2>Wer blufft?</h2><p>Wähle die Person, deren Hinweise am wenigsten passen.</p></div><div className="vote-list">{state.players.filter((player) => player.id !== state.me.id).map((player, index) => <button className={choice === player.id ? "selected" : ""} key={player.id} onClick={() => setChoice(player.id)}><span className={`avatar avatar-${index % 5}`}>{player.name.charAt(0).toUpperCase()}</span><strong>{player.name}</strong><i>{choice === player.id ? "✓" : ""}</i></button>)}</div><div className="vote-status"><span>{state.votesSubmitted} von {state.players.length} Stimmen abgegeben</span><div><i style={{ width: `${Math.min(100, (state.votesSubmitted / state.players.length) * 100)}%` }} /></div></div><button className="primary-button coral" disabled={!choice || busy} onClick={() => post("vote", { targetId: choice })}>{state.ownVote ? "Stimme ändern" : "Stimme abgeben"}</button>{state.me.isHost && <button className="secondary-button finish-vote" disabled={busy || state.votesSubmitted === 0} onClick={() => post("finish_vote")}>Abstimmung beenden</button>}</section>;
}

function Results({ state, busy, post, close }: { state: LobbyState; busy: boolean; post: (action: string, values?: Record<string, unknown>) => Promise<void>; close: () => void }) {
  const max = Math.max(1, ...(state.results ?? []).map((item) => item.votes));
  return <section className="results-screen"><div className="result-stamp">Abgestimmt</div><div className="page-intro"><span className="step-label">Runde {state.lobby.roundNumber} · Ergebnis</span><h2>Das sagt die Gruppe.</h2><p>Die Rollen bleiben geheim. Entscheidet selbst, was das Ergebnis für eure Runde bedeutet.</p></div><div className="result-list">{state.results?.map((item, index) => <div className={index === 0 && item.votes > 0 ? "leader" : ""} key={item.playerId}><span><strong>{item.name}</strong><b>{item.votes}</b></span><i><em style={{ width: `${(item.votes / max) * 100}%` }} /></i></div>)}</div>{state.me.isHost ? <><button className="primary-button coral" disabled={busy} onClick={() => post("start")}>Neue Runde →</button><button className="secondary-button" disabled={busy} onClick={close}>Lobby beenden</button></> : <p className="waiting-copy">Der Host startet gleich eine neue Runde.</p>}</section>;
}

function LocalGame({ online, onBack, showError }: { online: boolean; onBack: () => void; showError: (error: unknown) => void }) {
  const [phase, setPhase] = useState<"setup" | "reveal" | "discuss" | "vote" | "results">("setup");
  const [names, setNames] = useState(["", "", ""]); const [mode, setMode] = useState<ContentMode>("family"); const [pool, setPool] = useState("random"); const [imposters, setImposters] = useState(1); const [imposterTouched, setImposterTouched] = useState(false); const [customPairs, setCustomPairs] = useState<{ crew: string; imposter: string; rating: ContentMode }[]>([]);
  const [crewDraft, setCrewDraft] = useState(""); const [imposterDraft, setImposterDraft] = useState(""); const [players, setPlayers] = useState<LocalPlayer[]>([]); const [index, setIndex] = useState(0); const [ready, setReady] = useState(false); const [choice, setChoice] = useState(""); const [votes, setVotes] = useState<Record<string, string>>({});
  useEffect(() => { const id = window.setTimeout(() => { try { const saved = localStorage.getItem("imposter-local-names"); if (saved) { const parsed = JSON.parse(saved) as string[]; if (parsed.length >= 3) setNames(parsed); } } catch { /* empty */ } }, 0); return () => window.clearTimeout(id); }, []);
  useEffect(() => { localStorage.setItem("imposter-local-names", JSON.stringify(names)); }, [names]);
  const validNames = names.map((name) => name.trim()).filter(Boolean);
  const effectiveImposters = imposterTouched ? Math.min(imposters, maxImposterCount(validNames.length || 3)) : defaultImposterCount(validNames.length || 3);
  const start = () => {
    if (validNames.length < 3) return showError(new Error("Füge mindestens drei Namen hinzu."));
    if (new Set(validNames.map((name) => name.toLocaleLowerCase("de"))).size !== validNames.length) return showError(new Error("Jeder Name darf nur einmal vorkommen."));
    const eligible = pool === "custom" ? customPairs.filter((item) => mode === "adult" || item.rating === "family") : WORD_PAIRS.filter((item) => (mode === "adult" || item.rating === "family") && (pool === "random" || item.category === pool));
    if (!eligible.length) return showError(new Error("In diesem Wortpool fehlt noch ein Wortpaar."));
    const pair = eligible[randomIndex(eligible.length)]; const order = validNames.map((name, position) => ({ id: crypto.randomUUID(), name, position })); for (let i = order.length - 1; i > 0; i--) { const j = randomIndex(i + 1); [order[i], order[j]] = [order[j], order[i]]; } const imposterIds = new Set(order.slice(0, effectiveImposters).map((item) => item.id));
    setPlayers(order.sort((a, b) => a.position - b.position).map((item) => ({ id: item.id, name: item.name, role: imposterIds.has(item.id) ? "imposter" : "crew", word: imposterIds.has(item.id) ? pair.imposter : pair.crew }))); setIndex(0); setReady(false); setVotes({}); setPhase("reveal");
  };
  const voteTotals = useMemo(() => players.map((player) => ({ ...player, votes: Object.values(votes).filter((target) => target === player.id).length })).sort((a, b) => b.votes - a.votes), [players, votes]);
  if (phase === "setup") return <main className="app-shell"><Topbar title="Ein Gerät" onBack={onBack} online={online} /><section className="page-intro"><span className="step-label">Offline · Vorbereitung</span><h2>Wer spielt mit?</h2><p>Das Handy wird später von Person zu Person weitergereicht.</p></section><section className="local-setup"><div className="name-list">{names.map((name, idx) => <div key={idx}><span>{idx + 1}</span><input aria-label={`Name ${idx + 1}`} value={name} onChange={(e) => setNames(names.map((item, position) => position === idx ? e.target.value : item))} placeholder="Name eingeben" maxLength={24} />{names.length > 3 && <button onClick={() => setNames(names.filter((_, position) => position !== idx))}>×</button>}</div>)}</div>{names.length < 22 && <button className="add-person" onClick={() => setNames([...names, ""])}>+ Person hinzufügen</button>}<div className="local-options"><div className="segmented"><button className={mode === "family" ? "active" : ""} onClick={() => { setMode("family"); if (CATEGORIES.find((item) => item.id === pool)?.rating === "adult") setPool("random"); }}>Jugendfrei</button><button className={mode === "adult" ? "active" : ""} onClick={() => { if (window.confirm("Ich bestätige, dass alle Mitspieler mindestens 18 Jahre alt sind.")) setMode("adult"); }}>Erwachsene 18+</button></div><label>Wortpool<select value={pool} onChange={(e) => setPool(e.target.value)}>{CATEGORIES.filter((item) => item.rating === "family" || mode === "adult").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><div className="settings-row"><span><strong>Imposter</strong><small>Vorschlag: {defaultImposterCount(validNames.length || 3)}</small></span><Stepper value={effectiveImposters} min={1} max={maxImposterCount(validNames.length || 3)} onChange={(value) => { setImposterTouched(true); setImposters(value); }} /></div>{pool === "custom" && <div className="inline-pair"><input value={crewDraft} onChange={(e) => setCrewDraft(e.target.value)} placeholder="Gruppenwort" /><input value={imposterDraft} onChange={(e) => setImposterDraft(e.target.value)} placeholder="Imposter-Wort" /><button className="secondary-button" onClick={() => { if (crewDraft.trim().length < 2 || imposterDraft.trim().length < 2 || crewDraft.trim().toLocaleLowerCase("de") === imposterDraft.trim().toLocaleLowerCase("de")) return showError(new Error("Gib zwei unterschiedliche Wörter ein.")); setCustomPairs([...customPairs, { crew: crewDraft.trim(), imposter: imposterDraft.trim(), rating: mode }]); setCrewDraft(""); setImposterDraft(""); }}>{customPairs.length ? `Weiteres Paar (${customPairs.length})` : "Wortpaar hinzufügen"}</button></div>}</div><button className="primary-button coral" onClick={start}>Rollen verteilen →</button></section></main>;
  if (phase === "reveal") { const current = players[index]; return <main className="app-shell pass-shell"><Topbar title={`Rolle ${index + 1}/${players.length}`} online={online} /><section className="handover"><span className="step-label">Gerät weitergeben</span><h2>{ready ? `${current.name}, nur du darfst schauen.` : `Gib das Handy an ${current.name}.`}</h2>{!ready ? <button className="primary-button" onClick={() => setReady(true)}>Ich bin {current.name}</button> : <HoldCard assignment={{ role: current.role, word: current.word }} onSeen={() => { if (index === players.length - 1) { setPhase("discuss"); setIndex(0); setReady(false); } else { setIndex(index + 1); setReady(false); } }} />}</section></main>; }
  if (phase === "discuss") return <main className="app-shell pass-shell"><Topbar title="Diskussion" online={online} /><section className="discussion-card"><span className="round-symbol">?</span><span className="step-label">Alle kennen ihr Wort</span><h2>Wer klingt verdächtig?</h2><p>Beschreibt euren Begriff, ohne ihn direkt zu nennen. Wenn ihr bereit seid, stimmt nacheinander ab.</p><button className="primary-button coral" onClick={() => { setPhase("vote"); setReady(false); setIndex(0); }}>Abstimmung starten</button></section></main>;
  if (phase === "vote") { const current = players[index]; return <main className="app-shell pass-shell"><Topbar title={`Stimme ${index + 1}/${players.length}`} online={online} /><section className="handover"><span className="step-label">Geheime Abstimmung</span><h2>{ready ? `${current.name}, wer blufft?` : `Gib das Handy an ${current.name}.`}</h2>{!ready ? <button className="primary-button" onClick={() => setReady(true)}>Ich bin {current.name}</button> : <><div className="vote-list compact-votes">{players.filter((player) => player.id !== current.id).map((player, idx) => <button className={choice === player.id ? "selected" : ""} key={player.id} onClick={() => setChoice(player.id)}><span className={`avatar avatar-${idx % 5}`}>{player.name.charAt(0)}</span><strong>{player.name}</strong><i>{choice === player.id ? "✓" : ""}</i></button>)}</div><button className="primary-button coral" disabled={!choice} onClick={() => { const nextVotes = { ...votes, [current.id]: choice }; setVotes(nextVotes); setChoice(""); setReady(false); if (index === players.length - 1) { setPhase("results"); } else setIndex(index + 1); }}>Stimme bestätigen</button></>}</section></main>; }
  return <main className="app-shell"><Topbar title="Ergebnis" online={online} /><section className="results-screen"><div className="result-stamp">Abgestimmt</div><div className="page-intro"><span className="step-label">Ergebnis</span><h2>Das sagt die Gruppe.</h2><p>Die Rollen bleiben geheim.</p></div><div className="result-list">{voteTotals.map((item, idx) => <div className={idx === 0 && item.votes > 0 ? "leader" : ""} key={item.id}><span><strong>{item.name}</strong><b>{item.votes}</b></span><i><em style={{ width: `${(item.votes / Math.max(1, voteTotals[0]?.votes ?? 1)) * 100}%` }} /></i></div>)}</div><button className="primary-button coral" onClick={start}>Neue Runde →</button><button className="secondary-button" onClick={() => setPhase("setup")}>Spieler ändern</button></section></main>;
}
