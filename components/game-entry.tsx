"use client";

import { ArrowLeft, BookOpen, ChevronRight, DoorOpen, Smartphone, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

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
