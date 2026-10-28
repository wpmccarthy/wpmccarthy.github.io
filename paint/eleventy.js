// Eleventy side of the paint system:
// - `paintInfo(data)` resolves a note's paint and registers the images it needs;
// - after each build, images are rendered (cached in .cache/paint/) into _site/paint/;
// - when serving locally, /studio/ and the homepage arrange mode can write `paint:` and
//   `place:` back into a note's front matter through two small endpoints.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { renderStain, RENDER_VERSION } from "./render.js";
import { resolvePaint, inkFor, tileRatio, tallFromWords, useSettings, getSettings } from "./params.js";
import { encodePng } from "./png.js";

const CACHE_DIR = ".cache/paint";
const SETTINGS_FILE = "paint/settings.json";
const TILE_WIDTH = 540; // px for the whole tile image (core + bleed)
const GROUND_WIDTH = 560; // px for the opened-note ground (wide screens)
const GROUND_WIDTH_NARROW = 300; // px for the opened-note ground (phones)
// Long notes have tall grounds: cap their pixels, trading edge detail for weight.
const GROUND_MAX_PIXELS = 360_000;

function groundWidth(width, tall) {
  const ratio = (1000 * tall + 500) / 1500;
  return Math.round(Math.min(width, Math.sqrt(GROUND_MAX_PIXELS / ratio)));
}

export const serving = process.argv.includes("--serve") || process.env.ELEVENTY_RUN_MODE === "serve";

// Presets and the default pool. Read with fs (not import) so edits apply on the next
// rebuild without restarting the dev server.
export function loadSettings() {
  const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  useSettings(settings);
  return settings;
}
loadSettings();

// JSON with each pigment on one line, so presets are easy to scan and edit by hand.
function formatSettings(settings) {
  const text = JSON.stringify(settings, null, 2);
  return text.replace(/\{\s*"color"[^{}]*\}/g, (m) => m.replace(/\s*\n\s*/g, " ").replace("{ ", "{ ")) + "\n";
}

function validSettings(settings) {
  const hex = /^#[0-9a-f]{6}$/i;
  return (
    settings && Array.isArray(settings.defaultPresets) && settings.presets && typeof settings.presets === "object" &&
    Object.values(settings.presets).every(
      (p) => Array.isArray(p.pigments) && p.pigments.length && p.pigments.every((pg) => hex.test(pg.color)),
    )
  );
}

// url -> { url, file, params, tall, width }, rebuilt every build
const jobs = new Map();

