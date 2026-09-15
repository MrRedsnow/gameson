"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, ChevronRight, DoorOpen, Hourglass, Plus, RotateCcw, Smartphone, Undo2, Users } from "lucide-react";
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
export type ResumeGameTheme = "imposter" | "werewolf" | "catan";

// Dialogs are portaled outside the route layout, so each game's theme class travels with the content.
const RESUME_DIALOG_CLASS: Record<ResumeGameTheme, string> = {
  imposter: "imposter-theme resume-dialog",
  werewolf: "werewolf-theme wolf-dialog resume-dialog",
  catan: "catan-theme catan-dialog resume-dialog",
};

/** The three states of the stored-round prompt: choose, count down before discarding, or acknowledge a round that is gone. */
export function ResumeSessionPanel({ lobby, remaining, seconds = RESUME_DISCARD_SECONDS, onResume, onNewGame, onCancel }: {
  lobby: ResumeLobbyInfo | null | undefined; remaining: number | null; seconds?: number;
  onResume: () => void; onNewGame: () => void; onCancel: () => void;
}) {
  if (lobby === null) return <div className="resume-panel">
    <span className="resume-kicker"><Hourglass aria-hidden="true" />Runde nicht mehr verfügbar</span>
    <DialogTitle>Diese Runde ist vorbei</DialogTitle>
    <DialogDescription>Die Lobby wurde geschlossen oder du bist nicht mehr dabei. Starte einfach ein neues Spiel.</DialogDescription>
    <div className="resume-actions"><Button type="button" onClick={onNewGame}><Plus aria-hidden="true" />Neues Spiel starten</Button></div>
  </div>;
  if (remaining !== null) return <div className="resume-panel">
    <span className="resume-kicker"><Hourglass aria-hidden="true" />Neues Spiel</span>
    <DialogTitle>Runde wird verworfen</DialogTitle>
    <DialogDescription>Danach kannst du eine neue Lobby erstellen oder einer beitreten. Für die anderen läuft die alte Runde weiter.</DialogDescription>
    <div className="resume-countdown" role="status" aria-live="polite" aria-atomic="true">
      <strong>{remaining}</strong>
      <p>Noch {remaining} {remaining === 1 ? "Sekunde" : "Sekunden"}, um es dir anders zu überlegen.</p>
      <div className="resume-countdown-bar" aria-hidden="true"><span style={{ animationDuration: `${seconds}s` }} /></div>
    </div>
    <div className="resume-actions"><Button type="button" onClick={onCancel}><Undo2 aria-hidden="true" />Abbrechen – Runde behalten</Button></div>
  </div>;
  return <div className="resume-panel">
    <span className="resume-kicker"><RotateCcw aria-hidden="true" />Laufende Runde gefunden</span>
    <DialogTitle>{lobby?.name ? `Zurück zu „${lobby.name}“?` : "Zurück zu deiner Runde?"}</DialogTitle>
    <DialogDescription>Dieses Gerät ist noch mit einer Lobby verbunden. Steig wieder ein oder starte ein neues Spiel.</DialogDescription>
    <div className="resume-lobby" role="status">{lobby ? <>{lobby.name && <strong>{lobby.name}</strong>}<span>{lobby.detail}</span></> : <span>Verbindung wird geprüft …</span>}</div>
    <div className="resume-actions">
      <Button type="button" onClick={onResume}><RotateCcw aria-hidden="true" />Zurück zur Runde</Button>
      <Button type="button" variant="outline" onClick={onNewGame}><Plus aria-hidden="true" />Neues Spiel starten</Button>
      <p className="resume-hint">Neues Spiel: Die alte Runde wird nach {seconds} Sekunden auf diesem Gerät verworfen. Bis dahin kannst du abbrechen.</p>
    </div>
  </div>;
}

/** Asks whether to rejoin a stored online round or start fresh; discarding waits out a short, cancelable countdown. */
export function ResumeSessionDialog({ theme, lobby, seconds = RESUME_DISCARD_SECONDS, onResume, onDiscard }: {
  theme: ResumeGameTheme; lobby: ResumeLobbyInfo | null | undefined; seconds?: number; onResume: () => void; onDiscard: () => void;
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
    <DialogContent className={RESUME_DIALOG_CLASS[theme]} showCloseButton={false} onEscapeKeyDown={(event) => { event.preventDefault(); setRemaining(null); }} onPointerDownOutside={keepOpen} onInteractOutside={keepOpen}>
      <ResumeSessionPanel lobby={lobby} remaining={remaining} seconds={seconds} onResume={onResume} onNewGame={() => { if (gone) onDiscard(); else setRemaining(seconds); }} onCancel={() => setRemaining(null)} />
    </DialogContent>
  </Dialog>;
}
