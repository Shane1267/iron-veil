import { Frame } from './BuildingGenerator.js';
import vehicleData from '../data/vehicles.json';

// Exterior set dressing. Small props (pallets, crates, barrels, tyres, bins, AC units, gas
// bottles, pipe stacks, generators, tool carts, sandbags, benches, planters, ground stains,
// weeds, litter and so on) and `dress()`, which every location runs as its last build step:
// it lines building walls with fitting props and fills open ground between structures,
// keeping clear of doors, roads, water and anything already there. The mix depends on the
// kind of place (residential, industrial, military, farm, wild, abandoned).

const N = { collide: false };
const pick = (r, list) => list[Math.floor(r.next() * list.length) % list.length];

// each prop: [radius, fn(S, F, r, ctx)] — F is a Frame at the spot, local +z faces outward
export const PROPS = {
  pallets: [0.9, (S, F, r) => {
    const n = 1 + r.int(0, 4);
    for (let i = 0; i < n; i++) { S.box(F, 'wood', 0, 0.07 + i * 0.15, 0, 1.2, 0.03, 1.0, { collide: false, rotY: (r.next() - 0.5) * 0.25 }); for (const z of [-0.42, 0, 0.42]) S.box(F, 'wood_dark', 0, 0.035 + i * 0.15 - 0.02, z, 1.2, 0.09, 0.1, N); }
    S.box(F, 'wood', 0, n * 0.075, 0, 1.2, n * 0.15, 1.0, { visible: false });
    if (r.chance(0.5)) { S.box(F, pick(r, ['canvas_tan', 'olive', 'corrugated_blue', 'wood_dark']), 0, n * 0.15 + 0.3, 0, 1.0, 0.6, 0.8); S.box(F, 'black', 0, n * 0.15 + 0.3, 0, 1.02, 0.03, 0.82, N); }
  }],
  crates: [1.0, (S, F, r, ctx, poi, state) => {
    const mats = ['wood_dark', 'olive', 'wood', 'canvas_tan'];
    const m = pick(r, mats);
    S.box(F, m, -0.35, 0.35, 0, 0.7, 0.7, 0.7); S.box(F, 'wood_dark', -0.35, 0.71, 0, 0.72, 0.03, 0.72, N);
    S.box(F, pick(r, mats), 0.42, 0.3, 0.1, 0.6, 0.6, 0.6, { rotY: 0.3 });
    if (r.chance(0.6)) S.box(F, pick(r, mats), -0.2, 0.98, 0.05, 0.5, 0.5, 0.5, { collide: false, rotY: 0.5 });
    for (const sx of [-0.7, 0]) S.box(F, 'wood_dark', sx - 0.0, 0.35, 0.355, 0.06, 0.7, 0.02, N);
    if (state.loot < 3 && r.chance(0.3)) { state.loot++; ctx.containers.push({ x: F.wx(-0.35, 0.5), y: F.y + 0.8, z: F.wz(-0.35, 0.5), name: 'Crate', profile: poi.loot || 'industrial', capacity: 6, kind: 'crate' }); }
  }],
  barrels: [0.9, (S, F, r) => {
    const n = 2 + r.int(0, 3);
    for (let i = 0; i < n; i++) {
      const lx = (i % 2) * 0.68 - 0.34 + (r.next() - 0.5) * 0.1, lz = Math.floor(i / 2) * 0.68 - 0.3;
      const m = pick(r, ['paint_red', 'corrugated_blue', 'rust', 'olive', 'black', 'paint_yellow']);
      if (i === n - 1 && r.chance(0.3)) { S.cyl(F, m, lx + 0.5, 0.3, lz + 0.6, 0.3, 0.9, 10, { rotX: Math.PI / 2, collide: false }); continue; }
      S.cyl(F, m, lx, 0.45, lz, 0.3, 0.9, 10);
      S.cyl(F, 'metal_dark', lx, 0.3, lz, 0.31, 0.03, 10, N); S.cyl(F, 'metal_dark', lx, 0.62, lz, 0.31, 0.03, 10, N);
    }
  }],
  tyres: [0.7, (S, F, r) => {
    const n = 2 + r.int(0, 4);
    for (let i = 0; i < n; i++) S.cyl(F, 'black', (r.next() - 0.5) * 0.08, 0.11 + i * 0.22, (r.next() - 0.5) * 0.08, 0.36, 0.22, 12, { collide: i === 0 });
    if (r.chance(0.5)) S.cyl(F, 'black', 0.7, 0.36, 0.1, 0.36, 0.22, 12, { rotZ: Math.PI / 2 - 0.25, collide: false });
  }],
  spool: [0.9, (S, F, r) => {
    const lay = r.chance(0.5);
    if (lay) { S.cyl(F, 'wood', 0, 0.04, 0, 0.7, 0.07, 14, N); S.cyl(F, 'wood_dark', 0, 0.4, 0, 0.35, 0.7, 12); S.cyl(F, 'wood', 0, 0.78, 0, 0.7, 0.07, 14, N); }
    else { for (const sx of [-0.36, 0.36]) S.cyl(F, 'wood', sx, 0.7, 0, 0.7, 0.07, 14, { rotZ: Math.PI / 2, collide: false }); S.cyl(F, 'black', 0, 0.7, 0, 0.4, 0.66, 12, { rotZ: Math.PI / 2 }); }
  }],
  cones: [0.6, (S, F, r) => { for (let i = 0; i < 2 + r.int(0, 2); i++) { const lx = i * 0.5 - 0.5, lz = (r.next() - 0.5) * 0.5; S.box(F, 'black', lx, 0.02, lz, 0.3, 0.04, 0.3, N); S.cyl(F, 'paint_red', lx, 0.3, lz, 0.03, 0.55, 8, { rBot: 0.12, collide: false }); S.cyl(F, 'paint_white', lx, 0.34, lz, 0.065, 0.08, 8, N); } }],
  bins: [0.7, (S, F, r) => { for (let i = 0; i < 1 + r.int(0, 2); i++) { const lx = i * 0.66 - 0.33; const m = pick(r, ['wood_green', 'metal_dark', 'corrugated_blue']); S.box(F, m, lx, 0.5, 0, 0.56, 0.95, 0.6); S.box(F, m, lx, 1.0, 0.02, 0.6, 0.06, 0.66, { collide: false, rotX: r.chance(0.3) ? -0.5 : 0 }); S.cyl(F, 'black', lx - 0.2, 0.09, -0.26, 0.09, 0.05, 8, { rotZ: Math.PI / 2, collide: false }); S.cyl(F, 'black', lx + 0.2, 0.09, -0.26, 0.09, 0.05, 8, { rotZ: Math.PI / 2, collide: false }); } }],
  acUnit: [0.6, (S, F) => { S.box(F, 'metal', 0, 0.45, -0.1, 0.9, 0.7, 0.4); S.box(F, 'metal_dark', 0, 0.45, 0.105, 0.5, 0.5, 0.01, N); for (let i = -2; i <= 2; i++) S.box(F, 'black', i * 0.1, 0.45, 0.112, 0.015, 0.46, 0.004, N); S.box(F, 'concrete', 0, 0.05, -0.1, 1.0, 0.1, 0.5, N); S.cyl(F, 'black', 0.35, 1.3, -0.28, 0.02, 1.0, 5, N); }],
  gasBottles: [0.5, (S, F, r) => { for (let i = 0; i < 2 + r.int(0, 2); i++) { const lx = i * 0.3 - 0.3; const m = pick(r, ['paint_red', 'paint_white', 'corrugated_blue', 'olive']); S.cyl(F, m, lx, 0.6, -0.12, 0.12, 1.2, 8, { collide: i === 0 }); S.cyl(F, 'metal', lx, 1.25, -0.12, 0.04, 0.12, 6, N); } S.box(F, 'metal_dark', 0, 0.8, 0.02, 1.0, 0.03, 0.03, N); }],
  meterBox: [0.4, (S, F) => { S.box(F, 'metal', 0, 1.3, -0.14, 0.5, 0.7, 0.16, N); S.box(F, 'metal_dark', 0, 1.3, -0.055, 0.42, 0.6, 0.01, N); S.box(F, 'paint_yellow', 0, 1.45, -0.048, 0.12, 0.1, 0.004, N); S.cyl(F, 'metal_dark', 0.1, 0.48, -0.16, 0.03, 0.95, 6, N); S.cyl(F, 'metal_dark', -0.1, 2.3, -0.16, 0.025, 1.3, 6, N); }],
  drainPipe: [0.3, (S, F) => { S.cyl(F, 'metal_dark', 0, 1.6, -0.14, 0.05, 3.2, 6, N); S.box(F, 'metal_dark', 0, 0.12, -0.02, 0.1, 0.1, 0.3, { collide: false, rotX: 0.5 }); for (const y of [0.8, 2.2]) S.box(F, 'metal', 0, y, -0.16, 0.14, 0.04, 0.06, N); }],
  ladder: [0.5, (S, F) => { for (const sx of [-0.22, 0.22]) S.box(F, 'metal', sx, 1.5, -0.42, 0.04, 3.1, 0.04, { collide: false, rotX: -0.22 }); for (let i = 0; i < 9; i++) S.box(F, 'metal', 0, 0.3 + i * 0.32, -0.08 - i * 0.075, 0.44, 0.03, 0.03, N); }],
  firewood: [0.8, (S, F, r) => { for (let row = 0; row < 3; row++) for (let i = 0; i < 5 - row; i++) S.cyl(F, r.chance(0.5) ? 'logs' : 'wood_dark', -0.6 + i * 0.3 + row * 0.15, 0.14 + row * 0.26, -0.1, 0.13, 0.5, 7, { rotX: Math.PI / 2, collide: false }); S.box(F, 'wood', 0, 0.4, -0.1, 1.5, 0.8, 0.5, { visible: false }); }],
  pipeStack: [1.2, (S, F, r) => { const m = pick(r, ['rust', 'metal_dark', 'concrete']); for (let row = 0; row < 2; row++) for (let i = 0; i < 3 - row; i++) S.cyl(F, m, -0.4 + i * 0.4 + row * 0.2, 0.2 + row * 0.35, 0, 0.19, 3.0, 10, { rotX: Math.PI / 2, collide: false, open: true }); S.box(F, m, 0, 0.35, 0, 1.3, 0.7, 3.0, { visible: false }); for (const z of [-1, 1]) S.box(F, 'wood_dark', 0, 0.03, z, 1.5, 0.06, 0.1, N); }],
  tarpPile: [1.1, (S, F, r) => { const m = pick(r, ['corrugated_blue', 'olive', 'canvas_tan', 'canvas']); S.box(F, m, 0, 0.45, 0, 1.6, 0.9, 1.2); S.box(F, m, 0.1, 0.95, 0, 1.0, 0.25, 0.8, { collide: false, rotZ: 0.1 }); S.box(F, m, 0, 0.1, 0, 1.9, 0.04, 1.5, N); for (const [x, z] of [[-0.9, -0.7], [0.9, 0.7], [0.9, -0.7]]) S.box(F, 'concrete_dark', x, 0.08, z, 0.25, 0.14, 0.2, N); }],
  generator: [1.0, (S, F) => { S.box(F, 'paint_yellow', 0, 0.6, 0, 1.5, 0.9, 0.8); S.box(F, 'black', 0, 0.12, 0, 1.4, 0.14, 0.7, N); S.box(F, 'metal_dark', 0.4, 0.65, 0.405, 0.5, 0.5, 0.01, N); S.box(F, 'black', -0.4, 0.7, 0.405, 0.4, 0.3, 0.01, N); S.cyl(F, 'metal_dark', -0.5, 1.3, -0.2, 0.05, 0.5, 6, N); S.cyl(F, 'black', 0.9, 0.3, 0, 0.3, 0.14, 10, { rotZ: Math.PI / 2, collide: false }); S.box(F, 'metal', 1.3, 0.35, 0, 0.7, 0.05, 0.05, N); }],
  toolCart: [0.7, (S, F) => { S.box(F, 'paint_red', 0, 0.55, 0, 0.9, 0.7, 0.5); for (const y of [0.35, 0.55, 0.75]) { S.box(F, 'metal_dark', 0, y, 0.255, 0.8, 0.015, 0.01, N); S.box(F, 'metal', 0, y + 0.07, 0.265, 0.3, 0.02, 0.02, N); } S.box(F, 'metal_dark', 0, 0.92, 0, 0.94, 0.03, 0.54, N); for (const [x, z] of [[-0.38, -0.2], [0.38, -0.2], [-0.38, 0.2], [0.38, 0.2]]) S.cyl(F, 'black', x, 0.08, z, 0.08, 0.05, 8, { rotZ: Math.PI / 2, collide: false }); S.box(F, 'metal', 0.1, 0.97, 0.05, 0.3, 0.03, 0.06, N); }],
  bollards: [0.6, (S, F, r) => { for (let i = -1; i <= 1; i++) { S.cyl(F, r.chance(0.5) ? 'paint_yellow' : 'concrete', i * 1.4, 0.45, 0, 0.11, 0.9, 8); S.cyl(F, 'black', i * 1.4, 0.7, 0, 0.115, 0.1, 8, N); } }],
  sandbagPile: [1.0, (S, F, r) => { for (let row = 0; row < 3; row++) for (let i = 0; i < 3 - row; i++) S.box(F, 'sand', -0.6 + i * 0.62 + row * 0.3, 0.14 + row * 0.26, (r.next() - 0.5) * 0.08, 0.6, 0.26, 0.38, { collide: row === 0 && i === 1, rotY: (r.next() - 0.5) * 0.2 }); }],
  ammoStack: [0.9, (S, F, r) => { for (let i = 0; i < 3 + r.int(0, 3); i++) { const lx = (i % 2) * 0.82 - 0.4, ly = Math.floor(i / 2) * 0.4; S.box(F, 'olive', lx, 0.2 + ly, 0, 0.78, 0.38, 0.46, { collide: ly === 0 }); S.box(F, 'paint_yellow', lx, 0.2 + ly, 0.232, 0.3, 0.08, 0.004, N); S.box(F, 'metal_dark', lx, 0.33 + ly, 0.235, 0.78, 0.02, 0.01, N); } }],
  jerrycans: [0.6, (S, F, r) => { for (let i = 0; i < 2 + r.int(0, 3); i++) { const m = r.chance(0.7) ? 'olive' : 'paint_red'; S.box(F, m, i * 0.24 - 0.4, 0.24, 0, 0.18, 0.46, 0.34, { collide: false, rotY: (r.next() - 0.5) * 0.3 }); S.box(F, 'metal_dark', i * 0.24 - 0.4, 0.5, 0.08, 0.08, 0.06, 0.08, N); } }],
  antenna: [0.5, (S, F) => { S.box(F, 'concrete', 0, 0.15, 0, 0.6, 0.3, 0.6); S.cyl(F, 'metal', 0, 3.3, 0, 0.04, 6, 6, N); for (const y of [4.2, 5.0, 5.8]) S.box(F, 'metal', 0, y, 0, 1.2 - (y - 4.2) * 0.3, 0.03, 0.03, N); for (const a of [0, 2.1, 4.2]) S.box(F, 'metal_dark', Math.cos(a) * 0.9, 1.5, Math.sin(a) * 0.9, 0.015, 3.5, 0.015, { collide: false, rotZ: Math.cos(a) * 0.52, rotX: -Math.sin(a) * 0.52 }); }],
  bench: [0.9, (S, F) => { for (const sx of [-0.7, 0.7]) { S.box(F, 'metal_dark', sx, 0.22, 0, 0.06, 0.44, 0.44, N); S.box(F, 'metal_dark', sx, 0.66, -0.2, 0.06, 0.5, 0.05, N); } for (const z of [-0.12, 0.02, 0.16]) S.box(F, 'wood', 0, 0.46, z, 1.6, 0.04, 0.12, N); for (const y of [0.66, 0.82]) S.box(F, 'wood', 0, y, -0.22, 1.6, 0.11, 0.03, N); S.box(F, 'wood', 0, 0.3, 0, 1.6, 0.6, 0.44, { visible: false }); }],
  planter: [0.7, (S, F, r) => { S.box(F, pick(r, ['wood_dark', 'concrete', 'wood']), 0, 0.22, 0, 1.2, 0.44, 0.5); S.box(F, 'dirt', 0, 0.45, 0, 1.1, 0.02, 0.4, N); for (let i = 0; i < 5; i++) S.box(F, r.chance(0.3) ? 'paint_red' : 'wood_green', -0.45 + i * 0.22, 0.6 + r.next() * 0.12, (r.next() - 0.5) * 0.2, 0.14, 0.3, 0.14, { collide: false, rotY: r.next() * 3 }); }],
  mailbox: [0.4, (S, F, r) => { S.box(F, 'wood_dark', 0, 0.55, 0, 0.08, 1.1, 0.08, N); S.box(F, pick(r, ['metal', 'paint_red', 'corrugated_blue']), 0, 1.18, 0.05, 0.2, 0.2, 0.42, N); S.box(F, 'paint_red', 0.11, 1.26, 0.1, 0.01, 0.12, 0.03, N); }],
  hydrant: [0.4, (S, F) => { S.cyl(F, 'paint_red', 0, 0.35, 0, 0.11, 0.7, 8); S.cyl(F, 'paint_red', 0, 0.72, 0, 0.08, 0.1, 8, N); S.cyl(F, 'metal', 0, 0.45, 0, 0.05, 0.36, 6, { rotZ: Math.PI / 2, collide: false }); }],
  bikeRack: [0.9, (S, F) => { for (let i = -2; i <= 2; i++) { S.box(F, 'metal', i * 0.35, 0.4, 0, 0.03, 0.8, 0.03, N); } S.box(F, 'metal', 0, 0.8, 0, 1.5, 0.03, 0.03, N); S.box(F, 'metal', 0, 0.03, 0, 1.5, 0.03, 0.03, N); for (const a of [-0.3, 0.3]) { S.cyl(F, 'black', -0.35, 0.33, a * 1.6, 0.32, 0.03, 12, { rotZ: Math.PI / 2, collide: false, open: true }); } S.box(F, 'paint_red', -0.35, 0.55, 0, 0.03, 0.03, 0.9, { collide: false, rotX: 0.2 }); }],
  roadSign: [0.3, (S, F, r) => { S.cyl(F, 'metal', 0, 1.2, 0, 0.03, 2.4, 6, N); const k = r.int(0, 3); if (k === 0) S.box(F, 'paint_red', 0, 2.2, 0.03, 0.55, 0.55, 0.02, { collide: false, rotZ: Math.PI / 4 }); else if (k === 1) S.box(F, 'paint_yellow', 0, 2.2, 0.03, 0.6, 0.6, 0.02, { collide: false, rotZ: Math.PI / 4 }); else S.box(F, 'corrugated_blue', 0, 2.15, 0.03, 0.8, 0.4, 0.02, N); S.box(F, 'paint_white', 0, 2.2, 0.045, 0.3, 0.08, 0.004, N); }],
  fenceBit: [1.2, (S, F, r) => { const lean = (r.next() - 0.5) * 0.5; for (const sx of [-1, 0, 1]) S.box(F, 'wood_dark', sx, 0.5, 0, 0.09, 1.0, 0.09, { collide: false, rotX: lean }); S.box(F, 'wood', 0, 0.75, lean * 0.3, 2.1, 0.1, 0.03, { collide: false, rotZ: 0.04 }); if (r.chance(0.6)) S.box(F, 'wood', 0.2, 0.3, lean * 0.1, 1.7, 0.1, 0.03, { collide: false, rotZ: -0.12 }); }],
  wheelbarrow: [0.7, (S, F) => { S.box(F, 'rust', 0, 0.45, 0, 0.6, 0.3, 0.9, { rotX: -0.12 }); S.cyl(F, 'black', 0, 0.2, 0.55, 0.2, 0.08, 10, { rotZ: Math.PI / 2, collide: false }); for (const sx of [-0.3, 0.3]) { S.box(F, 'wood', sx, 0.5, -0.75, 0.04, 0.04, 0.7, N); S.box(F, 'metal_dark', sx, 0.2, -0.3, 0.03, 0.4, 0.03, N); } S.box(F, 'dirt', 0, 0.56, 0, 0.5, 0.1, 0.7, N); }],
  milkCans: [0.5, (S, F, r) => { for (let i = 0; i < 2 + r.int(0, 2); i++) { S.cyl(F, 'metal', i * 0.36 - 0.36, 0.3, 0, 0.15, 0.6, 10, { collide: i === 0 }); S.cyl(F, 'metal', i * 0.36 - 0.36, 0.66, 0, 0.09, 0.14, 8, N); } }],
  feedSacks: [0.7, (S, F, r) => { for (let i = 0; i < 3 + r.int(0, 3); i++) S.box(F, r.chance(0.5) ? 'canvas_tan' : 'paint_white', (i % 2) * 0.1, 0.1 + i * 0.17, 0, 0.75, 0.17, 0.45, { collide: i === 0, rotY: (r.next() - 0.5) * 0.5 }); }],
  scarecrow: [0.5, (S, F) => { S.box(F, 'wood_dark', 0, 1.0, 0, 0.07, 2.0, 0.07, N); S.box(F, 'wood_dark', 0, 1.5, 0, 1.3, 0.06, 0.06, N); S.box(F, 'fabric_red', 0, 1.3, 0, 0.5, 0.6, 0.2, N); S.box(F, 'canvas_tan', 0, 1.85, 0, 0.26, 0.28, 0.24, N); S.box(F, 'hay', 0, 2.03, 0, 0.5, 0.06, 0.5, N); }],
  campChairs: [0.9, (S, F, r) => { for (let i = 0; i < 2; i++) { const lx = i * 0.9 - 0.45; S.box(F, pick(r, ['canvas', 'fabric_blue', 'olive']), lx, 0.42, 0, 0.5, 0.03, 0.45, { collide: false, rotY: i ? -0.4 : 0.4 }); S.box(F, 'metal_dark', lx, 0.2, 0, 0.45, 0.4, 0.03, { collide: false, rotY: i ? -0.4 : 0.4 }); S.box(F, 'canvas', lx, 0.7, -0.22, 0.5, 0.45, 0.03, { collide: false, rotY: i ? -0.4 : 0.4 }); } S.box(F, 'wood_dark', 0, 0.2, 0.7, 0.5, 0.4, 0.4, N); }],
  dryingLine: [1.5, (S, F, r) => { for (const sx of [-1.5, 1.5]) S.box(F, 'wood_dark', sx, 1.0, 0, 0.07, 2.0, 0.07, N); S.box(F, 'black', 0, 1.9, 0, 3.0, 0.015, 0.015, N); for (let i = 0; i < 4; i++) S.box(F, pick(r, ['paint_white', 'fabric_blue', 'fabric_red', 'canvas_tan']), -1.1 + i * 0.7, 1.6, 0, 0.45, 0.55, 0.02, N); }],
  rubble: [1.0, (S, F, r) => { for (let i = 0; i < 5; i++) S.box(F, pick(r, ['concrete_dark', 'concrete', 'brick', 'rust']), (r.next() - 0.5) * 1.6, 0.12 + r.next() * 0.2, (r.next() - 0.5) * 1.4, 0.3 + r.next() * 0.7, 0.2 + r.next() * 0.3, 0.3 + r.next() * 0.6, { collide: false, rotY: r.next() * 3, rotZ: (r.next() - 0.5) * 0.6 }); S.box(F, 'wood_dark', 0.3, 0.3, 0, 2.0, 0.07, 0.16, { collide: false, rotY: r.next() * 3, rotZ: 0.25 }); }],
  scrapHeap: [1.3, (S, F, r) => { S.box(F, 'rust', 0, 0.35, 0, 1.6, 0.7, 1.4); for (let i = 0; i < 6; i++) S.box(F, pick(r, ['rust', 'metal_dark', 'corrugated_rust', 'metal']), (r.next() - 0.5) * 2, 0.4 + r.next() * 0.6, (r.next() - 0.5) * 1.8, 0.4 + r.next() * 1.1, 0.04 + r.next() * 0.3, 0.3 + r.next() * 0.9, { collide: false, rotY: r.next() * 3, rotZ: (r.next() - 0.5) * 1.0, rotX: (r.next() - 0.5) * 0.8 }); S.cyl(F, 'black', 0.9, 0.2, 0.7, 0.35, 0.2, 10, { collide: false, rotX: 0.4 }); }],
  // ground decals and growth (no collision)
  oilStain: [0, (S, F, r) => S.box(F, 'black', 0, 0.035, 0, 1.2 + r.next() * 1.6, 0.012, 0.9 + r.next() * 1.4, { collide: false, rotY: r.next() * 3 })],
  dirtPatch: [0, (S, F, r) => S.box(F, 'dirt', 0, 0.03, 0, 1.5 + r.next() * 2.5, 0.012, 1.2 + r.next() * 2, { collide: false, rotY: r.next() * 3 })],
  litter: [0, (S, F, r) => { for (let i = 0; i < 4 + r.int(0, 4); i++) S.box(F, pick(r, ['paint_white', 'canvas_tan', 'corrugated_blue', 'paint_red', 'metal']), (r.next() - 0.5) * 2.4, 0.04, (r.next() - 0.5) * 2.4, 0.08 + r.next() * 0.25, 0.015 + r.next() * 0.08, 0.08 + r.next() * 0.2, { collide: false, rotY: r.next() * 3 }); }],
  weeds: [0, (S, F, r) => { for (let i = 0; i < 5 + r.int(0, 5); i++) { const lx = (r.next() - 0.5) * 2, lz = (r.next() - 0.5) * 2, hh = 0.25 + r.next() * 0.5; S.box(F, r.chance(0.25) ? 'hay' : 'wood_green', lx, hh / 2, lz, 0.05, hh, 0.22, { collide: false, rotY: r.next() * 3, rotZ: (r.next() - 0.5) * 0.4 }); S.box(F, 'wood_green', lx, hh / 2, lz, 0.22, hh * 0.8, 0.05, { collide: false, rotY: r.next() * 3 }); } }],
  planks: [0, (S, F, r) => { for (let i = 0; i < 3 + r.int(0, 3); i++) S.box(F, r.chance(0.5) ? 'wood' : 'wood_dark', (r.next() - 0.5) * 1.2, 0.05 + i * 0.04, (r.next() - 0.5) * 0.8, 2 + r.next() * 1.2, 0.04, 0.16, { collide: false, rotY: (r.next() - 0.5) * 0.7 }); }],
  bricks: [0, (S, F, r) => { for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) if (r.chance(0.8)) S.box(F, 'brick', j * 0.24 - 0.36, 0.06 + i * 0.12, 0, 0.22, 0.1, 0.44, N); }],
};

