// Paint studio: tune a note's stain with the same renderer the build uses, then
// save it into the note's front matter (via the dev server's /__paint/ endpoints).
// Presets and the default pool are saved to paint/settings.json.
import {
  useSettings, getSettings, resolvePaint, inkFor, paintForFrontMatter, presetFromParams, matchesPreset,
  tallFromWords, PIGMENT_DEFAULTS, INK_DARK, INK_LIGHT,
} from "../paint/params.js";
import { Painter, draw } from "./painter.js";

const $ = (id) => document.getElementById(id);
const notes = JSON.parse($("notes-data").textContent);
// Presets come from the dev server (always the file on disk); the copy in the page is
// only a fallback.
useSettings(
  await fetch("/__paint/settings", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .catch(() => JSON.parse($("settings-data").textContent)),
);

const GLOBAL_FIELDS = [
  { key: "seed", label: "Seed", min: 0, max: 99999, step: 1 },
  { key: "tall", label: "Height ÷ width", min: 0.5, max: 2.4, step: 0.01, auto: true },
  { key: "corner", label: "Corner", min: 0, max: 250, step: 1 },
  { key: "mottleScale", label: "Mottle scale", min: 3, max: 12, step: 0.1, hint: "size of the density clouds" },
];

const PIGMENT_FIELDS = [
  { key: "strength", label: "Strength", min: 0, max: 2.5, step: 0.01, hint: "how much pigment" },
  { key: "spread", label: "Spread", min: -350, max: 220, step: 1, hint: "travel past the core edge (− stays inside)" },
  { key: "soft", label: "Soft edge", min: 2, max: 200, step: 1 },
  { key: "ragged", label: "Ragged", min: 0, max: 90, step: 1, hint: "0 = a clean soft edge" },
  { key: "wick", label: "Wick", min: 0, max: 90, step: 1, hint: "fingers along canvas threads" },
  { key: "tide", label: "Tideline", min: 0, max: 1, step: 0.01, hint: "pigment pooling at the drying edge" },
  { key: "mottle", label: "Mottle", min: 0, max: 1, step: 0.01 },
  { key: "drift", label: "Drift", min: 0, max: 90, step: 1, hint: "offset from the other pigments" },
];

let note = null;
let state = null; // resolved params being edited
let view = "tile";
let variantSeeds = [];
const hidden = new Set(); // pigment indices hidden from the preview
let solo = null; // pigment index shown alone

const mainPainter = new Painter();
const groundPainter = new Painter();
const variantPainters = Array.from({ length: 8 }, () => new Painter());

const clone = (o) => JSON.parse(JSON.stringify(o));
const round = (n, step) => Math.round(n / step) * step;

function previewParams(params = state) {
  const p = clone(params);
  p.pigments = p.pigments.filter((_, i) => (solo === null ? !hidden.has(i) : i === solo));
  return p;
}

function setStatus(text, kind = "") {
  $("status").textContent = text;
  $("status").dataset.kind = kind;
}

// ---- Unsaved edits survive the dev server's reloads ---------------------------------

const draftKey = () => `paint-draft:${note.slug}`;
let dirty = false;

function markDirty() {
  dirty = true;
  try { sessionStorage.setItem(draftKey(), JSON.stringify(state)); } catch {}
  describe();
}

function clearDraft() {
  dirty = false;
  try { sessionStorage.removeItem(draftKey()); } catch {}
}

function describe() {
  const linked = matchesPreset(state) ? `preset “${state.preset}”` : "custom paint";
  if (dirty) return setStatus(`Unsaved: ${linked}`, "dirty");
  if (!note.savedPaint) return setStatus(`Following the defaults (${linked})`);
  setStatus(`Saved in note: ${linked}`);
}

// ---- Rendering ---------------------------------------------------------------

let renderTimer = 0;
function scheduleRender() {
  clearTimeout(renderTimer);
  // Quick low-res pass while dragging, full pass once the input settles.
  renderMain(0.5);
  renderTimer = setTimeout(() => {
    renderMain(1);
    renderVariants();
  }, 220);
  updateLabel();
}

async function renderMain(quality) {
  const p = previewParams();
  if (view === "tile") {
    draw($("main"), await mainPainter.render(p, state.tall, Math.round(560 * quality)));
  } else {
    const canvas = $("ground");
    draw(canvas, await groundPainter.render(p, note.groundTall, Math.round(460 * quality)));
    canvas.style.aspectRatio = `1500 / ${1000 * note.groundTall + 500}`;
  }
}

function renderVariants() {
  const box = $("variants");
  variantSeeds.forEach((seed, i) => {
    const canvas = box.children[i].querySelector("canvas");
    variantPainters[i].render({ ...previewParams(), seed }, state.tall, 240).then((img) => draw(canvas, img));
  });
}

function buildVariants() {
  const box = $("variants");
  box.textContent = "";
  variantSeeds.forEach((seed) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "variant linen";
    b.title = `Seed ${seed}`;
    b.innerHTML = `<canvas></canvas><span>${seed}</span>`;
    b.addEventListener("click", () => {
      state.seed = seed;
      syncGlobals();
      scheduleRender();
      markDirty();
    });
    box.append(b);
  });
  renderVariants();
}

