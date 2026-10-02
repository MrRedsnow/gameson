"use client";

import { useLayoutEffect, useRef } from "react";
import { Map as MapIcon, Shield, Trophy } from "lucide-react";
import { DEVELOPMENT_INFO, PLAYER_COLORS, type CatanView } from "@/lib/catan";
import { CatanPresentationCursor, type CatanAwardPresentation, type CatanCardPresentation } from "@/lib/catan-presentation";

export const CATAN_EVENT_NOTICE_MS = 1800;
type Notice = { kind: "card"; event: CatanCardPresentation } | { kind: "award"; event: CatanAwardPresentation };

/** Presentation stays inside the private view, including all queued cards and timers. */
export class CatanEventNoticePlayback {
  private cursor: CatanPresentationCursor;
  private game: CatanView;
  private baseline: number;
  private queue: Notice[] = [];
  private timer = 0;
  private frame = 0;
  private disposed = false;
  private motion = window.matchMedia("(prefers-reduced-motion: reduce)");

  constructor(private node: HTMLElement, initial: CatanView, baseline = 0) {
    this.game = initial; this.baseline = baseline;
    this.cursor = new CatanPresentationCursor(initial, baseline);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.motion.addEventListener("change", this.onMotion);
    this.onMotion();
  }

  update(game: CatanView, baseline = 0) {
    if (this.disposed) return;
    const reset = game.id !== this.game.id || game.me?.id !== this.game.me?.id || baseline !== this.baseline;
    const batch = this.cursor.update(game, baseline);
    // Delayed old snapshots must not supply names, ownership or hand contents either.
    if (!reset && game.sequence < this.game.sequence) return;
    this.game = game; this.baseline = baseline;
    if (reset || document.hidden || game.phase === "map_vote") { this.clear(); return; }
    const fresh: Notice[] = [
      ...(batch?.cards ?? []).map((event): Notice => ({ kind: "card", event })),
      ...(batch?.awards ?? []).map((event): Notice => ({ kind: "award", event })),
    ];
    if (!fresh.length) return;
    // A newer batch replaces an older celebration instead of building a stale backlog.
    this.clear(); this.queue = fresh; this.next();
  }

  private next = () => {
    this.frame = 0;
    if (this.disposed || document.hidden) { this.clear(); return; }
    if (document.documentElement.classList.contains("catan-dice-rolling")) { this.frame = requestAnimationFrame(this.next); return; }
    const notice = this.queue.shift();
    if (!notice) { this.clear(); return; }
    const event = notice.event;
    if (notice.kind === "card" && notice.event.playerId !== this.game.me?.id) { this.next(); return; }
    const playerId = notice.kind === "card" ? notice.event.playerId : notice.event.toId;
    const player = this.game.players.find((item) => item.id === playerId);
    const text = (selector: string, value: string) => { const child = this.node.querySelector(selector); if (child) child.textContent = value; };
    this.node.style.setProperty("--catan-event-player", player ? PLAYER_COLORS[player.color] : "#d6c39e");
    this.node.className = `catan-event-notice is-${notice.kind}${notice.kind === "award" ? ` is-${notice.event.type}` : ""}`;
    this.node.setAttribute("data-catan-event", event.id);
    if (notice.kind === "card") {
      const card = DEVELOPMENT_INFO[notice.event.type];
      const playable = this.game.me?.development.find((item) => item.id === notice.event.cardId)?.boughtOnTurn !== this.game.turn;
      text("[data-event-eyebrow]", "Neue Entwicklungskarte");
      text("[data-event-title]", card.label);
      text("[data-event-description]", card.description);
      text("[data-event-footnote]", notice.event.type === "victory" ? "Zählt sofort verdeckt zu deinen Punkten" : playable ? "Ab jetzt spielbar" : "Ab deinem nächsten Zug spielbar");
    } else {
      text("[data-event-eyebrow]", "Sonderkarte");
      text("[data-event-title]", notice.event.type === "longestRoad" ? "Längste Handelsstraße" : "Größte Rittermacht");
      text("[data-event-description]", player ? `${player.name} erhält +2 Siegpunkte` : "Diese Sonderkarte ist wieder unbesetzt");
      const former = this.game.players.find((item) => item.id === notice.event.fromId);
      text("[data-event-footnote]", former ? `${former.name} gibt die Sonderkarte ab` : "Eine neue Auszeichnung auf eurer Insel");
    }
    this.node.hidden = false;
    // Restart the short CSS entrance even when another notice used the same icon.
    this.node.classList.remove("is-entering");
    void this.node.offsetWidth;
    this.node.classList.add("is-entering");
    this.timer = window.setTimeout(() => { this.timer = 0; this.node.hidden = true; this.next(); }, CATAN_EVENT_NOTICE_MS);
  };

  private clear() {
    clearTimeout(this.timer); cancelAnimationFrame(this.frame); this.timer = 0; this.frame = 0; this.queue = [];
    this.node.hidden = true; this.node.removeAttribute("data-catan-event");
    this.node.querySelectorAll("[data-event-copy]").forEach((child) => { child.textContent = ""; });
  }
  private onVisibility = () => { if (document.hidden) this.clear(); };
  private onMotion = () => { this.node.setAttribute("data-motion", this.motion.matches ? "still" : "full"); };
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.clear();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.motion.removeEventListener("change", this.onMotion);
  }
}

export function CatanEventNotice({ game, animationBaseline = 0 }: { game: CatanView; animationBaseline?: number }) {
  const node = useRef<HTMLDivElement>(null);
  const playback = useRef<CatanEventNoticePlayback | null>(null);
  useLayoutEffect(() => {
    if (!node.current) return;
    if (!playback.current) playback.current = new CatanEventNoticePlayback(node.current, game, animationBaseline);
    else playback.current.update(game, animationBaseline);
  }, [game, animationBaseline]);
  useLayoutEffect(() => () => { playback.current?.dispose(); playback.current = null; }, []);
  return <div ref={node} className="catan-event-notice" hidden role="status" aria-live="polite" aria-atomic="true">
    <div className="catan-event-card-inner">
      <div className="catan-event-card-back" aria-hidden="true"><Shield /></div>
      <div className="catan-event-card-front">
        <span className="catan-event-icon" aria-hidden="true"><Shield className="catan-event-shield" /><MapIcon className="catan-event-road" /><Trophy className="catan-event-trophy" /></span>
        <div className="catan-event-copy"><small data-event-eyebrow data-event-copy /><strong data-event-title data-event-copy /><span data-event-description data-event-copy /><small data-event-footnote data-event-copy /></div>
      </div>
    </div>
  </div>;
}
