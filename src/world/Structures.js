import * as THREE from 'three';
import { BuildingGenerator, Frame } from './BuildingGenerator.js';
import { Materials } from '../engine/Materials.js';

// Non-building props and site structures: fences, walls, towers, tents, containers,
// tanks, masts, docks, train cars and more. All colliders stay axis-aligned.

export class StructureBuilder extends BuildingGenerator {
  constructor(B, ctx, rng) {
    super(B, ctx, rng);
  }

  frame(x, y, z, rot = 0) {
    return new Frame(x, y, z, rot);
  }

  // ---------------------------------------------------------------- linear barriers
  /** Axis-aligned barrier from (x0,z0) to (x1,z1) (world), ground sampler gy(x,z). gaps: [{at: metres from start, w}] */
  fence(x0, z0, x1, z1, type, gy, gaps = []) {
    const horizontal = Math.abs(z1 - z0) < 0.01;
    const len = horizontal ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
    const dir = horizontal ? Math.sign(x1 - x0) : Math.sign(z1 - z0);
    const seg = type === 'chain' ? 3 : type === 'hesco' ? 1.4 : type === 'palisade' ? 0.5 : type === 'wood' || type === 'picket' || type === 'wire' ? 2.5 : 3;
    const picketMat = type === 'picket' ? this.rng.pick(['wood', 'wood', 'paint_trim', 'wood_green', 'wood_dark']) : null;
    const n = Math.max(1, Math.round(len / seg));
    const sl = len / n;
    const inGap = (d) => gaps.some((g) => d > g.at - g.w / 2 && d < g.at + g.w / 2);
    const zones = this.ctx.clearZones || [];
    for (let i = 0; i < n; i++) {
      const d0 = i * sl, d1 = (i + 1) * sl, dm = (d0 + d1) / 2;
      if (inGap(dm)) continue;
      const cx = horizontal ? x0 + dir * dm : x0, cz = horizontal ? z0 : z0 + dir * dm;
      // never fence off a building's door
      if (zones.some((zn) => Math.hypot(cx - zn.x, cz - zn.z) < zn.r + sl * 0.5)) continue;
      const y = gy(cx, cz);
      const f = new Frame(cx, y, cz, horizontal ? 0 : 1);
      switch (type) {
        case 'chain': {
          this.box(f, 'metal_dark', -sl / 2, 1.25, 0, 0.07, 2.5, 0.07, { collide: false });
          this.box(f, 'chainlink', 0, 1.15, 0, sl, 2.3, 0.02, { phys: 'fabric', blocksShots: false, blocksSight: false });
          this.box(f, 'metal_dark', 0, 2.42, 0, sl, 0.04, 0.04, { collide: false });
          // barbed wire strands
          this.box(f, 'metal_dark', 0, 2.6, 0.1, sl, 0.015, 0.015, { collide: false });
          this.box(f, 'metal_dark', 0, 2.75, 0.18, sl, 0.015, 0.015, { collide: false });
          this.box(f, 'metal_dark', -sl / 2, 2.6, 0.1, 0.03, 0.45, 0.03, { collide: false, rotX: -0.6 });
          break;
        }
        case 'wood': {
          this.box(f, 'wood_dark', -sl / 2, 0.6, 0, 0.12, 1.2, 0.12, { collide: false });
          this.box(f, 'wood', 0, 0.45, 0, sl, 0.12, 0.05, { collide: false });
          this.box(f, 'wood', 0, 0.95, 0, sl, 0.12, 0.05, { collide: false });
          this.box(f, 'wood', 0, 0.6, 0, sl, 1.2, 0.08, { phys: 'wood', blocksShots: false, blocksSight: false, collide: true, ao: false, });
          this.B.byMat.get('wood').pop(); // collider only for the solid block
          break;
        }
        case 'picket': {
          const h = 1.05;
          this.box(f, 'wood_dark', -sl / 2, h / 2 + 0.02, 0, 0.09, h + 0.12, 0.09, { collide: false });
          this.box(f, 'wood_dark', 0, 0.3, -0.035, sl, 0.07, 0.03, { collide: false });
          this.box(f, 'wood_dark', 0, 0.82, -0.035, sl, 0.07, 0.03, { collide: false });
          const np = Math.max(2, Math.floor(sl / 0.15));
          for (let k = 0; k < np; k++) {
            if (this.rng.chance(0.08)) continue; // missing picket
            const ph = h * (0.9 + this.rng.next() * 0.08);
            this.box(f, picketMat, -sl / 2 + (k + 0.5) * (sl / np), ph / 2, 0, 0.085, ph, 0.022, { collide: false, rotZ: (this.rng.next() - 0.5) * 0.06, ao: false });
          }
          this.ctx.colliders.push(this._colliderLocal(f, 0, h / 2, 0, sl, h, 0.12, 'wood', { blocksShots: false, blocksSight: false }));
          break;
        }
        case 'wire': {
          this.box(f, 'wood_dark', -sl / 2, 0.7, 0, 0.08, 1.45, 0.08, { collide: false });
          this.box(f, 'chainlink', 0, 0.66, 0, sl, 1.3, 0.02, { phys: 'fabric', blocksShots: false, blocksSight: false });
          this.box(f, 'metal_dark', 0, 1.32, 0, sl, 0.02, 0.02, { collide: false });
          break;
        }
        case 'wall': {
          this.box(f, 'concrete', 0, 1.3, 0, sl, 2.6 + 0.6, 0.3, {});
          this.box(f, 'concrete_dark', 0, 2.95, 0, sl + 0.02, 0.1, 0.4, { collide: false });
          break;
        }
        case 'scrap': {
          const mats = ['corrugated_rust', 'corrugated', 'corrugated_blue', 'wood_dark'];
          const m = mats[(i * 7 + Math.floor(x0)) % mats.length];
          this.box(f, m, 0, 1.2, 0, sl, 2.4 + (i % 3) * 0.2, 0.08, { phys: 'sheet', rotZ: (this.rng.next() - 0.5) * 0.05 });
          this.box(f, 'wood_dark', -sl / 2, 1.3, 0.1, 0.14, 2.6, 0.14, { collide: false });
          break;
        }
        case 'hesco': {
          this.box(f, 'canvas_tan', 0, 1.1, 0, sl - 0.04, 2.2, 1.4, { phys: 'sand' });
          this.box(f, 'metal_dark', 0, 2.21, 0, sl, 0.03, 1.42, { collide: false });
          break;
        }
        case 'palisade': {
          const h = 3 + (i % 3) * 0.25;
          this.cyl(f, 'logs', 0, h / 2, 0, 0.22, h, 6, { collide: false });
          this.box(f, 'logs', 0, 1.6, 0, sl, 3.2, 0.44, { collide: true, phys: 'wood' });
          this.B.byMat.get('logs').pop();
          break;
        }
        case 'sandbag': {
          this.sandbagRow(f, 0, 0, sl);
          break;
        }
        default: break;
      }
    }
  }

  sandbagRow(f, lx, lz, len, rows = 4) {
    const bags = Math.max(1, Math.round(len / 0.6));
    for (let r = 0; r < rows; r++) {
      for (let b = 0; b < bags; b++) {
        const off = (r % 2) * 0.3;
        const x = lx - len / 2 + (b + 0.5) * (len / bags) + off * 0.5;
        if (x > lx + len / 2 - 0.1) continue;
        this.box(f, 'canvas_tan', x, 0.12 + r * 0.22, lz, len / bags - 0.03, 0.22, 0.45, { collide: false, shade: 0.9 + ((r + b) % 3) * 0.05, rotY: (b % 2 ? 0.04 : -0.04) });
      }
    }
    this.ctx.colliders.push(this._colliderLocal(f, lx, rows * 0.22 / 2, lz, len, rows * 0.22, 0.5, 'sand'));
  }

  _colliderLocal(f, lx, ly, lz, w, h, d, material, opts = {}) {
    const [W, D] = f.dims(w, d);
    const cx = f.wx(lx, lz), cz = f.wz(lx, lz), cy = f.y + ly;
    return this.ctx.physics.addBox(cx - W / 2, cy - h / 2, cz - D / 2, cx + W / 2, cy + h / 2, cz + D / 2, { material, owner: this.ctx.owner, ...opts });
  }

