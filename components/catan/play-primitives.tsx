"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
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

/** Page by measured available height, including when the phone rotates or text grows. */
export function PagedItems<T>({ items, render, empty, itemHeight = 92, label = "Seite" }: {
  items: T[]; render: (item: T, index: number) => ReactNode; empty?: ReactNode; itemHeight?: number; label?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ height: number; heights: number[]; pagerHeight: number }>({ height: 0, heights: [], pagerHeight: 48 });
  const [anchor, setAnchor] = useState(0);
  const heights = items.map((_, i) => layout.heights[i] || itemHeight);
  const fits = heights.reduce((sum, h) => sum + h, 0) + Math.max(0, items.length - 1) * 8 <= layout.height;
  const available = fits ? layout.height : Math.max(0, layout.height - layout.pagerHeight - 8);
  const pages: number[][] = [[]]; let used = 0;
  heights.forEach((height, i) => {
    if (pages.at(-1)!.length && used + 8 + height > available) { pages.push([]); used = 0; }
    pages.at(-1)!.push(i); used += height + (used ? 8 : 0);
  });
  const index = Math.max(0, pages.findIndex((page) => page.includes(Math.min(anchor, items.length - 1))));
  const paginated = pages.length > 1;
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const measure = () => {
      if (!node.clientHeight) return;
      const next = { height: node.clientHeight, pagerHeight: node.querySelector(".catan-pager")?.getBoundingClientRect().height || 48, heights: Array.from(node.querySelectorAll<HTMLElement>(":scope > .catan-page-items > .catan-page-item"), (item) => item.getBoundingClientRect().height) };
      setLayout((previous) => previous.height === next.height && previous.pagerHeight === next.pagerHeight && previous.heights.join() === next.heights.join() ? previous : next);
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(node);
    node.querySelectorAll(":scope > .catan-page-items > .catan-page-item").forEach((item) => observer.observe(item));
    const pager = node.querySelector(".catan-pager"); if (pager) observer.observe(pager);
    return () => observer.disconnect();
  }, [items.length, paginated]);
  return <div ref={viewport} className="catan-paged-items">
    <div className="catan-page-items">{items.length ? items.map((item, i) => <div className="catan-page-item" key={i} data-page-hidden={!pages[index].includes(i)} aria-hidden={!pages[index].includes(i) || undefined} inert={!pages[index].includes(i) || undefined}>{render(item, i)}</div>) : empty}</div>
    {pages.length > 1 && <Pager index={index} total={pages.length} label={label} onChange={(next) => setAnchor(pages[next][0])} />}
  </div>;
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
  const [selected, setSelected] = useState<Resource>("wood");
  const total = RESOURCES.reduce((sum, r) => sum + value[r], 0);
  return <div className="catan-resource-amounts">
    <ResourceChoices label={label} value={selected} counts={value} onChange={setSelected} disabled={disabled} />
    <div className="catan-amount-controls"><div><strong>{RESOURCE_INFO[selected].label}</strong><small>{maximum[selected]} {availabilityLabel}{limit !== undefined ? ` · ${total} / ${limit} gewählt` : ""}</small></div><div className="catan-stepper">
      <Button variant="outline" aria-label={`${label}: weniger ${RESOURCE_INFO[selected].label}`} disabled={disabled || !value[selected]} onClick={() => onChange({ ...value, [selected]: value[selected] - 1 })}>−</Button>
      <output aria-label={`${label}: ${RESOURCE_INFO[selected].label}`}>{value[selected]}</output>
      <Button variant="outline" aria-label={`${label}: mehr ${RESOURCE_INFO[selected].label}`} disabled={disabled || value[selected] >= maximum[selected] || (limit !== undefined && total >= limit)} onClick={() => onChange({ ...value, [selected]: value[selected] + 1 })}>+</Button>
    </div></div>
  </div>;
}

export function BagText({ bag }: { bag: Partial<Resources> }) {
  return <span>{RESOURCES.filter((r) => bag[r]).map((r) => `${bag[r]} ${RESOURCE_INFO[r].label}`).join(", ") || "Noch nichts gewählt"}</span>;
}
