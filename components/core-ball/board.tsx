"use client";

import { useEffect, useRef } from "react";
import { CORE_BALL_CORE_RADIUS, CORE_BALL_PIN_RADIUS, CORE_BALL_SHOT_MS, coreBallAngle, type CoreBallGame } from "@/lib/core-ball";

export type CoreBallFlight = { game: CoreBallGame; firedAt: number; playerId: string };

/** The frame clock only draws. Every rotation and hit uses the shared analytical engine. */
export function CoreBallBoard({ game, now, disabled = false, onShoot, flight = null, baselineEventId = null }: {
  game: CoreBallGame; now: () => number; disabled?: boolean; onShoot: () => void; flight?: CoreBallFlight | null; baselineEventId?: string | null;
}) {
  const rotation = useRef<SVGGElement>(null);
  const flyingPin = useRef<SVGGElement>(null);
  const arena = useRef<SVGSVGElement>(null);
  const display = flight?.game ?? game;
  const recent = game.lastEvent;
  const remoteShot = !flight && recent && recent.id !== baselineEventId && ["shot", "collision", "level-complete"].includes(recent.type) ? recent : null;
  const shooter = game.players.find((p) => p.id === (flight?.playerId ?? remoteShot?.playerId ?? game.activePlayerId));
  const flightAt = flight?.firedAt ?? remoteShot?.at ?? null;
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const time = now();
      rotation.current?.setAttribute("transform", `rotate(${coreBallAngle(display, time) * 180 / Math.PI} 200 176)`);
      const progress = flightAt === null ? 1 : Math.min(1, Math.max(0, (time - flightAt) / CORE_BALL_SHOT_MS));
      if (flyingPin.current) {
        flyingPin.current.style.opacity = progress < 1 ? "1" : "0";
        flyingPin.current.setAttribute("transform", `translate(200 ${338 - progress * 62})`);
      }
      if (arena.current) {
        const collision = recent?.id !== baselineEventId && recent?.type === "collision" && time >= recent.at + CORE_BALL_SHOT_MS && time < recent.at + CORE_BALL_SHOT_MS + 360;
        arena.current.classList.toggle("is-collision", Boolean(collision));
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [display, now, flightAt, recent, baselineEventId]);
  return <button type="button" className="core-ball-board-button" aria-label="Kugel setzen – Spielfeld" disabled={disabled} onClick={onShoot} onKeyDown={(event) => {
    if (event.repeat && (event.key === " " || event.key === "Enter")) event.preventDefault();
  }}>
    <svg ref={arena} className="core-ball-board" viewBox="0 0 400 370" aria-hidden="true">
      <defs><radialGradient id="core-ball-halo"><stop offset="0" stopColor="#d8ff94" stopOpacity=".08" /><stop offset="1" stopColor="#d8ff94" stopOpacity="0" /></radialGradient></defs>
      <circle className="core-ball-halo" cx="200" cy="176" r="163" fill="url(#core-ball-halo)" />
      <circle className="core-ball-orbit" cx="200" cy="176" r="100" />
      <circle className="core-ball-orbit is-outer" cx="200" cy="176" r="138" />
      <g ref={rotation} transform={`rotate(${coreBallAngle(display, display.runningSince ?? 0) * 180 / Math.PI} 200 176)`}>
        {display.pins.map((pin, index) => {
          const player = display.players.find((p) => p.id === pin.playerId);
          const x = 200 + Math.cos(pin.angle) * 100; const y = 176 + Math.sin(pin.angle) * 100;
          const hideUntilImpact = !flight && remoteShot?.type === "shot" && remoteShot.angle === pin.angle && index === display.pins.length - 1;
          return <g key={`${display.attemptId}-${index}`} className={`core-ball-pin${hideUntilImpact ? " is-new-pin" : ""}`} style={hideUntilImpact ? { animationDelay: `${Math.max(0, (remoteShot?.at ?? 0) + CORE_BALL_SHOT_MS - now())}ms` } : undefined}>
            <title>{player ? `${player.name}, Kugel ${index + 1}` : `Vorhandene Kugel ${index + 1}`}</title>
            <line x1="200" y1="176" x2={x} y2={y} stroke={player?.color ?? "#f2f4ed"} />
            <circle cx={x} cy={y} r={CORE_BALL_PIN_RADIUS * 100} fill={player?.color ?? "#f2f4ed"} />
            {player && <text x={x} y={y + .4} transform={`rotate(${-pin.angle * 180 / Math.PI} ${x} ${y})`}>{display.players.findIndex((p) => p.id === player.id) + 1}</text>}
          </g>;
        })}
      </g>
      <circle className="core-ball-core" cx="200" cy="176" r={CORE_BALL_CORE_RADIUS * 100} />
      <text className="core-ball-core-number" x="200" y="176">{display.level}</text>
      <text className="core-ball-core-label" x="200" y="193">LEVEL</text>
      <path className="core-ball-launch-guide" d="M200 306V289" />
      <circle className="core-ball-launch-dot" cx="200" cy="338" r="11" fill={shooter?.color ?? "#d8ff94"} />
      <g ref={flyingPin} className="core-ball-flying-pin" style={{ opacity: 0 }} transform="translate(200 338)"><circle r="11" fill={shooter?.color ?? "#d8ff94"} /></g>
    </svg>
  </button>;
}
