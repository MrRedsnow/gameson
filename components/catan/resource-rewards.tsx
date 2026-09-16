"use client";

import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { RESOURCES, RESOURCE_INFO, emptyResources, resourceCount, type CatanView, type Resource, type Resources } from "@/lib/catan";
import { ResourceIcon } from "./board";

type Snapshot = { player: string; turn: number; roll: string | null; resources: Resources };
type Reward = { id: string; gains: Resources };
type Presentation = { snapshot: Snapshot; reward: Reward | null; pending: Resources; arrivals: number };

function snapshotOf(game: CatanView): Snapshot {
  return { player: `${game.id}:${game.me!.id}`, turn: game.turn, roll: game.dice ? `${game.turn}:${game.dice.join(":")}` : null, resources: game.me!.resources };
}

/** Delay only the visible hand, never the authoritative game or its saved state. */
export function useResourceRewards(game: CatanView) {
  const snapshot = snapshotOf(game);
  const [presentation, setPresentation] = useState<Presentation>(() => ({ snapshot, reward: null, pending: emptyResources(), arrivals: 0 }));
  const previous = presentation.snapshot;
  if (previous.player !== snapshot.player || previous.turn !== snapshot.turn || previous.roll !== snapshot.roll || RESOURCES.some((resource) => previous.resources[resource] !== snapshot.resources[resource])) {
    const gains = emptyResources();
    const newRoll = previous.player === snapshot.player && snapshot.roll && previous.roll !== snapshot.roll && game.dice![0] + game.dice![1] !== 7;
    if (newRoll && typeof document !== "undefined" && !document.hidden) {
      for (const resource of RESOURCES) gains[resource] = Math.max(0, snapshot.resources[resource] - previous.resources[resource]);
    }
    // Polls with identical hands keep the flight. A changed hand/turn cancels an
    // obsolete flight so trades, discards and reconnects cannot leave stale counts.
    setPresentation({ snapshot, reward: resourceCount(gains) ? { id: `${snapshot.player}:${snapshot.roll}`, gains } : null, pending: gains, arrivals: 0 });
  }
  const collect = useCallback((id: string, resource?: Resource) => {
    setPresentation((current) => {
      if (current.reward?.id !== id) return current;
      const pending = resource ? { ...current.pending, [resource]: 0 } : emptyResources();
      return { ...current, pending, reward: resourceCount(pending) ? current.reward : null, arrivals: current.arrivals + 1 };
    });
  }, []);
  const resources = emptyResources();
  for (const resource of RESOURCES) resources[resource] = Math.max(0, game.me!.resources[resource] - presentation.pending[resource]);
  return { resources, reward: presentation.reward, arrivals: presentation.arrivals, collect };
}

const FADE_MS = 280;
const HOLD_MS = 620;
const FLIGHT_MS = 760;
const STAGGER_MS = 110;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function CatanResourceRewards({ reward, target, onCollect }: { reward: Reward; target: RefObject<HTMLSpanElement | null>; onCollect: (id: string, resource?: Resource) => void }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const overlay = root.current;
    if (!overlay) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const slots = Array.from(overlay.querySelectorAll<HTMLElement>("[data-reward-resource]"));
    const cards = slots.map((slot) => slot.firstElementChild as HTMLElement);
    const arrived = new Set<number>();
    let frame = 0;
    let started: number | null = null;
    let disposed = false;
    const finish = () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      overlay.style.visibility = "hidden";
      onCollect(reward.id);
    };
    const hide = () => { if (document.hidden) finish(); };
    document.addEventListener("visibilitychange", hide);
    const animate = (now: number) => {
      if (disposed) return;
      if (document.hidden) { finish(); return; }
      // The dice own their timing (including reduced motion and interrupted
      // docking). The first frame runs after both components' layout effects.
      if (started === null && document.documentElement.classList.contains("catan-dice-rolling")) {
        frame = requestAnimationFrame(animate);
        return;
      }
      const destination = target.current?.getBoundingClientRect();
      if (!destination?.width || !destination.height) { finish(); return; }
      started ??= now;
      const elapsed = now - started;
      overlay.style.visibility = "visible";
      overlay.dataset.stage = elapsed < FADE_MS + HOLD_MS ? "popup" : "collecting";
      const heading = overlay.querySelector<HTMLElement>(".catan-reward-heading")!;
      heading.style.opacity = String(clamp(elapsed / FADE_MS) * (1 - clamp((elapsed - FADE_MS - HOLD_MS) / 220)));
      slots.forEach((slot, index) => {
        if (arrived.has(index)) return;
        const card = cards[index];
        const age = elapsed - index * (reducedMotion ? 0 : STAGGER_MS);
        const fade = clamp(age / FADE_MS);
        const progress = clamp((age - FADE_MS - HOLD_MS) / (reducedMotion ? 180 : FLIGHT_MS));
        if (reducedMotion) {
          card.style.opacity = String(fade * (1 - progress));
        } else {
          const from = slot.getBoundingClientRect();
          const x = destination.left + destination.width / 2 - from.left - from.width / 2;
          const y = destination.top + destination.height / 2 - from.top - from.height / 2;
          const travel = progress * progress * (3 - 2 * progress);
          // First draw the lower corners inward, then stretch and shrink the
          // card along its curved path into the menu, like a funnel/genie.
          const neck = Math.sin(progress * Math.PI) * 42;
          const scaleX = (0.86 + 0.14 * fade) * (1 - 0.94 * Math.pow(progress, 0.72));
          const scaleY = (0.86 + 0.14 * fade) * (1 + 0.24 * Math.sin(progress * Math.PI) - 0.94 * progress * progress);
          const curve = Math.sin(progress * Math.PI);
          const tilt = (index - (slots.length - 1) / 2) * 5 * curve;
          card.style.transform = `translate3d(${x * travel}px, ${y * travel - 32 * curve + 16 * (1 - fade)}px, 0) rotate(${tilt}deg) scale(${scaleX}, ${scaleY})`;
          card.style.clipPath = `polygon(0 0, 100% 0, ${100 - neck}% 100%, ${neck}% 100%)`;
          card.style.opacity = String(fade * (1 - clamp((progress - 0.84) / 0.16)));
        }
        if (progress === 1) {
          arrived.add(index);
          onCollect(reward.id, slot.dataset.rewardResource as Resource);
        }
      });
      if (arrived.size === slots.length) disposed = true;
      else frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [reward, target, onCollect]);

  return createPortal(<div ref={root} className="catan-resource-rewards" aria-hidden="true">
    <div className="catan-reward-group">
      <div className="catan-reward-heading">Dein Ertrag<span>+{resourceCount(reward.gains)} Rohstoff{resourceCount(reward.gains) === 1 ? "karte" : "karten"}</span></div>
      <div className="catan-reward-row">{RESOURCES.filter((resource) => reward.gains[resource] > 0).map((resource) => <div className="catan-reward-slot" data-reward-resource={resource} key={resource}>
        <div className="catan-reward-card" style={{ "--resource-color": RESOURCE_INFO[resource].color } as CSSProperties}>
          <span className="catan-reward-symbol"><ResourceIcon resource={resource} /></span><strong>+{reward.gains[resource]}</strong><span className="catan-reward-label">{RESOURCE_INFO[resource].label}</span>
        </div>
      </div>)}</div>
    </div>
  </div>, document.body);
}
