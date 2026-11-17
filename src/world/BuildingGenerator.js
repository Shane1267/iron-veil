import * as THREE from 'three';
import { RNG } from '../core/MathUtil.js';
import { Materials } from '../engine/Materials.js';

// Procedural modular buildings. Everything is authored in building-local metres
// (x across width, z across depth, S = +z front) and rotated in 90° steps, which keeps
// every collider axis-aligned. Walls are split around real door and window openings,
// floors have stair holes, and interiors receive furniture, clutter and loot containers.

const WALL_T = 0.24;
const DOOR_W = 1.0, DOOR_H = 2.15;
const WIN_W = 1.15, WIN_SILL = 0.9, WIN_TOP = 2.2;
const WIN_SILL_D = WIN_SILL, WIN_TOP_D = WIN_TOP;
const INTERIOR = 0.74, EXTERIOR = 1.0, FLOOR_SHADE = 0.78, CEIL_SHADE = 0.64;

export class BuildingContext {
  /**
   * B: BoxBuilder, ctx: {physics, owner, interactables, doors[], glass[], containers[], spots[], ladders}
   */
  constructor(B, ctx) {
    this.B = B;
    this.ctx = ctx;
  }
}

/** Transform helper for one building. */
class Frame {
  constructor(x, y, z, rot) {
    this.x = x; this.y = y; this.z = z; this.rot = ((rot % 4) + 4) % 4;
    this.theta = (this.rot * Math.PI) / 2;
    this.c = Math.round(Math.cos(this.theta));
    this.s = Math.round(Math.sin(this.theta));
  }
  wx(lx, lz) { return this.x + lx * this.c + lz * this.s; }
  wz(lx, lz) { return this.z - lx * this.s + lz * this.c; }
  dims(w, d) { return this.rot % 2 ? [d, w] : [w, d]; }
}

export class BuildingGenerator {
  constructor(B, ctx, rng) {
    this.B = B;
    this.ctx = ctx;
    this.rng = rng || new RNG(1);
  }

  // ------------------------------------------------------------ primitives
  /** Box in local frame with collider. phys: false to skip collider. */
  box(f, mat, lx, ly, lz, w, h, d, opts = {}) {
    if (opts.visible !== false) this.B.box(mat, f.wx(lx, lz), f.y + ly, f.wz(lx, lz), w, h, d, { ...opts, rotY: f.theta + (opts.rotY || 0) });
    if (opts.collide !== false) {
      const [W, D] = opts.rotY ? (Math.round(opts.rotY / (Math.PI / 2)) % 2 ? f.dims(d, w) : f.dims(w, d)) : f.dims(w, d);
      const cx = f.wx(lx, lz), cz = f.wz(lx, lz), cy = f.y + ly;
      this.ctx.colliders.push(this.ctx.physics.addBox(cx - W / 2, cy - h / 2, cz - D / 2, cx + W / 2, cy + h / 2, cz + D / 2, {
        material: opts.phys || Materials.phys(mat), owner: this.ctx.owner, blocksSight: opts.blocksSight !== false,
        blocksShots: opts.blocksShots !== false, blocksMove: opts.blocksMove !== false, tag: opts.tag || null,
      }));
    }
  }

  cyl(f, mat, lx, ly, lz, r, h, segs = 12, opts = {}) {
    // tilted cylinders (pipes, gutters, logs) turn with the building/frame
    this.B.cylinder(mat, f.wx(lx, lz), f.y + ly, f.wz(lx, lz), r, opts.rBot ?? r, h, segs, { ...opts, rotY: f.theta + (opts.rotY || 0) });
    if (opts.collide !== false) {
      this.ctx.colliders.push(this.ctx.physics.addCylinder(f.wx(lx, lz), f.wz(lx, lz), Math.max(r, opts.rBot ?? r), f.y + ly - h / 2, f.y + ly + h / 2, {
        material: Materials.phys(mat), owner: this.ctx.owner,
      }));
    }
  }

  // ------------------------------------------------------------ walls
  /**
   * Wall along a side. side in 'S','N','E','W'. openings: [{at (m from centre), w, type:'door'|'window'|'gap', h}]
   */
  wall(f, spec, side, y0, height, openings, opts = {}) {
    const { w, d } = spec;
    const t = opts.thick || spec.thick || WALL_T;
    const mat = opts.mat || spec.wallMat;
    const horizontal = side === 'S' || side === 'N';
    const len = horizontal ? w : d - 2 * t;
    const half = len / 2;
    // inside face index in BoxGeometry order +x,-x,+y,-y,+z,-z
    const ext = opts.interiorBoth ? INTERIOR : EXTERIOR;
    const faceShade = horizontal
      ? (side === 'S' ? [ext, ext, ext, INTERIOR, ext, INTERIOR] : [ext, ext, ext, INTERIOR, INTERIOR, ext])
      : (side === 'E' ? [ext, INTERIOR, ext, INTERIOR, ext, ext] : [INTERIOR, ext, ext, INTERIOR, ext, ext]);
    const place = (a, b, yA, yB) => {
      if (b - a < 0.02 || yB - yA < 0.02) return;
      const c = (a + b) / 2, L = b - a, H = yB - yA, yc = y0 + (yA + yB) / 2;
      let lx, lz, W, D;
      if (side === 'S') { lx = c; lz = d / 2 - t / 2; W = L; D = t; }
      else if (side === 'N') { lx = c; lz = -d / 2 + t / 2; W = L; D = t; }
      else if (side === 'E') { lx = w / 2 - t / 2; lz = c; W = t; D = L; }
      else { lx = -w / 2 + t / 2; lz = c; W = t; D = L; }
      this.box(f, mat, lx, yc, lz, W, H, D, { faceShade, phys: opts.phys, tint: opts.interiorBoth ? null : spec.wallTint });
    };
    const ops = [...openings].sort((a, b) => a.at - b.at);
    let cursor = -half;
    for (const o of ops) {
      const a = Math.max(-half, o.at - o.w / 2), b = Math.min(half, o.at + o.w / 2);
      place(cursor, a, 0, height);
      const top = o.type === 'window' ? (spec.winTop ?? WIN_TOP) : (o.h || DOOR_H);
      if (o.type === 'window') {
        place(a, b, 0, spec.winSill ?? WIN_SILL);
        this._window(f, spec, side, y0, o.at, o.w, t, opts.glassChance ?? spec.glassChance ?? 0.6);
      }
      place(a, b, Math.min(top, height), height);
      if (o.type === 'door' && o.leaf !== false) this._door(f, spec, side, y0, o.at, o.w, t, o);
      cursor = b;
    }
    place(cursor, half, 0, height);
  }

  _sidePoint(spec, side, at, t) {
    const { w, d } = spec;
    if (side === 'S') return [at, d / 2 - t / 2];
    if (side === 'N') return [at, -d / 2 + t / 2];
    if (side === 'E') return [w / 2 - t / 2, at];
    return [-w / 2 + t / 2, at];
  }

  _window(f, spec, side, y0, at, w, t, glassChance) {
    const WIN_SILL = spec.winSill ?? WIN_SILL_D, WIN_TOP = spec.winTop ?? WIN_TOP_D;
    const [lx, lz] = this._sidePoint(spec, side, at, t);
    const horizontal = side === 'S' || side === 'N';
    // frame, glazing bars, sill and surround (see _windowDressing)
    const fm = spec.trimMat || 'wood_dark';
    const W = horizontal ? w : 0.06, D = horizontal ? 0.06 : w;
    this.box(f, fm, lx, y0 + (WIN_SILL + WIN_TOP) / 2, lz, horizontal ? 0.05 : t * 0.5, WIN_TOP - WIN_SILL, horizontal ? t * 0.5 : 0.05, { collide: false });
    this.box(f, fm, lx, y0 + WIN_SILL + (WIN_TOP - WIN_SILL) * 0.66, lz, horizontal ? w : t * 0.5, 0.05, horizontal ? t * 0.5 : w, { collide: false });
    this._windowDressing(f, spec, side, y0, at, w);
    const intact = this.rng.chance(glassChance);
    const h = WIN_TOP - WIN_SILL;
    const cx = f.wx(lx, lz), cz = f.wz(lx, lz), cy = f.y + y0 + WIN_SILL + h / 2;
    const [AW, AD] = f.dims(W, D);
    // window opening collider: glass blocks movement when intact; broken windows block
    // movement (frame/shards) but not bullets or sight.
    const col = this.ctx.physics.addBox(cx - AW / 2, cy - h / 2, cz - AD / 2, cx + AW / 2, cy + h / 2, cz + AD / 2, {
      material: 'glass', owner: this.ctx.owner, tag: 'window', blocksShots: intact, blocksSight: false, blocksMove: true,
    });
    this.ctx.colliders.push(col);
    if (intact) {
      const pane = { x: cx, y: cy, z: cz, w: Math.max(AW, 0.02), h, d: Math.max(AD, 0.02), collider: col, broken: false };
      col.glass = pane;
      this.ctx.glass.push(pane);
    } else if (this.rng.chance(0.4)) {
      // boarded-up window
      for (let k = 0; k < 3; k++) {
        const yy = y0 + WIN_SILL + 0.25 + k * 0.4;
        this.box(f, 'wood_dark', lx + (horizontal ? 0 : (side === 'E' ? 0.08 : -0.08)), yy, lz + (horizontal ? (side === 'S' ? 0.08 : -0.08) : 0),
          horizontal ? w + 0.2 : 0.03, 0.18, horizontal ? 0.03 : w + 0.2, { collide: false, rotY: 0 });
      }
      col.blocksSight = true;
    }
  }

  _door(f, spec, side, y0, at, w, t, o) {
    const [lx, lz] = this._sidePoint(spec, side, at, t);
    const hingeOffset = -w / 2;
    // hinge on one side of the opening, leaf swings inward
    let hx, hz, leafDir, inward;
    if (side === 'S') { hx = lx + hingeOffset; hz = lz; leafDir = 0; inward = -1; }
    else if (side === 'N') { hx = lx - hingeOffset; hz = lz; leafDir = Math.PI; inward = -1; }
    else if (side === 'E') { hx = lx; hz = lz - hingeOffset; leafDir = Math.PI / 2; inward = -1; }
    else { hx = lx; hz = lz + hingeOffset; leafDir = -Math.PI / 2; inward = -1; }
    const doorH = o.h || DOOR_H;
    this.ctx.doors.push({
      x: f.wx(hx, hz), y: f.y + y0, z: f.wz(hx, hz), yaw: leafDir + f.theta, width: w - 0.04, height: doorH - 0.02,
      thick: 0.06, mat: o.mat || spec.doorMat || 'wood_dark', open: o.open ?? this.rng.chance(spec.doorOpenChance ?? 0.35),
      swing: inward * (Math.PI / 2) * 0.95, metal: !!o.metal,
    });
  }

