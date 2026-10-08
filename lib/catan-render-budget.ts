import type { ViewportSize } from "./catan-camera";

/** The sea is decorative; the map keeps its full display resolution. */
export function seaRenderBudget(size: ViewportSize, devicePixelRatio: number, handheld: boolean) {
  const width = Math.max(1, Number.isFinite(size.width) ? size.width : 1);
  const height = Math.max(1, Number.isFinite(size.height) ? size.height : 1);
  const density = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const pixelBudget = handheld ? 450_000 : 1_000_000;
  const ratio = Math.min(density, handheld ? 1 : 1.5, Math.sqrt(pixelBudget / (width * height)));
  return { width: Math.max(1, Math.min(4096, Math.floor(width * ratio))), height: Math.max(1, Math.min(4096, Math.floor(height * ratio))), interval: 1000 / 30 };
}
