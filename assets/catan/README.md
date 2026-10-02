# Catan artwork

The current v3 terrain, sea, building and harbor artwork was generated with the built-in ImageGen tool on 2026-10-01. The v1 robber was generated with the same tool on 2026-10-02, using the building atlas as its style reference. The v2 robber is an ImageGen edit of v1 from the same day, with a bright gold sack and warm highlights for contrast against its grayed field. The artwork uses gouache illustration with natural proportions and visible brushwork, between flat vector art and photorealism. No external stock assets are used. The original generation prompts below document the requested designs; the table lists the actual files and dimensions.

## Current assets

| Asset | File | Dimensions | Layout and use |
| --- | --- | --- | --- |
| Terrain | [terrain-atlas-v3.jpg](../../public/catan/terrain-atlas-v3.jpg) | 1536 × 1024 | Six square cells in a 3 × 2 grid: wood, wool, grain / brick, ore, desert. |
| Sea | [sea-v3.jpg](../../public/catan/sea-v3.jpg) | 1254 × 1254 | One square texture covering the map viewport, shared by the animated sea and static fallback. |
| Buildings | [buildings-v3.png](../../public/catan/buildings-v3.png) | 1774 × 887 | Transparent 4 × 2 atlas: settlements above cities; columns are coral, blue, ivory and purple. |
| Harbors | [harbor-atlas-v3.png](../../public/catan/harbor-atlas-v3.png) | 1774 × 887 | Two transparent square cells: a weathered wooden T-shaped pier and a rowing boat. |
| Robber | [robber-v2.png](../../public/catan/robber-v2.png) | 1254 × 1254 | One transparent full-body person with a dark hooded cloak, warm rim highlights and a luminous gold sack with coins. |

Terrain and sea were encoded as JPEG at quality 85, retaining their source dimensions. Buildings and harbors retain PNG alpha for compositing over the board. The terrain and sea are painterly edits of the v2 images; buildings used the v3 terrain as a style reference, and harbors used the building atlas.

[landscape.tsx](../../components/catan/landscape.tsx) selects atlas cells with native SVG view boxes. [board.tsx](../../components/catan/board.tsx) clips terrain to hexagons, places buildings and aligns harbors with the coastline. Roof colors identify ownership; a native SVG mooring line joins each boat to its pier. Resource pictograms are original filled SVG in [resource-icon.tsx](../../components/catan/resource-icon.tsx), shared by inventory, cards, costs, trading, placement previews and harbor badges: stacked logs, terracotta bricks, a sheep, wheat ears and mineral rocks.

All four v3 files and the v2 robber are precached by the [service worker](../../public/sw.js) for offline play after the app has been loaded online. Earlier [terrain-atlas-v2.jpg](../../public/catan/terrain-atlas-v2.jpg), [sea-v2.jpg](../../public/catan/sea-v2.jpg) and [robber-v1.png](../../public/catan/robber-v1.png) remain as source references in `public/catan/`; the board no longer loads them and the service worker does not precache them.

The robber is drawn at 40 × 40 board units at (x − 20, y − 29), horizontally centered and close to the middle of its field. Only the occupied landscape is fully desaturated and darkened to 74% brightness; its terrain detail remains visible. Its number moves below the character to y + 29 and uses light ink with a stronger dark stroke, including on grain. The desert label receives the same contrast treatment. A dedicated SVG layer follows buildings and construction effects, and allows pointer events to pass through to the field and placement targets. Moving the robber restores the old field's normal colors automatically.

## Continuous sea movement

[sea-background.tsx](../../components/catan/sea-background.tsx) uploads the original sea image as one WebGL texture. A fragment shader applies smooth periodic offsets with a strength factor of **1.5**, bounded by **4.5 native pixels horizontally** and **3 vertically**. The wave phase repeats every **4.5 seconds**; `requestAnimationFrame` draws the intermediate movement at the display's animation cadence, preserving the painted details.

The shader shares its size and camera offsets with the CSS background. [catan-parallax.ts](../../lib/catan-parallax.ts) uses a 0.20 parallax factor based on the fitted board scale, constrains the offset to keep the viewport covered and expands image coverage during zoom. The drawing buffer accounts for device pixel density up to 2× and targets a 1.5-million-pixel budget, without dropping below the viewport's CSS resolution.

The animation pauses when the island or document is hidden. The JPEG remains visible while the WebGL texture loads or if WebGL is unavailable; context restoration reinitializes the animation. With reduced motion enabled, [catan.css](../../app/catan/catan.css) hides the canvas and centers a static sea background, disabling both wave movement and camera parallax.

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

## Robber v2 edit prompt

Reference: [robber-v1.png](../../public/catan/robber-v1.png). Tool: built-in ImageGen, transparent background.

Edit the provided transparent Catan board-game robber sprite. Preserve its handmade gouache painting style, full-body hooded person, simple readable silhouette, slightly elevated three-quarter perspective, dark charcoal cloak, and transparent background. This is a tiny game piece displayed about 40 pixels wide against a desaturated, moderately darkened landscape. Make the figure much easier to recognize at that size: replace the dull brown bag with a prominent warm golden ochre money sack with a visible cluster of bright gold coins at its opening, painted yellow-gold highlights and a gentle warm luminous glow immediately around the sack. Make the sack a little larger so its gold area is clearly readable at tiny size. Add restrained warm ivory and ochre rim highlights along the hood, shoulders and cloak folds to separate the dark human silhouette from gray terrain. Keep the human face simple, recognizable and softly lit. Preserve the dark cloak as the main body color, natural human proportions and the existing calm standing pose. Maintain softly textured opaque gouache strokes with clear edges. Keep all of the person, feet and sack inside the square canvas, with only a narrow transparent margin. No scenery, floor, pedestal, text, letters, icons, border, frame, weapon, additional person, giant glow aura or scattered particles. The final output must be one isolated full-body robber with a bright painted gold sack on a truly transparent background.

## Archived robber v1 prompt

Use case: stylized-concept.
Asset type: one transparent production character sprite for a hand-painted island board game, displayed at 20–32 pixels.
Primary request: a recognizable human robber wearing a dark charcoal hooded cloak and carrying a small worn brown cloth loot bag in one hand.
Input image: style reference ONLY. Match the reference cottages' gouache brushwork, natural proportions, warm muted colors, matte materials and soft light from upper left. Do not include any building or terrain.
Subject: ONE standing adult robber, full body, hood framing a partly visible face, simple tunic, leather boots, and clearly separate bag. A restrained medieval traveler / bandit look. Believable human proportions, not a pawn, letter, emoji, cute cartoon, or photorealistic person.
Composition: square canvas, completely transparent alpha background. Center the figure horizontally. The full figure including bag occupies about 72% of the canvas width and 84% of its height, with boots ending at 89% of the canvas height. Keep hood, hands, cloak, bag, and boots entirely inside the canvas. Slightly elevated three-quarter orthographic view matching the cottages.
Style: hand-painted gouache, broad simplified shapes and soft irregular paint edges, modeled matte volume. Use warm charcoal-gray cloth with taupe highlights along the hood and shoulders so the silhouette reads clearly over dark green forest as well as pale dunes. Avoid large areas of flat pure black. One small soft painted contact shadow immediately beneath the boots is allowed.
Constraints: clean real transparency everywhere around the single person, including around the bag. No ground patch, landscape, scenic background, floor, buildings, circle, badge, outline border, letters, numbers, labels, watermarks, weapons, extra characters or duplicate sprites. Output only this one isolated painted robber.

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
