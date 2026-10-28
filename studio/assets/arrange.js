// Homepage arrange mode (local dev server only). Drag a tile's text to move it; drag
// the corner handle to resize (sideways = width, up/down = height, i.e. the shape);
// double-click the handle to give the shape back to the note's length; click a corner
// dot to align the title there. Save writes `place: { x, y, w, text }` and, if the
// shape changed, `paint.tall` into each note.
const board = document.querySelector(".board");
const tiles = [...document.querySelectorAll(".tile")];
const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];

const bar = document.createElement("div");
bar.className = "arrange-bar";
bar.innerHTML = `<button type="button" data-act="toggle">Arrange</button>
  <button type="button" data-act="save" hidden>Save layout</button>
  <button type="button" data-act="cancel" hidden>Cancel</button>
  <a href="/studio/">Paint studio</a>
  <span class="arrange-status" role="status"></span>`;
document.body.append(bar);

const style = document.createElement("style");
style.textContent = `
.arrange-bar { position: fixed; right: 1rem; bottom: 1rem; z-index: 10; display: flex; gap: 0.5rem; align-items: center;
  padding: 0.5rem 0.75rem; background: rgba(255,253,249,.95); border: 1px solid rgba(0,0,0,.15); border-radius: 10px;
  font: 14px system-ui, sans-serif; color: #222; color-scheme: light; box-shadow: 0 4px 16px rgba(0,0,0,.08); }
.arrange-bar button { font: inherit; padding: 0.25rem 0.7rem; border-radius: 6px; border: 1px solid rgba(0,0,0,.2); background: #fff; color: #222; cursor: pointer; }
.arrange-bar a { color: inherit; }
.arranging .tile { pointer-events: none; }
.arranging .tile .tile-text { cursor: grab; outline: 1px dashed color-mix(in srgb, var(--ink) 50%, transparent); outline-offset: -2px; }
.arranging .tile.dragging .tile-text { cursor: grabbing; }
.arrange-handle, .arrange-paint, .arrange-corner { display: none; }
.arranging .arrange-handle { display: block; position: absolute; right: calc(var(--tw) / 6 - 9px); bottom: calc(var(--tw) / 6 - 9px);
  width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 2px solid #333; cursor: nwse-resize; pointer-events: auto; }
.arranging .arrange-paint { display: block; position: absolute; left: 50%; translate: -50% 0; bottom: calc(var(--tw) / 6 + 8px);
  font: 12px system-ui, sans-serif; background: rgba(255,255,255,.9); color: #222; padding: 2px 6px; border-radius: 4px; pointer-events: auto; text-decoration: none; }
.arranging .arrange-corner { display: block; position: absolute; width: 12px; height: 12px; padding: 0; border-radius: 50%;
  border: 2px solid #fff; background: rgba(0,0,0,.35); cursor: pointer; pointer-events: auto; }
.arranging .arrange-corner[aria-pressed="true"] { background: #fff; border-color: #222; }
.arrange-corner[data-corner^="top"] { top: calc(var(--tw) / 6 + 4px); }
.arrange-corner[data-corner^="bottom"] { bottom: calc(var(--tw) / 6 + 4px); }
.arrange-corner[data-corner$="left"] { left: calc(var(--tw) / 6 + 4px); }
.arrange-corner[data-corner="top-right"] { right: calc(var(--tw) / 6 + 4px); }
.arrange-corner[data-corner="bottom-right"] { right: calc(var(--tw) / 6 + 28px); }
@media (max-width: 760px) { .arrange-bar [data-act="toggle"] { display: none; } }
`;
document.head.append(style);

const btn = (act) => bar.querySelector(`[data-act="${act}"]`);
const status = bar.querySelector(".arrange-status");
let arranging = false;
let original = null;

const num = (tile, name) => parseFloat(tile.style.getPropertyValue(`--${name}`));
const unitsPerPx = () => 100 / board.getBoundingClientRect().width;
const round2 = (n) => Math.round(n * 100) / 100;
// Tile height ÷ width for a core of height ÷ width `tall` (the bleed is 250 units of 1500).
const ratioFor = (tall) => (1000 * tall + 500) / 1500;

function changed() {
  status.textContent = "Unsaved layout";
}

function setCorner(tile, corner) {
  tile.dataset.text = corner;
  for (const dot of tile.querySelectorAll(".arrange-corner")) dot.setAttribute("aria-pressed", dot.dataset.corner === corner);
}