  // ------------------------------------------------------------ building
  /**
   * spec: {x, z, rot, w, d, floors, floorH, wallMat, roof, roofMat, doors:[{side, at, w}], windows:{S,N,E,W} counts,
   *        partitions, furniture, profile, stairs, plinth}
   * y = ground height.
   */
  building(spec, y) {
    const f = new Frame(spec.x, y, spec.z, spec.rot || 0);
    const floors = spec.floors || 1;
    const fh = spec.floorH || 3.0;
    const slab = 0.18;
    const base = spec.plinth ?? 0.15;
    const { w, d } = spec;
    spec.thick = spec.thick || WALL_T;

    // foundation plinth reaching below ground
    this.box(f, spec.plinthMat || 'concrete_dark', 0, base / 2 - 0.6, 0, w + 0.1, base + 1.2, d + 0.1, { faceShade: [0.85, 0.85, FLOOR_SHADE, 0.6, 0.85, 0.85], collide: false });
    this.ctx.colliders.push(this.ctx.physics.addBox(f.x - f.dims(w, d)[0] / 2, y - 1.2, f.z - f.dims(w, d)[1] / 2, f.x + f.dims(w, d)[0] / 2, y + base, f.z + f.dims(w, d)[1] / 2, { material: 'concrete', owner: this.ctx.owner }));

    const stairs = floors > 1 ? this._stairPlan(spec, fh) : null;
    // slight per-building tone variation of the facade (fading, different paint batches)
    if (!spec.wallTint && (spec.thick || WALL_T) >= 0.2) {
      const k = 0.9 + this.rng.next() * 0.14, warm = (this.rng.next() - 0.5) * 0.06;
      spec.wallTint = [k * (1 + warm), k, k * (1 - warm)];
    }

    for (let fl = 0; fl < floors; fl++) {
      const y0 = base + fl * fh;
      const wallH = fh - (fl === 0 ? 0 : 0) - slab;
      for (const side of ['S', 'N', 'E', 'W']) {
        const ops = this._openings(spec, side, fl);
        this.wall(f, spec, side, y0, wallH, ops);
      }
      // floor slab for upper floors (with stair hole)
      if (fl > 0) this._slab(f, spec, y0 - slab / 2, slab, stairs, spec.floorMat || 'wood');
      else {
        // ground floor surface (visual only, plinth collides)
        // sits 1.5 cm above the plinth top: coplanar faces flicker against each other (z-fighting)
        this.box(f, spec.floorMat || 'wood', 0, base + 0.005, 0, w - 0.1, 0.02, d - 0.1, { faceShade: [1, 1, FLOOR_SHADE, 1, 1, 1], collide: false });
      }
      // interior partitions
      for (const p of spec.partitions || []) this._partition(f, spec, p, y0, wallH, fl);
      // furniture
      this._furnish(f, spec, fl, y0, stairs);
    }
    if (stairs) for (let fl = 0; fl < floors - 1; fl++) this._stairs(f, spec, stairs, base + fl * fh, fh);

    // roof
    const topY = base + floors * fh - slab;
    this._roof(f, spec, topY, slab);
    this._facadeDressing(f, spec, floors, fh, base);

    // AI hints: door positions (outside) and interior spots
    for (const dd of spec.doors || []) {
      const [lx, lz] = this._sidePoint(spec, dd.side, dd.at, 0);
      const out = 1.6;
      const ox = dd.side === 'E' ? out : dd.side === 'W' ? -out : 0;
      const oz = dd.side === 'S' ? out : dd.side === 'N' ? -out : 0;
      this.ctx.spots.push({ type: 'door', x: f.wx(lx + ox, lz + oz), z: f.wz(lx + ox, lz + oz), y: f.y });
    }
    this.ctx.spots.push({ type: 'inside', x: f.x, z: f.z, y: f.y + base, building: spec });
    if (spec.church) this._churchFittings(f, spec, base, fh);
    return f;
  }

  /** Bell tower with belfry and spire in front of the S facade, pews and altar inside. */
  _churchFittings(f, spec, base, fh) {
    const { w, d } = spec;
    const T = 4.8, H = 15;
    const tz = d / 2 + T / 2 - 0.05;
    const tw = { x: f.wx(0, tz), z: f.wz(0, tz), rot: f.rot, w: T, d: T, floors: 1, floorH: H, wallMat: spec.wallMat, roof: 'none', plinth: base,
      doors: [{ side: 'S', at: 0, w: 1.6, h: 2.6, open: true }, { side: 'N', at: 0, w: 1.6, h: 2.6, gap: true }], windows: { S: 0, N: 0, E: 0, W: 0 },
      floorMat: 'tiles', ceilMat: 'wood_dark', innerMat: spec.wallMat, trimMat: spec.trimMat, facade: true, wallTint: spec.wallTint, profile: spec.profile };
    const tf = this.building(tw, f.y);
    // belfry openings with louvres on all four sides, clock on the front
    const top = base + H - 0.18;
    for (const side of ['S', 'N', 'E', 'W']) {
      this._facadeBox(tf, tw, side, 0, top - 2.2, 1.3, 2.4, 0.0, 0.26, 'black', { shade: 0.3 });
      for (let k = 0; k < 6; k++) this._facadeBox(tf, tw, side, 0, top - 3.2 + k * 0.38, 1.3, 0.06, 0.08, 0.1, 'wood_dark', { rotX: 0.5 });
      this._facadeBox(tf, tw, side, 0, top - 0.6, T + 0.2, 0.25, 0.04, 0.1, spec.wallMat, { tint: [0.92, 0.91, 0.9] });
    }
    this._facadeBox(tf, tw, 'S', 0, top - 5.2, 1.3, 1.3, 0.02, 0.06, 'paint_white');
    this._facadeBox(tf, tw, 'S', 0.12, top - 5.05, 0.05, 0.5, 0.06, 0.02, 'black', { rotZ: -0.6 });
    this._facadeBox(tf, tw, 'S', -0.05, top - 5.3, 0.05, 0.35, 0.06, 0.02, 'black', { rotZ: 0.3 });
    // spire: square pyramid, finial
    this.cyl(tf, 'roof_sheet', 0, top + 4.3, 0, 0.05, 8.4, 4, { rBot: T * 0.74, rotY: Math.PI / 4, collide: false });
    this.cyl(tf, 'metal', 0, top + 8.9, 0, 0.18, 0.4, 10, { collide: false });
    this.box(tf, 'metal', 0, top + 9.8, 0, 0.06, 1.4, 0.06, { collide: false });
    this.box(tf, 'metal', 0, top + 10.0, 0, 0.6, 0.06, 0.06, { collide: false });
    // pews either side of a central aisle, altar platform at the north end
    const inner = { z0: -d / 2 + 0.5, z1: d / 2 - 0.4 };
    for (let z = inner.z0 + 4.2; z < inner.z1 - 1.6; z += 1.15) {
      for (const sx of [-1, 1]) {
        const cx = sx * (w / 4 + 0.35), len = w / 2 - 1.4;
        this.box(f, 'wood_dark', cx, base + 0.45, z, len, 0.06, 0.42, { collide: false, indoor: true });
        this.box(f, 'wood_dark', cx, base + 0.75, z + 0.22, len, 0.55, 0.05, { collide: false, indoor: true });
        for (const ex of [-1, 1]) this.box(f, 'wood_dark', cx + ex * len / 2, base + 0.45, z + 0.05, 0.06, 0.9, 0.55, { collide: false, indoor: true });
        const [W, D] = f.dims(len, 0.6);
        const wx = f.wx(cx, z + 0.05), wz = f.wz(cx, z + 0.05);
        this.ctx.colliders.push(this.ctx.physics.addBox(wx - W / 2, f.y + base, wz - D / 2, wx + W / 2, f.y + base + 0.95, wz + D / 2, { material: 'wood', owner: this.ctx.owner, blocksSight: false }));
      }
    }
    this.box(f, 'wood', 0, base + 0.15, inner.z0 + 1.6, w - 1.0, 0.3, 3.0, { indoor: true });
    this.box(f, 'paint_trim', 0, base + 0.75, inner.z0 + 1.1, 2.2, 0.9, 0.9, { indoor: true });
    this.box(f, 'fabric_red', 0, base + 1.21, inner.z0 + 1.1, 2.3, 0.02, 1.0, { collide: false, indoor: true });
    for (const sx of [-1, 1]) this.cyl(f, 'brass', sx * 0.8, base + 1.35, inner.z0 + 1.1, 0.03, 0.28, 8, { collide: false, indoor: true });
    this.ctx.containers.push({ x: f.wx(0, inner.z0 + 1.1), y: f.y + base + 1.0, z: f.wz(0, inner.z0 + 1.1), name: 'Altar Cabinet', profile: 'medical', capacity: 6, kind: 'cabinet' });
    void fh;
  }

  _openings(spec, side, floor) {
    const len = side === 'S' || side === 'N' ? spec.w : spec.d;
    const ops = [];
    if (floor === 0) for (const dd of spec.doors || []) if (dd.side === side) ops.push({ at: dd.at, w: dd.w || DOOR_W, type: dd.gap ? 'gap' : 'door', h: dd.h, leaf: !dd.gap, mat: dd.mat, metal: dd.metal, open: dd.open });
    const nWin = (spec.windows && spec.windows[side]) ?? Math.max(1, Math.floor((len - 1.4) / 2.7));
    const winW = spec.winW || WIN_W;
    if (nWin > 0) {
      for (let i = 0; i < nWin; i++) {
        const at = -len / 2 + ((i + 1) * len) / (nWin + 1);
        if (ops.some((o) => Math.abs(o.at - at) < (o.w + winW) / 2 + 0.35)) continue;
        if (Math.abs(at) > len / 2 - winW / 2 - 0.55) continue;
        ops.push({ at, w: winW, type: 'window' });
      }
    }
    return ops;
  }

  _partition(f, spec, p, y0, h, fl) {
    if (p.floors && !p.floors.includes(fl)) return;
    const t = 0.14;
    const mat = spec.innerMat || spec.wallMat;
    const shade = [INTERIOR, INTERIOR, INTERIOR, INTERIOR, INTERIOR, INTERIOR];
    const from = p.from ?? (p.axis === 'x' ? -spec.w / 2 + WALL_T : -spec.d / 2 + WALL_T);
    const to = p.to ?? (p.axis === 'x' ? spec.w / 2 - WALL_T : spec.d / 2 - WALL_T);
    const doorAt = p.door ?? (from + to) / 2;
    const segs = [[from, doorAt - 0.5], [doorAt + 0.5, to]];
    for (const [a, b] of segs) {
      if (b - a < 0.05) continue;
      const c = (a + b) / 2, L = b - a;
      if (p.axis === 'x') this.box(f, mat, c, y0 + h / 2, p.at, L, h, t, { faceShade: shade });
      else this.box(f, mat, p.at, y0 + h / 2, c, t, h, L, { faceShade: shade });
    }
    // lintel over doorway
    if (p.axis === 'x') this.box(f, mat, doorAt, y0 + (DOOR_H + h) / 2, p.at, 1.0, h - DOOR_H, t, { faceShade: shade, collide: false });
    else this.box(f, mat, p.at, y0 + (DOOR_H + h) / 2, doorAt, t, h - DOOR_H, 1.0, { faceShade: shade, collide: false });
  }

  _stairPlan(spec, fh) {
    // stair runs along the W wall from front to back, starting near the north-west corner
    const steps = Math.ceil(fh / 0.22);
    const run = 0.27;
    const len = steps * run;
    const width = 1.0;
    const x = -spec.w / 2 + WALL_T + width / 2 + 0.02;
    const zStart = spec.d / 2 - WALL_T - 0.4 - (spec.stairOffset || 0);
    return { steps, run, len, width, x, zStart, zEnd: zStart - len, rise: fh / steps };
  }

  _stairs(f, spec, s, y0, fh) {
    for (let i = 0; i < s.steps; i++) {
      const top = y0 + (i + 1) * s.rise;
      const z = s.zStart - (i + 0.5) * s.run;
      this.box(f, spec.stairMat || 'concrete_dark', s.x, top - s.rise / 2 - (i === 0 ? 0 : 0), z, s.width, s.rise, s.run + 0.01,
        { faceShade: [INTERIOR, INTERIOR, 0.8, INTERIOR, INTERIOR, INTERIOR], indoor: true });
      // fill under the stair so it reads as solid
      if (i > 0) this.box(f, spec.stairMat || 'concrete_dark', s.x, y0 + (top - s.rise - y0) / 2, z, s.width, top - s.rise - y0, s.run, { collide: false, faceShade: [INTERIOR, INTERIOR, INTERIOR, INTERIOR, INTERIOR, INTERIOR] });
    }
    // railing beside the stair
    this.box(f, 'metal_dark', s.x + s.width / 2 + 0.03, y0 + fh * 0.5 + 0.5, s.zStart - s.len / 2, 0.05, 0.05, s.len, { collide: false, rotX: Math.atan2(fh, s.len), indoor: true });
    void spec;
  }

