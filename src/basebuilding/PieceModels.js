import { BoxBuilder } from '../world/GeometryKit.js';

// Geometry for every buildable piece, authored in piece-local space (centre of the
// 3 m cell at the piece's base, +z = outward face for wall pieces).

export function buildPieceMesh(type, materials, opts = {}) {
  const B = new BoxBuilder(materials);
  const W = 'wood', WD = 'wood_dark';
  switch (type) {
    case 'foundation': {
      const legs = Math.max(0.3, opts.legs || 0.6);
      B.box(W, 0, -0.08, 0, 3, 0.16, 3);
      B.box(WD, 0, -0.26, 0, 3.02, 0.2, 3.02, { faceShade: [0.8, 0.8, 0.8, 0.6, 0.8, 0.8] });
      for (const [x, z] of [[-1.35, -1.35], [1.35, -1.35], [-1.35, 1.35], [1.35, 1.35], [0, 0]]) B.box('logs', x, -0.3 - legs / 2, z, 0.25, legs, 0.25);
      break;
    }
    case 'floor': {
      B.box(W, -0.08, 0, 0, 3, 0.14, 3, { faceShade: [0.85, 0.85, 1, 0.65, 0.85, 0.85] });
      B.box(WD, 0, -0.22, -1.0, 3, 0.16, 0.16);
      B.box(WD, 0, -0.22, 1.0, 3, 0.16, 0.16);
      break;
    }
    case 'wall': case 'wall_reinforced': case 'doorway': case 'window_wall': case 'firing_wall': case 'gate': {
      const reinforced = type === 'wall_reinforced' || type === 'firing_wall';
      const H = 3.0, T = 0.16;
      const post = (x) => B.box(WD, x, H / 2, 0, 0.16, H, 0.2);
      post(-1.42); post(1.42);
      const plank = (x0, x1, y0, y1, mat = W) => { if (x1 - x0 > 0.02 && y1 - y0 > 0.02) B.box(mat, (x0 + x1) / 2, (y0 + y1) / 2, 0, x1 - x0, y1 - y0, T); };
      if (type === 'wall' || type === 'wall_reinforced') plank(-1.34, 1.34, 0, H);
      else if (type === 'doorway') { plank(-1.34, -0.6, 0, H); plank(0.6, 1.34, 0, H); plank(-0.6, 0.6, 2.25, H); B.box(WD, 0, 2.27, 0, 1.36, 0.1, 0.22); }
      else if (type === 'window_wall') { plank(-1.34, -0.6, 0, H); plank(0.6, 1.34, 0, H); plank(-0.6, 0.6, 0, 1.1); plank(-0.6, 0.6, 2.0, H); B.box(WD, 0, 1.1, 0.06, 1.3, 0.08, 0.3); }
      else if (type === 'firing_wall') { plank(-1.34, 1.34, 0, 1.3); plank(-1.34, 1.34, 1.55, H); plank(-1.34, -0.5, 1.3, 1.55); plank(0.5, 1.34, 1.3, 1.55); }
      else if (type === 'gate') { B.box(WD, 0, H - 0.1, 0, 3, 0.2, 0.22); }
      // horizontal plank seams for texture rhythm
      if (type !== 'gate') for (let y = 0.5; y < H; y += 0.75) B.box(WD, 0, y, T / 2 + 0.005, 2.7, 0.04, 0.01, { ao: false });
      if (reinforced) {
        for (const x of [-0.7, 0.7]) B.box('corrugated_rust', x, type === 'firing_wall' ? 0.7 : 1.5, T / 2 + 0.04, 1.36, type === 'firing_wall' ? 1.25 : 2.9, 0.03);
        if (type === 'firing_wall') B.box('metal_dark', 0, 2.2, T / 2 + 0.04, 2.7, 1.25, 0.03);
      }
      break;
    }
    case 'door': {
      // hinge at local x = 0 (left edge), leaf extends +x
      B.box(W, 0.575, 1.08, 0, 1.15, 2.15, 0.08);
      B.box(WD, 0.575, 0.6, 0.045, 1.0, 0.1, 0.02);
      B.box(WD, 0.575, 1.6, 0.045, 1.0, 0.1, 0.02);
      B.box(WD, 0.575, 1.1, 0.046, 0.1, 1.2, 0.02, { rotZ: 0.75 });
      B.box('metal', 1.0, 1.05, 0.06, 0.06, 0.12, 0.05);
      break;
    }
    case 'gateLeaf': {
      B.box(W, 0.72, 1.3, 0, 1.44, 2.6, 0.1);
      B.box(WD, 0.72, 0.5, 0.06, 1.3, 0.12, 0.03);
      B.box(WD, 0.72, 2.1, 0.06, 1.3, 0.12, 0.03);
      B.box(WD, 0.72, 1.3, 0.065, 0.12, 1.8, 0.03, { rotZ: 0.6 });
      break;
    }
    case 'stairs': {
      const steps = 12;
      for (let i = 0; i < steps; i++) {
        const h = (i + 1) * 0.25;
        B.box(W, 0, h - 0.06, 1.3 - i * 0.24, 1.2, 0.12, 0.26);
      }
      B.box(WD, -0.62, 1.5, 0, 0.08, 0.2, 3.3, { rotX: -0.83 });
      B.box(WD, 0.62, 1.5, 0, 0.08, 0.2, 3.3, { rotX: -0.83 });
      break;
    }
    case 'ladder': {
      B.box(WD, -0.25, 1.6, 0, 0.07, 3.2, 0.07);
      B.box(WD, 0.25, 1.6, 0, 0.07, 3.2, 0.07);
      for (let y = 0.3; y < 3.2; y += 0.32) B.box(W, 0, y, 0, 0.5, 0.05, 0.05);
      break;
    }
    case 'sandbags': {
      for (let r = 0; r < 4; r++) for (let b = 0; b < 4; b++) {
        B.box('canvas_tan', -0.9 + b * 0.6 + (r % 2) * 0.3 - (r % 2 && b === 3 ? 0.3 : 0), 0.12 + r * 0.23, 0, 0.56, 0.22, 0.45, { shade: 0.88 + ((r + b) % 3) * 0.06, rotY: (b % 2 ? 0.05 : -0.05) });
      }
      break;
    }
    case 'barrier': {
      for (const [rx, rz] of [[0.6, 0], [-0.6, 0], [0, 0.6]]) B.box('rust', 0, 0.75, 0, 0.14, 2.0, 0.14, { rotX: rx, rotZ: rz + (rz ? 0 : 0.6) });
      break;
    }
    case 'watchtower': {
      const H = 4.4;
      for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) B.box('logs', x, H / 2, z, 0.22, H, 0.22);
      B.box(W, 0, H, 0, 2.9, 0.16, 2.9);
      B.box(W, 0, H + 0.55, -1.4, 2.9, 1.0, 0.1);
      B.box(W, -1.4, H + 0.55, 0, 0.1, 1.0, 2.9);
      B.box(W, 1.4, H + 0.55, 0, 0.1, 1.0, 2.9);
      B.box(W, 0.5, H + 0.55, 1.4, 1.9, 1.0, 0.1);
      for (const [x, z] of [[-1.35, -1.35], [1.35, -1.35], [-1.35, 1.35], [1.35, 1.35]]) B.box(WD, x, H + 1.35, z, 0.1, 2.7, 0.1);
      B.box('corrugated', 0, H + 2.75, 0, 3.4, 0.08, 3.4, { rotX: 0.06 });
      for (let y = 0.3; y < H + 0.6; y += 0.33) B.box(WD, -0.7, y, 1.65, 0.5, 0.05, 0.05);
      B.box(WD, -0.95, (H + 1) / 2, 1.65, 0.06, H + 1, 0.06);
      B.box(WD, -0.45, (H + 1) / 2, 1.65, 0.06, H + 1, 0.06);
      break;
    }
    case 'crate': {
      B.box(W, 0, 0.4, 0, 1.2, 0.8, 0.8);
      B.box(WD, 0, 0.82, 0, 1.24, 0.06, 0.84);
      for (const x of [-0.5, 0.5]) B.box(WD, x, 0.4, 0, 0.08, 0.82, 0.84);
      break;
    }
    case 'locker': {
      B.box('olive', 0, 0.95, 0, 1.0, 1.9, 0.55);
      B.box('black', -0.25, 1.0, 0.28, 0.02, 1.7, 0.02);
      B.box('black', 0.25, 1.0, 0.28, 0.02, 1.7, 0.02);
      B.box('metal', 0.12, 1.1, 0.29, 0.08, 0.12, 0.03);
      break;
    }
    case 'workbench': {
      B.box(W, 0, 0.93, 0, 2.0, 0.08, 0.8);
      B.box(WD, -0.9, 0.45, 0, 0.1, 0.9, 0.75);
      B.box(WD, 0.9, 0.45, 0, 0.1, 0.9, 0.75);
      B.box(WD, 0, 0.25, 0, 1.8, 0.05, 0.7);
      B.box('metal_dark', -0.6, 1.05, -0.15, 0.4, 0.18, 0.25);
      B.box('paint_red', 0.4, 1.02, 0.1, 0.3, 0.12, 0.2);
      B.box(WD, 0, 1.6, -0.37, 2.0, 1.1, 0.05);
      break;
    }
    case 'bedroll': {
      B.box('fabric_grey', 0, 0.06, 0, 0.75, 0.1, 1.9);
      B.box('fabric_blue', 0, 0.14, -0.75, 0.6, 0.12, 0.35);
      B.box('fabric_red', 0, 0.1, 0.4, 0.74, 0.06, 1.1);
      break;
    }
    case 'lamp': {
      B.box('metal_dark', 0, 0.8, 0, 0.06, 1.6, 0.06);
      B.box('metal_dark', 0, 0.02, 0, 0.4, 0.04, 0.4);
      B.box('emissive_lamp', 0, 1.7, 0, 0.18, 0.24, 0.18);
      B.box('metal_dark', 0, 1.84, 0, 0.24, 0.04, 0.24);
      break;
    }
    case 'campfire': {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        B.box('rock', Math.cos(a) * 0.55, 0.1, Math.sin(a) * 0.55, 0.28, 0.2, 0.22, { rotY: a });
      }
      for (let i = 0; i < 4; i++) B.box('logs', 0, 0.15, 0, 0.8, 0.12, 0.12, { rotY: i * 0.8, rotZ: 0.3 });
      break;
    }
    case 'chair': {
      for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) B.box('wood_dark', x, 0.22, z, 0.05, 0.44, 0.05);
      B.box(W, 0, 0.46, 0, 0.5, 0.05, 0.48);
      B.box(W, 0, 0.75, 0.22, 0.5, 0.55, 0.05);
      break;
    }
    case 'bench_seat': {
      for (const x of [-0.75, 0.75]) B.box('wood_dark', x, 0.22, 0, 0.08, 0.44, 0.38);
      B.box(W, 0, 0.46, 0, 1.8, 0.06, 0.42);
      break;
    }
    case 'table': {
      for (const [x, z] of [[-0.6, -0.35], [0.6, -0.35], [-0.6, 0.35], [0.6, 0.35]]) B.box('wood_dark', x, 0.37, z, 0.07, 0.74, 0.07);
      B.box(W, 0, 0.76, 0, 1.4, 0.05, 0.85);
      B.box('canvas_tan', 0.2, 0.79, 0.05, 0.5, 0.01, 0.35, { rotY: 0.2 });
      break;
    }
    case 'bed': {
      B.box('wood_dark', 0, 0.2, 0, 1.0, 0.4, 2.0);
      B.box('fabric_blue', 0, 0.45, 0.2, 0.92, 0.12, 1.5);
      B.box('canvas_tan', 0, 0.48, -0.72, 0.6, 0.12, 0.35);
      B.box('wood_dark', 0, 0.55, -0.98, 1.0, 0.7, 0.06);
      break;
    }
    case 'bookshelf': {
      B.box(W, 0, 0.95, -0.2, 1.4, 1.9, 0.05);
      for (const x of [-0.68, 0.68]) B.box(W, x, 0.95, 0, 0.05, 1.9, 0.45);
      for (let i = 0; i < 4; i++) B.box(W, 0, 0.05 + i * 0.6, 0, 1.36, 0.04, 0.42);
      for (let i = 0; i < 3; i++) for (let k = 0; k < 5; k++) B.box(['fabric_red', 'fabric_blue', 'olive', 'canvas_tan'][(i + k) % 4], -0.5 + k * 0.22, 0.25 + i * 0.6, 0.02, 0.16, 0.3, 0.28);
      break;
    }
    case 'weapon_rack': {
      B.box('wood_dark', 0, 0.9, -0.15, 1.4, 1.8, 0.08);
      B.box(W, 0, 0.12, 0.05, 1.4, 0.1, 0.3);
      B.box(W, 0, 1.3, 0.05, 1.4, 0.06, 0.1);
      for (let i = 0; i < 4; i++) { B.box('metal_dark', -0.5 + i * 0.33, 0.8, 0.05, 0.05, 1.2, 0.06); B.box('black', -0.5 + i * 0.33, 0.3, 0.07, 0.07, 0.2, 0.12); }
      break;
    }
    case 'rug': B.box('fabric_red', 0, 0.01, 0, 2.2, 0.02, 1.5); B.box('canvas_tan', 0, 0.015, 0, 1.8, 0.02, 1.1); break;
    case 'plant_pot': B.box('rust', 0, 0.2, 0, 0.4, 0.4, 0.4); for (let i = 0; i < 5; i++) B.box('olive', Math.sin(i * 1.3) * 0.12, 0.6 + (i % 2) * 0.15, Math.cos(i * 1.3) * 0.12, 0.25, 0.35, 0.06, { rotY: i * 1.25, rotX: 0.3 }); break;
    case 'flag': {
      B.box('wood_dark', 0, 2.0, 0, 0.08, 4.0, 0.08);
      B.box('metal', 0, 4.05, 0, 0.12, 0.08, 0.12);
      break;
    }
    case 'flagCloth': B.box('fabric_red', 0.6, 3.5, 0, 1.2, 0.75, 0.03); break;
    case 'sign_post': {
      B.box('wood_dark', 0, 0.7, 0, 0.1, 1.4, 0.1);
      B.box(W, 0, 1.35, 0.06, 1.1, 0.6, 0.05);
      break;
    }
    case 'planter': {
      B.box(W, 0, 0.25, 0, 2.0, 0.5, 0.9);
      B.box('dirt', 0, 0.48, 0, 1.9, 0.05, 0.8);
      for (let i = 0; i < 6; i++) B.box('olive', -0.75 + i * 0.3, 0.68, (i % 2) * 0.2 - 0.1, 0.18, 0.35, 0.18, { rotY: i });
      break;
    }
    case 'rain_collector': {
      B.box('metal', 0, 0.55, 0, 0.8, 1.1, 0.8);
      B.box('canvas', 0, 1.6, 0, 1.6, 0.04, 1.6, { rotX: 0.15 });
      for (const [x, z] of [[-0.75, -0.75], [0.75, -0.75], [-0.75, 0.75], [0.75, 0.75]]) B.box('metal_dark', x, 0.8, z, 0.05, 1.6, 0.05);
      B.box('metal_dark', 0.42, 0.3, 0, 0.12, 0.06, 0.06);
      break;
    }
    case 'stove': {
      B.box('black', 0, 0.4, 0, 0.7, 0.8, 0.55);
      B.box('emissive_lamp', 0, 0.35, 0.28, 0.3, 0.2, 0.02);
      B.box('metal_dark', 0, 1.6, -0.15, 0.14, 1.6, 0.14);
      break;
    }
    case 'sentry': {
      // tripod base with an ammo box; the turning head is built separately ('sentryHead')
      for (const a of [0, 2.1, 4.2]) B.box('metal_dark', Math.sin(a) * 0.35, 0.42, Math.cos(a) * 0.35, 0.07, 0.95, 0.07, { rotX: Math.cos(a) * 0.45, rotZ: -Math.sin(a) * 0.45 });
      B.box('metal_dark', 0, 0.9, 0, 0.14, 0.22, 0.14);
      B.box('olive', 0.38, 0.14, 0.1, 0.36, 0.26, 0.2);
      B.box('metal', 0.38, 0.29, 0.1, 0.1, 0.03, 0.06);
      B.box('canvas_tan', 0, 0.1, -0.55, 1.2, 0.2, 0.4);
      break;
    }
    case 'sentryHead': {
      B.box('metal_dark', 0, 0, 0, 0.2, 0.12, 0.3);
      B.box('olive', 0, 0.05, 0.05, 0.62, 0.4, 0.05); // armour shield, faces the barrel side
      B.box('metal_dark', 0.12, -0.05, 0.12, 0.12, 0.1, 0.18);
      B.box('emissive_lamp', -0.22, 0.17, 0.08, 0.04, 0.04, 0.02);
      break;
    }
    case 'lumber_yard': {
      // sawhorse, chopping block, log pile and a covered rack of planks
      for (const z of [-0.9, 0.9]) for (const x of [-1.2, 1.2]) B.box(WD, x, 0.9, z, 0.12, 1.8, 0.12);
      B.box('corrugated_rust', 0, 1.9, 0, 2.8, 0.06, 2.2, { rotX: 0.08 });
      for (let i = 0; i < 4; i++) B.box(W, 0, 0.25 + i * 0.12, 0.3, 2.3, 0.08, 0.6, { shade: 0.9 + (i % 2) * 0.08 });
      for (let i = 0; i < 5; i++) B.box('logs', -0.3 + (i % 3) * 0.3, 0.16 + Math.floor(i / 3) * 0.26, -0.6, 0.26, 0.26, 1.9, { rotX: Math.PI / 2 * 0 });
      B.box('logs', 1.6, 0.3, 0.8, 0.5, 0.6, 0.5);
      B.box('metal', 1.6, 0.68, 0.8, 0.05, 0.2, 0.3, { rotZ: 0.4 });
      break;
    }
    case 'scrap_yard': {
      B.box('metal_dark', 0, 0.45, 0, 1.6, 0.9, 0.9); // bench / press
      B.box('rust', 0, 0.92, 0, 1.7, 0.06, 1.0);
      B.box('metal_dark', -0.4, 1.3, -0.3, 0.12, 0.8, 0.12);
      B.box('metal', -0.4, 1.72, -0.1, 0.5, 0.12, 0.5);
      B.box('rust', 1.3, 0.4, 0.2, 0.8, 0.8, 0.9); // scrap bin
      B.box('corrugated_rust', 1.3, 0.85, 0.2, 0.84, 0.05, 0.94);
      for (let i = 0; i < 6; i++) B.box(i % 2 ? 'rust' : 'metal_dark', -1.3 + (i % 3) * 0.25, 0.1 + Math.floor(i / 3) * 0.15, 0.5 - (i % 2) * 0.3, 0.4, 0.08, 0.3, { rotY: i * 0.7 });
      break;
    }
    case 'fuel_pump': {
      B.box('metal_dark', 0, 0.06, 0, 1.4, 0.12, 1.0);
      B.box('paint_red', 0, 0.85, 0, 0.6, 1.5, 0.45);
      B.box('metal_dark', 0, 1.65, 0, 0.66, 0.12, 0.5);
      B.box('emissive_lamp', 0, 1.25, 0.23, 0.36, 0.2, 0.02);
      B.box('black', 0.34, 0.95, 0.05, 0.06, 0.5, 0.06);
      B.box('metal', 0.38, 0.72, 0.1, 0.06, 0.08, 0.18);
      B.box('rust', -0.9, 0.55, 0, 0.6, 1.0, 0.6); // old tank
      B.box('metal_dark', -0.9, 1.07, 0, 0.2, 0.06, 0.2);
      break;
    }
    default:
      B.box(W, 0, 0.5, 0, 1, 1, 1);
  }
  return B.build();
}

