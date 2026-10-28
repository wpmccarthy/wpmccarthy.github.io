// Homepage layout. Positions are in "board units": 100 = the board's width, on both
// axes, so the composition scales uniformly with the window.
//
// A note's `place: { x, y, w, text }` puts its tile's top-left (bleed included) at
// (x, y) with width w; `text` is the corner the title sits in (default top-left). Notes without `place` are fitted into free space, in collection order,
// without their painted cores touching — only their bleeds overlap.

import { mulberry32, hashString, PAD } from "./render.js";

const PAD_FRACTION = PAD / (1000 + 2 * PAD);
const CORE_GAP = 1.2;

function coreRect({ x, y, w, h }) {
  const p = w * PAD_FRACTION;
  return { x0: x + p, y0: y + p, x1: x + w - p, y1: y + h - p };
}

function coresClash(a, b) {
  return a.x0 < b.x1 + CORE_GAP && b.x0 < a.x1 + CORE_GAP && a.y0 < b.y1 + CORE_GAP && b.y0 < a.y1 + CORE_GAP;
}

const round = (n) => Math.round(n * 10) / 10;

/**
 * @param {Array<{key:string, place?:object, ratio:number, words:number}>} items
 * @returns the same items with x, y, w, h, auto (true if placed automatically)
 */
export function layoutBoard(items) {
  const placed = [];
  const tiles = items.map((item) => {
    const rand = mulberry32(hashString(item.key));
    const place = item.place || {};
    const w = Number.isFinite(place.w) ? place.w : round(25 + 8 * rand() + 5 * Math.min(1, item.words / 1500));
    const text = ["top-left", "top-right", "bottom-left", "bottom-right"].includes(place.text) ? place.text : "top-left";
    return { ...item, w, h: w * item.ratio, x: place.x, y: place.y, text, rand };
  });

  for (const t of tiles) {
    if (Number.isFinite(t.x) && Number.isFinite(t.y)) {
      t.auto = false;
      placed.push(coreRect(t));
    }
  }

  for (const t of tiles) {
    if (t.auto === false) continue;
    const preferX = t.rand() * (100 - t.w);
    const lift = t.rand() * 3;
    let best = null;
    // Scan rows downwards; once a spot is found, look a few rows further for one
    // nearer this tile's preferred x, so tiles don't all pack to the left.
    for (let y = 0; y < 2000 && !(best && y > best.y + 6); y += 1) {
      for (let x = -2; x <= 102 - t.w; x += 1) {
        const rect = coreRect({ x, y: y + lift, w: t.w, h: t.h });
        if (placed.some((p) => coresClash(p, rect))) continue;
        const score = y + 0.12 * Math.abs(x - preferX);
        if (!best || score < best.score) best = { x, y: y + lift, score };
      }
    }
    t.x = round(best.x);
    t.y = round(best.y);
    t.auto = true;
    placed.push(coreRect(t));
  }

  for (const t of tiles) {
    delete t.rand;
    t.h = round(t.h);
    // Where the tile sits in the room it has to move sideways (used on phones).
    t.mx = Math.round(Math.min(1, Math.max(0, t.x / Math.max(1, 100 - t.w))) * 100) / 100;
  }
  // Top-to-bottom reading order: this is the stacking order on phones.
  return tiles.sort((a, b) => a.y + a.h / 3 - (b.y + b.h / 3) || a.x - b.x);
}

export function boardHeight(tiles) {
  return round(Math.max(20, ...tiles.map((t) => t.y + t.h)));
}
