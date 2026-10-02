export type AmbientPoint = { x: number; y: number };

export function segmentDistance(point: AmbientPoint, a: AmbientPoint, b: AmbientPoint) {
  const dx = b.x - a.x; const dy = b.y - a.y; const denominator = dx * dx + dy * dy;
  const t = denominator ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator)) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

export function pointInPolygon(point: AmbientPoint, polygon: readonly AmbientPoint[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]; const b = polygon[j];
    if (segmentDistance(point, a, b) < 1e-7) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