  _slab(f, spec, yc, thick, stairs, mat) {
    const t = spec.thick || WALL_T;
    const w = spec.w - 2 * t + 0.02, d = spec.d - 2 * t + 0.02;
    const shade = [INTERIOR, INTERIOR, FLOOR_SHADE, CEIL_SHADE, INTERIOR, INTERIOR];
    if (!stairs) {
      this.box(f, mat, 0, yc, 0, w, thick, d, { faceShade: shade });
      return;
    }
    // hole above stair: x in [stairs.x - width/2, stairs.x + width/2], z in [zEnd, zStart]
    const hx0 = stairs.x - stairs.width / 2 - 0.05, hx1 = stairs.x + stairs.width / 2 + 0.1;
    const hz0 = stairs.zEnd - 0.1, hz1 = stairs.zStart + 0.2;
    const X0 = -w / 2 + 0.01, X1 = w / 2 - 0.01, Z0 = -d / 2 + 0.01, Z1 = d / 2 - 0.01;
    const rect = (a, b, c, e) => { if (b - a > 0.05 && e - c > 0.05) this.box(f, mat, (a + b) / 2, yc, (c + e) / 2, b - a, thick, e - c, { faceShade: shade }); };
    rect(hx1, X1, Z0, Z1); // east of hole
    rect(X0, hx0, Z0, Z1); // west of hole (thin)
    rect(hx0, hx1, Z0, hz0); // north of hole
    rect(hx0, hx1, hz1, Z1); // south of hole
    // guard rail around hole (upper floor)
    this.box(f, 'metal_dark', hx1 + 0.03, yc + 0.55, (hz0 + hz1) / 2, 0.05, 1.0, hz1 - hz0, { blocksSight: false, phys: 'metal', indoor: true });
  }

  _roof(f, spec, topY, slab) {
    const { w, d } = spec;
    const roof = spec.roof || 'gable';
    const rm = spec.roofMat || 'roof';
    // ceiling (top floor): the slab sits on the walls; its edge is clad in wall material
    const t = spec.thick || WALL_T;
    this.box(f, spec.ceilMat || 'plaster', 0, topY + slab / 2, 0, w - 2 * t + 0.02, slab, d - 2 * t + 0.02, { faceShade: [EXTERIOR, EXTERIOR, EXTERIOR, CEIL_SHADE, EXTERIOR, EXTERIOR] });
    for (const [lx, lz, bw, bd] of [[0, d / 2 - t / 2, w, t], [0, -d / 2 + t / 2, w, t], [w / 2 - t / 2, 0, t, d - 2 * t], [-w / 2 + t / 2, 0, t, d - 2 * t]]) {
      this.box(f, spec.wallMat, lx, topY + slab / 2, lz, bw, slab, bd, { collide: false, tint: spec.wallTint, faceShade: [EXTERIOR, EXTERIOR, EXTERIOR, CEIL_SHADE, EXTERIOR, EXTERIOR] });
    }
    const top = topY + slab;
    if (roof === 'none') return;
    if (roof === 'flat') {
      const p = 0.55;
      const pm = spec.wallMat;
      this.box(f, pm, 0, top + p / 2, d / 2 - 0.1, w, p, 0.2, { collide: false, tint: spec.wallTint });
      this.box(f, pm, 0, top + p / 2, -d / 2 + 0.1, w, p, 0.2, { collide: false, tint: spec.wallTint });
      this.box(f, pm, w / 2 - 0.1, top + p / 2, 0, 0.2, p, d, { collide: false, tint: spec.wallTint });
      this.box(f, pm, -w / 2 + 0.1, top + p / 2, 0, 0.2, p, d, { collide: false, tint: spec.wallTint });
      // coping and a bitumen roof membrane
      if (this._style(spec).detailed) {
        this.box(f, 'concrete', 0, top + p + 0.03, d / 2 - 0.1, w + 0.08, 0.06, 0.3, { collide: false });
        this.box(f, 'concrete', 0, top + p + 0.03, -d / 2 + 0.1, w + 0.08, 0.06, 0.3, { collide: false });
        this.box(f, 'concrete', w / 2 - 0.1, top + p + 0.03, 0, 0.3, 0.06, d + 0.08, { collide: false });
        this.box(f, 'concrete', -w / 2 + 0.1, top + p + 0.03, 0, 0.3, 0.06, d + 0.08, { collide: false });
        this.box(f, 'black', 0, top + 0.01, 0, w - 0.4, 0.02, d - 0.4, { collide: false, shade: 0.8 });
      }
      // rooftop plant: ventilation unit, vent stacks, sometimes an aerial
      if (w > 8) {
        this.box(f, 'metal', w * 0.2, top + 0.5, -d * 0.15, 1.4, 1.0, 1.0, { collide: false });
        this.box(f, 'metal_dark', w * 0.2, top + 1.05, -d * 0.15, 0.9, 0.1, 0.6, { collide: false });
        this.cyl(f, 'metal', -w * 0.25, top + 0.4, d * 0.2, 0.15, 0.8, 8, { collide: false });
        this.cyl(f, 'metal', -w * 0.3, top + 0.35, -d * 0.25, 0.1, 0.7, 8, { collide: false });
        if (this.rng.chance(0.4)) this.box(f, 'metal_dark', w * 0.35, top + 2, d * 0.3, 0.05, 4, 0.05, { collide: false });
      }
      return;
    }
    if (roof === 'shed') {
      const rise = Math.min(1.4, w * 0.12);
      const L = Math.hypot(w + 0.6, rise);
      const ang = Math.atan2(rise, w + 0.6);
      this.box(f, rm, 0, top + rise / 2 + 0.08, 0, L, 0.1, d + 0.6, { collide: false, rotZ: ang });
      return;
    }
    // gable along the longer axis
    const alongZ = d >= w;
    const span = alongZ ? w : d, len = alongZ ? d : w;
    const rise = span * (spec.roofPitch || 0.38);
    const over = 0.45;
    const ang = Math.atan2(rise, span / 2);
    const horiz = span / 2 + over;
    const slope = horiz / Math.cos(ang);
    const cy = top + rise - Math.tan(ang) * horiz / 2 + 0.06;
    for (const s of [-1, 1]) {
      const off = (horiz / 2) * s;
      if (alongZ) this._roofPanel(f, rm, off, cy, 0, slope, len + over * 2, -s * ang, 'z');
      else this._roofPanel(f, rm, 0, cy, off, slope, len + over * 2, s * ang, 'x');
    }
    // gable end triangles
    const gm = spec.gableMat || spec.wallMat;
    if (alongZ) {
      this.B.gable(gm, f.wx(0, d / 2 - 0.12), f.y + top, f.wz(0, d / 2 - 0.12), w, rise, 0.24, { rotY: f.theta });
      this.B.gable(gm, f.wx(0, -d / 2 + 0.12), f.y + top, f.wz(0, -d / 2 + 0.12), w, rise, 0.24, { rotY: f.theta });
    } else {
      this.B.gable(gm, f.wx(w / 2 - 0.12, 0), f.y + top, f.wz(w / 2 - 0.12, 0), d, rise, 0.24, { rotY: f.theta + Math.PI / 2 });
      this.B.gable(gm, f.wx(-w / 2 + 0.12, 0), f.y + top, f.wz(-w / 2 + 0.12, 0), d, rise, 0.24, { rotY: f.theta + Math.PI / 2 });
    }
    this._roofDressing(f, spec, top, rise, alongZ, span, len, over, ang);
    // chimney on houses, with a cap and flue
    if (spec.chimney) {
      const cx = w * 0.22, cz = -d * 0.2;
      const ch = rise * 1.2 + 0.8;
      this.box(f, 'brick', cx, top + rise * 0.7, cz, 0.7, ch, 0.7, { collide: false });
      const capY = top + rise * 0.7 + ch / 2;
      this.box(f, 'concrete_dark', cx, capY + 0.05, cz, 0.84, 0.1, 0.84, { collide: false });
      this.cyl(f, 'metal_dark', cx, capY + 0.3, cz, 0.1, 0.4, 8, { collide: false });
    }
  }

  _roofPanel(f, mat, lx, ly, lz, slopeLen, len, ang, axis) {
    const wx = f.wx(lx, lz), wz = f.wz(lx, lz);
    if (axis === 'z') this.B.box(mat, wx, f.y + ly, wz, slopeLen, 0.12, len, { rotY: f.theta, rotZ: ang, uvOffset: 0 });
    else this.B.box(mat, wx, f.y + ly, wz, len, 0.12, slopeLen, { rotY: f.theta, rotX: ang, uvOffset: 0 });
  }

  // ------------------------------------------------------------ exterior dressing
  /** Architectural style derived from materials and use. */
  _style(spec) {
    if (spec._style) return spec._style;
    const wm = spec.wallMat || 'plaster';
    const sheet = wm.startsWith('corrugated');
    const plaster = wm.startsWith('plaster');
    const timber = wm === 'wood' || wm === 'wood_dark' || wm === 'wood_red' || wm === 'logs';
    const residential = ['house', 'ranger', 'cabin'].includes(spec.furniture) || spec.profile === 'residential';
    const detailed = spec.facade !== false && (spec.thick || WALL_T) >= 0.2 && spec.roof !== 'none';
    const rng = this.rng;
    const st = {
      detailed, residential, sheet, plaster, timber,
      trim: spec.trimMat || (plaster ? rng.pick(['paint_trim', 'paint_trim', 'wood_dark']) : timber ? 'wood_dark' : wm === 'brick' ? 'paint_trim' : 'metal_dark'),
      sill: plaster || wm === 'brick' ? 'concrete' : timber ? 'wood_dark' : sheet ? null : 'concrete_dark',
      surround: plaster && rng.chance(0.75) ? wm : null,
      socle: sheet ? null : timber ? (wm === 'logs' ? 'stone' : 'concrete_dark') : plaster ? rng.pick(['concrete_dark', 'stone', 'plaster_grey']) : wm === 'brick' ? 'concrete_dark' : null,
      quoins: plaster && residential && rng.chance(0.6),
      band: (spec.floors || 1) > 1 && !sheet ? (plaster ? wm : wm === 'brick' ? 'concrete' : null) : null,
      shutters: residential && (plaster || wm === 'wood') && rng.chance(0.45) ? rng.pick(['wood_green', 'wood_blue', 'wood_dark', 'wood_red']) : null,
      gutters: !sheet && spec.roof !== 'flat',
      canopy: residential && !timber ? rng.chance(0.6) : residential && rng.chance(0.3),
      clutter: rng.chance(0.65),
    };
    spec._style = st;
    return st;
  }

  /**
   * Box on the outside of a wall. at: position along the side (same convention as
   * openings), yc: centre height (building-local), along/h: size on the facade,
   * out: centre offset from the exterior face (positive outward), depth: thickness.
   */
  _facadeBox(f, spec, side, at, yc, along, h, out, depth, mat, opts = {}) {
    const { w, d } = spec;
    let lx, lz, W, D;
    if (side === 'S') { lx = at; lz = d / 2 + out; W = along; D = depth; }
    else if (side === 'N') { lx = at; lz = -d / 2 - out; W = along; D = depth; }
    else if (side === 'E') { lx = w / 2 + out; lz = at; W = depth; D = along; }
    else { lx = -w / 2 - out; lz = at; W = depth; D = along; }
    this.box(f, mat, lx, yc, lz, W, h, D, { collide: false, ...opts });
  }

  _windowDressing(f, spec, side, y0, at, w) {
    const WIN_SILL = spec.winSill ?? WIN_SILL_D, WIN_TOP = spec.winTop ?? WIN_TOP_D;
    const st = this._style(spec);
    if (!st.detailed) return;
    const h = WIN_TOP - WIN_SILL, yc = y0 + WIN_SILL + h / 2;
    const fw = 0.075;
    // plaster surround band (classic rendered window reveal)
    if (st.surround) {
      const sw = 0.14;
      const tint = [1.08, 1.06, 1.04];
      this._facadeBox(f, spec, side, at - w / 2 - sw / 2, yc, sw, h + sw * 2, 0.012, 0.025, st.surround, { tint });
      this._facadeBox(f, spec, side, at + w / 2 + sw / 2, yc, sw, h + sw * 2, 0.012, 0.025, st.surround, { tint });
      this._facadeBox(f, spec, side, at, y0 + WIN_TOP + sw / 2, w, sw, 0.012, 0.025, st.surround, { tint });
    }
    // frame proud of the wall
    this._facadeBox(f, spec, side, at - w / 2 + fw / 2, yc, fw, h, -0.04, 0.09, st.trim);
    this._facadeBox(f, spec, side, at + w / 2 - fw / 2, yc, fw, h, -0.04, 0.09, st.trim);
    this._facadeBox(f, spec, side, at, y0 + WIN_TOP - fw / 2, w, fw, -0.04, 0.09, st.trim);
    this._facadeBox(f, spec, side, at, y0 + WIN_SILL + fw / 2, w, fw, -0.04, 0.09, st.trim);
    // projecting sill with a lintel on brick buildings
    if (st.sill) this._facadeBox(f, spec, side, at, y0 + WIN_SILL - 0.03, w + 0.2, 0.06, 0.06, 0.14, st.sill);
    if ((spec.wallMat === 'brick') && st.detailed) this._facadeBox(f, spec, side, at, y0 + WIN_TOP + 0.09, w + 0.3, 0.18, 0.012, 0.03, 'concrete', { tint: [0.9, 0.88, 0.86] });
    // open shutters folded against the wall
    if (st.shutters && WIN_TOP - WIN_SILL > 1) {
      for (const s of [-1, 1]) {
        if (this.rng.chance(0.12)) continue; // one missing
        this._facadeBox(f, spec, side, at + s * (w / 2 + w / 4 + 0.04), yc, w / 2, h - 0.02, 0.035, 0.04, st.shutters, { shade: 0.95 });
      }
    }
  }

