import * as THREE from 'three';
import { BoxBuilder } from '../world/GeometryKit.js';

// Vehicle models with real cabins. Every vehicle is built from a per-type spec (SPECS):
// body shell made of panels (so the cabin is hollow and the inside faces exist), hinged
// doors with their own windows and door cards, individually breakable windows, a
// dashboard with a backlit gauge cluster and moving needles, a steering wheel on a column
// that turns with the front wheels, seats, console, gear selector, pedals, dome light,
// mirrors, and four wheels with tyre tread, rims and steering pivots.
//
// Frame: root sits on the ground under the vehicle centre, forward is -z, right is +x.
// Seats carry hip and eye points in this frame (used for the first-person camera, for AI
// crew and for the player's hit box), and hitParts are local boxes used for bullets
// (body panels, armour, glass) so shots can go through broken windows into the cabin.

export const SPECS = {
  pickup: {
    W: 2.0, L: 5.3, wheelR: 0.42, axleF: -1.65, axleR: 1.6, track: 0.86,
    floorY: 0.62, sillY: 0.5, beltY: 1.3, roofY: 1.86, cabFront: -0.72, cabRear: 0.86, hoodY: 1.18, hoodFront: -2.6, rake: 0.55,
    rows: [{ z: 0.32, y: 0.98, xs: [-0.42, 0.42] }], doorsPerSide: 1, interior: 'civil', trim: 'black', seatMat: 'canvas_tan',
    rear: 'bed', bedEnd: 2.62, bedY: 1.05, wheelTilt: -0.42, glassHp: 1, armored: false,
  },
  sedan: {
    W: 1.86, L: 4.7, wheelR: 0.36, axleF: -1.42, axleR: 1.38, track: 0.8,
    floorY: 0.38, sillY: 0.32, beltY: 0.98, roofY: 1.48, cabFront: -0.62, cabRear: 1.42, hoodY: 0.86, hoodFront: -2.32, rake: 0.72,
    rows: [{ z: 0.12, y: 0.6, xs: [-0.4, 0.4] }, { z: 1.08, y: 0.62, xs: [-0.42, 0, 0.42], bench: true }], doorsPerSide: 2, interior: 'civil', trim: 'black', seatMat: 'fabric_grey',
    rear: 'trunk', trunkEnd: 2.33, trunkY: 0.92, wheelTilt: -0.4, glassHp: 1, armored: false, rearRake: 0.55,
  },
  offroad: {
    W: 1.92, L: 4.5, wheelR: 0.45, axleF: -1.4, axleR: 1.35, track: 0.82,
    floorY: 0.72, sillY: 0.6, beltY: 1.38, roofY: 1.98, cabFront: -0.7, cabRear: 2.08, hoodY: 1.28, hoodFront: -2.2, rake: 0.45,
    rows: [{ z: 0.18, y: 1.06, xs: [-0.4, 0.4] }, { z: 1.12, y: 1.08, xs: [-0.42, 0, 0.42], bench: true }], doorsPerSide: 2, interior: 'rugged', trim: 'metal_dark', seatMat: 'fabric_grey',
    rear: 'closed', wheelTilt: -0.5, glassHp: 1, armored: false, roofRack: true, spare: true,
  },
  utility: {
    W: 2.05, L: 5.0, wheelR: 0.4, axleF: -1.55, axleR: 1.55, track: 0.88,
    floorY: 0.66, sillY: 0.54, beltY: 1.36, roofY: 2.36, cabFront: -1.45, cabRear: 2.48, hoodY: 1.12, hoodFront: -2.48, rake: 0.42,
    rows: [{ z: -0.42, y: 1.08, xs: [-0.44, 0.44] }], doorsPerSide: 1, interior: 'van', trim: 'black', seatMat: 'fabric_blue',
    rear: 'cargo', bulkhead: 0.28, wheelTilt: -0.95, glassHp: 1, armored: false,
  },
  mil_truck: {
    W: 2.5, L: 7.6, wheelR: 0.56, axleF: -2.45, axleR: 2.2, track: 1.02,
    floorY: 1.3, sillY: 1.12, beltY: 2.02, roofY: 2.68, cabFront: -2.62, cabRear: -1.2, hoodY: 1.9, hoodFront: -3.8, rake: 0.12,
    rows: [{ z: -1.68, y: 1.76, xs: [-0.55, 0.55] }], doorsPerSide: 1, interior: 'military', trim: 'olive', seatMat: 'canvas',
    rear: 'canvas', bedStart: -1.05, bedEnd: 3.78, bedY: 1.42, wheelTilt: -0.85, glassHp: 1.2, armored: false,
  },
  apc: {
    W: 2.45, L: 5.9, wheelR: 0.58, axleF: -1.9, axleR: 1.9, track: 1.0,
    floorY: 1.0, sillY: 0.9, beltY: 1.72, roofY: 2.32, cabFront: -1.35, cabRear: 2.75, hoodY: 1.62, hoodFront: -2.95, rake: 0.5,
    rows: [{ z: -0.75, y: 1.42, xs: [-0.5, 0.5] }], troop: true, doorsPerSide: 1, interior: 'armored', trim: 'olive', seatMat: 'canvas',
    rear: 'armored', wheelTilt: -0.7, glassHp: 9, armored: true, smallWindows: true,
  },
};

const _v = new THREE.Vector3();

