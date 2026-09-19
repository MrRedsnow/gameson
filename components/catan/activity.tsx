"use client";

import { useState } from "react";
import { groupedActivity } from "@/lib/catan-notifications";
import { type CatanView } from "@/lib/catan";

export function useCatanActivity(game: CatanView, localAfter?: number, onRead?: (sequence: number) => void) {
  const storageKey = `gameson-catan-activity:${game.id}:${game.me!.id}`;
  const [after, setAfter] = useState(() => {
    if (localAfter !== undefined) return localAfter;
    try { const value = sessionStorage.getItem(storageKey); if (value !== null && Number.isSafeInteger(Number(value))) return Math.min(game.sequence, Number(value)); } catch { /* Optional receipt memory. */ }
    return game.sequence;
  });
  const unread = groupedActivity(game, after);
  const read = () => {
    setAfter(game.sequence); onRead?.(game.sequence);
    try { sessionStorage.setItem(storageKey, String(game.sequence)); } catch { /* The confirmed game is independent of receipt memory. */ }
  };
  return { unread, all: groupedActivity(game), read };
}
