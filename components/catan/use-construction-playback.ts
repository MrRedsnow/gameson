"use client";

import { useLayoutEffect, useRef } from "react";
import type { ConstructionSnapshot } from "@/lib/catan-construction";
import { ConstructionPlayback } from "./construction-playback";

export function useConstructionPlayback(game: ConstructionSnapshot, islandVisible: boolean, animationBaseline: number) {
  const svgRef = useRef<SVGSVGElement>(null);
  const effectsRef = useRef<SVGGElement>(null);
  const playback = useRef<ConstructionPlayback | null>(null);
  useLayoutEffect(() => {
    if (!svgRef.current || !effectsRef.current) return;
    if (!playback.current) playback.current = new ConstructionPlayback(svgRef.current, effectsRef.current, game, islandVisible, animationBaseline);
    else playback.current.update(game, islandVisible, animationBaseline);
  }, [game, islandVisible, animationBaseline]);
  useLayoutEffect(() => () => { playback.current?.dispose(); playback.current = null; }, []);
  return { svgRef, effectsRef };
}
