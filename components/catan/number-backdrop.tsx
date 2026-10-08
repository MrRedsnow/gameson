import { useEffect, useState } from "react";
import type { Resource } from "@/lib/catan";

type Terrain = Resource | "desert";
type TerrainCells = Record<Terrain, readonly [number, number]>;
type Backdrops = Partial<Record<Terrain, string>>;
const RADIUS = 28;
const SCALE = 2;
const TERRAIN_SIZE = 108;
const TINT = "#252727";
const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
const backdropCache = new Map<string, Promise<string | null>>();

function loadImage(src: string) {
  const saved = imageCache.get(src);
  if (saved) return saved;
  const pending = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    const finish = (value: HTMLImageElement | null) => {
      image.onload = null; image.onerror = null;
      resolve(value);
    };
    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    image.src = src;
  });
  imageCache.set(src, pending);
  return pending;
}

function rasterBackdrop(resource: Terrain, cell: readonly [number, number], cleanPasture: boolean) {
  const pasture = resource === "wool" && cleanPasture;
  const src = pasture ? "/catan/pasture-v1.png" : "/catan/terrain-atlas-v3.jpg";
  const key = `${src}:${cell.join(",")}`;
  const saved = backdropCache.get(key);
  if (saved) return saved;
  const pending = (async () => {
    const terrain = document.createElement("canvas");
    terrain.width = terrain.height = TERRAIN_SIZE * SCALE;
    const context = terrain.getContext("2d");
    if (!context || !("filter" in context)) return null;
    context.filter = `blur(${2.2 * SCALE}px)`;
    if (!context.filter.startsWith("blur(")) return null;
    const image = await loadImage(src);
    if (!image) return null;
    const cellWidth = image.naturalWidth / (pasture ? 1 : 3);
    const cellHeight = image.naturalHeight / (pasture ? 1 : 2);
    // Rasterize once per terrain, with the full cell as blur padding. Zoom and
    // pan subsequently paint a small static PNG, without any live filter.
    context.drawImage(image, pasture ? 0 : cell[0] * cellWidth, pasture ? 0 : cell[1] * cellHeight, cellWidth, cellHeight, 0, 0, terrain.width, terrain.height);
    context.filter = "none";
    context.globalAlpha = .64;
    context.fillStyle = TINT;
    context.fillRect(0, 0, terrain.width, terrain.height);

    const output = document.createElement("canvas");
    const diameter = RADIUS * 2 * SCALE;
    output.width = output.height = diameter;
    const result = output.getContext("2d");
    if (!result) return null;
    const offset = (terrain.width - diameter) / 2;
    result.drawImage(terrain, offset, offset, diameter, diameter, 0, 0, diameter, diameter);
    const center = diameter / 2;
    const alpha = result.createRadialGradient(center, center, center * .5, center, center, center);
    alpha.addColorStop(0, "#fff");
    alpha.addColorStop(1, "#fff0");
    result.globalCompositeOperation = "destination-in";
    result.fillStyle = alpha;
    result.fillRect(0, 0, diameter, diameter);
    return output.toDataURL("image/png");
  })().catch(() => null);
  backdropCache.set(key, pending);
  return pending;
}

export function NumberBackdropDefinitions({ id, cleanPasture = false, cells }: { id: string; cleanPasture?: boolean; cells: TerrainCells }) {
  const [ready, setReady] = useState<{ cells: TerrainCells; cleanPasture: boolean; images: Backdrops } | null>(null);
  useEffect(() => {
    let mounted = true;
    void Promise.all(Object.entries(cells).map(async ([resource, cell]) => [resource, await rasterBackdrop(resource as Terrain, cell, cleanPasture)] as const))
      .then((entries) => {
        if (mounted) setReady({ cells, cleanPasture, images: Object.fromEntries(entries.filter((entry) => entry[1])) as Backdrops });
      });
    return () => { mounted = false; };
  }, [cells, cleanPasture]);
  const images = ready?.cells === cells && ready.cleanPasture === cleanPasture ? ready.images : {};
  const gradient = `${id}-number-backdrop-fade`;
  return <>
    <radialGradient id={gradient}>
      <stop offset="0" stopColor={TINT} stopOpacity=".64" />
      <stop offset=".5" stopColor={TINT} stopOpacity=".64" />
      <stop offset="1" stopColor={TINT} stopOpacity="0" />
    </radialGradient>
    {Object.keys(cells).map((resource) => <g key={resource} id={`${id}-number-backdrop-${resource}`}>
      {images[resource as Terrain]
        ? <image href={images[resource as Terrain]} x={-RADIUS} y={-RADIUS} width={RADIUS * 2} height={RADIUS * 2} />
        : <circle r={RADIUS} fill={`url(#${gradient})`} />}
    </g>)}
  </>;
}

export function NumberBackdrop({ id, resource, x, y, mirrored = false }: { id: string; resource: Terrain; x: number; y: number; mirrored?: boolean }) {
  return <use className="catan-number-backdrop" href={`#${id}-number-backdrop-${resource}`} transform={`translate(${x} ${y})${mirrored ? " scale(-1 1)" : ""}`} pointerEvents="none" aria-hidden="true" />;
}