/** Local-space collider boxes [cx, cy, cz, w, h, d, opts] for a piece. */
export function pieceColliders(type) {
  const T = 0.2;
  switch (type) {
    case 'foundation': return [[0, -0.2, 0, 3, 0.4, 3]];
    case 'floor': return [[0, -0.08, 0, 3, 0.16, 3]];
    case 'wall': case 'wall_reinforced': return [[0, 1.5, 0, 3, 3, T]];
    case 'doorway': return [[-0.97, 1.5, 0, 0.76, 3, T], [0.97, 1.5, 0, 0.76, 3, T], [0, 2.62, 0, 1.2, 0.76, T]];
    case 'window_wall': return [[-0.97, 1.5, 0, 0.76, 3, T], [0.97, 1.5, 0, 0.76, 3, T], [0, 0.55, 0, 1.2, 1.1, T], [0, 2.5, 0, 1.2, 1.0, T]];
    case 'firing_wall': return [[0, 0.65, 0, 3, 1.3, T], [0, 2.27, 0, 3, 1.45, T], [-0.92, 1.42, 0, 0.84, 0.25, T], [0.92, 1.42, 0, 0.84, 0.25, T]];
    case 'gate': return [[-1.42, 1.5, 0, 0.16, 3, T], [1.42, 1.5, 0, 0.16, 3, T], [0, 2.9, 0, 3, 0.2, T]];
    case 'sandbags': return [[0, 0.47, 0, 2.4, 0.94, 0.5]];
    case 'barrier': return [[0, 0.7, 0, 1.6, 1.4, 1.6]];
    case 'crate': return [[0, 0.42, 0, 1.2, 0.84, 0.8]];
    case 'locker': return [[0, 0.95, 0, 1.0, 1.9, 0.55]];
    case 'workbench': return [[0, 0.48, 0, 2.0, 0.96, 0.8]];
    case 'lamp': return [[0, 0.9, 0, 0.3, 1.8, 0.3, { blocksSight: false, blocksShots: false }]];
    case 'campfire': return [];
    case 'bedroll': return [];
    case 'sentry': return [[0, 0.5, 0, 0.8, 1.0, 0.8]];
    case 'chair': return [[0, 0.3, 0, 0.5, 0.6, 0.5]];
    case 'bench_seat': return [[0, 0.3, 0, 1.8, 0.6, 0.42]];
    case 'table': return [[0, 0.4, 0, 1.4, 0.8, 0.85]];
    case 'bed': return [[0, 0.3, 0, 1.0, 0.6, 2.0]];
    case 'bookshelf': return [[0, 0.95, -0.05, 1.4, 1.9, 0.45]];
    case 'weapon_rack': return [[0, 0.9, -0.05, 1.4, 1.8, 0.35]];
    case 'rug': return [];
    case 'plant_pot': return [[0, 0.3, 0, 0.4, 0.6, 0.4]];
    case 'flag': return [[0, 2, 0, 0.12, 4, 0.12]];
    case 'sign_post': return [[0, 0.7, 0, 0.12, 1.4, 0.12]];
    case 'planter': return [[0, 0.3, 0, 2.0, 0.6, 0.9]];
    case 'rain_collector': return [[0, 0.55, 0, 0.8, 1.1, 0.8]];
    case 'stove': return [[0, 0.5, 0, 0.7, 1.0, 0.55]];
    case 'lumber_yard': return [[0, 0.45, 0.3, 2.4, 0.9, 0.7], [0, 0.3, -0.6, 1.0, 0.6, 1.9], [1.6, 0.3, 0.8, 0.5, 0.6, 0.5]];
    case 'scrap_yard': return [[0, 0.47, 0, 1.7, 0.95, 1.0], [1.3, 0.43, 0.2, 0.84, 0.86, 0.94]];
    case 'fuel_pump': return [[0, 0.85, 0, 0.66, 1.7, 0.5], [-0.9, 0.55, 0, 0.6, 1.1, 0.6]];
    case 'ladder': return [];
    case 'watchtower': return [
      [-1.2, 2.2, -1.2, 0.22, 4.4, 0.22], [1.2, 2.2, -1.2, 0.22, 4.4, 0.22], [-1.2, 2.2, 1.2, 0.22, 4.4, 0.22], [1.2, 2.2, 1.2, 0.22, 4.4, 0.22],
      [0, 4.4, 0, 2.9, 0.16, 2.9], [0, 4.95, -1.4, 2.9, 1.0, 0.1], [-1.4, 4.95, 0, 0.1, 1.0, 2.9], [1.4, 4.95, 0, 0.1, 1.0, 2.9], [0.5, 4.95, 1.4, 1.9, 1.0, 0.1]];
    default: return [[0, 0.5, 0, 1, 1, 1]];
  }
}

