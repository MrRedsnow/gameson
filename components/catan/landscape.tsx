import type { Resource } from "@/lib/catan";

const TERRAIN_CELLS: Record<Resource | "desert", readonly [number, number]> = {
  wood: [0, 0], wool: [1, 0], grain: [2, 0],
  brick: [0, 1], ore: [1, 1], desert: [2, 1],
};
const TERRAIN_FALLBACKS = { wood: "#3d5431", wool: "#78904e", grain: "#c6a264", brick: "#a57957", ore: "#788384", desert: "#ceae79" };

// Six scenes share one image request. Nested view boxes select the atlas cells;
// the board's hexagonal clip paths trim them without stretching the terrain.
export function LandscapeDefinitions({ id }: { id: string }) {
  return <>
    <image id={`${id}-terrain-atlas`} href="/catan/terrain-atlas-v3.jpg" width="324" height="216" preserveAspectRatio="none" />
    <image id={`${id}-buildings-atlas`} href="/catan/buildings-v3.png" width="400" height="200" preserveAspectRatio="none" />
    <image id={`${id}-harbor-atlas`} href="/catan/harbor-atlas-v3.png" width="200" height="100" preserveAspectRatio="none" />
    {Object.entries(TERRAIN_CELLS).map(([resource, [column, row]]) => <g key={resource} id={`${id}-${resource}`}>
      <rect x="-54" y="-54" width="108" height="108" fill={TERRAIN_FALLBACKS[resource as Resource | "desert"]} />
      <svg x="-54" y="-54" width="108" height="108" viewBox={`${column * 108} ${row * 108} 108 108`} overflow="hidden">
        <use href={`#${id}-terrain-atlas`} />
      </svg>
    </g>)}
  </>;
}

export function Landscape({ id, resource, x, y, mirrored = false }: { id: string; resource: Resource | "desert"; x: number; y: number; mirrored?: boolean }) {
  return <use className="catan-landscape" href={`#${id}-${resource}`} transform={`translate(${x} ${y})${mirrored ? " scale(-1 1)" : ""}`} aria-hidden="true" />;
}

export function HarborIllustration({ id, x, y, angle }: { id: string; x: number; y: number; angle: number }) {
  return <g className="catan-harbor-illustration" transform={`translate(${x} ${y}) rotate(${angle})`} aria-hidden="true">
    <svg x="-6" y="-22" width="44" height="44" viewBox="0 0 100 100" overflow="hidden">
      <use href={`#${id}-harbor-atlas`} />
    </svg>
    <svg x="3" y="3" width="32" height="32" viewBox="100 0 100 100" overflow="hidden">
      <use href={`#${id}-harbor-atlas`} />
    </svg>
    <path d="M30 8q-1 5-8 6" fill="none" stroke="#c4ac82" strokeWidth=".7" opacity=".7" />
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
