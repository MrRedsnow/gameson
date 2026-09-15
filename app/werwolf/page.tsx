"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { GameBackLink, GameModes, GameRules, ResumeSessionDialog, type ResumeLobbyInfo } from "@/components/game-entry";
import { ArrowLeft, ArrowUpRight, AudioLines, Check, ChevronRight, Crown, DoorOpen, Eye, LockKeyhole, Moon, Plus, Settings2, Skull, Sparkles, Users, Vote, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getGameGuidance, getSelectionGuidance } from "@/lib/werewolf-guidance";
import { TaskStatus, ConfirmBar, DecisionSteps, ActionProgress, GameEmptyState, PhaseHeader, PlayerChoice, PlayerSelect, PrivateRoleButton, RoleIcon, SettingSwitch } from "@/components/werewolf/game-ui";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { describeLobby, resolveOnlineGameStartup } from "../../lib/game-session";
import {
  DEATH_CAUSE_INFO,
  ROLE_INFO,
  SELECTABLE_ROLES,
  buildRoleDeck,
  countVillageDecisionDeaths,
  defaultWolfCount,
  determineWinner,
  maxWolfCount,
  minimumPlayersForRole,
  phaseAfterDawn,
  roleTeam,
  validateRoleSetup,
  villageGuiltIntensity,
  weightedVoteLeaders,
  type DeathCause,
  type Winner,
  type WerewolfPhase,
  type WerewolfRole,
  type WerewolfTeam,
} from "../../lib/werewolf";
import { AUDIO_ANNOUNCEMENT_GAP_SECONDS, MAX_AUDIO_ANNOUNCEMENT_GAP_SECONDS, MIN_AUDIO_ANNOUNCEMENT_GAP_SECONDS, WEREWOLF_AUDIO_PHASES, playWerewolfPhaseCue, playWerewolfWinnerCue, primeWerewolfAudio, stopWerewolfAudio, unlockWerewolfAudio } from "../../lib/werewolf-audio";

type PostAction = (action: string, values?: Record<string, unknown>) => Promise<boolean>;

type Screen = "home" | "create" | "join" | "local";
type Session = { lobbyId: string; token: string };
type NearbyLobby = { id: string; name: string; player_count: number };
type PlayerView = { id: string; name: string; isHost: boolean; alive: boolean; online: boolean; role?: WerewolfRole; knownRole?: WerewolfRole; charmed?: boolean; deathCauses: DeathCause[]; deathMatchNumber?: number | null; deathCycle?: number | null; deathSource?: "night" | "day" | null };
type PrivateRole = { role: WerewolfRole; label: string; description: string; team: WerewolfTeam; lover: string | null; roleModel: string | null; charmed: boolean; elderShield: boolean; healPotion: boolean; poisonPotion: boolean; reserveRoles?: WerewolfRole[] };
type PublicVotePhase = "mayor_vote" | "day_vote" | "runoff";
type VoteHistoryRound = {
  cycle: number; phase: PublicVotePhase;
  votes: { voterId: string; voterName: string; targetId: string; targetName: string; weight: number }[];
  totals: { playerId: string; name: string; votes: number }[];
  submitted: number; totalWeight: number; maxVotes: number;
};
type LobbyState = {
  lobby: { id: string; name: string; status: "waiting" | "playing" | "results"; phase: WerewolfPhase; wolfCount: number; selectedRoles: WerewolfRole[]; mayorEnabled: boolean; mayorPlayerId: string | null; discoverable: boolean; audioMode: "all" | "host"; audioGapSeconds: number; revision: number; matchNumber: number; night: number; winner: Winner; resolutionSource: "night" | "day" | null; phaseStartedAt: number };
  me: { id: string; name: string; isHost: boolean; alive: boolean };
  players: PlayerView[];
  privateRole: PrivateRole | null;
  action: { phase: WerewolfPhase; candidates: { id: string; name: string }[]; maxTargets: number; wolfVictimId?: string | null; canHeal?: boolean; canPoison?: boolean } | null;
  ownSubmission: unknown;
  actionResult: { seenLabel?: string; name?: string } | null;
  progress: { submitted: number; required: number };
  voteHistory: VoteHistoryRound[];
  canSkip: boolean;
  canClaimHost: boolean;
  serverTime: number;
};

const PHASE_COPY: Record<WerewolfPhase, { title: string; text: string }> = {
  waiting: { title: "Lobby", text: "Stellt eure Rollen zusammen und startet, sobald alle da sind." },
  role_reveal: { title: "Rollen kennenlernen", text: "Öffne deine Rollenkarte einmal, bevor du die Spiellobby betrittst." },
  mayor_vote: { title: "Bürgermeisterwahl", text: "Seine Stimme zählt bei jeder Dorfabstimmung doppelt." },
  thief: { title: "Dieb", text: "Eine geheime Rolle kann jetzt getauscht werden." },
  cupid: { title: "Amor", text: "Zwei Schicksale werden miteinander verbunden." },
  wild_child: { title: "Wolfskind", text: "Ein Vorbild entscheidet über sein späteres Schicksal." },
  healer: { title: "Heiler", text: "Eine Person wird vor dem Rudel geschützt." },
  seer: { title: "Seherin", text: "Eine verborgene Rolle wird erkannt." },
  wolves: { title: "Werwölfe", text: "Die Werwölfe wählen ihr nächtliches Opfer." },
  witch: { title: "Hexe", text: "Heilen, vergiften oder die Nacht geschehen lassen." },
  white_werewolf: { title: "Weiße Werwölfin", text: "Auch das Rudel ist vor ihr nicht sicher." },
  piper: { title: "Flötenspieler", text: "Bis zu zwei Personen werden verzaubert." },
  dawn: { title: "Aufwachen", text: "Das Dorf erfährt, was in der Nacht oder bei der Abstimmung geschah." },
  discussion: { title: "Dorfversammlung", text: "Diskutiert, beschuldigt und verteidigt euch – aber verratet eure Rolle nicht leichtfertig." },
  day_vote: { title: "Dorfabstimmung", text: "Wählt die Person, die ihr für am gefährlichsten haltet." },
  runoff: { title: "Stichwahl", text: "Nur die Personen mit den meisten Stimmen stehen noch zur Wahl." },
  hunter: { title: "Letzter Schuss", text: "Der Jäger nimmt eine lebende Person mit in den Tod." },
  results: { title: "Ergebnis", text: "Alle Rollen sind nun bekannt." },
};

const WINNER_COPY: Record<string, string> = { village: "Das Dorf gewinnt", wolves: "Das Rudel gewinnt", piper: "Der Flötenspieler gewinnt", white_werewolf: "Die Weiße Werwölfin gewinnt" };

function randomIndex(length: number) { if (length <= 1) return 0; const limit = Math.floor(0x100000000 / length) * length; const values = new Uint32Array(1); do crypto.getRandomValues(values); while (values[0] >= limit); return values[0] % length; }

function createVoteHistoryRound(phase: PublicVotePhase, cycle: number, votes: { voterId: string; targetId: string }[], players: { id: string; name: string }[], mayorId: string | null): VoteHistoryRound {
  const byId = new Map(players.map((player) => [player.id, player]));
  const totals = new Map<string, { playerId: string; name: string; votes: number }>();
  const mappedVotes = votes.flatMap((vote) => {
    const voter = byId.get(vote.voterId); const target = byId.get(vote.targetId);
    if (!voter || !target) return [];
    const weight = phase !== "mayor_vote" && vote.voterId === mayorId ? 2 : 1;
    const total = totals.get(target.id) ?? { playerId: target.id, name: target.name, votes: 0 };
    total.votes += weight; totals.set(target.id, total);
    return [{ voterId: voter.id, voterName: voter.name, targetId: target.id, targetName: target.name, weight }];
  });
  if (phase !== "runoff") {
    for (const vote of mappedVotes) {
      if (!totals.has(vote.voterId)) totals.set(vote.voterId, { playerId: vote.voterId, name: vote.voterName, votes: 0 });
    }
  }
  const sortedTotals = [...totals.values()].sort((left, right) => right.votes - left.votes || left.name.localeCompare(right.name, "de"));
  return { cycle, phase, votes: mappedVotes, totals: sortedTotals, submitted: mappedVotes.length, totalWeight: sortedTotals.reduce((sum, item) => sum + item.votes, 0), maxVotes: sortedTotals[0]?.votes ?? 0 };
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), ...options, headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) }, cache: "no-store" });
  const data = await response.json() as T & { error?: string }; if (!response.ok) throw new Error(data.error || "Etwas ist schiefgelaufen."); return data;
}

function WolfMark() { return <div className="wolf-mark" aria-hidden="true"><Moon /></div>; }
/* Sound should simply work: the first tap or key press anywhere on the page unlocks playback,
 * so nobody has to remember a separate button. Browsers only allow this inside a user gesture. */
function useAutomaticAudioUnlock(audioReady: boolean, setAudioReady: (ready: boolean) => void) {
  useEffect(() => {
    if (audioReady) return;
    let active = true;
    const prime = () => { primeWerewolfAudio().then((ready) => { if (active && ready) setAudioReady(true); }).catch(() => undefined); };
    prime();
    const events = ["pointerup", "touchend", "keydown"] as const;
    for (const event of events) window.addEventListener(event, prime, { passive: true });
    return () => { active = false; for (const event of events) window.removeEventListener(event, prime); };
  }, [audioReady, setAudioReady]);
}
function Connection({ online, local = false }: { online: boolean; local?: boolean }) { return <span className={`connection-pill ${local ? "local" : online ? "" : "offline"}`} aria-label={local ? "Lokales Spiel – kein Internet nötig" : online ? "Online" : "Offline"}><i />{local ? "lokal" : online ? "online" : "offline"}</span>; }
function Notice({ message, clear }: { message: string; clear: () => void }) {
  return <div className="notice" role="alert" aria-live="assertive"><div><strong>Bitte prüfen</strong><p>{message}</p></div><Button variant="ghost" size="icon" type="button" onClick={clear} aria-label="Hinweis schließen"><X aria-hidden="true" /></Button></div>;
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (value: number) => void }) { return <div className="stepper"><Button type="button" aria-label="Weniger" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>−</Button><strong aria-live="polite">{value}</strong><Button type="button" aria-label="Mehr" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>+</Button></div>; }

function ModalSheet({ children, className = "", labelledBy, close }: { children: ReactNode; className?: string; labelledBy: string; close: () => void }) {
  const previousFocus = useRef(typeof document !== "undefined" ? document.activeElement : null);
  const titles: Record<string, string> = { "wolf-invite-title": "Personen einladen", "wolf-settings-title": "Spielregeln", "wolf-role-title": "Deine geheime Rolle", "local-role-info-title": "Private Rolleninfo", "village-details-title": "Dorf und Abstimmungen" };
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent className={`werewolf-theme wolf-dialog ${className}`} showCloseButton={false} aria-describedby={undefined} onCloseAutoFocus={(event) => { event.preventDefault(); if (previousFocus.current instanceof HTMLElement) previousFocus.current.focus(); }}><DialogTitle className="sr-only">{titles[labelledBy] ?? "Werwolf"}</DialogTitle>{children}</DialogContent></Dialog>;
}

function DeathCauseIcon({ cause }: { cause: DeathCause }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {cause === "wolf_attack" && <path d="M8 4 5 19M14 3l-3 18m8-15-3 14" />}
    {cause === "witch_poison" && <><path d="M9 2h6m-5 0v5l-4 5v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8l-4-5V2" /><path d="M7 14c3-2 7 2 10 0m-7-7h4" /></>}
    {cause === "white_werewolf" && <><path d="M15 3a7 7 0 1 0 6 11 8 8 0 0 1-6-11Z" /><path d="m6 12-2 8m7-8-2 9m7-7-2 8" /></>}
    {cause === "village_vote" && <><path d="M4 10h16v11H4zM8 14h8" /><path d="m8 3 9 3-2 6-9-3z" /></>}
    {cause === "scapegoat" && <><path d="M7 9C3 8 3 4 4 2c1 3 3 4 6 4m7 3c4-1 4-5 3-7-1 3-3 4-6 4" /><path d="M6 10c0-3 12-3 12 0v6c0 4-3 6-6 6s-6-2-6-6zM9 14h.01M15 14h.01M10 18h4" /></>}
    {cause === "hunter_shot" && <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v4m0 12v4M2 12h4m12 0h4" /></>}
    {cause === "heartbreak" && <path d="M12 21S3 16 3 9c0-5 6-7 9-3 3-4 9-2 9 3 0 7-9 12-9 12Zm1-15-3 6 4 1-3 7" />}
  </svg>;
}

function DeathCauseList({ causes, compact = false }: { causes: DeathCause[]; compact?: boolean }) {
  if (!causes.length) return <span className={`death-cause-unknown ${compact ? "is-compact" : ""}`} title="Todesursache nicht erfasst">?</span>;
  return <span className={`death-cause-list ${compact ? "is-compact" : ""}`} aria-label={causes.map((cause) => DEATH_CAUSE_INFO[cause].label).join(", ")}>
    {causes.map((cause) => <span className={`death-cause-badge cause-${cause}`} title={DEATH_CAUSE_INFO[cause].label} key={cause}><DeathCauseIcon cause={cause} /><span className="sr-only">{DEATH_CAUSE_INFO[cause].label}</span></span>)}
  </span>;
}

function DeathLegend({ causes }: { causes: DeathCause[] }) {
  const uniqueCauses = [...new Set(causes)];
  if (!uniqueCauses.length) return null;
  return <div className="death-legend" aria-label="Legende der Todesursachen">{uniqueCauses.map((cause) => <span key={cause}><i className={`cause-${cause}`}><DeathCauseIcon cause={cause} /></i>{DEATH_CAUSE_INFO[cause].label}</span>)}</div>;
}

function VictimDeathAlert({ causes }: { causes: DeathCause[] }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if ("vibrate" in navigator) navigator.vibrate([180, 100, 180]);
    const timer = window.setTimeout(() => setVisible(false), 10000);
    return () => window.clearTimeout(timer);
  }, []);
  return <Dialog open={visible} onOpenChange={setVisible}><DialogContent className="werewolf-theme wolf-dialog victim-notice" showCloseButton={false} aria-describedby="victim-death-description"><div className="role-orb team-wolf"><Skull aria-hidden="true" /></div><DialogTitle>Du bist ausgeschieden.</DialogTitle><DeathCauseList causes={causes} /><p id="victim-death-description">{causes.length ? causes.map((cause) => DEATH_CAUSE_INFO[cause].label).join(" · ") : "Die Todesursache ist unbekannt."} Du kannst die Partie weiterverfolgen.</p><p className="field-hint">Dieser Hinweis schließt nach zehn Sekunden von selbst. Du musst nichts bestätigen.</p><Button className="victim-death-dismiss" variant="outline" onClick={() => setVisible(false)}>Hinweis schließen</Button></DialogContent></Dialog>;
}

