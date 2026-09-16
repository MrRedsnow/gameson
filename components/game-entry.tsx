"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, Copy, DoorOpen, Hourglass, LogOut, Plus, RotateCcw, Settings2, Share2, Smartphone, Undo2, Users, X } from "lucide-react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { RESUME_DISCARD_SECONDS } from "@/lib/game-session";

export function GameBackLink() {
  // Full page navigation keeps the two game routes independent in vinext.
  // eslint-disable-next-line @next/next/no-html-link-for-pages
  return <a className="game-back-link" href="/"><ArrowLeft aria-hidden="true" />Zur Spielauswahl</a>;
}

export function GameModes({ onCreate, onJoin, onLocal }: {
  onCreate: () => void; onJoin: () => void; onLocal: () => void;
}) {
  const modes = [
    { title: "Lobby erstellen", description: "Alle spielen auf dem eigenen Handy. Du lädst die Gruppe ein.", Icon: Users, action: onCreate },
    { title: "Lobby beitreten", description: "Tritt einer bestehenden Runde bei.", Icon: DoorOpen, action: onJoin },
    { title: "Ein Gerät für alle", description: "Reicht das Handy weiter und spielt gemeinsam.", Icon: Smartphone, action: onLocal },
  ];
  return <section className="game-modes" aria-label="Spielmodus auswählen">
    {modes.map(({ title, description, Icon, action }, index) => <Button
      key={title} variant="outline" type="button" className={`game-mode${index === 0 ? " game-mode-primary" : ""}`} onClick={action}
    >
      <span className="game-mode-icon"><Icon aria-hidden="true" /></span>
      <span className="game-mode-copy"><strong>{title}</strong><span>{description}</span></span>
      <ChevronRight className="game-mode-arrow" aria-hidden="true" />
    </Button>)}
  </section>;
}

const RULES = {
  imposter: {
    goal: "Entlarvt die Imposter unter euch. Als Imposter versuchst du, mit deinen Hinweisen unentdeckt zu bleiben.",
    steps: [
      ["Wort ansehen", "Alle sehen ihre geheime Rolle und ihr Wort. Die Gruppe bekommt dasselbe Wort, die Imposter ein ähnliches."],
      ["Hinweise geben", "Beschreibt euren Begriff, ohne ihn zu nennen. Hört genau hin: Wessen Hinweise passen nicht?"],
      ["Abstimmen", "Wählt die verdächtigste Person. Ihr seht die Stimmenverteilung; die Rollen bleiben geheim."],
    ],
    extra: "Mehrere Handys: Eine Person erstellt die Lobby, die anderen treten per Link, QR-Code oder Gruppenname bei. Auf einem Gerät reicht ihr das Handy weiter; nur die Person, die gerade dran ist, schaut auf den Bildschirm.",
  },
  werewolf: {
    goal: "Das Dorf versucht, alle Werwölfe zu finden. Das Rudel gewinnt im Grundspiel, sobald mindestens so viele Werwölfe wie andere Personen leben.",
    steps: [
      ["Rolle kennenlernen", "Lies deine geheime Rolle. Für den Einstieg reichen Werwölfe und Dorfbewohner; Zusatzrollen sind optional."],
      ["Die Nacht spielen", "Die Werwölfe wählen ihr Opfer. Folgt den Anweisungen auf dem Bildschirm; Zusatzrollen erhalten eigene Aufgaben."],
      ["Diskutieren und abstimmen", "Besprecht am Tag euren Verdacht und stimmt eine Person aus dem Dorf. Nacht und Tag wechseln, bis eine Seite gewinnt."],
    ],
    extra: "Am Spielende werden alle Rollen aufgedeckt. Manche Zusatzrollen haben eigene Siegbedingungen; diese stehen auf ihrer Rollenkarte. Ihr könnt mit mehreren Handys oder gemeinsam auf einem Gerät spielen.",
  },
} as const;

