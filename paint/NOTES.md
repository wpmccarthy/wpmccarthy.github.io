# Paint system: working notes

Context for picking this work up again. How to *use* it is in the main README
("Paint"); this file covers the design, the decisions so far, and the gotchas.

## The idea

- The home page is a raw linen canvas (the existing fabric background). Each note is a
  soft rectangle of oil paint staining it, like a Rothko-style colour field.
- Stains are generated from a seed: all different, but identical for every visitor.
  They're rendered at build time, not in the browser.
- Colour should feel rich: several pigments per stain, with a controlled bleed where
  pigments separate at the edge, as real pigments do.
- Stains are translucent. Where neighbours' bleeds overlap, the colours interact.
- Opening a note shows its stain as the ground the text is written on.
- Longer notes have taller stains.
- Phones: a vertical stack that keeps each tile's relative size and sideways
  position, with the bleeds overlapping.
- The author wants a lot of control: choose colours, preview seeds, and arrange
  tiles by hand.

## Decisions made while iterating (keep these)

- **Shapes are plain soft rounded rectangles.** Wobble, tilt and streak were tried and
  removed. The author didn't like shapes defined by wobble; keep shapes simple. The
  only edge irregularity is per pigment: `ragged` and `wick` (0 = clean edge).
- **Granulation removed.** It also made the PNGs much heavier.
- **Mottle scale starts at 3** (the author liked it there); the studio slider runs 3–12.
- **Presets are data, not code:** `paint/settings.json` holds presets and the
  `defaultPresets` pool. Notes without a `paint:` block take a preset from the pool,
  chosen by a hash of the filename, plus a seed from the same hash.
- **Notes link to presets when unchanged.** Saving a note whose look matches a
  preset writes only `preset:` and `seed:`, so later edits to the preset reach it.
- **Layout lives in `place: { x, y, w, text }`:** board units (100 = board width) on
  both axes. `text` is the title corner (top-left by default).
- **Header spans the wide frame on every page** (site name far left, menu far right);
  reading content sits in a 43.5rem `main` column, 54rem on opened notes (`body.note`;
  keep `WIDE` in paint/eleventy.js in step). The home page's `main` is full width.
- **Tile shape is `paint.tall`** (core height ÷ width). Without it, the shape is
  `tallFromWords()`. Arrange mode's resize handle and the studio's "Height ÷ width"
  slider both edit it.

## How it works

| File | Role |
| --- | --- |
| `paint/render.js` | Isomorphic renderer (build and studio both use it). Per pixel: rounded-box SDF per pigment, soft edge, tideline, perimeter variation, thread wicking, mottle; Beer–Lambert absorption across pigments; output RGBA that reproduces the transmittance under `mix-blend-mode: multiply`. |
| `paint/params.js` | Field meanings, `resolvePaint()` (note → full params), preset matching, ink choice, front-matter shape. Takes settings via `useSettings()`. |
| `paint/settings.json` | Presets and the default pool, edited by the studio and fine to edit by hand. |
| `paint/eleventy.js` | `paintInfo` computed data; renders PNGs after each build (cache: `.cache/paint/<hash>.png`, URL includes the hash); dev-only `/__paint/*` endpoints that write front matter and settings. |
| `paint/board.js` | Home layout and auto-placement for notes without `place` (cores must not touch; only bleeds overlap). |
| `paint/png.js` | Tiny PNG encoder (zlib), so there are no image dependencies. |
| `studio/` | `/studio/` and the homepage arrange mode. They exist only under `npm start`. |
| `css/style.css` | "Paint" section: board, tiles, phone stack, `.post.painted` ground, Notes-page thumbnails. |
| Homepage hover | Each tile is two images: all pigments but the last (`tile-base`), and the last alone (`tile-top`, rendered with `renderStain`'s `layers` option so its texture is unchanged; multiplied together they equal the full tile). On hover, CSS slowly scales the top layer (≈ more spread: the same number of units added on every side) and blurs it (≈ softer edge), then springs back on leave. Amounts: `"hover": { "spread", "soft" }` in `settings.json`; timing in the `.tile-top` rules in style.css. The full tile image is still built for the Notes page thumbnails. |
| `css/canvas.css` | The linen background (wash, scale). Imported by both the site and the studio so previews match; change the background here. It scrolls with the page at a fixed scale (not `fixed`/`cover`), so paint stays stuck to the weave. |

Per note there are three images: the tile, the ground for wide screens and the ground
for phones. Ground shapes are estimated from the Markdown (`estimateTall`) and
stretched to fit the article. `RENDER_VERSION` in render.js is part of the cache
hash: bump it whenever the renderer's output changes.

## Gotchas learned the hard way

- **Nothing between a stain and the page background may create a stacking context.**
  That includes transform, filter, opacity, z-index, `contain` and container queries.
  Otherwise multiply blends against transparency and the linen stops showing through.
  This is why the board uses `--bw` maths, not container query units.
- **Percentage padding and margins resolve against the containing block's width**, not
  the element's own. Tiles use `calc(var(--tw) / 6)`. The ground's `margin: -25%` is
  correct only because its containing block is the article.
- **Eleventy evaluates computed data more than once.** The first pass (`findVarsUsed`)
  passes proxy stand-ins that can put holes in arrays. So `resolvePaint` filters
  pigments, and render jobs are registered from the `paintImages` collection, never
  from computed data.
- **A running `npm start` keeps the old renderer in memory** after `paint/*.js` changes,
  and will cache wrong images under new hashes (this once made every tile render
  twice as dark). After changing the renderer: stop `npm start`, bump
  `RENDER_VERSION`, start it again.
- **Reloading the Eleventy config mid-serve** (editing `.js` under `paint/`) can log
  passthrough "Benchmark" errors. Restart `npm start` if that happens.
- **A failing build serves stale pages.** The studio therefore reads presets from
  `GET /__paint/settings` (the file on disk), not from its page. A preset was lost to
  this once.
- **Headless Chrome screenshots** often catch tiles before their images decode. Tiles
  with light ink then look empty: white text on linen. Check the image URLs before
  assuming a bug.

## Status (2026-10-27)

Working: build-time rendering, home canvas, phone stack, painted note pages, studio
(presets, defaults, variations, per-pigment controls, apply settings to all presets),
and arrange mode (move, resize/shape, text corner). Nothing is committed yet.

Parked experiment: hovering flashed a tile through 4 other seeds (rendered in the
browser by a worker). Too much, so it lives on the `experiment-hover-shimmer` branch;
`git merge experiment-hover-shimmer` brings it back.

Open threads and ideas:
- `notes/placeholders/` holds test notes (some with the author's experimental paint).
  Delete it before publishing; the notes also appear in the RSS feed.
- Weight: PNG tiles are about 200 KB each and long grounds up to about 0.5 MB.
  WebP via `sharp` would cut that about 2.7×, but adds a dependency (not yet agreed).
  All tile images load eagerly.
- Tiles with light ink are invisible until their image loads. A fallback (text
  shadow, or a flat colour behind the core) would fix that if it's noticeable.
- The text corner applies only to home tiles, not to the opened note.