/** Canvas texture of a gauge cluster: speedometer and fuel/temperature dial (static face). */
function clusterTexture(style) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const mil = style === 'military' || style === 'armored';
  g.fillStyle = mil ? '#1c2018' : '#0c0c0e';
  g.fillRect(0, 0, 256, 128);
  const dial = (cx, cy, r, n, labels) => {
    g.fillStyle = mil ? '#10120e' : '#050506';
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = mil ? '#9a9a7a' : '#7a7e86'; g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, r - 1.5, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = mil ? '#e8e2b8' : '#f2f2ea';
    for (let i = 0; i <= n; i++) {
      const a = Math.PI * 0.75 + (i / n) * Math.PI * 1.5;
      const big = i % 2 === 0;
      g.lineWidth = big ? 2.5 : 1.2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
      g.lineTo(cx + Math.cos(a) * (r - (big ? 14 : 9)), cy + Math.sin(a) * (r - (big ? 14 : 9)));
      g.stroke();
      if (big && labels) {
        g.fillStyle = mil ? '#e8e2b8' : '#e8e8e0';
        g.font = 'bold 11px Arial';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(labels(i)), cx + Math.cos(a) * (r - 24), cy + Math.sin(a) * (r - 24));
      }
    }
  };
  dial(70, 64, 56, 12, (i) => i * 10);
  dial(190, 64, 44, 4, null);
  g.fillStyle = mil ? '#e8e2b8' : '#d8d8d0';
  g.font = 'bold 12px Arial'; g.textAlign = 'center';
  g.fillText('E', 165, 96); g.fillText('F', 215, 96);
  g.fillText('km/h', 70, 100);
  g.fillStyle = '#c03020'; g.fillRect(150, 22, 10, 6); // warning lamps
  g.fillStyle = '#d0a020'; g.fillRect(166, 22, 10, 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let _treadTex = null;
function treadTexture() {
  if (_treadTex) return _treadTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#151515'; g.fillRect(0, 0, 64, 256);
  g.fillStyle = '#262626';
  for (let y = 0; y < 256; y += 16) {
    g.fillRect(4, y + 2, 24, 10);
    g.fillRect(36, y + 10, 24, 10);
  }
  g.fillStyle = '#0b0b0b'; g.fillRect(30, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  _treadTex = t;
  return t;
}

/** Crack overlay textures (three stages), shared. */
let _crackTex = null;
export function crackTextures() {
  if (_crackTex) return _crackTex;
  _crackTex = [1, 2, 3].map((stage) => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    let seed = stage * 977;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const centres = stage === 1 ? 1 : stage === 2 ? 3 : 6;
    for (let k = 0; k < centres; k++) {
      const cx = 40 + rnd() * 176, cy = 40 + rnd() * 176;
      g.strokeStyle = 'rgba(235,240,240,0.9)';
      const rays = 7 + Math.floor(rnd() * 6);
      for (let i = 0; i < rays; i++) {
        let x = cx, y = cy, a = (i / rays) * Math.PI * 2 + rnd() * 0.4;
        g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(x, y);
        const len = 30 + rnd() * (40 + stage * 30);
        for (let s = 0; s < len; s += 8) { a += (rnd() - 0.5) * 0.5; x += Math.cos(a) * 8; y += Math.sin(a) * 8; g.lineTo(x, y); }
        g.stroke();
      }
      for (let ring = 1; ring <= stage; ring++) {
        g.lineWidth = 1; g.beginPath();
        const rr = 10 + ring * 14 + rnd() * 6;
        for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.5) { const rj = rr * (0.8 + rnd() * 0.4); g.lineTo(cx + Math.cos(a) * rj, cy + Math.sin(a) * rj); }
        g.stroke();
      }
      g.fillStyle = 'rgba(240,245,245,0.85)';
      g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
  return _crackTex;
}

function paintMesh(builder, paintMat) {
  const mesh = builder.build();
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mesh.material = mats.map((m) => (m.name === 'paint_white' ? paintMat : m));
  return mesh;
}

/**
 * Build a vehicle. Returns {root, body, interior, wheels, steering, needles, doors, windows,
 * seats, hitParts, lamps, dome, axle, wheelRadius, driverRig}.
 */
export function buildVehicle(t, materials) {
  const S = SPECS[t.style] || SPECS[t.id] || SPECS.pickup;
  const { W, L } = S;
  const hw = W / 2;
  const paintMat = materials.get('paint_white').clone();
  paintMat.color.set(t.color);
  paintMat.name = 'paint';
  const P = 'paint_white';
  const trim = S.trim;
  const B = new BoxBuilder(materials); // exterior shell
  const I = new BoxBuilder(materials); // interior (hidden at a distance)
  const hit = [];
  const part = (mat, x, y, z, w, h, d, extra = {}) => hit.push({ min: [x - w / 2, y - h / 2, z - d / 2], max: [x + w / 2, y + h / 2, z + d / 2], mat, ...extra });
  const armorMat = S.armored ? 'armor' : 'metal';
  const indoor = { indoor: true };
  const zF = S.cabFront, zR = S.cabRear, fy = S.floorY, by = S.beltY, ry = S.roofY;
  const wheelZs = [S.axleF, S.axleR];

  // ------------------------------------------------------------------ chassis & lower body
  B.box('metal_dark', 0, S.wheelR * 0.9, 0, W * 0.72, 0.22, L * 0.86);
  // lower body sides with wheel arches: segments between arches
  const archR = S.wheelR + 0.1;
  const sideSegs = [[-L / 2 + 0.05, S.axleF - archR], [S.axleF + archR, S.axleR - archR], [S.axleR + archR, L / 2 - 0.05]];
  const lowY0 = S.sillY - 0.18;
  for (const sx of [-1, 1]) {
    for (const [a, b] of sideSegs) {
      if (b - a < 0.05) continue;
      // keep the door openings out of the solid side: doors cover them
      B.box(P, sx * (hw - 0.04), (lowY0 + by) / 2, (a + b) / 2, 0.08, by - lowY0, b - a);
    }
    // arch tops (fender over each wheel)
    for (const z of wheelZs) {
      B.box(P, sx * (hw - 0.04), (S.wheelR * 2 + 0.12 + by) / 2, z, 0.08, Math.max(0.1, by - S.wheelR * 2 - 0.12), archR * 2);
      B.box('black', sx * (hw - 0.02), S.wheelR * 2 + 0.1, z, 0.12, 0.06, archR * 2.05); // arch lip
    }
    part(armorMat, sx * (hw - 0.04), (lowY0 + by) / 2, 0, 0.12, by - lowY0, L - 0.1, { kind: 'body' });
  }
  // sills under the doors
  for (const sx of [-1, 1]) B.box('black', sx * (hw - 0.06), S.sillY - 0.1, (zF + zR) / 2, 0.14, 0.12, zR - zF);
  // floor pan
  B.box('metal_dark', 0, fy - 0.06, (zF + zR) / 2, W - 0.16, 0.08, zR - zF);
  I.box(S.interior === 'military' || S.interior === 'armored' ? 'metal_dark' : 'black', 0, fy + 0.005, (zF + zR) / 2, W - 0.2, 0.02, zR - zF - 0.05, indoor); // floor mat
  part(armorMat, 0, fy - 0.06, (zF + zR) / 2, W - 0.1, 0.12, zR - zF, { kind: 'body' });

  // ------------------------------------------------------------------ front: hood, grille, bumper
  const hf = S.hoodFront;
  B.box(P, 0, S.hoodY - 0.04, (hf + zF) / 2, W - 0.06, 0.08, zF - hf); // hood
  B.box(P, 0, (S.sillY + S.hoodY) / 2, hf + 0.04, W - 0.04, S.hoodY - S.sillY, 0.08); // nose
  B.box('metal_dark', 0, S.hoodY - 0.28, hf - 0.01, W * 0.62, 0.32, 0.04); // grille
  for (let i = 0; i < 4; i++) B.box('black', 0, S.hoodY - 0.4 + i * 0.075, hf - 0.03, W * 0.58, 0.025, 0.02);
  B.box('metal_dark', 0, S.sillY - 0.12, -L / 2 + 0.06, W + 0.04, 0.2, 0.14); // bumper
  part('metal', 0, (S.sillY + S.hoodY) / 2, (hf + zF) / 2, W, S.hoodY - S.sillY + 0.1, zF - hf, { kind: 'engine', resist: 'engine' });
  // firewall (inside face = dash backing)
  B.box('metal_dark', 0, (fy + by) / 2, zF + 0.02, W - 0.12, by - fy, 0.04);
  if (S.armored) {
    // sloped glacis armour over the hood and armour plates on the nose
    B.box(P, 0, S.hoodY + 0.12, (hf + zF) / 2 + 0.1, W - 0.08, 0.06, zF - hf + 0.1, { rotX: 0.18 });
    B.box(P, 0, S.sillY + 0.15, hf - 0.04, W, 0.4, 0.12, { rotX: -0.35 });
  }

  // ------------------------------------------------------------------ cabin shell
  const wsTopZ = zF + S.rake;
  // A-pillars (from cowl to roof, raked)
  const aLen = Math.hypot(S.rake, ry - by);
  const aRot = Math.atan2(S.rake, ry - by);
  for (const sx of [-1, 1]) {
    B.box(P, sx * (hw - 0.07), (by + ry) / 2, zF + S.rake / 2, 0.1, aLen, 0.1, { rotX: aRot });
    I.box(trim, sx * (hw - 0.13), (by + ry) / 2, zF + S.rake / 2 + 0.02, 0.04, aLen, 0.12, { rotX: aRot, indoor: true });
  }
  // roof (outer skin + headliner)
  const roofZ0 = wsTopZ, roofZ1 = S.rear === 'bed' || S.rear === 'canvas' ? zR : zR;
  B.box(P, 0, ry + 0.03, (roofZ0 + roofZ1) / 2, W - 0.1, 0.06, roofZ1 - roofZ0 + 0.04);
  I.box(S.interior === 'military' || S.interior === 'armored' ? 'olive' : 'fabric_grey', 0, ry - 0.025, (roofZ0 + roofZ1) / 2, W - 0.22, 0.03, roofZ1 - roofZ0 - 0.04, indoor);
  part(armorMat, 0, ry + 0.03, (roofZ0 + roofZ1) / 2, W - 0.1, 0.1, roofZ1 - roofZ0, { kind: 'body' });
  // cowl strip under the windshield
  B.box('black', 0, by + 0.02, zF + 0.04, W - 0.12, 0.05, 0.12);
  // windows list: {key, w, h, x, y, z, rotX, rotY, door?}
  const windows = [];
  const win = (key, x, y, z, w, h, opts = {}) => windows.push({ key, x, y, z, w, h, rotX: opts.rotX || 0, rotY: opts.rotY || 0, door: opts.door ?? null, thin: opts.thin ?? 0.015 });
  if (S.smallWindows) {
    // armoured car: two narrow vision blocks instead of a windscreen, with an armour frame
    for (const sx of [-0.27, 0.27]) win(`ws${sx < 0 ? 'L' : 'R'}`, sx * W, (by + ry) / 2 - 0.03, zF + S.rake / 2, W * 0.36, (ry - by) * 0.42, { rotX: aRot, thin: 0.06 });
    B.box(P, 0, (by + ry) / 2, zF + S.rake / 2, 0.16, aLen, 0.1, { rotX: aRot });
    B.box(P, 0, by + (ry - by) * 0.2, zF + S.rake * 0.18, W - 0.16, (ry - by) * 0.32, 0.1, { rotX: aRot });
    B.box(P, 0, ry - (ry - by) * 0.13, zF + S.rake * 0.86, W - 0.16, (ry - by) * 0.22, 0.1, { rotX: aRot });
  } else {
    win('ws', 0, (by + ry) / 2, zF + S.rake / 2, W - 0.22, aLen - 0.06, { rotX: aRot });
  }
  // B-pillars at the end of the front doors
  const doorLen = S.doorsPerSide === 2 ? Math.min(1.1, (zR - zF) * 0.5) : Math.min(1.25, (S.rows[0].z + 0.4) - zF);
  const bZ = zF + Math.max(doorLen, 0.9);
  for (const sx of [-1, 1]) {
    B.box(P, sx * (hw - 0.06), (by + ry) / 2, bZ, 0.1, ry - by, 0.12);
    I.box(trim, sx * (hw - 0.12), (by + ry) / 2, bZ, 0.04, ry - by, 0.16, indoor);
  }
  // rear of the cabin depends on body type
  if (S.rear === 'bed' || S.rear === 'canvas') {
    // cab back wall with a rear window
    B.box(P, 0, (fy + by) / 2, zR, W - 0.08, by - fy, 0.06);
    B.box(P, 0, ry - 0.06, zR, W - 0.08, 0.12, 0.06);
    for (const sx of [-1, 1]) B.box(P, sx * (hw - 0.2), (by + ry) / 2, zR, 0.32, ry - by, 0.06);
    I.box(trim, 0, (fy + by) / 2, zR - 0.04, W - 0.2, by - fy, 0.02, indoor);
    win('rear', 0, (by + ry - 0.12) / 2, zR, W - 0.72, ry - by - 0.18);
    part(armorMat, 0, (fy + ry) / 2, zR, W, ry - fy, 0.1, { kind: 'body', solidBelow: by });
    // rear quarter behind the B-pillar up to the back wall (pickup: short)
    if (zR - bZ > 0.08) for (const sx of [-1, 1]) {
      B.box(P, sx * (hw - 0.04), (lowY0 + by) / 2, (bZ + zR) / 2, 0.08, by - lowY0, zR - bZ);
      B.box(P, sx * (hw - 0.06), (by + ry) / 2, (bZ + zR) / 2, 0.08, ry - by, zR - bZ);
    }
  } else {
    // enclosed body continues to the rear: upper sides with windows (or panels), tailgate
    const rearEnd = L / 2 - 0.08;
    const backZ = S.rear === 'trunk' ? zR : rearEnd;
    const rearDoorEnd = S.doorsPerSide === 2 ? bZ + Math.min(0.95, (backZ - bZ) * 0.75) : bZ;
    for (const sx of [-1, 1]) {
      // lower side behind the doors
      if (backZ - rearDoorEnd > 0.05) B.box(P, sx * (hw - 0.04), (lowY0 + by) / 2, (rearDoorEnd + rearEnd) / 2, 0.08, by - lowY0, rearEnd - rearDoorEnd);
      const qa = rearDoorEnd + 0.06, qb = backZ - 0.08;
      if (qb - qa > 0.2) {
        if (S.rear === 'cargo' || S.rear === 'armored') {
          B.box(P, sx * (hw - 0.04), (by + ry) / 2, (qa + qb) / 2, 0.08, ry - by, qb - qa);
          I.box(S.rear === 'armored' ? 'olive' : 'wood', sx * (hw - 0.1), (fy + ry) / 2, (qa + qb) / 2, 0.03, ry - fy - 0.1, qb - qa, indoor);
        } else {
          win(`q${sx < 0 ? 'L' : 'R'}`, sx * (hw - 0.05), (by + ry) / 2 - 0.02, (qa + qb) / 2, qb - qa - 0.1, ry - by - 0.14, { rotY: Math.PI / 2 });
          B.box(P, sx * (hw - 0.05), ry - 0.05, (qa + qb) / 2, 0.08, 0.1, qb - qa);
          B.box(P, sx * (hw - 0.05), by + 0.03, (qa + qb) / 2, 0.08, 0.06, qb - qa);
        }
        B.box(P, sx * (hw - 0.06), (by + ry) / 2, qb + 0.04, 0.1, ry - by, 0.1); // C/D pillar
      }
      part(armorMat, sx * (hw - 0.05), (by + ry) / 2, (rearDoorEnd + backZ) / 2, 0.12, ry - by, backZ - rearDoorEnd, { kind: S.rear === 'cargo' || S.rear === 'armored' ? 'body' : 'pillar' });
    }
    if (S.rear === 'trunk') {
      // raked rear window then the trunk lid
      const rr = S.rearRake || 0.5;
      win('rear', 0, (by + ry) / 2, zR + rr / 2, W - 0.26, Math.hypot(rr, ry - by) - 0.06, { rotX: -Math.atan2(rr, ry - by) });
      B.box(P, 0, S.trunkY, (zR + rr + S.trunkEnd) / 2, W - 0.06, 0.06, S.trunkEnd - zR - rr + 0.1);
      B.box(P, 0, (S.sillY + S.trunkY) / 2, S.trunkEnd, W - 0.04, S.trunkY - S.sillY + 0.1, 0.08);
      B.box(P, 0, (fy + by) / 2, zR + 0.05, W - 0.12, by - fy, 0.05); // parcel shelf / seat back wall
      I.box('black', 0, by - 0.02, zR + rr * 0.6, W - 0.24, 0.03, rr, indoor);
      B.box('metal_dark', 0, S.sillY - 0.12, L / 2 - 0.08, W + 0.04, 0.2, 0.14);
    } else {
      // tailgate / rear doors with window (cargo vans and armour: solid)
      B.box(P, 0, (lowY0 + ry) / 2, rearEnd, W - 0.08, ry - lowY0, 0.08);
      if (S.rear === 'closed') win('rear', 0, (by + ry) / 2, rearEnd - 0.05, W - 0.5, ry - by - 0.2);
      B.box('metal_dark', 0, S.sillY - 0.12, L / 2 - 0.04, W + 0.04, 0.2, 0.14);
      part(armorMat, 0, (lowY0 + ry) / 2, rearEnd, W, ry - lowY0, 0.12, { kind: 'body', solidBelow: S.rear === 'closed' ? by : ry });
      // roof over the rear part
      if (backZ > zR + 0.05) { B.box(P, 0, ry + 0.03, (zR + backZ) / 2, W - 0.1, 0.06, backZ - zR); }
    }
    if (S.bulkhead !== undefined) {
      B.box('metal_dark', 0, (fy + ry) / 2, S.bulkhead, W - 0.14, ry - fy - 0.04, 0.04);
      I.box('metal', 0, (fy + ry) / 2 + 0.3, S.bulkhead - 0.03, W * 0.4, 0.3, 0.02, indoor); // bulkhead window frame
    }
  }

  // ------------------------------------------------------------------ rear sections
  if (S.rear === 'bed') {
    const bz0 = zR + 0.08, bz1 = S.bedEnd;
    B.box('metal_dark', 0, S.bedY - 0.3, (bz0 + bz1) / 2, W - 0.12, 0.06, bz1 - bz0);
    for (const sx of [-1, 1]) {
      B.box(P, sx * (hw - 0.04), (S.sillY - 0.18 + S.bedY + 0.05) / 2, (bz0 + bz1) / 2, 0.08, S.bedY + 0.23 - S.sillY, bz1 - bz0);
      B.box('black', sx * (hw - 0.04), S.bedY + 0.06, (bz0 + bz1) / 2, 0.12, 0.05, bz1 - bz0);
      part('metal', sx * (hw - 0.04), (S.sillY + S.bedY) / 2, (bz0 + bz1) / 2, 0.1, S.bedY - S.sillY + 0.2, bz1 - bz0, { kind: 'body' });
    }
    B.box(P, 0, (S.sillY + S.bedY) / 2, bz1, W - 0.04, S.bedY - S.sillY + 0.15, 0.08); // tailgate
    B.box('metal_dark', 0, S.sillY - 0.12, L / 2 - 0.04, W + 0.04, 0.2, 0.14);
  } else if (S.rear === 'canvas') {
    const bz0 = S.bedStart, bz1 = S.bedEnd;
    B.box('wood_dark', 0, S.bedY, (bz0 + bz1) / 2, W, 0.1, bz1 - bz0);
    for (const sx of [-1, 1]) {
      B.box('olive', sx * (hw - 0.03), S.bedY + 0.35, (bz0 + bz1) / 2, 0.06, 0.6, bz1 - bz0);
      for (let z = bz0 + 0.3; z < bz1; z += 1.1) B.box('metal_dark', sx * (hw - 0.03), S.bedY + 1.1, z, 0.05, 1.4, 0.05);
    }
    B.box('canvas', 0, S.bedY + 1.0, (bz0 + bz1) / 2, W + 0.04, 1.75, bz1 - bz0 - 0.1, { ao: false });
    B.box('olive', 0, S.bedY + 0.3, bz1, W, 0.5, 0.08);
    B.box('metal_dark', 0, S.sillY - 0.12, L / 2 - 0.04, W + 0.04, 0.2, 0.14);
    for (const z of [bz0 + 1, bz1 - 0.8]) for (const sx of [-1, 1]) I.box('wood', sx * (hw - 0.35), S.bedY + 0.45, z, 0.35, 0.06, 1.6, indoor); // troop benches
    part('canvas', 0, S.bedY + 1.0, (bz0 + bz1) / 2, W, 1.8, bz1 - bz0, { kind: 'canvas' });
    part('metal', 0, S.bedY - 0.2, (bz0 + bz1) / 2, W, 0.6, bz1 - bz0, { kind: 'body' });
  } else if (S.rear === 'cargo') {
    // van cargo: shelving and crates
    for (const sx of [-1, 1]) {
      for (const y of [fy + 0.5, fy + 1.1]) I.box('metal_dark', sx * (hw - 0.3), y, (S.bulkhead + L / 2) / 2 + 0.2, 0.45, 0.04, 1.7, indoor);
      I.box('metal_dark', sx * (hw - 0.3), fy + 0.8, S.bulkhead + 0.4, 0.04, 1.6, 0.04, indoor);
    }
  } else if (S.troop) {
    // armoured car troop compartment: side benches facing inward, radio rack, ammo boxes
    for (const sx of [-1, 1]) {
      I.box('canvas', sx * (hw - 0.4), fy + 0.42, 1.45, 0.42, 0.1, 2.1, indoor);
      I.box('canvas', sx * (hw - 0.2), fy + 0.8, 1.45, 0.08, 0.55, 2.1, indoor);
      I.box('metal_dark', sx * (hw - 0.4), fy + 0.2, 1.45, 0.36, 0.4, 2.0, indoor);
    }
    I.box('olive', 0.6, ry - 0.35, 0.18, 0.45, 0.32, 0.3, indoor); // radio set
    I.box('metal_dark', 0.6, ry - 0.35, 0.02, 0.3, 0.06, 0.02, indoor);
    I.box('olive', -0.55, fy + 0.15, 2.4, 0.4, 0.28, 0.25, indoor); // ammo boxes
    I.box('olive', -0.1, fy + 0.15, 2.4, 0.4, 0.28, 0.25, indoor);
    B.box(P, 0, ry + 0.12, 1.1, 0.9, 0.18, 0.9); // roof hatch ring
    B.box('metal_dark', 0, ry + 0.22, 1.1, 0.7, 0.04, 0.7);
  }
  if (S.roofRack) {
    for (const sx of [-1, 1]) B.box('metal_dark', sx * (hw - 0.18), ry + 0.12, (zF + zR) / 2 + 0.3, 0.05, 0.05, zR - zF - 0.5);
    for (let z = zF + 0.7; z < zR - 0.2; z += 0.45) B.box('metal_dark', 0, ry + 0.12, z, W - 0.36, 0.04, 0.04);
  }
  if (S.spare) {
    B.cylinder('black', 0, S.sillY + 0.5, L / 2 + 0.12, S.wheelR, S.wheelR, 0.26, 16, { rotX: Math.PI / 2 });
    B.cylinder('metal', 0, S.sillY + 0.5, L / 2 + 0.26, S.wheelR * 0.55, S.wheelR * 0.55, 0.02, 12, { rotX: Math.PI / 2 });
  }
  // mirrors
  for (const sx of [-1, 1]) {
    B.box('black', sx * (hw + 0.12), by + 0.12, zF + 0.2, 0.2, 0.14, 0.05);
    B.box('metal', sx * (hw + 0.12), by + 0.12, zF + 0.23, 0.17, 0.11, 0.01);
    B.box('black', sx * (hw + 0.02), by + 0.08, zF + 0.2, 0.12, 0.03, 0.03);
  }
  // lamp housings
  for (const sx of [-1, 1]) {
    B.box('metal_dark', sx * W * 0.36, S.hoodY - 0.2, hf - 0.01, 0.3, 0.2, 0.06);
    B.box('metal_dark', sx * W * 0.4, S.sillY + 0.3, L / 2 - 0.02, 0.2, 0.18, 0.06);
  }

  // ------------------------------------------------------------------ interior
  const drv = S.rows[0];
  const dX = drv.xs[0];
  const dashZ = zF + 0.32;
  const dashTop = by + 0.04;
  const civ = S.interior === 'civil' || S.interior === 'rugged';
  const dashMat = S.interior === 'military' ? 'olive' : S.interior === 'armored' ? 'metal_dark' : trim;
  // dash body
  I.box(dashMat, 0, dashTop - 0.2, dashZ - 0.08, W - 0.24, 0.4, 0.6, indoor);
  I.box(dashMat, 0, dashTop - 0.48, dashZ + 0.1, W - 0.3, 0.2, 0.25, indoor); // lower dash
  if (civ) I.box('black', 0, dashTop + 0.01, dashZ - 0.15, W - 0.26, 0.03, 0.5, indoor); // top pad
  // gauge hood over the cluster
  I.box(dashMat, dX, dashTop + 0.06, dashZ + 0.08, 0.5, 0.12, 0.2, indoor);
  // vents and centre stack
  for (const vx of [-0.62, -0.18, 0.18, 0.62]) I.box('metal_dark', vx * W * 0.5, dashTop - 0.12, dashZ + 0.225, 0.14, 0.06, 0.02, indoor);
  if (civ || S.interior === 'van') {
    I.box('black', 0, dashTop - 0.26, dashZ + 0.24, 0.32, 0.36, 0.06, indoor); // centre stack
    I.box('metal_dark', 0, dashTop - 0.2, dashZ + 0.275, 0.2, 0.06, 0.01, indoor); // radio
    for (let i = 0; i < 3; i++) I.cylinder('metal', -0.08 + i * 0.08, dashTop - 0.34, dashZ + 0.275, 0.018, 0.018, 0.02, 8, { rotX: Math.PI / 2, indoor: true }); // HVAC knobs
    I.box(trim, -dX * 0.95, dashTop - 0.24, dashZ + 0.22, 0.4, 0.14, 0.02, indoor); // glovebox
  } else {
    // military / armoured: switch panel, toggles, data plate, grab handle
    I.box('metal_dark', 0.05, dashTop - 0.22, dashZ + 0.23, 0.5, 0.26, 0.03, indoor);
    for (let i = 0; i < 6; i++) I.cylinder('metal', -0.15 + i * 0.075, dashTop - 0.18, dashZ + 0.26, 0.008, 0.008, 0.05, 6, { rotX: Math.PI / 2 + 0.3, indoor: true });
    I.box('paint_yellow', 0.05, dashTop - 0.3, dashZ + 0.25, 0.22, 0.05, 0.01, indoor);
    I.cylinder('metal_dark', -dX * 0.8, dashTop + 0.02, dashZ + 0.22, 0.015, 0.015, 0.45, 6, { rotZ: Math.PI / 2, indoor: true });
    if (S.interior === 'armored') {
      I.box('black', -dX * 0.7, dashTop - 0.1, dashZ + 0.22, 0.26, 0.18, 0.05, indoor); // display unit
      I.box('metal_dark', 0, ry - 0.16, zF + S.rake + 0.25, 0.22, 0.26, 0.24, indoor); // periscope housing
    }
  }
  // rear-view mirror
  if (!S.smallWindows) {
    I.box('black', 0, ry - 0.12, wsTopZ + 0.05, 0.03, 0.1, 0.03, indoor);
    I.box('black', 0, ry - 0.2, wsTopZ + 0.08, 0.26, 0.07, 0.03, indoor);
  }
  // centre console with gear selector and hand brake (not on bench-only trucks)
  const consoleZ0 = dashZ + 0.25, consoleZ1 = drv.z + 0.15;
  if (consoleZ1 > consoleZ0) {
    I.box(trim, 0, fy + 0.18, (consoleZ0 + consoleZ1) / 2, 0.26, 0.34, consoleZ1 - consoleZ0, indoor);
    if (civ) I.box('black', 0, fy + 0.36, drv.z - 0.05, 0.22, 0.04, 0.3, indoor); // armrest lid
  }
  const gear = new THREE.Group();
  {
    const G = new BoxBuilder(materials);
    const tall = S.interior === 'military' || S.interior === 'armored' || S.interior === 'van';
    const h = tall ? 0.42 : 0.2;
    G.cylinder('metal_dark', 0, h / 2, 0, 0.011, 0.014, h, 8, indoor);
    G.sphere('black', 0, h, 0, tall ? 0.03 : 0.035, indoor);
    G.box('black', 0, 0.01, 0, 0.12, 0.03, 0.14, indoor); // gaiter
    if (tall) G.cylinder('metal_dark', 0.06, h * 0.35, 0.02, 0.009, 0.01, h * 0.7, 6, { rotZ: -0.2, indoor: true }); // transfer lever
    const m = G.build();
    gear.add(m);
    gear.position.set(0, fy + (consoleZ1 > consoleZ0 ? 0.36 : 0.02), Math.min(dashZ + 0.45, drv.z - 0.3));
    gear.rotation.x = 0.2;
  }
  // handbrake
  I.box('black', 0.08, fy + 0.4, drv.z - 0.12, 0.04, 0.04, 0.24, { rotX: 0.3, indoor: true });

  // seats
  const seats = [];
  const seat = (x, z, y, opts = {}) => {
    const w = opts.w || 0.5;
    const mat = S.seatMat;
    I.box('metal_dark', x, (fy + y - 0.12) / 2, z, w * 0.7, Math.max(0.04, y - 0.12 - fy), 0.4, indoor); // riser
    I.box(mat, x, y - 0.06, z - 0.04, w, 0.12, 0.52, indoor); // cushion
    I.box(mat, x, y - 0.02, z - 0.27, w, 0.07, 0.08, indoor); // front bolster
    I.box(mat, x, y + 0.32, z + 0.22, w, 0.66, 0.12, { rotX: 0.18, indoor: true }); // backrest
    if (!opts.noHead) I.box(mat, x, y + 0.75, z + 0.3, w * 0.55, 0.18, 0.1, { rotX: 0.12, indoor: true }); // headrest
    for (const sx of [-1, 1]) I.box(mat, x + sx * (w / 2 - 0.04), y + 0.2, z + 0.2, 0.08, 0.3, 0.12, { rotX: 0.18, indoor: true }); // side bolsters
  };
  S.rows.forEach((row, ri) => {
    if (row.bench) {
      const bw = W - 0.34;
      I.box(S.seatMat, 0, row.y - 0.06, row.z - 0.04, bw, 0.12, 0.5, indoor);
      I.box('metal_dark', 0, (fy + row.y - 0.12) / 2, row.z, bw * 0.9, Math.max(0.04, row.y - 0.12 - fy), 0.42, indoor);
      I.box(S.seatMat, 0, row.y + 0.32, row.z + 0.22, bw, 0.66, 0.12, { rotX: 0.18, indoor: true });
      for (const x of row.xs) if (x !== 0) I.box(S.seatMat, x, row.y + 0.74, row.z + 0.3, 0.26, 0.16, 0.1, { rotX: 0.12, indoor: true });
    } else {
      for (const x of row.xs) seat(x, row.z, row.y);
    }
    for (const x of row.xs) {
      seats.push({ hip: new THREE.Vector3(x, row.y, row.z), eye: new THREE.Vector3(x, row.y + 0.7, row.z + 0.04), driver: ri === 0 && x === dX, row: ri, x });
    }
  });
  if (S.troop) {
    // troop seats along the sides of the armoured car (facing inward: eyes look across)
    for (const z of [1.0, 1.9]) for (const sx of [-1, 1]) seats.push({ hip: new THREE.Vector3(sx * (hw - 0.4), fy + 0.47, z), eye: new THREE.Vector3(sx * (hw - 0.45), fy + 1.15, z), row: 9, x: sx, faceYaw: sx < 0 ? -Math.PI / 2 : Math.PI / 2 });
  }

  // pedals
  const pedalZ = zF + 0.42;
  for (const [ox, wdt] of [[0.1, 0.08], [-0.02, 0.1], [-0.16, 0.08]]) {
    I.box('metal_dark', dX + ox, fy + 0.13, pedalZ, wdt, 0.12, 0.02, { rotX: -0.6, indoor: true });
    I.box('metal_dark', dX + ox, fy + 0.22, pedalZ - 0.04, 0.02, 0.16, 0.02, { rotX: -0.2, indoor: true });
  }
  // dome light
  const domePos = new THREE.Vector3(0, ry - 0.06, (zF + Math.min(zR, drv.z + 0.6)) / 2 + 0.3);
  const domeMat = new THREE.MeshStandardMaterial({ color: 0xd8d4c4, emissive: 0xfff2d8, emissiveIntensity: 0, roughness: 0.4 });
  const dome = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.12), domeMat);
  dome.position.copy(domePos);

  // ------------------------------------------------------------------ steering wheel and cluster
  const steering = new THREE.Group(); // tilted column frame
  const spin = new THREE.Group(); // rotates with steering input
  steering.add(spin);
  const wheelR = S.interior === 'military' || S.interior === 'van' || S.interior === 'armored' ? 0.22 : 0.19;
  {
    const rimMat = materials.get('black');
    const rim = new THREE.Mesh(new THREE.TorusGeometry(wheelR, 0.022, 8, 28), rimMat);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.06, 12).rotateX(Math.PI / 2), rimMat);
    spin.add(rim, hub);
    for (const a of [-Math.PI / 2, Math.PI / 2 + 0.0, Math.PI * 1.5 - 0.001]) void a;
    for (const a of [Math.PI, 0, -Math.PI / 2]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(wheelR - 0.05, 0.03, 0.015), rimMat);
      sp.position.set(Math.cos(a) * wheelR * 0.5, Math.sin(a) * wheelR * 0.5, 0);
      sp.rotation.z = a;
      spin.add(sp);
    }
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.42, 8).rotateX(Math.PI / 2), materials.get('metal_dark'));
    col.position.set(0, 0, -0.24);
    steering.add(col);
  }
  const swZ = Math.min(drv.z - 0.42, dashZ + 0.48);
  steering.position.set(dX, Math.min(by + 0.02, drv.y + 0.42), swZ);
  steering.rotation.x = S.wheelTilt;
  // driver's hands and forearms on the rim (shown when the player drives)
  const driverRig = new THREE.Group();
  {
    const sleeve = materials.get('fabric_grey'), glove = materials.get('black');
    const hands = new THREE.Group();
    for (const sx of [-1, 1]) {
      const g = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.07), glove);
      g.position.set(sx * wheelR * 0.97, 0.03, 0.02);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.045, 0.34, 8), sleeve);
      arm.position.set(sx * (wheelR * 0.97 + 0.03), -0.04, 0.19);
      arm.rotation.set(-1.2, 0, sx * -0.25);
      hands.add(g, arm);
    }
    spin.add(hands);
    driverRig.userData.hands = hands;
    // thighs and shins to the pedals
    const legs = new THREE.Group();
    for (const sx of [-1, 1]) {
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.14, 0.46), sleeve);
      thigh.position.set(dX + sx * 0.11, drv.y + 0.08, drv.z - 0.22);
      thigh.rotation.x = 0.12;
      const shinLen = Math.max(0.3, drv.y + 0.02 - fy);
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.12, shinLen, 0.12), sleeve);
      shin.position.set(dX + sx * 0.11, fy + shinLen / 2 + 0.04, drv.z - 0.5);
      shin.rotation.x = -0.35;
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.26), glove);
      boot.position.set(dX + sx * 0.11, fy + 0.07, drv.z - 0.62);
      legs.add(thigh, shin, boot);
    }
    driverRig.add(legs);
    driverRig.userData.legs = legs;
    hands.visible = false;
    driverRig.visible = false;
  }
  // gauge cluster face and needles
  const clusterMat = new THREE.MeshStandardMaterial({ map: clusterTexture(S.interior), emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0, roughness: 0.6 });
  const cluster = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.18), clusterMat);
  cluster.position.set(dX, dashTop - 0.02, dashZ + 0.185);
  cluster.rotation.x = -0.25;
  const needleMat = new THREE.MeshBasicMaterial({ color: 0xe84a20 });
  const mkNeedle = (cx, len) => {
    const piv = new THREE.Group();
    const n = new THREE.Mesh(new THREE.BoxGeometry(0.004, len, 0.003), needleMat);
    n.position.y = len / 2;
    piv.add(n);
    piv.position.set(cx, 0, 0.004);
    cluster.add(piv);
    return piv;
  };
  const needles = { speed: mkNeedle(-0.18 + (70 / 256) * 0.36, 0.06), fuel: mkNeedle(-0.18 + (190 / 256) * 0.36, 0.045) };

  // ------------------------------------------------------------------ doors
  const doors = [];
  const doorBottom = S.sillY - 0.12;
  const mkDoor = (sx, z0, z1, idx, rear) => {
    const D = new BoxBuilder(materials);
    const len = z1 - z0;
    const hz = len / 2;
    // local: hinge at origin, door extends +z
    D.box(P, sx * 0.0, (doorBottom + by) / 2, hz, 0.07, by - doorBottom, len - 0.02); // outer skin
    D.box(P, 0, ry - 0.04, hz, 0.06, 0.08, len - 0.04); // window frame top
    D.box(P, 0, (by + ry) / 2, len - 0.04, 0.06, ry - by, 0.06); // rear frame
    D.box(S.interior === 'military' || S.interior === 'armored' ? 'olive' : trim, -sx * 0.05, (doorBottom + by) / 2 + 0.06, hz, 0.03, by - doorBottom - 0.1, len - 0.1, indoor); // door card
    D.box('black', -sx * 0.09, by - 0.25, hz, 0.06, 0.05, len * 0.5, indoor); // armrest
    D.box('metal', -sx * 0.075, by - 0.1, len * 0.25, 0.02, 0.03, 0.1, indoor); // inner handle
    D.box('metal_dark', sx * 0.045, by - 0.12, len * 0.7, 0.02, 0.04, 0.16); // outer handle
    if (!rear) D.box('black', -sx * 0.07, doorBottom + 0.18, hz, 0.03, 0.18, len * 0.55, indoor); // speaker / pocket
    if (S.armored) D.box(P, sx * 0.05, (doorBottom + by) / 2, hz, 0.03, by - doorBottom - 0.2, len - 0.2); // add-on armour
    const mesh = paintMesh(D, paintMat);
    mesh.castShadow = true;
    const pivot = new THREE.Group();
    pivot.position.set(sx * (hw - 0.04), 0, z0);
    pivot.add(mesh);
    const door = { pivot, side: sx, z0, z1, open: 0, target: 0, idx, rear, missing: false, hp: S.armored ? 900 : 260 };
    doors.push(door);
    // the door's window
    if (S.smallWindows) win(`d${idx}`, 0, (by + ry) / 2, len * 0.45, len * 0.35, (ry - by) * 0.5, { rotY: Math.PI / 2, door: idx, thin: 0.05 });
    else win(`d${idx}`, 0, (by + ry) / 2 - 0.02, hz - 0.02, len - 0.16, ry - by - 0.12, { rotY: Math.PI / 2, door: idx });
    return door;
  };
  let di = 0;
  for (const sx of [-1, 1]) {
    mkDoor(sx, zF + 0.04, bZ - 0.06, di++, false);
    if (S.doorsPerSide === 2) {
      const backZ = S.rear === 'trunk' ? zR : L / 2 - 0.08;
      const rearDoorEnd = bZ + Math.min(0.95, (backZ - bZ) * 0.75);
      mkDoor(sx, bZ + 0.06, rearDoorEnd, di++, true);
    }
  }
  // door hit parts (only count while the door is shut)
  for (const d of doors) part(armorMat, d.side * (hw - 0.04), (doorBottom + by) / 2, (d.z0 + d.z1) / 2, 0.12, by - doorBottom, d.z1 - d.z0, { kind: 'door', door: d.idx });

  // ------------------------------------------------------------------ windows as separate meshes
  const glassBase = materials.get('glass');
  const winObjs = windows.map((w) => {
    const mat = glassBase.clone();
    if (S.armored) { mat.color.set(0x88a0a0); mat.opacity = 0.42; }
    const pane = new THREE.Mesh(new THREE.BoxGeometry(w.rotY ? w.thin : w.w, w.h, w.rotY ? w.w : w.thin), mat);
    pane.renderOrder = 4;
    const crackMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, map: null });
    const crack = new THREE.Mesh(new THREE.PlaneGeometry(w.rotY ? w.w : w.w, w.h), crackMat);
    crack.visible = false;
    crack.renderOrder = 5;
    const holder = new THREE.Group();
    holder.add(pane, crack);
    if (w.rotY) { crack.rotation.y = Math.PI / 2; crack.position.x = 0.012; }
    else crack.position.z = -0.012;
    holder.position.set(w.x, w.y, w.z);
    holder.rotation.set(w.rotX, 0, 0, 'YXZ');
    const maxHp = (w.key.startsWith('ws') ? 110 : 70) * (S.glassHp || 1);
    const obj = { key: w.key, holder, pane, crack, crackMat, door: w.door, hp: maxHp, maxHp, stage: 0, broken: false, armored: S.armored };
    // hit box in vehicle space (door windows use the closed-door position)
    const hx = w.rotY ? 0.08 : w.w / 2, hz = w.rotY ? w.w / 2 : 0.08 + Math.abs(Math.sin(w.rotX)) * w.h / 2;
    const hy = w.h / 2 * Math.abs(Math.cos(w.rotX));
    let cx = w.x, cz = w.z;
    if (w.door !== null) { const d = doors[w.door]; cx = d.side * (hw - 0.04); cz = d.z0 + w.z; }
    hit.push({ min: [cx - hx, w.y - hy, cz - hz], max: [cx + hx, w.y + hy, cz + hz], mat: 'glass', kind: 'glass', win: obj, door: w.door });
    return obj;
  });
  for (const w of winObjs) {
    if (w.door !== null) doors[w.door].pivot.add(w.holder);
  }

  // ------------------------------------------------------------------ wheels
  const wheels = [];
  const wr = S.wheelR;
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: treadTexture(), roughness: 0.92 });
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.85 });
  const rimMat = S.interior === 'military' || S.armored ? materials.get('olive') : materials.get('metal');
  const tyreW = S.armored || t.style === 'mil_truck' ? 0.36 : 0.26;
  const tyreGeo = new THREE.CylinderGeometry(wr, wr, tyreW, 24, 1, true).rotateZ(Math.PI / 2);
  { const uv = tyreGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i)); }
  const sideGeo = new THREE.RingGeometry(wr * 0.62, wr, 24);
  const rimGeo = new THREE.CylinderGeometry(wr * 0.62, wr * 0.62, tyreW * 0.7, 16).rotateZ(Math.PI / 2);
  const lugGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.03, 6).rotateZ(Math.PI / 2);
  for (const [sx, z, front] of [[-1, S.axleF, true], [1, S.axleF, true], [-1, S.axleR, false], [1, S.axleR, false]]) {
    const steer = new THREE.Group(); // yaw for steering
    const spinG = new THREE.Group(); // rolls
    const tyre = new THREE.Mesh(tyreGeo, tyreMat);
    tyre.castShadow = true;
    spinG.add(tyre);
    for (const s2 of [-1, 1]) {
      const side = new THREE.Mesh(sideGeo, sideMat);
      side.position.x = s2 * tyreW / 2;
      side.rotation.y = s2 * Math.PI / 2;
      spinG.add(side);
    }
    const rim = new THREE.Mesh(rimGeo, rimMat);
    spinG.add(rim);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const lug = new THREE.Mesh(lugGeo, materials.get('metal_dark'));
      lug.position.set(sx * tyreW * 0.36, Math.cos(a) * wr * 0.22, Math.sin(a) * wr * 0.22);
      spinG.add(lug);
    }
    steer.add(spinG);
    steer.position.set(sx * (W / 2 - tyreW / 2 - 0.02), wr, z);
    wheels.push({ steer, spin: spinG, front, side: sx, flat: false });
  }

  // ------------------------------------------------------------------ lamps
  const lamps = { head: [], tail: [], glow: [], beams: [] };
  const headMat = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, emissive: 0xfff0d0, emissiveIntensity: 0, roughness: 0.15, metalness: 0.1 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x5a1010, emissive: 0xff2010, emissiveIntensity: 0, roughness: 0.3 });
  const lensGeo = new THREE.BoxGeometry(0.24, 0.14, 0.03), tailGeo = new THREE.BoxGeometry(0.16, 0.12, 0.03);
  const headY = S.hoodY - 0.2, tailY = S.sillY + 0.3;

  // ------------------------------------------------------------------ assemble
  const root = new THREE.Group();
  const body = paintMesh(B, paintMat);
  body.castShadow = true; body.receiveShadow = true;
  const interior = paintMesh(I, paintMat);
  interior.receiveShadow = true;
  const interiorGroup = new THREE.Group();
  interiorGroup.add(interior, steering, gear, cluster, dome, driverRig);
  root.add(body, interiorGroup);
  for (const d of doors) root.add(d.pivot);
  for (const w of winObjs) if (w.door === null) root.add(w.holder);
  for (const w of wheels) root.add(w.steer);
  return {
    root, body, interior: interiorGroup, wheels, steering, steeringSpin: spin, needles, cluster, clusterMat, doors, windows: winObjs,
    seats, hitParts: hit, dome, domeMat, driverRig, gear, spec: S, paintMat,
    lamps: Object.assign(lamps, { headMat, tailMat, lensGeo, tailGeo, headY, tailY, front: -L / 2 - 0.015, back: L / 2 + 0.015, W }),
    axle: (S.axleR - S.axleF) / 2, wheelRadius: wr,
  };
}

