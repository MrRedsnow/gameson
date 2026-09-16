"use client";

import { useLayoutEffect, useRef } from "react";
import type { CatanGame } from "@/lib/catan";

const FACES = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const ROLL_MS = 960;
const HOLD_MS = 650;
const DOCK_MS = 620;

export function CatanDice({ dice }: { dice: [number, number] | null }) {
  return dice && <div className="catan-dice" data-catan-dice role="img" aria-label={`Würfel: ${dice[0]} und ${dice[1]}, Summe ${dice[0] + dice[1]}`}>
    {dice.map((value, index) => <span key={index} aria-hidden="true">{FACES[value]}</span>)}
  </div>;
}

function showRoll(values: [number, number]) {
  if (typeof Element.prototype.animate !== "function") return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const overlay = document.createElement("div");
  overlay.className = "catan-dice-overlay";
  overlay.setAttribute("aria-hidden", "true");
  const slots = values.map((value) => {
    const slot = document.createElement("span");
    const die = document.createElement("span");
    slot.className = "catan-dice-slot";
    die.className = "catan-dice-flight";
    die.textContent = FACES[value];
    slot.append(die); overlay.append(slot);
    return { slot, die };
  });
  // Use the same font as the small dice so the final frame joins them seamlessly.
  const target = document.querySelector<HTMLElement>("[data-catan-dice]");
  if (target) overlay.style.fontFamily = getComputedStyle(target).fontFamily;
  document.body.append(overlay);
  document.documentElement.classList.add("catan-dice-rolling");

  const animations: Animation[] = [];
  const timers: number[] = [];
  let ticker: number | undefined;
  let frame = 0;
  let disposed = false;
  const finish = () => {
    if (disposed) return;
    disposed = true;
    timers.forEach(window.clearTimeout);
    window.clearInterval(ticker);
    cancelAnimationFrame(frame);
    animations.forEach((animation) => animation.cancel());
    document.removeEventListener("visibilitychange", hide);
    overlay.remove();
    document.documentElement.classList.remove("catan-dice-rolling");
  };
  const hide = () => { if (document.hidden) finish(); };
  document.addEventListener("visibilitychange", hide);
  const fadeOut = () => {
    animations.push(overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" }));
    timers.push(window.setTimeout(finish, 180));
  };

  const dock = () => {
    const started = performance.now();
    const move = (now: number) => {
      // Measure the current destination on every frame, including after scrolling,
      // rotating a phone, switching tabs or revealing a local player's hand.
      const targets = document.querySelectorAll<HTMLElement>("[data-catan-dice] > span");
      if (targets.length !== 2) { fadeOut(); return; }
      const progress = Math.min(1, (now - started) / DOCK_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      const bounds = slots.map(({ slot }, index) => ({ from: slot.getBoundingClientRect(), to: targets[index].getBoundingClientRect() }));
      if (bounds.some(({ to }) => !to.width || !to.height)) { fadeOut(); return; }
      slots.forEach(({ die }, index) => {
        const { from, to } = bounds[index];
        const x = to.left + to.width / 2 - from.left - from.width / 2;
        const y = to.top + to.height / 2 - from.top - from.height / 2;
        const scaleX = 1 + (to.width / from.width - 1) * eased;
        const scaleY = 1 + (to.height / from.height - 1) * eased;
        die.style.transform = `translate3d(${x * eased}px, ${y * eased}px, 0) scale(${scaleX}, ${scaleY})`;
        die.style.filter = `drop-shadow(0 ${14 * (1 - eased)}px ${16 * (1 - eased)}px #0009)`;
      });
      if (progress < 1) frame = requestAnimationFrame(move);
      else finish();
    };
    frame = requestAnimationFrame(move);
  };

  if (reducedMotion) {
    // Keep the shared result visible without tumbling or travelling across the screen.
    animations.push(overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, fill: "forwards" }));
    timers.push(window.setTimeout(fadeOut, 700));
  } else {
    slots.forEach(({ die }, index) => {
      const direction = index === 0 ? -1 : 1;
      const x = Math.min(window.innerWidth * .34, 420) * direction;
      const y = Math.min(window.innerHeight * .28, 240);
      animations.push(die.animate([
        { transform: `translate3d(${x}px, ${-y}px, 0) rotate(${direction * 440}deg) scale(.7)`, opacity: 0, offset: 0 },
        { opacity: 1, offset: .12 },
        { transform: `translate3d(${direction * 28}px, 26px, 0) rotate(${-direction * 32}deg) scale(1.08)`, offset: .55 },
        { transform: `translate3d(${-direction * 12}px, -22px, 0) rotate(${direction * 14}deg) scale(.98)`, offset: .75 },
        { transform: `translate3d(${direction * 4}px, 5px, 0) rotate(${-direction * 5}deg) scale(1.02)`, offset: .9 },
        { transform: "none", opacity: 1, offset: 1 },
      ], { duration: ROLL_MS, easing: "cubic-bezier(.2,.65,.3,1)", fill: "forwards" }));
    });
    let tick = 0;
    ticker = window.setInterval(() => {
      tick++;
      slots.forEach(({ die }, index) => { die.textContent = FACES[(values[index] + tick * (index ? 5 : 1)) % 6 + 1]; });
    }, 75);
    timers.push(window.setTimeout(() => {
      window.clearInterval(ticker);
      animations.forEach((animation) => animation.cancel());
      slots.forEach(({ die }, index) => { die.textContent = FACES[values[index]]; });
    }, ROLL_MS));
    timers.push(window.setTimeout(dock, ROLL_MS + HOLD_MS));
  }
  return finish;
}

/** Mounted at page level so every online viewer and the local handoff screen see new rolls. */
export function CatanDiceOverlay({ game }: { game: Pick<CatanGame, "id" | "turn" | "dice"> | null | undefined }) {
  const gameId = game?.id;
  const [first, second] = game?.dice ?? [0, 0];
  const rollKey = game?.dice ? `${game.id}:${game.turn}:${first}:${second}` : null;
  const seen = useRef({ gameId, rollKey });
  useLayoutEffect(() => {
    const previous = seen.current;
    seen.current = { gameId, rollKey };
    // A restored game is already known. Polls and actions within this turn must
    // not replay it; an identical result on a later turn is still a new roll.
    if (previous.gameId !== gameId || !rollKey || previous.rollKey === rollKey || document.hidden) return;
    return showRoll([first, second]);
  }, [gameId, rollKey, first, second]);
  return null;
}
