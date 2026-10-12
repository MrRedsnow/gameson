"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type PointerEvent } from "react";

export type FullscreenMenu = "karten" | "bauen" | "handel" | "uebersicht";

/** Hover previews are transient; clicks, mandatory tasks and form input keep a menu open. */
export function useFullscreenMenu(active: FullscreenMenu | null, select: (menu: FullscreenMenu | null) => void, expanded: boolean, task: string | null) {
  const nav = useRef<HTMLElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const bindNav = useCallback((element: HTMLElement | null) => { nav.current = element; }, []);
  const bindBoard = useCallback((element: HTMLDivElement | null) => { board.current = element; }, []);
  const pinned = useRef(false);
  const requested = useRef<FullscreenMenu | null>(null);
  const previousTask = useRef(task);
  const previousPanel = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useCallback(() => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; }, []);
  const panel = useCallback((menu: FullscreenMenu) => nav.current?.closest(".catan-play")?.querySelector<HTMLElement>(`[data-catan-fullscreen-panel="${menu}"]`), []);
  const request = useCallback((menu: FullscreenMenu | null) => { clearTimer(); requested.current = menu; select(menu); }, [clearTimer, select]);
  const close = useCallback((restoreFocus = false) => {
    const trigger = active && nav.current?.querySelector<HTMLButtonElement>(`[data-catan-menu-trigger="${active}"]`);
    pinned.current = false; request(null);
    if (restoreFocus && trigger) trigger.focus();
  }, [active, request]);
  const leave = useCallback(() => {
    clearTimer();
    if (!pinned.current) timer.current = setTimeout(() => { timer.current = null; if (!pinned.current) request(null); }, 220);
  }, [clearTimer, request]);
  const hover = useCallback((menu: FullscreenMenu, event: PointerEvent) => {
    clearTimer();
    if (event.pointerType === "mouse" && window.matchMedia("(hover: hover)").matches && !pinned.current) request(menu);
  }, [clearTimer, request]);
  const click = useCallback((menu: FullscreenMenu) => {
    if (active === menu && pinned.current) { close(); return; }
    pinned.current = true; request(menu);
    requestAnimationFrame(() => panel(menu)?.focus());
  }, [active, close, panel, request]);
  const pin = useCallback(() => { clearTimer(); pinned.current = true; }, [clearTimer]);

  useLayoutEffect(() => {
    const previous = previousPanel.current;
    if (!active && previous?.contains(document.activeElement)) {
      const trigger = nav.current?.querySelector<HTMLButtonElement>(`[data-catan-menu-trigger="${previous.dataset.catanFullscreenPanel}"]`);
      trigger?.focus();
    }
    previousPanel.current = active ? panel(active) ?? null : null;
  }, [active, expanded, panel]);

  useEffect(() => {
    clearTimer();
    const newTask = task !== null && task !== previousTask.current;
    previousTask.current = task;
    if (requested.current !== active || (newTask && active)) {
      requested.current = active;
      pinned.current = active !== null;
      if (active) panel(active)?.focus();
    }
    if (!active) pinned.current = false;
    if (!active) return clearTimer;
    const outside = (event: globalThis.PointerEvent) => {
      const target = event.target;
      // These controls can change the turn or resize the island. Keep them
      // mounted through their click rather than closing on pointerdown.
      if (target instanceof Element && target.closest(".catan-status, .catan-island-tools")) return;
      if (target instanceof Node && !nav.current?.contains(target) && !panel(active)?.contains(target)) close();
    };
    document.addEventListener("pointerdown", outside);
    return () => { clearTimer(); document.removeEventListener("pointerdown", outside); };
  }, [active, expanded, task, clearTimer, close, panel]);

  useLayoutEffect(() => {
    if (!board.current) return;
    const island = board.current;
    const play = island.closest<HTMLElement>(".catan-play")!;
    const hand = play.querySelector<HTMLElement>(".catan-hand-bar");
    const measure = () => {
      const bounds = island.getBoundingClientRect();
      const container = play.getBoundingClientRect();
      const handHeight = hand?.getBoundingClientRect().height ?? 0;
      const menuHeight = Math.max(0, bounds.height - (expanded && hand ? handHeight + 20 : 0));
      play.style.setProperty("--catan-hand-top", `${bounds.top - container.top + 8}px`);
      play.style.setProperty("--catan-hand-height", `${handHeight}px`);
      play.style.setProperty("--catan-menu-height", `${menuHeight}px`);
      island.dataset.catanShortStage = String(menuHeight < 340);
      island.dataset.catanTinyStage = String(menuHeight < 180);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(island); observer.observe(play); if (hand) observer.observe(hand);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [expanded, active, task]);

  return { bindNav, bindBoard, close, hover, click, leave, enter: clearTimer, pin };
}
