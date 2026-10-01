"use client";

import { useEffect, useRef, useState } from "react";
import { groupedActivity } from "@/lib/catan-notifications";
import { CatanSoundPlayer } from "@/lib/catan-sounds";
import type { CatanView, Resource } from "@/lib/catan";

export function useCatanSounds(game: CatanView) {
  const [enabled, setEnabled] = useState(false);
  const wanted = useRef(false);
  const player = useRef<CatanSoundPlayer | null>(null);
  const previous = useRef({ gameId: game.id, playerId: game.me!.id, sequence: game.sequence });

  useEffect(() => () => { wanted.current = false; player.current?.close(); player.current = null; }, []);

  useEffect(() => {
    const last = previous.current;
    previous.current = { gameId: game.id, playerId: game.me!.id, sequence: game.sequence };
    // Do not replay old receipts after reload or when passing the device.
    if (!enabled || last.gameId !== game.id || last.playerId !== game.me!.id || document.visibilityState !== "visible") return;
    const resources = groupedActivity(game, last.sequence).flatMap((event) => (Object.keys(event.gains) as Resource[]).filter((resource) => event.gains[resource] > 0));
    if (resources.some((r) => r === "wood" || r === "wool")) player.current?.play(resources);
  }, [game, enabled]);

  const toggle = async () => {
    wanted.current = !wanted.current;
    if (!wanted.current) { setEnabled(false); player.current?.stop(); return; }
    try {
      if (typeof AudioContext === "undefined") { wanted.current = false; return; }
      player.current ??= new CatanSoundPlayer();
      await player.current.resume();
      if (wanted.current && player.current) { setEnabled(true); player.current.play(["wool", "wood"]); }
    } catch { wanted.current = false; setEnabled(false); }
  };
  const preview = (resource: Resource) => { if (enabled && (resource === "wool" || resource === "wood")) player.current?.play([resource]); };
  return { enabled, toggle, preview };
}
