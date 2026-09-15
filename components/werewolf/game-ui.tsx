"use client";

import { ArrowRight, Check, CheckCircle2, Circle, Clock3, Eye, Heart, Info, LoaderCircle, LockKeyhole, Moon, Shield, Skull, Sparkles, Sun, Swords, Users, Vote, WandSparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { WerewolfPhase, WerewolfRole } from "@/lib/werewolf";
import type { Guidance } from "@/lib/werewolf-guidance";

const DAY_PHASES: WerewolfPhase[] = ["dawn", "discussion", "day_vote", "runoff", "mayor_vote", "hunter"];

export function PhaseHeader({ phase, night, title, living, total, local = false, nightHandoff = false }: {
  phase: WerewolfPhase; night: number; title: string; description?: string;
  living: number; total: number; local?: boolean; nightHandoff?: boolean;
}) {
  const isDay = DAY_PHASES.includes(phase) && !nightHandoff;
  const preparation = ["waiting", "role_reveal"].includes(phase) || night === 0;
  const Icon = preparation ? LockKeyhole : isDay ? Sun : Moon;
  return <header className={`phase-context ${isDay ? "is-day" : "is-night"}`}>
    <span className="phase-context-symbol"><Icon aria-hidden="true" /></span>
    <div><span className="context-eyebrow">{phase === "results" ? "Spielende" : preparation ? "Spielbeginn" : `${isDay ? "Tag" : "Nacht"} ${nightHandoff ? night + 1 : night}`}{local && " · Ein Gerät"}</span><h1>{title}</h1></div>
    <Badge variant="outline" className="player-count"><Users aria-hidden="true" />{living}/{total}<span className="sr-only"> Personen im Dorf</span></Badge>
  </header>;
}

export function TaskStatus({ guidance, busy = false }: { guidance: Guidance; busy?: boolean }) {
  const Icon = busy ? LoaderCircle : guidance.status === "confirmed" ? CheckCircle2 : guidance.status === "waiting" ? Clock3 : ArrowRight;
  return <header className={`task-status status-${busy ? "saving" : guidance.status}`} aria-live="polite" aria-atomic="true">
    <span className="task-state-label"><Icon aria-hidden="true" />{busy ? "Bestätigung wird gesendet" : guidance.label}</span>
    <h2>{busy ? "Einen Moment bitte …" : guidance.title}</h2>
    <p>{busy ? "Deine Entscheidung wird übertragen. Bitte warte auf die Bestätigung." : guidance.instruction}</p>
  </header>;
}

export function ConfirmBar({ label, summary, instruction, disabled = false, busy = false, onConfirm, stage = "Bestätigung erforderlich", compact = false }: {
  label: string; summary: string; instruction: string; disabled?: boolean; busy?: boolean;
  onConfirm: () => void | Promise<unknown>; stage?: string; compact?: boolean;
}) {
  return <footer className={`confirm-dock ${disabled ? "needs-selection" : "can-confirm"}${compact ? " confirm-dock-compact" : ""}`}>
    <div className="confirm-dock-inner"><div className="confirmation-copy" aria-live="polite">{!compact && <span>{busy ? "Wird gesendet" : stage}</span>}<strong>{busy ? "Bitte kurz warten …" : summary}</strong>{(!compact || instruction || busy) && <p>{busy ? "Noch keine Bestätigung erhalten." : instruction}</p>}</div>
      <Button className="primary-button wolf-primary" disabled={disabled || busy} onClick={() => void onConfirm()}>{busy ? <LoaderCircle className="saving-spinner" aria-hidden="true" /> : <Check aria-hidden="true" />}{busy ? "Wird bestätigt …" : label}</Button>
    </div>
  </footer>;
}

export function DecisionSteps({ selected = false, confirmed = false }: { selected?: boolean; confirmed?: boolean }) {
  const current = confirmed ? 2 : selected ? 1 : 0;
  return <ol className="decision-steps" aria-label="Deine Entscheidung">
    {["Auswählen", "Bestätigen", "Fertig"].map((label, index) => <li key={label} className={index === current ? "is-current" : index < current ? "is-done" : ""} aria-current={index === current ? "step" : undefined}><span>{index < current ? <Check aria-hidden="true" /> : index + 1}</span>{label}</li>)}
  </ol>;
}

export function ActionProgress({ submitted, required, label = "Personen haben bestätigt" }: { submitted: number; required: number; label?: string }) {
  if (required < 1) return null;
  return <div className="action-progress"><div><span>{label}</span><strong>{submitted} von {required}</strong></div><Progress value={Math.min(100, submitted / required * 100)} aria-label={label} /></div>;
}

export function PrivateRoleButton({ onClick, alive = true }: { onClick: () => void; alive?: boolean }) {
  return <Button variant="outline" className="private-role-control" onClick={onClick}><LockKeyhole aria-hidden="true" />Meine Rolle<span className="sr-only">{alive ? "privat ansehen" : "ausgeschieden"}</span></Button>;
}

export function RoleIcon({ role }: { role?: WerewolfRole }) {
  const Icon = !role ? LockKeyhole : role === "seer" ? Eye : role === "witch" || role === "piper" ? WandSparkles : role === "cupid" ? Heart : role === "healer" || role === "elder" ? Shield : role === "werewolf" || role === "white_werewolf" ? Moon : role === "hunter" ? Swords : role === "villager" ? Users : Sparkles;
  return <Icon aria-hidden="true" />;
}

export function SettingSwitch({ id, title, description, checked, onCheckedChange }: { id: string; title: string; description?: string; checked: boolean; onCheckedChange: (value: boolean) => void }) {
  return <div className="setting-toggle"><label htmlFor={id}><strong>{title}</strong>{description && <small>{description}</small>}</label><Switch id={id} checked={checked} onCheckedChange={onCheckedChange} /></div>;
}

export function PlayerSelect({ id, value, onValueChange, candidates }: { id: string; value: string; onValueChange: (value: string) => void; candidates: { id: string; name: string }[] }) {
  return <div className="poison-select"><label htmlFor={id}>Gifttrank einsetzen bei</label><Select value={value || "__none"} onValueChange={(next) => onValueChange(next === "__none" ? "" : next)}><SelectTrigger id={id} className="poison-select-trigger" aria-label="Ziel für den Gifttrank"><SelectValue /></SelectTrigger><SelectContent className="werewolf-theme wolf-select-content" position="popper"><SelectItem value="__none">Niemandem · Trank aufbewahren</SelectItem>{candidates.map((candidate) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>)}</SelectContent></Select></div>;
}

export function PlayerChoice({ id, name, selected, onSelect, disabled = false }: { id: string; name: string; selected: boolean; onSelect: (id: string) => void; disabled?: boolean }) {
  return <Button variant="outline" className={`player-choice ${selected ? "is-selected" : ""}`} aria-pressed={selected} disabled={disabled} onClick={() => onSelect(id)}><span className="choice-avatar" aria-hidden="true">{name.charAt(0)}</span><strong>{name}</strong><span className="choice-state">{selected ? "Ausgewählt" : "Wählen"}</span>{selected ? <CheckCircle2 aria-hidden="true" /> : <Circle aria-hidden="true" />}</Button>;
}

export function GameEmptyState({ kind = "waiting", title, description }: { kind?: "waiting" | "ghost" | "votes" | "discussion"; title: string; description: string }) {
  const Icon = kind === "ghost" ? Skull : kind === "votes" ? Vote : kind === "discussion" ? Users : Info;
  return <div className={`game-empty-state empty-${kind}`}><Icon aria-hidden="true" /><h3>{title}</h3><p>{description}</p></div>;
}
