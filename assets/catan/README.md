# Catan artwork

The current v3 terrain, sea, building and harbor artwork was generated with the built-in ImageGen tool on 2026-10-01. The v1 robber was generated with the same tool on 2026-10-02, using the building atlas as its style reference. The v2 robber is an ImageGen edit of v1 from the same day, with a bright gold sack and warm highlights for contrast against its grayed field. The artwork uses gouache illustration with natural proportions and visible brushwork, between flat vector art and photorealism. No external stock assets are used. The original generation prompts below document the requested designs; the table lists the actual files and dimensions.

## Current assets

| Asset | File | Dimensions | Layout and use |
| --- | --- | --- | --- |
| Terrain | [terrain-atlas-v3.jpg](../../public/catan/terrain-atlas-v3.jpg) | 1536 × 1024 | Six square cells in a 3 × 2 grid: wood, wool, grain / brick, ore, desert. |
| Sea | [sea-v3.jpg](../../public/catan/sea-v3.jpg) | 1254 × 1254 | One square texture covering the map viewport, shared by the animated sea and static fallback. |
| Buildings | [buildings-v3.png](../../public/catan/buildings-v3.png) | 1774 × 887 | Transparent 4 × 2 atlas: settlements above cities; columns are coral, blue, ivory and purple. |
| Harbor piers | [harbor-atlas-v3.png](../../public/catan/harbor-atlas-v3.png) | 1774 × 887 | The left transparent cell supplies the weathered T-shaped pier; the original right-hand boat remains a source reference. |
| Directional boats | [boats-directions-v1.png](../../public/catan/boats-directions-v1.png) | 1536 × 1024 | Transparent 3 × 2 atlas: newly painted views facing right, lower-right, lower-left / left, upper-left, upper-right. |
| Robber | [robber-v2.png](../../public/catan/robber-v2.png) | 1254 × 1254 | One transparent full-body person with a dark hooded cloak, warm rim highlights and a luminous gold sack with coins. |
| Ambient sprites | [ambient-atlas-v1.png](../../public/catan/ambient-atlas-v1.png) | 1448 × 1086 | Transparent 4 × 3 atlas; two poses each for gull, woodland bird, butterfly, dolphin, sheep and pedestrian. |
| Wildlife | [wildlife-atlas-v1.png](../../public/catan/wildlife-atlas-v1.png) | 1254 × 1254 | Transparent 4 × 4 atlas: paired doe, stag, fox, boar, fire salamander, common toad and newt poses; the last two cells are empty. |
| Field and forest wildlife | [field-forest-wildlife-v1.png](../../public/catan/field-forest-wildlife-v1.png) | 1254 × 1254 | Transparent 4 × 4 atlas: paired hare, field mouse, pheasant, red squirrel, badger and hedgehog poses; the last row is empty. |
| Clean pasture | [pasture-v1.png](../../public/catan/pasture-v1.png) | 1254 × 1254 | Sheep-free meadow matching the v3 pasture; independent sheep sprites are added on top. |

Terrain and sea were encoded as JPEG at quality 85, retaining their source dimensions. Buildings and harbors retain PNG alpha for compositing over the board. The terrain and sea are painterly edits of the v2 images; buildings used the v3 terrain as a style reference, and harbors used the building atlas.

[landscape.tsx](../../components/catan/landscape.tsx) selects atlas cells with native SVG view boxes. [board.tsx](../../components/catan/board.tsx) clips terrain to hexagons, places buildings and aligns harbors with the coastline. Roof colors identify ownership; a native SVG mooring line joins each boat to its pier. Resource pictograms are original filled SVG in [resource-icon.tsx](../../components/catan/resource-icon.tsx), shared by inventory, cards, costs, trading, placement previews and harbor badges: stacked logs, terracotta bricks, a sheep, wheat ears and mineral rocks.

All current assets are precached by the [service worker](../../public/sw.js) for offline play after the app has been loaded online. Earlier [terrain-atlas-v2.jpg](../../public/catan/terrain-atlas-v2.jpg), [sea-v2.jpg](../../public/catan/sea-v2.jpg) and [robber-v1.png](../../public/catan/robber-v1.png) remain as source references in `public/catan/`; the board no longer loads them and the service worker does not precache them.

The robber is drawn at 40 × 40 board units at (x − 20, y − 29), horizontally centered and close to the middle of its field. Only the occupied landscape is fully desaturated and darkened to 74% brightness; its terrain detail remains visible. Its number moves below the character to y + 29 and uses light ink with a stronger dark stroke, including on grain. The desert label receives the same contrast treatment. A dedicated SVG layer follows buildings and construction effects, and allows pointer events to pass through to the field and placement targets. Moving the robber restores the old field's normal colors automatically.

