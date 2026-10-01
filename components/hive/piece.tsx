import type { CSSProperties } from "react";
import { HIVE_PIECES, type HiveKind } from "@/lib/hive";

/** Original insect drawings; the same symbols identify pieces in the reserve and the hive. */
export function HiveGlyph({ kind, className = "" }: { kind: HiveKind; className?: string }) {
  return <svg className={`hive-glyph ${className}`} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: HIVE_PIECES[kind].color } as CSSProperties}>
    {kind === "queen" && <><ellipse cx="24" cy="29" rx="7" ry="11" fill="currentColor" stroke="none" /><ellipse cx="13" cy="21" rx="9" ry="5" transform="rotate(32 13 21)" /><ellipse cx="35" cy="21" rx="9" ry="5" transform="rotate(-32 35 21)" /><path d="M18 28h12M18 34h12" stroke="var(--hive-tile-color,#f4f0e6)" /><circle cx="24" cy="14" r="4" fill="currentColor" /><path d="m21 11-4-5m10 5 4-5M18 27l-6 4m18-4 6 4M21 40l3 4 3-4" /></>}
    {kind === "beetle" && <><ellipse cx="24" cy="28" rx="11" ry="13" fill="currentColor" stroke="none" /><path d="M24 18v22" stroke="var(--hive-tile-color,#f4f0e6)" /><path d="M18 16v-4l3-4m9 8v-4l-3-4M13 22l-5-3-3 2m8 7H6l-2 3m11 4-7 3-1 4m28-20 5-3 3 2m-8 7h7l2 3m-11 4 7 3 1 4" /><ellipse cx="24" cy="14" rx="6" ry="4" fill="currentColor" /></>}
    {kind === "grasshopper" && <><path d="m14 25 16-10 6 4-13 9Z" fill="currentColor" /><circle cx="35" cy="13" r="4" fill="currentColor" /><path d="m35 9-3-6m6 8 6-6M21 24l-6-11-8 23H3m20-11 6 15h12M12 25l-3 5 8 4m13-11 4 8h10" /></>}
    {kind === "spider" && <><ellipse cx="24" cy="30" rx="7" ry="9" fill="currentColor" stroke="none" /><circle cx="24" cy="17" r="5" fill="currentColor" /><path d="m19 17-7-8-6 1m13 13-11-8-4 5m14 7-12-2-3 8m16-1-9 5-3 8m22-28 7-8 6 1m-13 13 11-8 4 5m-14 7 12-2 3 8m-16-1 9 5 3 8" /></>}
    {kind === "ant" && <><ellipse cx="24" cy="35" rx="6" ry="9" fill="currentColor" stroke="none" /><ellipse cx="24" cy="22" rx="4" ry="5" fill="currentColor" /><circle cx="24" cy="11" r="5" fill="currentColor" /><path d="m21 7-5-4m11 4 5-4M20 20l-9-5-5 3m14 6H10l-5 5m16 0-8 7-4 8m19-24 9-5 5 3m-14 6h10l5 5m-16 0 8 7 4 8" /></>}
  </svg>;
}

export const HEX_POINTS = "31.18,-18 31.18,18 0,36 -31.18,18 -31.18,-18 0,-36";