  /** Socle, corner quoins, floor bands, cornice and door surrounds. */
  _facadeDressing(f, spec, floors, fh, base) {
    const st = this._style(spec);
    if (!st.detailed) return;
    const { w, d } = spec;
    const sides = ['S', 'N', 'E', 'W'];
    const sideLen = (side) => (side === 'S' || side === 'N' ? w : d);
    // socle band around the base, broken at door openings
    if (st.socle) {
      const h = 0.75 + base, yc = h / 2 - 0.25;
      for (const side of sides) {
        const L = sideLen(side) + 0.1;
        const doors = (spec.doors || []).filter((dd) => dd.side === side).map((dd) => [dd.at - (dd.w || DOOR_W) / 2, dd.at + (dd.w || DOOR_W) / 2]).sort((a, b) => a[0] - b[0]);
        let cur = -L / 2;
        for (const [a, b] of [...doors, [L / 2, L / 2]]) {
          if (a - cur > 0.05) this._facadeBox(f, spec, side, (cur + a) / 2, yc, a - cur, h, 0.025, 0.05, st.socle);
          cur = b;
        }
      }
    }
    // corner pilasters
    if (st.quoins) {
      const H = base + floors * fh;
      const tint = [1.07, 1.05, 1.02];
      const y0 = base + 0.6, y1 = base + floors * fh;
      for (const [side, at] of [['S', -w / 2 + 0.17], ['S', w / 2 - 0.17], ['N', -w / 2 + 0.17], ['N', w / 2 - 0.17], ['E', -d / 2 + 0.17], ['E', d / 2 - 0.17], ['W', -d / 2 + 0.17], ['W', d / 2 - 0.17]]) {
        this._facadeBox(f, spec, side, at, (y0 + y1) / 2, 0.34, y1 - y0, 0.015, 0.03, spec.wallMat, { tint });
      }
      void H;
    }
    // string course between floors and a cornice under the roof
    for (let fl = 1; fl <= floors; fl++) {
      const top = fl === floors;
      const mat = top ? (spec.roof === 'flat' ? (st.band || spec.wallMat) : null) : st.band;
      if (!mat) continue;
      const y = base + fl * fh - 0.09;
      for (const side of sides) this._facadeBox(f, spec, side, 0, y, sideLen(side) + (top ? 0.12 : 0.06), top ? 0.26 : 0.16, top ? 0.04 : 0.025, top ? 0.1 : 0.05, mat, { tint: [0.94, 0.93, 0.92] });
    }
    // door surrounds, steps and porch canopies
    for (const dd of spec.doors || []) {
      const dw = dd.w || DOOR_W, dh = dd.h || DOOR_H;
      const yc = base + dh / 2;
      if (!dd.gap) {
        this._facadeBox(f, spec, dd.side, dd.at - dw / 2 - 0.05, yc, 0.1, dh + 0.1, -0.03, 0.1, st.trim);
        this._facadeBox(f, spec, dd.side, dd.at + dw / 2 + 0.05, yc, 0.1, dh + 0.1, -0.03, 0.1, st.trim);
        this._facadeBox(f, spec, dd.side, dd.at, base + dh + 0.05, dw + 0.2, 0.1, -0.03, 0.1, st.trim);
      }
      // steps from the ground at this door up to the floor. Buildings stand at the highest ground under
      // their footprint, so on a slope a door can be well over a metre above the ground in front of it.
      if (base > 0.05) {
        const [plx, plz] = this._sidePoint(spec, dd.side, dd.at, 0);
        const ox = dd.side === 'E' ? 1 : dd.side === 'W' ? -1 : 0, oz = dd.side === 'S' ? 1 : dd.side === 'N' ? -1 : 0;
        // lowest terrain across the first metre in front of the door, relative to the building
        let ground = Infinity;
        for (const k of [0.3, 0.8, 1.3]) ground = Math.min(ground, this.ctx.physics.terrainHeight(f.wx(plx + ox * k, plz + oz * k), f.wz(plx + ox * k, plz + oz * k)) - f.y);
        const drop = base - Math.min(ground, 0);
        const n = Math.max(1, Math.ceil(drop / 0.2));
        const rise = drop / n, run = 0.3;
        for (let i = 0; i < n; i++) {
          const top = base - i * rise, bottom = Math.min(ground, 0) - 0.25;
          this._facadeBox(f, spec, dd.side, dd.at, (top + bottom) / 2, dw + 1.4, top - bottom, run * (i + 0.5), run, 'concrete',
            { shade: 0.95 - (i % 2) * 0.04, collide: true, phys: 'concrete', tag: 'step' });
        }
      }
      if (st.canopy && dd.side === 'S' && !dd.gap) {
        const cy = base + dh + 0.35;
        this._facadeBox(f, spec, dd.side, dd.at, cy, dw + 0.9, 0.06, 0.45, 0.9, st.timber ? 'wood_dark' : this.rng.pick(['corrugated', 'metal_dark', 'roof_red']), { rotX: 0 });
        for (const s of [-1, 1]) this._facadeBox(f, spec, dd.side, dd.at + s * (dw / 2 + 0.35), cy - 0.25, 0.05, 0.5, 0.35, 0.05, 'metal_dark');
      }
    }
    // utility clutter: electricity meter box and a wall lamp by the main door
    const main = (spec.doors || []).find((dd) => !dd.gap);
    if (main && st.clutter) {
      this._facadeBox(f, spec, main.side, main.at + (main.w || DOOR_W) / 2 + 0.75, base + 1.5, 0.32, 0.42, 0.07, 0.14, this.rng.pick(['paint_white', 'concrete', 'paint_white']), { shade: 0.9 });
      this._facadeBox(f, spec, main.side, main.at, base + (main.h || DOOR_H) + 0.65, 0.18, 0.12, 0.12, 0.24, 'metal_dark');
    }
  }

  /** Fascia, barge boards, gutters, downpipes, ridge cap and roof clutter for pitched roofs. */
  _roofDressing(f, spec, top, rise, alongZ, span, len, over, ang) {
    const st = this._style(spec);
    if (!st.detailed) return;
    const { w, d } = spec;
    const horiz = span / 2 + over;
    const eaveY = top + rise - Math.tan(ang) * horiz + 0.02;
    const trim = st.timber ? 'wood_dark' : st.trim === 'paint_trim' ? 'wood_dark' : st.trim;
    const L = len + over * 2;
    // ridge cap
    const rm = spec.roofMat || 'roof';
    const ridgeMat = rm.startsWith('corrugated') ? 'metal_dark' : rm;
    if (alongZ) this.box(f, ridgeMat, 0, top + rise + 0.1, 0, 0.34, 0.14, L + 0.04, { collide: false, shade: 0.8 });
    else this.box(f, ridgeMat, 0, top + rise + 0.1, 0, L + 0.04, 0.14, 0.34, { collide: false, shade: 0.8 });
    for (const s of [-1, 1]) {
      // fascia board along the eave
      if (alongZ) this.box(f, trim, s * (horiz + 0.02), eaveY - 0.1, 0, 0.04, 0.22, L, { collide: false });
      else this.box(f, trim, 0, eaveY - 0.1, s * (horiz + 0.02), L, 0.22, 0.04, { collide: false });
      // barge boards following the gable slopes
      for (const e of [-1, 1]) {
        const off = (horiz / 2) * s;
        const yy = top + rise - Math.tan(ang) * horiz / 2 - 0.06;
        const slopeLen = horiz / Math.cos(ang);
        if (alongZ) this.box(f, trim, off, yy, e * (L / 2 + 0.02), slopeLen, 0.2, 0.04, { collide: false, rotZ: -s * ang });
        else this.box(f, trim, e * (L / 2 + 0.02), yy, off, 0.04, 0.2, slopeLen, { collide: false, rotX: s * ang });
      }
      if (!st.gutters) continue;
      // gutter
      const gx = s * (horiz + 0.1);
      if (alongZ) this.cyl(f, 'metal', gx, eaveY - 0.18, 0, 0.065, L, 6, { collide: false, rotX: Math.PI / 2 });
      else this.cyl(f, 'metal', 0, eaveY - 0.18, gx, 0.065, L, 6, { collide: false, rotZ: Math.PI / 2 });
      // downpipe at one corner on each side, stepping in to the wall
      const e = s;
      const wallOff = (alongZ ? w : d) / 2 + 0.09;
      const along = e * ((alongZ ? d : w) / 2 - 0.2);
      const pipeH = eaveY - 0.25;
      if (alongZ) {
        this.cyl(f, 'metal', s * wallOff, pipeH / 2 - 0.1, along, 0.045, pipeH, 6, { collide: false });
        this.box(f, 'metal', s * (wallOff + horiz + 0.1) / 2, pipeH, along, horiz + 0.1 - wallOff, 0.07, 0.07, { collide: false });
      } else {
        this.cyl(f, 'metal', along, pipeH / 2 - 0.1, s * wallOff, 0.045, pipeH, 6, { collide: false });
        this.box(f, 'metal', along, pipeH, s * (wallOff + horiz + 0.1) / 2, 0.07, 0.07, horiz + 0.1 - wallOff, { collide: false });
      }
    }
    // TV antenna on some houses
    if (st.residential && this.rng.chance(0.35)) {
      const ax = alongZ ? 0 : len * 0.25, az = alongZ ? -len * 0.25 : 0;
      this.box(f, 'metal_dark', ax, top + rise + 1.0, az, 0.04, 2.0, 0.04, { collide: false });
      for (let k = 0; k < 4; k++) this.box(f, 'metal_dark', ax, top + rise + 1.4 + k * 0.18, az, 0.9 - k * 0.15, 0.025, 0.025, { collide: false, rotY: 0.5 });
    }
  }

