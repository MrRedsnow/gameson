# Catan artwork

Generated with the built-in ImageGen tool on 2026-10-01. The current v3 artwork uses gouache illustration with natural proportions and visible brushwork, between flat vector art and photorealism. Terrain and sea were encoded as JPEG at quality 85; the building atlas keeps its original PNG alpha. Image content and dimensions are unchanged. No external stock assets are used.

- Terrain atlas: [public/catan/terrain-atlas-v3.jpg](../../public/catan/terrain-atlas-v3.jpg). Six equal cells in a 3 × 2 grid, ordered wood, wool, grain / brick, ore, desert. Each SVG landscape clips the matching atlas cell; the file is downloaded once. ImageGen repainted the v2 terrain atlas as a style edit.
- Sea background: [public/catan/sea-v3.jpg](../../public/catan/sea-v3.jpg). A painterly edit of the v2 sea, used across the entire map viewport.
- Buildings: [public/catan/buildings-v3.png](../../public/catan/buildings-v3.png). A transparent 4 × 2 atlas, generated using the v3 terrain as a style reference. The top row contains settlements, the bottom row cities. Columns follow player colors: coral, blue, ivory, purple. Crop selection, scale and placement remain native SVG; the generated roof colors identify ownership.
- Harbors: [public/catan/harbor-atlas-v3.png](../../public/catan/harbor-atlas-v3.png). Two transparent square cells contain a weathered wooden T-shaped pier and a rowing boat. Generated with the building atlas as a style reference, using the built-in ImageGen tool. Native SVG crops and rotates each harbor to follow the coastline; the boat sits beside the pier with a mooring line.
- Resource pictograms are original filled SVG in [components/catan/resource-icon.tsx](../../components/catan/resource-icon.tsx), shared by inventory, cards, costs, trading, placement previews and harbor badges. Wood is stacked logs, clay terracotta bricks, wool a sheep, grain wheat ears, and ore mineral rocks.
- Earlier v2 files are retained as source references and are no longer loaded by the board or precached.

## Terrain atlas v3 prompt

Use case: stylized editorial board-game illustration, asset edit.
Transform this exact six-scene landscape atlas into a HAND-PAINTED GOUACHE terrain atlas for a refined tabletop island game. Preserve the exact edge-to-edge 3-column by 2-row layout and subject order. Each cell remains square with no gutters or borders: top row forest, sheep pasture, golden wheat field; bottom row terracotta clay quarry, gray mountain peaks, sandy dunes. Preserve overhead slightly oblique aerial composition, natural proportions, muted earth colors and all six recognizable resource environments.
CHANGE THE RENDERING SUBSTANTIALLY: this must visibly look like an artist's painted illustration, with broad shaped brushstrokes, simplified clustered foliage, expressive layered gouache color, soft matte shading and subtly visible brush texture. Reduce photographic micro-detail by at least half. No individual photographic tree needles or camera-like surface textures. Trees should be painted masses with modeled form; sheep should be small painted animals with off-white fleece, dark heads and legs; wheat should have hand-painted grouped stalks and warm broad harvest rows; quarry should have broad painted planes; mountains should have modeled painted facets with organic edges; dunes should have smooth painted ochre curves. Keep moderate volume and believable materials. The realism is midway between a flat vector cartoon and a photograph. Not photorealistic, not a 3D game render, not a flat icon sheet. No heavy outlines, cute toy styling, plastic shine or exaggerated saturation.
Each cell is an independent environment filling its entire square. No sky, horizon, numbers, letters, UI, roads, buildings, boats, coastlines, hexagon outlines or ornaments. The center of each square will receive a small number in code. Output only the complete 3x2 painted atlas in the same aspect ratio as the reference.

## Sea v3 prompt