function VillageGuiltFrame({ count }: { count: number }) {
  const intensity = villageGuiltIntensity(count);
  const bloodStyle = {
    "--village-blood-depth": `${16 + intensity * 7}px`,
    "--village-blood-shadow-size": `${8 + intensity * 4}px`,
    "--village-blood-edge-alpha": Math.min(.72, .12 + intensity * .035),
    "--village-blood-bottom-alpha": Math.min(.66, .1 + intensity * .03),
    "--village-blood-side-alpha": Math.min(.68, .1 + intensity * .032),
    "--village-blood-shadow-alpha": Math.min(.7, .12 + intensity * .035),
    "--village-blood-growth-two": `${intensity * 2}px`,
    "--village-blood-growth-three": `${intensity * 3}px`,
    "--village-blood-stain-opacity": Math.min(.94, .24 + intensity * .1),
    "--village-blood-drip-width": `${4 + intensity * .55}px`,
    "--village-blood-drip-height": `${10 + intensity * 5}px`,
    "--village-blood-short-drip-height": `${7 + intensity * 4}px`,
    "--village-blood-drip-one-opacity": Math.min(.82, Math.max(0, intensity * .19)),
    "--village-blood-drip-two-opacity": Math.min(.82, Math.max(0, (intensity - 1) * .19)),
    "--village-blood-drip-three-opacity": Math.min(.82, Math.max(0, (intensity - 2) * .19)),
    "--village-blood-drip-four-opacity": Math.min(.82, Math.max(0, (intensity - 3) * .19)),
    "--village-blood-drip-five-opacity": Math.min(.82, Math.max(0, (intensity - 4) * .19)),
    "--village-blood-drip-six-opacity": Math.min(.82, Math.max(0, (intensity - 5) * .19)),
  } as CSSProperties;
  return <>
    {count > 0 && <div
      className="village-guilt-frame"
      data-village-kills={count}
      style={bloodStyle}
      aria-hidden="true"
    >
      <span className="village-guilt-surface">
        <span className="village-blood-stains" />
        <i className="village-blood-drip drip-one" />
        <i className="village-blood-drip drip-two" />
        <i className="village-blood-drip drip-three" />
        <i className="village-blood-drip drip-four" />
        <i className="village-blood-drip drip-five" />
        <i className="village-blood-drip drip-six" />
      </span>
    </div>}
    <span className="sr-only village-guilt-summary" role="status" aria-live="polite" aria-atomic="true">{count < 1 ? "" : count === 1 ? "Das Dorf trägt Verantwortung für einen Tod durch seine Entscheidungen." : `Das Dorf trägt Verantwortung für ${count} Tode durch seine Entscheidungen.`}</span>
  </>;
}

function WolfTopbar({ title, onBack, online = true, local = false }: { title: string; onBack?: () => void; online?: boolean; local?: boolean }) {
  return <header className="topbar wolf-topbar">{onBack ? <Button variant="ghost" size="icon" className="icon-button" onClick={onBack} aria-label="Zurück"><ArrowLeft /></Button> : <WolfMark />}<strong className="topbar-title">{title}</strong><Connection online={online} local={local} /></header>;
}

const RESUME_STATUS_LABEL: Record<LobbyState["lobby"]["status"], string> = { waiting: "Dorf wartet auf den Start", playing: "Partie läuft", results: "Partie beendet" };

export default function WerewolfHome() {
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [storedSession, setStoredSession] = useState<Session | null>(null); const [storedLobby, setStoredLobby] = useState<ResumeLobbyInfo | null | undefined>(undefined);
  const [receipt, setReceipt] = useState("");
  const posting = useRef(false);
  const [screen, setScreen] = useState<Screen>("home"); const [session, setSession] = useState<Session | null>(null); const [state, setState] = useState<LobbyState | null>(null);
  const [nearby, setNearby] = useState<NearbyLobby[]>([]); const [inviteLobbyId, setInviteLobbyId] = useState(""); const [notice, setNotice] = useState(""); const [online, setOnline] = useState(true); const [busy, setBusy] = useState(false);
  const showError = useCallback((error: unknown) => setNotice(error instanceof Error ? error.message : "Etwas ist schiefgelaufen."), []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine); window.addEventListener("online", update); window.addEventListener("offline", update);
    const timer = window.setTimeout(() => {
      setOnline(navigator.onLine);
      let stored: string | null = null;
      try { stored = localStorage.getItem("gameson:werewolf:session"); } catch { /* storage unavailable */ }
      const startup = resolveOnlineGameStartup(window.location.search, stored);
      if (startup.kind === "resume") setSession(startup.session);
      else if (startup.kind === "choose") setStoredSession(startup.session);
      else if (startup.kind === "join") { setInviteLobbyId(startup.lobbyId); setScreen("join"); }
      else if (startup.kind === "local") setScreen("local");
    }, 0);
    return () => { clearTimeout(timer); window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => { if (!session) return; localStorage.setItem("gameson:werewolf:session", JSON.stringify(session)); window.history.replaceState({}, "", `/werwolf?lobby=${encodeURIComponent(session.lobbyId)}`); }, [session]);
  // Describe the stored round while the player decides; an invalid session leaves only "new game" to choose.
  useEffect(() => {
    if (!storedSession) return;
    let active = true;
    api<LobbyState>(`/api/werwolf?action=state&lobbyId=${encodeURIComponent(storedSession.lobbyId)}`, { headers: { Authorization: `Bearer ${storedSession.token}` } })
      .then((data) => { if (active) setStoredLobby({ name: data.lobby.name, detail: describeLobby(data.players.length, RESUME_STATUS_LABEL[data.lobby.status]) }); })
      .catch((error: unknown) => { if (active) setStoredLobby(error instanceof Error && error.message.includes("Sitzung") ? null : { detail: "Gerade keine Verbindung. Du kannst trotzdem entscheiden." }); });
    return () => { active = false; };
  }, [storedSession]);
  useEffect(() => { if (session || !online || (screen !== "home" && screen !== "join")) return; let active = true; const load = () => api<{ lobbies: NearbyLobby[] }>("/api/werwolf?action=nearby").then((data) => { if (active) setNearby(data.lobbies); }).catch(() => undefined); load(); const timer = setInterval(load, 10000); return () => { active = false; clearInterval(timer); }; }, [online, screen, session]);
  useEffect(() => { if (!session && screen !== "local") stopWerewolfAudio(); }, [screen, session]);
  useEffect(() => () => stopWerewolfAudio(), []);

  const fetchState = useCallback(async (quiet = false) => {
    if (!session) return; try { const data = await api<LobbyState>(`/api/werwolf?action=state&lobbyId=${encodeURIComponent(session.lobbyId)}`, { headers: { Authorization: `Bearer ${session.token}` } }); setState((current) => !current || data.serverTime >= current.serverTime ? data : current); setOnline(true); }
    catch (error) { setOnline(false); if (!quiet) showError(error); if (error instanceof Error && error.message.includes("Sitzung")) { localStorage.removeItem("gameson:werewolf:session"); setSession(null); setState(null); window.history.replaceState({}, "", "/werwolf"); } }
  }, [session, showError]);
  useEffect(() => { if (!session) return; const first = setTimeout(() => fetchState(), 0); const timer = setInterval(() => fetchState(true), document.hidden ? 5000 : 1500); return () => { clearTimeout(first); clearInterval(timer); }; }, [session, fetchState]);
  const post = useCallback<PostAction>(async (action, values = {}) => {
    if (!session || posting.current) return false;
    posting.current = true;
    setBusy(true); setNotice(""); setReceipt("");
    try {
      await api("/api/werwolf", { method: "POST", headers: { Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ action, lobbyId: session.lobbyId, ...values }) });
      const messages: Record<string, string> = { vote: "Deine Stimme ist bestätigt.", act: "Deine Entscheidung ist bestätigt.", acknowledge_role: "Deine Rolle ist bestätigt.", wake_up: "Deine Bereitschaft ist bestätigt.", acknowledge_seer_result: "Ergebnis gelesen und bestätigt.", settings: "Die Spielregeln sind gespeichert.", start: "Die Partie wurde gestartet.", advance: "Die Abstimmung wurde gestartet.", new_match: "Die nächste Partie ist vorbereitet." };
      setReceipt(messages[action] ?? "Änderung bestätigt.");
      await fetchState();
      return true;
    } catch (error) {
      showError(new Error(`Keine Bestätigung erhalten. ${error instanceof Error ? error.message : "Bitte prüfe deine Verbindung und versuche es erneut."}`));
      return false;
    } finally { posting.current = false; setBusy(false); }
  }, [session, fetchState, showError]);
  const confirmLeave = async () => {
    if (state?.me.isHost && (state.lobby.status === "waiting" || state.lobby.status === "results")) {
      if (session) {
        setBusy(true);
        try { await api("/api/werwolf", { method: "POST", headers: { Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ action: "close", lobbyId: session.lobbyId }) }); }
        catch (error) { showError(error); setBusy(false); return; }
        setBusy(false);
      }
    }
    setLeaveOpen(false);
    localStorage.removeItem("gameson:werewolf:session"); setSession(null); setState(null); setReceipt(""); window.history.replaceState({}, "", "/werwolf");
  };

  const leave = () => setLeaveOpen(true);
  const closesVillage = state?.me.isHost && state.lobby.status !== "playing";
  const leaveDialog = <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}><DialogContent className="werewolf-theme wolf-dialog" showCloseButton={false} aria-describedby="leave-description"><DialogTitle>{closesVillage ? "Dorf wirklich schließen?" : "Partie verlassen?"}</DialogTitle><p id="leave-description" className="dialog-copy">{closesVillage ? "Alle Personen werden getrennt und die Spieldaten dieser Lobby gelöscht." : "Deine Rolle bleibt in der laufenden Partie. Du verlässt die Ansicht auf diesem Gerät."}</p><div className="dialog-actions"><Button variant="outline" onClick={() => setLeaveOpen(false)} disabled={busy}>Im Dorf bleiben</Button><Button className="wolf-primary" disabled={busy} onClick={() => void confirmLeave()}><DoorOpen aria-hidden="true" />{closesVillage ? "Dorf schließen" : "Partie verlassen"}</Button></div></DialogContent></Dialog>;

  const resumeStoredSession = () => { if (!storedSession) return; setStoredSession(null); setStoredLobby(undefined); setSession(storedSession); };
  const discardStoredSession = () => { try { localStorage.removeItem("gameson:werewolf:session"); } catch { /* storage unavailable */ } setStoredSession(null); setStoredLobby(undefined); };

  const activeNotice = notice && <Notice message={notice} clear={() => setNotice("")} />;
  if (session) return <><OnlineGame state={state} session={session} online={online} busy={busy} post={post} leave={leave} showError={showError} receipt={receipt} clearReceipt={() => setReceipt("")} />{leaveDialog}{activeNotice}</>;
  if (screen === "create") return <><LobbyForm kind="create" onBack={() => setScreen("home")} onDone={setSession} showError={showError} />{activeNotice}</>;
  if (screen === "join") return <><LobbyForm kind="join" nearby={nearby} inviteLobbyId={inviteLobbyId} onPick={setInviteLobbyId} onBack={() => { setInviteLobbyId(""); setScreen("home"); window.history.replaceState({}, "", "/werwolf"); }} onDone={setSession} showError={showError} />{activeNotice}</>;
  if (screen === "local") return <><LocalWerewolf onBack={() => setScreen("home")} showError={showError} />{activeNotice}</>;

  return <main className="werewolf-home">
    <GameBackLink />
    <header className="entry-header"><div className="entry-brand"><WolfMark /><strong>werwolf<small>Ein Spiel von Gameson</small></strong></div><Connection online={online} /></header>
    <section className="entry-intro"><span className="wolf-step">Ein Dorf. Ein Rudel. Eure Runde.</span><h1>Wie möchtet ihr<br />spielen?</h1><p>Findet die Werwölfe unter euch. Wir führen euch Schritt für Schritt durch das Spiel.</p></section>
    <GameModes onCreate={() => setScreen("create")} onJoin={() => setScreen("join")} onLocal={() => setScreen("local")} />
    <GameRules game="werewolf" />
    <p className="entry-footnote">Ab 3 Personen · Kein Konto nötig</p>
    {storedSession && <ResumeSessionDialog theme="werewolf" lobby={storedLobby} onResume={resumeStoredSession} onDiscard={discardStoredSession} />}
    {activeNotice}
  </main>;
}