## Living island and action details

The ambient sprites and clean pasture were created with the built-in ImageGen tool on 2026-10-02, using the v3 terrain and buildings as style references. They retain the matte gouache palette and alpha for sprite compositing. Originals are preserved; the v3 wool tile remains a fallback if either the clean pasture or ambient sprite atlas cannot load. Both replacement images must finish loading before independent sheep replace the painted sheep. Both new files are precached for offline play.

The sprite atlas has twelve equal square cells in row-major order: gull wings raised/lowered, woodland bird wings raised/lowered; butterfly open/closed, dolphin swimming/jumping; sheep grazing/head raised, pedestrian stepping left/right. SVG view boxes select the cells without separate image requests. All movement uses board coordinates and follows the existing camera.

One shared scheduler runs gulls, birds, butterflies, dolphins, sheep, pedestrians, smoke, wildlife and feathered wind patches. At most three transient scenes run on desktop and two below 640px; a breeze is separately limited to two fields. Dolphins use sampled water-only paths with clearance for the entire sprite, coastline, harbor labels, actual boat positions and jump. Valid routes are selected across compass sectors around the island. The fitted board leaves 32 units of water padding. Pedestrians traverse complete connected roads of one owner, including junctions and branches, at a steady pace; their duration follows the route length. They prefer an owned house at a road endpoint as their starting point and may choose an intermediate owned house as their destination. Each first encounter has a 25% stopping chance; otherwise the full route continues. At the destination, they stand still for 1.2 seconds before disappearing. Hidden, disabled and reduced-motion views stop scheduling and remove moving scenes. Game actions and camera interaction take priority. The “Lebendige Insel” preference is stored on the device; static sheep remain part of the landscape. Boats rock through ±5° and four vertical units; the boat and mooring line share their phase and 5.5–7.5-second period, while the line's pier anchor remains fixed. The existing sea shader adds at most ±1.5% slow brightness variation when ambience is enabled.

Visibility was increased on 2026-10-03: gulls are 28 board units, woodland birds 24, dolphins 40, sheep 18 and pedestrians 26. Flying birds are no longer clipped to a single terrain hex; numbers and play markers remain above the scenery. Sheep walk 12–14 units and turn back, with more visible steps and grazing poses. Short, fixed-time entrances keep long walks visible from their first junction; sheep return directly to their resting sprite without a fading gap. Pedestrians render above confirmed road lines and below buildings, with stronger contrast and at least seven seconds per walk, even on a single starting road.

| Scene | First idle appearance | Repeat interval |
| --- | --- | --- |
| Gull | 2–4 seconds | 10–18 seconds |
| Woodland bird | 5–8 seconds | 12–24 seconds |
| Butterfly | 6–10 seconds | 12–24 seconds |
| Dolphin | 7–12 seconds | 18–32 seconds |
| Sheep | 1–3 seconds | 6–12 seconds |
| Pedestrian | 1–2 seconds | 8–14 seconds |
| Smoke | 3–5 seconds | 6–10 seconds |
| Wind | 8–12 seconds | 16–28 seconds |
| Ore wildlife | 6–12 seconds | 16–28 seconds |
| Clay wildlife | 6–12 seconds | 16–28 seconds |
| Wheat wildlife | 6–12 seconds | 16–28 seconds |
| Forest wildlife | 6–12 seconds | 16–28 seconds |

Intervals may be delayed by the scene budget or an active game effect. Waiting kinds retain their original deadlines so frequent birds cannot repeatedly displace walkers or wildlife. A route longer than its repeat interval finishes before another walk is scheduled. Reduced motion and the island switch stop the additional animations rather than replaying a backlog later.

Settlement and city smoke begins at the painted chimney, accounting for the building artwork's vertical offset. Three puffs rise over a 4.5-second scene, staggered by 700 milliseconds, with a slightly stronger opacity for visibility against the terrain.

The directional boats and wildlife were generated with the built-in ImageGen tool on 2026-10-03. Boat views change the physically painted heading under a fixed camera and light, so the north-facing boats show the nearer stern correctly. The pier follows its coastal edge's outward normal; a separate, upright 44-unit boat sprite selects the matching view. [catan-harbor.ts](../../lib/catan-harbor.ts) jointly places all boats in stable coastal order, protecting each full rocking sprite against every land hex, harbor label and other vessel, including independent motion phases. A sea mask additionally excludes all land pixels, and camera bounds include the full boat motion. Public ownership or reordered transport snapshots do not change a vessel's position. Harbor anchor and exchange rate use the accessing player's color, with a 50/50 split for two owners; specialized resource icons retain their terrain color. Separate flags are no longer drawn.

