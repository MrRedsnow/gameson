"use client";

import type { ReactNode } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RESOURCES, RESOURCE_INFO, type Resource, type Resources } from "@/lib/catan";
import { ResourceIcon } from "./board";

export type Send = (action: import("@/lib/catan").CatanAction) => Promise<boolean>;

export function Screen({ title, eyebrow, back, children, actions, headingAction, className = "" }: {
  title: string; eyebrow?: string; back?: () => void; children: ReactNode; actions?: ReactNode; headingAction?: ReactNode; className?: string;
}) {
  return <section className={`catan-screen ${className}`}>
    <header className="catan-screen-heading">{back && <Button variant="ghost" size="icon" aria-label="Einen Schritt zurück" onClick={back}><ArrowLeft /></Button>}<div>{eyebrow && <span className="catan-eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>{headingAction}</header>
    <div className="catan-screen-body">{children}</div>
    {actions && <footer className="catan-screen-actions">{actions}</footer>}
  </section>;
}

export function Pager({ index, total, onChange, label = "Seite" }: { index: number; total: number; onChange: (index: number) => void; label?: string }) {
  return <nav className="catan-pager" aria-label={`${label} wechseln`}>
    <Button variant="outline" size="icon" aria-label={`Vorherige ${label}`} disabled={index === 0} onClick={() => onChange(index - 1)}><ChevronLeft /></Button>
    <span role="status">{label} <strong>{index + 1}</strong> / {Math.max(1, total)}</span>
    <Button variant="outline" size="icon" aria-label={`Nächste ${label}`} disabled={index >= total - 1} onClick={() => onChange(index + 1)}><ChevronRight /></Button>
  </nav>;
}

export function ResourceChoices({ label, value, onChange, counts, disabled = false }: {
  label: string; value: Resource; onChange: (value: Resource) => void; counts?: Partial<Resources>; disabled?: boolean;
}) {
  return <fieldset className="catan-resource-choices"><legend>{label}</legend><div>{RESOURCES.map((r) => <button type="button" key={r} aria-label={`${label}: ${RESOURCE_INFO[r].label}`} aria-pressed={value === r} disabled={disabled} onClick={() => onChange(r)}>
    <ResourceIcon resource={r} /><span>{RESOURCE_INFO[r].label}</span>{counts && <strong>{counts[r] ?? 0}</strong>}
  </button>)}</div></fieldset>;
}

export function ResourceAmounts({ label, value, maximum, onChange, disabled, limit, availabilityLabel = "verfügbar" }: {
  label: string; value: Resources; maximum: Resources; onChange: (value: Resources) => void; disabled: boolean; limit?: number; availabilityLabel?: string;
}) {
  const total = RESOURCES.reduce((sum, r) => sum + value[r], 0);
  return <div className="catan-resource-amounts" role="group" aria-label={label}>
    <div className="catan-amount-heading"><strong>{label}</strong><output aria-label={`${label}: insgesamt gewählt`} aria-live="polite">{limit === undefined ? `${total} gewählt` : `${total} / ${limit} gewählt`}</output></div>
    {RESOURCES.map((r) => <div className="catan-amount-controls" key={r}><ResourceIcon resource={r} /><div><strong>{RESOURCE_INFO[r].label}</strong><small>{maximum[r]} {availabilityLabel}</small></div><div className="catan-stepper">
      <Button type="button" variant="outline" size="icon" aria-label={`${label}: weniger ${RESOURCE_INFO[r].label}`} disabled={disabled || !value[r]} onClick={() => onChange({ ...value, [r]: value[r] - 1 })}><Minus /></Button>
      <output aria-label={`${label}: ${RESOURCE_INFO[r].label}`}>{value[r]}</output>
      <Button type="button" variant="outline" size="icon" aria-label={`${label}: mehr ${RESOURCE_INFO[r].label}`} disabled={disabled || value[r] >= maximum[r] || (limit !== undefined && total >= limit)} onClick={() => onChange({ ...value, [r]: value[r] + 1 })}><Plus /></Button>
    </div></div>)}
  </div>;
}

export function BagText({ bag }: { bag: Partial<Resources> }) {
  return <span>{RESOURCES.filter((r) => bag[r]).map((r) => `${bag[r]} ${RESOURCE_INFO[r].label}`).join(", ") || "Noch nichts gewählt"}</span>;
}