function buildVariantsAround(seed) {
  variantSeeds = Array.from({ length: 8 }, (_, i) => (seed + (i + 1) * 7919) % 100000);
  buildVariants();
}

// ---- Controls ------------------------------------------------------------------

function slider(field, value, onInput) {
  const row = document.createElement("label");
  row.className = "row";
  row.title = field.hint || "";
  row.innerHTML = `<span class="name">${field.label}</span>
    <input type="range" min="${field.min}" max="${field.max}" step="${field.step}">
    <input type="number" step="${field.step}">`;
  const [range, number] = row.querySelectorAll("input");
  const set = (v) => {
    range.value = v;
    number.value = v;
  };
  set(value);
  const handle = (e) => {
    const v = round(Number(e.target.value), field.step);
    set(v);
    onInput(v);
  };
  range.addEventListener("input", handle);
  number.addEventListener("change", handle);
  row.set = set;
  return row;
}

const globalRows = {};
function buildGlobals() {
  const box = $("global-controls");
  box.textContent = "";
  for (const field of GLOBAL_FIELDS) {
    let autoBox;
    const row = slider(field, state[field.key], (v) => {
      state[field.key] = v;
      if (field.key === "tall") {
        state.tallAuto = false;
        autoBox.checked = false;
      }
      if (field.key === "seed") buildVariantsAround(v);
      scheduleRender();
      markDirty();
    });
    globalRows[field.key] = row;
    if (field.auto) {
      const auto = document.createElement("label");
      auto.className = "auto";
      auto.innerHTML = `<input type="checkbox"> auto from length (${note.words} words)`;
      autoBox = auto.querySelector("input");
      autoBox.checked = state.tallAuto;
      autoBox.addEventListener("change", () => {
        state.tallAuto = autoBox.checked;
        if (state.tallAuto) {
          state.tall = tallFromWords(note.words);
          row.set(state.tall);
        }
        scheduleRender();
        markDirty();
      });
      row.append(auto);
    }
    if (field.key === "seed") {
      const dice = document.createElement("button");
      dice.type = "button";
      dice.textContent = "Random";
      dice.addEventListener("click", (e) => {
        e.preventDefault();
        state.seed = Math.floor(Math.random() * 100000);
        row.set(state.seed);
        buildVariantsAround(state.seed);
        scheduleRender();
        markDirty();
      });
      row.append(dice);
    }
    box.append(row);
  }
}

function syncGlobals() {
  for (const field of GLOBAL_FIELDS) globalRows[field.key]?.set(state[field.key]);
}

