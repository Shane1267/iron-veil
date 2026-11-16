// Numeric audit of roads and bridges against the terrain.
import { WorldData } from '../../src/world/WorldData.js';
const w = new WorldData();
const report = { roads: 0, points: 0, floating: [], sunk: [], bridges: [], deadEnds: [], steep: [] };
const ribbon = (road, i, x, z) => { const d = w.bridgeAt(x, z); const h = road.heights[i]; return d !== null ? Math.max(d, h) : h; };
for (const road of w.roads) {
  if (road.type === 'rail') continue;
  report.roads++;
  for (let i = 0; i < road.points.length - 1; i++) {
    const [ax, az] = road.points[i], [bx, bz] = road.points[i + 1];
    for (const t of [0, 0.25, 0.5, 0.75]) {
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const rh = road.heights[i] + (road.heights[i + 1] - road.heights[i]) * t;
      const deck = w.bridgeAt(x, z);
      const surf = deck !== null ? Math.max(deck, rh) : rh;
      const g = w.heightAt(x, z);
      report.points++;
      if (deck === null && w.waterAt(x, z) === null) {
        if (surf + 0.07 - g > 0.6) report.floating.push({ road: road.id, i, x: x | 0, z: z | 0, gap: +(surf - g).toFixed(2) });
        if (g - (surf + 0.07) > 0.25) report.sunk.push({ road: road.id, i, x: x | 0, z: z | 0, gap: +(g - surf).toFixed(2) });
      } else if (deck === null) report.floating.push({ road: road.id, i, x: x | 0, z: z | 0, water: true });
    }
    const grade = Math.abs(road.heights[i + 1] - road.heights[i]) / Math.hypot(bx - ax, bz - az);
    if (grade > 0.22) report.steep.push({ road: road.id, i, grade: +grade.toFixed(2) });
  }
}
for (const b of w.bridges) {
  const R = b.road;
  // road height just outside each end vs deck
  const ends = [[b.ax, b.az], [b.bx, b.bz]].map(([x, z]) => { const q = w.roadQuery(x, z); return q ? +(b.deck - q.h).toFixed(2) : null; });
  report.bridges.push({ road: R.id, type: R.type, at: [b.ax | 0, b.az | 0], len: Math.hypot(b.bx - b.ax, b.bz - b.az) | 0, deck: +b.deck.toFixed(1), stepAtEnds: ends });
}
const summ = { roads: report.roads, points: report.points, floating: report.floating.length, sunk: report.sunk.length, steep: report.steep.length, bridges: report.bridges.length, badBridges: report.bridges.filter((b) => b.stepAtEnds.some((s) => s === null || Math.abs(s) > 0.4)).length };
console.log(JSON.stringify(summ));
if (process.argv.includes('--detail')) console.log(JSON.stringify({ floating: report.floating.slice(0, 30), sunk: report.sunk.slice(0, 30), steep: report.steep.slice(0, 20), bridges: report.bridges }, null, 0));
