# Catan refinement: browser performance QA

The comparison uses frozen production bundles of `tests/fixtures/catan-ux.tsx`, their Catan/detail stylesheets and their active raster files. Both snapshots share the exact compiled global stylesheet. The original snapshot was frozen before implementation, from commit `2b06dca`; no live rebuild can change it.

## Repeat the comparison

Build once to provide the compiled global CSS, then freeze the original before making changes:

```sh
node tests/catan-refinement-performance.mjs freeze baseline
node tests/catan-refinement-performance.mjs measure baseline
# Implement and verify the refinement, then freeze its completed files.
node tests/catan-refinement-performance.mjs freeze final
node tests/catan-refinement-performance.mjs measure final
node tests/catan-refinement-performance.mjs compare baseline final
```

Frozen snapshots cannot be overwritten. Use a new snapshot name when testing a revised candidate. Reports and normal/fullscreen screenshots are saved under `.wrangler/catan-refinement/`; `serve baseline 3004` exposes a frozen fixture for visual inspection. Run browser samples without concurrent tests or build/export work.

## Method and acceptance

- Chromium headless, normal motion, 390 × 844 with touch/coarse-pointer emulation and 1440 × 1000 with a fine pointer; DPR 1 in both cases.
- Three six-second samples per viewport and scenario: idle; five zoom/drag/zoom-out cycles; five open/scroll/close cycles of the long history menu. Each sample starts from the same fixture after an 800 ms settle period.
- The menu workload explicitly enters “Spielverlauf”, asserts a scrollable history on every opening, resets its scroll position and verifies that the wheel scrolls it. Merely opening the short overview page does not satisfy this workload.
- Before loading either bundle, the browser supplies the same sequential UUIDs and seeded `Math.random`. Game IDs seed atmosphere/ambient routes; the comparison asserts that every corresponding sample uses the same game ID.
- Reports contain rAF interval median/p95, estimated dropped frames, and Long Task count/total/maximum. Estimated drops use the observed median refresh interval; they do not represent hardware GPU present counters.
- Median results across the three runs fail if at least two final runs exceed the original median by `max(1 ms, 5%)` for durations. Dropped-frame percentage and Long Task count use 5% relative tolerance without an added absolute timing allowance. The gate also checks the exact browser/canvas environment, image request count, image dimensions and compressed image bytes.
- Existing sea renderer regression tests cover the 30 fps draw limit and high-density mobile/desktop pixel budgets. This browser comparison verifies that one ready sea canvas stays within those budgets.

## Environment limits

This machine runs Chromium 153.0.8010.12 through ANGLE/SwiftShader, a software WebGL renderer. The phone-size case is desktop browser emulation, with scripted mouse gestures against the same camera handlers. No physical phone or mobile GPU was connected. The comparison checks regressions in this reproducible environment; a real-device check is still needed to confirm performance on a particular phone.

Preliminary measurements were discarded after concurrent browser QA was identified and review caught missing navigation into the long history. The accepted baseline is the complete repeat with isolated workloads, the asserted history scroll and deterministic game/ambient seeds.

## Recorded result

The corrected deterministic comparison passed on 2026-10-13. Values below are the medians of the three runs for each scenario; arrows show original → refined.

| Viewport | Scenario | Frame median (ms) | Frame p95 (ms) | Estimated drops (%) | Long Task count |
|---|---|---|---|---|---|
| 390 × 844 | Idle | 16.70 → 16.70 | 16.80 → 16.70 | 0.00 → 0.00 | 0 → 0 |
| 390 × 844 | Pan/zoom | 16.70 → 16.70 | 16.70 → 16.70 | 0.00 → 0.00 | 0 → 0 |
| 390 × 844 | History open/scroll | 16.70 → 16.70 | 16.80 → 16.80 | 0.28 → 0.00 | 0 → 0 |
| 1440 × 1000 | Idle | 16.70 → 16.70 | 16.70 → 16.80 | 0.00 → 0.00 | 0 → 0 |
| 1440 × 1000 | Pan/zoom | 16.70 → 16.70 | 16.70 → 16.80 | 0.00 → 0.00 | 0 → 0 |
| 1440 × 1000 | History open/scroll | 16.70 → 16.70 | 16.70 → 16.70 | 0.00 → 0.00 | 0 → 0 |

All 18 final samples recorded zero Long Tasks. One accepted baseline desktop-idle run recorded a 74 ms Long Task and three estimated dropped frames (0.84%); the other two runs recorded zero. That outlier remains in the evidence and the comparison uses the specified three-run medians.

Initial image loading stays at 13 requests for 13 unique images. Their compressed bytes decrease from 16,355,796 to 15,170,212. The four replaced raster assets decrease from 5,877,814 to 4,692,230 bytes (20.17%), with unchanged dimensions. Browser, renderer, DPR, pointer mode and seeded game identifiers match. Each viewport keeps one sea canvas and the same backing buffer: 366 × 694 for the phone-size case and 1016 × 850 for desktop.

Full per-run measurements, asset hashes/dimensions and comparison gates remain in `.wrangler/catan-refinement/{baseline,final}/measurements.json` and `.wrangler/catan-refinement/comparison.json`. Representative original/refined island and menu screenshots are saved beside each report for normal and fullscreen layouts.

## Functional and visual regression checks

- `npm run lint` passed; `npm test` passed all 531 tests.
- Glass QA passed and produced 105 screenshots. Menu and layout browser suites passed at 320 × 568, 390 × 844, 844 × 390 and 1440 × 1000, including normal/fullscreen layouts and 200% text.
- Final screenshots were reviewed; building roofs, preserved alpha footprint and atlas placement were verified.