function readBody(inputPath) {
  const src = fs.readFileSync(inputPath, "utf8");
  return src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function countWords(markdown) {
  return (markdown.match(/[\p{L}\p{N}’']+/gu) || []).length;
}

// Rough height of a rendered note, divided by its width, for one column layout.
// Mirrors the .post.painted styles in css/style.css.
function estimateTall(markdown, title, { width, charsPerLine }) {
  const line = 30.4;
  let h = 48 + 56; // article padding top + bottom
  h += Math.ceil(title.length / (charsPerLine * 0.62)) * 38 + 30 + 32; // h1, meta, gap
  for (const block of markdown.split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text) continue;
    if (/^#{1,6}\s/.test(text)) {
      h += 60 + Math.ceil(text.length / (charsPerLine * 0.8)) * 28;
      continue;
    }
    for (const row of /^\s*([-*+]|\d+\.)\s/m.test(text) ? text.split("\n") : [text]) {
      h += Math.max(1, Math.ceil(row.replace(/\s+/g, " ").length / charsPerLine)) * line;
    }
    h += 20;
  }
  return Math.max(0.6, Math.round((h / width) * 100) / 100);
}

// Wide: a 54rem article with 5rem side padding (css/style.css, body.note main).
const WIDE = { width: 864, charsPerLine: 86 };
const NARROW = { width: 350, charsPerLine: 34 };

// Describe an image (URL named by a hash of everything that affects its pixels).
// Jobs are only queued for rendering from the `paintImages` collection: computed data
// can be evaluated more than once per build, collections see only the final values.
function imageJob(slug, kind, params, tall, width, layers) {
  const { tallAuto, preset, ink, ...renderParams } = params;
  const key = JSON.stringify({ v: RENDER_VERSION, renderParams, tall, width, layers });
  const hash = createHash("sha1").update(key).digest("hex").slice(0, 10);
  return { url: `/paint/${slug}-${kind}-${hash}.png`, file: `${hash}.png`, params: renderParams, tall, width, layers };
}

// Homepage hover: the last pigment is its own image, which CSS grows (spread) and
// blurs (soft edge) while hovered. Scale factors add the same number of units to the
// layer's width and height, like a real increase in spread.
function hoverInfo(params) {
  const hover = { spread: 60, soft: 30, seconds: 6, ...(getSettings().hover || {}) };
  const last = params.pigments.at(-1);
  const hx = Math.max(40, 500 + (last.spread ?? 0));
  const hy = Math.max(40, 500 * params.tall + (last.spread ?? 0));
  const r = (n) => Math.round(n * 1000) / 1000;
  return { sx: r((hx + hover.spread) / hx), sy: r((hy + hover.spread) / hy), soft: hover.soft, seconds: hover.seconds };
}

/** Computed data for a note: everything templates and the studio need about its paint. */
export function paintInfo(data) {
  const inputPath = data?.page?.inputPath;
  if (typeof inputPath !== "string" || !inputPath.endsWith(".md") || !fs.existsSync(inputPath)) return null;
  const slug = data.page.fileSlug;
  const title = String(data.title || "");
  const body = readBody(inputPath);
  const words = countWords(body);
  const params = resolvePaint(data.paint, slug, words);
  const info = {
    slug,
    inputPath,
    words,
    params,
    savedPaint: Boolean(data.paint),
    tallWords: tallFromWords(words),
    ink: inkFor(params),
    ratio: tileRatio(params.tall),
    groundTall: estimateTall(body, title, WIDE),
    groundTallNarrow: estimateTall(body, title, NARROW),
  };
  // Drafts get no images: they're never published, but the studio can still paint them.
  if (data.draft !== true) {
    const tile = imageJob(slug, "tile", params, params.tall, TILE_WIDTH);
    const ground = imageJob(slug, "ground", params, info.groundTall, groundWidth(GROUND_WIDTH, info.groundTall));
    const narrow = imageJob(
      slug, "ground-narrow", params, info.groundTallNarrow, groundWidth(GROUND_WIDTH_NARROW, info.groundTallNarrow),
    );
    info.tile = tile.url;
    info.ground = ground.url;
    info.groundNarrow = narrow.url;
    info.jobs = [tile, ground, narrow];
    // The homepage draws the tile as two layers: all pigments but the last, then the last.
    const n = params.pigments.length;
    const top = imageJob(slug, "tile-top", params, params.tall, TILE_WIDTH, [n - 1]);
    info.tileTop = top.url;
    info.jobs.push(top);
    if (n > 1) {
      const base = imageJob(slug, "tile-base", params, params.tall, TILE_WIDTH, [...Array(n - 1).keys()]);
      info.tileBase = base.url;
      info.jobs.push(base);
    }
    info.hover = hoverInfo(params);
  }
  return info;
}

function renderJobs(outputDir) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const outDir = path.join(outputDir, "paint");
  fs.mkdirSync(outDir, { recursive: true });
  let rendered = 0;
  const started = Date.now();
  for (const [url, job] of jobs) {
    const cached = path.join(CACHE_DIR, job.file);
    if (!fs.existsSync(cached)) {
      const image = renderStain(job.params, { tall: job.tall, width: job.width, layers: job.layers });
      fs.writeFileSync(cached, encodePng(image));
      rendered++;
    }
    const target = path.join(outputDir, url);
    if (!fs.existsSync(target)) fs.copyFileSync(cached, target);
  }
  if (rendered) console.log(`[paint] rendered ${rendered} image(s) in ${Date.now() - started} ms`);
}

// ---- Writing front matter (local dev server only) --------------------------

function yamlScalar(value) {
  if (typeof value === "number") return String(Math.round(value * 1000) / 1000);
  if (typeof value === "boolean") return String(value);
  return JSON.stringify(String(value));
}

function yamlFlow(obj) {
  return `{ ${Object.entries(obj).map(([k, v]) => `${k}: ${yamlScalar(v)}`).join(", ")} }`;
}

function paintYaml(paint) {
  const lines = ["paint:"];
  for (const [key, value] of Object.entries(paint)) {
    if (key === "pigments") {
      lines.push("  pigments:");
      for (const pigment of value) lines.push(`    - ${yamlFlow(pigment)}`);
    } else {
      lines.push(`  ${key}: ${yamlScalar(value)}`);
    }
  }
  return lines;
}

// Replace (or add) a top-level key's block in a Markdown file's front matter.
function setFrontMatterKey(source, key, blockLines) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("note has no front matter");
  const kept = [];
  let skipping = false;
  for (const line of match[1].split(/\r?\n/)) {
    if (skipping && (line === "" || /^\s/.test(line))) continue;
    skipping = line.startsWith(`${key}:`);
    if (!skipping) kept.push(line);
  }
  const front = [...kept, ...blockLines].join("\n");
  return `---\n${front}\n---${source.slice(match[0].length)}`;
}

// Set (or with null, remove) `tall` inside a note's `paint:` block, leaving the rest
// of the block alone. A note without a block gets one holding just `tall`.
function setPaintTall(source, tall) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("note has no front matter");
  const lines = match[1].split(/\r?\n/);
  const start = lines.findIndex((line) => /^paint:/.test(line));
  const tallLine = `  tall: ${yamlScalar(tall)}`;
  if (start === -1) {
    if (tall === null) return source;
    lines.push("paint:", tallLine);
  } else {
    if (lines[start].trim() !== "paint:") throw new Error("this note's paint: block is on one line; set tall by hand");
    let end = start + 1;
    while (end < lines.length && (lines[end] === "" || /^\s/.test(lines[end]))) end++;
    const block = lines.slice(start + 1, end).filter((line) => !/^\s+tall:/.test(line));
    if (tall !== null) block.unshift(tallLine);
    lines.splice(start, end - start, ...(block.some((l) => l.trim()) ? ["paint:", ...block] : []));
  }
  return `---\n${lines.join("\n")}\n---${source.slice(match[0].length)}`;
}

