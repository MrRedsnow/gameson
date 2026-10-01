import { CONSTRUCTION_BUILDING_MS, CONSTRUCTION_ROAD_MS, constructionBatch, type ConstructionEvent, type ConstructionSnapshot } from "@/lib/catan-construction";

const SVG_NS = "http://www.w3.org/2000/svg";
type Effect = { duration: number; started: number | null; paint: (progress: number) => void; dispose: () => void };

function restoreAttribute(node: Element, name: string, value: string | null) {
  if (value === null) node.removeAttribute(name);
  else node.setAttribute(name, value);
}

/** Presentation only: final board pieces stay authoritative and keep their world coordinates. */
export class ConstructionPlayback {
  private seen: ConstructionSnapshot;
  private highestSequence: number;
  private baseline: number;
  private visible: boolean;
  private disposed = false;
  private frame = 0;
  private effects = new Map<string, Effect>();
  private motion = window.matchMedia("(prefers-reduced-motion: reduce)");

  constructor(private svg: SVGSVGElement, private layer: SVGGElement, initial: ConstructionSnapshot, visible = true, baseline = 0) {
    this.seen = initial; this.highestSequence = initial.sequence; this.visible = visible; this.baseline = baseline;
    document.addEventListener("visibilitychange", this.onVisibility);
    this.motion.addEventListener("change", this.onMotion);
  }

  update(game: ConstructionSnapshot, visible = true, baseline = 0) {
    if (this.disposed) return;
    this.visible = visible;
    if (game.id !== this.seen.id || baseline !== this.baseline) {
      this.clear(); this.seen = game; this.highestSequence = game.sequence; this.baseline = baseline; return;
    }
    const eligible = game.sequence > this.highestSequence;
    const batch = eligible ? constructionBatch(this.seen, game) : null;
    if (eligible) { this.highestSequence = game.sequence; this.seen = game; }
    // New hidden snapshots are consumed; old sequences never replace the confirmed baseline.
    if (!visible || document.hidden || this.motion.matches) { this.clear(); return; }
    for (const event of batch?.events ?? []) this.begin(event, game);
    if (this.effects.size && !this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  private begin(event: ConstructionEvent, game: ConstructionSnapshot) {
    const key = `${event.kind === "road" ? "road" : "building"}:${event.position}`;
    this.effects.get(key)?.dispose(); this.effects.delete(key);
    const effect = event.kind === "road" ? this.road(event, game) : this.building(event, game);
    if (effect) { this.effects.set(key, effect); effect.paint(0); }
  }

  private road(event: ConstructionEvent, game: ConstructionSnapshot): Effect | null {
    const edge = game.board.edges.find((item) => item.id === event.position);
    const lines = [...this.svg.querySelectorAll<SVGLineElement>(`[data-catan-road="${event.position}"] > line`)];
    if (!edge || !lines.length) return null;
    const a = game.board.vertices[edge.a]; const b = game.board.vertices[edge.b];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const original = lines.map((line) => ({ line, dash: line.getAttribute("stroke-dasharray"), offset: line.getAttribute("stroke-dashoffset") }));
    return {
      duration: CONSTRUCTION_ROAD_MS, started: null,
      paint(progress) {
        const eased = 1 - (1 - progress) ** 3;
        for (const line of lines) { line.setAttribute("stroke-dasharray", `${length} ${length}`); line.setAttribute("stroke-dashoffset", String(length * (1 - eased))); }
      },
      dispose() { for (const item of original) { restoreAttribute(item.line, "stroke-dasharray", item.dash); restoreAttribute(item.line, "stroke-dashoffset", item.offset); } },
    };
  }

  private building(event: ConstructionEvent, game: ConstructionSnapshot): Effect | null {
    const vertex = game.board.vertices.find((item) => item.id === event.position);
    const structure = this.svg.querySelector<SVGGElement>(`[data-catan-building="${event.position}"] .catan-building-structure`);
    if (!vertex || !structure) return null;
    const transform = structure.getAttribute("transform"); const opacity = structure.getAttribute("opacity");
    const effect = document.createElementNS(SVG_NS, "g");
    effect.setAttribute("class", "catan-construction-effect"); effect.setAttribute("data-construction-event", event.id);
    effect.setAttribute("transform", `translate(${vertex.x} ${vertex.y})`); effect.setAttribute("pointer-events", "none"); effect.setAttribute("aria-hidden", "true");
    const foundation = document.createElementNS(SVG_NS, "ellipse");
    foundation.setAttribute("cx", "0"); foundation.setAttribute("cy", "9"); foundation.setAttribute("rx", event.kind === "city" ? "25" : "17"); foundation.setAttribute("ry", "5");
    foundation.setAttribute("class", "catan-construction-foundation"); effect.append(foundation);
    const dust = Array.from({ length: 7 }, (_, index) => {
      const node = document.createElementNS(SVG_NS, "circle");
      node.setAttribute("class", "catan-construction-dust"); node.setAttribute("r", String(1.6 + index % 3 * .5)); effect.append(node); return node;
    });
    this.layer.append(effect);
    return {
      duration: CONSTRUCTION_BUILDING_MS, started: null,
      paint(progress) {
        // The inner sprite is translated to its foundation before this local scale.
        const rise = 1 - (1 - Math.min(1, progress / .85)) ** 3;
        const settle = progress > .85 ? Math.sin((progress - .85) / .15 * Math.PI) * .035 : 0;
        structure.setAttribute("transform", `scale(${.92 + rise * .08} ${.12 + rise * .88 + settle})`);
        structure.setAttribute("opacity", String(Math.min(1, progress / .16)));
        foundation.setAttribute("opacity", String(Math.sin(Math.PI * progress) * .58));
        const spread = Math.min(1, Math.max(0, (progress - .14) / .86));
        for (const [index, node] of dust.entries()) {
          const direction = index % 2 ? -1 : 1;
          node.setAttribute("cx", String(direction * (4 + index * 2.1 + spread * (10 + index))));
          node.setAttribute("cy", String(9 - Math.sin(Math.PI * spread) * (4 + index % 3 * 2)));
          node.setAttribute("opacity", String(Math.sin(Math.PI * spread) * .62));
        }
      },
      dispose() { restoreAttribute(structure, "transform", transform); restoreAttribute(structure, "opacity", opacity); effect.remove(); },
    };
  }

  private tick = (now: number) => {
    this.frame = 0;
    if (this.disposed) return;
    if (!this.visible || document.hidden || this.motion.matches) { this.clear(); return; }
    for (const [key, effect] of this.effects) {
      effect.started ??= now;
      const progress = Math.min(1, Math.max(0, (now - effect.started) / effect.duration));
      effect.paint(progress);
      if (progress === 1) { effect.dispose(); this.effects.delete(key); }
    }
    if (this.effects.size) this.frame = requestAnimationFrame(this.tick);
  };

  private clear() {
    cancelAnimationFrame(this.frame); this.frame = 0;
    for (const effect of this.effects.values()) effect.dispose();
    this.effects.clear();
  }
  private onVisibility = () => { if (document.hidden) this.clear(); };
  private onMotion = () => { if (this.motion.matches) this.clear(); };

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.clear();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.motion.removeEventListener("change", this.onMotion);
  }
}