Use case: hand-painted board-game background, asset edit.
Repaint this water-only image as an artist's GOUACHE sea surface to match a warm, restrained hand-painted terrain board game. Square composition, overhead view, seawater fills every part of the frame. Keep deep muted blue-green and slate-blue water, broad calm currents and gentle short wavelets. Visibly simplify the photographic ripples into layered soft brush marks and subtle matte pigment texture. Midway between a flat cartoon and realism: believable water and soft volume, visibly painted, not a photo or photorealistic render. Restrained highlights, no large bright area. Small soft blue-gray horizontal and diagonal strokes, calm enough behind tiny harbor labels. No black outlines, repeating graphic wave symbols, foam bands, glowing cyan, sky, horizon, shore, land, boats, letters, text, frames or other objects. Output only the painted seawater background.

## Building atlas v3 prompt

Use case: production transparent game sprite atlas.
Create a transparent atlas of EIGHT tiny buildings for the hand-painted island board game illustrated by the reference. Use the reference ONLY for its gouache painting style and muted natural materials; do NOT include any of its terrain or sheep.
EXACT LAYOUT: 4 equal columns by 2 equal rows on a landscape canvas with aspect ratio 2:1, ideally 2048x1024. Each cell is square. Completely transparent background, including between sprites. No painted backdrop, ground rectangle, frames, labels, letters, numbers or dividing lines. Place ONE isolated building sprite at the horizontal center of EACH cell. All eight sprites have their feet aligned to 88% of their cell height.
TOP ROW: four variants of the SAME small settlement: one modest rustic cottage with a single pitched roof, slightly uneven warm off-white plaster and stone walls, wooden door, a few small dark windows, tiny chimney. Cottage occupies about 65% cell width and 60% cell height.
BOTTOM ROW: four variants of the SAME small city: a compact connected group of three or four modest houses, with a taller two-storey central house and lower wings. A secular village complex, no church, no cross, no castle. City occupies about 85% cell width and 76% cell height.
PLAYER COLORS by column, used prominently on the matte tiled roofs and some timber accents:
column 1 warm muted terracotta/coral RED #eb7959,
column 2 dusty medium BLUE #63a9e9,
column 3 warm pale IVORY #eee7d2 (walls slightly darker beige so roof is readable),
column 4 muted mauve PURPLE #b58cdd.
Same camera in every cell: slightly elevated three-quarter orthographic view, front and right walls visible, roof shape clear. Same soft daylight from upper left. A small subtle painted contact shadow immediately at the feet only. Natural building proportions, believable structure, textured plaster, individual broad roof tile brush marks. Shape and player-color roofs must remain legible when reduced to 30 pixels. MID-REALISM gouache illustration with modeled volume, matte shading, soft organic paint edges, painterly detail, not photorealistic, not cute cartoon, not low-poly vector or glossy game tokens. No black outlines. Do not let a sprite cross a cell boundary. Output ONLY the eight building sprites on actual transparent alpha.

## Harbor atlas v3 prompt

Use case: stylized-concept
Asset type: a transparent production sprite atlas for small coastal harbors in a hand-painted island board game.
Input image: style reference ONLY. Match the gouache brushwork, believable matte wood, soft modeled volume, muted warm earth palette and mid-realism of these cottages. Do not include buildings or colored roofs from the reference.
Primary request: Create ONE atlas containing exactly TWO separate sprites, on a canvas with aspect ratio 2:1. Two equal square cells side by side, no gutters or borders. Actual transparent alpha everywhere around the objects, including between the cells. No water background, land, ground plane, text, numbers, frames, checkerboard or extra objects.
LEFT CELL: a small rustic wooden T-shaped landing pier seen from a HIGH overhead view, with just enough slight three-quarter depth to see timber thickness and support posts. Long axis runs horizontally LEFT to RIGHT. The narrow walkway starts near the left edge of the cell at mid-height and extends to a wider cross-platform at the right. Weathered warm gray-brown planks, subdued grain and handmade joints, several short round mooring posts at the platform corners, a small neatly coiled rope near a post. No railing or roof. Entire pier occupies about 88% of cell width and 46% cell height, centered at 50% cell height. Keep every part inside the cell.
RIGHT CELL: one small wooden coastal rowing boat, seen from the SAME high overhead camera, with its long axis running horizontally LEFT to RIGHT and its bow pointing RIGHT. Natural narrow hull, warm honey-brown wood with a softly lighter rim, visibly hollow dark interior, three broad wooden bench seats, one slender wooden oar resting diagonally across the interior. No sail, mast, people, flag or canopy. The boat fills about 82% of cell width and 35% of cell height, centered at the center of its cell. Keep every part inside the cell.
Style: hand-painted gouache with subtly irregular soft brush edges, broad painted material shading, recognizable physical objects. Natural proportions, quiet matte highlights and slightly worn timber. Soft consistent light from upper left. These objects must remain clear at 20–40 pixels wide on a sea background. No flat vector lines, black outlines, cute cartoon exaggeration, plastic toy shine, photographic micro-detail, strong cast shadows or dramatic perspective. A restrained soft contact shadow immediately beneath each object is allowed, with transparency around it. Output ONLY the two isolated painted sprites in the exact two-cell atlas.