  jersey(x, y, z, rot) {
    const f = new Frame(x, y, z, rot);
    this.box(f, 'concrete', 0, 0.2, 0, 3.0, 0.4, 0.62, { collide: false });
    this.box(f, 'concrete', 0, 0.62, 0, 3.0, 0.45, 0.3, { collide: false });
    this.ctx.colliders.push(this._colliderLocal(f, 0, 0.42, 0, 3.0, 0.84, 0.6, 'concrete'));
  }

  boomGate(x, y, z, rot, width = 6) {
    const f = new Frame(x, y, z, rot);
    this.box(f, 'concrete', -width / 2 - 0.4, 0.55, 0, 0.6, 1.1, 0.6);
    this.box(f, 'hazard', 0, 1.05, 0, width, 0.12, 0.12, { collide: false });
    for (let i = 0; i < 5; i++) this.box(f, 'paint_red', -width / 2 + 0.6 + i * (width / 5), 1.05, 0, 0.5, 0.13, 0.13, { collide: false });
    this.ctx.colliders.push(this._colliderLocal(f, 0, 1.05, 0, width, 0.4, 0.2, 'metal', { blocksSight: false, blocksShots: false }));
  }

  // ---------------------------------------------------------------- towers & masts
  guardTower(x, y, z, rot = 0, opts = {}) {
    const f = new Frame(x, y, z, rot);
    const H = opts.height || 5.4, S = 2.8;
    for (const [lx, lz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) this.box(f, 'wood_dark', lx, H / 2, lz, 0.2, H, 0.2);
    // cross bracing
    for (const lz of [-1.2, 1.2]) this.box(f, 'wood_dark', 0, H * 0.45, lz, 0.1, H * 0.95, 0.1, { collide: false, rotZ: 0.45 });
    this.box(f, 'wood', 0, H, 0, S, 0.16, S); // platform
    // half walls with a ladder hatch on S side
    this.box(f, 'wood', 0, H + 0.6, -S / 2 + 0.05, S, 1.1, 0.1, { phys: 'wood' });
    this.box(f, 'wood', S / 2 - 0.05, H + 0.6, 0, 0.1, 1.1, S, { phys: 'wood' });
    this.box(f, 'wood', -S / 2 + 0.05, H + 0.6, 0, 0.1, 1.1, S, { phys: 'wood' });
    this.box(f, 'wood', 0.6, H + 0.6, S / 2 - 0.05, S - 1.2, 1.1, 0.1, { phys: 'wood' });
    if (opts.sandbags) this.sandbagRow(new Frame(f.wx(0, -S / 2 + 0.35), y + H + 0.08, f.wz(0, -S / 2 + 0.35), rot), 0, 0, S - 0.4, 3);
    // roof
    for (const [lx, lz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) this.box(f, 'wood_dark', lx, H + 1.4, lz, 0.1, 2.8, 0.1, { collide: false });
    this.box(f, opts.roofMat || 'corrugated', 0, H + 2.85, 0, S + 0.6, 0.08, S + 0.6, { collide: false, rotX: 0.06 });
    // ladder on S side
    const lzS = S / 2 + 0.25;
    for (let r = 0.3; r < H + 0.9; r += 0.35) this.box(f, 'wood_dark', -0.6, r, lzS, 0.5, 0.05, 0.05, { collide: false });
    this.box(f, 'wood_dark', -0.85, (H + 1) / 2, lzS, 0.06, H + 1, 0.06, { collide: false });
    this.box(f, 'wood_dark', -0.35, (H + 1) / 2, lzS, 0.06, H + 1, 0.06, { collide: false });
    const lw = f.wx(-0.6, lzS - 0.25), lz = f.wz(-0.6, lzS - 0.25);
    const nx = f.wx(0, 1) - f.x, nz = f.wz(0, 1) - f.z;
    this.ctx.ladders.push(this.ctx.physics.addLadder(lw, lz, y, y + H + 0.2, nx, nz, this.ctx.owner));
    // ammo crate + guard post on top
    this.ctx.containers.push({ x: f.wx(0.7, -0.7), y: y + H + 0.4, z: f.wz(0.7, -0.7), name: 'Ammo Crate', profile: opts.profile || 'military', capacity: 6, kind: 'ammobox' });
    this.box(f, 'olive', 0.7, H + 0.3, -0.7, 0.8, 0.4, 0.5, { collide: false });
    this.ctx.spots.push({ type: 'tower', x: f.x, z: f.z, y: y + H + 0.1 });
  }

  commMast(x, y, z, height = 38) {
    const f = new Frame(x, y, z, 0);
    const base = 2.6;
    const secH = 3;
    const width = (h) => base * (1 - (h / height) * 0.62);
    for (let h = 0; h < height; h += secH) {
      const s0 = width(h), s1 = width(h + secH);
      const band = Math.floor(h / (secH * 2)) % 2 === 0 ? 'paint_red' : 'paint_white';
      // tapered legs
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const lean = Math.atan2((s0 - s1) / 2, secH);
        this.box(f, band, sx * (s0 + s1) / 4, h + secH / 2, sz * (s0 + s1) / 4, 0.14, secH + 0.04, 0.14, { collide: h < 3, rotZ: sx * lean, rotX: -sz * lean });
      }
      // horizontal ring
      const sm = s0;
      for (const [lx, lz, w, d] of [[0, -sm / 2, sm, 0.06], [0, sm / 2, sm, 0.06], [-sm / 2, 0, 0.06, sm], [sm / 2, 0, 0.06, sm]]) this.box(f, 'paint_white', lx, h + 0.05, lz, w, 0.06, d, { collide: false });
      // X-bracing on all four faces
      const sa = (s0 + s1) / 2;
      const diag = Math.hypot(sa, secH), ang = Math.atan2(secH, sa);
      for (const dir of [1, -1]) {
        this.box(f, 'paint_white', 0, h + secH / 2, -sa / 2, diag, 0.05, 0.05, { collide: false, rotZ: dir * ang });
        this.box(f, 'paint_white', 0, h + secH / 2, sa / 2, diag, 0.05, 0.05, { collide: false, rotZ: dir * ang });
        this.box(f, 'paint_white', -sa / 2, h + secH / 2, 0, 0.05, 0.05, diag, { collide: false, rotX: dir * ang });
        this.box(f, 'paint_white', sa / 2, h + secH / 2, 0, 0.05, 0.05, diag, { collide: false, rotX: dir * ang });
      }
    }
    // working platform at 18 m with railing
    const p1 = 18;
    const s1 = width(p1);
    const P = s1 + 1.6;
    this.box(f, 'metal_dark', 0, p1, 0, P, 0.1, P);
    for (const [lx, lz, w, d] of [[0, P / 2, P, 0.05], [0, -P / 2, P, 0.05], [P / 2, 0, 0.05, P]]) {
      this.box(f, 'metal', lx, p1 + 1.0, lz, w, 0.05, d, { collide: false });
      this.box(f, 'metal', lx, p1 + 0.5, lz, w, 0.04, d, { collide: false });
    }
    for (const [lx, lz] of [[P / 2, P / 2], [P / 2, -P / 2], [-P / 2, P / 2], [-P / 2, -P / 2]]) this.box(f, 'metal', lx, p1 + 0.5, lz, 0.05, 1.0, 0.05, { collide: false });
    this._colliderLocalPush(f, 0, p1 + 0.5, P / 2, P, 1, 0.1);
    this._colliderLocalPush(f, 0, p1 + 0.5, -P / 2, P, 1, 0.1);
    this._colliderLocalPush(f, P / 2, p1 + 0.5, 0, 0.1, 1, P);
    // microwave dishes and panel antennas
    for (const [a, yy] of [[0.3, p1 + 2.2], [2.2, p1 + 4.5]]) {
      const r = width(yy) / 2 + 0.5;
      const dx = Math.cos(a) * r, dz = Math.sin(a) * r;
      this.cyl(f, 'paint_white', dx, yy, dz, 0.65, 0.35, 16, { collide: false, rotZ: Math.PI / 2, rotY: -a, rBot: 0.5 });
      this.cyl(f, 'metal_dark', dx * 0.85, yy, dz * 0.85, 0.08, 0.6, 6, { collide: false, rotZ: Math.PI / 2, rotY: -a });
    }
    const top = height - 4;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const r = width(top) / 2 + 0.35;
      this.box(f, 'paint_white', Math.cos(a) * r, top, Math.sin(a) * r, 0.32, 2.2, 0.12, { collide: false, rotY: -a + Math.PI / 2 });
    }
    // top mast, whip antennas and aviation lights
    this.box(f, 'metal_dark', 0, height + 3, 0, 0.1, 6, 0.1, { collide: false });
    for (const sx of [-1, 1]) this.box(f, 'metal_dark', sx * 0.5, height + 1.5, 0, 0.03, 3.0, 0.03, { collide: false });
    this.box(f, 'emissive_red', 0, height + 6.1, 0, 0.25, 0.25, 0.25, { collide: false });
    this.box(f, 'emissive_red', 0.45, p1 + 0.3, 0.45, 0.15, 0.15, 0.15, { collide: false });
    // cable ladder up the west face to the platform
    const lx = -s1 / 2 - 0.45;
    for (let r = 0.3; r < p1 + 1; r += 0.35) this.box(f, 'metal_dark', lx, r, 0, 0.05, 0.05, 0.5, { collide: false });
    this.box(f, 'metal_dark', lx, (p1 + 1) / 2, -0.25, 0.04, p1 + 1, 0.04, { collide: false });
    this.box(f, 'metal_dark', lx, (p1 + 1) / 2, 0.25, 0.04, p1 + 1, 0.04, { collide: false });
    this.ctx.ladders.push(this.ctx.physics.addLadder(f.x + lx + 0.3, f.z, y, y + p1 + 0.2, -1, 0, this.ctx.owner));
    this.ctx.spots.push({ type: 'tower', x: f.x, z: f.z, y: y + p1 + 0.1 });
    // equipment cabinets at the base
    this.box(f, 'paint_white', base + 1.4, 0.9, 0.5, 1.2, 1.8, 0.8);
    this.box(f, 'paint_white', base + 1.4, 0.9, -0.6, 1.2, 1.8, 0.8);
    this.box(f, 'metal_dark', base + 0.8, 1.0, 0, 0.06, 0.06, 1.6, { collide: false });
  }