export function GameRules({ game }: { game: keyof typeof RULES }) {
  const rules = RULES[game];
  return <details className="game-rules">
    <summary><BookOpen aria-hidden="true" /><span>So funktioniert’s</span><ChevronRight aria-hidden="true" /></summary>
    <div className="game-rules-content">
      <p className="game-rules-meta">3–22 Personen · Ein Gerät oder mehrere Handys</p>
      <p>{rules.goal}</p>
      <ol>{rules.steps.map(([title, description]) => <li key={title}><strong>{title}</strong><p>{description}</p></li>)}</ol>
      <p>{rules.extra}</p>
      <p className="game-rules-duration">Die Dauer hängt von eurer Gruppengröße und eurem Diskussionstempo ab.</p>
    </div>
  </details>;
}

export type ResumeLobbyInfo = { name?: string; detail: string };
export type GameTheme = "imposter" | "werewolf" | "catan" | "slf";

// Dialogs are portaled outside the route layout, so each game's theme class travels with the content.
const DIALOG_THEME_CLASS: Record<GameTheme, string> = {
  imposter: "imposter-theme imposter-dialog",
  werewolf: "werewolf-theme wolf-dialog",
  catan: "catan-theme catan-dialog",
  slf: "slf-theme slf-dialog",
};

/** Every window in every game is built from the same class: its theme, plus one shared shape and position. */
export const gameDialogClass = (theme: GameTheme, extra = "") => `${DIALOG_THEME_CLASS[theme]} game-dialog ${extra}`.trim();

/** One window for every game: a sheet at the bottom on phones, a centred card from 600px up. */
export function GameDialog({ theme, kicker, title, description, className = "", closeLabel = "Fenster schließen", footer, busy = false, onClose, children }: {
  theme: GameTheme; kicker?: string; title: string; description?: ReactNode; className?: string; closeLabel?: string;
  footer?: ReactNode; busy?: boolean; onClose: () => void; children: ReactNode;
}) {
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className={gameDialogClass(theme, className)} showCloseButton={false} {...(description ? {} : { "aria-describedby": undefined })}>
      <header className="game-dialog-head">
        <span className="game-dialog-heading">{kicker && <span className="game-dialog-kicker">{kicker}</span>}<DialogTitle>{title}</DialogTitle></span>
        <Button type="button" variant="ghost" size="icon" className="game-dialog-close" disabled={busy} aria-label={closeLabel} onClick={onClose}><X aria-hidden="true" /></Button>
      </header>
      {description && <DialogDescription>{description}</DialogDescription>}
      <div className="game-dialog-body">{children}</div>
      {footer && <div className="game-dialog-footer">{footer}</div>}
    </DialogContent>
  </Dialog>;
}

