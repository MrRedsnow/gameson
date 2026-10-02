import { longestRoadPath, type Board, type CatanView } from "@/lib/catan";
import { CatanPresentationCursor, type CatanPresentationBatch } from "@/lib/catan-presentation";
import { CONSTRUCTION_HANDOFF_MS, constructionBatch } from "@/lib/catan-construction";

export const BOARD_ROLL_HIGHLIGHT_MS = 900;
export const BOARD_ROBBER_TRAVEL_MS = 650;
export const BOARD_HARBOR_GLOW_MS = 1200;
const SVG_NS = "http://www.w3.org/2000/svg";
type Effect = { duration: number; started: number | null; paint: (progress: number) => void; dispose: () => void; waitForDice?: boolean };

export function harborOwners(board: Board, edgeId: number): string[] {
  const edge = board.edges.find((item) => item.id === edgeId);
  if (!edge) return [];
  return [...new Set([board.vertices[edge.a], board.vertices[edge.b]].filter((vertex) => vertex?.building && vertex.owner).map((vertex) => vertex.owner!))];
}

function svgNode<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

/** Confirmed effects share the board's camera coordinates and never change its game state. */
export class BoardEffectsPlayback {
  private cursor: CatanPresentationCursor;
  private seen: CatanView;
  private baseline: number;
  private visible: boolean;
  private disposed = false;
  private frame = 0;
  private effects = new Map<string, Effect>();
  private motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private busy = false;

  constructor(private svg: SVGSVGElement, private layer: SVGGElement, initial: CatanView, visible = true, baseline = 0, private onBusy?: (busy: boolean) => void) {
    this.seen = initial; this.baseline = baseline; this.visible = visible;
    this.cursor = new CatanPresentationCursor(initial, baseline);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.motion.addEventListener("change", this.onMotion);
  }

  update(game: CatanView, visible = true, baseline = 0) {
    if (this.disposed) return;
    this.visible = visible;
    const previous = this.seen;
    const reset = game.id !== previous.id || game.me?.id !== previous.me?.id || baseline !== this.baseline;
    const batch = this.cursor.update(game, baseline);
    if (reset) { this.clear(game); this.seen = game; this.baseline = baseline; return; }
    if (game.sequence > previous.sequence) this.seen = game;
    if (!visible || document.hidden) { this.clear(); return; }
    if (game.sequence > previous.sequence && constructionBatch(previous, game)) this.begin("construction-gate", { duration: CONSTRUCTION_HANDOFF_MS, started: null, paint: () => {}, dispose: () => {} });
    if (batch?.roll) this.roll(batch.roll, game);
    if (batch?.robber) this.robber(batch.robber, game);
    for (const harbor of game.sequence > previous.sequence ? game.board.harbors : []) {
      const before = harborOwners(previous.board, harbor.edge);
      if (harborOwners(game.board, harbor.edge).some((owner) => !before.includes(owner))) this.harbor(harbor.edge);
    }
    for (const award of batch?.awards ?? []) if (award.type === "longestRoad") {
      this.effects.get("road-award")?.dispose(); this.effects.delete("road-award");
      if (award.toId) this.roadAward(award.toId, game);
    }
    if (batch?.awards.length || batch?.cards.length) this.begin("notice-gate", { duration: 1800, started: null, paint: () => {}, dispose: () => {} });
    this.schedule();
  }

  private begin(key: string, effect: Effect) {
    this.effects.get(key)?.dispose(); this.effects.delete(key);
    this.effects.set(key, effect);
    if (!effect.waitForDice) effect.paint(0);
  }

  private roll(roll: NonNullable<CatanPresentationBatch["roll"]>, game: CatanView) {
    // A newer roll replaces the still-running field response, including a seven.
    this.effects.get("roll")?.dispose(); this.effects.delete("roll");
    const sum = roll.dice[0] + roll.dice[1];
    if (sum === 7) { this.begin("roll", { duration: 1, started: null, waitForDice: true, paint: () => {}, dispose: () => {} }); return; }
    const nodes: SVGElement[] = [];
    const numbers: SVGElement[] = [];
    let appended = false;
    for (const hex of game.board.hexes.filter((hex) => hex.number === sum)) {
      const blocked = hex.id === roll.robberHex;
      const outline = svgNode("polygon", { class: `catan-roll-field${blocked ? " is-blocked" : ""}`, points: hex.vertices.map((id) => `${game.board.vertices[id].x},${game.board.vertices[id].y}`).join(" "), fill: "none", "pointer-events": "none", "data-catan-roll-hex": hex.id });
      nodes.push(outline);
      const number = this.svg.querySelector<SVGElement>(`[data-catan-number="${hex.id}"]`);
      if (number) numbers.push(number);
      if (blocked) {
        const label = svgNode("text", { class: "catan-roll-blocked", x: hex.x, y: hex.y + 43, "text-anchor": "middle", "pointer-events": "none" });
        label.textContent = "Blockiert"; nodes.push(label);
      }
    }
    if (!nodes.length) return;
    this.begin("roll", {
      duration: this.motion.matches ? 450 : BOARD_ROLL_HIGHLIGHT_MS, started: null, waitForDice: true,
      paint: (progress) => {
        if (!appended) { this.layer.append(...nodes); numbers.forEach((node) => node.classList.add("is-roll-hit")); appended = true; }
        const opacity = this.motion.matches ? .85 : Math.sin(Math.PI * progress) * .58 + .3;
        nodes.forEach((node) => node.setAttribute("opacity", String(opacity)));
      },
      dispose: () => { nodes.forEach((node) => node.remove()); numbers.forEach((node) => node.classList.remove("is-roll-hit")); },
    });
  }

