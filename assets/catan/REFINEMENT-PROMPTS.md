# Catan refinement prompts

Generated with the built-in ImageGen tool on 2026-10-13. Each existing artwork file was inspected and supplied as an edit target. Local input paths below are shortened to their repository filenames. The roof-only follow-up implements the requested stronger player colors.

## Sea v4

```text
Use case: style-transfer.
Asset type: production overhead sea texture for the existing hand-painted Catan island.
Input image: edit target sea-v3.jpg.
Repaint this exact water-only texture as calmer matte gouache. Keep the same restrained dark blue-green and slate-blue palette and square overhead water composition. Simplify the repeated sharp crests into broad soft currents and sparse gentle short brush wavelets. Reduce wave contrast substantially and remove the noisy repetitive microdetail while still clearly reading as seawater. Soft diffuse daylight, no directional bright spot, no focal object. Image fills every edge, no seam-like border. No land, horizon, sky, boats, foam bands, text, UI, glow or objects. Preserve a richly painted natural surface, not a flat color or blur. Production export target 1254 by 1254 pixels. Output only the square sea image.
```

## Terrain v4

```text
Use case: style-transfer.
Asset type: production six-cell landscape texture atlas.
Input image: edit target terrain-atlas-v3.jpg.
Refine this exact 3-column by 2-row edge-to-edge gouache atlas for a Catan island. Preserve cell order, exact grid with no gutters or dividers: forest, sheep pasture, wheat; clay quarry, mountains, sandy desert. Keep natural muted green, gold, terracotta, cool gray and ochre colors and high overhead slightly oblique aerial perspective. Make recognizable grouped forms larger and clearer at 80-120 pixels: clustered forest crowns, broad wheat harvest rows, clear quarry planes, broad mountain facets and smooth dunes. Reduce photographic and tiny painted detail by about one third while preserving tactile handmade gouache. Unify soft warm highlights and cool subtle shadows. Use diffuse nondirectional light because tiles will be mirrored. No hard directional cast shadows. Calm central area without blank cutouts for a small numeric game marker later added by code. Preserve resource identity and complete scenes filling all cell edges. No water, coastline, sky, horizon, roads, buildings, boats, hexagons, labels, symbols, text or UI. Exact production canvas 1536 by 1024, six equal square cells in a seamless 3x2 grid. Output only the atlas.
```

## Clean pasture v2

```text
Use case: style-transfer.
Asset type: production clean sheep pasture ground texture for an animated Catan tile.
Input image: edit target pasture-v1.png.
Refine this exact square gouache meadow into a clearer, calmer small game landscape. Preserve high overhead slightly oblique view, recognizable natural grass, restrained warm greens, sparse grouped white flowers, a few bushes along edges and the two lower-left gray stones. Larger painted grass masses, fewer tiny flecks, broad soft warm highlights and cool shadows with diffuse nondirectional daylight. Keep most of the center as continuous open grass for sheep that are rendered by code. No sheep or any animals, people, roads, buildings, fences, sky, water, numbers, text, UI or transparent areas. This is a full edge-to-edge opaque ground texture. Match the same restrained handmade gouache style as the existing six landscape scenes. Production target exactly 1254 by 1254 pixels. Output only the meadow texture.
```

## Buildings v4

```text
Use case: style-transfer.
Asset type: production transparent building atlas for a hand-painted Catan island.
Input image: edit target buildings-v3.png.
Refine the exact EIGHT building sprites while preserving this exact 4-column by 2-row atlas with transparent margins. Top row four color variants of the same one-house settlement, bottom row four variants of the same three-house city. Keep composition, scale, center, shape and position of EVERY sprite nearly unchanged. Top-row feet at 88 percent of each cell height; bottom-row feet at 81 percent. Preserve color columns left to right: terracotta coral red #eb7959, dusty blue #63a9e9, warm ivory #eee7d2, muted purple #b58cdd. Preserve elevated three-quarter camera. Make roof color masses and building silhouettes clear at 30-45 pixels. Simplify tiny tiles/windows details into broader matte gouache strokes; unify soft daylight and restrained warm plaster highlights, cooler recesses, and painted contact shadows directly at feet. No exaggerated outline or glow. All shadows must be small within existing sprite footprints; no background ground rectangle. Actual transparent alpha everywhere around and between buildings. No border, divider, text, labels, watermark, checkerboard, extra buildings, church or cross. Production canvas target exactly 1774 by 887 pixels, 4 equal columns and 2 equal rows. Output only the atlas on actual transparency.
```

## Buildings: more recognizable roof colors

```text
Use case: precise-object-edit.
Input image: edit target, the provided transparent eight-building atlas.
Make ONLY the player-colored ROOFS more saturated and easier to identify at 30 pixels. Keep exact 4 columns by 2 rows and all eight building positions, size, silhouettes, walls, windows, contact shadows, paint style and genuine transparent alpha unchanged. Roof colors by column: stronger warm terracotta CORAL RED, clearly saturated dusty-medium BLUE, warm light IVORY CREAM with clear contrast against darker beige walls (not yellow or brown), richer MAUVE PURPLE. Increase roof saturation moderately by about25%, preserving natural matte gouache shading and readable broad roof color masses. The same roof colors must match between each settlement and city column. Do not tint walls or foliage; do not add glows, outlines, ground, objects, text or dividers. Keep canvas exactly1774x887, 4 equal columns and2 equal rows, original transparent margins and feet at88% top cell/81% bottom cell. Output only the refined building atlas on actual transparency.
```

## Production export

Final generated pixels are exported to the existing production dimensions without compositional edits. Terrain and sea use JPEG quality 85 with MozJPEG; the pasture uses lossless RGB PNG without unused alpha, and buildings use lossless RGBA PNG. PNG compression level 9 with adaptive filtering. All original assets remain available as references; only the new versions are loaded and precached.
