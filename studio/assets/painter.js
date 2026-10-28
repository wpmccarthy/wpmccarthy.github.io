// A worker that always renders the newest request: while one render runs, newer
// requests replace older queued ones, so dragging a slider never builds a backlog.
export class Painter {
  constructor() {
    this.worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    this.busy = false;
    this.next = null;
    this.ids = 0;
    this.callbacks = new Map();
    this.worker.onmessage = ({ data }) => {
      const done = this.callbacks.get(data.id);
      this.callbacks.delete(data.id);
      this.busy = false;
      if (done) done(new ImageData(new Uint8ClampedArray(data.buffer), data.width, data.height));
      this.pump();
    };
  }

  render(params, tall, width) {
    return new Promise((resolve) => {
      if (this.next) this.next.resolve(null); // superseded
      this.next = { params, tall, width, resolve };
      this.pump();
    });
  }

  pump() {
    if (this.busy || !this.next) return;
    const { params, tall, width, resolve } = this.next;
    this.next = null;
    this.busy = true;
    const id = ++this.ids;
    this.callbacks.set(id, resolve);
    this.worker.postMessage({ id, params: JSON.parse(JSON.stringify(params)), tall, width });
  }
}

export function draw(canvas, image) {
  if (!image) return;
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d").putImageData(image, 0, 0);
}
