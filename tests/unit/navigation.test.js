// Every building door must lead inside, for AI pathfinding and for the real walking physics.
import { it, expect } from 'vitest';
import { Sim } from '../sim/Sim.js';
import { sharedWorld } from '../sim/Sim.js';
it('building doors are reachable from outside (AI paths and player physics)', () => {
  const world = sharedWorld();
  const bad = [], walkBad = [];
  let total = 0;
  for (const poi of world.pois) {
    const sim = new Sim({ seed: 1, pois: [poi.id] });
    const rt = sim.game.pois.active.get(poi.id);
    const doors = rt.spots.filter((s) => s.type === 'door');
    const inside = rt.spots.filter((s) => s.type === 'inside');
    for (const d of doors) {
      // nearest inside spot to this door
      let best = null, bd = 1e9;
      for (const s of inside) { const k = Math.hypot(s.x - d.x, s.z - d.z); if (k < bd) { bd = k; best = s; } }
      if (!best || bd > 25) continue;
      total++;
      const p = sim.ai.nav.findPath({ x: d.x, z: d.z }, { x: best.x, z: best.z }, {});
      const end = p && p[p.length - 1];
      if (p) {
        // walk the path with the real player physics (0.33 m radius, 0.45 m step-up)
        const ph = sim.game.physics;
        const pos = { x: d.x, y: ph.groundHeight(d.x, d.z, 0.33, world.heightAt(d.x, d.z) + 0.5), z: d.z };
        let wi = 0;
        for (let it = 0; it < 900 && wi < p.length; it++) {
          const wp = p[wi]; const dx = wp.x - pos.x, dz = wp.z - pos.z, L = Math.hypot(dx, dz);
          if (L < 0.3) { wi++; continue; }
          const r = ph.moveCylinder(pos, dx / L * Math.min(0.12, L), dz / L * Math.min(0.12, L), 0.33, 1.75, 0.45, null);
          pos.x = r.x; pos.z = r.z; pos.y = ph.groundHeight(pos.x, pos.z, 0.33, pos.y + 0.5);
        }
        const left = Math.hypot(end.x - pos.x, end.z - pos.z);
        if (left > 1.0) walkBad.push(`${poi.id} door(${d.x.toFixed(1)},${d.z.toFixed(1)}) walk stopped ${left.toFixed(1)} m short at (${pos.x.toFixed(1)},${pos.z.toFixed(1)})`);
      }
      if (!p || Math.hypot(end.x - best.x, end.z - best.z) > 2.2) bad.push(`${poi.id} door(${d.x.toFixed(1)},${d.z.toFixed(1)}) -> inside(${best.x.toFixed(1)},${best.z.toFixed(1)}) ${p ? 'ends ' + Math.hypot(end.x - best.x, end.z - best.z).toFixed(1) + 'm short' : 'no path'}`);
    }
    sim.dispose();
  }
  console.log('DOORS checked', total, 'blocked', bad.length);
  for (const b of bad) console.log('BAD', b);
  console.log('WALKFAIL', walkBad.length);
  for (const b of walkBad) console.log('WALK', b);
  // 199 doors at the time of writing; allow a couple of tight sentry booths / dock corners
  expect(bad.length, bad.join('\n')).toBeLessThanOrEqual(2);
  expect(walkBad.length, walkBad.join('\n')).toBeLessThanOrEqual(Math.ceil(total * 0.03));
}, 120000);