/** Footprint (w, d, h) for overlap validation. */
export function pieceBounds(type) {
  switch (type) {
    case 'foundation': return [3, 3, 0.4];
    case 'floor': return [3, 3, 0.16];
    case 'stairs': return [1.3, 3, 3];
    case 'ladder': return [0.6, 0.2, 3.2];
    case 'sandbags': return [2.4, 0.5, 0.94];
    case 'barrier': return [1.6, 1.6, 1.4];
    case 'watchtower': return [3, 3, 4.4];
    case 'crate': return [1.2, 0.8, 0.84];
    case 'locker': return [1.0, 0.55, 1.9];
    case 'workbench': return [2.0, 0.8, 0.96];
    case 'bedroll': return [0.8, 2.0, 0.2];
    case 'lamp': return [0.4, 0.4, 1.8];
    case 'campfire': return [1.4, 1.4, 0.3];
    case 'sentry': return [1.2, 1.2, 1.3];
    case 'chair': return [0.6, 0.6, 1.0];
    case 'bench_seat': return [1.9, 0.5, 0.6];
    case 'table': return [1.5, 0.95, 0.8];
    case 'bed': return [1.1, 2.1, 1.0];
    case 'bookshelf': return [1.5, 0.5, 1.9];
    case 'weapon_rack': return [1.5, 0.45, 1.8];
    case 'rug': return [2.2, 1.5, 0.1];
    case 'plant_pot': return [0.5, 0.5, 1.0];
    case 'flag': return [1.4, 0.3, 4.1];
    case 'sign_post': return [1.2, 0.3, 1.7];
    case 'planter': return [2.0, 0.9, 0.8];
    case 'rain_collector': return [1.6, 1.6, 1.8];
    case 'stove': return [0.8, 0.6, 1.8];
    case 'lumber_yard': return [3.4, 2.4, 1.9];
    case 'scrap_yard': return [2.6, 1.2, 1.8];
    case 'fuel_pump': return [1.6, 1.0, 1.7];
    default: return [3, 0.2, 3];
  }
}
