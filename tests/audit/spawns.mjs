import { WorldData } from '../../src/world/WorldData.js';
const w = new WorldData();
const want = [['oldvesper_town', 'sedan'], ['riverside', 'sedan'], ['cabins', 'offroad'], ['storage', 'apc'], ['evac', 'utility'], ['airfield', 'mil_truck'], ['ironhaven', 'pickup'], ['granary', 'pickup'], ['hospital', 'sedan']];
for (const [id, type] of want) {
  const p = w.poiById.get(id);
  let best = null;
  for (const r of w.roads) {
    if (r.type === 'rail') continue;
    r.points.forEach(([x, z], i) => {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.radius + 15 || d > p.radius + 70 || i === 0 || i >= r.points.length - 1) return;
      if (w.bridgeAt(x, z) !== null) return;
      if (!best || d < best.d) best = { d, r, i };
    });
  }
  if (!best) { console.log(id, 'none'); continue; }
  const [x, z] = best.r.points[best.i], [nx, nz] = best.r.points[best.i + 1];
  const dx = nx - x, dz = nz - z, l = Math.hypot(dx, dz);
  const off = best.r.width / 2 + 1.6;
  const sx = x + (-dz / l) * off, sz = z + (dx / l) * off;
  const rot = Math.atan2(-dx, -dz);
  console.log(JSON.stringify({ near: id, type, pos: [Math.round(sx), Math.round(sz)], rot: +rot.toFixed(2), slope: +(Math.abs(w.heightAt(sx + 2, sz) - w.heightAt(sx - 2, sz)) / 4).toFixed(2) }));
}