function applyPreset(name) {
  const fresh = resolvePaint({ preset: name, seed: state.seed }, note.slug, note.words);
  Object.assign(state, { preset: name, corner: fresh.corner, mottleScale: fresh.mottleScale, pigments: fresh.pigments });
  if (fresh.ink) state.ink = fresh.ink;
  else delete state.ink;
  hidden.clear();
  solo = null;
  syncGlobals();
  syncInk();
  buildPigments();
  buildPresets();
  scheduleRender();
  markDirty();
}

function buildPresets() {
  const { presets, defaultPresets } = getSettings();
  const box = $("presets");
  box.textContent = "";
  for (const [name, preset] of Object.entries(presets)) {
    const card = document.createElement("div");
    card.className = "preset";
    if (name === state.preset && matchesPreset(state)) card.classList.add("is-current");
    const swatches = preset.pigments.map((p) => `<i style="background:${p.color}"></i>`).join("");
    card.innerHTML = `<button type="button" class="apply" title="Apply “${name}”"><span class="swatches">${swatches}</span><span class="pname"></span></button>
      <label class="def" title="Notes without their own paint may get this preset"><input type="checkbox"> default</label>
      <button type="button" class="del" title="Delete preset">✕</button>`;
    card.querySelector(".pname").textContent = name;
    card.querySelector(".apply").addEventListener("click", () => applyPreset(name));
    const def = card.querySelector(".def input");
    def.checked = defaultPresets.includes(name);
    def.addEventListener("change", () => {
      const pool = new Set(getSettings().defaultPresets);
      def.checked ? pool.add(name) : pool.delete(name);
      saveSettings({ ...getSettings(), defaultPresets: [...pool] }, def.checked ? `“${name}” is now a default` : `“${name}” is no longer a default`);
    });
    card.querySelector(".del").addEventListener("click", () => {
      if (!confirm(`Delete the preset “${name}”? Notes that use it will fall back to the defaults.`)) return;
      const next = clone(getSettings());
      delete next.presets[name];
      next.defaultPresets = next.defaultPresets.filter((n) => n !== name);
      saveSettings(next, `Deleted “${name}”`);
    });
    box.append(card);
  }
}

async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json().catch(() => ({ ok: false, error: "no response from the dev server" }));
}

async function saveSettings(next, message) {
  const out = await post("/__paint/settings", { settings: next });
  if (!out.ok) return setStatus(`Couldn't save presets: ${out.error}`, "error");
  useSettings(next);
  buildPresets();
  setStatus(`${message} — rebuilding`, "ok");
}

function askPresetName(suggestion) {
  const name = prompt("Preset name (letters, numbers, dashes):", suggestion)?.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  if (!name) return null;
  if (getSettings().presets[name] && !confirm(`Replace the existing preset “${name}”?`)) return null;
  return name;
}

$("save-preset").addEventListener("click", () => {
  const name = askPresetName(matchesPreset(state) ? "" : `${state.preset}-2`);
  if (!name) return;
  const next = clone(getSettings());
  next.presets[name] = presetFromParams(state);
  state.preset = name;
  markDirty();
  saveSettings(next, `Saved preset “${name}”`);
});

$("make-default").addEventListener("click", () => {
  const name = askPresetName(matchesPreset(state) ? state.preset : "house");
  if (!name) return;
  const next = clone(getSettings());
  next.presets[name] = presetFromParams(state);
  next.defaultPresets = [name];
  state.preset = name;
  markDirty();
  saveSettings(next, `“${name}” is now the default for every note without its own paint`);
});