  // ------------------------------------------------------------ furniture
  _furnish(f, spec, fl, y0, stairs) {
    const preset = FURNITURE_PRESETS[spec.furniture] || null;
    if (!preset) return;
    const list = typeof preset === 'function' ? preset(spec, fl, this.rng) : preset;
    const { w, d } = spec;
    const inner = { x0: -w / 2 + WALL_T + 0.05, x1: w / 2 - WALL_T - 0.05, z0: -d / 2 + WALL_T + 0.05, z1: d / 2 - WALL_T - 0.05 };
    // blocked intervals along each wall (doors, windows are fine for low items)
    const used = { S: [], N: [], E: [], W: [] };
    for (const dd of spec.doors || []) if (fl === 0) used[dd.side].push([dd.at - (dd.w || 1) / 2 - 0.6, dd.at + (dd.w || 1) / 2 + 0.6]);
    if (stairs) used.W.push([-d, d]);
    for (const p of spec.partitions || []) {
      if (p.axis === 'x') { used.E.push([p.at - 0.3, p.at + 0.3]); used.W.push([p.at - 0.3, p.at + 0.3]); }
      else { used.S.push([p.at - 0.3, p.at + 0.3]); used.N.push([p.at - 0.3, p.at + 0.3]); }
    }
    const centreUsed = [];
    for (const item of list) {
      if (!this.rng.chance(item.p ?? 1)) continue;
      const def = FURNITURE[item.t];
      if (!def) continue;
      if (item.where === 'centre') {
        const cx = (inner.x0 + inner.x1) / 2 + (this.rng.next() - 0.5) * 1.0;
        const cz = (inner.z0 + inner.z1) / 2 + (this.rng.next() - 0.5) * 1.0 + (item.dz || 0);
        if (centreUsed.some(([x, z]) => Math.hypot(x - cx, z - cz) < 1.6)) continue;
        if (stairs && cx < stairs.x + 1.2) continue;
        centreUsed.push([cx, cz]);
        this._placeFurniture(f, def, item, cx, y0, cz, this.rng.pick([0, 1]) * Math.PI / 2 * 0 + 0, spec);
        continue;
      }
      const sides = item.side ? [item.side] : this.rng.next() < 0.5 ? ['N', 'E', 'S', 'W'] : ['E', 'N', 'W', 'S'];
      let placed = false;
      for (const side of sides) {
        const horizontal = side === 'S' || side === 'N';
        const lo = horizontal ? inner.x0 : inner.z0, hi = horizontal ? inner.x1 : inner.z1;
        const L = def.len;
        for (let tries = 0; tries < 6 && !placed; tries++) {
          const a = lo + this.rng.next() * Math.max(0.001, hi - lo - L);
          const b = a + L;
          if (b > hi) continue;
          if (used[side].some(([u0, u1]) => !(b < u0 || a > u1))) continue;
          used[side].push([a, b]);
          const c = (a + b) / 2;
          const depth = def.depth / 2 + 0.02;
          let x, z, yaw;
          if (side === 'S') { x = c; z = inner.z1 - depth; yaw = Math.PI; }
          else if (side === 'N') { x = c; z = inner.z0 + depth; yaw = 0; }
          else if (side === 'E') { x = inner.x1 - depth; z = c; yaw = -Math.PI / 2; }
          else { x = inner.x0 + depth; z = c; yaw = Math.PI / 2; }
          this._placeFurniture(f, def, item, x, y0, z, yaw, spec);
          placed = true;
        }
        if (placed) break;
      }
    }
    // clutter: debris, papers, bottles
    const clutter = Math.floor((w * d) / 14 * (spec.ruin ?? 0.5));
    for (let i = 0; i < clutter; i++) {
      const x = inner.x0 + this.rng.next() * (inner.x1 - inner.x0);
      const z = inner.z0 + this.rng.next() * (inner.z1 - inner.z0);
      if (stairs && x < stairs.x + 0.8) continue;
      const k = this.rng.int(0, 3);
      if (k === 0) this.box(f, 'paint_white', x, y0 + 0.006, z, 0.22, 0.01, 0.3, { collide: false, rotY: this.rng.next() * 3, shade: 0.8, indoor: true }); // paper
      else if (k === 1) this.box(f, 'wood_dark', x, y0 + 0.04, z, 0.9 + this.rng.next(), 0.05, 0.12, { collide: false, rotY: this.rng.next() * 3, indoor: true }); // plank
      else if (k === 2) this.cyl(f, 'glass_dirty', x, y0 + 0.12, z, 0.04, 0.24, 6, { collide: false, indoor: true });
      else this.box(f, 'concrete_dark', x, y0 + 0.08, z, 0.5, 0.16, 0.4, { collide: false, rotY: this.rng.next() * 3, rotZ: 0.2, indoor: true }); // rubble
    }
  }

  _placeFurniture(f, def, item, lx, y0, lz, yaw, spec) {
    // def.parts: list of [mat, x, y, z, w, h, d] in item-local space (x along wall, z out from wall)
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const part of def.parts) {
      const [mat, px, py, pz, pw, ph, pd, opt] = part;
      const rx = px * c + pz * s, rz = -px * s + pz * c;
      const quarter = Math.round(yaw / (Math.PI / 2));
      const swap = Math.abs(quarter) % 2 === 1;
      this.box(f, mat, lx + rx, y0 + py, lz + rz, swap ? pd : pw, ph, swap ? pw : pd, {
        collide: !!(opt && opt.collide), faceShade: [0.85, 0.85, 0.95, 0.6, 0.85, 0.85], blocksSight: !(opt && opt.seeThrough), indoor: true,
      });
    }
    if (def.collider) {
      const quarter = Math.round(yaw / (Math.PI / 2));
      const swap = Math.abs(quarter) % 2 === 1;
      const [W, D] = f.dims(swap ? def.depth : def.len, swap ? def.len : def.depth);
      const cx = f.wx(lx, lz), cz = f.wz(lx, lz);
      this.ctx.colliders.push(this.ctx.physics.addBox(cx - W / 2, f.y + y0, cz - D / 2, cx + W / 2, f.y + y0 + def.height, cz + D / 2, {
        material: def.phys || 'wood', owner: this.ctx.owner, blocksSight: def.height > 1.3,
      }));
    }
    if (def.container) {
      const front = def.depth / 2 + 0.45;
      const fx = lx + Math.sin(yaw) * front * 0, fz = lz;
      void fx; void fz;
      const wx = f.wx(lx, lz), wz = f.wz(lx, lz);
      this.ctx.containers.push({
        x: wx, y: f.y + y0 + Math.min(def.height, 1.2) * 0.7, z: wz,
        name: def.name, profile: item.profile || def.profile || spec.profile || 'residential',
        capacity: def.capacity || 10, kind: item.t,
      });
    }
    if (def.light) this.ctx.lights.push({ x: f.wx(lx, lz), y: f.y + y0 + def.height + 0.2, z: f.wz(lx, lz) });
  }
}

// ---------------------------------------------------------------- furniture library
// parts: [material, x (along wall), y (centre), z (out from wall), w, h, d, opts]
// Detail helpers: every piece is built from boxes [material, x, y, z, w, h, d, opts].
const P_HANDLE = (x, y, z, w = 0.14) => ['metal', x, y, z, w, 0.025, 0.03];
const P_LEGS = (mat, len, depth, h, t = 0.06, inset = 0.04) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => [mat, sx * (len / 2 - inset - t / 2), h / 2, sz * (depth / 2 - inset - t / 2), t, h, t]);
const P_DRAWERS = (mat, x, y0, z, w, n, h) => Array.from({ length: n }, (_, i) => [[mat, x, y0 + i * h + h / 2, z, w, h - 0.03, 0.02], P_HANDLE(x, y0 + i * h + h / 2, z + 0.02, Math.min(0.16, w * 0.4))]).flat();
const P_SLATS = (mat, len, depth, h, n = 3) => Array.from({ length: n }, (_, i) => [[mat, 0, (i + 0.5) * (h / n), depth / 2 + 0.012, len + 0.02, 0.05, 0.025], [mat, 0, (i + 0.5) * (h / n), -depth / 2 - 0.012, len + 0.02, 0.05, 0.025]]).flat();

