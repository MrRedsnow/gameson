"use client";

import { useLayoutEffect, useRef } from "react";
import { Hand } from "lucide-react";
import { RESOURCES, RESOURCE_INFO, emptyResources, resourceCount, type CatanView, type Resource } from "@/lib/catan";
import { resourceGainBatch, type ResourceGainBatch } from "@/lib/catan-resource-gains";
import { ResourceIcon } from "./resource-icon";

const FLIGHT_MS = 700;
const FIELD_STAGGER_MS = 60;
const UNIT_STAGGER_MS = 140;
const COUNTER_STEP_MS = 120;
const HOLD_MS = 4000;
const FADE_MS = 200;
type Point = { x: number; y: number };
type Playback = { dispose: () => void; hideFlights: () => void };

function resourceCell(hand: HTMLElement, resource: Resource) {
  return hand.querySelector<HTMLElement>(`[data-catan-resource="${resource}"]`)!;
}

function iconCenter(cell: HTMLElement): Point | null {
  const rect = cell.querySelector("svg")?.getBoundingClientRect();
  return rect?.width && rect.height ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
}

/** SVG coordinates include the current map camera; clipped fields never launch a flight. */
function fieldCenter(hand: HTMLElement, game: CatanView, hexId: number): Point | null {
  const svg = hand.closest(".catan-play")?.querySelector<SVGSVGElement>(".catan-tab-insel[data-state=active] .catan-board");
  const hex = game.board.hexes.find((field) => field.id === hexId);
  const matrix = svg?.getScreenCTM();
  const bounds = svg?.closest(".catan-board-viewport")?.getBoundingClientRect();
  if (!svg || !hex || !matrix || !bounds?.width || !bounds.height) return null;
  const local = svg.createSVGPoint(); local.x = hex.x; local.y = hex.y;
  const point = local.matrixTransform(matrix);
  const left = Math.max(bounds.left, 0); const right = Math.min(bounds.right, window.innerWidth);
  const top = Math.max(bounds.top, 0); const bottom = Math.min(bounds.bottom, window.innerHeight);
  return point.x >= left + 12 && point.x <= right - 12 && point.y >= top + 12 && point.y <= bottom - 12 ? point : null;
}

function clearGain(cell: HTMLElement) {
  cell.classList.remove("is-gaining");
  cell.querySelector("b")?.classList.remove("is-gaining");
  const badge = cell.querySelector<HTMLElement>(".catan-hand-gain")!;
  badge.hidden = true; badge.textContent = "";
}

