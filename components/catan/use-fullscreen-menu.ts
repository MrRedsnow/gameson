"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

export type FullscreenMenu = "karten" | "bauen" | "handel" | "uebersicht";

/** Click-only menus keep their contents mounted while the island is explored. */
export function useFullscreenMenu(active: FullscreenMenu | null, select: (menu: FullscreenMenu | null) => void, expanded: boolean, task: string | null) {
  const nav = useRef<HTMLElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const previousPanel = useRef<HTMLElement | null>(null);
  const bindNav = useCallback((element: HTMLElement | null) => { nav.current = element; }, []);
  const bindBoard = useCallback((element: HTMLDivElement | null) => { board.current = element; }, []);
  const panel = useCallback((menu: FullscreenMenu) => nav.current?.closest(".catan-play")?.querySelector<HTMLElement>(`[data-catan-fullscreen-panel="${menu}"]`), []);
  const close = useCallback((restoreFocus = true) => {
    const trigger = active && nav.current?.querySelector<HTMLButtonElement>(`[data-catan-menu-trigger="${active}"]`);
    select(null);
    if (restoreFocus && trigger) trigger.focus();
  }, [active, select]);
  const click = useCallback((menu: FullscreenMenu) => {
    if (active === menu) close();
    else select(menu);
  }, [active, close, select]);

  useLayoutEffect(() => {
    const next = active ? panel(active) ?? null : null;
    const previous = previousPanel.current;
    if (next && next !== previous) next.focus();
    if (!next && previous?.contains(document.activeElement)) {
      nav.current?.querySelector<HTMLButtonElement>(`[data-catan-menu-trigger="${previous.dataset.catanFullscreenPanel}"]`)?.focus();
    }
    previousPanel.current = next;
  }, [active, panel]);

  useEffect(() => {
    if (!active) return;
    const outside = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !nav.current?.contains(target) && !panel(active)?.contains(target)) close();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [active, close, panel]);

  useLayoutEffect(() => {
    if (!board.current) return;
    const island = board.current;
    const play = island.closest<HTMLElement>(".catan-play")!;
    const hand = play.querySelector<HTMLElement>(".catan-hand-bar");
    const world = island.closest<HTMLElement>(".catan-world");
    const canvas = island.querySelector<HTMLElement>(".catan-island-canvas");
    const screen = active ? panel(active)?.querySelector<HTMLElement>(":scope > .catan-screen") : null;
    const heading = screen?.querySelector<HTMLElement>(":scope > .catan-screen-heading");
    const footer = screen?.querySelector<HTMLElement>(":scope > .catan-screen-actions");
    const measure = () => {
      const bounds = island.getBoundingClientRect();
      const container = play.getBoundingClientRect();
      const handHeight = hand?.getBoundingClientRect().height ?? 0;
      const floatingHand = expanded && hand && getComputedStyle(hand).position === "absolute";
      const menuHeight = Math.max(0, bounds.height - 24 - (floatingHand ? handHeight + 20 : 0));
      play.style.setProperty("--catan-stage-height", `${bounds.height}px`);
      play.style.setProperty("--catan-hand-top", `${bounds.top - container.top + 8}px`);
      play.style.setProperty("--catan-hand-height", `${handHeight}px`);
      play.style.setProperty("--catan-menu-height", `${menuHeight}px`);
      if (world && canvas) {
        const worldBounds = world.getBoundingClientRect();
        const canvasBounds = canvas.getBoundingClientRect();
        play.style.setProperty("--catan-map-top", `${Math.min(0, worldBounds.top - canvasBounds.top)}px`);
        play.style.setProperty("--catan-map-bottom", `${Math.min(0, canvasBounds.bottom - worldBounds.bottom)}px`);
      }
      island.dataset.catanShortStage = String(menuHeight < 340);
      // Enlarged headings can consume a menu even when the stage itself is tall.
      const style = screen ? getComputedStyle(screen) : null;
      const chromeHeight = (heading?.getBoundingClientRect().height ?? 0) + (footer?.getBoundingClientRect().height ?? 0)
        + (parseFloat(style?.paddingTop ?? "0") || 0) + (parseFloat(style?.paddingBottom ?? "0") || 0)
        + (parseFloat(style?.rowGap ?? "0") || 0) * (footer ? 2 : 1);
      const availableHeight = Math.min(menuHeight, window.innerHeight * .72);
      island.dataset.catanTinyStage = String(menuHeight < 180 || Boolean(screen && availableHeight - chromeHeight < 32));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(island); observer.observe(play); if (hand) observer.observe(hand);
    if (world) observer.observe(world); if (canvas) observer.observe(canvas);
    if (heading) observer.observe(heading); if (footer) observer.observe(footer);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [expanded, active, task, panel]);

  return { bindNav, bindBoard, close, click };
}