export const FURNITURE = {
  bed: { name: 'Bed', len: 1.0, depth: 2.0, height: 0.55, collider: true, parts: [
    ['wood_dark', 0, 0.26, 0, 1.0, 0.16, 2.0], ...P_LEGS('wood_dark', 1.0, 2.0, 0.2, 0.08, 0),
    ['mattress', 0, 0.42, 0.02, 0.92, 0.18, 1.9], ['fabric_blue', 0, 0.53, 0.32, 0.94, 0.05, 1.2], ['fabric_blue', 0.47, 0.4, 0.32, 0.02, 0.22, 1.2], ['fabric_blue', -0.47, 0.4, 0.32, 0.02, 0.22, 1.2],
    ['paint_white', 0, 0.56, -0.68, 0.6, 0.1, 0.34], ['wood_dark', 0, 0.62, -0.98, 1.0, 0.85, 0.06], ['wood', 0, 0.7, -0.945, 0.84, 0.5, 0.02], ['wood_dark', 0, 0.36, 0.98, 1.0, 0.36, 0.05]] },
  bunk: { name: 'Bunk Bed', len: 0.95, depth: 2.0, height: 1.7, collider: true, parts: [
    ['metal_dark', -0.45, 0.9, -0.95, 0.05, 1.8, 0.05], ['metal_dark', 0.45, 0.9, -0.95, 0.05, 1.8, 0.05], ['metal_dark', -0.45, 0.9, 0.95, 0.05, 1.8, 0.05], ['metal_dark', 0.45, 0.9, 0.95, 0.05, 1.8, 0.05],
    ['metal_dark', 0, 0.3, 0, 0.9, 0.04, 1.9], ['metal_dark', 0, 1.25, 0, 0.9, 0.04, 1.9], ['mattress', 0, 0.4, 0, 0.86, 0.14, 1.86], ['mattress', 0, 1.35, 0, 0.86, 0.14, 1.86],
    ['fabric_grey', 0, 0.48, 0.35, 0.88, 0.04, 1.1], ['olive', 0, 1.43, 0.35, 0.88, 0.04, 1.1], ['paint_white', 0, 0.5, -0.7, 0.5, 0.08, 0.3], ['paint_white', 0, 1.45, -0.7, 0.5, 0.08, 0.3],
    ['metal_dark', 0.45, 1.6, 0, 0.03, 0.03, 1.9], ['metal_dark', -0.45, 1.6, 0.3, 0.03, 0.03, 1.2],
    ['metal_dark', 0.2, 0.75, 0.97, 0.03, 1.0, 0.03], ['metal_dark', -0.2, 0.75, 0.97, 0.03, 1.0, 0.03], ['metal_dark', 0, 0.55, 0.97, 0.4, 0.03, 0.03], ['metal_dark', 0, 0.9, 0.97, 0.4, 0.03, 0.03]] },
  cot: { name: 'Cot', len: 0.8, depth: 1.9, height: 0.45, collider: false, parts: [
    ['canvas', 0, 0.4, 0, 0.72, 0.04, 1.9], ['metal_dark', -0.37, 0.4, 0, 0.03, 0.03, 1.94], ['metal_dark', 0.37, 0.4, 0, 0.03, 0.03, 1.94],
    ['metal_dark', 0, 0.2, -0.7, 0.8, 0.03, 0.03, { }], ['metal_dark', 0, 0.2, 0.7, 0.8, 0.03, 0.03], ['metal_dark', -0.38, 0.2, -0.7, 0.03, 0.4, 0.03], ['metal_dark', 0.38, 0.2, -0.7, 0.03, 0.4, 0.03], ['metal_dark', -0.38, 0.2, 0.7, 0.03, 0.4, 0.03], ['metal_dark', 0.38, 0.2, 0.7, 0.03, 0.4, 0.03],
    ['fabric_grey', 0, 0.44, 0.3, 0.7, 0.04, 1.0], ['canvas_tan', 0, 0.46, -0.72, 0.4, 0.08, 0.26]] },
  table: { name: 'Table', len: 1.4, depth: 0.9, height: 0.76, collider: true, parts: [
    ['wood', 0, 0.74, 0, 1.4, 0.05, 0.9], ['wood_dark', 0, 0.68, 0, 1.24, 0.08, 0.74], ...P_LEGS('wood_dark', 1.4, 0.9, 0.7, 0.07),
    ['wood_dark', 0.95, 0.45, 0.0, 0.42, 0.05, 0.42], ['wood_dark', 0.95, 0.72, 0.2, 0.42, 0.5, 0.04], ...P_LEGS('wood_dark', 0.42, 0.42, 0.44, 0.04, 0).map((p) => [p[0], p[1] + 0.95, p[2], p[3], p[4], p[5], p[6]]),
    ['paint_white', -0.3, 0.775, 0.1, 0.22, 0.015, 0.22], ['metal', -0.05, 0.8, -0.15, 0.08, 0.1, 0.08], ['wood_green', 0.35, 0.79, 0.05, 0.2, 0.04, 0.28]] },
  desk: { name: 'Desk', len: 1.4, depth: 0.7, height: 0.76, collider: true, container: true, capacity: 6, profile: 'office', parts: [
    ['wood', 0, 0.74, 0, 1.4, 0.05, 0.7], ['wood_dark', -0.48, 0.36, 0, 0.42, 0.72, 0.64], ...P_DRAWERS('wood', -0.48, 0.06, 0.33, 0.36, 3, 0.21),
    ['wood_dark', 0.66, 0.36, 0, 0.05, 0.72, 0.64], ['wood_dark', 0.1, 0.5, -0.3, 1.1, 0.4, 0.03],
    ['black', 0.2, 1.0, -0.14, 0.5, 0.32, 0.04], ['metal_dark', 0.2, 0.81, -0.14, 0.12, 0.08, 0.1], ['paint_white', 0.2, 0.775, 0.14, 0.4, 0.02, 0.13],
    ['paint_white', -0.4, 0.775, 0.0, 0.22, 0.012, 0.3], ['metal_dark', 0.58, 0.95, -0.2, 0.06, 0.38, 0.06], ['paint_yellow', 0.58, 1.14, -0.14, 0.14, 0.06, 0.18]] },
  wardrobe: { name: 'Wardrobe', len: 1.1, depth: 0.6, height: 2.0, collider: true, container: true, capacity: 10, profile: 'residential', parts: [
    ['wood_dark', 0, 1.02, 0, 1.1, 1.96, 0.6], ['wood_dark', 0, 2.02, 0, 1.16, 0.06, 0.66], ['wood_dark', 0, 0.03, 0, 1.14, 0.06, 0.64],
    ['wood', -0.27, 1.15, 0.305, 0.5, 1.55, 0.02], ['wood', 0.27, 1.15, 0.305, 0.5, 1.55, 0.02], ['wood_dark', -0.27, 1.15, 0.318, 0.36, 1.3, 0.01], ['wood_dark', 0.27, 1.15, 0.318, 0.36, 1.3, 0.01],
    ['metal', -0.05, 1.1, 0.33, 0.025, 0.16, 0.03], ['metal', 0.05, 1.1, 0.33, 0.025, 0.16, 0.03], ['wood', 0, 0.2, 0.305, 1.02, 0.26, 0.02], P_HANDLE(-0.25, 0.2, 0.325), P_HANDLE(0.25, 0.2, 0.325),
    ['canvas_tan', 0.2, 2.14, 0, 0.5, 0.2, 0.4]] },
  cabinet: { name: 'Cabinet', len: 0.9, depth: 0.5, height: 0.9, collider: true, container: true, capacity: 8, profile: 'residential', parts: [
    ['wood_dark', 0, 0.47, 0, 0.9, 0.86, 0.5], ['wood', 0, 0.92, 0, 0.96, 0.04, 0.56], ['wood_dark', 0, 0.03, 0.02, 0.84, 0.06, 0.44],
    ['wood', -0.22, 0.42, 0.255, 0.4, 0.6, 0.02], ['wood', 0.22, 0.42, 0.255, 0.4, 0.6, 0.02], ['metal', -0.04, 0.45, 0.275, 0.02, 0.1, 0.02], ['metal', 0.04, 0.45, 0.275, 0.02, 0.1, 0.02],
    ['wood', 0, 0.8, 0.255, 0.84, 0.12, 0.02], P_HANDLE(0, 0.8, 0.275), ['paint_white', -0.2, 1.0, 0, 0.12, 0.14, 0.12], ['wood_red', 0.2, 0.96, 0.05, 0.22, 0.05, 0.16]] },
  counter: { name: 'Kitchen Counter', len: 2.0, depth: 0.6, height: 0.92, collider: true, container: true, capacity: 10, profile: 'kitchen', parts: [
    ['paint_white', 0, 0.47, 0, 2.0, 0.84, 0.58], ['black', 0, 0.04, 0.03, 2.0, 0.08, 0.5], ['concrete_dark', 0, 0.91, 0.01, 2.04, 0.05, 0.64],
    ...[-0.75, -0.25, 0.25, 0.75].flatMap((x) => [['paint_white', x, 0.42, 0.295, 0.46, 0.62, 0.015], P_HANDLE(x, 0.66, 0.31, 0.12)]), ...[-0.75, -0.25, 0.25, 0.75].flatMap((x) => [['paint_white', x, 0.8, 0.295, 0.46, 0.1, 0.015]]),
    ['metal', 0.45, 0.935, 0.02, 0.52, 0.015, 0.4], ['metal_dark', 0.45, 0.9, 0.02, 0.44, 0.06, 0.32], ['metal', 0.45, 1.08, -0.2, 0.03, 0.26, 0.03], ['metal', 0.45, 1.2, -0.12, 0.03, 0.03, 0.18],
    ['wood_dark', 0, 1.75, -0.12, 2.0, 0.66, 0.34], ...[-0.75, -0.25, 0.25, 0.75].flatMap((x) => [['paint_white', x, 1.75, 0.055, 0.46, 0.6, 0.015], ['metal', x + 0.18, 1.52, 0.07, 0.02, 0.1, 0.02]]),
    ['paint_white', 0, 1.2, -0.285, 2.0, 0.44, 0.02], ['wood', -0.6, 0.95, 0.05, 0.3, 0.02, 0.22], ['metal', -0.2, 1.0, -0.1, 0.16, 0.14, 0.16], ['paint_red', -0.85, 1.02, -0.12, 0.1, 0.18, 0.1]] },
  fridge: { name: 'Refrigerator', len: 0.7, depth: 0.7, height: 1.8, collider: true, container: true, capacity: 8, profile: 'kitchen', parts: [
    ['paint_white', 0, 0.92, 0, 0.7, 1.76, 0.68], ['black', 0, 0.03, 0, 0.66, 0.06, 0.62], ['paint_white', 0, 1.5, 0.345, 0.68, 0.56, 0.02], ['paint_white', 0, 0.63, 0.345, 0.68, 1.12, 0.02],
    ['metal_dark', 0, 1.205, 0.345, 0.68, 0.015, 0.022], ['metal', 0.28, 1.45, 0.375, 0.03, 0.3, 0.04], ['metal', 0.28, 0.9, 0.375, 0.03, 0.5, 0.04],
    ['paint_yellow', -0.12, 1.55, 0.357, 0.1, 0.12, 0.004], ['paint_red', -0.2, 1.38, 0.357, 0.06, 0.06, 0.004], ['metal_dark', 0, 0.2, -0.345, 0.5, 0.3, 0.02]] },
  stove: { name: 'Stove', len: 0.8, depth: 0.6, height: 0.9, collider: true, parts: [
    ['black', 0, 0.45, 0, 0.8, 0.86, 0.6], ['metal_dark', 0, 0.9, 0, 0.84, 0.04, 0.64], ['metal_dark', 0, 0.4, 0.305, 0.5, 0.36, 0.02], ['metal', 0, 0.62, 0.325, 0.3, 0.025, 0.03], ['emissive_red', 0, 0.38, 0.316, 0.3, 0.12, 0.004],
    ...P_LEGS('black', 0.8, 0.6, 0.08, 0.08, 0), ['metal_dark', -0.2, 0.93, 0.05, 0.22, 0.02, 0.22], ['metal_dark', 0.2, 0.93, 0.05, 0.22, 0.02, 0.22], ['metal', 0.2, 1.0, 0.05, 0.2, 0.12, 0.2], ['metal', 0.36, 1.02, 0.05, 0.14, 0.02, 0.03],
    ['metal_dark', 0, 1.7, -0.22, 0.15, 1.6, 0.15], ['metal_dark', 0, 2.52, -0.22, 0.2, 0.06, 0.2]] },
  shelf: { name: 'Shelf', len: 1.8, depth: 0.5, height: 2.0, collider: true, container: true, capacity: 12, parts: [
    ...[[-0.88, -0.23], [0.88, -0.23], [-0.88, 0.23], [0.88, 0.23]].map(([x, z]) => ['metal_dark', x, 1.0, z, 0.04, 2.0, 0.04]),
    ...[0.12, 0.72, 1.32, 1.94].map((y) => ['metal', 0, y, 0, 1.8, 0.03, 0.5]), ['metal_dark', 0, 1.0, -0.24, 1.76, 0.03, 0.02, { }], ['metal_dark', -0.88, 0.4, 0, 0.02, 0.03, 0.46], ['metal_dark', 0.88, 1.6, 0, 0.02, 0.03, 0.46],
    ['canvas_tan', -0.5, 0.92, 0, 0.5, 0.36, 0.36], ['canvas_tan', -0.5, 1.12, 0, 0.52, 0.04, 0.38], ['paint_red', 0.4, 0.3, 0, 0.36, 0.32, 0.3], ['metal', 0.4, 0.48, 0, 0.2, 0.03, 0.03],
    ['canvas', 0.35, 1.52, 0, 0.6, 0.36, 0.4], ['olive', -0.45, 1.46, 0.02, 0.36, 0.24, 0.3], ['wood_dark', 0.1, 0.9, 0, 0.3, 0.3, 0.3], ['paint_white', 0.55, 0.86, 0.05, 0.12, 0.24, 0.12], ['paint_yellow', 0.7, 0.84, -0.05, 0.1, 0.2, 0.1],
    ['corrugated_blue', -0.3, 0.26, 0, 0.3, 0.24, 0.34], ['metal_dark', -0.68, 0.24, 0, 0.2, 0.2, 0.2], ['wood', 0.0, 2.02, 0, 0.5, 0.12, 0.36]] },
  locker: { name: 'Locker', len: 1.2, depth: 0.5, height: 1.9, collider: true, container: true, capacity: 10, phys: 'metal', parts: [
    ['olive', 0, 0.97, 0, 1.2, 1.86, 0.5], ['metal_dark', 0, 0.03, 0, 1.16, 0.06, 0.46], ['metal_dark', 0, 1.92, 0, 1.22, 0.03, 0.52],
    ...[-0.4, 0, 0.4].flatMap((x) => [['olive', x, 0.98, 0.255, 0.38, 1.76, 0.012], ['black', x, 1.62, 0.264, 0.22, 0.012, 0.004], ['black', x, 1.58, 0.264, 0.22, 0.012, 0.004], ['black', x, 1.54, 0.264, 0.22, 0.012, 0.004], ['black', x, 0.3, 0.264, 0.22, 0.012, 0.004],
      ['metal', x + 0.13, 1.05, 0.27, 0.025, 0.12, 0.025], ['paint_white', x, 1.72, 0.264, 0.12, 0.05, 0.004]]),
    ['canvas_tan', 0.25, 2.03, 0, 0.5, 0.18, 0.34], ['metal_dark', -0.35, 1.99, 0, 0.3, 0.12, 0.3]] },
  gunrack: { name: 'Weapon Locker', len: 1.4, depth: 0.5, height: 1.9, collider: true, container: true, capacity: 12, phys: 'metal', parts: [
    ['metal_dark', 0, 0.97, 0, 1.4, 1.86, 0.5], ['black', 0, 0.03, 0, 1.36, 0.06, 0.46], ['metal', -0.35, 1.0, 0.255, 0.66, 1.7, 0.012], ['metal', 0.35, 1.0, 0.255, 0.66, 1.7, 0.012],
    ['metal_dark', -0.35, 1.3, 0.265, 0.5, 0.7, 0.004], ['metal_dark', 0.35, 1.3, 0.265, 0.5, 0.7, 0.004], ...[-0.5, -0.35, -0.2, 0.2, 0.35, 0.5].map((x) => ['black', x, 1.3, 0.27, 0.02, 0.62, 0.004]),
    ['metal', -0.05, 1.0, 0.28, 0.03, 0.22, 0.03], ['metal', 0.05, 1.0, 0.28, 0.03, 0.22, 0.03], ['brass', 0, 0.86, 0.285, 0.07, 0.09, 0.03], ['hazard', 0, 1.8, 0.265, 0.9, 0.08, 0.004], ['paint_white', 0, 0.4, 0.265, 0.5, 0.1, 0.004]] },
  filing: { name: 'Filing Cabinet', len: 0.5, depth: 0.6, height: 1.3, collider: true, container: true, capacity: 6, profile: 'office', phys: 'metal', parts: [
    ['metal_dark', 0, 0.66, 0, 0.5, 1.28, 0.6], ['black', 0, 0.02, 0, 0.46, 0.04, 0.56], ...[0, 1, 2, 3].flatMap((i) => [['metal', 0, 0.2 + i * 0.3, 0.305, 0.44, 0.26, 0.012], ['metal_dark', 0, 0.24 + i * 0.3, 0.318, 0.16, 0.025, 0.02], ['paint_white', 0, 0.14 + i * 0.3, 0.313, 0.12, 0.04, 0.004]]),
    ['paint_white', 0.05, 1.32, 0.05, 0.24, 0.03, 0.32], ['wood_green', -0.1, 1.36, -0.1, 0.14, 0.12, 0.14]] },
  workbench: { name: 'Workbench', len: 2.0, depth: 0.8, height: 0.95, collider: true, container: true, capacity: 12, profile: 'industrial', parts: [
    ['wood', 0, 0.93, 0, 2.0, 0.07, 0.8], ['metal_dark', 0, 0.87, 0, 1.9, 0.05, 0.7], ...P_LEGS('metal_dark', 2.0, 0.8, 0.86, 0.07),
    ['wood_dark', 0, 0.25, 0, 1.8, 0.04, 0.7], ['paint_red', -0.55, 0.42, 0.05, 0.5, 0.3, 0.3], ['metal', -0.55, 0.6, 0.05, 0.3, 0.03, 0.03], ['metal_dark', 0.3, 0.38, 0, 0.4, 0.22, 0.4], ['corrugated_blue', 0.75, 0.4, 0.05, 0.22, 0.26, 0.22],
    ['wood_dark', -0.45, 0.72, 0.385, 0.7, 0.2, 0.02], P_HANDLE(-0.45, 0.72, 0.4),
    ['wood_dark', 0, 1.6, -0.36, 2.0, 1.1, 0.04], ...[[-0.8, 1.7, 0.3], [-0.6, 1.62, 0.44], [-0.4, 1.74, 0.24], [-0.15, 1.66, 0.36], [0.1, 1.72, 0.28]].map(([x, y, hh]) => ['metal', x, y, -0.33, 0.04, hh, 0.02]),
    ['paint_red', 0.45, 1.75, -0.33, 0.3, 0.04, 0.02], ['paint_yellow', 0.45, 1.6, -0.33, 0.36, 0.04, 0.02], ['black', 0.8, 1.65, -0.33, 0.16, 0.3, 0.03],
    ['metal_dark', 0.75, 1.03, 0.2, 0.18, 0.14, 0.26], ['metal', 0.75, 1.12, 0.3, 0.2, 0.05, 0.06], ['metal', 0.75, 1.1, 0.42, 0.03, 0.03, 0.2],
    ['metal', -0.2, 0.975, 0.15, 0.32, 0.02, 0.05], ['paint_yellow', 0.2, 0.99, -0.05, 0.08, 0.05, 0.2], ['metal_dark', -0.7, 1.02, -0.1, 0.16, 0.12, 0.16], ['wood', 0.1, 0.98, 0.25, 0.4, 0.03, 0.1]] },
  crate: { name: 'Supply Crate', len: 1.0, depth: 0.8, height: 0.8, collider: true, container: true, capacity: 10, parts: [
    ['olive', 0, 0.4, 0, 0.96, 0.76, 0.76], ['wood_dark', 0, 0.8, 0, 1.0, 0.04, 0.8], ['wood_dark', 0, 0.03, 0, 1.0, 0.06, 0.8],
    ...[[-0.46, -0.36], [0.46, -0.36], [-0.46, 0.36], [0.46, 0.36]].map(([x, z]) => ['wood_dark', x, 0.4, z, 0.08, 0.8, 0.08]), ...P_SLATS('wood_dark', 0.96, 0.76, 0.8, 2),
    ['metal', -0.3, 0.74, 0.39, 0.08, 0.1, 0.02], ['metal', 0.3, 0.74, 0.39, 0.08, 0.1, 0.02], ['paint_white', 0, 0.42, 0.385, 0.4, 0.14, 0.004], ['black', -0.49, 0.5, 0, 0.02, 0.05, 0.3], ['black', 0.49, 0.5, 0, 0.02, 0.05, 0.3]] },
  ammobox: { name: 'Ammo Crate', len: 0.8, depth: 0.5, height: 0.45, collider: true, container: true, capacity: 6, phys: 'metal', parts: [
    ['olive', 0, 0.2, 0, 0.8, 0.36, 0.5], ['olive', 0, 0.41, 0, 0.82, 0.06, 0.52], ['metal_dark', 0, 0.37, 0.255, 0.82, 0.02, 0.01], ['metal', -0.25, 0.34, 0.265, 0.06, 0.1, 0.02], ['metal', 0.25, 0.34, 0.265, 0.06, 0.1, 0.02],
    ['black', 0, 0.455, 0, 0.3, 0.03, 0.06], ['black', -0.41, 0.25, 0, 0.02, 0.04, 0.24], ['black', 0.41, 0.25, 0, 0.02, 0.04, 0.24], ['paint_yellow', 0, 0.2, 0.253, 0.36, 0.1, 0.004],
    ['olive', 0.2, 0.62, 0.05, 0.34, 0.3, 0.2], ['metal', 0.2, 0.78, 0.05, 0.14, 0.02, 0.03]] },
  barrel: { name: 'Barrel', len: 0.7, depth: 0.7, height: 1.0, collider: true, parts: [
    ['paint_red', 0, 0.5, 0, 0.56, 0.96, 0.56], ['paint_red', 0, 0.5, 0, 0.4, 0.96, 0.66], ['paint_red', 0, 0.5, 0, 0.66, 0.96, 0.4],
    ['metal_dark', 0, 0.33, 0, 0.6, 0.03, 0.6], ['metal_dark', 0, 0.66, 0, 0.6, 0.03, 0.6], ['metal_dark', 0, 0.99, 0, 0.5, 0.02, 0.5], ['metal', 0.15, 1.0, 0.1, 0.08, 0.03, 0.08], ['paint_white', 0, 0.5, 0.332, 0.24, 0.16, 0.004]] },
  sofa: { name: 'Sofa', len: 2.0, depth: 0.9, height: 0.85, collider: true, parts: [
    ['wood_dark', 0, 0.1, 0, 1.9, 0.1, 0.8], ...P_LEGS('wood_dark', 2.0, 0.9, 0.08, 0.08, 0.02), ['fabric_red', 0, 0.28, 0.02, 1.96, 0.26, 0.84],
    ['fabric_red', -0.5, 0.47, 0.1, 0.82, 0.14, 0.62], ['fabric_red', 0.5, 0.47, 0.1, 0.82, 0.14, 0.62], ['fabric_red', -0.5, 0.72, -0.28, 0.82, 0.44, 0.2, { }], ['fabric_red', 0.5, 0.72, -0.28, 0.82, 0.44, 0.2],
    ['fabric_red', 0, 0.55, -0.4, 2.0, 0.7, 0.1], ['fabric_red', -0.93, 0.5, 0, 0.16, 0.44, 0.88], ['fabric_red', 0.93, 0.5, 0, 0.16, 0.44, 0.88], ['canvas_tan', -0.62, 0.66, -0.1, 0.34, 0.3, 0.12], ['fabric_blue', 0.2, 0.56, 0.2, 0.7, 0.03, 0.5]] },
  medbed: { name: 'Hospital Bed', len: 1.0, depth: 2.1, height: 0.8, collider: true, parts: [
    ['metal', 0, 0.5, 0, 0.9, 0.05, 2.0], ['mattress', 0, 0.6, 0, 0.88, 0.14, 1.95], ['paint_white', 0, 0.69, 0.3, 0.9, 0.04, 1.2], ['paint_white', 0, 0.72, -0.72, 0.5, 0.08, 0.3],
    ['paint_white', 0, 0.8, -1.02, 0.95, 0.7, 0.04], ['paint_white', 0, 0.66, 1.02, 0.95, 0.42, 0.04], ...P_LEGS('metal', 0.9, 2.0, 0.48, 0.04), ...[[-0.42, -0.95], [0.42, -0.95], [-0.42, 0.95], [0.42, 0.95]].map(([x, z]) => ['black', x, 0.05, z, 0.07, 0.1, 0.1]),
    ['metal', 0.47, 0.82, 0.1, 0.02, 0.03, 1.1], ['metal', 0.47, 0.72, -0.4, 0.02, 0.2, 0.02], ['metal', 0.47, 0.72, 0.6, 0.02, 0.2, 0.02], ['metal', -0.55, 1.0, -0.9, 0.03, 2.0, 0.03], ['paint_white', -0.55, 1.85, -0.82, 0.1, 0.22, 0.04]] },
  medcab: { name: 'Medical Cabinet', len: 1.0, depth: 0.45, height: 1.9, collider: true, container: true, capacity: 10, profile: 'medical', phys: 'metal', parts: [
    ['paint_white', 0, 0.96, 0, 1.0, 1.88, 0.45], ['metal', 0, 0.02, 0, 0.96, 0.04, 0.4], ['paint_white', -0.25, 0.5, 0.23, 0.46, 0.84, 0.012], ['paint_white', 0.25, 0.5, 0.23, 0.46, 0.84, 0.012], ['metal', -0.04, 0.55, 0.245, 0.02, 0.12, 0.02], ['metal', 0.04, 0.55, 0.245, 0.02, 0.12, 0.02],
    ['black', 0, 1.4, 0.2, 0.9, 0.86, 0.01], ['metal', 0, 1.13, 0.1, 0.9, 0.015, 0.3], ['metal', 0, 1.45, 0.1, 0.9, 0.015, 0.3],
    ...[[-0.3, 1.2, 'paint_white'], [-0.15, 1.21, 'wood_dark'], [0.1, 1.19, 'paint_white'], [0.3, 1.22, 'corrugated_blue'], [-0.25, 1.52, 'paint_red'], [0.05, 1.53, 'paint_white'], [0.28, 1.51, 'wood_dark']].map(([x, y, m]) => [m, x, y, 0.12, 0.08, 0.14, 0.08]),
    ['glass', 0, 1.4, 0.228, 0.9, 0.86, 0.012], ['metal', 0, 1.4, 0.236, 0.02, 0.86, 0.01], ['paint_red', 0, 1.9, 0.228, 0.16, 0.05, 0.004], ['paint_red', 0, 1.9, 0.228, 0.05, 0.16, 0.004]] },
  serverrack: { name: 'Server Rack', len: 0.7, depth: 1.0, height: 2.0, collider: true, container: true, capacity: 6, profile: 'research', phys: 'metal', parts: [
    ['black', 0, 1.0, 0, 0.7, 2.0, 1.0], ['metal_dark', 0, 1.0, 0.505, 0.62, 1.86, 0.01], ...Array.from({ length: 9 }, (_, i) => ['metal', 0, 0.22 + i * 0.2, 0.512, 0.56, 0.14, 0.006]),
    ...Array.from({ length: 9 }, (_, i) => [i % 3 === 0 ? 'emissive_lamp' : 'paint_red', -0.2 + (i % 2) * 0.08, 0.22 + i * 0.2, 0.518, 0.025, 0.025, 0.004]), ['black', 0.25, 1.0, 0.52, 0.03, 1.8, 0.01],
    ['metal_dark', 0, 2.03, 0, 0.5, 0.06, 0.7], ['black', -0.2, 2.12, -0.3, 0.05, 0.2, 0.05]] },
  labbench: { name: 'Lab Bench', len: 2.4, depth: 0.8, height: 0.92, collider: true, container: true, capacity: 10, profile: 'research', parts: [
    ['paint_white', -0.8, 0.45, 0, 0.7, 0.86, 0.76], ['paint_white', 0.8, 0.45, 0, 0.7, 0.86, 0.76], ['black', 0, 0.91, 0, 2.44, 0.05, 0.84], ['metal_dark', 0, 0.06, -0.3, 0.9, 0.04, 0.04],
    ...P_DRAWERS('paint_white', -0.8, 0.08, 0.39, 0.62, 3, 0.26), ['paint_white', 0.8, 0.42, 0.385, 0.62, 0.74, 0.012], P_HANDLE(0.8, 0.72, 0.4),
    ['glass', -0.7, 1.06, 0.1, 0.1, 0.24, 0.1], ['glass', -0.5, 1.02, -0.1, 0.08, 0.16, 0.08], ['glass', -0.9, 1.0, -0.15, 0.12, 0.12, 0.12], ['metal', 0.5, 1.12, -0.1, 0.5, 0.36, 0.4], ['black', 0.5, 1.18, 0.105, 0.3, 0.16, 0.004],
    ['metal_dark', 0, 1.1, -0.3, 0.06, 0.34, 0.06], ['metal_dark', 0, 1.3, -0.16, 0.2, 0.14, 0.2], ['metal', 0, 0.96, -0.1, 0.24, 0.04, 0.2], ['paint_white', 0.05, 0.945, 0.24, 0.3, 0.012, 0.22], ['metal', 1.05, 1.2, -0.3, 0.03, 0.5, 0.03], ['metal', 1.05, 1.44, -0.2, 0.03, 0.03, 0.22]] },
  pallet: { name: 'Pallet', len: 1.2, depth: 1.0, height: 1.0, collider: true, container: true, capacity: 10, profile: 'industrial', parts: [
    ...[-0.5, -0.25, 0, 0.25, 0.5].map((x) => ['wood', x, 0.13, 0, 0.18, 0.025, 1.0]), ...[-0.45, 0, 0.45].map((z) => ['wood_dark', 0, 0.06, z, 1.2, 0.1, 0.1]),
    ['canvas_tan', -0.28, 0.4, -0.2, 0.56, 0.5, 0.5], ['canvas_tan', 0.3, 0.38, -0.22, 0.52, 0.46, 0.48], ['wood_dark', -0.26, 0.36, 0.28, 0.5, 0.42, 0.36], ['corrugated_blue', 0.32, 0.34, 0.28, 0.44, 0.38, 0.36],
    ['canvas_tan', 0, 0.84, -0.1, 0.6, 0.36, 0.5], ['black', 0, 0.5, 0.0, 1.14, 0.03, 0.94], ['black', 0, 0.3, 0.0, 1.14, 0.03, 0.94], ['paint_white', -0.28, 0.42, 0.055, 0.2, 0.12, 0.004]] },
  hay: { name: 'Hay Bales', len: 2.0, depth: 1.0, height: 1.0, collider: true, parts: [
    ['hay', -0.5, 0.25, 0, 0.95, 0.5, 0.95], ['hay', 0.5, 0.25, 0, 0.95, 0.5, 0.95], ['hay', 0, 0.75, 0, 0.95, 0.5, 0.95],
    ...[[-0.5, 0.25], [0.5, 0.25], [0, 0.75]].flatMap(([x, y]) => [['wood_dark', x - 0.2, y, 0, 0.02, 0.51, 0.96], ['wood_dark', x + 0.2, y, 0, 0.02, 0.51, 0.96]]), ['hay', 0.7, 0.05, 0.55, 0.5, 0.06, 0.4]] },
  toolrack: { name: 'Tool Rack', len: 1.6, depth: 0.35, height: 1.8, collider: true, container: true, capacity: 8, profile: 'farm', parts: [
    ['wood_dark', 0, 1.0, 0, 1.6, 1.6, 0.05], ['wood', 0, 1.55, 0.05, 1.5, 0.05, 0.06], ['wood', 0, 0.95, 0.05, 1.5, 0.05, 0.06], ['wood', 0, 0.3, 0.12, 1.5, 0.04, 0.24],
    ['wood', -0.6, 0.95, 0.09, 0.04, 1.3, 0.04], ['metal', -0.6, 1.62, 0.09, 0.22, 0.2, 0.03], ['wood', -0.35, 1.0, 0.09, 0.04, 1.2, 0.04], ['metal', -0.35, 1.64, 0.09, 0.3, 0.06, 0.03],
    ['wood', -0.1, 1.1, 0.09, 0.04, 1.0, 0.04], ['metal_dark', -0.1, 1.64, 0.09, 0.16, 0.12, 0.05], ['metal', 0.2, 1.25, 0.08, 0.05, 0.5, 0.02], ['wood_dark', 0.2, 0.95, 0.08, 0.05, 0.14, 0.03],
    ['metal', 0.42, 1.3, 0.08, 0.3, 0.2, 0.01], ['wood', 0.42, 1.14, 0.08, 0.04, 0.16, 0.03], ['black', 0.65, 1.3, 0.1, 0.2, 0.2, 0.06], ['paint_red', 0.4, 0.42, 0.12, 0.3, 0.2, 0.2], ['metal_dark', -0.4, 0.4, 0.12, 0.26, 0.16, 0.2]] },
  cells: { name: 'Cell Bars', len: 3.0, depth: 0.1, height: 2.6, collider: true, phys: 'metal', parts: [
    ...Array.from({ length: 11 }, (_, i) => ['metal_dark', -1.5 + i * 0.3, 1.3, 0, 0.04, 2.6, 0.04, { seeThrough: true }]),
    ['metal_dark', 0, 0.1, 0, 3.0, 0.06, 0.06], ['metal_dark', 0, 1.3, 0, 3.0, 0.06, 0.06], ['metal_dark', 0, 2.55, 0, 3.0, 0.06, 0.06], ['metal', 0.9, 1.2, 0.04, 0.14, 0.2, 0.06]] },
  radio: { name: 'Radio Station', len: 1.4, depth: 0.7, height: 0.8, collider: true, parts: [
    ['wood', 0, 0.74, 0, 1.4, 0.05, 0.7], ...P_LEGS('metal_dark', 1.4, 0.7, 0.72, 0.05), ['metal_dark', 0, 0.3, -0.2, 1.3, 0.04, 0.04],
    ['olive', -0.25, 0.96, -0.05, 0.7, 0.38, 0.4], ['black', -0.42, 1.0, 0.152, 0.24, 0.16, 0.004], ['metal', -0.1, 1.04, 0.16, 0.05, 0.05, 0.02], ['metal', 0.0, 1.04, 0.16, 0.05, 0.05, 0.02], ['metal', -0.1, 0.9, 0.16, 0.04, 0.04, 0.02],
    ['paint_red', 0.02, 0.9, 0.156, 0.02, 0.02, 0.004], ['black', 0.38, 0.9, 0, 0.26, 0.26, 0.26], ['metal_dark', 0.38, 0.9, 0.132, 0.2, 0.2, 0.004], ['black', 0.3, 0.8, 0.22, 0.1, 0.04, 0.16], ['black', 0.55, 1.2, -0.2, 0.012, 0.9, 0.012],
    ['paint_white', -0.5, 0.775, 0.22, 0.2, 0.012, 0.16]] },
};

