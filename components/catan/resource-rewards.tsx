"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, Shield, Trophy, X } from "lucide-react";
import { RESOURCES, RESOURCE_INFO, resourceCount, type CatanNotification, type CatanView, type Resource } from "@/lib/catan";
import { collectNotification, createNotificationQueue, presentedResources, updateNotificationQueue } from "@/lib/catan-notifications";
import { ResourceIcon } from "./board";

export function useCatanNotifications(game: CatanView, afterSequence?: number) {
  const storageKey = `gameson-catan-notices:${game.id}:${game.me!.id}`;
  const [queue, setQueue] = useState(() => {
    let after = afterSequence;
    if (after === undefined && typeof window !== "undefined") {
      try {
        const stored = sessionStorage.getItem(storageKey);
        if (stored !== null && Number.isSafeInteger(Number(stored))) after = Math.min(game.sequence, Number(stored));
      } catch { /* Notifications also work when browser storage is unavailable. */ }
    }
    return createNotificationQueue(game, after);
  });
  const next = updateNotificationQueue(queue, game);
  if (next !== queue) setQueue(next);
  const collect = useCallback((id: number, resource?: Resource) => {
    setQueue((current) => collectNotification(current, id, resource));
  }, []);
  useEffect(() => {
    if (afterSequence !== undefined) return;
    // Persist the last completed notice, so a reload keeps unread changes.
    try { sessionStorage.setItem(storageKey, String(queue.notices[0] ? queue.notices[0].id - 1 : queue.sequence)); } catch { /* Optional persistence. */ }
  }, [afterSequence, queue.notices, queue.sequence, storageKey]);
  return { resources: presentedResources(game, queue), notice: queue.notices[0], remaining: queue.notices.length, arrivals: queue.arrivals, collect };
}

const FADE_MS = 220;
const FLIGHT_MS = 760;
const STAGGER_MS = 110;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function CatanNotificationContent({ notice }: { notice: CatanNotification }) {
  const Icon = notice.tone === "loss" ? Minus : notice.tone === "gain" ? Plus : notice.kind === "award" ? Trophy : Shield;
  const amount = notice.resources ? resourceCount(notice.resources) : 0;
  return <>
    <div className="catan-event-heading">
      <span className="catan-event-icon"><Icon aria-hidden="true" /></span>
      <div><span className="catan-event-kicker">{notice.kind === "resources" ? notice.tone === "loss" ? "Rohstoffe verloren" : "Rohstoffe erhalten" : notice.kind === "card" ? "Entwicklungskarte" : notice.kind === "award" ? "Sonderkarte" : "Räuber"}</span><h2>{notice.title}</h2></div>
    </div>
    <p className="catan-event-message">{notice.message}</p>
    {notice.resources && <>
      <strong className="catan-event-total">{notice.tone === "loss" ? "−" : "+"}{amount} Rohstoff{amount === 1 ? "karte" : "karten"}</strong>
      <div className="catan-reward-row">{RESOURCES.filter((resource) => notice.resources![resource] > 0).map((resource) => <div className="catan-reward-slot" data-reward-resource={resource} key={resource}>
        <div className="catan-reward-card" style={{ "--resource-color": RESOURCE_INFO[resource].color } as CSSProperties}>
          <span className="catan-reward-symbol"><ResourceIcon resource={resource} /></span><strong>{notice.tone === "loss" ? "−" : "+"}{notice.resources![resource]}</strong><span className="catan-reward-label">{RESOURCE_INFO[resource].label}</span>
        </div>
      </div>)}</div>
    </>}
  </>;
}