/** The game stays authoritative; only the presentation of its confirmed inventory is delayed. */
export function playResourceGain(hand: HTMLElement, previous: CatanView, game: CatanView, batch: ResourceGainBatch, islandVisible: boolean): Playback {
  const final = game.me!.resources;
  const cells = Object.fromEntries(RESOURCES.map((resource) => [resource, resourceCell(hand, resource)])) as Record<Resource, HTMLElement>;
  const totalCell = hand.querySelector<HTMLElement>(".catan-hand-total")!;
  const allCells = [...Object.values(cells), totalCell];
  const announcement = hand.querySelector<HTMLElement>("[data-catan-gain-announcement]")!;
  const previousTotal = resourceCount(previous.me!.resources);
  const netGain = Math.max(0, resourceCount(final) - previousTotal);
  const display = emptyResources(); const arrived = emptyResources();
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const pops = new Map<HTMLElement, Animation>();
  let canFly = islandVisible && !motion.matches;
  let frame = 0; let holdTimer = 0; let fadeTimer = 0;
  let started: number | null = null;
  let disposed = false; let complete = false;
  let overlay: HTMLDivElement | null = null;

  const setCount = (cell: HTMLElement, value: number, pop = false) => {
    const count = cell.querySelector<HTMLElement>("b")!;
    const changed = count.textContent !== String(value);
    count.textContent = String(value);
    if (changed && pop && !motion.matches && typeof count.animate === "function") {
      pops.get(count)?.cancel();
      pops.set(count, count.animate([{ transform: "scale(.88)" }, { transform: "scale(1.14)", offset: .45 }, { transform: "scale(1)" }], { duration: 250, easing: "ease-out" }));
    }
  };
  const setGain = (cell: HTMLElement, value: number) => {
    if (!value) return;
    cell.classList.add("is-gaining"); cell.querySelector("b")!.classList.add("is-gaining");
    const badge = cell.querySelector<HTMLElement>(".catan-hand-gain")!;
    badge.textContent = `+${value}`; badge.hidden = false;
  };
  const paintFinal = () => {
    for (const resource of RESOURCES) setCount(cells[resource], final[resource]);
    setCount(totalCell, resourceCount(final));
  };
  const removeFlights = () => { overlay?.remove(); overlay = null; };
  const hideFlights = () => { canFly = false; removeFlights(); };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame); clearTimeout(holdTimer); clearTimeout(fadeTimer);
    pops.forEach((animation) => animation.cancel());
    removeFlights(); paintFinal(); allCells.forEach(clearGain);
    hand.classList.remove("is-fading"); announcement.textContent = "";
    document.removeEventListener("visibilitychange", onVisibility);
    motion.removeEventListener("change", onMotion);
  };
  const finish = () => {
    if (disposed || complete) return;
    complete = true; cancelAnimationFrame(frame); removeFlights(); paintFinal();
    for (const resource of RESOURCES) setGain(cells[resource], batch.gains[resource]);
    setGain(totalCell, netGain);
    announcement.textContent = `Erhalten: ${RESOURCES.filter((resource) => batch.gains[resource]).map((resource) => `${batch.gains[resource]} ${RESOURCE_INFO[resource].label}`).join(", ")}. ${netGain ? `Insgesamt +${netGain}. ` : ""}Neuer Bestand: ${RESOURCES.map((resource) => `${final[resource]} ${RESOURCE_INFO[resource].label}`).join(", ")}.`;
    holdTimer = window.setTimeout(() => {
      hand.classList.add("is-fading");
      fadeTimer = window.setTimeout(dispose, FADE_MS);
    }, HOLD_MS);
  };
  const onVisibility = () => { if (document.hidden) dispose(); };
  const onMotion = () => {
    if (motion.matches) { hideFlights(); pops.forEach((animation) => animation.cancel()); finish(); }
  };
  document.addEventListener("visibilitychange", onVisibility);
  motion.addEventListener("change", onMotion);
  hand.classList.remove("is-fading"); allCells.forEach(clearGain);

  // Payments are already confirmed. Animate receipts toward the confirmed final hand,
  // keeping even a batched gain followed by a loss visible in the +N badges.
  for (const resource of RESOURCES) {
    display[resource] = Math.max(0, final[resource] - batch.gains[resource]);
    setCount(cells[resource], display[resource]);
  }
  setCount(totalCell, resourceCount(display));

  const fields = new Map<number, number>(); const units = new Map<number, number>();
  let headerIndex = 0;
  const steps = batch.steps.map((step) => {
    const origin = canFly && step.hexId !== null ? fieldCenter(hand, game, step.hexId) : null;
    let delay = 0;
    if (origin && step.hexId !== null) {
      if (!fields.has(step.hexId)) fields.set(step.hexId, fields.size);
      const unit = units.get(step.hexId) ?? 0; units.set(step.hexId, unit + 1);
      delay = fields.get(step.hexId)! * FIELD_STAGGER_MS + unit * UNIT_STAGGER_MS;
    } else delay = headerIndex++ * COUNTER_STEP_MS;
    return { ...step, delay, flightPlanned: Boolean(origin), arrival: delay + (origin ? FLIGHT_MS : COUNTER_STEP_MS), started: false, done: false, from: null as Point | null, node: null as HTMLElement | null, flightStarted: 0 };
  });

  const arrive = (step: typeof steps[number]) => {
    step.done = true; step.node?.remove();
    arrived[step.resource]++;
    display[step.resource] = Math.min(final[step.resource], display[step.resource] + 1);
    setCount(cells[step.resource], display[step.resource], true);
    setGain(cells[step.resource], arrived[step.resource]);
    const total = resourceCount(display);
    setCount(totalCell, total, netGain > 0);
    setGain(totalCell, Math.min(netGain, Math.max(0, total - previousTotal)));
  };
  const tick = (now: number) => {
    if (disposed) return;
    // The page-level dice effect mounts after this hand. Waiting until the next
    // frame observes its actual lifecycle, including cancellation and reduced motion.
    if (started === null) {
      if (document.documentElement.classList.contains("catan-dice-rolling")) { frame = requestAnimationFrame(tick); return; }
      started = now;
    }
    const elapsed = now - started;
    for (const step of steps) {
      if (step.done) continue;
      if (!step.started && elapsed >= step.delay) {
        step.started = true;
        step.from = canFly && step.hexId !== null ? fieldCenter(hand, game, step.hexId) : null;
        // A hidden field stays a header-only increment, even if the camera later reveals it.
        if (step.flightPlanned && step.from && iconCenter(cells[step.resource])) {
          if (!overlay) {
            overlay = document.createElement("div"); overlay.className = "catan-resource-flights"; overlay.setAttribute("aria-hidden", "true");
            // Expanded menu panels share this stacking context and stay above flights.
            const play = hand.closest<HTMLElement>(".catan-play");
            (play?.classList.contains("is-board-expanded") ? play : document.body).append(overlay);
          }
          const node = document.createElement("span"); node.className = "catan-resource-flight";
          node.append(cells[step.resource].querySelector("svg")!.cloneNode(true));
          node.style.left = `${step.from.x - 17}px`; node.style.top = `${step.from.y - 17}px`;
          overlay.append(node); step.node = node; step.flightStarted = elapsed;
          step.arrival = elapsed + FLIGHT_MS;
        } else if (step.flightPlanned) step.arrival = elapsed + COUNTER_STEP_MS;
      }
      if (step.node && canFly) {
        const target = iconCenter(cells[step.resource]);
        if (target && step.from) {
          const progress = Math.min(1, (elapsed - step.flightStarted) / FLIGHT_MS);
          const eased = 1 - Math.pow(1 - progress, 3);
          const dx = target.x - step.from.x; const dy = target.y - step.from.y;
          const lift = Math.sin(Math.PI * progress) * Math.min(80, Math.abs(dy) * .2 + 28);
          const scale = .8 + Math.sin(Math.PI * progress) * .25 - progress * .2;
          step.node.style.transform = `translate3d(${dx * eased}px, ${dy * eased - lift}px, 0) scale(${scale})`;
          step.node.style.opacity = String(Math.min(1, progress / .08, (1 - progress) / .12));
        } else { step.node.remove(); step.node = null; }
      }
      if (elapsed >= step.arrival) arrive(step);
    }
    if (steps.every((step) => step.done)) finish();
    else frame = requestAnimationFrame(tick);
  };
  if (motion.matches) finish();
  else frame = requestAnimationFrame(tick);
  return { dispose, hideFlights };
}