function LobbyForm({ kind, nearby = [], inviteLobbyId = "", onPick, onBack, onDone, showError }: { kind: "create" | "join"; nearby?: NearbyLobby[]; inviteLobbyId?: string; onPick?: (id: string) => void; onBack: () => void; onDone: (session: Session) => void; showError: (error: unknown) => void }) {
  const [groupName, setGroupName] = useState(""); const [playerName, setPlayerName] = useState(""); const [busy, setBusy] = useState(false);
  const selectedLobby = nearby.find((item) => item.id === inviteLobbyId);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true);
    try { onDone(await api<Session>("/api/werwolf", { method: "POST", body: JSON.stringify({ action: kind, groupName, playerName, lobbyId: inviteLobbyId || undefined }) })); }
    catch (error) { showError(error); } finally { setBusy(false); }
  };
  return <main className="app-shell werewolf-shell"><WolfTopbar title={kind === "create" ? "Lobby erstellen" : "Lobby beitreten"} onBack={onBack} />
    <section className="page-intro"><span className="wolf-step">{kind === "create" ? "Erst die Lobby, dann die Gruppe" : "Willkommen im Dorf"}</span><h1>{kind === "create" ? "Wie heißt eure Runde?" : "Wie heißt du?"}</h1><p>{kind === "create" ? "Erstelle eure Lobby. Danach lädst du die anderen ein und startest gemeinsam mit ihnen." : "Trage deinen Namen ein. In der Lobby wartet ihr gemeinsam auf den Spielstart."}</p></section>
    {inviteLobbyId && <div className="selected-lobby"><span><small>Du trittst dieser Lobby bei</small><strong>{selectedLobby?.name ?? "Lobby aus deinem Einladungslink"}</strong></span><Button variant="outline" onClick={() => onPick?.("")}>Ändern</Button></div>}
    {kind === "join" && !inviteLobbyId && nearby.length > 0 && <section className="nearby-section"><div className="section-heading"><strong>Lobby in deiner Nähe auswählen</strong></div><div className="nearby-list">{nearby.map((item) => <Button variant="outline" type="button" key={item.id} onClick={() => onPick?.(item.id)}><Users aria-hidden="true" /><span><strong>{item.name}</strong><small>{item.player_count} Personen</small></span><ChevronRight aria-hidden="true" /></Button>)}</div></section>}
    <form className="form-card wolf-form" onSubmit={submit}>
      {(kind === "create" || !inviteLobbyId) && <label htmlFor="wolf-village-name">{kind === "create" ? "Name der Lobby" : "Name eurer Lobby"}<Input id="wolf-village-name" value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder={kind === "create" ? "z. B. Freitagsrunde" : "Frag die Person, die eure Lobby erstellt hat"} minLength={2} maxLength={28} autoComplete="off" required /></label>}
      <label htmlFor="wolf-player-name">Dein Name im Spiel<Input id="wolf-player-name" value={playerName} onChange={(event) => setPlayerName(event.target.value)} placeholder="z. B. Robin" minLength={2} maxLength={24} autoComplete="nickname" required /></label>
      <p className="field-hint">{kind === "create" ? "Mit dem nächsten Knopf erstellst du die Lobby. Die Partie startet erst später." : "Mit dem nächsten Knopf bestätigst du deinen Beitritt."}</p>
      <Button className="primary-button wolf-primary" disabled={busy}>{busy ? "Verbindung wird hergestellt …" : kind === "create" ? "Lobby erstellen" : "Jetzt beitreten"}<ArrowUpRight aria-hidden="true" /></Button>
    </form>
  </main>;
}