export function CatanNotificationPopup({ notice, remaining, targets, onCollect }: {
  notice: CatanNotification; remaining: number; targets: RefObject<Partial<Record<Resource, HTMLElement | null>>>; onCollect: (id: number, resource?: Resource) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const paused = useRef(false);
  useLayoutEffect(() => {
    const overlay = root.current;
    if (!overlay) return;
    const panel = overlay.querySelector<HTMLElement>(".catan-event-panel")!;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const slots = Array.from(overlay.querySelectorAll<HTMLElement>("[data-reward-resource]"));
    const cards = slots.map((slot) => slot.firstElementChild as HTMLElement);
    const hasFlight = notice.kind === "resources" && notice.tone === "gain";
    const hold = notice.kind === "resources" ? 2500 : 4200;
    const arrived = new Set<number>();
    let frame = 0;
    let last: number | null = null;
    let elapsed = 0;
    let disposed = false;
    const finish = () => { if (!disposed) { disposed = true; onCollect(notice.id); } };
    const resetClock = () => { last = null; };
    document.addEventListener("visibilitychange", resetClock);
    const animate = (now: number) => {
      if (disposed) return;
      // A background tab, a focused reader or rolling dice must not swallow a notice.
      if (document.hidden || paused.current || document.documentElement.classList.contains("catan-dice-rolling")) {
        last = null; frame = requestAnimationFrame(animate); return;
      }
      if (last !== null) elapsed += Math.min(now - last, 100);
      last = now;
      overlay.style.visibility = "visible";
      const fade = reducedMotion ? 1 : clamp(elapsed / FADE_MS);
      const progress = clamp((elapsed - FADE_MS - hold) / 240);
      panel.style.opacity = String(fade);
      panel.style.transform = reducedMotion ? "none" : `translateY(${12 * (1 - fade)}px)`;
      overlay.dataset.stage = elapsed < FADE_MS + hold ? "popup" : "collecting";
      // Every card aims at its own field in the pinned hand, so the counter it raises is the one it lands on.
      const landings = hasFlight ? slots.map((slot) => targets.current?.[slot.dataset.rewardResource as Resource]?.getBoundingClientRect()) : [];
      if (!hasFlight || landings.some((box) => !box?.width || !box.height)) {
        panel.style.opacity = String(fade * (1 - progress));
        if (progress === 1) { finish(); return; }
      } else {
        // Preserve the cards' flight into the hand after the readable receipt.
        slots.forEach((slot, index) => {
          if (arrived.has(index)) return;
          const card = cards[index]; const destination = landings[index]!;
          const travelProgress = clamp((elapsed - FADE_MS - hold - index * (reducedMotion ? 0 : STAGGER_MS)) / (reducedMotion ? 180 : FLIGHT_MS));
          if (reducedMotion) card.style.opacity = String(1 - travelProgress);
          else {
            const from = slot.getBoundingClientRect();
            const x = destination.left + destination.width / 2 - from.left - from.width / 2;
            const y = destination.top + destination.height / 2 - from.top - from.height / 2;
            const travel = travelProgress * travelProgress * (3 - 2 * travelProgress);
            const curve = Math.sin(travelProgress * Math.PI);
            const neck = curve * 42;
            card.style.transform = `translate3d(${x * travel}px, ${y * travel - 32 * curve}px, 0) scale(${1 - .94 * Math.pow(travelProgress, .72)}, ${1 + .24 * curve - .94 * travelProgress * travelProgress})`;
            card.style.clipPath = `polygon(0 0, 100% 0, ${100 - neck}% 100%, ${neck}% 100%)`;
            card.style.opacity = String(1 - clamp((travelProgress - .84) / .16));
          }
          if (travelProgress === 1) { arrived.add(index); onCollect(notice.id, slot.dataset.rewardResource as Resource); }
        });
        if (arrived.size === slots.length) { finish(); return; }
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => { disposed = true; cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", resetClock); };
  }, [notice, targets, onCollect]);

  if (typeof document === "undefined") return null;
  return createPortal(<div ref={root} className={`catan-resource-rewards catan-event-overlay is-${notice.tone}`}>
    <div className="catan-event-panel" onMouseEnter={() => { paused.current = true; }} onMouseLeave={() => { paused.current = false; }} onFocus={() => { paused.current = true; }} onBlur={() => { paused.current = false; }}>
      <div role="status" aria-live="polite" aria-atomic="true"><CatanNotificationContent notice={notice} /></div>
      <button type="button" className="catan-event-dismiss" onClick={() => onCollect(notice.id)} aria-label={remaining > 1 ? `Nächste Meldung (${remaining - 1} weitere)` : "Meldung schließen"}><X aria-hidden="true" /></button>
      <span className="catan-event-footer">{remaining > 1 ? `${remaining - 1} weitere Meldung${remaining > 2 ? "en" : ""}` : "Schließt automatisch"}</span>
    </div>
  </div>, document.body);
}