/** Every game asks the same way before a round is left or closed – never through a browser popup. */
export function ConfirmDialog({ theme, title, description, confirmLabel, cancelLabel = "Abbrechen", confirmIcon, tone = "danger", busy = false, onConfirm, onCancel }: {
  theme: GameTheme; title: string; description: ReactNode; confirmLabel: string; cancelLabel?: string;
  confirmIcon?: ReactNode; tone?: "danger" | "accept"; busy?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
    <DialogContent className={gameDialogClass(theme, "game-confirm-dialog")} showCloseButton={false}>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
      <div className="game-dialog-actions">
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>{cancelLabel}</Button>
        <Button type="button" className={tone === "danger" ? "game-danger-action" : "game-accept-action"} disabled={busy} onClick={onConfirm}>{confirmIcon}{confirmLabel}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

const QR_COLORS: Record<GameTheme, { dark: string; light: string }> = {
  imposter: { dark: "#171713", light: "#f4f0e7" },
  werewolf: { dark: "#192333", light: "#ffffff" },
  catan: { dark: "#13232b", light: "#f4f0e5" },
  slf: { dark: "#183d37", light: "#f4f3ec" },
};

/** The same invitation in every game: scan the code, share the link, or read out the group name. */
export function LobbyInviteDialog({ theme, name, code, codeLabel = "Gruppenname", url, onClose, onError }: {
  theme: GameTheme; name: string; code: string; codeLabel?: string; url: string; onClose: () => void; onError?: (error: unknown) => void;
}) {
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!url) return;
    let active = true;
    QRCode.toDataURL(url, { width: 420, margin: 1, color: QR_COLORS[theme] }).then((value) => { if (active) setQr(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [theme, url]);
  const copy = useCallback(async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch (error) { onError?.(error); }
  }, [onError, url]);
  const share = async () => {
    try { if (navigator.share) await navigator.share({ title: `Lobby ${name}`, text: `Komm in unsere Lobby „${name}“`, url }); else await copy(); }
    catch (error) { if ((error as Error).name !== "AbortError") onError?.(error); }
  };
  return <GameDialog theme={theme} kicker="Einladen" title="So kommen die anderen dazu." description="QR-Code scannen oder den Einladungslink teilen. Danach fehlt nur noch der Name." className="lobby-invite-dialog" closeLabel="Einladung schließen" onClose={onClose}>
    {/* A plain img keeps this window usable in every game and in the render tests; the data URL needs no optimisation. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {qr && <img className="lobby-invite-qr" src={qr} alt={`QR-Code zur Lobby ${name}`} width={300} height={300} />}
    <div className="lobby-invite-code"><span>{codeLabel}</span><strong>{code}</strong></div>
    <Button type="button" className="game-accept-action" onClick={share}><Share2 aria-hidden="true" />Einladung teilen</Button>
    <Button type="button" variant="outline" onClick={copy}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? "Link kopiert" : "Link kopieren"}</Button>
    <p className="lobby-invite-hint" role="status">{copied ? "Der Link ist kopiert. Du kannst ihn jetzt in eure Gruppe einfügen." : "Neue Personen erscheinen automatisch in der Lobby."}</p>
  </GameDialog>;
}

/** Invitation and settings sit in the same place in every lobby: directly under the lobby name. */
export function LobbyToolbar({ onInvite, onSettings, inviteLabel = "Einladen", settingsLabel = "Einstellungen", busy = false }: {
  onInvite: () => void; onSettings?: () => void; inviteLabel?: string; settingsLabel?: string; busy?: boolean;
}) {
  return <div className="lobby-toolbar">
    <Button type="button" variant="outline" onClick={onInvite}><Share2 aria-hidden="true" />{inviteLabel}</Button>
    {onSettings && <Button type="button" variant="outline" disabled={busy} onClick={onSettings}><Settings2 aria-hidden="true" />{settingsLabel}</Button>}
  </div>;
}

/** The way out of a lobby looks the same everywhere and always sits below the lobby. */
export function LobbyLeaveButton({ label = "Lobby verlassen", busy = false, onClick }: { label?: string; busy?: boolean; onClick: () => void }) {
  return <Button type="button" variant="ghost" className="lobby-leave" disabled={busy} onClick={onClick}><LogOut aria-hidden="true" />{label}</Button>;
}

/** The three states of the stored-round prompt: choose, count down before discarding, or acknowledge a round that is gone. */
export function ResumeSessionPanel({ lobby, remaining, seconds = RESUME_DISCARD_SECONDS, onResume, onNewGame, onCancel }: {
  lobby: ResumeLobbyInfo | null | undefined; remaining: number | null; seconds?: number;
  onResume: () => void; onNewGame: () => void; onCancel: () => void;
}) {
  if (lobby === null) return <div className="resume-panel">
    <span className="resume-kicker"><Hourglass aria-hidden="true" />Runde nicht mehr verfügbar</span>
    <DialogTitle>Diese Runde ist vorbei</DialogTitle>
    <DialogDescription>Die Lobby wurde geschlossen oder du bist nicht mehr dabei. Starte einfach ein neues Spiel.</DialogDescription>
    <div className="resume-actions"><Button type="button" className="game-accept-action" onClick={onNewGame}><Plus aria-hidden="true" />Neues Spiel starten</Button></div>
  </div>;
  if (remaining !== null) return <div className="resume-panel">
    <span className="resume-kicker"><Hourglass aria-hidden="true" />Runde wird verlassen</span>
    <DialogTitle>Du verlässt die Runde</DialogTitle>
    <DialogDescription>Danach kannst du eine neue Lobby erstellen oder einer beitreten. Für die anderen läuft die Runde weiter.</DialogDescription>
    <div className="resume-countdown" role="status" aria-live="polite" aria-atomic="true">
      <strong>{remaining}</strong>
      <p>Noch {remaining} {remaining === 1 ? "Sekunde" : "Sekunden"}, um es dir anders zu überlegen.</p>
      <div className="resume-countdown-bar" aria-hidden="true"><span style={{ animationDuration: `${seconds}s` }} /></div>
    </div>
    <div className="resume-actions"><Button type="button" className="game-accept-action" onClick={onCancel}><Undo2 aria-hidden="true" />Abbrechen – in der Runde bleiben</Button></div>
  </div>;
  return <div className="resume-panel">
    <span className="resume-kicker"><Hourglass aria-hidden="true" />Laufende Runde gefunden</span>
    <DialogTitle>{lobby?.name ? `Zurück zu „${lobby.name}“?` : "Zurück zu deiner Runde?"}</DialogTitle>
    <DialogDescription>Dieses Gerät ist noch mit einer Lobby verbunden. Steig wieder ein – oder verlasse die Runde auf diesem Gerät.</DialogDescription>
    <div className="resume-lobby" role="status">{lobby ? <>{lobby.name && <strong>{lobby.name}</strong>}<span>{lobby.detail}</span></> : <span>Verbindung wird geprüft …</span>}</div>
    <div className="resume-actions">
      <Button type="button" className="game-accept-action" onClick={onResume}>Zurück zur Runde<ArrowRight aria-hidden="true" /></Button>
      <Button type="button" className="game-danger-action" onClick={onNewGame}><RotateCcw aria-hidden="true" />Laufende Runde verlassen</Button>
      <p className="resume-hint">Für die anderen läuft die Runde weiter. Auf diesem Gerät wird sie nach {seconds} Sekunden verworfen – bis dahin kannst du abbrechen.</p>
    </div>
  </div>;
}

/** Asks whether to rejoin a stored online round or start fresh; discarding waits out a short, cancelable countdown. */
export function ResumeSessionDialog({ theme, lobby, seconds = RESUME_DISCARD_SECONDS, onResume, onDiscard }: {
  theme: GameTheme; lobby: ResumeLobbyInfo | null | undefined; seconds?: number; onResume: () => void; onDiscard: () => void;
}) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const discard = useRef(onDiscard);
  useEffect(() => { discard.current = onDiscard; }, [onDiscard]);
  const gone = lobby === null;
  useEffect(() => {
    if (remaining === null || gone) return;
    const timer = window.setTimeout(() => { if (remaining <= 1) discard.current(); else setRemaining(remaining - 1); }, 1000);
    return () => window.clearTimeout(timer);
  }, [remaining, gone]);
  const keepOpen = (event: Event) => event.preventDefault();
  return <Dialog open onOpenChange={() => undefined}>
    <DialogContent className={gameDialogClass(theme, "resume-dialog")} showCloseButton={false} onEscapeKeyDown={(event) => { event.preventDefault(); setRemaining(null); }} onPointerDownOutside={keepOpen} onInteractOutside={keepOpen}>
      <ResumeSessionPanel lobby={lobby} remaining={remaining} seconds={seconds} onResume={onResume} onNewGame={() => { if (gone) onDiscard(); else setRemaining(seconds); }} onCancel={() => setRemaining(null)} />
    </DialogContent>
  </Dialog>;
}
