import type { CSSProperties } from "react";
import {
  ATMOSPHERE_CLOUD_OPACITY, atmosphereCloudFrame, atmosphereFogFrame, atmosphereSurfOpacity,
  type AtmosphereSpec,
} from "@/lib/catan-atmosphere";
import type { AmbientGame } from "@/lib/catan-ambient";

function CloudCrop({ artId, variant, shadow = false }: { artId: string; variant: number; shadow?: boolean }) {
  // Centre the painted alpha footprints, whose atlas margins differ slightly.
  const offset = (shadow ? [[-3.668, -2.073], [-.239, -.797]] : [[-3.987, -10.925], [0, -8.134]])[variant];
  return <svg x={-50} y={-20} width={100} height={40} viewBox={`${variant * 100} ${shadow ? 130 : 30} 100 40`} preserveAspectRatio="none" overflow="hidden">
    <use href={`#${artId}-cloud-atlas`} transform={`translate(${offset[0]} ${offset[1]})`} />
  </svg>;
}

/** Geometry clips are static; all softness is painted into the small atlas. */
export function AtmosphereDefinitions({ game, artId, cloudsReady }: { game: AmbientGame; artId: string; cloudsReady: boolean }) {
  return <>
    {cloudsReady && <image id={`${artId}-cloud-atlas`} href="/catan/clouds-atlas-v1.png" width={200} height={200} preserveAspectRatio="none" />}
    <clipPath id={`${artId}-atmosphere-land`}>
      {game.board.hexes.map((hex) => <polygon key={hex.id} points={hex.vertices.map((id) => `${game.board.vertices[id].x},${game.board.vertices[id].y}`).join(" ")} />)}
    </clipPath>
  </>;
}

/** Kept beneath every play marking, with paired clouds sharing one clock. */
export function AtmosphereLayer({ spec, artId, cloudsReady, sky = false }: {
  spec: AtmosphereSpec; artId: string; cloudsReady: boolean; sky?: boolean;
}) {
  if (sky) return <g className="catan-atmosphere catan-atmosphere-sky">
    {cloudsReady && spec.clouds.map((cloud, index) => <g key={cloud.id} data-atmosphere-kind="cloud" data-atmosphere-id={cloud.id} className={`catan-atmosphere-cloud${index ? " is-desktop-cloud" : ""}`} opacity={0}>
      <g className="catan-atmosphere-cloud-size" style={{ "--catan-cloud-width": cloud.width } as CSSProperties}><CloudCrop artId={artId} variant={cloud.variant} /></g>
    </g>)}
    {cloudsReady && spec.fog && <g clipPath={`url(#${artId}-harbor-sea-clip)`}>
      <g data-atmosphere-kind="sea_fog" data-atmosphere-id={spec.fog.id} opacity={0}>
        <g transform={`scale(${spec.fog.width / 100} ${spec.fog.height / 40})`}><CloudCrop artId={artId} variant={1} /></g>
      </g>
    </g>}
  </g>;
  return <g className="catan-atmosphere catan-atmosphere-ground">
    {cloudsReady && <g clipPath={`url(#${artId}-atmosphere-land)`}>
      {spec.clouds.map((cloud, index) => <g key={cloud.id} data-atmosphere-kind="shadow" data-atmosphere-id={`${cloud.id}-shadow`} className={index ? "is-desktop-cloud" : undefined} opacity={0}>
        <g className="catan-atmosphere-cloud-size" style={{ "--catan-cloud-width": cloud.width } as CSSProperties}><CloudCrop artId={artId} variant={cloud.variant} shadow /></g>
      </g>)}
    </g>}
    <g clipPath={`url(#${artId}-harbor-sea-clip)`}>
      {spec.surf.map((surf) => <g key={surf.id} data-atmosphere-kind="surf" data-atmosphere-id={surf.id} opacity={0}>
        <line className="catan-atmosphere-surf-line" x1={surf.from.x} y1={surf.from.y} x2={surf.to.x} y2={surf.to.y} vectorEffect="non-scaling-stroke" />
        <line className="catan-atmosphere-surf-line is-secondary" x1={surf.from.x + surf.outward.x * 3} y1={surf.from.y + surf.outward.y * 3} x2={surf.to.x + surf.outward.x * 3} y2={surf.to.y + surf.outward.y * 3} vectorEffect="non-scaling-stroke" />
      </g>)}
    </g>
  </g>;
}

export function atmosphereNodes(layer: SVGGElement) {
  return new Map([...layer.querySelectorAll<SVGGElement>("[data-atmosphere-id]")].map((node) => [node.getAttribute("data-atmosphere-id"), node]));
}

export function paintAtmosphere(nodes: ReturnType<typeof atmosphereNodes>, spec: AtmosphereSpec, elapsed: number, scale: number, mobile: boolean, cloudsReady: boolean, preview: boolean, blocked: () => boolean, fogState: { visible: boolean }) {
  if (cloudsReady) {
    for (const [index, cloud] of spec.clouds.entries()) {
      if (mobile && index) continue;
      const frame = atmosphereCloudFrame(cloud, elapsed, scale, mobile);
      const node = nodes.get(cloud.id); const shadow = nodes.get(`${cloud.id}-shadow`);
      node?.setAttribute("transform", `translate(${frame.point.x} ${frame.point.y})`);
      node?.setAttribute("opacity", String(frame.opacity));
      shadow?.setAttribute("transform", `translate(${frame.point.x + 10} ${frame.point.y + 12})`);
      // The same edge fade makes the shadow disappear with its cloud.
      shadow?.setAttribute("opacity", String(frame.opacity / ATMOSPHERE_CLOUD_OPACITY * .055));
    }
    if (spec.fog) {
      const frame = atmosphereFogFrame(spec.fog, elapsed, preview);
      const node = nodes.get(spec.fog.id);
      const opacity = frame.opacity > 0 && (fogState.visible || !blocked()) ? frame.opacity : 0;
      fogState.visible = opacity > 0;
      node?.setAttribute("transform", `translate(${frame.point.x} ${frame.point.y})`);
      node?.setAttribute("opacity", String(opacity));
    }
  }
  for (const surf of spec.surf) {
    const node = nodes.get(surf.id);
    const progress = (elapsed / surf.duration + surf.phase) % 1;
    node?.setAttribute("opacity", String(atmosphereSurfOpacity(surf, elapsed)));
    node?.setAttribute("transform", `translate(${-surf.outward.x * progress * 2} ${-surf.outward.y * progress * 2})`);
  }
}