for (const tile of tiles) {
  const handle = document.createElement("span");
  handle.className = "arrange-handle";
  handle.title = "Drag to resize (up/down changes the shape). Double-click: shape from note length";
  const paint = document.createElement("a");
  paint.className = "arrange-paint";
  paint.href = `/studio/?note=${tile.dataset.slug}`;
  paint.textContent = "Paint…";
  tile.append(handle, paint);
  for (const corner of CORNERS) {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "arrange-corner";
    dot.dataset.corner = corner;
    dot.title = `Align text ${corner.replace("-", " ")}`;
    dot.addEventListener("pointerdown", (e) => e.stopPropagation());
    dot.addEventListener("click", (e) => {
      e.preventDefault();
      setCorner(tile, corner);
      changed();
    });
    tile.append(dot);
  }
  setCorner(tile, tile.dataset.text || "top-left");

  tile.querySelector(".tile-text").addEventListener("pointerdown", (e) => startDrag(e, tile, "move"));
  handle.addEventListener("pointerdown", (e) => startDrag(e, tile, "resize"));
  handle.addEventListener("dblclick", () => {
    tile.dataset.tall = tile.dataset.tallWords;
    tile.dataset.tallAuto = "true";
    tile.style.setProperty("--r", ratioFor(Number(tile.dataset.tall)).toFixed(4));
    changed();
    growBoard();
  });
  tile.addEventListener("click", (e) => {
    if (arranging && !e.target.closest(".arrange-paint")) e.preventDefault();
  });
}

function startDrag(e, tile, mode) {
  if (!arranging) return;
  e.preventDefault();
  e.stopPropagation();
  const k = unitsPerPx();
  const w0 = num(tile, "w");
  const start = { px: e.clientX, py: e.clientY, x: num(tile, "x"), y: num(tile, "y"), w: w0, h: w0 * num(tile, "r") };
  tile.classList.add("dragging");
  // Bring the dragged tile's text above its neighbours while arranging.
  board.append(tile);
  const move = (ev) => {
    const dx = (ev.clientX - start.px) * k;
    const dy = (ev.clientY - start.py) * k;
    if (mode === "move") {
      tile.style.setProperty("--x", (start.x + dx).toFixed(1));
      tile.style.setProperty("--y", Math.max(-5, start.y + dy).toFixed(1));
    } else {
      // The image stretches until the layout is saved and the stain re-rendered.
      const w = Math.max(8, start.w + dx);
      const h = Math.max(w * 0.5, start.h + dy);
      const tall = Math.min(3, Math.max(0.4, round2((h - w / 3) / ((w * 2) / 3))));
      tile.style.setProperty("--w", w.toFixed(1));
      tile.style.setProperty("--r", ratioFor(tall).toFixed(4));
      tile.dataset.tall = tall;
      tile.dataset.tallAuto = "false";
    }
    changed();
    growBoard();
  };
  const up = () => {
    tile.classList.remove("dragging");
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
}

function growBoard() {
  const bottom = Math.max(...tiles.map((t) => num(t, "y") + num(t, "w") * num(t, "r")));
  board.style.setProperty("--bh", Math.max(bottom + 5, parseFloat(board.style.getPropertyValue("--bh"))).toFixed(1));
}

function snapshot() {
  return tiles.map((t) => ({ style: t.getAttribute("style"), text: t.dataset.text, tall: t.dataset.tall, tallAuto: t.dataset.tallAuto }));
}

function setMode(on) {
  arranging = on;
  document.body.classList.toggle("arranging", on);
  btn("toggle").hidden = on;
  btn("save").hidden = !on;
  btn("cancel").hidden = !on;
  if (on) original = snapshot();
}

bar.addEventListener("click", async (e) => {
  const act = e.target.dataset.act;
  if (act === "toggle") setMode(true);
  if (act === "cancel") {
    tiles.forEach((t, i) => {
      t.setAttribute("style", original[i].style);
      setCorner(t, original[i].text);
      Object.assign(t.dataset, { tall: original[i].tall, tallAuto: original[i].tallAuto });
    });
    status.textContent = "";
    setMode(false);
  }
  if (act === "save") {
    status.textContent = "Saving…";
    const updates = tiles.map((t, i) => {
      const update = {
        inputPath: t.dataset.input,
        place: { x: num(t, "x"), y: num(t, "y"), w: num(t, "w"), text: t.dataset.text },
      };
      // Only touch paint.tall for tiles whose shape changed (null = shape from length).
      const was = original[i];
      if (t.dataset.tall !== was.tall || t.dataset.tallAuto !== was.tallAuto) {
        update.tall = t.dataset.tallAuto === "true" ? null : Number(t.dataset.tall);
      }
      return update;
    });
    const res = await fetch("/__paint/place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });
    const out = await res.json().catch(() => ({ ok: false, error: "no response" }));
    status.textContent = out.ok ? "Saved — rebuilding…" : `Couldn't save: ${out.error}`;
    if (out.ok) setMode(false);
  }
});
