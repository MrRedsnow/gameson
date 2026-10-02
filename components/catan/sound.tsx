"use client";

import { useEffect, useRef, useState } from "react";
import { catanSoundEvents } from "@/lib/catan-sound-events";
import { CatanSoundPlayer, RESOURCE_SOUNDS, type CatanSoundId } from "@/lib/catan-sounds";
import type { CatanView, Resource } from "@/lib/catan";

export function useCatanSounds(game: CatanView, animationBaseline = 0) {
  const [enabled, setEnabled] = useState(false);
  const wanted = useRef(false);
  const toggleRequest = useRef(0);
  const player = useRef<CatanSoundPlayer | null>(null);
  const previous = useRef(game);
  const baseline = useRef(animationBaseline);
  const pending = useRef<CatanSoundId[]>([]);
  const frame = useRef(0);

  const stop = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    pending.current = [];
    player.current?.stop();
  };

  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        pending.current = [];
        player.current?.stop();
      } else if (wanted.current) void player.current?.resume().catch(() => {});
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      wanted.current = false;
      toggleRequest.current = -1;
      cancelAnimationFrame(frame.current);
      pending.current = [];
      player.current?.close();
      player.current = null;
    };
  }, []);

  useEffect(() => {
    const last = previous.current;
    if (last.id !== game.id || last.me?.id !== game.me?.id || baseline.current !== animationBaseline) {
      previous.current = game;
      baseline.current = animationBaseline;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      pending.current = [];
      player.current?.stop();
      return;
    }
    // A delayed older snapshot must not become the next playback baseline.
    if (game.sequence < last.sequence) return;
    previous.current = game;
    // Advance the baseline while muted/hidden, so enabling never replays old events.
    if (!enabled || !wanted.current || document.hidden) return;
    const effects = catanSoundEvents(last, game);
    if (effects.includes("dice_roll")) void player.current?.play(["dice_roll"], "ui");
    pending.current.push(...effects.filter((effect) => effect !== "dice_roll"));
    if (!pending.current.length || frame.current) return;
    const flush = () => {
      frame.current = 0;
      if (!wanted.current || document.hidden) { pending.current = []; return; }
      // The dice overlay sets this class in its layout effect before effects run.
      if (document.documentElement.classList.contains("catan-dice-rolling")) { frame.current = requestAnimationFrame(flush); return; }
      const batch = pending.current;
      pending.current = [];
      void player.current?.play(batch);
    };
    flush();
  }, [game, enabled, animationBaseline]);

  const toggle = async () => {
    const request = ++toggleRequest.current;
    wanted.current = !wanted.current;
    if (!wanted.current) { setEnabled(false); stop(); return; }
    try {
      if (typeof AudioContext === "undefined") { wanted.current = false; return; }
      player.current ??= new CatanSoundPlayer();
      await player.current.resume();
      if (request === toggleRequest.current && wanted.current && player.current) { setEnabled(true); void player.current.play(["ui_select"], "ui"); }
    } catch {
      if (request === toggleRequest.current) { wanted.current = false; setEnabled(false); stop(); }
    }
  };
  const cue = (effect: "ui_select" | "ui_cancel" | "ui_error") => {
    if (enabled && wanted.current && !document.hidden) void player.current?.play([effect], "ui");
  };
  const preview = (resource: Resource) => {
    if (enabled && wanted.current && !document.hidden) void player.current?.play([RESOURCE_SOUNDS[resource]], "preview");
  };
  return { enabled, toggle, preview, cue };
}