function buildPigments() {
  const list = $("pigment-list");
  list.textContent = "";
  state.pigments.forEach((pg, i) => {
    const card = document.createElement("div");
    card.className = "pigment";
    if (hidden.has(i)) card.classList.add("is-hidden");
    if (solo === i) card.classList.add("is-solo");
    card.innerHTML = `<div class="pigment-head">
        <input type="color" aria-label="Colour">
        <input type="text" class="hex" aria-label="Hex" spellcheck="false">
        <span class="spacer"></span>
        <button type="button" data-act="solo" title="Preview this pigment alone">Solo</button>
        <button type="button" data-act="hide" title="Hide from preview">${hidden.has(i) ? "Show" : "Hide"}</button>
        <button type="button" data-act="up" title="Move down the list (painted later, on top)">↓</button>
        <button type="button" data-act="down" title="Move up the list (painted earlier, underneath)">↑</button>
        <button type="button" data-act="dup" title="Duplicate">⧉</button>
        <button type="button" data-act="del" title="Remove">✕</button>
      </div>`;
    const [color, hex] = card.querySelectorAll("input");
    color.value = pg.color;
    hex.value = pg.color;
    const changed = () => {
      scheduleRender();
      markDirty();
      buildPresets();
    };
    color.addEventListener("input", () => {
      pg.color = color.value;
      hex.value = color.value;
      changed();
    });
    hex.addEventListener("change", () => {
      if (!/^#[0-9a-f]{6}$/i.test(hex.value)) return (hex.value = pg.color);
      pg.color = hex.value.toLowerCase();
      color.value = pg.color;
      changed();
    });
    card.querySelector(".pigment-head").addEventListener("click", (e) => {
      const act = e.target.dataset.act;
      if (!act) return;
      const p = state.pigments;
      if (act === "solo") solo = solo === i ? null : i;
      if (act === "hide") hidden.has(i) ? hidden.delete(i) : hidden.add(i);
      if (act === "up" && i < p.length - 1) [p[i], p[i + 1]] = [p[i + 1], p[i]];
      if (act === "down" && i > 0) [p[i], p[i - 1]] = [p[i - 1], p[i]];
      if (act === "dup") p.splice(i + 1, 0, clone(pg));
      if (act === "del" && p.length > 1) p.splice(i, 1);
      if (["up", "down", "dup", "del"].includes(act)) {
        hidden.clear();
        solo = null;
        markDirty();
        buildPresets();
      }
      buildPigments();
      scheduleRender();
    });
    for (const field of PIGMENT_FIELDS) {
      card.append(slider(field, pg[field.key], (v) => {
        pg[field.key] = v;
        changed();
      }));
    }
    list.append(card);
  });
}

// ---- Ink and label ---------------------------------------------------------------

function syncInk() {
  const mode = !state.ink ? "auto" : state.ink === INK_DARK ? "dark" : state.ink === INK_LIGHT ? "light" : "custom";
  $("ink-mode").value = mode;
  $("ink-color").hidden = mode !== "custom";
  if (mode === "custom") $("ink-color").value = state.ink;
}

$("ink-mode").addEventListener("change", (e) => {
  const mode = e.target.value;
  if (mode === "auto") delete state.ink;
  if (mode === "dark") state.ink = INK_DARK;
  if (mode === "light") state.ink = INK_LIGHT;
  if (mode === "custom") state.ink = $("ink-color").value;
  syncInk();
  updateLabel();
  markDirty();
});
$("ink-color").addEventListener("input", (e) => {
  state.ink = e.target.value;
  updateLabel();
  markDirty();
});

function updateLabel() {
  const ink = inkFor(state);
  $("label-title").textContent = note.title;
  $("label-meta").textContent = `${note.words} words${note.draft ? " · draft" : ""}`;
  $("ground-title").textContent = note.title;
  $("tile-view").style.setProperty("--ink", ink);
  $("ground-view").style.setProperty("--ink", ink);
  $("main").style.aspectRatio = `1 / ${(1000 * state.tall + 500) / 1500}`;
}

// ---- Load, save ------------------------------------------------------------------

function load(slug, { useDraft = true } = {}) {
  note = notes.find((n) => n.slug === slug) || notes.find((n) => !n.draft) || notes[0];
  $("note").value = note.slug;
  let draft = null;
  try { draft = useDraft && JSON.parse(sessionStorage.getItem(draftKey())); } catch {}
  state = draft || clone(note.params);
  dirty = Boolean(draft);
  hidden.clear();
  solo = null;
  const url = new URL(location.href);
  url.searchParams.set("note", note.slug);
  history.replaceState(null, "", url);
  buildGlobals();
  buildPigments();
  buildPresets();
  syncInk();
  buildVariantsAround(state.seed);
  scheduleRender();
  describe();
}

$("save").addEventListener("click", async () => {
  setStatus("Saving…");
  const out = await post("/__paint/save", { inputPath: note.inputPath, paint: paintForFrontMatter(state) });
  if (!out.ok) return setStatus(`Couldn't save: ${out.error}`, "error");
  clearDraft();
  setStatus(`Saved to ${note.inputPath} — rebuilding`, "ok");
});

$("clear").addEventListener("click", async () => {
  if (!confirm("Remove this note's own paint, so it follows the default presets?")) return;
  const out = await post("/__paint/save", { inputPath: note.inputPath, paint: null });
  if (!out.ok) return setStatus(`Couldn't save: ${out.error}`, "error");
  clearDraft();
  setStatus("Now following the defaults — rebuilding", "ok");
});

$("revert").addEventListener("click", () => {
  clearDraft();
  load(note.slug, { useDraft: false });
});
$("shuffle").addEventListener("click", () => {
  variantSeeds = Array.from({ length: 8 }, () => Math.floor(Math.random() * 100000));
  buildVariants();
});
// Copy every layer's settings (all but colour) onto the same layer, by position, of
// every preset. Presets keep their colours; layers beyond this note's are untouched.
$("apply-all").addEventListener("click", () => {
  const next = clone(getSettings());
  const fields = Object.keys(PIGMENT_DEFAULTS);
  const n = state.pigments.length;
  const odd = Object.entries(next.presets).filter(([, p]) => p.pigments.length !== n).map(([name, p]) => `${name} (${p.pigments.length})`);
  const warning = odd.length
    ? `\n\nThese presets don't have ${n} layers: ${odd.join(", ")}. Matching layers are updated by position; extra layers keep their settings.`
    : "";
  if (!confirm(`Apply these ${n} layers' settings to every preset, keeping each preset's colours?${warning}`)) return;
  for (const preset of Object.values(next.presets)) {
    preset.pigments = preset.pigments.map((pg, i) => {
      const src = state.pigments[i];
      if (!src) return pg;
      const out = { color: pg.color };
      for (const key of fields) out[key] = src[key];
      return out;
    });
  }
  saveSettings(next, "Layer settings applied to all presets");
});

$("add-pigment").addEventListener("click", () => {
  state.pigments.push({ color: "#9a6a4a", ...PIGMENT_DEFAULTS, spread: -60, strength: 0.4, soft: 70 });
  buildPigments();
  buildPresets();
  scheduleRender();
  markDirty();
});

document.querySelector(".tabs").addEventListener("click", (e) => {
  const v = e.target.dataset.view;
  if (!v) return;
  view = v;
  for (const tab of document.querySelectorAll(".tabs button")) tab.setAttribute("aria-selected", tab.dataset.view === v);
  $("tile-view").hidden = v !== "tile";
  $("ground-view").hidden = v !== "ground";
  scheduleRender();
});

// Unsaved edits are kept per note (in this tab), so switching notes loses nothing.
$("note").addEventListener("change", (e) => load(e.target.value));

for (const n of notes) {
  const opt = document.createElement("option");
  opt.value = n.slug;
  opt.textContent = `${n.title}${n.draft ? " (draft)" : ""}`;
  $("note").append(opt);
}
load(new URLSearchParams(location.search).get("note"));