export function CatanResourceHand({ game, islandVisible }: { game: CatanView; islandVisible: boolean }) {
  const hand = useRef<HTMLDivElement>(null);
  const seen = useRef(game);
  const playback = useRef<Playback | null>(null);
  const resources = game.me!.resources; const count = resourceCount(resources);
  const needsDiscard = game.phase === "discard" && game.discards[game.me!.id] > 0;
  const warning = needsDiscard ? `${game.discards[game.me!.id]} Rohstoffe abgeben` : count > 7 ? `Mehr als sieben Karten: Bei einer 7 musst du ${Math.floor(count / 2)} abgeben.` : `${count} Rohstoffkarten`;

  useLayoutEffect(() => {
    if (!islandVisible) playback.current?.hideFlights();
    const previous = seen.current; seen.current = game;
    const batch = resourceGainBatch(previous, game);
    const changed = previous.id !== game.id || previous.me?.id !== game.me?.id || RESOURCES.some((resource) => previous.me?.resources[resource] !== game.me?.resources[resource]);
    if (!batch && !changed) return;
    playback.current?.dispose(); playback.current = null;
    // Disposal restores the preceding confirmed hand. A loss-only update must
    // immediately replace it with the latest hand, just like a new receipt does.
    if (hand.current) {
      for (const resource of RESOURCES) resourceCell(hand.current, resource).querySelector("b")!.textContent = String(game.me!.resources[resource]);
      hand.current.querySelector(".catan-hand-total b")!.textContent = String(resourceCount(game.me!.resources));
    }
    if (batch && !document.hidden && hand.current) playback.current = playResourceGain(hand.current, previous, game, batch, islandVisible);
  }, [game, islandVisible]);
  useLayoutEffect(() => () => { playback.current?.dispose(); }, []);

  return <div ref={hand} className={`catan-hand-bar ${needsDiscard ? "is-alert" : count > 7 ? "is-warn" : ""}`}>
    <div className="catan-hand-strip" role="group" aria-label={`Deine Rohstoffe: ${RESOURCES.map((resource) => `${resources[resource]} ${RESOURCE_INFO[resource].label}`).join(", ")}`}>
      <span className="catan-hand-total" title={warning} aria-label={warning}><Hand aria-hidden="true" /><b className="catan-hand-count">{count}</b><em className="catan-hand-gain" hidden aria-hidden="true" />{(needsDiscard || count > 7) && <span className="sr-only">{warning}</span>}</span>
      {RESOURCES.map((resource) => <span key={resource} className="catan-hand-resource" data-catan-resource={resource}><ResourceIcon resource={resource} /><b className="catan-hand-count">{resources[resource]}</b><small>{RESOURCE_INFO[resource].label}</small><em className="catan-hand-gain" hidden aria-hidden="true" /></span>)}
    </div>
    <span className="sr-only" data-catan-gain-announcement role="status" aria-live="polite" aria-atomic="true" />
  </div>;
}
