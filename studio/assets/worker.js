// Renders stains off the main thread with the exact code the build uses.
import { renderStain } from "../paint/render.js";

self.onmessage = ({ data: { id, params, tall, width } }) => {
  const image = renderStain(params, { tall, width });
  self.postMessage({ id, width: image.width, height: image.height, buffer: image.data.buffer }, [image.data.buffer]);
};
