"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { Resource } from "@/lib/catan";

const baselineCache = new Map<string, number>();
let metricsContext: CanvasRenderingContext2D | null | undefined;

export function NumberLabel({ number, resource, x, y, hexId, blocked = false }: {
  number: number; resource: Resource | "desert"; x: number; y: number; hexId?: number; blocked?: boolean;
}) {
  const ref = useRef<SVGTextElement>(null);
  const [baseline, setBaseline] = useState(10);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || blocked) return;
    const style = getComputedStyle(node);
    const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const key = `${font}:${number}`;
    let offset = baselineCache.get(key);
    if (offset === undefined) {
      if (metricsContext === undefined) metricsContext = document.createElement("canvas").getContext("2d");
      if (!metricsContext) return;
      metricsContext.font = font;
      const metrics = metricsContext.measureText(String(number));
      // Georgia's old-style digits have different ascenders and descenders.
      // Center their visible ink once; camera frames reuse the cached offset.
      offset = (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
      if (!Number.isFinite(offset)) return;
      baselineCache.set(key, offset);
    }
    setBaseline(offset);
  }, [number, blocked]);
  return <text ref={ref} className={`catan-number-label${blocked ? " is-blocked" : ""}`} data-catan-number={hexId} data-resource={resource} x={x} y={y + (blocked ? 36 : baseline)} textAnchor="middle" aria-hidden="true">{number}</text>;
}