  private robber(event: NonNullable<CatanPresentationBatch["robber"]>, game: CatanView) {
    const from = game.board.hexes.find((hex) => hex.id === event.fromHex);
    const to = game.board.hexes.find((hex) => hex.id === event.toHex);
    const traveller = this.svg.querySelector<SVGElement>("[data-catan-robber-traveller]");
    if (!from || !to || !traveller) return;
    const originalTransform = traveller.getAttribute("transform") ?? "";
    const reduced = this.motion.matches;
    const dust = svgNode("g", { class: "catan-robber-dust", transform: `translate(${to.x} ${to.y + 7})`, "pointer-events": "none", "aria-hidden": "true" });
    const particles = Array.from({ length: 6 }, (_, index) => svgNode("circle", { r: 1.6 + index % 2 * .6, fill: "#e7d1a0" }));
    if (!reduced) { dust.append(...particles); this.layer.append(dust); }
    this.begin("robber", {
      duration: reduced ? 400 : BOARD_ROBBER_TRAVEL_MS + 250, started: null,
      paint: (progress) => {
        if (reduced) { traveller.setAttribute("opacity", ".85"); return; }
        const elapsed = progress * (BOARD_ROBBER_TRAVEL_MS + 250);
        const travel = Math.min(1, elapsed / BOARD_ROBBER_TRAVEL_MS);
        const eased = travel * travel * (3 - 2 * travel);
        traveller.setAttribute("transform", travel === 1 ? originalTransform : `translate(${(from.x - to.x) * (1 - eased)} ${(from.y - to.y) * (1 - eased) - Math.sin(Math.PI * travel) * 8}) ${originalTransform}`);
        const landing = Math.max(0, (elapsed - BOARD_ROBBER_TRAVEL_MS) / 250);
        for (const [index, particle] of particles.entries()) {
          particle.setAttribute("cx", String((index % 2 ? -1 : 1) * (3 + index * 1.7 + landing * 8)));
          particle.setAttribute("cy", String(-Math.sin(Math.PI * landing) * (3 + index % 3)));
          particle.setAttribute("opacity", String(Math.sin(Math.PI * landing) * .7));
        }
      },
      dispose: () => { traveller.setAttribute("transform", originalTransform); traveller.removeAttribute("opacity"); dust.remove(); },
    });
  }

  private harbor(edgeId: number) {
    const node = this.svg.querySelector<SVGElement>(`[data-catan-harbor="${edgeId}"]`);
    if (!node) return;
    this.begin(`harbor:${edgeId}`, {
      duration: this.motion.matches ? 450 : BOARD_HARBOR_GLOW_MS, started: null,
      paint: () => { node.classList.add("is-newly-opened"); },
      dispose: () => { node.classList.remove("is-newly-opened"); },
    });
  }

  private roadAward(playerId: string, game: CatanView) {
    const nodes = longestRoadPath(game.board, playerId).map((id) => {
      const edge = game.board.edges[id]; const a = game.board.vertices[edge.a]; const b = game.board.vertices[edge.b];
      return svgNode("line", { class: "catan-road-award-glow", x1: a.x, y1: a.y, x2: b.x, y2: b.y, "pointer-events": "none" });
    });
    if (!nodes.length) return;
    this.layer.append(...nodes);
    this.begin("road-award", {
      duration: this.motion.matches ? 450 : 1200, started: null,
      paint: (progress) => { nodes.forEach((node) => node.setAttribute("opacity", String(this.motion.matches ? .8 : Math.sin(Math.PI * progress) * .65 + .2))); },
      dispose: () => { nodes.forEach((node) => node.remove()); },
    });
  }

  private schedule() {
    const busy = this.effects.size > 0;
    if (busy !== this.busy) { this.busy = busy; this.svg.setAttribute("data-catan-effect-active", String(busy)); this.onBusy?.(busy); }
    if (busy && !this.frame) this.frame = requestAnimationFrame(this.tick);
  }
  private tick = (now: number) => {
    this.frame = 0;
    if (this.disposed) return;
    if (!this.visible || document.hidden) { this.clear(); return; }
    for (const [key, effect] of this.effects) {
      if (effect.waitForDice && document.documentElement.classList.contains("catan-dice-rolling")) continue;
      effect.started ??= now;
      const progress = Math.min(1, Math.max(0, (now - effect.started) / effect.duration));
      effect.paint(progress);
      if (progress === 1) { effect.dispose(); this.effects.delete(key); }
    }
    this.schedule();
  };
  private clear(target = this.seen) {
    cancelAnimationFrame(this.frame); this.frame = 0;
    for (const effect of this.effects.values()) effect.dispose();
    // React may have already painted a newer destination before this layout
    // update cancels the previous journey. Never restore its obsolete target.
    const hex = target.board.hexes.find((item) => item.id === target.robberHex);
    const traveller = this.svg.querySelector<SVGElement>("[data-catan-robber-traveller]");
    if (hex && traveller) traveller.setAttribute("transform", `translate(${hex.x - 20} ${hex.y - 29})`);
    this.effects.clear(); this.schedule();
  }
  private onVisibility = () => { if (document.hidden) this.clear(); };
  private onMotion = () => { this.clear(); };
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.clear();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.motion.removeEventListener("change", this.onMotion);
  }
}
