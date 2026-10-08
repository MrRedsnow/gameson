import type { CSSProperties } from "react";
import type { Board, Resource } from "@/lib/catan";
import { HARBOR_BOAT_SIZE, harborMooringPath, type HarborLayout } from "@/lib/catan-harbor";
import { NumberBackdropDefinitions } from "./number-backdrop";

const TERRAIN_CELLS: Record<Resource | "desert", readonly [number, number]> = {
  wood: [0, 0], wool: [1, 0], grain: [2, 0],
  brick: [0, 1], ore: [1, 1], desert: [2, 1],
};
const TERRAIN_FALLBACKS = { wood: "#3d5431", wool: "#78904e", grain: "#c6a264", brick: "#a57957", ore: "#788384", desert: "#ceae79" };

// Six scenes share one image request. Nested view boxes select the atlas cells;
// the board's hexagonal clip paths trim them without stretching the terrain.
export function LandscapeDefinitions({ id, cleanPasture = false }: { id: string; cleanPasture?: boolean }) {
  return <>
    <NumberBackdropDefinitions id={id} cleanPasture={cleanPasture} cells={TERRAIN_CELLS} />
    <image id={`${id}-terrain-atlas`} href="/catan/terrain-atlas-v3.jpg" width="324" height="216" preserveAspectRatio="none" />
    <image id={`${id}-buildings-atlas`} href="/catan/buildings-v3.png" width="400" height="200" preserveAspectRatio="none" />
    <image id={`${id}-harbor-atlas`} href="/catan/harbor-atlas-v3.png" width="200" height="100" preserveAspectRatio="none" />
    <clipPath id={`${id}-boat-sprite-clip`} clipPathUnits="userSpaceOnUse"><rect x={-HARBOR_BOAT_SIZE / 2} y={-HARBOR_BOAT_SIZE / 2} width={HARBOR_BOAT_SIZE} height={HARBOR_BOAT_SIZE} /></clipPath>
    <image id={`${id}-robber`} href="/catan/robber-v2.png" width="40" height="40" />
    <image id={`${id}-pasture`} href="/catan/pasture-v1.png" width="108" height="108" preserveAspectRatio="none" />
    {Object.entries(TERRAIN_CELLS).map(([resource, [column, row]]) => <g key={resource} id={`${id}-${resource}`}>
      <rect x="-54" y="-54" width="108" height="108" fill={TERRAIN_FALLBACKS[resource as Resource | "desert"]} />
      <svg x="-54" y="-54" width="108" height="108" viewBox={resource === "wool" && cleanPasture ? "0 0 108 108" : `${column * 108} ${row * 108} 108 108`} overflow="hidden">
        <use href={`#${id}-${resource === "wool" && cleanPasture ? "pasture" : "terrain-atlas"}`} />
      </svg>
    </g>)}
  </>;
}

export function Landscape({ id, resource, x, y, mirrored = false, blocked = false }: { id: string; resource: Resource | "desert"; x: number; y: number; mirrored?: boolean; blocked?: boolean }) {
  return <use className={`catan-landscape${blocked ? " is-blocked" : ""}`} href={`#${id}-${resource}`} transform={`translate(${x} ${y})${mirrored ? " scale(-1 1)" : ""}`} aria-hidden="true" />;
}

export function RobberPiece({ id, x, y }: { id: string; x: number; y: number }) {
  return <use className="catan-robber-piece" data-catan-robber-traveller="" href={`#${id}-robber`} transform={`translate(${x - 20} ${y - 29})`} aria-hidden="true" />;
}

export function HarborSeaClip({ id, board, bounds }: { id: string; board: Board; bounds: { x: number; y: number; width: number; height: number } }) {
  const { x, y, width, height } = bounds;
  const sea = `M${x} ${y}h${width}v${height}h${-width}Z`;
  const land = board.hexes.map((hex) => `M${hex.vertices.map((vertex) => `${board.vertices[vertex].x} ${board.vertices[vertex].y}`).join("L")}Z`).join("");
  // A vector clip protects the ropes at stepped coast corners without an
  // island-sized offscreen alpha mask for every animated vessel.
  return <clipPath id={`${id}-harbor-sea-clip`} clipPathUnits="userSpaceOnUse"><path d={`${sea}${land}`} clipRule="evenodd" /></clipPath>;
}

export function HarborIllustration({ id, layout, phase = 0 }: { id: string; layout: HarborLayout; phase?: number }) {
  const motionStyle = { "--catan-boat-delay": `${-phase * 1.13}s`, "--catan-boat-period": `${5.5 + phase % 3}s` } as CSSProperties;
  const mooringStyle = { ...motionStyle, "--catan-mooring-from": `path("${harborMooringPath(layout, 0)}")`, "--catan-mooring-to": `path("${harborMooringPath(layout, 1)}")` } as CSSProperties;
  const atlasScale = HARBOR_BOAT_SIZE / 100;
  return <g className="catan-harbor-illustration" aria-hidden="true">
    <g className="catan-harbor-pier" transform={`translate(${layout.coast.x} ${layout.coast.y}) rotate(${layout.angle})`}>
    <svg x="-6" y="-22" width="44" height="44" viewBox="0 0 100 100" overflow="hidden">
      <use href={`#${id}-harbor-atlas`} />
    </svg>
    </g>
    {/* The layout reserves the entire sway envelope outside every land hex,
        label and neighboring boat, so the sprite itself needs no sea mask. */}
    <g transform={`translate(${layout.boat.x} ${layout.boat.y})`} data-catan-boat-heading={layout.heading}>
      <g className="catan-ambient-boat" style={motionStyle}>
        {/* A fixed local crop avoids nested viewports and cloned atlas bounds
            changing the animation's reference box as the map zooms. */}
        <g clipPath={`url(#${id}-boat-sprite-clip)`}>
          <image href="/catan/boats-directions-v1.png" x={-(layout.heading % 3 + .5) * HARBOR_BOAT_SIZE} y={-(Math.floor(layout.heading / 3) + .5) * HARBOR_BOAT_SIZE} width={300 * atlasScale} height={200 * atlasScale} preserveAspectRatio="none" />
        </g>
      </g>
    </g>
    <path className="catan-harbor-mooring" style={mooringStyle} d={harborMooringPath(layout)} clipPath={`url(#${id}-harbor-sea-clip)`} fill="none" stroke="#c4ac82" strokeWidth=".7" opacity=".85" vectorEffect="non-scaling-stroke" />
  </g>;
}

export function BuildingPiece({ id, building, colorIndex, x, y }: { id: string; building: "settlement" | "city"; colorIndex: number; x: number; y: number }) {
  const city = building === "city";
  const size = city ? 56 : 44;
  // The two atlas rows have different transparent margins below the buildings.
  const baseline = city ? .81 : .88;
  return <g className="catan-building-piece" data-building={building} transform={`translate(${x} ${y})`} aria-hidden="true">
    <ellipse cy="9" rx={city ? 24 : 16} ry="4" fill="#142725" opacity=".3" />
    <g transform="translate(0 11)"><g className="catan-building-structure">
      <svg x={-size / 2} y={-size * baseline} width={size} height={size} viewBox={`${colorIndex * 100} ${city ? 100 : 0} 100 100`} overflow="hidden">
        <use href={`#${id}-buildings-atlas`} />
      </svg>
    </g></g>
  </g>;
}