const R = (p, t, extra = {}) => ({ t, p, ...extra });
export const FURNITURE_PRESETS = {
  house: (spec, fl) => fl === 0 ? [R(1, 'counter', { side: 'N' }), R(0.8, 'fridge'), R(0.7, 'table', { where: 'centre' }), R(0.6, 'sofa'), R(0.6, 'cabinet'), R(0.5, 'wardrobe'), R(0.6, 'bed'), R(0.3, 'shelf', { profile: 'residential' })]
    : [R(1, 'bed'), R(0.8, 'wardrobe'), R(0.6, 'cabinet'), R(0.5, 'bed'), R(0.4, 'desk', { profile: 'residential' })],
  cabin: [R(1, 'bunk'), R(0.8, 'stove'), R(0.8, 'table', { where: 'centre' }), R(1, 'gunrack', { profile: 'hunting' }), R(0.7, 'shelf', { profile: 'hunting' }), R(0.5, 'cabinet', { profile: 'kitchen' })],
  ranger: (spec, fl) => fl === 0 ? [R(1, 'desk', { profile: 'office' }), R(1, 'gunrack', { profile: 'hunting' }), R(0.8, 'filing'), R(0.8, 'table', { where: 'centre' }), R(0.7, 'counter', { profile: 'kitchen' }), R(0.8, 'radio')]
    : [R(1, 'bunk'), R(1, 'locker', { profile: 'hunting' }), R(0.6, 'wardrobe')],
  barn: [R(1, 'hay'), R(1, 'hay'), R(0.8, 'hay'), R(1, 'toolrack'), R(0.8, 'workbench', { profile: 'farm' }), R(0.7, 'shelf', { profile: 'farm' }), R(0.6, 'barrel'), R(0.5, 'crate', { profile: 'farm' })],
  shed: [R(1, 'shelf', { profile: 'farm' }), R(0.6, 'toolrack'), R(0.4, 'barrel')],
  garage: [R(1, 'workbench', { profile: 'industrial' }), R(1, 'shelf', { profile: 'fuel' }), R(0.6, 'barrel'), R(0.6, 'toolrack', { profile: 'industrial' })],
  warehouse: [R(1, 'shelf', { profile: 'industrial' }), R(1, 'shelf', { profile: 'industrial' }), R(1, 'shelf'), R(0.8, 'shelf'), R(1, 'pallet', { where: 'centre' }), R(0.8, 'pallet', { where: 'centre', dz: 3 }), R(0.7, 'pallet', { where: 'centre', dz: -3 }), R(0.7, 'workbench'), R(0.6, 'barrel'), R(0.6, 'barrel'), R(0.5, 'crate')],
  workshop: [R(1, 'workbench'), R(1, 'workbench'), R(0.8, 'shelf', { profile: 'industrial' }), R(0.7, 'toolrack', { profile: 'industrial' }), R(0.6, 'barrel'), R(0.6, 'locker', { profile: 'industrial' })],
  barracks: [R(1, 'bunk'), R(1, 'bunk'), R(1, 'bunk'), R(0.9, 'bunk'), R(1, 'locker', { profile: 'military' }), R(1, 'locker', { profile: 'military' }), R(0.8, 'locker', { profile: 'military' }), R(0.7, 'table', { where: 'centre' }), R(0.6, 'ammobox', { profile: 'military' })],
  hq: (spec, fl) => fl === 0 ? [R(1, 'desk', { profile: 'office' }), R(1, 'desk', { profile: 'office' }), R(1, 'filing'), R(1, 'gunrack', { profile: 'military_high' }), R(0.8, 'locker', { profile: 'military' }), R(0.7, 'table', { where: 'centre' })]
    : [R(1, 'desk', { profile: spec.codebook ? 'codebook' : 'office' }), R(1, 'radio'), R(1, 'filing'), R(0.8, 'ammobox', { profile: 'military_high' }), R(0.7, 'locker', { profile: 'military' })],
  booth: [R(1, 'desk', { profile: 'military' }), R(0.6, 'ammobox', { profile: 'military' })],
  office: [R(1, 'desk'), R(0.8, 'desk'), R(1, 'filing'), R(0.7, 'filing'), R(0.6, 'shelf', { profile: 'office' }), R(0.5, 'table', { where: 'centre' })],
  medical: (spec, fl) => [R(1, 'medbed'), R(1, 'medbed'), R(0.9, 'medbed'), R(1, 'medcab'), R(1, 'medcab'), R(0.7, 'medcab'), R(0.7, 'desk', { profile: 'medical' }), R(0.6, 'cabinet', { profile: 'medical' }), R(fl === 0 ? 0.6 : 0.3, 'shelf', { profile: 'medical' })],
  police: (spec, fl) => fl === 0 ? [R(1, 'desk', { profile: 'police' }), R(1, 'desk', { profile: 'office' }), R(1, 'gunrack', { profile: 'police' }), R(1, 'locker', { profile: 'police' }), R(0.8, 'filing'), R(1, 'cells', { side: 'N' })]
    : [R(1, 'locker', { profile: 'police' }), R(1, 'locker', { profile: 'police' }), R(0.8, 'desk', { profile: 'police' }), R(0.8, 'table', { where: 'centre' }), R(0.6, 'shelf', { profile: 'police' })],
  shop: [R(1, 'shelf', { profile: 'kitchen' }), R(1, 'shelf', { profile: 'kitchen' }), R(1, 'shelf', { profile: 'residential' }), R(0.8, 'shelf', { profile: 'residential' }), R(1, 'counter', { profile: 'kitchen', side: 'S' }), R(0.7, 'fridge')],
  lab: [R(1, 'labbench'), R(1, 'labbench'), R(1, 'serverrack'), R(0.8, 'serverrack'), R(1, 'desk', { profile: 'research' }), R(0.8, 'filing', { profile: 'research' }), R(0.7, 'medcab', { profile: 'research' })],
  cellblock: [R(1, 'cells'), R(1, 'cells'), R(0.8, 'cot'), R(0.8, 'cot'), R(0.6, 'locker', { profile: 'police' }), R(0.4, 'cabinet', { profile: 'camp' })],
  shack: [R(1, 'cot'), R(1, 'crate', { profile: 'camp' }), R(0.7, 'barrel'), R(0.6, 'shelf', { profile: 'camp' })],
  control: [R(1, 'desk', { profile: 'office' }), R(1, 'serverrack', { profile: 'industrial' }), R(0.8, 'locker', { profile: 'industrial' }), R(0.8, 'workbench'), R(0.6, 'filing')],
  hall: [R(1, 'cot'), R(1, 'cot'), R(1, 'cot'), R(1, 'cot'), R(0.8, 'cot'), R(1, 'medcab'), R(1, 'crate', { profile: 'medical' }), R(1, 'crate', { profile: 'kitchen' }), R(0.8, 'table', { where: 'centre' }), R(0.6, 'shelf', { profile: 'medical' })],
};

export { Frame };
export const BUILDING_CONSTS = { WALL_T, DOOR_W, DOOR_H };
void THREE;