  _colliderLocalPush(f, lx, ly, lz, w, h, d) {
    this.ctx.colliders.push(this._colliderLocal(f, lx, ly, lz, w, h, d, 'metal', { blocksSight: false, blocksShots: false }));
  }

  radarDome(x, y, z) {
    const f = new Frame(x, y, z, 0);
    this.box(f, 'concrete', 0, 2.5, 0, 9, 5, 9);
    this.B.sphere('paint_white', x, y + 5, z, 5.2, { hemi: true, segs: 24, rings: 12 });
    this.ctx.colliders.push(this.ctx.physics.addCylinder(x, z, 4.6, y + 5, y + 9.5, { material: 'sheet', owner: this.ctx.owner }));
  }

  // ---------------------------------------------------------------- shelters
  tent(x, y, z, rot, opts = {}) {
    const f = new Frame(x, y, z, rot);
    const w = opts.w || 4.2, d = opts.d || 6, h = opts.h || 2.6;
    const mat = opts.mat || 'canvas';
    // gable canvas body along local z
    const ang = Math.atan2(h - 1.0, w / 2);
    const slope = Math.hypot(w / 2, h - 1.0);
    this.B.box(mat, f.wx(-w / 4, 0), y + 1.0 + (h - 1.0) / 2, f.wz(-w / 4, 0), slope, 0.04, d, { rotY: f.theta, rotZ: ang });
    this.B.box(mat, f.wx(w / 4, 0), y + 1.0 + (h - 1.0) / 2, f.wz(w / 4, 0), slope, 0.04, d, { rotY: f.theta, rotZ: -ang });
    this.box(f, mat, -w / 2, 0.5, 0, 0.04, 1.0, d, { phys: 'fabric', blocksShots: false });
    this.box(f, mat, w / 2, 0.5, 0, 0.04, 1.0, d, { phys: 'fabric', blocksShots: false });
    this.B.gable(mat, f.wx(0, -d / 2), y + 1.0, f.wz(0, -d / 2), w, h - 1.0, 0.04, { rotY: f.theta });
    this.box(f, mat, 0, 0.5, -d / 2, w, 1.0, 0.04, { phys: 'fabric', blocksShots: false });
    this.ctx.colliders.push(this._colliderLocal(f, 0, 1.6, -d / 2, w, 1.4, 0.06, 'fabric', { blocksShots: false }));
    // floor + interior
    this.box(f, 'canvas_tan', 0, 0.02, 0, w - 0.1, 0.03, d - 0.1, { collide: false, shade: 0.7 });
    if (opts.cots !== false) {
      this.B.box('canvas', f.wx(-w / 2 + 0.6, -0.5), y + 0.4, f.wz(-w / 2 + 0.6, -0.5), 0.75, 0.06, 1.9, { rotY: f.theta, shade: 0.75 });
      this.B.box('canvas', f.wx(w / 2 - 0.6, -0.5), y + 0.4, f.wz(w / 2 - 0.6, -0.5), 0.75, 0.06, 1.9, { rotY: f.theta, shade: 0.75 });
    }
    this.box(f, 'olive', 0, 0.4, -d / 2 + 0.6, 1.0, 0.8, 0.7, { shade: 0.75 });
    this.ctx.containers.push({ x: f.wx(0, -d / 2 + 0.6), y: y + 0.8, z: f.wz(0, -d / 2 + 0.6), name: opts.crateName || 'Supply Crate', profile: opts.profile || 'military', capacity: 10, kind: 'crate' });
    this.ctx.spots.push({ type: 'inside', x: f.x, z: f.z, y });
  }

  shippingContainer(x, y, z, rot, color = 'corrugated', profile = 'industrial') {
    this.building({ x, z, rot, w: 2.44, d: 6.06, floorH: 2.6, wallMat: color, roof: 'none', thick: 0.08, plinth: 0.1,
      doors: [{ side: 'S', at: 0, w: 2.2, h: 2.3, gap: true }], windows: { S: 0, N: 0, E: 0, W: 0 }, floorMat: 'wood_dark', ceilMat: color,
      furniture: null, profile }, y);
    const f = new Frame(x, y, z, rot);
    this.box(f, 'olive', 0.4, 0.55, -1.8, 1.0, 0.8, 0.8, { shade: 0.6 });
    this.ctx.containers.push({ x: f.wx(0.4, -1.8), y: y + 0.9, z: f.wz(0.4, -1.8), name: 'Container Cargo', profile, capacity: 12, kind: 'crate' });
    // open door leaves
    this.box(f, color, -1.25, 1.35, 3.55, 0.05, 2.4, 1.1, { collide: false, rotY: 0.0 });
  }

  // ---------------------------------------------------------------- industrial
  silo(x, y, z, r = 3, h = 14) {
    const f = new Frame(x, y, z, 0);
    this.cyl(f, 'metal', 0, h / 2, 0, r, h, 16);
    this.cyl(f, 'metal', 0, h + 1, 0, 0.3, 2, 16, { rBot: r, collide: false });
    for (let k = 0; k < 4; k++) this.cyl(f, 'metal_dark', 0, 2 + k * 3, 0, r + 0.04, 0.12, 16, { collide: false });
  }

  tank(x, y, z, r = 4, h = 7, mat = 'paint_white') {
    const f = new Frame(x, y, z, 0);
    this.cyl(f, mat, 0, h / 2, 0, r, h, 20);
    this.cyl(f, mat, 0, h + 0.4, 0, r * 0.7, 0.8, 20, { rBot: r, collide: false });
    this.box(f, 'metal_dark', r + 0.4, h / 2, 0, 0.08, h, 0.6, { collide: false });
  }

  hTank(x, y, z, rot, len = 8, r = 1.4, mat = 'paint_white') {
    const f = new Frame(x, y, z, rot);
    this.cyl(f, mat, 0, r + 0.6, 0, r, len, 16, { rotX: Math.PI / 2, collide: false });
    this.box(f, 'concrete', 0, 0.3, -len * 0.3, r * 1.6, 0.6, 0.5, { collide: false });
    this.box(f, 'concrete', 0, 0.3, len * 0.3, r * 1.6, 0.6, 0.5, { collide: false });
    this.ctx.colliders.push(this._colliderLocal(f, 0, r + 0.6, 0, r * 2, r * 2 + 1.2, len, 'metal'));
  }