const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];

function notePath(inputPath) {
  const notesDir = path.resolve("notes") + path.sep;
  const full = path.resolve(String(inputPath));
  if (!full.startsWith(notesDir) || !full.endsWith(".md") || !fs.existsSync(full)) {
    throw new Error(`not a note: ${inputPath}`);
  }
  return full;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

const num = (n) => Math.round(Number(n) * 10) / 10;

async function paintMiddleware(req, res, next) {
  // The studio's modules change while you work; never let the browser run stale copies
  // (a stale module mixed with a fresh one stops the studio from starting).
  if (req.url.startsWith("/studio/") || req.url.startsWith("/css/")) res.setHeader("Cache-Control", "no-store");
  // The studio reads presets from here, not from its page, so a page served while a
  // build was failing can never save stale presets over newer ones.
  if (req.method === "GET" && req.url === "/__paint/settings") {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    return res.end(fs.readFileSync(SETTINGS_FILE, "utf8"));
  }
  if (req.method !== "POST" || !req.url.startsWith("/__paint/")) return next();
  try {
    const body = await readJson(req);
    if (req.url === "/__paint/save") {
      const file = notePath(body.inputPath);
      const src = fs.readFileSync(file, "utf8");
      // `paint: null` removes the block, so the note follows the defaults again.
      fs.writeFileSync(file, setFrontMatterKey(src, "paint", body.paint ? paintYaml(body.paint) : []));
    } else if (req.url === "/__paint/settings") {
      if (!validSettings(body.settings)) throw new Error("settings are missing presets or have a bad colour");
      fs.writeFileSync(SETTINGS_FILE, formatSettings(body.settings));
    } else if (req.url === "/__paint/place") {
      for (const { inputPath, place, tall } of body.updates) {
        const file = notePath(inputPath);
        let src = fs.readFileSync(file, "utf8");
        const fields = { x: num(place.x), y: num(place.y), w: num(place.w) };
        if (CORNERS.includes(place.text) && place.text !== "top-left") fields.text = place.text;
        src = setFrontMatterKey(src, "place", [`place: ${yamlFlow(fields)}`]);
        if (tall !== undefined) src = setPaintTall(src, tall === null ? null : Math.round(Number(tall) * 100) / 100);
        fs.writeFileSync(file, src);
      }
    } else {
      return next();
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  } catch (error) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
  }
}

export default function paintPlugin(eleventyConfig) {
  eleventyConfig.addGlobalData("dev", serving);
  eleventyConfig.on("eleventy.before", () => {
    jobs.clear();
    loadSettings();
  });
  eleventyConfig.addFilter("paintSettings", () => loadSettings());
  eleventyConfig.addCollection("paintImages", (api) => {
    for (const note of api.getFilteredByGlob("./notes/**/*.md")) {
      for (const job of note.data.paintInfo?.jobs || []) jobs.set(job.url, job);
    }
    return [...jobs.keys()];
  });
  eleventyConfig.on("eleventy.after", ({ dir }) => renderJobs(dir.output));
  eleventyConfig.addWatchTarget("./paint/");

  if (serving) {
    eleventyConfig.addPassthroughCopy({
      "paint/render.js": "studio/paint/render.js",
      "paint/params.js": "studio/paint/params.js",
      "studio/assets": "studio/assets",
    });
    eleventyConfig.setServerOptions({ middleware: [paintMiddleware] });
  }
}
