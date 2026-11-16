import { WorldData } from '../../src/world/WorldData.js';
const w = new WorldData();
const want = [
  ['roadside', 70, 'road'], ['hamlet', 90, 'road'], ['abandoned_farm', 80, 'road'], ['outpost', 70, 'road'],
  ['supply_depot', 100, 'road'], ['factory', 120, 'road'], ['maintenance_yard', 90, 'road'], ['guard_post', 45, 'road'],
  ['mil_garage', 70, 'road'], ['storage_yard', 80, 'road'], ['ghost_village', 110, 'road'], ['fuel_stop', 60, 'road'],
  ['hunting_cabin', 40, 'remote'], ['radio_tower', 50, 'remote'], ['ranger_outpost', 50, 'remote'], ['isolated_compound', 70, 'remote'],
];
const placed = w.pois.map((p) => ({ x: p.x, z: p.z, r: p.radius }));
let seed = 12345; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const out = [];
for (const [type, radius, mode] of want) {
  let best = null;
  for (let k = 0; k < 4000 && !best; k++) {
    let x, z;
    if (mode === 'road') {
      const r = w.roads.filter((q) => q.type !== 'rail')[Math.floor(rnd() * 16) % w.roads.filter((q) => q.type !== 'rail').length];
      const i = Math.floor(rnd() * r.points.length);
      const [px, pz] = r.points[i];
      const a = rnd() * Math.PI * 2, d = radius * 0.4 + rnd() * 30;
      x = px + Math.cos(a) * d; z = pz + Math.sin(a) * d;
    } else { x = -5200 + rnd() * 11000; z = -5800 + rnd() * 11400; }
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + radius + (mode === 'remote' ? 500 : 420))) continue;
    if (w.hasWaterIn(x - radius, z - radius, x + radius, z + radius)) continue;
    let mn = 1e9, mx = -1e9, okSlope = true;
    for (let a = 0; a < 8; a++) for (const rr of [0.4, 0.9]) { const h = w.heightAt(x + Math.cos(a) * radius * rr, z + Math.sin(a) * radius * rr); mn = Math.min(mn, h); mx = Math.max(mx, h); }
    if (mx - mn > radius * 0.18) okSlope = false;
    if (!okSlope) continue;
    if (mode === 'remote') { const q = w.roadQuery(x, z, 38); if (q && q.d < 150) continue; }
    if (Math.abs(x) > 5600 || Math.abs(z) > 6000) continue;
    best = { x: Math.round(x), z: Math.round(z) };
  }
  if (!best) { out.push({ type, none: true }); continue; }
  placed.push({ x: best.x, z: best.z, r: radius });
  out.push({ type, radius, pos: [best.x, best.z], region: w.regionAt(best.x, best.z)?.id });
}
console.log(JSON.stringify(out));