/** Ray (world) vs a vehicle's local hit boxes. Returns sorted hits [{t, tExit, part, normal}]. */
export function raycastParts(parts, inv, ox, oy, oz, dx, dy, dz, maxDist, skip) {
  _v.set(ox, oy, oz).applyMatrix4(inv);
  const lox = _v.x, loy = _v.y, loz = _v.z;
  // direction: rotate only
  const e = inv.elements;
  const ldx = e[0] * dx + e[4] * dy + e[8] * dz, ldy = e[1] * dx + e[5] * dy + e[9] * dz, ldz = e[2] * dx + e[6] * dy + e[10] * dz;
  const out = [];
  for (const p of parts) {
    if (skip && skip(p)) continue;
    let t0 = 0, t1 = maxDist, axis = -1, sign = 0;
    const o = [lox, loy, loz], d = [ldx, ldy, ldz];
    let ok = true;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) { if (o[a] < p.min[a] || o[a] > p.max[a]) { ok = false; break; } continue; }
      let ta = (p.min[a] - o[a]) / d[a], tb = (p.max[a] - o[a]) / d[a];
      let s = -1;
      if (ta > tb) { [ta, tb] = [tb, ta]; s = 1; }
      if (ta > t0) { t0 = ta; axis = a; sign = s; }
      t1 = Math.min(t1, tb);
      if (t1 < t0) { ok = false; break; }
    }
    if (!ok) continue;
    const n = [0, 0, 0];
    if (axis >= 0) n[axis] = sign;
    out.push({ t: t0, tExit: t1, part: p, nLocal: n });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

