"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { CatanView } from "@/lib/catan";
import { BoardEffectsPlayback } from "./board-effects";

export function useBoardEffects(svgRef: RefObject<SVGSVGElement | null>, game: CatanView, visible: boolean, baseline: number) {
  const boardEffectsRef = useRef<SVGGElement>(null);
  const playback = useRef<BoardEffectsPlayback | null>(null);
  const [effectsBusy, setEffectsBusy] = useState(false);
  useLayoutEffect(() => {
    if (!svgRef.current || !boardEffectsRef.current) return;
    if (!playback.current) playback.current = new BoardEffectsPlayback(svgRef.current, boardEffectsRef.current, game, visible, baseline, setEffectsBusy);
    else playback.current.update(game, visible, baseline);
  }, [svgRef, game, visible, baseline]);
  useLayoutEffect(() => () => { playback.current?.dispose(); playback.current = null; }, []);
  return { boardEffectsRef, effectsBusy };
}
