// Paint stain renderer. Pure functions, no DOM or Node APIs: the build (Node) and the
// studio (browser) both import this file, so a stain looks identical in both.
//
// Geometry is in "units": the painted core rectangle is always 1000 units wide and
// `tall * 1000` units high, surrounded by PAD units of bare canvas for the bleed.
// Every size-like parameter (spread, soft, ragged, …) is in these units, so a stain
// scales uniformly with whatever size it is shown at.
//
// Colour model: each pigment's `color` is its transmittance at density 1. Density
// along a pixel is coverage × strength, and transmittance is color ^ density per
// channel (Beer–Lambert). Thin washes are pale tints; pooled pigment goes deeper and
// more saturated; overlapping pigments mix subtractively. The result is written as
// RGBA that reproduces that transmittance under `mix-blend-mode: multiply`, so the
// linen shows through and overlapping stains glaze over each other.

export const PAD = 250;
export const RENDER_VERSION = 3;

// ---- Seeded randomness -----------------------------------------------------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 2D gradient noise with its own permutation table. Returns roughly [-1, 1].
function makeNoise(seed) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256);
  const gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const a = rand() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const offX = rand() * 256;
  const offY = rand() * 256;
  return function noise(x, y) {
    x += offX; y += offY;
    const xf = Math.floor(x), yf = Math.floor(y);
    const X = xf & 255, Y = yf & 255;
    const fx = x - xf, fy = y - yf;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
    const n00 = gx[aa] * fx + gy[aa] * fy;
    const n10 = gx[ba] * (fx - 1) + gy[ba] * fy;
    const n01 = gx[ab] * fx + gy[ab] * (fy - 1);
    const n11 = gx[bb] * (fx - 1) + gy[bb] * (fy - 1);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 1.45;
  };
}

function fbm(noise, x, y, octaves) {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x, y);
    norm += amp;
    amp *= 0.5;
    x = x * 2.03 + 17.1;
    y = y * 2.03 - 9.7;
  }
  return sum / norm;
}

// ---- Colour ----------------------------------------------------------------