// ------------------------------------------------------------------ helicopter
/**
 * Light utility helicopter: glazed cockpit (pilot left, co-pilot right, two rear seats),
 * instrument panel with the same live cluster, cyclic stick that leans with the controls,
 * hinged cabin doors, skids, a tail boom with a tail rotor and a four-blade main rotor.
 * opts.wreck: crashed version (boom broken off, blades missing or bent, burnt).
 */
export function buildHelicopter(t, materials, opts = {}) {
  const W = 1.9, L = 4.2;
  const hw = W / 2;
  const paintMat = materials.get('paint_white').clone();
  paintMat.color.set(t.color);
  paintMat.name = 'paint';
  const P = 'paint_white';
  const B = new BoxBuilder(materials);
  const I = new BoxBuilder(materials);
  const hit = [];
  const part = (mat, x, y, z, w, h, d, extra = {}) => hit.push({ min: [x - w / 2, y - h / 2, z - d / 2], max: [x + w / 2, y + h / 2, z + d / 2], mat, ...extra });
  const indoor = { indoor: true };
  const fy = 0.75; // cabin floor above the ground (skids)
  const ry = 2.35; // cabin roof
  // skids and struts
  for (const sx of [-1, 1]) {
    B.cylinder('metal_dark', sx * 1.05, 0.08, 0.1, 0.06, 0.06, 3.6, 8, { rotX: Math.PI / 2 });
    B.cylinder('metal_dark', sx * 1.05, 0.14, -1.75, 0.06, 0.06, 0.3, 8, { rotX: Math.PI / 2 - 0.5 });
    for (const z of [-0.9, 1.0]) B.box('metal_dark', sx * 0.85, 0.42, z, 0.08, 0.7, 0.08, { rotZ: sx * 0.35 });
  }
  // belly and cabin floor
  B.box(P, 0, fy - 0.12, 0.2, W - 0.1, 0.25, 3.0);
  I.box('black', 0, fy + 0.02, 0.2, W - 0.24, 0.02, 2.9, indoor);
  // nose: lower chin and instrument console; upper nose is glazed
  B.box(P, 0, fy + 0.25, -1.55, W - 0.3, 0.6, 0.5, { rotX: 0.35 });
  // cabin sides behind the doors, roof and engine deck
  for (const sx of [-1, 1]) B.box(P, sx * (hw - 0.04), (fy + ry) / 2, 1.45, 0.08, ry - fy, 0.55);
  B.box(P, 0, ry + 0.03, 0.4, W - 0.2, 0.08, 2.4);
  I.box('fabric_grey', 0, ry - 0.03, 0.4, W - 0.3, 0.03, 2.3, indoor);
  B.box(P, 0, ry + 0.3, 0.9, W * 0.6, 0.5, 1.8); // engine cowling
  B.box('metal_dark', 0, ry + 0.3, 1.85, W * 0.4, 0.35, 0.2); // exhaust
  B.box(P, 0, (fy + ry) / 2, 1.75, W - 0.2, ry - fy, 0.08); // rear bulkhead
  part('metal', 0, ry + 0.3, 0.9, W * 0.6, 0.6, 1.8, { kind: 'engine' });
  part('metal', 0, fy - 0.12, 0.2, W, 0.3, 3.0, { kind: 'body' });
  part('metal', 0, ry + 0.03, 0.4, W, 0.12, 2.4, { kind: 'body' });
  for (const sx of [-1, 1]) part('metal', sx * (hw - 0.04), (fy + ry) / 2, 1.45, 0.12, ry - fy, 0.6, { kind: 'body' });
  // canopy frame
  for (const sx of [-1, 1]) {
    B.box('black', sx * (hw - 0.12), ry - 0.35, -1.2, 0.035, 0.035, 1.1, { rotX: -0.55 });
    B.box('black', sx * (hw - 0.06), (fy + ry) / 2 + 0.1, -0.85, 0.06, ry - fy - 0.2, 0.06);
  }
  B.box('black', 0, ry - 0.2, -1.35, 0.03, 0.03, 1.1, { rotX: -0.6 });
  // tail boom (missing on a wreck), fins and tail rotor
  const tail = new THREE.Group();
  if (!opts.wreck) {
    const T = new BoxBuilder(materials);
    T.cylinder(P, 0, ry - 0.1, 3.7, 0.16, 0.28, 4.2, 10, { rotX: Math.PI / 2 });
    T.box(P, 0, ry + 0.35, 5.7, 0.06, 0.9, 0.7);
    T.box(P, 0, ry - 0.1, 5.2, 1.2, 0.05, 0.4);
    const tm = paintMesh(T, paintMat);
    tm.castShadow = true;
    tail.add(tm);
  }
  // cockpit interior: instrument panel, centre console, cyclic, collective, pedals, seats
  I.box('black', 0, fy + 0.65, -1.15, W - 0.4, 0.5, 0.3, { rotX: -0.3, indoor: true });
  I.box('black', 0, fy + 0.3, -0.6, 0.3, 0.6, 0.8, indoor);
  for (let i = 0; i < 6; i++) I.cylinder('metal', -0.1 + (i % 3) * 0.1, fy + 0.58, -0.45 + Math.floor(i / 3) * 0.15, 0.012, 0.012, 0.02, 6, indoor);
  const seats = [];
  const seat = (x, z, y) => {
    I.box('metal_dark', x, (fy + y - 0.1) / 2, z, 0.45, Math.max(0.05, y - 0.1 - fy), 0.4, indoor);
    I.box('canvas', x, y - 0.05, z - 0.03, 0.48, 0.1, 0.48, indoor);
    I.box('canvas', x, y + 0.35, z + 0.22, 0.48, 0.7, 0.1, { rotX: 0.12, indoor: true });
    I.box('canvas', x, y + 0.78, z + 0.27, 0.3, 0.16, 0.08, indoor);
  };
  for (const [x, z, driver] of [[-0.45, -0.25, true], [0.45, -0.25, false], [-0.45, 1.0, false], [0.45, 1.0, false]]) {
    seat(x, z, fy + 0.45);
    seats.push({ hip: new THREE.Vector3(x, fy + 0.45, z), eye: new THREE.Vector3(x, fy + 1.15, z + 0.04), driver, row: z > 0.5 ? 1 : 0, x });
  }
  for (const ox of [0.1, -0.12]) I.box('metal_dark', -0.45 + ox, fy + 0.1, -0.85, 0.08, 0.1, 0.02, { rotX: -0.6, indoor: true }); // pedals
  I.box('metal_dark', -0.18, fy + 0.25, -0.3, 0.04, 0.04, 0.5, { rotX: 0.4, indoor: true }); // collective lever
  const steering = new THREE.Group(); // cyclic stick (leans with the controls)
  const steeringSpin = new THREE.Group();
  steering.add(steeringSpin);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.55, 8), materials.get('metal_dark'));
  stick.position.y = 0.27;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8), materials.get('black'));
  grip.position.y = 0.55;
  steeringSpin.add(stick, grip);
  steering.position.set(-0.45, fy + 0.05, -0.62);
  // cluster (same live gauges)
  const clusterMat = new THREE.MeshStandardMaterial({ map: clusterTexture('military'), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 });
  const cluster = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.18), clusterMat);
  cluster.position.set(-0.4, fy + 0.72, -1.0);
  cluster.rotation.x = -0.3;
  const needleMat = new THREE.MeshBasicMaterial({ color: 0xe84a20 });
  const mkNeedle = (cx, len) => { const piv = new THREE.Group(); const n = new THREE.Mesh(new THREE.BoxGeometry(0.004, len, 0.003), needleMat); n.position.y = len / 2; piv.add(n); piv.position.set(cx, 0, 0.004); cluster.add(piv); return piv; };
  const needles = { speed: mkNeedle(-0.18 + (70 / 256) * 0.36, 0.06), fuel: mkNeedle(-0.18 + (190 / 256) * 0.36, 0.045) };
  // canopy glass and door windows
  const windows = [];
  const glassBase = materials.get('glass');
  const pane = (key, x, y, z, w, h, rotX, rotY, door = null) => {
    const mat = glassBase.clone();
    const m = new THREE.Mesh(new THREE.BoxGeometry(rotY ? 0.015 : w, h, rotY ? w : 0.015), mat);
    m.renderOrder = 4;
    const crackMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const crack = new THREE.Mesh(new THREE.PlaneGeometry(w, h), crackMat);
    crack.visible = false;
    if (rotY) { crack.rotation.y = Math.PI / 2; crack.position.x = 0.012; } else crack.position.z = -0.012;
    const holder = new THREE.Group();
    holder.add(m, crack);
    holder.position.set(x, y, z);
    holder.rotation.set(rotX, 0, 0, 'YXZ');
    const o = { key, holder, pane: m, crack, crackMat, door, hp: 80, maxHp: 80, stage: 0, broken: false };
    windows.push(o);
    const hx = rotY ? 0.08 : w / 2, hz = rotY ? w / 2 : 0.1 + Math.abs(Math.sin(rotX)) * h / 2;
    hit.push({ min: [x - hx, y - h / 2, z - hz], max: [x + hx, y + h / 2, z + hz], mat: 'glass', kind: 'glass', win: o, door });
    return o;
  };
  pane('ws', 0, ry - 0.45, -1.35, W - 0.3, 1.0, -0.6, 0);
  pane('chin', 0, fy + 0.45, -1.75, W - 0.5, 0.45, 0.6, 0);
  // doors (cabin, hinged at the front, with large windows)
  const doors = [];
  const mkDoor = (sx, z0, z1, idx, rear) => {
    const D = new BoxBuilder(materials);
    const len = z1 - z0;
    D.box(P, 0, fy + 0.25, len / 2, 0.06, 0.5, len - 0.02);
    D.box(P, 0, ry - 0.05, len / 2, 0.06, 0.1, len - 0.02);
    D.box(P, 0, (fy + ry) / 2, len - 0.04, 0.06, ry - fy, 0.06);
    D.box('black', -sx * 0.04, fy + 0.3, len / 2, 0.02, 0.4, len - 0.1, indoor);
    const mesh = paintMesh(D, paintMat);
    const pivot = new THREE.Group();
    pivot.position.set(sx * (hw - 0.03), 0, z0);
    pivot.add(mesh);
    const d = { pivot, side: sx, z0, z1, open: 0, target: 0, idx, rear, missing: false, hp: 220 };
    doors.push(d);
    const w = pane(`d${idx}`, 0, (fy + 0.5 + ry - 0.1) / 2, len / 2, len - 0.12, ry - fy - 0.65, 0, Math.PI / 2, idx);
    // closed-door hit box in vehicle space
    const hb = hit[hit.length - 1];
    hb.min[0] = sx * (hw - 0.03) - 0.08; hb.max[0] = sx * (hw - 0.03) + 0.08;
    hb.min[2] = z0 + 0.06; hb.max[2] = z1 - 0.06;
    pivot.add(w.holder);
    hit.push({ min: [sx * (hw - 0.03) - 0.06, fy, z0], max: [sx * (hw - 0.03) + 0.06, fy + 0.5, z1], mat: 'metal', kind: 'door', door: idx });
    return d;
  };
  mkDoor(-1, -0.85, 0.35, 0, false); mkDoor(1, -0.85, 0.35, 1, false);
  mkDoor(-1, 0.4, 1.15, 2, true); mkDoor(1, 0.4, 1.15, 3, true);
  // rotors
  const rotor = new THREE.Group();
  const bladeMat = materials.get('metal_dark');
  rotor.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.3, 10), bladeMat));
  const blades = [];
  for (let i = 0; i < 4; i++) {
    if (opts.wreck && i > 0) break;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, opts.wreck ? 2.6 : 4.8), bladeMat);
    b.position.z = opts.wreck ? 1.2 : 2.4;
    const piv = new THREE.Group();
    piv.rotation.y = (i / 4) * Math.PI * 2;
    if (opts.wreck) b.rotation.x = 0.35;
    piv.add(b);
    rotor.add(piv);
    blades.push(b);
  }
  rotor.position.set(0, ry + 0.75, 0.6);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.5, 8), bladeMat);
  mast.position.set(0, ry + 0.55, 0.6);
  const tailRotor = new THREE.Group();
  if (!opts.wreck) {
    for (let i = 0; i < 2; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.1, 0.12), bladeMat); b.rotation.x = i * Math.PI / 2; tailRotor.add(b); }
    tailRotor.position.set(0.12, ry + 0.35, 5.85);
  }
  // lamps (landing light under the nose, nav lights)
  const lamps = { head: [], tail: [], glow: [], beams: [] };
  const headMat = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, emissive: 0xfff0d0, emissiveIntensity: 0, roughness: 0.15 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x5a1010, emissive: 0xff2010, emissiveIntensity: 0, roughness: 0.3 });

  const root = new THREE.Group();
  const body = paintMesh(B, paintMat);
  body.castShadow = true; body.receiveShadow = true;
  const interior = paintMesh(I, paintMat);
  const interiorGroup = new THREE.Group();
  const domeMat = new THREE.MeshStandardMaterial({ color: 0xd8d4c4, emissive: 0xfff2d8, emissiveIntensity: 0 });
  const dome = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.1), domeMat);
  dome.position.set(0, ry - 0.06, 0.3);
  const driverRig = new THREE.Group();
  driverRig.userData.hands = new THREE.Group();
  driverRig.visible = false;
  interiorGroup.add(interior, steering, cluster, dome, driverRig);
  root.add(body, interiorGroup, tail, rotor, mast, tailRotor);
  for (const d of doors) root.add(d.pivot);
  for (const w of windows) if (w.door === null) root.add(w.holder);
  return {
    root, body, interior: interiorGroup, wheels: [], steering, steeringSpin, needles, cluster, clusterMat, doors, windows, seats, hitParts: hit,
    dome, domeMat, driverRig, gear: null, paintMat, rotor, tailRotor, blades,
    spec: { W, L, axleF: -1.5, axleR: 1.5, roofY: ry, floorY: fy, heli: true },
    lamps: Object.assign(lamps, { headMat, tailMat, lensGeo: new THREE.BoxGeometry(0.2, 0.1, 0.03), tailGeo: new THREE.BoxGeometry(0.08, 0.08, 0.03), headY: fy - 0.05, tailY: ry - 0.1, front: -1.85, back: 1.8, W: 1.0 }),
    axle: 1.5, wheelRadius: 0.4,
  };
}