const STYLES = {
  residential: {
    wall: ['bins', 'bins', 'acUnit', 'meterBox', 'drainPipe', 'drainPipe', 'firewood', 'planter', 'planter', 'bench', 'ladder', 'gasBottles', 'crates'],
    yard: ['bench', 'planter', 'mailbox', 'hydrant', 'bikeRack', 'roadSign', 'fenceBit', 'dryingLine', 'wheelbarrow', 'tyres', 'pallets', 'bins'],
    ground: ['weeds', 'weeds', 'litter', 'dirtPatch', 'oilStain', 'planks'], density: 1,
  },
  industrial: {
    wall: ['acUnit', 'meterBox', 'drainPipe', 'gasBottles', 'gasBottles', 'pallets', 'barrels', 'crates', 'ladder', 'bins', 'pipeStack', 'toolCart'],
    yard: ['pallets', 'pallets', 'barrels', 'barrels', 'crates', 'spool', 'spool', 'pipeStack', 'tarpPile', 'generator', 'tyres', 'cones', 'bollards', 'scrapHeap', 'toolCart', 'roadSign'],
    ground: ['oilStain', 'oilStain', 'dirtPatch', 'litter', 'weeds', 'planks', 'bricks'], density: 1.25,
  },
  military: {
    wall: ['ammoStack', 'crates', 'jerrycans', 'sandbagPile', 'meterBox', 'drainPipe', 'gasBottles', 'generator', 'barrels', 'ladder', 'antenna'],
    yard: ['ammoStack', 'ammoStack', 'crates', 'sandbagPile', 'sandbagPile', 'jerrycans', 'barrels', 'tarpPile', 'generator', 'bollards', 'cones', 'pallets', 'tyres', 'antenna', 'spool'],
    ground: ['dirtPatch', 'oilStain', 'weeds', 'litter'], density: 1.2,
  },
  farm: {
    wall: ['firewood', 'milkCans', 'feedSacks', 'barrels', 'ladder', 'drainPipe', 'wheelbarrow', 'crates', 'tyres', 'planter'],
    yard: ['wheelbarrow', 'feedSacks', 'milkCans', 'fenceBit', 'fenceBit', 'scarecrow', 'pallets', 'tyres', 'barrels', 'firewood', 'dryingLine', 'scrapHeap'],
    ground: ['weeds', 'weeds', 'dirtPatch', 'dirtPatch', 'planks'], density: 0.9,
  },
  wild: {
    wall: ['firewood', 'firewood', 'barrels', 'crates', 'ladder', 'jerrycans'],
    yard: ['campChairs', 'firewood', 'dryingLine', 'crates', 'barrels', 'tarpPile', 'tyres', 'fenceBit', 'jerrycans'],
    ground: ['weeds', 'weeds', 'dirtPatch', 'planks', 'litter'], density: 0.8,
  },
};