export function hexToRgb(hex) {
  const h = String(hex).replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Per-channel absorbance at density 1.
function absorbance(hex) {
  return hexToRgb(hex).map((c) => -Math.log(Math.max(c, 0.003)));
}

// ---- Shape -----------------------------------------------------------------

// Signed distance to a rounded box centred at the origin (negative inside).
function sdRoundBox(px, py, hx, hy, r) {
  const qx = Math.abs(px) - hx + r;
  const qy = Math.abs(py) - hy + r;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function smoothEdge(d, soft) {
  // 1 well inside, 0 well outside, an S-curve `soft` units either side of the edge.
  const t = Math.max(-1, Math.min(1, d / soft));
  return 0.5 - 0.5 * t * (1.5 - 0.5 * t * t) / 1;
}

// ---- Render ----------------------------------------------------------------

/**
 * @param {object} params  resolved paint params (see params.js)
 * @param {object} opts
 * @param {number} opts.tall   core height / core width
 * @param {number} opts.width  output width in pixels (whole image, including PAD)
 * @param {number} [opts.pad]  units of bare canvas around the core
 * @param {number[]} [opts.layers]  indices of the pigments to draw (default: all). Each
 *   pigment keeps exactly the texture it has in the full painting, so separately
 *   rendered layers multiplied together reproduce the full image.
 * @returns {{width:number, height:number, data:Uint8ClampedArray}}
 */
export function renderStain(params, { tall, width, pad = PAD, layers: only }) {
  const coreW = 1000;
  const coreH = 1000 * tall;
  const unitsW = coreW + 2 * pad;
  const unitsH = coreH + 2 * pad;
  const scale = width / unitsW;
  const height = Math.max(1, Math.round(unitsH * scale));
  const data = new Uint8ClampedArray(width * height * 4);

  const rand = mulberry32(params.seed);
  // Mottle frequency: a larger mottleScale gives larger, softer clouds.
  const mf = 0.0035 / (params.mottleScale ?? 3);

  const layers = params.pigments.map((pg) => {
    const ang = rand() * Math.PI * 2;
    const driftAmt = pg.drift ?? 0;
    const spread = pg.spread ?? 0;
    const soft = Math.max(2, pg.soft ?? 20);
    const ragged = pg.ragged ?? 0;
    const wick = pg.wick ?? 0;
    return {
      abs: absorbance(pg.color),
      strength: pg.strength ?? 1,
      cx: coreW / 2 + Math.cos(ang) * driftAmt,
      cy: coreH / 2 + Math.sin(ang) * driftAmt,
      hx: coreW / 2 + spread,
      hy: coreH / 2 + spread,
      corner: Math.max(0, Math.min(params.corner ?? 40, coreW / 2 + spread, coreH / 2 + spread)),
      soft,
      ragged,
      wick,
      tide: pg.tide ?? 0,
      mottle: pg.mottle ?? 0,
      // Distance beyond which the layer can't reach: skip work there.
      reach: soft + ragged * 2.6 + Math.max(0, spread) * 0.6 + wick * 1.1 + 4,
      // How much the reach of this pigment varies around the perimeter.
      edgeVar: ragged * 1.4 + Math.max(0, spread) * 0.55,
      edgeN: makeNoise(rand() * 1e9),
      ragA: makeNoise(rand() * 1e9),
      ragB: makeNoise(rand() * 1e9),
      thread: makeNoise(rand() * 1e9),
      mot: makeNoise(rand() * 1e9),
    };
  }).filter((_, i) => !only || only.includes(i));

  const A = [0, 0, 0];

  for (let py = 0; py < height; py++) {
    const v = (py + 0.5) / scale - pad;
    for (let px = 0; px < width; px++) {
      const u = (px + 0.5) / scale - pad;
      A[0] = A[1] = A[2] = 0;

      for (let li = 0; li < layers.length; li++) {
        const L = layers[li];
        // Quick reject on the un-ragged distance.
        let dx = u - L.cx, dy = v - L.cy;
        const d0 = sdRoundBox(dx, dy, L.hx, L.hy, L.corner);
        if (d0 > L.reach) continue;

        let d = d0;
        if (L.ragged) {
          dx += L.ragged * fbm(L.ragA, u * 0.011, v * 0.011, 3);
          dy += L.ragged * fbm(L.ragB, u * 0.011, v * 0.011, 3);
          d = sdRoundBox(dx, dy, L.hx, L.hy, L.corner);
        }
        if (L.edgeVar) d += L.edgeVar * fbm(L.edgeN, u * 0.004, v * 0.004, 2);

        // Capillary wicking along warp and weft threads, only around the edge.
        if (L.wick && d > -L.soft) {
          const h = 1 - Math.abs(L.thread(u * 0.0025, v * 0.06));
          const vt = 1 - Math.abs(L.thread(u * 0.06 + 91.3, v * 0.0025));
          const t = Math.max(h * h * h * h, vt * vt * vt * vt);
          const win = Math.max(0, 1 - Math.max(0, d) / (L.wick + L.soft));
          d -= L.wick * t * win;
        }

        let c = smoothEdge(d, L.soft);
        if (c <= 0.0005) continue;

        // Tideline: pigment pools just inside the drying edge.
        if (L.tide) {
          const ringW = L.soft * 0.55 + 6;
          const e = (d + L.soft * 0.45) / ringW;
          const ring = Math.exp(-e * e);
          c = c * (1 - 0.4 * L.tide) + L.tide * 0.75 * ring * Math.min(1, c * 3);
        }

        let dens = c;
        if (L.mottle) {
          const m = fbm(L.mot, u * mf, v * mf, 4);
          dens *= Math.max(0, 1 + L.mottle * 1.6 * m);
        }

        const D = dens * L.strength;
        A[0] += D * L.abs[0];
        A[1] += D * L.abs[1];
        A[2] += D * L.abs[2];
      }

      const i = (py * width + px) * 4;
      if (A[0] + A[1] + A[2] < 1e-4) continue; // transparent
      const tr = Math.exp(-A[0]), tg = Math.exp(-A[1]), tb = Math.exp(-A[2]);
      // Encode transmittance T as (colour C, alpha a) so that under multiply,
      // (1 - a) + a*C = T in every channel, with the smallest possible alpha.
      const a = 1 - Math.min(tr, tg, tb);
      data[i] = 255 * (1 - (1 - tr) / a);
      data[i + 1] = 255 * (1 - (1 - tg) / a);
      data[i + 2] = 255 * (1 - (1 - tb) / a);
      data[i + 3] = 255 * a;
    }
  }
  return { width, height, data };
}