Ore fields host doe deer, stags, foxes and wild boars; clay fields host fire salamanders, common toads and newts. Wheat fields additionally host brown hares, field mice and pheasants; forests host red squirrels, badgers and hedgehogs alongside the existing woodland birds. The field and forest atlas was generated with the built-in ImageGen tool on 2026-10-03, using the existing wildlife atlas as its style reference. All six species have two walking poses. Matched square badger crops include the whole nose while excluding neighboring sprites. Short walking or hopping routes protect each complete sprite rectangle, including movement, against the hex boundary and an 18-unit number clearance. A robber on the field prevents these scenes. All four wildlife groups share the existing scene budget and visibility/reduced-motion controls, and both atlases are precached for offline play.

Confirmed optional notification metadata drives roll highlights, robber travel, private card reveals and award handovers. Old saved games fall back to confirmed snapshot differences. Restore/reconnect baselines consume earlier effects. Resource receipts preserve separate gross +N and −N badges, while the total reflects the net change. The field numbers and play markers are drawn above the ambient layer.

### Ambient sprite prompt

Use case: stylized-concept. Create one transparent production sprite atlas matching the v3 terrain/buildings’ matte gouache brushwork, natural proportions, muted colors and upper-left light. Exactly four equal square columns by three rows, no visible grid or gutters. Twelve isolated subjects with transparent margin and matching body centers/scales between paired poses: white coastal gull wings lifted/lowered; charcoal woodland bird wings lifted/lowered; ochre butterfly wings open/folded; slate-gray dolphin swimming/jumping; off-white dark-faced sheep grazing/head raised; neutral brown medieval villager left/right walking step. Subjects face right except the butterfly viewed from above. No scenery, ground, text, labels, weapons or extra subjects. Preserve real transparency.

### Clean pasture prompt

Use case: precise-object-edit. Use only the top-middle pasture of the v3 terrain atlas as the target. Preserve its grassland composition, olive/moss palette, gouache brushwork, flowers, shrubs, trees and lower-middle rocks. Remove every sheep and fill the removed areas with matching grass and flowers. Output one opaque square, edge-to-edge pasture tile, retaining the perspective and lighting. No animals, people, text, labels, fences, buildings, roads or borders.

### Directional boats prompt

Reference: `harbor-atlas-v3.png`; built-in ImageGen with transparent background.

Use case: stylized-concept
Asset type: transparent directional sprite atlas for a Catan-style board game, exactly 3 columns × 2 rows, six equal square cells.
Primary request: Draw SIX newly rendered views of the SAME small weathered wooden rowing boat, matching the painterly realistic game-asset style of the boat in reference image 1. The reference is a style/identity guide; do not copy or rotate its pixels.
Subject: empty old wooden rowboat with three cross benches and one oar resting inside, warm honey-brown planks, dark hull interior, readable clear outline.
Composition: Camera stays fixed, elevated three-quarter board-game camera looking downward at approximately 55 degrees, consistent gravity and top-left lighting for ALL SIX views. Change the physical boat's heading in 3D between cells, so front/back/near/far hull sides are correctly redrawn. The cells' screen-facing bow headings, in row-major order, are: right (0 degrees), lower-right (60 degrees), lower-left (120 degrees), left (180 degrees), upper-left (240 degrees), upper-right (300 degrees). In the upper-facing cells the nearer stern rim must be visible and the bow recedes; the boat must never look like a sideways-rotated flat sticker. Each boat fits comfortably inside its square cell, centered at the exact cell center, same physical boat scale, maximum painted width or height about 76% of the cell, at least 12% clear transparent padding on every edge. Cell layout is a perfect uniform 3 by 2 grid, square cells, canvas aspect 3:2.
Background: genuine alpha transparency across all empty space, no water, no shoreline, no pier, no rope, no drop shadow, no ground.
Constraints: only the six boat sprites, no text, no captions, no labels, no borders, no grid lines, no logos, no extra objects or people. Maintain the same boat identity, wood color, bench arrangement, oar, camera elevation and global lighting across every cell.

Layout correction (same tool, generated sheet as edit target):

Use case: precise-object-edit
Edit target: the generated six-view rowing-boat sprite sheet from the previous image. Preserve each boat's freshly rendered perspective, design, wood color, oar, and fixed upper-left lighting.
Change ONLY layout and transparent margins: use an EXACT uniform 3-column by 2-row grid of six equal SQUARE cells on a 3:2 canvas. Center each of the six boat sprites at its own cell center. Reduce the boats so every sprite has its ENTIRE painted and alpha-visible content strictly inside its cell, no overlap with neighboring cells, minimum 15% completely clear padding on ALL four sides. Especially reduce the horizontal boats which currently cross their cell boundaries. The maximal width OR height of every sprite must be 70% of a cell, and all boats should represent equal physical scale. Row-major views remain right, lower-right, lower-left, left, upper-left, upper-right.
Background: completely transparent alpha=0 outside the six isolated boats. No brown atmosphere, no shadow, no ground, no water, no cell borders, no text. All nonboat pixels must be fully clear.

