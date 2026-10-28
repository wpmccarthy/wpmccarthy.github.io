// Paint parameters: presets, defaults and the rules that turn a note's `paint:`
// front matter into a complete set of render params. Shared by build and studio.
//
// Presets and the default pool live in paint/settings.json (the studio edits it; it's
// also fine to edit by hand). Call useSettings() with its contents before resolving.
//
// Pigments are listed bottom to top. Fields (all but `color` optional):
//   color     transmittance at density 1 — the colour a single full-strength coat stains
//   strength  how much pigment: 0.3 is a thin wash, 1 a coat, 2 a heavy pool
//   spread    how far (units) this pigment travels past the core edge; negative stays inside
//   soft      width of the soft edge
//   ragged    irregularity of the edge (0 = a clean soft edge)
//   wick      capillary fingers along the canvas threads beyond the edge
//   tide      0–1, pigment pooling into a darker line just inside the edge
//   mottle    0–1, uneven density across the stain
//   drift     how far this pigment's rectangle is offset (direction comes from the seed)
// Paint-level fields: seed, preset, tall, corner, mottleScale, ink.
// The core is 1000 units wide, so e.g. spread: 80 is 8% of the stain's width.

import { hashString, hexToRgb, PAD } from "./render.js";

export const DEFAULTS = { corner: 40, mottleScale: 3 };

export const PIGMENT_DEFAULTS = {
  strength: 1, spread: 0, soft: 30, ragged: 14, wick: 4, tide: 0.3, mottle: 0.4, drift: 4,
};

let settings = { defaultPresets: [], presets: {} };

export function useSettings(next) {
  settings = next;
}

export function getSettings() {
  return settings;
}

function defaultPool() {
  const pool = (settings.defaultPresets || []).filter((name) => settings.presets[name]);
  return pool.length ? pool : Object.keys(settings.presets);
}

const withDefaults = (pg) => {
  const out = { color: pg.color };
  for (const [key, value] of Object.entries(PIGMENT_DEFAULTS)) out[key] = pg[key] ?? value;
  return out;
};

// Shape: longer notes are taller. ~100 words is landscape, ~1500 is clearly portrait.
export function tallFromWords(words) {
  const t = 0.62 + 0.75 * Math.log10(1 + words / 150);
  return Math.round(Math.min(2, Math.max(0.6, t)) * 100) / 100;
}

/**
 * Turn a note's `paint` front matter (possibly empty) into complete render params.
 * Precedence: the note's own fields, then its preset, then DEFAULTS. With no preset
 * (or one that no longer exists) a note picks from the default pool, and with no
 * seed it gets one; both are derived from `key` (the note's slug), so they're stable.
 */
export function resolvePaint(paint = {}, key = "", words = 0) {
  paint = paint || {};
  const h = hashString(String(key));
  const pool = defaultPool();
  const presetName = settings.presets[paint.preset] ? paint.preset : pool[h % pool.length];
  const preset = settings.presets[presetName] || { pigments: [{ color: "#b0a080" }] };
  // Skip anything that isn't a pigment (Eleventy's first pass over computed data
  // hands in stand-in values that can leave holes in arrays).
  const valid = (list) => (Array.isArray(list) ? [...list].filter((pg) => pg && typeof pg.color === "string") : []);
  const own = valid(paint.pigments);
  const fallback = valid(preset.pigments);
  const resolved = {
    seed: Number.isFinite(paint.seed) ? paint.seed : h % 100000,
    preset: presetName,
    tall: Number.isFinite(paint.tall) ? paint.tall : tallFromWords(words),
    tallAuto: !Number.isFinite(paint.tall),
    corner: paint.corner ?? preset.corner ?? DEFAULTS.corner,
    mottleScale: paint.mottleScale ?? preset.mottleScale ?? DEFAULTS.mottleScale,
    pigments: (own.length ? own : fallback.length ? fallback : [{ color: "#b0a080" }]).map(withDefaults),
  };
  const ink = paint.ink ?? preset.ink;
  if (ink) resolved.ink = ink;
  return resolved;
}

// The look of a set of params, as stored in a preset.
export function presetFromParams(params) {
  const preset = { corner: params.corner, mottleScale: params.mottleScale, pigments: params.pigments.map(withDefaults) };
  if (params.ink) preset.ink = params.ink;
  return preset;
}

// True when params look exactly like their preset (so a note can just reference it).
export function matchesPreset(params) {
  const preset = settings.presets[params.preset];
  if (!preset) return false;
  const a = presetFromParams(params);
  const b = presetFromParams({ ...DEFAULTS, ...preset });
  return JSON.stringify(a) === JSON.stringify(b);
}

// Linen's average colour, for estimating how dark the painted core reads.
const LINEN = [0.86, 0.82, 0.76];

// Approximate colour at the centre of the core (stain × linen), for choosing ink.
export function coreColor(params) {
  const A = [0, 0, 0];
  for (const pg of params.pigments) {
    if ((pg.spread ?? 0) < -400) continue;
    const rgb = hexToRgb(pg.color);
    const dens = (pg.strength ?? 1) * (1 - 0.4 * (pg.tide ?? 0));
    for (let c = 0; c < 3; c++) A[c] += dens * -Math.log(Math.max(rgb[c], 0.003));
  }
  return A.map((a, c) => Math.exp(-a) * LINEN[c]);
}

export const INK_DARK = "rgba(40, 38, 36, 0.9)";
export const INK_LIGHT = "rgba(252, 247, 238, 0.95)";

export function inkFor(params) {
  if (params.ink) return params.ink;
  const [r, g, b] = coreColor(params);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum < 0.33 ? INK_LIGHT : INK_DARK;
}

// Ratio of a whole tile image (core + bleed) — height / width.
export function tileRatio(tall) {
  return (1000 * tall + 2 * PAD) / (1000 + 2 * PAD);
}

/**
 * What to write into a note's front matter. If the look is exactly a preset, only
 * the preset's name is stored, so later edits to that preset reach this note too.
 */
export function paintForFrontMatter(params) {
  const out = { seed: params.seed };
  if (!params.tallAuto) out.tall = params.tall;
  if (matchesPreset(params)) {
    out.preset = params.preset;
    return out;
  }
  return { ...out, ...presetFromParams(params) };
}
