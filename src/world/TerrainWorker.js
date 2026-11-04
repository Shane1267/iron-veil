import { WorldData } from './WorldData.js';
import { generateChunk } from './ChunkGenerator.js';
import { generateMapImage } from './MapGenerator.js';

// Web Worker: builds terrain chunk geometry + vegetation scatter off the main thread.
const world = new WorldData();

self.onmessage = (e) => {
  const { id, params } = e.data;
  if (e.data.map) {
    const img = generateMapImage(world, e.data.map);
    self.postMessage({ id, map: img, size: e.data.map }, [img.buffer]);
    return;
  }
  try {
    const out = generateChunk(world, params);
    const transfer = [out.pos.buffer, out.nor.buffer, out.col.buffer, out.spl.buffer, out.uv.buffer, out.index.buffer];
    if (out.veg) transfer.push(out.veg.buffer);
    if (out.farVeg) transfer.push(out.farVeg.buffer);
    if (out.grass) transfer.push(out.grass.buffer);
    self.postMessage({ id, out }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};
self.postMessage({ ready: true });