function OnlineGame({ state, session, online, busy, post, leave, showError, receipt, clearReceipt }: { receipt: string; clearReceipt: () => void; state: LobbyState | null; session: Session; online: boolean; busy: boolean; post: PostAction; leave: () => void; showError: (error: unknown) => void }) {
  const [inviteOpen, setInviteOpen] = useState(false); const [settingsOpen, setSettingsOpen] = useState(false); const [roleOpen, setRoleOpen] = useState(false); const [qr, setQr] = useState("");
  const [audioReady, setAudioReady] = useState(false); const playedCue = useRef(""); const playedWinnerCue = useRef(""); const announcedNight = useRef(""); const announcedInitialSleep = useRef("");
  const shareUrl = typeof window === "undefined" ? "" : `${window.location.origin}/werwolf?lobby=${session.lobbyId}`;
  useEffect(() => { if (shareUrl) QRCode.toDataURL(shareUrl, { width: 420, margin: 1, color: { dark: "#192333", light: "#ffffff" } }).then(setQr).catch(() => undefined); }, [shareUrl]);
  useAutomaticAudioUnlock(audioReady, setAudioReady);
  const enableAudio = useCallback(async () => { try { if (await unlockWerewolfAudio()) setAudioReady(true); else showError(new Error("Der Browser blockiert den Ton noch. Tippe einmal auf den Bildschirm und versuche es dann erneut.")); } catch (error) { showError(error); } }, [showError]);
  useEffect(() => {
    if (!state || !audioReady || state.lobby.status !== "playing" || !WEREWOLF_AUDIO_PHASES.includes(state.lobby.phase)) return;
    if (state.lobby.audioMode === "host" && !state.me.isHost) return;
    const cueKey = `${state.lobby.matchNumber}:${state.lobby.night}:${state.lobby.phase}:${state.lobby.phaseStartedAt}`;
    if (playedCue.current === cueKey) return;
    playedCue.current = cueKey;
    const delay = state.lobby.phaseStartedAt + 1800 - state.serverTime;
    let transition: "sleep-all" | "sleep-again" | "night-start" | "day-start" | "day-resolution" | null = "sleep-again";
    if (state.lobby.phase === "dawn") transition = state.lobby.resolutionSource === "day" ? "day-resolution" : "day-start";
    else if (["role_reveal", "mayor_vote", "discussion", "day_vote", "runoff", "hunter"].includes(state.lobby.phase)) transition = null;
    else if (state.lobby.night > 0) {
      const nightKey = `${state.lobby.matchNumber}:${state.lobby.night}`;
      if (announcedNight.current !== nightKey) { transition = "night-start"; announcedNight.current = nightKey; }
    } else {
      const matchKey = String(state.lobby.matchNumber);
      if (announcedInitialSleep.current !== matchKey) { transition = "sleep-all"; announcedInitialSleep.current = matchKey; }
    }
    playWerewolfPhaseCue(state.lobby.phase, Math.max(0, delay), transition, state.lobby.audioGapSeconds);
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
  const shouldPlayHere = Boolean(state && (state.lobby.audioMode === "all" || state.me.isHost));
  const hasCurrentAnnouncement = Boolean(state && shouldPlayHere && (
    (state.lobby.status === "results" && state.lobby.winner)
    || (state.lobby.status === "playing" && WEREWOLF_AUDIO_PHASES.includes(state.lobby.phase))
  ));
  useEffect(() => { if (!hasCurrentAnnouncement) stopWerewolfAudio(); }, [hasCurrentAnnouncement]);
  if (!state) return <main className="app-shell werewolf-shell"><WolfTopbar title="Lobby öffnen" onBack={leave} online={online} /><Card className="task-card loading-card"><CardContent><TaskStatus guidance={{ status: "waiting", label: online ? "Verbindung wird hergestellt" : "Verbindung unterbrochen", title: online ? "Deine Lobby wird geladen …" : "Prüfe deine Internetverbindung.", instruction: "Du musst nichts bestätigen. Wir versuchen die Verbindung automatisch wiederherzustellen.", requiresConfirmation: false }} /></CardContent></Card></main>;
  const mayor = state.players.find((player) => player.id === state.lobby.mayorPlayerId);
  const me = state.players.find((player) => player.id === state.me.id);
  const showsFreshDeath = Boolean(me && !me.alive && (state.lobby.phase === "dawn" || state.lobby.phase === "results") && me.deathMatchNumber === state.lobby.matchNumber && me.deathCycle === state.lobby.night && me.deathSource === state.lobby.resolutionSource);
  const villageKillCount = countVillageDecisionDeaths(state.players);
  return <main className="app-shell werewolf-shell online-game-shell"><WolfTopbar title={state.lobby.name} onBack={leave} online={online} />
    <VillageGuiltFrame count={villageKillCount} />
    {receipt && <ConfirmationReceipt message={receipt} clear={clearReceipt} />}
    {!online && <p className="connection-warning" role="status">Verbindung unterbrochen. Bestätigungen werden erst nach einer Antwort des Servers als gespeichert angezeigt.</p>}
    {showsFreshDeath && me && <VictimDeathAlert key={`${me.deathMatchNumber}:${me.deathCycle}:${me.deathSource}`} causes={me.deathCauses} />}
    {state.lobby.status === "waiting" ? <WaitingRoom state={state} busy={busy} post={post} invite={() => setInviteOpen(true)} settings={() => setSettingsOpen(true)} audioReady={audioReady} enableAudio={enableAudio} /> : <GamePhase state={state} busy={busy} post={post} close={leave} openRole={() => setRoleOpen(true)} mayorName={mayor?.name ?? null} />}
    {(state.canClaimHost || (state.lobby.status !== "waiting" && shouldPlayHere && !audioReady)) && <div className="game-floating-actions">{state.canClaimHost && <Button className="claim-host" type="button" onClick={() => post("claim_host")}>Host ist weg · Leitung übernehmen</Button>}{state.lobby.status !== "waiting" && shouldPlayHere && !audioReady && <Button className="game-audio-enable" type="button" onClick={() => void enableAudio()}>Spielton aktivieren</Button>}</div>}
    {inviteOpen && <InviteSheet qr={qr} name={state.lobby.name} url={shareUrl} close={() => setInviteOpen(false)} showError={showError} />}
    {settingsOpen && <OnlineSettings state={state} busy={busy} post={post} close={() => setSettingsOpen(false)} />}
    {roleOpen && state.privateRole && <RoleSheet role={state.privateRole} close={() => setRoleOpen(false)} />}
  </main>;
}

function ConfirmationReceipt({ message, clear }: { message: string; clear?: () => void }) {
  return <div className="confirmation-receipt" role="status"><Check aria-hidden="true" /><span><strong>Letzte Bestätigung</strong>{message}</span>{clear && <Button variant="ghost" size="icon" onClick={clear} aria-label="Bestätigungshinweis schließen"><X aria-hidden="true" /></Button>}</div>;
}

function WaitingRoom({ state, busy, post, invite, settings, audioReady, enableAudio }: { state: LobbyState; busy: boolean; post: PostAction; invite: () => void; settings: () => void; audioReady: boolean; enableAudio: () => Promise<void> }) {
  const playsHere = state.lobby.audioMode === "all" || state.me.isHost;
  const lobbyReady = state.players.length >= 3;
  const missing = Math.max(0, 3 - state.players.length);
  const host = state.players.find((player) => player.isHost)?.name ?? "Die Spielleitung";
  const indexedPlayers = state.players.map((player, index) => ({ player, index }));
  const readyPlayers = indexedPlayers.filter(({ player }) => player.online);
  const waitingPlayers = indexedPlayers.filter(({ player }) => !player.online);
  const renderPlayer = ({ player, index }: (typeof indexedPlayers)[number]) => <div className={`player-chip ${player.online ? "is-online" : "is-offline"}`} key={player.id}>
    <span className={`avatar avatar-${index % 5}`}>{player.name.charAt(0)}</span><span className="player-chip-copy"><strong>{player.name}{player.isHost && <Badge variant="outline" className="host-badge">Spielleitung</Badge>}</strong><small>{player.id === state.me.id ? "Das bist du" : player.online ? "Ist in der Lobby" : "Verbindung prüfen"}</small></span>
    <span className={`player-presence ${player.online ? "is-ready" : "is-offline"}`}><i />{player.online ? "Online" : "Offline"}</span>
    {state.me.isHost && !player.isHost && <Button variant="ghost" size="icon" className="player-remove" disabled={busy} aria-label={`${player.name} aus dem Dorf entfernen`} onClick={() => post("remove", { playerId: player.id })}><X aria-hidden="true" /></Button>}
  </div>;
  return <section className="lobby-workspace">
    <Card className="task-card"><CardContent><TaskStatus busy={busy} guidance={state.me.isHost ? { status: "action", label: "Du leitest die Runde", title: lobbyReady ? "Sind alle da? Dann geht’s los." : `Lade noch ${missing} ${missing === 1 ? "Person" : "Personen"} ein.`, instruction: lobbyReady ? "Prüfe die Namen unten. Wenn eure Gruppe vollständig ist, starte die Partie mit dem roten Knopf." : "Teile den Einladungslink oder lass die anderen den QR-Code scannen. Ihr braucht mindestens drei Personen.", requiresConfirmation: true } : { status: "waiting", label: "Du bist beigetreten · Nichts zu bestätigen", title: `Warte auf ${host}.`, instruction: `${host} startet die Partie, sobald alle da sind. Du musst nichts bestätigen; deine Rolle erscheint automatisch.`, requiresConfirmation: false }} /></CardContent></Card>
    <Card className="lobby-members"><CardHeader><h2>Eure Gruppe <Badge variant="secondary">{state.players.length}</Badge></h2><Button variant="outline" size="sm" onClick={invite}><Plus aria-hidden="true" />Einladen</Button></CardHeader><CardContent><div className="player-groups">
      <section className="player-group" aria-labelledby="wolf-ready-players"><header className="player-group-heading is-ready"><h3 id="wolf-ready-players"><i />Online</h3><span>{readyPlayers.length}</span></header><div className="player-grid">{readyPlayers.map(renderPlayer)}</div></section>
      {waitingPlayers.length > 0 && <section className="player-group" aria-labelledby="wolf-waiting-players"><header className="player-group-heading is-waiting"><h3 id="wolf-waiting-players"><i />Gerade offline</h3><span>{waitingPlayers.length}</span></header><div className="player-grid">{waitingPlayers.map(renderPlayer)}</div></section>}
    </div></CardContent></Card>
    <Card className="lobby-rules-card"><CardHeader><h2>So spielt ihr</h2>{state.me.isHost && <Button variant="ghost" size="sm" onClick={settings}><Settings2 aria-hidden="true" />Anpassen</Button>}</CardHeader><CardContent><div className="lobby-summary-row"><span><Moon aria-hidden="true" />{state.lobby.wolfCount} {state.lobby.wolfCount === 1 ? "Werwolf" : "Werwölfe"}</span><span><Sparkles aria-hidden="true" />{state.lobby.selectedRoles.length ? `${state.lobby.selectedRoles.length} Zusatzrollen` : "Klassische Rollen"}</span>{state.lobby.mayorEnabled && <span><Crown aria-hidden="true" />Mit Bürgermeister</span>}</div>{state.lobby.selectedRoles.length > 0 && <div className="lobby-role-tags">{state.lobby.selectedRoles.map((role) => <Badge key={role} variant="secondary">{ROLE_INFO[role].label}</Badge>)}</div>}</CardContent></Card>
    <Card className={`lobby-audio-card ${audioReady ? "ready" : ""}`}><CardContent><div className="audio-card-heading"><AudioLines aria-hidden="true" /><strong>Ansagen vorlesen lassen <Badge variant="outline">{playsHere && audioReady ? "Bereit" : "Automatisch"}</Badge></strong></div><p>{playsHere ? audioReady ? "Der Ton ist auf diesem Gerät eingeschaltet." : "Der Ton schaltet sich automatisch ein, sobald du hier etwas antippst. Du kannst ihn auch jetzt einschalten und testen." : `Die Ansagen laufen bei ${host}. Auf deinem Gerät ist nichts einzustellen.`}</p>{playsHere && <Button variant="outline" disabled={audioReady} onClick={() => void enableAudio()}>{audioReady ? <Check aria-hidden="true" /> : <AudioLines aria-hidden="true" />}{audioReady ? "Ton ist eingeschaltet" : "Ton einschalten"}</Button>}</CardContent></Card>
    {state.me.isHost && <ConfirmBar label={lobbyReady ? "Partie starten" : "Personen einladen"} summary={lobbyReady ? `${state.players.length} Personen in der Lobby` : `Es ${missing === 1 ? "fehlt noch eine Person" : `fehlen noch ${missing} Personen`}`} instruction={lobbyReady ? "Erst mit diesem Knopf werden die Rollen verteilt." : "Öffne die Einladung und teile sie mit deiner Gruppe."} busy={busy} stage={lobbyReady ? "Start bestätigen" : "Dein nächster Schritt"} onConfirm={lobbyReady ? () => post("start") : invite} />}
  </section>;
}

function GamePhase({ state, busy, post, close, openRole, mayorName }: { state: LobbyState; busy: boolean; post: PostAction; close: () => void; openRole: () => void; mayorName: string | null }) {
  useEffect(() => { window.scrollTo(0, 0); }, [state.lobby.phase, state.lobby.night, state.lobby.matchNumber, state.lobby.resolutionSource]);
  if (state.lobby.phase === "role_reveal") return <RoleRevealGate state={state} busy={busy} post={post} />;
  const isNightHandoff = state.lobby.phase === "dawn" && state.lobby.resolutionSource === "day";
  const dead = state.players.filter((player) => !player.alive);
  const guidance = getGameGuidance({ phase: state.lobby.phase, alive: state.me.alive, isHost: state.me.isHost, submitted: Boolean(state.ownSubmission), hasAction: Boolean(state.action), hostName: state.players.find((player) => player.isHost)?.name, startsNight: isNightHandoff });
  return <section className={`wolf-phase play-surface phase-${state.lobby.phase}`}>
    <PhaseHeader phase={state.lobby.phase} night={state.lobby.night} title={isNightHandoff ? "Vorbereitung auf die Nacht" : PHASE_COPY[state.lobby.phase].title} living={state.players.length - dead.length} total={state.players.length} nightHandoff={isNightHandoff} />
    <div className="game-tools">{state.privateRole && <PrivateRoleButton onClick={openRole} alive={state.me.alive} />}<GameStatusDetails state={state} />{mayorName && <span className="mayor-status"><Crown aria-hidden="true" />{mayorName}</span>}</div>
    {state.lobby.phase === "results" ? <ResultsBoard state={state} post={post} close={close} busy={busy} />
      : state.lobby.phase === "dawn" ? <><DawnWakePanel key={`${state.lobby.matchNumber}:${state.lobby.night}:${state.lobby.resolutionSource}`} state={state} busy={busy} post={post} /><DeathBoard players={dead} /></>
      : state.lobby.phase === "discussion" ? <Card className="task-card"><CardContent><TaskStatus guidance={guidance} busy={busy} />{state.me.isHost && <ConfirmBar label="Abstimmung starten" summary="Ist eure Diskussion abgeschlossen?" instruction="Tippe erst hier, wenn alle ihre Vermutungen geteilt haben." stage="Du bestimmst, wann es weitergeht" busy={busy} onConfirm={() => post("advance")} />}</CardContent></Card>
      : state.action ? <ActionPanel key={`${state.lobby.matchNumber}:${state.lobby.night}:${state.lobby.phase}`} state={state} busy={busy} post={post} />
      : <Card className="task-card"><CardContent><TaskStatus guidance={guidance} /><ActionProgress submitted={state.progress.submitted} required={state.progress.required} /></CardContent></Card>}
    {state.canSkip && <SkipPhaseControl busy={busy} post={post} />}
  </section>;
}

function SkipPhaseControl({ busy, post }: { busy: boolean; post: PostAction }) {
  const [open, setOpen] = useState(false);
  return <><Button variant="ghost" className="skip-phase" onClick={() => setOpen(true)}>Runde hängt fest?</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="werewolf-theme wolf-dialog" aria-describedby="skip-explanation"><DialogTitle>Ausstehende Aktionen überspringen?</DialogTitle><p id="skip-explanation">Verwende diesen Schritt nur, wenn jemand nicht mehr antwortet. Noch offene Entscheidungen werden übersprungen und die Runde geht weiter.</p><div className="dialog-actions"><Button variant="outline" onClick={() => setOpen(false)}>Weiter warten</Button><Button className="wolf-primary" disabled={busy} onClick={async () => { if (await post("skip")) setOpen(false); }}>Überspringen bestätigen</Button></div></DialogContent></Dialog></>;
}

function VillageDetails({ players, rounds, mayorPlayerId, meId }: { players: PlayerView[]; rounds: VoteHistoryRound[]; mayorPlayerId: string | null; meId?: string }) {
  const [open, setOpen] = useState(false);
  return <><Button variant="outline" onClick={() => setOpen(true)}><Users aria-hidden="true" />Dorf &amp; Verlauf</Button>{open && <ModalSheet labelledBy="village-details-title" close={() => setOpen(false)}><header className="details-heading"><h2 id="village-details-title">Dorf &amp; Verlauf</h2><Button variant="ghost" size="icon" aria-label="Dorfübersicht schließen" onClick={() => setOpen(false)}><X aria-hidden="true" /></Button></header><Tabs defaultValue="village"><TabsList className="village-tab-list" aria-label="Dorfstatus & Abstimmungen"><TabsTrigger value="village"><Users aria-hidden="true" />Das Dorf</TabsTrigger><TabsTrigger value="votes"><Vote aria-hidden="true" />Abstimmungen</TabsTrigger></TabsList><TabsContent value="village"><VillageOverview players={players} mayorPlayerId={mayorPlayerId} meId={meId} /></TabsContent><TabsContent value="votes"><VoteHistoryBoard rounds={rounds} /></TabsContent></Tabs></ModalSheet>}</>;
}

function GameStatusDetails({ state }: { state: LobbyState }) {
  return <VillageDetails players={state.players} rounds={state.voteHistory} mayorPlayerId={state.lobby.mayorPlayerId} meId={state.me.id} />;
}

function RoleRevealGate({ state, busy, post }: { state: LobbyState; busy: boolean; post: PostAction }) {
  const [revealed, setRevealed] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const role = state.privateRole;
  const submitted = Boolean(state.ownSubmission) || accepted;
  const guidance = getGameGuidance({ phase: "role_reveal", alive: true, isHost: state.me.isHost, submitted, hasAction: true });
  return <section className="wolf-phase play-surface phase-role-reveal">
    <PhaseHeader phase="role_reveal" night={0} title="Rollen kennenlernen" living={state.players.length} total={state.players.length} />
    <Card className="task-card"><CardContent><TaskStatus guidance={revealed && !submitted ? { ...guidance, title: "Lies deine Rolle. Dann bestätige sie.", instruction: "Merke dir deine Aufgabe. Mit dem Knopf unten verbirgst du die Rolle und meldest dich bereit." } : guidance} busy={busy} />
      {!submitted && (revealed && role ? <div className="role-detail"><div className={`role-orb team-${role.team}`}><RoleIcon role={role.role} /></div><Badge variant="outline">{role.team === "village" ? "Team Dorf" : role.team === "wolf" ? "Team Rudel" : "Eigenes Ziel"}</Badge><h3>{role.label}</h3><p>{role.description}</p><Button variant="ghost" onClick={() => setRevealed(false)}><LockKeyhole aria-hidden="true" />Kurz verbergen</Button></div> : <div className="handoff-person"><div className="role-orb"><LockKeyhole aria-hidden="true" /></div><strong>Nur für {state.me.name}</strong><p>Stelle sicher, dass nur du auf den Bildschirm schaust.</p></div>)}
      <ActionProgress submitted={state.progress.submitted} required={state.progress.required} label="Rollen bestätigt" />
    </CardContent></Card>
    {!submitted && <ConfirmBar label={revealed ? "Rolle verstanden · Bereit" : "Meine Rolle öffnen"} summary={revealed ? "Deine Rolle ist noch nicht bestätigt" : `Bist du ${state.me.name}?`} instruction={revealed ? "Bestätige, sobald du deine Aufgabe gelesen hast." : "Öffne deine Karte, wenn niemand mitliest."} stage={revealed ? "Bestätigung erforderlich" : "Schritt 1 von 2 · Ansehen"} busy={busy} disabled={revealed && !role} onConfirm={revealed ? async () => { if (await post("acknowledge_role", { matchNumber: state.lobby.matchNumber })) { setAccepted(true); setRevealed(false); } } : () => setRevealed(true)} />}
  </section>;
}

function DawnWakePanel({ state, busy, post }: { state: LobbyState; busy: boolean; post: PostAction }) {
  const [accepted, setAccepted] = useState(false);
  const startsNight = state.lobby.resolutionSource === "day";
  const submitted = Boolean(state.ownSubmission) || accepted;
  const guidance = getGameGuidance({ phase: "dawn", alive: state.me.alive, isHost: state.me.isHost, submitted, hasAction: true, startsNight });
  return <Card className="task-card"><CardContent><TaskStatus guidance={guidance} busy={busy} />
    {state.me.isHost && startsNight && <aside className="host-night-cue"><strong>Du leitest die Runde</strong><p>Bitte alle, zuerst ihre Bereitschaft zu bestätigen und danach die Augen zu schließen.</p></aside>}
    <ActionProgress submitted={state.progress.submitted} required={state.progress.required} label="Personen sind bereit" />
    {state.me.alive && !submitted && <ConfirmBar label={startsNight ? "Bereit für die Nacht" : "Ich bin aufgestanden"} summary="Deine Bereitschaft fehlt noch" instruction={startsNight ? "Erst bestätigen, dann die Augen schließen." : "Tippe hier, damit eure Runde weitergehen kann."} busy={busy} onConfirm={async () => { if (await post("wake_up", { matchNumber: state.lobby.matchNumber })) setAccepted(true); }} />}
  </CardContent></Card>;
}

function RoleChoiceList({ roles, selected, onSelect, disabled = false }: { roles: WerewolfRole[]; selected: string; onSelect: (role: WerewolfRole) => void; disabled?: boolean }) {
  return <div className="role-choice-grid" aria-label="Eine Rolle auswählen">{[...new Set(roles)].map((role) => <Button variant="outline" key={role} disabled={disabled} className={selected === role ? "is-selected" : ""} aria-pressed={selected === role} onClick={() => onSelect(role)}><RoleIcon role={role} /><strong>{ROLE_INFO[role].label}</strong><span>{ROLE_INFO[role].description}</span><small>{selected === role ? "Ausgewählt · noch bestätigen" : "Rolle auswählen"}</small></Button>)}</div>;
}

function ActionPanel({ state, busy, post }: { state: LobbyState; busy: boolean; post: PostAction }) {
  const action = state.action!;
  const [first, setFirst] = useState(""); const [second, setSecond] = useState(""); const [heal, setHeal] = useState(false);
  const [accepted, setAccepted] = useState(false); const [resultRead, setResultRead] = useState(false);
  const submitted = Boolean(state.ownSubmission) || accepted;
  const guidance = getGameGuidance({ phase: action.phase, alive: state.me.alive, isHost: state.me.isHost, submitted, hasAction: true, seerResult: Boolean(state.actionResult?.seenLabel) && !resultRead });
  const send = async (kind: string, values: Record<string, unknown>) => { if (await post(kind, { phase: action.phase, matchNumber: state.lobby.matchNumber, ...values })) setAccepted(true); };
  if (submitted && action.phase === "seer" && !resultRead) return <Card className="task-card seer-result"><CardContent>
    <TaskStatus guidance={state.actionResult?.seenLabel ? guidance : { status: "waiting", label: "Auswahl bestätigt", title: "Dein Ergebnis wird geladen …", instruction: "Warte einen Moment. Sobald die Rolle erscheint, musst du bestätigen, dass du sie gelesen hast.", requiresConfirmation: false }} busy={busy} />
    {state.actionResult?.seenLabel && <><div className="role-detail"><div className="role-orb"><Eye aria-hidden="true" /></div><span>Nur für dich sichtbar</span><h3>{state.actionResult.name}</h3><p>spielt <strong>{state.actionResult.seenLabel}</strong>.</p></div><ConfirmBar label="Ergebnis gelesen" summary="Die Nacht wartet auf dich" instruction="Bestätige, nachdem du dir die Rolle gemerkt hast." busy={busy} onConfirm={async () => { if (await post("acknowledge_seer_result", { matchNumber: state.lobby.matchNumber })) setResultRead(true); }} /></>}
  </CardContent></Card>;
  if (submitted) return <Card className="task-card"><CardContent><TaskStatus guidance={guidance} /><DecisionSteps confirmed /><ActionProgress submitted={state.progress.submitted} required={state.progress.required} /></CardContent></Card>;
  if (action.phase === "thief") return <Card className="task-card"><CardContent><TaskStatus guidance={guidance} busy={busy} /><DecisionSteps selected={Boolean(first)} /><RoleChoiceList roles={["thief", ...(state.privateRole?.reserveRoles ?? [])]} selected={first} onSelect={setFirst} disabled={busy} /><ConfirmBar label="Rolle bestätigen" summary={first ? ROLE_INFO[first as WerewolfRole].label : "Noch keine Rolle gewählt"} instruction={first ? "Erst mit diesem Knopf übernimmst du die ausgewählte Rolle." : "Wähle zuerst eine Rollenkarte aus."} disabled={!first} busy={busy} onConfirm={() => send("act", { choice: first })} /></CardContent></Card>;
  if (action.phase === "witch") {
    const victim = state.players.find((player) => player.id === action.wolfVictimId);
    const poisonName = action.candidates.find((player) => player.id === second)?.name;
    const summary = [heal && victim ? `${victim.name} heilen` : state.privateRole?.healPotion ? "Heiltrank aufbewahren" : "Heiltrank verbraucht", poisonName ? `${poisonName} vergiften` : state.privateRole?.poisonPotion ? "Gifttrank aufbewahren" : "Gifttrank verbraucht"].join(" · ");
    return <Card className="task-card"><CardContent><TaskStatus guidance={guidance} busy={busy} /><p className="action-context">{victim ? `Das Rudel hat ${victim.name} gewählt.` : "Das Rudel hat kein Opfer gefunden."}</p>
      <fieldset disabled={busy} className="witch-options">{action.canHeal && victim ? <SettingSwitch id="online-witch-heal" title={`${victim.name} heilen`} description="Heiltrank einmalig einsetzen" checked={heal} onCheckedChange={(value) => { setHeal(value); if (value && second === victim.id) setSecond(""); }} /> : <p className="field-hint">{state.privateRole?.healPotion ? "Kein Opfer zu heilen. Dein Heiltrank bleibt erhalten." : "Dein Heiltrank ist bereits verbraucht."}</p>}{action.canPoison ? <PlayerSelect id="online-witch-poison" value={second} onValueChange={setSecond} candidates={action.candidates.filter((candidate) => !heal || candidate.id !== action.wolfVictimId)} /> : <p className="field-hint">Dein Gifttrank ist bereits verbraucht.</p>}</fieldset>
      <ConfirmBar label={heal || second ? "Tränke bestätigen" : "Ohne Tränke fortfahren"} summary={summary} instruction="Auch wenn du keinen Trank verwendest, musst du hier bestätigen." busy={busy} onConfirm={() => send("act", { heal, target2Id: second || undefined })} />
    </CardContent></Card>;
  }
  const selectedNames = [first, second].filter(Boolean).flatMap((id) => action.candidates.find((candidate) => candidate.id === id)?.name ?? []);
  const selection = getSelectionGuidance(action.phase, selectedNames);
  const multi = action.maxTargets === 2;
  const toggle = (id: string) => { if (first === id) { setFirst(second); setSecond(""); } else if (second === id) setSecond(""); else if (!first) setFirst(id); else if (multi) setSecond(id); else setFirst(id); };
  return <Card className="task-card selection-card"><CardContent><TaskStatus guidance={guidance} busy={busy} /><DecisionSteps selected={selection.valid} />
    <div className="selection-heading"><strong>{multi ? action.phase === "cupid" ? "Genau zwei Personen wählen" : "Eine oder zwei Personen wählen" : "Eine Person wählen"}</strong><span className="selection-count">{selectedNames.length} / {multi ? 2 : 1}</span></div>
    <div className="player-choice-list" aria-label="Personen auswählen">{action.candidates.map((candidate) => <PlayerChoice key={candidate.id} id={candidate.id} name={candidate.name} selected={first === candidate.id || second === candidate.id} onSelect={toggle} disabled={busy} />)}</div>
    <ConfirmBar label={selection.buttonLabel} summary={selection.summary} instruction={selection.instruction} disabled={!selection.valid} busy={busy} onConfirm={() => send(["mayor_vote", "wolves", "day_vote", "runoff"].includes(action.phase) ? "vote" : "act", { targetId: first || undefined, target2Id: second || undefined })} />
  </CardContent></Card>;
}

function DeathBoard({ players }: { players: PlayerView[] }) { return <div className="death-board"><h3>{players.length ? "Bisher ausgeschieden" : "Alle sind noch dabei"}</h3>{players.length ? players.map((player) => <div key={player.id}><span>{player.name.charAt(0)}</span><div className="death-board-copy"><strong>{player.name}</strong><small>{player.role ? ROLE_INFO[player.role].label : "Unbekannt"}</small></div><aside><DeathCauseList causes={player.deathCauses} compact /></aside></div>) : <p>Noch ist niemand aus dem Dorf ausgeschieden.</p>}</div>; }
function VillageOverview({ players, mayorPlayerId, meId }: { players: PlayerView[]; mayorPlayerId: string | null; meId?: string }) {
  const living = players.filter((player) => player.alive).length;
  return <section className="village-overview" aria-label="Dorfübersicht"><header><h3>Dorfübersicht</h3><p><span className="living-indicator" />{living} lebend<span>·</span>{players.length - living} ausgeschieden</p></header><div className="village-roster">{players.map((player, index) => <div key={player.id} className={player.alive ? "is-alive" : "is-dead"}><span className={`roster-avatar avatar-${index % 5}`}>{player.alive ? player.name.charAt(0) : "†"}</span><div><strong>{player.name}{player.id === meId && <em className="you-label">Du</em>}</strong><small>{player.alive ? player.id === mayorPlayerId ? "Bürgermeister" : "Im Dorf" : player.role ? `Ausgeschieden · ${ROLE_INFO[player.role].label}` : "Ausgeschieden · Rolle unbekannt"}</small></div><aside>{!player.alive ? <DeathCauseList causes={player.deathCauses} compact /> : player.id === mayorPlayerId ? <Crown className="mayor-icon" aria-label="Bürgermeister" /> : <span className="roster-alive-dot" aria-label="Lebend" />}</aside></div>)}</div><DeathLegend causes={players.flatMap((player) => player.deathCauses)} /></section>;
}

function VoteHistoryBoard({ rounds }: { rounds: VoteHistoryRound[] }) {
  if (!rounds.length) return <GameEmptyState kind="votes" title="Noch keine Abstimmung." description="Nach der ersten Wahl siehst du hier alle Stimmen und Ergebnisse." />;
  const phaseLabel: Record<PublicVotePhase, string> = { mayor_vote: "Bürgermeisterwahl", day_vote: "Dorfabstimmung", runoff: "Stichentscheid" };
  return <section className="vote-history" aria-labelledby="vote-history-title"><header><div><span className="wolf-step">TRANSPARENT</span><h3 id="vote-history-title">Abstimmungen</h3></div><p>Alle abgeschlossenen öffentlichen Wahlen dieser Partie.</p></header><div className="vote-round-list">{[...rounds].reverse().map((round) => <article className="vote-round" key={`${round.cycle}:${round.phase}`}><div className="vote-round-heading"><div><span>{round.cycle ? `Tag ${round.cycle}` : "Spielstart"}</span><h4>{phaseLabel[round.phase]}</h4></div><p><strong>{round.submitted}</strong> abgegeben · <strong>{round.totalWeight}</strong> Stimmgewicht</p></div><div className="vote-statistics" aria-label={`Stimmenverteilung ${phaseLabel[round.phase]}`}>{round.totals.map((total) => <div key={total.playerId}><div><span>{total.name}</span><strong>{total.votes}</strong></div><i><b style={{ width: `${round.totalWeight ? (total.votes / round.totalWeight) * 100 : 0}%` }} /></i></div>)}</div><div className="vote-decisions"><strong>Wer hat wen gewählt?</strong>{round.votes.map((vote) => <div key={vote.voterId}><span>{vote.voterName}{vote.weight > 1 && <em>×2</em>}</span><i aria-hidden="true">→</i><b>{vote.targetName}</b></div>)}</div></article>)}</div></section>;
}

function ResultsBoard({ state, post, close, busy }: { state: LobbyState; post: PostAction; close: () => void; busy: boolean }) {
  const guidance = getGameGuidance({ phase: "results", alive: state.me.alive, isHost: state.me.isHost, submitted: false, hasAction: false, hostName: state.players.find((player) => player.isHost)?.name });
  return <Card className="task-card wolf-results"><CardContent><span className="result-stamp">Partie abgeschlossen</span><h2 className="winner-title">{WINNER_COPY[state.lobby.winner ?? ""] ?? "Die Partie endet"}</h2><p>Jetzt werden alle Rollen aufgedeckt.</p><div className="role-reveal-list">{state.players.map((player) => <div key={player.id} className={player.alive ? "survivor" : ""}><span>{player.name.charAt(0)}</span><strong>{player.name}</strong><div className="result-player-meta"><small>{player.role ? ROLE_INFO[player.role].label : "Unbekannt"}</small>{player.alive ? <em className="survival-badge">Überlebt</em> : <DeathCauseList causes={player.deathCauses} compact />}</div></div>)}</div><DeathLegend causes={state.players.flatMap((player) => player.deathCauses)} /><TaskStatus guidance={guidance} busy={busy} />
    {state.me.isHost && <><ConfirmBar label="Neue Partie vorbereiten" summary="Mit derselben Gruppe weiterspielen" instruction="Ihr kommt zurück in die Lobby und könnt dort die Regeln anpassen." stage="Dein nächster Schritt" busy={busy} onConfirm={() => post("new_match")} /><Button variant="ghost" disabled={busy} onClick={close}>Lobby beenden</Button></>}
  </CardContent></Card>;
}

function InviteSheet({ qr, name, url, close, showError }: { qr: string; name: string; url: string; close: () => void; showError: (error: unknown) => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch (error) { showError(error); } };
  const share = async () => { try { if (navigator.share) await navigator.share({ title: `Werwolf · ${name}`, text: `Spiele mit in unserer Runde „${name}“`, url }); else await copy(); } catch (error) { if ((error as Error).name !== "AbortError") showError(error); } };
  return <ModalSheet className="invite-sheet wolf-sheet" labelledBy="wolf-invite-title" close={close}><Button className="sheet-close" variant="ghost" size="icon" onClick={close} aria-label="Einladung schließen"><X aria-hidden="true" /></Button><span className="wolf-step">Gruppe einladen</span><h2 id="wolf-invite-title">So kommen die anderen dazu.</h2><p>QR-Code mit der Handy-Kamera scannen oder den Einladungslink öffnen. Danach nur noch den Namen eingeben.</p>{qr && <Image src={qr} alt={`Einladung zur Lobby ${name}`} width={300} height={300} unoptimized />}<strong className="group-code">{name}</strong><Button className="primary-button wolf-primary" onClick={share}>Einladung teilen<ArrowUpRight aria-hidden="true" /></Button><Button variant="outline" onClick={copy}>{copied ? <Check aria-hidden="true" /> : null}{copied ? "Link kopiert" : "Link kopieren"}</Button><p className="field-hint" role="status">{copied ? "Der Link ist kopiert. Du kannst ihn jetzt in eure Gruppe einfügen." : "Neue Personen erscheinen automatisch in der Lobby."}</p><Button variant="ghost" onClick={close}>Zurück zur Lobby</Button></ModalSheet>;
}

function RoleSheet({ role, close }: { role: PrivateRole; close: () => void }) { return <ModalSheet className="wolf-sheet role-sheet" labelledBy="wolf-role-title" close={close}><Button className="sheet-close" type="button" onClick={close} aria-label="Rollenkarte schließen"><X aria-hidden="true" /></Button><span className="step-label wolf-step">Nur für dich</span><div className={`role-orb team-${role.team}`}><RoleIcon role={role.role} /></div><h3 id="wolf-role-title">{role.label}</h3><p>{role.description}</p><div className="role-facts"><span><b>Team</b>{role.team === "village" ? "Dorf" : role.team === "wolf" ? "Rudel" : "Eigenes Ziel"}</span>{role.lover && <span><b>Verliebt mit</b>{role.lover}</span>}{role.roleModel && <span><b>Vorbild</b>{role.roleModel}</span>}{role.charmed && <span><b>Status</b>Verzaubert</span>}{role.role === "witch" && <span><b>Tränke</b>{role.healPotion ? "Heilung bereit" : "Heilung verbraucht"} · {role.poisonPotion ? "Gift bereit" : "Gift verbraucht"}</span>}{role.role === "elder" && <span><b>Wolfsangriff</b>{role.elderShield ? "Schutz ist bereit" : "Schutz verbraucht"}</span>}</div><Button className="primary-button wolf-primary" type="button" onClick={close}>Rollenkarte schließen</Button></ModalSheet>; }

function RoleSelector({ count, wolves, roles, setRoles }: { count: number; wolves: number; roles: WerewolfRole[]; setRoles: (roles: WerewolfRole[]) => void }) {
  const toggle = (role: WerewolfRole) => { if (roles.includes(role)) return setRoles(roles.filter((item) => item !== role)); const next = [...roles, role]; if (!validateRoleSetup(Math.max(3, count), wolves, next)) setRoles(next); };
  return <div className="role-selector">{SELECTABLE_ROLES.map((role) => { const min = minimumPlayersForRole(role); const selected = roles.includes(role); const unavailable = count < min || (role === "white_werewolf" && wolves < 2) || (!selected && Boolean(validateRoleSetup(Math.max(3, count), wolves, [...roles, role]))); const reason = count < min ? `Ab ${min} Personen` : role === "white_werewolf" && wolves < 2 ? "2 Werwölfe nötig" : "Kein freier Platz"; return <Button type="button" key={role} aria-pressed={selected} className={selected ? "selected" : ""} disabled={unavailable && !selected} onClick={() => toggle(role)}><span><RoleIcon role={role} /></span><b>{ROLE_INFO[role].label}</b><small>{unavailable && !selected ? reason : ROLE_INFO[role].team === "solo" ? "eigenes Ziel" : ROLE_INFO[role].team === "wolf" ? "Rudel" : "Dorf"}</small><i>{selected ? "✓" : "+"}</i></Button>; })}</div>;
}

function OnlineSettings({ state, busy, post, close }: { state: LobbyState; busy: boolean; post: PostAction; close: () => void }) {
  const count = state.players.length;
  const [saveFailed, setSaveFailed] = useState(false);
  const [wolves, setWolves] = useState(Math.min(state.lobby.wolfCount, maxWolfCount(Math.max(3, count))));
  const [roles, setRoles] = useState(state.lobby.selectedRoles);
  const [mayor, setMayor] = useState(state.lobby.mayorEnabled);
  const [discoverable, setDiscoverable] = useState(state.lobby.discoverable);
  const [audioMode, setAudioMode] = useState<"all" | "host">(state.lobby.audioMode);
  const [audioGapSeconds, setAudioGapSeconds] = useState(state.lobby.audioGapSeconds);
  const rulesError = validateRoleSetup(Math.max(3, count), wolves, roles);
  const save = async () => { setSaveFailed(false); if (await post("settings", { wolfCount: wolves, selectedRoles: roles, mayorEnabled: mayor, discoverable, audioMode, audioGapSeconds })) close(); else setSaveFailed(true); };
  return <ModalSheet className="settings-sheet wolf-sheet" labelledBy="wolf-settings-title" close={() => { if (!busy) close(); }}>
    <Button className="sheet-close" variant="ghost" size="icon" disabled={busy} onClick={close} aria-label="Einstellungen verwerfen und schließen"><X aria-hidden="true" /></Button>
    <h2 id="wolf-settings-title">Spielregeln anpassen</h2>
    <div className="settings-scroll"><fieldset className="settings-fields" disabled={busy}>
      <div className="settings-row"><span><strong>Werwölfe</strong><small>Empfohlen für eure Gruppe: {defaultWolfCount(Math.max(3, count))}</small></span><Stepper value={wolves} min={1} max={maxWolfCount(Math.max(3, count))} onChange={(value) => { setWolves(value); if (value < 2) setRoles(roles.filter((role) => role !== "white_werewolf")); }} /></div>
      <details className="optional-roles"><summary>Zusatzrollen <Badge variant="outline">{roles.length || "Optional"}</Badge></summary><RoleSelector count={count} wolves={wolves} roles={roles} setRoles={setRoles} /></details>
      <SettingSwitch id="online-mayor" title="Bürgermeister wählen" description="Seine Stimme zählt bei Dorfabstimmungen doppelt." checked={mayor} onCheckedChange={setMayor} />
      <SettingSwitch id="online-discoverable" title="Lobby in der Nähe anzeigen" description="Personen im selben Netzwerk können eure Lobby finden." checked={discoverable} onCheckedChange={setDiscoverable} />
      <details className="optional-roles"><summary>Ansagen einstellen <Badge variant="outline">Optional</Badge></summary>
        <div className="settings-block"><span className="settings-label">Wo sollen die Ansagen laufen?</span><div className="segmented audio-mode-choice"><Button type="button" aria-pressed={audioMode === "all"} className={audioMode === "all" ? "active" : ""} onClick={() => setAudioMode("all")}><strong>Alle Geräte</strong><small>Gleichzeitig · Rollen bleiben unortbar</small></Button><Button type="button" aria-pressed={audioMode === "host"} className={audioMode === "host" ? "active" : ""} onClick={() => setAudioMode("host")}><strong>Nur Spielleitung</strong><small>Eine zentrale Stimme für die Gruppe</small></Button></div></div>
        <div className="settings-row"><span><strong>Pause zwischen den Ansagen</strong><small>Sekunden</small></span><Stepper value={audioGapSeconds} min={MIN_AUDIO_ANNOUNCEMENT_GAP_SECONDS} max={MAX_AUDIO_ANNOUNCEMENT_GAP_SECONDS} onChange={setAudioGapSeconds} /></div>
      </details>
    </fieldset></div>
    <div className="settings-footer"><p className={rulesError || saveFailed ? "setup-validation-error" : "field-hint"} role="status">{busy ? "Die Regeln werden gespeichert. Bitte kurz warten." : rulesError || (saveFailed ? "Speichern hat nicht funktioniert. Deine Auswahl bleibt erhalten. Bitte versuche es erneut." : "Noch nicht gespeichert. Bestätige deine Änderungen mit dem Knopf unten.")}</p><Button className="primary-button wolf-primary settings-submit" disabled={busy || Boolean(rulesError)} onClick={save}>{busy ? "Regeln werden gespeichert …" : "Regeln speichern"}</Button></div>
  </ModalSheet>;
}

type LocalPlayer = { id: string; name: string; role: WerewolfRole; team: WerewolfTeam; alive: boolean; loverId: string | null; roleModelId: string | null; charmed: boolean; elderShield: boolean; healPotion: boolean; poisonPotion: boolean; lastProtectedId: string | null; deathCauses: DeathCause[] };
type LocalTurn = { kind: WerewolfPhase; actorId: string; candidates?: string[] };
type LocalDraft = { votes: { voterId: string; targetId: string }[]; wolfVotes: { voterId: string; targetId: string }[]; healId: string | null; witchHeal: boolean; poisonId: string | null; whiteId: string | null };
const EMPTY_DRAFT: LocalDraft = { votes: [], wolfVotes: [], healId: null, witchHeal: false, poisonId: null, whiteId: null };

function LocalWerewolf({ onBack, showError }: { onBack: () => void; showError: (error: unknown) => void }) {
  const [phase, setPhase] = useState<"setup" | "reveal" | "turn" | "dawn" | "discussion" | "results">("setup"); const [names, setNames] = useState(["", "", ""]); const [wolves, setWolves] = useState(1); const [roles, setRoles] = useState<WerewolfRole[]>([]); const [mayorEnabled, setMayorEnabled] = useState(true); const [audioGapSeconds, setAudioGapSeconds] = useState(AUDIO_ANNOUNCEMENT_GAP_SECONDS);
  const [players, setPlayers] = useState<LocalPlayer[]>([]); const [mayorId, setMayorId] = useState<string | null>(null); const [night, setNight] = useState(0); const [revealIndex, setRevealIndex] = useState(0); const [ready, setReady] = useState(false); const [queue, setQueue] = useState<LocalTurn[]>([]); const [turnIndex, setTurnIndex] = useState(0); const [purpose, setPurpose] = useState<"mayor" | "initial" | "night" | "day" | "runoff" | "hunter">("initial"); const [draft, setDraft] = useState<LocalDraft>(EMPTY_DRAFT); const [first, setFirst] = useState(""); const [second, setSecond] = useState(""); const [witchHeal, setWitchHeal] = useState(false); const [resolutionSource, setResolutionSource] = useState<"night" | "day">("night"); const [winner, setWinner] = useState<Winner>(null); const [infoOpen, setInfoOpen] = useState(false); const [infoPlayer, setInfoPlayer] = useState("");
  const [setupStep, setSetupStep] = useState(1);
  const [namesLoaded, setNamesLoaded] = useState(false);
  const [receipt, setReceipt] = useState("");
  const [reserveRoles, setReserveRoles] = useState<WerewolfRole[]>(["thief", "villager"]);
  const [seerVision, setSeerVision] = useState<{ name: string; label: string; complete: () => void } | null>(null);
  const [voteHistory, setVoteHistory] = useState<VoteHistoryRound[]>([]);
  useEffect(() => { window.scrollTo(0, 0); }, [phase, turnIndex, revealIndex, ready, setupStep]);
  const [audioReady, setAudioReady] = useState(false); const localCue = useRef(""); const localWinnerCue = useRef(""); const localAnnouncedNight = useRef(0); const localInitialSleep = useRef(false);
  useAutomaticAudioUnlock(audioReady, setAudioReady);
  useEffect(() => { const timer = setTimeout(() => { try { const stored = localStorage.getItem("gameson:werewolf:local-names"); if (stored) { const parsed: unknown = JSON.parse(stored); if (Array.isArray(parsed) && parsed.length >= 3 && parsed.length <= 22 && parsed.every((name) => typeof name === "string")) setNames(parsed); } } catch { /* Play without saved names when storage is unavailable. */ } finally { setNamesLoaded(true); } }, 0); return () => clearTimeout(timer); }, []);
  useEffect(() => { if (!namesLoaded) return; try { localStorage.setItem("gameson:werewolf:local-names", JSON.stringify(names)); } catch { /* The current group can still play without persistent storage. */ } }, [names, namesLoaded]);
  useEffect(() => { if (phase === "setup") stopWerewolfAudio(); }, [phase]);
  useEffect(() => {
    const cue: WerewolfPhase | null = phase === "reveal" ? "role_reveal" : phase === "turn" ? queue[turnIndex]?.kind : phase === "dawn" ? "dawn" : phase === "discussion" ? "discussion" : null;
    if (!audioReady || !cue || !WEREWOLF_AUDIO_PHASES.includes(cue)) return;
    const cueKey = `${night}:${purpose}:${cue}`;
    if (localCue.current === cueKey) return;
    localCue.current = cueKey;
    let transition: "sleep-all" | "sleep-again" | "night-start" | "day-start" | "day-resolution" | null = "sleep-again";
    if (cue === "dawn") transition = resolutionSource === "day" ? "day-resolution" : "day-start";
    else if (["role_reveal", "mayor_vote", "discussion", "day_vote", "runoff", "hunter"].includes(cue)) transition = null;
    else if (purpose === "night" && night > 0 && localAnnouncedNight.current !== night) { transition = "night-start"; localAnnouncedNight.current = night; }
    else if (purpose === "initial" && !localInitialSleep.current) { transition = "sleep-all"; localInitialSleep.current = true; }
    playWerewolfPhaseCue(cue, 120, transition, audioGapSeconds);
  }, [audioGapSeconds, audioReady, night, phase, purpose, queue, resolutionSource, turnIndex]);
  useEffect(() => {
    if (!audioReady || phase !== "results" || !winner) return;
    const cueKey = `${night}:${winner}`;
    if (localWinnerCue.current === cueKey) return;
    localWinnerCue.current = cueKey;
    playWerewolfWinnerCue(winner, 120);
  }, [audioReady, night, phase, winner]);
  const validNames = names.map((name) => name.trim()).filter(Boolean); const maxWolves = maxWolfCount(Math.max(3, validNames.length)); const effectiveWolves = Math.min(wolves, maxWolves);
  const villageKillCount = countVillageDecisionDeaths(players);

  const beginQueue = (turns: LocalTurn[], nextPurpose: typeof purpose, nextPlayers = players, nextDraft = EMPTY_DRAFT) => { setPlayers(nextPlayers); setQueue(turns); setPurpose(nextPurpose); setTurnIndex(0); setDraft(nextDraft); setFirst(""); setSecond(""); setReady(false); setPhase("turn"); if (!turns.length) finishQueue(nextPurpose, nextPlayers, nextDraft); };
  const start = () => { if (validNames.length < 3) return showError(new Error("Füge mindestens drei Namen hinzu.")); if (new Set(validNames.map((name) => name.toLocaleLowerCase("de"))).size !== validNames.length) return showError(new Error("Jeder Name darf nur einmal vorkommen.")); const error = validateRoleSetup(validNames.length, effectiveWolves, roles); if (error) return showError(new Error(error)); void unlockWerewolfAudio().then(setAudioReady).catch(showError); localCue.current = ""; localWinnerCue.current = ""; localAnnouncedNight.current = 0; localInitialSleep.current = false; const deck = buildRoleDeck(validNames.length, effectiveWolves, roles, randomIndex); const next = validNames.map((name, index) => { const role = deck[index]; return { id: crypto.randomUUID(), name, role, team: roleTeam(role), alive: true, loverId: null, roleModelId: null, charmed: false, elderShield: role === "elder", healPotion: role === "witch", poisonPotion: role === "witch", lastProtectedId: null, deathCauses: [] }; }); setReceipt(""); setReserveRoles(["thief", "villager", randomIndex(2) ? "werewolf" : "villager"]); setPlayers(next); setMayorId(null); setNight(0); setWinner(null); setVoteHistory([]); setRevealIndex(0); setReady(false); setPhase("reveal"); };
  const initialTurns = (list: LocalPlayer[]) => (["thief", "cupid", "wild_child"] as WerewolfPhase[]).flatMap((kind) => list.filter((player) => player.alive && player.role === kind).map((player) => ({ kind, actorId: player.id })));
  const mayorTurns = (list: LocalPlayer[]) => list.filter((player) => player.alive).map((player) => ({ kind: "mayor_vote" as const, actorId: player.id }));
  const startAfterReveal = () => mayorEnabled ? beginQueue(mayorTurns(players), "mayor", players) : beginQueue(initialTurns(players), "initial", players);
  const startNight = (list = players) => { const nextNight = night + 1; setNight(nextNight); const living = list.filter((player) => player.alive); const turns: LocalTurn[] = []; const addRole = (kind: WerewolfPhase, role: WerewolfRole) => { const actor = living.find((player) => player.role === role); if (actor) turns.push({ kind, actorId: actor.id }); }; addRole("healer", "healer"); addRole("seer", "seer"); living.filter((player) => player.team === "wolf" || player.role === "white_werewolf").forEach((player) => turns.push({ kind: "wolves", actorId: player.id })); addRole("witch", "witch"); if (nextNight % 2 === 0) addRole("white_werewolf", "white_werewolf"); addRole("piper", "piper"); beginQueue(turns, "night", list, EMPTY_DRAFT); };
  const startDayVote = (list = players, runoffCandidates?: string[]) => { const living = list.filter((player) => player.alive); beginQueue(living.map((player) => ({ kind: runoffCandidates ? "runoff" as const : "day_vote" as const, actorId: player.id, candidates: runoffCandidates })), runoffCandidates ? "runoff" : "day", list, EMPTY_DRAFT); };
  const finalizeDeaths = (list: LocalPlayer[], source: "night" | "day") => { const dead = new Set(list.filter((player) => !player.alive).map((player) => player.id)); const transformed = list.map((player) => player.alive && player.role === "wild_child" && player.roleModelId && dead.has(player.roleModelId) ? { ...player, team: "wolf" as const } : player); if (mayorId && dead.has(mayorId)) setMayorId(null); const outcome = determineWinner(transformed); setPlayers(transformed); if (outcome) { setWinner(outcome); setPhase("results"); } else { setResolutionSource(source); setPhase("dawn"); } };
  const killLocal = (list: LocalPlayer[], initialDeaths: { id: string; cause: DeathCause }[], source: "night" | "day", afterHunter = false) => { const deaths = new Map<string, Set<DeathCause>>(); for (const death of initialDeaths) { if (!list.find((player) => player.id === death.id)?.alive) continue; const causes = deaths.get(death.id) ?? new Set<DeathCause>(); causes.add(death.cause); deaths.set(death.id, causes); } let changed = true; while (changed) { changed = false; for (const id of deaths.keys()) { const lover = list.find((player) => player.id === id)?.loverId; const villageConsequence = deaths.get(id)?.has("village_vote") || deaths.get(id)?.has("scapegoat"); if (lover && list.find((player) => player.id === lover)?.alive && !deaths.has(lover)) { deaths.set(lover, new Set(villageConsequence ? ["heartbreak", "village_vote"] : ["heartbreak"])); changed = true; } } } const next = list.map((player) => deaths.has(player.id) ? { ...player, alive: false, deathCauses: [...deaths.get(player.id)!] } : player); const hunter = [...deaths.keys()].map((id) => next.find((player) => player.id === id)).find((player) => player?.role === "hunter"); if (hunter && !afterHunter) { setResolutionSource(source); beginQueue([{ kind: "hunter", actorId: hunter.id }], "hunter", next, EMPTY_DRAFT); } else finalizeDeaths(next, source); };
  const resolveNight = (list: LocalPlayer[], result: LocalDraft) => { const leaders = weightedVoteLeaders(result.wolfVotes, null).leaders; const victimId = leaders.length ? leaders[randomIndex(leaders.length)] : null; let next = list; const deaths: { id: string; cause: DeathCause }[] = []; if (victimId && victimId !== result.healId && !result.witchHeal) { const victim = next.find((player) => player.id === victimId); if (victim?.role === "elder" && victim.elderShield) next = next.map((player) => player.id === victimId ? { ...player, elderShield: false } : player); else deaths.push({ id: victimId, cause: "wolf_attack" }); } if (result.poisonId) deaths.push({ id: result.poisonId, cause: "witch_poison" }); if (result.whiteId) deaths.push({ id: result.whiteId, cause: "white_werewolf" }); killLocal(next, deaths, "night"); };
  function finishQueue(donePurpose: typeof purpose, list: LocalPlayer[], result: LocalDraft) {
    const votePhase: PublicVotePhase | null = donePurpose === "mayor" ? "mayor_vote" : donePurpose === "day" ? "day_vote" : donePurpose === "runoff" ? "runoff" : null;
    if (votePhase) {
      const round = createVoteHistoryRound(votePhase, night, result.votes, list, mayorId);
      setVoteHistory((current) => [...current.filter((item) => item.cycle !== round.cycle || item.phase !== round.phase), round]);
    }
    if (donePurpose === "mayor") { const leaders = weightedVoteLeaders(result.votes, null).leaders; setMayorId(leaders.length ? leaders[randomIndex(leaders.length)] : list.find((player) => player.alive)?.id ?? null); if (night === 0) beginQueue(initialTurns(list), "initial", list); else startDayVote(list); }
    else if (donePurpose === "initial") startNight(list);
    else if (donePurpose === "night") resolveNight(list, result);
    else if (donePurpose === "day") { const leaders = weightedVoteLeaders(result.votes, mayorId).leaders; if (leaders.length === 1) killLocal(list, [{ id: leaders[0], cause: "village_vote" }], "day"); else if (leaders.length > 1) startDayVote(list, leaders); else killLocal(list, [], "day"); }
    else if (donePurpose === "runoff") { const leaders = weightedVoteLeaders(result.votes, mayorId).leaders; if (leaders.length === 1) killLocal(list, [{ id: leaders[0], cause: "village_vote" }], "day"); else { const scapegoat = list.find((player) => player.alive && player.role === "scapegoat"); killLocal(list, scapegoat ? [{ id: scapegoat.id, cause: "scapegoat" }] : [], "day"); } }
    else if (donePurpose === "hunter") killLocal(list, result.whiteId ? [{ id: result.whiteId, cause: "hunter_shot" }] : [], resolutionSource, true);
  }
  const submitTurn = () => { const turn = queue[turnIndex]; const actor = players.find((player) => player.id === turn.actorId)!; let nextPlayers = players.map((player) => ({ ...player })); const nextDraft: LocalDraft = { ...draft, votes: [...draft.votes], wolfVotes: [...draft.wolfVotes] }; const requireFirst = !["witch", "white_werewolf"].includes(turn.kind); if (requireFirst && !first) return showError(new Error("Wähle zuerst eine Person oder Rolle."));
    if (turn.kind === "mayor_vote" || turn.kind === "day_vote" || turn.kind === "runoff") nextDraft.votes.push({ voterId: actor.id, targetId: first });
    else if (turn.kind === "wolves") nextDraft.wolfVotes.push({ voterId: actor.id, targetId: first });
    else if (turn.kind === "thief") { const role = first as WerewolfRole; nextPlayers = nextPlayers.map((player) => player.id === actor.id ? { ...player, role, team: roleTeam(role) } : player); }
    else if (turn.kind === "cupid") { if (!second || first === second) return showError(new Error("Amor verbindet zwei unterschiedliche Personen.")); nextPlayers = nextPlayers.map((player) => player.id === first ? { ...player, loverId: second } : player.id === second ? { ...player, loverId: first } : player); }
    else if (turn.kind === "wild_child") nextPlayers = nextPlayers.map((player) => player.id === actor.id ? { ...player, roleModelId: first } : player);
    else if (turn.kind === "healer") { nextDraft.healId = first; nextPlayers = nextPlayers.map((player) => player.id === actor.id ? { ...player, lastProtectedId: first } : player); }
    else if (turn.kind === "witch") { nextDraft.witchHeal = witchHeal; nextDraft.poisonId = second || null; nextPlayers = nextPlayers.map((player) => player.id === actor.id ? { ...player, healPotion: witchHeal ? false : player.healPotion, poisonPotion: second ? false : player.poisonPotion } : player); }
    else if (turn.kind === "white_werewolf") nextDraft.whiteId = first || null;
    else if (turn.kind === "piper") { if (!second && !first) return; nextPlayers = nextPlayers.map((player) => player.id === first || player.id === second ? { ...player, charmed: true } : player); }
    else if (turn.kind === "hunter") nextDraft.whiteId = first;
    const complete = () => { setReceipt("Die letzte Entscheidung ist bestätigt und gespeichert."); setPlayers(nextPlayers); setDraft(nextDraft); setFirst(""); setSecond(""); setWitchHeal(false); setReady(false); if (turnIndex === queue.length - 1) finishQueue(purpose, nextPlayers, nextDraft); else setTurnIndex(turnIndex + 1); };
    if (turn.kind === "seer") { const target = nextPlayers.find((player) => player.id === first); if (target) { setSeerVision({ name: target.name, label: ROLE_INFO[target.role].label, complete }); return; } }
    complete();
  };

  const visionDialog = <Dialog open={Boolean(seerVision)}><DialogContent className="werewolf-theme wolf-dialog role-sheet" showCloseButton={false} aria-describedby="local-vision-description" onEscapeKeyDown={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()}><div className="role-orb"><Eye aria-hidden="true" /></div><DialogTitle>Lies das Ergebnis. Dann bestätige es.</DialogTitle><p id="local-vision-description">{seerVision?.name} spielt <strong>{seerVision?.label}</strong>.</p><p className="field-hint">Merke dir die Rolle. Erst mit deiner Bestätigung geht es weiter.</p><Button className="primary-button wolf-primary" onClick={() => { if (!seerVision) return; const complete = seerVision.complete; setSeerVision(null); complete(); }}>Ergebnis gelesen · Weitergeben<Check aria-hidden="true" /></Button></DialogContent></Dialog>;

  if (phase === "setup") {
    const namesError = validNames.length < 3 ? "Trage zuerst mindestens drei Namen ein." : names.some((name) => name.trim().length < 2) ? "Fülle alle Namen mit mindestens zwei Zeichen aus oder entferne leere Felder." : new Set(validNames.map((name) => name.toLocaleLowerCase("de"))).size !== validNames.length ? "Jede Person braucht einen eigenen, eindeutigen Namen." : "";
    const rulesError = validateRoleSetup(validNames.length, effectiveWolves, roles);
    return <main className="app-shell werewolf-shell wolf-setup-shell"><WolfTopbar title="Ein Gerät für alle" onBack={setupStep === 2 ? () => setSetupStep(1) : onBack} local />
      <ol className="setup-steps" aria-label="Spielvorbereitung"><li aria-current={setupStep === 1 ? "step" : undefined}><span>1</span>Gruppe</li><li aria-current={setupStep === 2 ? "step" : undefined}><span>2</span>Spielregeln &amp; Start</li></ol>
      <Card className="task-card"><CardContent><header className="task-status"><h2>{setupStep === 1 ? "Wer spielt mit?" : "So spielt eure Gruppe."}</h2><p>{setupStep === 1 ? "Trage alle Namen ein. In dieser Reihenfolge reicht ihr das Handy weiter." : "Ihr könnt direkt starten. Zusatzrollen sind optional."}</p></header>
        {setupStep === 1 ? <><div className="name-list">{names.map((name, index) => <div key={index}><span>{index + 1}</span><Input value={name} onChange={(event) => setNames(names.map((item, position) => position === index ? event.target.value : item))} placeholder={`Name der ${index + 1}. Person`} maxLength={24} aria-label={`Name ${index + 1}`} />{names.length > 3 && <Button variant="ghost" size="icon" aria-label={`${name || `Person ${index + 1}`} entfernen`} onClick={() => setNames(names.filter((_, position) => position !== index))}><X aria-hidden="true" /></Button>}</div>)}</div>{names.length < 22 && <Button className="add-person" variant="outline" onClick={() => setNames([...names, ""])}><Plus aria-hidden="true" />Person hinzufügen</Button>}</>
          : <><div className="setup-summary"><Users aria-hidden="true" /><span><strong>{validNames.length} Personen</strong><small>{validNames.join(", ")}</small></span><Button variant="ghost" onClick={() => setSetupStep(1)}>Ändern</Button></div><div className="setup-options"><div className="settings-row"><span><strong>Werwölfe</strong><small>Die übrigen Personen leben im Dorf.</small></span><Stepper value={effectiveWolves} min={1} max={maxWolves} onChange={(value) => { setWolves(value); if (value < 2) setRoles(roles.filter((role) => role !== "white_werewolf")); }} /></div><SettingSwitch id="local-mayor" title="Bürgermeister wählen" description="Seine Stimme zählt bei Dorfabstimmungen doppelt." checked={mayorEnabled} onCheckedChange={setMayorEnabled} /><details className="optional-roles"><summary>Zusatzrollen hinzufügen <Badge variant="outline">{roles.length || "Optional"}</Badge></summary><p className="field-hint">Für die erste Partie könnt ihr es bei Werwölfen und Dorfbewohnern belassen.</p><RoleSelector count={validNames.length} wolves={effectiveWolves} roles={roles} setRoles={setRoles} /></details><details className="optional-roles"><summary>Ansagen einstellen <Badge variant="outline">Optional</Badge></summary><div className="settings-row"><span><strong>Pause zwischen den Ansagen</strong><small>Sekunden · Der Ton wird beim Start eingeschaltet.</small></span><Stepper value={audioGapSeconds} min={MIN_AUDIO_ANNOUNCEMENT_GAP_SECONDS} max={MAX_AUDIO_ANNOUNCEMENT_GAP_SECONDS} onChange={setAudioGapSeconds} /></div></details></div></>}
      </CardContent></Card>
      <ConfirmBar compact label={setupStep === 1 ? "Weiter zu den Spielregeln" : "Rollen verteilen & starten"} summary={setupStep === 1 ? namesError || `${validNames.length} Personen sind bereit.` : namesError || rulesError || `Als Nächstes ist ${validNames[0]} dran.`} instruction="" disabled={setupStep === 1 ? Boolean(namesError) : Boolean(rulesError || namesError)} onConfirm={setupStep === 1 ? () => setSetupStep(2) : start} />
    </main>;
  }
  if (phase === "reveal") {
    const player = players[revealIndex];
    const pack = players.filter((item) => item.id !== player.id && (item.team === "wolf" || item.role === "white_werewolf")).map((item) => item.name).join(", ");
    return <main className="app-shell werewolf-shell pass-shell"><WolfTopbar title={`Rollen kennenlernen · ${revealIndex + 1} von ${players.length}`} local />
      {receipt && !ready && <ConfirmationReceipt message={receipt} />}
      {!ready ? <Card className="task-card"><CardContent><TaskStatus guidance={{ status: "action", label: "Handy weitergeben", title: `Jetzt ist ${player.name} dran.`, instruction: "Gib das Handy an diese Person. Nur sie darf die nächste Rollenkarte öffnen.", requiresConfirmation: true }} /><div className="handoff-person"><span className="handoff-avatar">{player.name.charAt(0)}</span><strong>{player.name}</strong><p>Alle anderen schauen kurz weg.</p></div><ConfirmBar label={`Ich bin ${player.name}`} summary="Name bestätigen" instruction="Tippe hier, wenn das Handy bei der richtigen Person ist." stage="Nächster Schritt" onConfirm={() => setReady(true)} /></CardContent></Card>
        : <LocalSecret key={player.id} player={player} pack={pack} onDone={() => { setReceipt("Die letzte Rolle ist bestätigt und verborgen."); setReady(false); if (revealIndex === players.length - 1) startAfterReveal(); else setRevealIndex(revealIndex + 1); }} />}
    </main>;
  }
  if (phase === "turn") {
    const turn = queue[turnIndex]; const actor = players.find((player) => player.id === turn.actorId)!; const living = players.filter((player) => player.alive);
    let candidates = living.filter((player) => player.id !== actor.id);
    if (turn.kind === "mayor_vote") candidates = living;
    if (turn.kind === "wolves") candidates = living.filter((player) => player.team !== "wolf" && player.role !== "white_werewolf");
    if (turn.kind === "healer") candidates = living.filter((player) => player.id !== actor.lastProtectedId);
    if (turn.kind === "white_werewolf") candidates = living.filter((player) => player.team === "wolf" && player.id !== actor.id);
    if (turn.kind === "piper") candidates = candidates.filter((player) => !player.charmed);
    if (turn.candidates) candidates = candidates.filter((player) => turn.candidates!.includes(player.id));
    const multi = turn.kind === "cupid" || turn.kind === "piper";
    const reserve = turn.kind === "thief" ? reserveRoles : null;
    const wolfVictim = weightedVoteLeaders(draft.wolfVotes, null).leaders[0];
    const victimName = players.find((player) => player.id === wolfVictim)?.name;
    const selectedNames = [first, second].filter(Boolean).flatMap((id) => candidates.find((candidate) => candidate.id === id)?.name ?? []);
    const selection = getSelectionGuidance(turn.kind, selectedNames);
    const poisonName = players.find((player) => player.id === second)?.name;
    const witchSummary = [witchHeal ? `${victimName} heilen` : actor.healPotion ? "Heiltrank aufbewahren" : "Heiltrank verbraucht", poisonName ? `${poisonName} vergiften` : actor.poisonPotion ? "Gifttrank aufbewahren" : "Gifttrank verbraucht"].join(" · ");
    const guidance = getGameGuidance({ phase: turn.kind, alive: actor.alive, isHost: false, submitted: false, hasAction: true });
    return <main className="app-shell werewolf-shell pass-shell"><VillageGuiltFrame count={villageKillCount} /><WolfTopbar title={ready ? `${actor.name} · ${PHASE_COPY[turn.kind].title}` : "Handy weitergeben"} local />
      {!ready ? <>{receipt && <ConfirmationReceipt message={receipt} />}<Card className="task-card"><CardContent><TaskStatus guidance={{ status: "action", label: "Nächste Person", title: `Gib das Handy an ${actor.name}.`, instruction: "Die nächste Entscheidung ist privat. Nur diese Person darf auf den Bildschirm schauen.", requiresConfirmation: true }} /><div className="handoff-person"><span className="handoff-avatar">{actor.name.charAt(0)}</span><strong>{actor.name}</strong><p>Alle anderen schauen weg.</p></div><ConfirmBar label={`Ich bin ${actor.name}`} summary="Name bestätigen" instruction="Erst danach öffnet sich deine Aufgabe." stage="Nächster Schritt" onConfirm={() => setReady(true)} /></CardContent></Card></>
        : <Card className="task-card"><CardContent><TaskStatus guidance={guidance} />{turn.kind !== "witch" && <DecisionSteps selected={reserve ? Boolean(first) : selection.valid} />}
          {turn.kind === "witch" ? <><p className="action-context">{victimName ? `Das Rudel hat ${victimName} gewählt.` : "Das Rudel hat kein Opfer gefunden."}</p>{actor.healPotion && wolfVictim ? <SettingSwitch id="local-witch-heal" title={`${victimName} heilen`} description="Heiltrank einmalig einsetzen" checked={witchHeal} onCheckedChange={(value) => { setWitchHeal(value); if (value && second === wolfVictim) setSecond(""); }} /> : <p className="field-hint">{actor.healPotion ? "Kein Opfer zu heilen. Dein Heiltrank bleibt erhalten." : "Dein Heiltrank ist bereits verbraucht."}</p>}{actor.poisonPotion ? <PlayerSelect id="local-witch-poison" value={second} onValueChange={setSecond} candidates={candidates.filter((player) => !witchHeal || player.id !== wolfVictim)} /> : <p className="field-hint">Dein Gifttrank ist bereits verbraucht.</p>}</>
            : reserve ? <RoleChoiceList roles={reserve} selected={first} onSelect={setFirst} />
            : <><div className="selection-heading"><strong>{multi ? turn.kind === "cupid" ? "Genau zwei Personen wählen" : "Eine oder zwei Personen wählen" : "Eine Person wählen"}</strong><span className="selection-count">{selectedNames.length} / {multi ? 2 : 1}</span></div><div className="player-choice-list">{candidates.map((player) => <PlayerChoice key={player.id} id={player.id} name={player.name} selected={first === player.id || second === player.id} onSelect={(id) => { if (first === id) { setFirst(second); setSecond(""); } else if (second === id) setSecond(""); else if (multi && first) setSecond(id); else setFirst(id); }} />)}</div></>}
          <ConfirmBar label={turn.kind === "witch" ? witchHeal || second ? "Tränke bestätigen" : "Ohne Tränke fortfahren" : reserve ? "Rolle bestätigen" : selection.buttonLabel} summary={turn.kind === "witch" ? witchSummary : reserve ? first ? ROLE_INFO[first as WerewolfRole].label : "Noch keine Rolle gewählt" : selection.summary} instruction={turn.kind === "witch" ? "Auch ohne Tränke musst du deine Entscheidung bestätigen." : reserve ? first ? "Noch nicht bestätigt. Tippe auf den roten Knopf." : "Wähle zuerst eine Rollenkarte aus." : selection.instruction} disabled={turn.kind === "witch" ? false : reserve ? !first : !selection.valid} onConfirm={submitTurn} />
        </CardContent></Card>}
      {visionDialog}
    </main>;
  }
  const dead = players.filter((player) => !player.alive);
  const publicPlayers: PlayerView[] = players.map((player) => ({ ...player, isHost: false, online: false }));
  const localNightHandoff = phase === "dawn" && resolutionSource === "day";
  const publicGuidance = { status: "action" as const, label: "Ihr entscheidet, wann es weitergeht", title: phase === "results" ? WINNER_COPY[winner ?? ""] ?? "Die Partie ist vorbei." : phase === "discussion" ? "Sprecht über euren Verdacht." : localNightHandoff ? "Bereit für die nächste Nacht?" : "Schaut nach, was passiert ist.", instruction: phase === "results" ? "Alle Rollen sind aufgedeckt. Ihr könnt mit derselben Gruppe eine neue Partie vorbereiten." : phase === "discussion" ? "Teilt eure Beobachtungen. Wenn alle fertig diskutiert haben, startet eine Person die Abstimmung mit dem Knopf unten." : localNightHandoff ? "Beendet eure Gespräche. Eine Person startet mit dem Knopf unten die Nacht; folgt anschließend den Aufgaben auf dem Handy." : "Alle dürfen auf den Bildschirm schauen. Eine Person bestätigt unten, um eure Diskussion zu beginnen.", requiresConfirmation: true };
  return <main className="app-shell werewolf-shell"><VillageGuiltFrame count={villageKillCount} /><WolfTopbar title="Eure Partie" onBack={phase === "results" ? onBack : undefined} local />
    {receipt && <ConfirmationReceipt message={receipt} clear={() => setReceipt("")} />}
    <PhaseHeader phase={phase} night={night} title={PHASE_COPY[phase].title} living={players.length - dead.length} total={players.length} local nightHandoff={localNightHandoff} />
    <div className="game-tools"><PrivateRoleButton onClick={() => setInfoOpen(true)} /><VillageDetails players={publicPlayers} rounds={voteHistory} mayorPlayerId={mayorId} /></div>
    <Card className="task-card"><CardContent><TaskStatus guidance={publicGuidance} />
      {phase === "dawn" && <DeathBoard players={dead.map((player) => ({ ...player, isHost: false, online: false }))} />}
      {phase === "results" && <div className="role-reveal-list">{players.map((player) => <div key={player.id} className={player.alive ? "survivor" : ""}><span>{player.name.charAt(0)}</span><strong>{player.name}</strong><div className="result-player-meta"><small>{ROLE_INFO[player.role].label}</small>{player.alive ? <em className="survival-badge">Überlebt</em> : <DeathCauseList causes={player.deathCauses} compact />}</div></div>)}</div>}
    </CardContent></Card>
    <ConfirmBar label={phase === "results" ? "Neue Partie vorbereiten" : phase === "discussion" ? "Abstimmung starten" : localNightHandoff ? "Nacht beginnen" : "Diskussion beginnen"} summary={phase === "results" ? "Noch eine Runde?" : phase === "discussion" ? "Habt ihr fertig diskutiert?" : "Eine Person bestätigt für die Gruppe"} instruction={phase === "results" ? "Namen und Regeln könnt ihr vor dem nächsten Start anpassen." : "Die Runde wartet, bis jemand auf diesen Knopf tippt."} stage="Gemeinsam fortfahren" onConfirm={() => { setReceipt(""); if (phase === "results") { setSetupStep(1); setPhase("setup"); } else if (phase === "discussion") { if (mayorEnabled && !mayorId) beginQueue(mayorTurns(players), "mayor", players); else startDayVote(players); } else if (phaseAfterDawn(resolutionSource) === "discussion") setPhase("discussion"); else startNight(players); }} />
    {infoOpen && <LocalInfoSheet players={players} selected={infoPlayer} setSelected={setInfoPlayer} close={() => { setInfoOpen(false); setInfoPlayer(""); }} />}
  </main>;
}

function LocalSecret({ player, pack, onDone, doneLabel = "Rolle verbergen & weitergeben" }: { player: LocalPlayer; pack: string; onDone: () => void; doneLabel?: string }) {
  const [revealed, setRevealed] = useState(false);
  const handoff = doneLabel !== "Rollenkarte schließen";
  useEffect(() => { const hide = () => { if (document.hidden) setRevealed(false); }; document.addEventListener("visibilitychange", hide); return () => document.removeEventListener("visibilitychange", hide); }, []);
  return <Card className="task-card local-secret-card"><CardContent><TaskStatus guidance={{ status: "action", label: `Nur für ${player.name}`, title: revealed ? "Merke dir deine geheime Rolle." : "Öffne jetzt deine Rollenkarte.", instruction: revealed ? "Lies deine Aufgabe. Bestätige unten, wenn du fertig bist; die Rolle wird dabei verborgen." : "Alle anderen schauen weg. Tippe unten, um deine Rolle zu sehen.", requiresConfirmation: true }} />
    {revealed ? <div className="role-detail"><div className={`role-orb team-${player.team}`}><RoleIcon role={player.role} /></div><Badge variant="outline">{player.team === "wolf" ? "Team Rudel" : player.team === "village" ? "Team Dorf" : "Eigenes Ziel"}</Badge><h3>{ROLE_INFO[player.role].label}</h3><p>{ROLE_INFO[player.role].description}</p>{pack && (player.team === "wolf" || player.role === "white_werewolf") && <p><strong>Dein Rudel:</strong> {pack}</p>}<Button variant="ghost" onClick={() => setRevealed(false)}><LockKeyhole aria-hidden="true" />Kurz verbergen</Button></div> : <div className="handoff-person"><div className="role-orb"><LockKeyhole aria-hidden="true" /></div><strong>{player.name}</strong><p>Deine Rolle ist verborgen.</p></div>}
    <ConfirmBar label={revealed ? doneLabel : "Meine Rolle öffnen"} summary={revealed ? handoff ? "Du musst noch bestätigen" : "Deine Rolle ist geöffnet" : "Die Rollenkarte ist nur für dich"} instruction={revealed ? handoff ? "Erst bestätigen, danach das Handy weitergeben." : "Schließe die Karte, um zur Partie zurückzukehren." : "Tippe auf den Knopf, um sie zu lesen."} stage={revealed ? handoff ? "Schritt 2 von 2 · Bestätigen" : "Private Information" : "Schritt 1 von 2 · Ansehen"} onConfirm={revealed ? () => { setRevealed(false); onDone(); } : () => setRevealed(true)} />
  </CardContent></Card>;
}

function LocalInfoSheet({ players, selected, setSelected, close }: { players: LocalPlayer[]; selected: string; setSelected: (id: string) => void; close: () => void }) {
  const player = players.find((item) => item.id === selected);
  const pack = player ? players.filter((item) => item.id !== player.id && (item.team === "wolf" || item.role === "white_werewolf")).map((item) => item.name).join(", ") : "";
  return <ModalSheet className="wolf-sheet role-sheet" labelledBy="local-role-info-title" close={close}><Button className="sheet-close" variant="ghost" size="icon" onClick={close} aria-label="Private Rolleninfo schließen"><X aria-hidden="true" /></Button>{!player ? <><span className="wolf-step">Geheime Rollenkarte</span><h2 id="local-role-info-title">Wer möchte nachsehen?</h2><p>Wähle nur deinen eigenen Namen. Danach kannst du deine Karte öffnen.</p><div className="player-choice-list">{players.map((item) => <PlayerChoice key={item.id} id={item.id} name={item.name} selected={false} onSelect={setSelected} />)}</div></> : <LocalSecret key={player.id} player={player} pack={pack} onDone={close} doneLabel="Rollenkarte schließen" />}</ModalSheet>;
}
