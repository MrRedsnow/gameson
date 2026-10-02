import type { CSSProperties } from "react";
import type { Board, Resource } from "@/lib/catan";
import { HARBOR_BOAT_SIZE, harborMooringPath, type HarborLayout } from "@/lib/catan-harbor";

const TERRAIN_CELLS: Record<Resource | "desert", readonly [number, number]> = {
  wood: [0, 0], wool: [1, 0], grain: [2, 0],
  brick: [0, 1], ore: [1, 1], desert: [2, 1],
};
const TERRAIN_FALLBACKS = { wood: "#3d5431", wool: "#78904e", grain: "#c6a264", brick: "#a57957", ore: "#788384", desert: "#ceae79" };

// Six scenes share one image request. Nested view boxes select the atlas cells;
// the board's hexagonal clip paths trim them without stretching the terrain.
export function LandscapeDefinitions({ id, cleanPasture = false }: { id: string; cleanPasture?: boolean }) {
  return <>
    <image id={`${id}-terrain-atlas`} href="/catan/terrain-atlas-v3.jpg" width="324" height="216" preserveAspectRatio="none" />
    <image id={`${id}-buildings-atlas`} href="/catan/buildings-v3.png" width="400" height="200" preserveAspectRatio="none" />
    <image id={`${id}-harbor-atlas`} href="/catan/harbor-atlas-v3.png" width="200" height="100" preserveAspectRatio="none" />
    <image id={`${id}-boats-atlas`} href="/catan/boats-directions-v1.png" width="300" height="200" preserveAspectRatio="none" />
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

export function HarborSeaMask({ id, board, bounds }: { id: string; board: Board; bounds: { x: number; y: number; width: number; height: number } }) {
  return <mask id={`${id}-boat-sea-mask`} maskUnits="userSpaceOnUse" {...bounds}>
    <rect {...bounds} fill="white" />
    {board.hexes.map((hex) => <polygon key={hex.id} points={hex.vertices.map((vertex) => `${board.vertices[vertex].x},${board.vertices[vertex].y}`).join(" ")} fill="black" stroke="black" strokeWidth="2" strokeLinejoin="round" />)}
  </mask>;
}

export function HarborIllustration({ id, layout, phase = 0 }: { id: string; layout: HarborLayout; phase?: number }) {
  const motionStyle = { "--catan-boat-delay": `${-phase * 1.13}s`, "--catan-boat-period": `${5.5 + phase % 3}s` } as CSSProperties;
  const mooringStyle = { ...motionStyle, "--catan-mooring-from": `path("${harborMooringPath(layout, 0)}")`, "--catan-mooring-to": `path("${harborMooringPath(layout, 1)}")` } as CSSProperties;
  const half = HARBOR_BOAT_SIZE / 2;
  return <g className="catan-harbor-illustration" aria-hidden="true">
    <g className="catan-harbor-pier" transform={`translate(${layout.coast.x} ${layout.coast.y}) rotate(${layout.angle})`}>
    <svg x="-6" y="-22" width="44" height="44" viewBox="0 0 100 100" overflow="hidden">
      <use href={`#${id}-harbor-atlas`} />
    </svg>
    </g>
    <g mask={`url(#${id}-boat-sea-mask)`} data-catan-boat-heading={layout.heading}>
      <svg x={layout.boat.x - half} y={layout.boat.y - half} width={HARBOR_BOAT_SIZE} height={HARBOR_BOAT_SIZE} viewBox={`${-half} ${-half} ${HARBOR_BOAT_SIZE} ${HARBOR_BOAT_SIZE}`} overflow="visible">
        <g className="catan-ambient-boat" style={{ ...motionStyle, transformBox: "view-box", transformOrigin: "50% 50%" }}>
          <svg x={-half} y={-half} width={HARBOR_BOAT_SIZE} height={HARBOR_BOAT_SIZE} viewBox={`${layout.heading % 3 * 100} ${Math.floor(layout.heading / 3) * 100} 100 100`} overflow="hidden"><use href={`#${id}-boats-atlas`} /></svg>
        </g>
      </svg>
      <path className="catan-harbor-mooring" style={mooringStyle} d={harborMooringPath(layout)} fill="none" stroke="#c4ac82" strokeWidth=".7" opacity=".85" vectorEffect="non-scaling-stroke" />
    </g>
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