  chimney(x, y, z, h = 30) {
    const f = new Frame(x, y, z, 0);
    this.cyl(f, 'brick', 0, h / 2, 0, 0.9, h, 14, { rBot: 1.6 });
    this.cyl(f, 'concrete_dark', 0, h, 0, 1.0, 0.6, 14, { collide: false });
  }

  pipe(x0, y0, z0, x1, z1, r = 0.35, height = 3) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const horizontal = Math.abs(z1 - z0) < 0.01;
    const f = new Frame((x0 + x1) / 2, y0, (z0 + z1) / 2, horizontal ? 1 : 0);
    this.cyl(f, 'metal', 0, height, 0, r, len, 10, { rotX: Math.PI / 2, collide: false });
    for (let d = -len / 2 + 1; d < len / 2; d += 6) this.box(f, 'metal_dark', 0, height / 2, d, 0.15, height, 0.15, { collide: false });
    this.ctx.colliders.push(this._colliderLocal(f, 0, height, 0, r * 2, r * 2, len, 'metal', { blocksSight: false }));
  }

  canopy(x, y, z, w, d, h = 4.8) {
    const f = new Frame(x, y, z, 0);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(f, 'paint_white', sx * (w / 2 - 1), h / 2, sz * (d / 2 - 1), 0.35, h, 0.35);
    this.box(f, 'paint_white', 0, h + 0.3, 0, w, 0.6, d, { collide: false });
    this.box(f, 'paint_red', 0, h + 0.3, d / 2 + 0.01, w, 0.4, 0.02, { collide: false });
  }

  fuelPump(x, y, z, rot) {
    const f = new Frame(x, y, z, rot);
    this.box(f, 'concrete', 0, 0.1, 0, 1.4, 0.2, 0.9);
    this.box(f, 'paint_red', 0, 0.95, 0, 0.8, 1.5, 0.45);
    this.box(f, 'black', 0, 1.3, 0.23, 0.5, 0.35, 0.02, { collide: false });
    this.ctx.pumps.push({ x, y: y + 1.0, z });
  }

  logPile(x, y, z, rot, len = 6) {
    const f = new Frame(x, y, z, rot);
    const rows = [5, 4, 3];
    rows.forEach((n, r) => {
      for (let i = 0; i < n; i++) {
        const lz = (i - (n - 1) / 2) * 0.62;
        this.cyl(f, 'logs', 0, 0.3 + r * 0.52, lz, 0.3, len, 8, { rotZ: Math.PI / 2, collide: false });
      }
    });
    this.ctx.colliders.push(this._colliderLocal(f, 0, 0.8, 0, len, 1.6, 3.2, 'wood'));
  }

  openShed(x, y, z, rot, w = 10, d = 6, h = 4) {
    const f = new Frame(x, y, z, rot);
    for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) this.box(f, 'wood_dark', sx * (w / 2 - 0.2), h / 2, sz * (d / 2 - 0.2), 0.25, h, 0.25);
    this.box(f, 'corrugated_rust', 0, h + 0.1, 0, w + 0.8, 0.08, d + 0.8, { collide: false, rotX: 0.05 });
    this.box(f, 'concrete_dark', 0, 0.05, 0, w, 0.1, d, { collide: false });
  }

  sawTable(x, y, z, rot) {
    const f = new Frame(x, y, z, rot);
    this.box(f, 'metal_dark', 0, 0.45, 0, 1.2, 0.9, 4.0);
    this.cyl(f, 'metal', 0, 1.0, 0, 0.55, 0.05, 20, { rotZ: Math.PI / 2, collide: false });
    this.cyl(f, 'logs', 0, 1.25, 1.2, 0.3, 3.5, 8, { rotX: Math.PI / 2, collide: false });
  }

  pool(x, y, z, r = 9) {
    const f = new Frame(x, y, z, 0);
    const segs = 16;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const px = Math.cos(a) * r, pz = Math.sin(a) * r;
      this.box(f, 'concrete', px, 0.6, pz, 0.4, 1.2, (Math.PI * 2 * r) / segs + 0.1, { rotY: -a, collide: false });
      this.ctx.colliders.push(this.ctx.physics.addCylinder(x + px, z + pz, 0.5, y - 1, y + 1.2, { material: 'concrete', owner: this.ctx.owner }));
    }
    this.cyl(f, 'concrete_dark', 0, 0.9, 0, 0.6, 1.8, 10);
    this.box(f, 'metal_dark', 0, 1.3, 0, r * 2, 0.15, 0.6, { collide: false });
    this.ctx.waterDiscs.push({ x, y: y + 0.85, z, r: r - 0.2 });
  }

  damWall(x, y, z, rot, len = 60, h = 14) {
    const f = new Frame(x, y, z, rot);
    this.box(f, 'concrete', 0, h / 2 - 4, 0, len, h + 8, 6);
    this.box(f, 'concrete_dark', 0, h + 0.5 - 4, 3, len, 1, 0.3, { collide: true });
    this.box(f, 'concrete_dark', 0, h + 0.5 - 4, -3, len, 1, 0.3, { collide: true });
    for (let i = -2; i <= 2; i++) this.box(f, 'metal_dark', i * 8, h / 2 - 5, 3.2, 3, h - 2, 0.4, { collide: false });
  }

  dock(x, y, z, rot, len = 24, w = 3, waterY = 0) {
    const f = new Frame(x, y, z, rot);
    const deckY = Math.max(waterY + 0.6, 0);
    this.box(f, 'wood', 0, deckY, 0, w, 0.15, len);
    for (let d = -len / 2 + 1; d < len / 2; d += 3) {
      for (const sx of [-1, 1]) this.cyl(f, 'logs', sx * (w / 2 - 0.15), deckY - 2, d, 0.15, 4, 6, { collide: false });
    }
  }

  boat(x, y, z, rot, len = 6) {
    const f = new Frame(x, y, z, rot);
    this.box(f, 'paint_white', 0, 0.45, 0, 2.0, 0.7, len * 0.8);
    this.box(f, 'paint_white', 0, 0.5, len * 0.45, 1.2, 0.6, len * 0.2, { rotY: Math.PI / 4, collide: false });
    this.box(f, 'corrugated_blue', 0, 0.82, 0, 1.9, 0.08, len * 0.78, { collide: false });
    this.box(f, 'paint_white', 0, 1.3, -len * 0.1, 1.5, 0.9, 1.6, { collide: false });
    this.box(f, 'glass_dirty', 0, 1.45, -len * 0.1 + 0.81, 1.3, 0.5, 0.02, { collide: false });
  }

  trainCar(x, y, z, rot, type = 'box', color = 'corrugated_rust') {
    const f = new Frame(x, y, z, rot);
    const L = 14, W = 3;
    for (const d of [-L / 2 + 1.8, L / 2 - 1.8]) {
      this.box(f, 'black', 0, 0.5, d, W - 0.4, 0.6, 2.4, { collide: false });
      for (const sx of [-1, 1]) for (const dz of [-0.7, 0.7]) this.cyl(f, 'metal_dark', sx * 0.72, 0.45, d + dz, 0.42, 0.15, 10, { rotZ: Math.PI / 2, collide: false });
    }
    this.box(f, 'metal_dark', 0, 1.0, 0, W, 0.3, L, { collide: false });
    if (type === 'tank') {
      this.cyl(f, color, 0, 2.6, 0, 1.4, L - 1, 16, { rotX: Math.PI / 2, collide: false });
      this.ctx.colliders.push(this._colliderLocal(f, 0, 2.0, 0, W, 3.2, L, 'metal'));
    } else if (type === 'flat') {
      this.box(f, 'wood_dark', 0, 1.2, 0, W, 0.1, L, { collide: false });
      this.ctx.colliders.push(this._colliderLocal(f, 0, 0.65, 0, W, 1.3, L, 'metal'));
      this.box(f, 'canvas_tan', 0, 1.8, 2, W - 0.4, 1.1, 4);
    } else {
      // boxcar with sliding door opening on +x side
      const h = 3;
      this.box(f, color, 0, 1.15 + h / 2, -L / 2 + 0.05, W, h, 0.1, { phys: 'sheet' });
      this.box(f, color, 0, 1.15 + h / 2, L / 2 - 0.05, W, h, 0.1, { phys: 'sheet' });
      this.box(f, color, -W / 2 + 0.05, 1.15 + h / 2, 0, 0.1, h, L, { phys: 'sheet' });
      this.box(f, color, W / 2 - 0.05, 1.15 + h / 2, -L / 4 - 1, 0.1, h, L / 2 - 2, { phys: 'sheet' });
      this.box(f, color, W / 2 - 0.05, 1.15 + h / 2, L / 4 + 1, 0.1, h, L / 2 - 2, { phys: 'sheet' });
      this.box(f, color, 0, 1.15 + h, 0, W, 0.1, L, { faceShade: [1, 1, 1, 0.5, 1, 1] });
      this.box(f, 'wood_dark', 0, 1.2, 0, W - 0.2, 0.1, L - 0.2, { faceShade: [1, 1, 0.6, 1, 1, 1] });
      this.ctx.colliders.push(this._colliderLocal(f, 0, 0.6, 0, W, 1.2, L, 'metal'));
      this.ctx.containers.push({ x: f.wx(-0.6, -3), y: y + 1.8, z: f.wz(-0.6, -3), name: 'Freight', profile: 'industrial', capacity: 12, kind: 'crate' });
      this.box(f, 'pallet' in {} ? 'wood_dark' : 'canvas_tan', -0.6, 1.7, -3, 1.2, 0.9, 1.1, { collide: false, shade: 0.6 });
    }
  }

  rockPile(x, y, z, size = 4) {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rng.next();
      const r = size * 0.35 * this.rng.next();
      const s = size * (0.35 + this.rng.next() * 0.35);
      this.B.box('rock', x + Math.cos(a) * r, y + s * 0.3, z + Math.sin(a) * r, s, s * 0.7, s * 0.9, { rotY: this.rng.next() * 3, rotZ: (this.rng.next() - 0.5) * 0.4, rotX: (this.rng.next() - 0.5) * 0.4 });
    }
    this.ctx.colliders.push(this.ctx.physics.addCylinder(x, z, size * 0.55, y - 1, y + size * 0.5, { material: 'rock', owner: this.ctx.owner }));
  }

  // ---------------------------------------------------------------- village dressing
  /** Tree planted by a layout (rendered with the terrain's instanced vegetation). */
  tree(x, y, z, type = 'broadleaf', s = 1) {
    this.ctx.trees.push({ type, x, y, z, s, rot: this.rng.next() * Math.PI * 2 });
    if (type !== 'bush') this.ctx.colliders.push(this.ctx.physics.addCylinder(x, z, 0.28 * s + 0.08, y - 1, y + 9 * s, { material: 'wood', owner: this.ctx.owner, tag: 'tree' }));
  }

  bench(x, y, z, rot) {
    const f = new Frame(x, y, z, rot);
    for (const lx of [-0.75, 0.75]) {
      this.box(f, 'metal_dark', lx, 0.22, 0.05, 0.05, 0.44, 0.4, { collide: false });
      this.box(f, 'metal_dark', lx, 0.62, -0.17, 0.05, 0.45, 0.05, { collide: false, rotX: -0.15 });
    }
    for (let i = 0; i < 3; i++) this.box(f, 'wood', 0, 0.45, -0.1 + i * 0.12, 1.8, 0.04, 0.1, { collide: false });
    for (let i = 0; i < 2; i++) this.box(f, 'wood', 0, 0.62 + i * 0.16, -0.2, 1.8, 0.1, 0.03, { collide: false, rotX: -0.15 });
    this.ctx.colliders.push(this._colliderLocal(f, 0, 0.4, 0, 1.8, 0.8, 0.5, 'wood', { blocksSight: false }));
  }

  well(x, y, z, rot = 0) {
    const f = new Frame(x, y, z, rot);
    this.cyl(f, 'stone', 0, 0.45, 0, 0.85, 0.9, 16);
    this.cyl(f, 'concrete_dark', 0, 0.92, 0, 0.9, 0.06, 16, { collide: false });
    for (const lx of [-0.75, 0.75]) this.box(f, 'wood_dark', lx, 1.3, 0, 0.12, 1.9, 0.12, { collide: false });
    this.cyl(f, 'wood', 0, 1.75, 0, 0.09, 1.5, 8, { collide: false, rotZ: Math.PI / 2 });
    this.box(f, 'wood_dark', 0.85, 1.6, 0.2, 0.05, 0.3, 0.05, { collide: false });
    this.box(f, 'roof_tile', -0.45, 2.45, 0, 1.15, 0.06, 1.5, { collide: false, rotZ: 0.6 });
    this.box(f, 'roof_tile', 0.45, 2.45, 0, 1.15, 0.06, 1.5, { collide: false, rotZ: -0.6 });
    this.cyl(f, 'metal_dark', 0.25, 1.3, 0, 0.13, 0.25, 10, { collide: false });
    this.ctx.waterDiscs.push({ x, y: y + 0.45, z, r: 0.7 });
  }

  memorial(x, y, z, rot = 0) {
    const f = new Frame(x, y, z, rot);
    this.box(f, 'concrete', 0, 0.15, 0, 4.2, 0.3, 4.2);
    this.box(f, 'concrete', 0, 0.42, 0, 3.0, 0.24, 3.0);
    this.box(f, 'stone', 0, 0.75, 0, 1.6, 0.42, 1.6);
    this.cyl(f, 'concrete', 0, 3.4, 0, 0.12, 4.9, 4, { rBot: 0.62, rotY: Math.PI / 4 });
    this.box(f, 'metal_dark', 0, 0.8, 0.81, 1.0, 0.3, 0.02, { collide: false });
    for (const [lx, lz] of [[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]]) this.box(f, 'metal_dark', lx, 0.6, lz, 0.08, 0.6, 0.08, { collide: false });
    for (const [lx, lz, w, d] of [[0, -1.9, 3.8, 0.02], [0, 1.9, 3.8, 0.02], [-1.9, 0, 0.02, 3.8], [1.9, 0, 0.02, 3.8]]) this.box(f, 'metal_dark', lx, 0.8, lz, w, 0.02, d, { collide: false });
  }

  busStop(x, y, z, rot) {
    const f = new Frame(x, y, z, rot);
    this.box(f, 'concrete', 0, 0.06, 0, 3.6, 0.12, 1.8, { collide: false });
    this.box(f, 'concrete', 0, 1.2, -0.85, 3.6, 2.3, 0.15, {});
    this.box(f, 'concrete', -1.75, 1.2, -0.2, 0.12, 2.3, 1.3, {});
    this.box(f, 'concrete', 1.75, 1.2, -0.2, 0.12, 2.3, 1.3, {});
    this.box(f, 'concrete', 0, 2.42, -0.1, 3.9, 0.15, 2.0, { collide: false });
    this.box(f, 'wood', 0, 0.48, -0.6, 3.0, 0.06, 0.4, { collide: false });
    this.box(f, 'concrete_dark', 0, 0.24, -0.6, 3.0, 0.4, 0.3, { collide: false });
    this.cyl(f, 'metal_dark', 2.4, 1.3, 0.6, 0.04, 2.6, 8);
    this.box(f, 'paint_white', 2.4, 2.45, 0.6, 0.5, 0.5, 0.03, { collide: false });
    this.box(f, 'paint_yellow', 2.4, 2.45, 0.62, 0.4, 0.4, 0.02, { collide: false });
  }

  laundryLine(x, y, z, rot) {
    const f = new Frame(x, y, z, rot);
    for (const lx of [-2.5, 2.5]) {
      this.box(f, 'metal_dark', lx, 0.95, 0, 0.05, 1.9, 0.05);
      this.box(f, 'metal_dark', lx, 1.85, 0, 0.04, 0.04, 0.8, { collide: false });
    }
    for (const lz of [-0.35, 0, 0.35]) this.box(f, 'black', 0, 1.84, lz, 5, 0.008, 0.008, { collide: false, ao: false });
    const cloths = ['fabric_grey', 'fabric_blue', 'mattress', 'fabric_red'];
    for (let i = 0; i < 3; i++) {
      if (this.rng.chance(0.3)) continue;
      const lx = -1.6 + i * 1.4 + this.rng.next() * 0.4, lz = [-0.35, 0, 0.35][i % 3];
      this.box(f, this.rng.pick(cloths), lx, 1.55, lz, 0.6 + this.rng.next() * 0.3, 0.55, 0.01, { collide: false, ao: false });
    }
  }

  gardenBed(x, y, z, rot, w = 4, d = 5) {
    const f = new Frame(x, y, z, rot);
    const rows = Math.floor(w / 0.8);
    for (let i = 0; i < rows; i++) {
      const lx = -w / 2 + 0.4 + i * 0.8;
      this.box(f, 'dirt', lx, 0.05, 0, 0.5, 0.2, d, { collide: false, shade: 0.9 });
      for (let k = 0; k < Math.floor(d / 0.9); k++) {
        if (this.rng.chance(0.3)) continue;
        const lz = -d / 2 + 0.45 + k * 0.9;
        this.ctx.trees.push({ type: 'bush', x: f.wx(lx, lz), y: y + 0.12, z: f.wz(lx, lz), s: 0.22 + this.rng.next() * 0.12, rot: this.rng.next() * 6 });
      }
    }
  }

  // ---------------------------------------------------------------- military landmarks
  /** Thin paved slab following the ground (axis-aligned rectangle in world space). */
  /**
   * Paved area following the terrain: one continuous surface (no overlapping tiles), with a
   * short kerb skirt around the edge. Each further paved area in the same location sits 2 cm
   * higher, so overlapping areas (a road across a parade ground) never share a plane.
   */
  pavement(x0, z0, x1, z1, gy, mat = 'asphalt') {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    this._paveLayer = (this._paveLayer || 0) + 1;
    const lift = 0.05 + this._paveLayer * 0.02;
    const cell = 2;
    const nx = Math.max(1, Math.ceil((x1 - x0) / cell)), nz = Math.max(1, Math.ceil((z1 - z0) / cell));
    const tile = Materials.tile(mat);
    const H = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = x0 + (x1 - x0) * i / nx, z = z0 + (z1 - z0) * j / nz;
      H.push(gy(x, z) + lift);
    }
    const hAt = (i, j) => H[j * (nx + 1) + i];
    const pos = [], uv = [];
    const vert = (x, y, z, u, v) => { pos.push(x, y, z); uv.push(u, v); };
    const X = (i) => x0 + (x1 - x0) * i / nx, Z = (j) => z0 + (z1 - z0) * j / nz;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = [X(i), hAt(i, j), Z(j)], b = [X(i + 1), hAt(i + 1, j), Z(j)], c = [X(i), hAt(i, j + 1), Z(j + 1)], d = [X(i + 1), hAt(i + 1, j + 1), Z(j + 1)];
      for (const p of [a, c, b, b, c, d]) vert(p[0], p[1], p[2], p[0] / tile, p[2] / tile);
    }
    // kerb skirt down into the ground on all four sides
    const skirt = (pa, pb) => {
      const a0 = [pa[0], pa[1] - 0.14, pa[2]], b0 = [pb[0], pb[1] - 0.14, pb[2]];
      const len = Math.hypot(pb[0] - pa[0], pb[2] - pa[2]);
      const t0 = (pa[0] + pa[2]) / tile;
      const q = [[pa, t0, 0.14 / tile], [pb, t0 + len / tile, 0.14 / tile], [a0, t0, 0], [b0, t0 + len / tile, 0]];
      for (const k of [0, 2, 1, 1, 2, 3]) vert(q[k][0][0], q[k][0][1], q[k][0][2], q[k][1], q[k][2]);
    };
    for (let i = 0; i < nx; i++) {
      skirt([X(i + 1), hAt(i + 1, 0), Z(0)], [X(i), hAt(i, 0), Z(0)]);
      skirt([X(i), hAt(i, nz), Z(nz)], [X(i + 1), hAt(i + 1, nz), Z(nz)]);
    }
    for (let j = 0; j < nz; j++) {
      skirt([X(0), hAt(0, j), Z(j)], [X(0), hAt(0, j + 1), Z(j + 1)]);
      skirt([X(nx), hAt(nx, j + 1), Z(j + 1)], [X(nx), hAt(nx, j), Z(j)]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const n = pos.length / 3;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    g.setAttribute('indoor', new THREE.BufferAttribute(new Float32Array(n), 1));
    this.B.raw(mat, g);
  }

  hangar(x, y, z, rot, w = 22, d = 30, h = 11) {
    const f = new Frame(x, y, z, rot);
    // arched corrugated roof built from segments around the long axis (local z)
    const segs = 14, R = w / 2;
    const k = h / R; // elliptical arch
    for (let i = 0; i < segs; i++) {
      const a0 = Math.PI * i / segs, a1 = Math.PI * (i + 1) / segs, am = (a0 + a1) / 2;
      const x0 = Math.cos(a0) * R, y0 = Math.sin(a0) * R * k, x1 = Math.cos(a1) * R, y1 = Math.sin(a1) * R * k;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const ang = Math.atan2(y1 - y0, x1 - x0);
      this.box(f, 'corrugated', (x0 + x1) / 2, (y0 + y1) / 2 + 0.3, 0, len + 0.05, 0.08, d, { collide: false, rotZ: ang, faceShade: [1, 1, 1, 0.6, 1, 1] });
      void am;
    }
    // ribs
    for (let zz = -d / 2; zz <= d / 2 + 0.01; zz += d / 5) {
      for (let i = 0; i < segs; i++) {
        const a0 = Math.PI * i / segs, a1 = Math.PI * (i + 1) / segs;
        const x0 = Math.cos(a0) * (R + 0.08), y0 = Math.sin(a0) * (R + 0.08) * k, x1 = Math.cos(a1) * (R + 0.08), y1 = Math.sin(a1) * (R + 0.08) * k;
        this.box(f, 'metal_dark', (x0 + x1) / 2, (y0 + y1) / 2 + 0.3, zz, Math.hypot(x1 - x0, y1 - y0) + 0.04, 0.14, 0.2, { collide: false, rotZ: Math.atan2(y1 - y0, x1 - x0) });
      }
    }
    // back wall (N) with a personnel door; front left open with a huge doorway frame
    this.box(f, 'corrugated_blue', 0, h / 2 + 0.3, -d / 2 + 0.1, w * 0.98, h, 0.2, { faceShade: [1, 1, 1, 1, 1, 0.62] });
    for (const sx of [-1, 1]) this.box(f, 'concrete', sx * (w / 2 - 1.2), h * 0.35, d / 2, 2.4, h * 0.7, 0.4);
    this.box(f, 'concrete', 0, h * 0.82, d / 2, w * 0.7, h * 0.3, 0.4, { collide: false });
    // side wall colliders approximating the arch footprint
    for (const sx of [-1, 1]) this.ctx.colliders.push(this._colliderLocal(f, sx * (R - 0.6), 3, 0, 1.2, 6, d, 'sheet'));
    this.box(f, 'concrete', 0, 0.05, 0, w - 0.2, 0.12, d, { collide: false, faceShade: [1, 1, 0.75, 1, 1, 1] });
    // contents: workbench, crates, a parked truck
    this.ctx.containers.push({ x: f.wx(-R + 2, -d / 2 + 2), y: y + 1, z: f.wz(-R + 2, -d / 2 + 2), name: 'Parts Crate', profile: 'military', capacity: 10, kind: 'crate' });
    this.box(f, 'olive', -R + 2, 0.45, -d / 2 + 2, 1.2, 0.8, 0.9, { shade: 0.8, indoor: true });
    this.militaryTruck(f.wx(2, -2), y, f.wz(2, -2), rot);
    this.ctx.spots.push({ type: 'inside', x: f.x, z: f.z, y });
  }

  waterTower(x, y, z, h = 18) {
    const f = new Frame(x, y, z, 0);
    const legR = 3;
    for (const [lx, lz] of [[-legR, -legR], [legR, -legR], [-legR, legR], [legR, legR]]) {
      this.box(f, 'metal_dark', lx * 0.8, h / 2, lz * 0.8, 0.3, h, 0.3, { rotX: lz * 0.012, rotZ: -lx * 0.012 });
    }
    for (let yy = 4; yy < h; yy += 5) {
      for (const [lx, lz, w, dd] of [[0, -legR * 0.8, legR * 1.6, 0.1], [0, legR * 0.8, legR * 1.6, 0.1], [-legR * 0.8, 0, 0.1, legR * 1.6], [legR * 0.8, 0, 0.1, legR * 1.6]]) {
        this.box(f, 'metal_dark', lx, yy, lz, w, 0.12, dd, { collide: false });
      }
      this.box(f, 'metal_dark', 0, yy - 2.5, -legR * 0.8, legR * 2.2, 0.08, 0.08, { collide: false, rotZ: 0.9 });
      this.box(f, 'metal_dark', -legR * 0.8, yy - 2.5, 0, 0.08, 0.08, legR * 2.2, { collide: false, rotX: 0.9 });
    }
    this.cyl(f, 'paint_white', 0, h + 2.4, 0, 4.2, 4.6, 20, { collide: false });
    this.cyl(f, 'paint_white', 0, h + 5.2, 0, 0.6, 1.0, 20, { rBot: 4.3, collide: false });
    this.cyl(f, 'metal_dark', 0, h + 0.2, 0, 4.6, 0.25, 20, { collide: false });
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      this.box(f, 'metal_dark', Math.cos(a) * 4.55, h + 0.9, Math.sin(a) * 4.55, 0.04, 1.1, 0.04, { collide: false });
    }
    this.cyl(f, 'metal', 0, h / 2, 0, 0.25, h, 10, { collide: false });
    for (let r = 0.4; r < h; r += 0.35) this.box(f, 'metal_dark', legR * 0.8 + 0.3, r, 0, 0.05, 0.05, 0.45, { collide: false });
    this.ctx.ladders.push(this.ctx.physics.addLadder(f.x + legR * 0.8 + 0.6, f.z, y, y + h + 0.3, 1, 0, this.ctx.owner));
    this.ctx.colliders.push(this._colliderLocal(f, 0, h + 0.15, 0, 9, 0.3, 9, 'metal'));
    this.ctx.spots.push({ type: 'tower', x: f.x, z: f.z, y: y + h + 0.3 });
  }

  floodlight(x, y, z, rot = 0, h = 10) {
    const f = new Frame(x, y, z, rot);
    this.cyl(f, 'metal_dark', 0, h / 2, 0, 0.12, h, 8, { rBot: 0.18 });
    this.box(f, 'metal_dark', 0, h + 0.1, 0, 1.6, 0.12, 0.12, { collide: false });
    for (const lx of [-0.6, 0, 0.6]) {
      this.box(f, 'metal_dark', lx, h + 0.35, 0.12, 0.4, 0.32, 0.25, { collide: false, rotX: 0.5 });
      this.box(f, 'emissive_lamp', lx, h + 0.3, 0.26, 0.34, 0.24, 0.02, { collide: false, rotX: 0.5 });
    }
    this.ctx.lights.push({ x: f.wx(0, 1.5), y: y + h, z: f.wz(0, 1.5), street: true });
  }

  militaryTruck(x, y, z, rot) {
    const f = new Frame(x, y, z, rot);
    const tilt = (this.rng.next() - 0.5) * 0.04;
    const o = { collide: false, rotZ: tilt };
    this.box(f, 'metal_dark', 0, 0.85, 0, 1.4, 0.3, 7.2, o);
    this.box(f, 'olive', 0, 1.65, 2.6, 2.4, 1.4, 1.9, o);
    this.box(f, 'olive', 0, 1.25, 3.65, 2.3, 0.75, 0.6, o);
    this.box(f, 'glass_dirty', 0, 2.0, 3.56, 2.0, 0.6, 0.04, { ...o, rotX: -0.12 });
    this.box(f, 'olive', 0, 1.35, -1.2, 2.5, 0.5, 4.8, o);
    for (const sx of [-1, 1]) this.box(f, 'olive', sx * 1.22, 1.85, -1.2, 0.06, 0.5, 4.8, o);
    if (this.rng.chance(0.7)) {
      this.box(f, 'canvas', 0, 2.75, -1.2, 2.5, 0.08, 4.7, o);
      for (const sx of [-1, 1]) this.box(f, 'canvas', sx * 1.22, 2.3, -1.2, 0.05, 0.95, 4.7, o);
      this.box(f, 'canvas', 0, 2.3, -3.55, 2.45, 0.95, 0.05, o);
    }
    for (const lz of [2.6, -0.5, -2.1]) {
      for (const sx of [-1, 1]) {
        this.cyl(f, 'black', sx * 1.05, 0.55, lz, 0.55, 0.38, 14, { collide: false, rotZ: Math.PI / 2 });
        this.cyl(f, 'olive', sx * 1.25, 0.55, lz, 0.28, 0.04, 10, { collide: false, rotZ: Math.PI / 2 });
      }
    }
    this.box(f, 'black', 0, 0.75, 3.95, 2.4, 0.25, 0.15, o);
    this.ctx.colliders.push(this._colliderLocal(f, 0, 1.4, 0, 2.5, 2.8, 7.6, 'metal'));
    this.ctx.containers.push({ x: f.wx(0, -3.9), y: y + 1.3, z: f.wz(0, -3.9), name: 'Truck Bed', profile: 'military', capacity: 12, kind: 'crate' });
  }

  tractor(x, y, z, rot) {
    const f = new Frame(x, y, z, rot);
    const paint = this.rng.pick(['paint_red', 'wood_green', 'corrugated_blue']);
    const o = { collide: false };
    this.box(f, paint, 0, 1.2, 0.9, 0.9, 0.8, 2.2, o); // bonnet
    this.box(f, 'metal_dark', 0, 0.85, 0.6, 0.6, 0.5, 2.8, o); // chassis
    this.box(f, 'black', 0, 1.25, 2.05, 0.8, 0.7, 0.08, o); // grille
    this.cyl(f, 'metal_dark', 0.25, 2.0, 1.6, 0.06, 1.1, 8, o); // exhaust
    this.box(f, paint, 0, 1.1, -0.7, 1.4, 0.3, 1.2, o); // rear body
    this.box(f, 'black', 0, 1.6, -0.6, 0.5, 0.12, 0.5, o); // seat
    this.cyl(f, 'black', 0, 2.0, 0.0, 0.2, 0.04, 12, { ...o, rotX: -0.9 }); // steering wheel
    for (const sx of [-1, 1]) {
      this.cyl(f, 'black', sx * 0.95, 0.85, -0.8, 0.85, 0.42, 18, { ...o, rotZ: Math.PI / 2 });
      this.cyl(f, paint, sx * 1.17, 0.85, -0.8, 0.45, 0.02, 14, { ...o, rotZ: Math.PI / 2 });
      this.cyl(f, 'black', sx * 0.72, 0.48, 1.6, 0.48, 0.28, 14, { ...o, rotZ: Math.PI / 2 });
      this.box(f, paint, sx * 0.95, 1.75, -0.8, 0.45, 0.06, 1.1, o); // mudguards
      this.box(f, 'metal_dark', sx * 0.6, 2.3, -0.25, 0.06, 1.4, 0.06, o); // cab frame
      this.box(f, 'metal_dark', sx * 0.6, 2.3, -1.15, 0.06, 1.4, 0.06, o);
    }
    this.box(f, paint, 0, 3.0, -0.7, 1.4, 0.06, 1.1, o); // roof
    this.ctx.colliders.push(this._colliderLocal(f, 0, 1.2, 0.3, 2.3, 2.4, 4.0, 'metal'));
  }

  trough(x, y, z, rot) {
    const f = new Frame(x, y, z, rot);
    this.box(f, 'metal_dark', 0, 0.35, 0, 2.4, 0.7, 0.8);
    this.box(f, 'black', 0, 0.68, 0, 2.2, 0.02, 0.6, { collide: false, shade: 0.4 });
  }

  hayStack(x, y, z, rot) {
    const f = new Frame(x, y, z, rot);
    for (let i = 0; i < 3; i++) for (let k = 0; k < 3 - i; k++) this.box(f, 'hay', (k - (2 - i) / 2) * 1.25, 0.45 + i * 0.85, 0, 1.2, 0.85, 2.4, { collide: false, rotY: (this.rng.next() - 0.5) * 0.1 });
    this.ctx.colliders.push(this._colliderLocal(f, 0, 1.3, 0, 3.8, 2.6, 2.4, 'fabric'));
  }

  gateHouse(x, y, z, rot, width = 12) {
    const f = new Frame(x, y, z, rot);
    for (const sx of [-1, 1]) {
      this.box(f, 'concrete', sx * (width / 2 + 0.6), 1.6, 0, 1.2, 3.2, 1.2);
      // T-wall blast barriers: separate precast panels with a footing, slight height/tilt variety
      this.ctx.colliders.push(this._colliderLocal(f, sx * (width / 2 + 7), 1.5, 0, 11.5, 3.0, 0.5, 'concrete'));
      for (let i = 0; i < 5; i++) {
        const px = sx * (width / 2 + 1.35 + i * 2.3 + 1.1);
        const h = 3.0 + (this.rng.next() - 0.5) * 0.12;
        this.box(f, 'concrete', px, h / 2 + 0.1, 0, 2.22, h, 0.3, { collide: false, rotZ: (this.rng.next() - 0.5) * 0.012 });
        this.box(f, 'concrete', px, 0.25, 0, 2.22, 0.5, 1.2, { collide: false });
        this.box(f, 'concrete_dark', px, 0.03, 0, 2.3, 0.06, 1.3, { collide: false });
      }
      this.box(f, 'hazard', sx * (width / 2 + 0.6), 3.3, 0, 1.25, 0.2, 1.25, { collide: false });
    }
    this.box(f, 'metal_dark', 0, 5.2, 0, width + 2.4, 0.5, 0.5, { collide: false });
    for (const sx of [-1, 1]) this.box(f, 'metal_dark', sx * (width / 2 + 0.6), 4.3, 0, 0.3, 1.8, 0.3, { collide: false });
    this.box(f, 'paint_white', 0, 5.2, 0.27, 5.5, 0.4, 0.02, { collide: false });
    this.box(f, 'black', 0, 5.2, 0.28, 4.8, 0.08, 0.02, { collide: false });
  }

  helipad(x, y, z) {
    const f = new Frame(x, y, z, 0);
    this.cyl(f, 'concrete', 0, 0.05, 0, 9, 0.2, 32, { collide: false });
    this.box(f, 'paint_white', -1.4, 0.16, 0, 0.5, 0.02, 4, { collide: false });
    this.box(f, 'paint_white', 1.4, 0.16, 0, 0.5, 0.02, 4, { collide: false });
    this.box(f, 'paint_white', 0, 0.16, 0, 2.8, 0.02, 0.5, { collide: false });
  }

  flagpole(x, y, z) {
    const f = new Frame(x, y, z, 0);
    this.cyl(f, 'metal', 0, 5, 0, 0.06, 10, 8);
    this.box(f, 'fabric_grey', 0.8, 9.2, 0, 1.6, 1.0, 0.02, { collide: false });
  }

  streetLight(x, y, z, rot) {
    const f = new Frame(x, y, z, rot);
    this.cyl(f, 'metal_dark', 0, 3.5, 0, 0.08, 7, 8);
    this.box(f, 'metal_dark', 0, 7, 0.8, 0.1, 0.1, 1.6, { collide: false });
    this.box(f, 'metal_dark', 0, 6.95, 1.5, 0.35, 0.15, 0.6, { collide: false });
    this.ctx.lights.push({ x: f.wx(0, 1.5), y: y + 6.8, z: f.wz(0, 1.5), street: true });
  }

  dumpster(x, y, z, rot, profile = 'residential') {
    const f = new Frame(x, y, z, rot);
    this.box(f, 'olive', 0, 0.7, 0, 2.0, 1.4, 1.2);
    this.box(f, 'black', 0, 1.42, 0, 2.05, 0.05, 1.25, { collide: false, rotX: -0.15 });
    this.ctx.containers.push({ x, y: y + 1.0, z, name: 'Dumpster', profile, capacity: 8, kind: 'dumpster' });
  }

  campfire(x, y, z) {
    const f = new Frame(x, y, z, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.box(f, 'rock', Math.cos(a) * 0.6, 0.12, Math.sin(a) * 0.6, 0.3, 0.24, 0.25, { collide: false, rotY: a });
    }
    for (let i = 0; i < 4; i++) this.box(f, 'logs', 0, 0.15, 0, 0.9, 0.12, 0.12, { collide: false, rotY: i * 0.8, rotZ: 0.25 });
    this.ctx.fires.push({ x, y: y + 0.3, z });
  }

  woodPile(x, y, z, rot) {
    const f = new Frame(x, y, z, rot);
    for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) this.cyl(f, 'logs', (i - 2.5) * 0.3, 0.15 + r * 0.27, 0, 0.14, 1.1, 6, { rotX: Math.PI / 2, collide: false });
    this.ctx.colliders.push(this._colliderLocal(f, 0, 0.55, 0, 1.9, 1.1, 1.1, 'wood'));
  }

  marketStall(x, y, z, rot) {
    const f = new Frame(x, y, z, rot);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(f, 'wood_dark', sx * 1.4, 1.2, sz * 0.9, 0.1, 2.4, 0.1, { collide: false });
    this.box(f, 'canvas_tan', 0, 2.45, 0, 3.2, 0.05, 2.2, { collide: false, rotX: 0.12 });
    this.box(f, 'wood', 0, 0.85, 0.6, 2.8, 0.08, 0.8);
    this.box(f, 'canvas', -0.6, 1.05, 0.6, 0.5, 0.3, 0.4, { collide: false });
    this.ctx.containers.push({ x: f.wx(0, 0.6), y: y + 1.0, z: f.wz(0, 0.6), name: 'Market Stall', profile: 'camp', capacity: 8, kind: 'crate' });
  }

  conveyor(x, y, z, rot, len = 20, h = 6) {
    const f = new Frame(x, y, z, rot);
    const ang = Math.atan2(h, len);
    this.box(f, 'metal_dark', 0, h / 2 + 0.5, 0, 1.2, 0.3, Math.hypot(len, h), { rotX: -ang, collide: false });
    for (let d = -len / 2 + 2; d < len / 2; d += 5) {
      const hh = (d + len / 2) / len * h;
      this.box(f, 'hazard', 0, hh / 2 + 0.3, d, 0.2, hh + 0.6, 0.2, { collide: false });
    }
  }

  mineEntrance(x, y, z, rot) {
    const f = new Frame(x, y, z, rot);
    this.box(f, 'rock', 0, 4, -3, 16, 9, 6);
    this.box(f, 'logs', -1.6, 1.4, 0.1, 0.35, 2.8, 0.35);
    this.box(f, 'logs', 1.6, 1.4, 0.1, 0.35, 2.8, 0.35);
    this.box(f, 'logs', 0, 2.9, 0.1, 3.8, 0.35, 0.35, { collide: false });
    this.box(f, 'black', 0, 1.4, -0.05, 2.9, 2.8, 0.1, { collide: false });
  }

  sign(x, y, z, rot, text) {
    const f = new Frame(x, y, z, rot);
    this.box(f, 'wood_dark', -1.3, 1.1, 0, 0.12, 2.2, 0.12);
    this.box(f, 'wood_dark', 1.3, 1.1, 0, 0.12, 2.2, 0.12);
    this.ctx.signs.push({ x: f.wx(0, 0.05), y: y + 1.75, z: f.wz(0, 0.05), yaw: f.theta, text });
  }

  bunkerMound(x, y, z, rot, w = 16, d = 20) {
    const f = new Frame(x, y, z, rot);
    // sloped earth berms on three sides
    for (const [lx, lz, ww, dd, rx, rz] of [[-w / 2 - 2, 0, 5, d + 4, 0, 0.6], [w / 2 + 2, 0, 5, d + 4, 0, -0.6], [0, -d / 2 - 2, w + 8, 5, -0.6, 0]]) {
      this.B.box('dirt', f.wx(lx, lz), y + 1.4, f.wz(lx, lz), ww, 3, dd, { rotY: f.theta, rotX: rx ? rx : 0, rotZ: rz ? rz : 0 });
    }
    this.B.box('dirt', f.x, y + 4.6, f.z, w + 2, 0.8, d + 2, { rotY: f.theta });
  }
}

void THREE;