## Archived v2 terrain prompt

Use case: photorealistic-natural
Asset type: one production terrain texture atlas for a hexagonal strategy game, not a UI mockup.
Primary request: create ONE exact 3-column by 2-row atlas. Canvas is landscape 1536 by 1024; SIX square cells, each exactly one third of the width and one half of the height. The cells touch with NO gutters, no dividers, no frame, no borders. Absolutely no lettering, numbers, UI, icons, roads, buildings, coastline, or hexagon shapes.
Cell order, read left to right, then top to bottom:
TOP LEFT: a dense temperate forest, overlapping real conifer and broadleaf tree crowns, deep moss green, small sunlit clearings, unmistakably a forest across the entire cell.
TOP MIDDLE: a fresh grassy pasture with about 10 recognizable white sheep grazing in loose small clusters; natural animal proportions, black faces, short realistic legs, organic meadow ground with subdued grass variations. Sheep large enough to recognize after this cell is reduced to 100 pixels wide.
TOP RIGHT: a mature golden wheat field, densely packed ears of wheat with gently curving harvest rows, several visible larger foreground wheat heads, unmistakably agricultural wheat, soft warm ochre.
BOTTOM LEFT: exposed red-brown clay hills and a terraced clay quarry, earthy sediment layers and natural rock textures, no machinery, copper and terracotta brown.
BOTTOM MIDDLE: rugged gray mountain peaks, layered rock, a little snow on the highest ridges, blue-gray shadows, mountain terrain fills the whole square, no sky or horizon.
BOTTOM RIGHT: sandy desert dunes, natural wind-rippled sand, pale tan and ochre, sparse dry scrub, no buildings.
Style: naturalistic miniature landscape photography / realistic terrain render with tactile detail, muted earth colors, diffuse daylight, subtle shadows. The SAME high overhead slightly oblique orthographic aerial perspective for every cell. Consistent scale, lighting and realistic materials. Each square is a complete independent terrain environment extending edge to edge, recognizable at small sizes. Terrain fills each entire square without empty central space. Subjects may occur near square edges; the center will have a small numeric game label added in code.
Avoid: cartoon, comic drawing, vector art, black outlines, graphic triangles for mountains, plastic surfaces, fluorescent colors, decorative motifs, any text or labels, any game board, excessive contrast, hazy blur. Output the atlas only.

## Archived v2 sea prompt

Use case: photorealistic-natural
Asset type: one square ocean surface background texture for a naturalistic hexagonal island strategy game.
Primary request: overhead aerial view of calm open sea, water only from edge to edge, no horizon or shore. Muted dark blue and blue-green water with realistic fine ripples, broad soft underwater tonal variations and a few gentle natural light reflections. The surface must visibly read as seawater when used behind a game map, while remaining calm enough for small harbor labels.
Style/medium: realistic high resolution water texture, natural diffuse daylight, restrained contrast, matte look.
Composition: square image, homogeneous edge-to-edge texture, suitable for tiling, no distinct focal object or large bright patches. Small soft wavelets, subtly diagonal currents.
Avoid: cartoon, illustration outlines, graphic wave symbols, foam stripes, stormy water, boats, land, text, logos, hexagons, glowing turquoise, deep black corners, dramatic specular glare. Output the water texture only.