### Wildlife prompt

Reference: `ambient-atlas-v1.png`; built-in ImageGen with transparent background.

Use case: stylized-concept
Asset type: transparent wildlife sprite atlas for a painterly Catan-style digital board game. EXACT 4 columns × 4 rows of sixteen equal SQUARE cells, square canvas.
Primary request: Generate natural-looking little animal game sprites in the same matte gouache, warm earthy, softly modeled style as reference image 1. The reference is a style guide only; do not include its birds, sheep, dolphins, butterflies or people.
Camera: fixed elevated three-quarter view looking down at every animal, heads pointing toward screen right, consistent upright gravity and soft upper-left lighting. Small crisp silhouettes readable at game scale, restrained natural colors, no black outline.
Exact ROW-MAJOR grid contents: row1 cell1 doe deer standing/walking step A (no antlers), cell2 SAME doe step B, cell3 red deer stag with modest branched antlers walking step A, cell4 SAME stag step B. Row2 cell1 red fox walking step A, cell2 SAME fox step B, cell3 sturdy brown wild boar walking step A, cell4 SAME boar step B. Row3 cell1 black-and-yellow fire salamander walking step A, cell2 SAME salamander step B, cell3 earthy brown common toad crouched, cell4 SAME toad in a short lifted hopping pose. Row4 cell1 olive-brown smooth newt walking step A, cell2 SAME newt step B, cells3 and4 MUST BE COMPLETELY EMPTY TRANSPARENT.
Layout: each animal is isolated and centered in its exact cell, including all antlers, feet and tail. Keep at least 15% completely transparent padding on ALL FOUR edges of every cell; no animal can touch a grid boundary or neighbor. Maximum painted width OR height 70% of a cell. Pair poses identical physical scale and identity with only legs/body motion changed.
Backdrop: genuine transparent alpha, nothing except the fourteen animal cutouts. No rocks, grass, soil, scenery, water, shadow, atmospheric background, labels, cell lines, text, caption, logo or watermark.

### Field and forest wildlife prompt

Reference: `wildlife-atlas-v1.png`; built-in ImageGen with transparent background. Final generation prompt:

Use case: precise-object-edit. Asset: production transparent game sprite sheet.
Edit the provided SQUARE 4×4 wildlife atlas, using its exact image layout and clear small sprite spacing as the template. Replace animals, while preserving square canvas dimensions, EXACT 4 columns ×4 rows of equal square cells, all transparent background, right-facing painterly naturalistic style, no labels, no grid lines.
Replace in exact order:
Row1: brown European hare walking A, same hare walking B, brown field mouse walking A, same field mouse walking B.
Row2: common male pheasant walking A, same pheasant walking B, red squirrel walking A, same red squirrel walking B.
Row3: European badger with black-white face walking A, same badger walking B, European hedgehog walking A, same hedgehog walking B.
Row4: all four cells entirely EMPTY TRANSPARENT, no animals at all.
The final image has exactly twelve animals and four empty cells. Each complete sprite including feet, long ears and tails must be SMALL, centered strictly in its square cell, using at most 65% of cell width and height. At least 17.5% fully transparent margin inside EVERY cell edge. Keep pair identity and scale identical, alternating leg poses. ALL animal pixels must stay within these normalized canvas bounds:
row1 y=4.5%..20.5%, row2 y=29.5%..45.5%, row3 y=54.5%..70.5%.
col1 x=4.5%..20.5%, col2 x=29.5%..45.5%, col3 x=54.5%..70.5%, col4 x=79.5%..95.5%.
Match the reference's brushwork, soft natural colors, fixed elevated side camera, upper-left lighting. Each animal is standalone with all background pixels exactly alpha=0. No shadows, floors, scenery, colored edge noise or isolated specks. Output a SQUARE canvas; use the provided square reference layout.

## Continuous sea movement

[sea-background.tsx](../../components/catan/sea-background.tsx) uploads the original sea image as one WebGL texture. A fragment shader applies smooth periodic offsets with a strength factor of **1.8**, bounded by **5.4 native pixels horizontally** and **3.6 vertically**. This is a restrained 20% increase in wave displacement. The wave phase repeats every **4.5 seconds**; `requestAnimationFrame` draws the intermediate movement at the display's animation cadence, preserving the painted details.

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