export function styleFor(poi) {
  const t = `${poi.type} ${poi.id}`.toLowerCase();
  let s = 'residential';
  if (/mil|base|outpost|depot|guard|launch|airfield|bunker|underground|checkpoint|evac|research|motor/.test(t)) s = 'military';
  else if (/farm|granary|barn|orchard|ranch/.test(t)) s = 'farm';
  else if (/indust|factory|yard|mine|quarry|dam|fuel|rail|storage|mainten|garage|port|dock|saw|lumber|power|treatment|scrap|junk|substation|warehouse/.test(t)) s = 'industrial';
  else if (/camp|cabin|hunt|ranger|radio|holdout|tower|lookout|trader|settlement/.test(t)) s = 'wild';
  return { name: s, abandoned: /abandon|ghost|ruin|holdout|scrap|junk/.test(t) };
}

/**
 * Dress a location. Runs after every other build command, so anything already placed has
 * its colliders and is avoided.
 */
export function dress(S, ctx, world, poi, rng) {
  if (poi.noDress) return;
  const { name, abandoned } = styleFor(poi);
  const st = STYLES[name];
  const state = { loot: 0 };
  const physics = ctx.physics;
  const rects = ctx.buildings.map((b) => { const [w, d] = b.rot % 2 ? [b.d, b.w] : [b.w, b.d]; return [b.x - w / 2, b.z - d / 2, b.x + w / 2, b.z + d / 2]; });
  const inBuilding = (x, z, m = 0.2) => rects.some((r) => x > r[0] - m && x < r[2] + m && z > r[1] - m && z < r[3] + m);
  const nearDoor = (x, z, d = 2.4) => ctx.doors.some((q) => Math.hypot(q.x - x, q.z - z) < d) || (ctx.gates || []).some((q) => Math.hypot(q.x - x, q.z - z) < 8) || (ctx.lifts || []).some((q) => Math.hypot(q.x - x, q.z - z) < 3);
  const parked = vehicleData.spawns.map((v) => v.pos).filter(([vx, vz]) => Math.hypot(vx - poi.x, vz - poi.z) < poi.radius + 40);
  const free = (x, z, rad) => {
    if (world.waterAt(x, z) !== null) return false;
    for (const [vx, vz] of parked) if (Math.hypot(vx - x, vz - z) < 11 + rad) return false; // room to drive a parked vehicle away
    const r = world.roadQuery(x, z);
    if (r && r.d < r.width * 0.5 + rad + 0.6) return false;
    const y = world.heightAt(x, z);
    if (rad > 0) {
      for (const [ox, oz] of [[rad, 0], [-rad, 0], [0, rad], [0, -rad]]) if (Math.abs(world.heightAt(x + ox, z + oz) - y) > 0.3) return false;
      if (physics.overlapsCylinder(x, y + 0.5, z, rad + 0.25, 1.4)) return false;
    }
    return true;
  };
  const put = (id, x, z, rot) => {
    const [, fn] = PROPS[id];
    const F = new Frame(x, world.heightAt(x, z), z, rot);
    fn(S, F, rng, ctx, poi, state);
  };
  // 1. along building walls
  ctx.buildings.forEach((b) => {
    const F = new Frame(b.x, 0, b.z, b.rot);
    const sides = [['S', b.w, b.d / 2, 0], ['N', b.w, -b.d / 2, 2], ['E', b.d, b.w / 2, 1], ['W', b.d, -b.w / 2, 3]];
    for (const [side, len, off, rq] of sides) {
      const n = Math.max(1, Math.round(len / 4.5 * st.density));
      for (let i = 0; i < n; i++) {
        if (!rng.chance(0.75)) continue;
        const id = rng.pick(st.wall);
        const rad = PROPS[id][0];
        const t = (i + 0.2 + rng.next() * 0.6) / n * len - len / 2;
        if (Math.abs(t) > len / 2 - rad - 0.2) continue;
        const out = Math.abs(off) + rad * 0.55 + 0.42;
        const s = Math.sign(off) || 1;
        const [lx, lz] = side === 'S' || side === 'N' ? [t, s * out] : [s * out, t];
        const x = F.wx(lx, lz), z = F.wz(lx, lz);
        if (nearDoor(x, z) || inBuilding(x, z, 0.05) || !free(x, z, rad)) continue;
        // prop rotation: its local +z points away from the wall
        put(id, x, z, (b.rot + rq) % 4);
      }
    }
  });
  // 2. open ground: clustered props, then stains and growth
  const R = poi.radius * 0.86;
  const area = Math.PI * R * R;
  const want = Math.min(70, Math.round(area * 0.0016 * st.density * (abandoned ? 1.3 : 1)));
  let placed = 0;
  for (let k = 0; k < want * 5 && placed < want; k++) {
    const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * R;
    let x = poi.x + Math.cos(a) * d, z = poi.z + Math.sin(a) * d;
    const group = 1 + (rng.chance(0.45) ? rng.int(1, 2) : 0);
    for (let j = 0; j < group; j++) {
      const id = abandoned && rng.chance(0.3) ? rng.pick(['rubble', 'scrapHeap', 'fenceBit', 'tyres']) : rng.pick(st.yard);
      const rad = PROPS[id][0];
      if (!inBuilding(x, z, rad + 0.3) && !nearDoor(x, z, 3) && free(x, z, rad)) { put(id, x, z, rng.int(0, 3)); placed++; }
      x += (rng.next() - 0.5) * 5; z += (rng.next() - 0.5) * 5;
    }
  }
  const decals = Math.min(60, Math.round(area * 0.0018 * (abandoned ? 1.8 : 1)));
  for (let k = 0; k < decals; k++) {
    const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * R;
    const x = poi.x + Math.cos(a) * d, z = poi.z + Math.sin(a) * d;
    if (inBuilding(x, z, 0.4) || world.waterAt(x, z) !== null) continue;
    const y = world.heightAt(x, z);
    if (Math.abs(world.heightAt(x + 1.2, z) - y) > 0.12 || Math.abs(world.heightAt(x, z + 1.2) - y) > 0.12) continue;
    const id = abandoned && rng.chance(0.4) ? 'weeds' : rng.pick(st.ground);
    if ((id === 'oilStain' || id === 'dirtPatch') && physics.overlapsCylinder(x, y + 0.3, z, 0.3, 1)) continue;
    put(id, x, z, 0);
  }
}
