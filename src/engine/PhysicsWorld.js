// Lightweight collision world: axis-aligned boxes and vertical cylinders stored
// in a uniform spatial hash, plus terrain height-field queries. Provides
// character movement resolution, line-of-sight checks and penetrating raycasts.

// Material table: penetration resistance per metre (higher = harder to shoot through).
export const MATERIALS = {
  concrete: { resist: 9.0, sound: 'concrete', decal: 'concrete' },
  brick: { resist: 7.0, sound: 'concrete', decal: 'concrete' },
  plaster: { resist: 2.4, sound: 'concrete', decal: 'concrete' },
  wood: { resist: 1.6, sound: 'wood', decal: 'wood' },
  metal: { resist: 6.0, sound: 'metal', decal: 'metal' },
  sheet: { resist: 2.0, sound: 'metal', decal: 'metal' }, // thin corrugated sheet
  glass: { resist: 0.15, sound: 'glass', decal: 'glass' },
  sand: { resist: 30, sound: 'dirt', decal: 'dirt' },
  rock: { resist: 40, sound: 'rock', decal: 'rock' },
  terrain: { resist: 100, sound: 'dirt', decal: 'dirt' },
  fabric: { resist: 0.3, sound: 'fabric', decal: 'wood' },
  flesh: { resist: 1.2, sound: 'flesh', decal: 'flesh' },
};

const CELL = 8;
const keyOf = (ix, iz) => (ix + 32768) * 65536 + (iz + 32768);

let _colliderId = 1;

/** Below this height you are inside an underground facility (see terrainHeight). */
export const UNDERGROUND_Y = -250;

export class PhysicsWorld {
  constructor(worldData) {
    this.world = worldData;
    this.cells = new Map();
    this.colliders = new Map();
    this.stamp = 1;
    this.ladders = new Set();
  }

  // ---------------------------------------------------------- registration
  /**
   * Add an AABB collider. opts: {material, owner, blocksMove=true, blocksShots=true,
   * blocksSight=true, tag}
   */
  addBox(minX, minY, minZ, maxX, maxY, maxZ, opts = {}) {
    const c = {
      id: _colliderId++, type: 'box', minX, minY, minZ, maxX, maxY, maxZ,
      material: opts.material || 'concrete', owner: opts.owner || null, tag: opts.tag || null,
      blocksMove: opts.blocksMove !== false, blocksShots: opts.blocksShots !== false,
      blocksSight: opts.blocksSight !== false, enabled: true, _stamp: 0, cells: [],
    };
    this._insert(c, minX, minZ, maxX, maxZ);
    return c;
  }

  addCylinder(x, z, r, y0, y1, opts = {}) {
    const c = {
      id: _colliderId++, type: 'cyl', x, z, r, minY: y0, maxY: y1,
      minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r,
      material: opts.material || 'wood', owner: opts.owner || null, tag: opts.tag || null,
      blocksMove: opts.blocksMove !== false, blocksShots: opts.blocksShots !== false,
      blocksSight: opts.blocksSight !== false, enabled: true, _stamp: 0, cells: [],
    };
    this._insert(c, c.minX, c.minZ, c.maxX, c.maxZ);
    return c;
  }

  addLadder(x, z, y0, y1, nx, nz, owner = null) {
    const l = { x, z, y0, y1, nx, nz, owner };
    this.ladders.add(l);
    return l;
  }

  removeLadder(l) {
    this.ladders.delete(l);
  }

  _insert(c, minX, minZ, maxX, maxZ) {
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = keyOf(ix, iz);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(c);
        c.cells.push(k);
      }
    }
    this.colliders.set(c.id, c);
  }

  remove(c) {
    if (!c || !this.colliders.has(c.id)) return;
    for (const k of c.cells) {
      const arr = this.cells.get(k);
      if (!arr) continue;
      const i = arr.indexOf(c);
      if (i >= 0) arr.splice(i, 1);
      if (!arr.length) this.cells.delete(k);
    }
    c.cells.length = 0;
    this.colliders.delete(c.id);
  }

  removeOwner(owner) {
    for (const c of [...this.colliders.values()]) if (c.owner === owner) this.remove(c);
    for (const l of [...this.ladders]) if (l.owner === owner) this.ladders.delete(l);
  }

  /** Collect colliders overlapping an XZ rectangle (deduplicated). */
  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const s = ++this.stamp;
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.cells.get(keyOf(ix, iz));
        if (!arr) continue;
        for (const c of arr) {
          if (c._stamp === s || !c.enabled) continue;
          c._stamp = s;
          if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
          out.push(c);
        }
      }
    }
    return out;
  }

  // ---------------------------------------------------------- terrain
  /**
   * Terrain surface height. Anything far below every hillside (y < UNDERGROUND_Y) is in an
   * underground facility, where the terrain does not exist and only colliders count.
   */
  terrainHeight(x, z, y) {
    if (y !== undefined && y < UNDERGROUND_Y) return -1e6;
    return this.world.heightAt(x, z);
  }

  /** Highest walkable surface under a circle at or below maxY (terrain or box tops). */
  groundHeight(x, z, radius, maxY, list) {
    let g = this.terrainHeight(x, z, maxY);
    const deck = this.world.bridgeAt ? this.world.bridgeAt(x, z) : null;
    if (deck !== null && deck <= maxY && deck > g) g = deck;
    const cs = list || this.query(x - radius, z - radius, x + radius, z + radius, this._tmpList || (this._tmpList = []));
    for (const c of cs) {
      if (!c.blocksMove) continue;
      if (c.maxY > maxY || c.maxY <= g) continue;
      if (c.type === 'box') {
        const cx = Math.max(c.minX, Math.min(x, c.maxX)), cz = Math.max(c.minZ, Math.min(z, c.maxZ));
        if ((cx - x) ** 2 + (cz - z) ** 2 <= radius * radius * 0.5) g = c.maxY;
      } else if ((c.x - x) ** 2 + (c.z - z) ** 2 <= (c.r + radius * 0.3) ** 2) {
        g = c.maxY;
      }
    }
    return g;
  }

  // ---------------------------------------------------------- character movement
  /**
   * Move a vertical cylinder (feet at pos.y) by (dx, dz), resolving against colliders.
   * Returns {x, z, stepY} where stepY is the highest step-up surface encountered.
   */
  moveCylinder(pos, dx, dz, radius, height, stepHeight = 0.45, ignoreOwner = null) {
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / (radius * 0.6)));
    let x = pos.x, z = pos.z;
    const sx = dx / steps, sz = dz / steps;
    const list = this._moveList || (this._moveList = []);
    let blocked = false;
    for (let s = 0; s < steps; s++) {
      x += sx; z += sz;
      for (let iter = 0; iter < 3; iter++) {
        this.query(x - radius - 0.1, z - radius - 0.1, x + radius + 0.1, z + radius + 0.1, list);
        let pushed = false;
        for (const c of list) {
          if (!c.blocksMove || (ignoreOwner && c.owner === ignoreOwner)) continue;
          if (c.maxY <= pos.y + stepHeight || c.minY >= pos.y + height) continue;
          if (c.type === 'box') {
            const cx = Math.max(c.minX, Math.min(x, c.maxX)), cz = Math.max(c.minZ, Math.min(z, c.maxZ));
            let ddx = x - cx, ddz = z - cz;
            const d2 = ddx * ddx + ddz * ddz;
            if (d2 >= radius * radius) continue;
            if (d2 < 1e-8) {
              // centre inside box: push out along smallest axis
              const pl = x - c.minX, pr = c.maxX - x, pn = z - c.minZ, pf = c.maxZ - z;
              const m = Math.min(pl, pr, pn, pf);
              if (m === pl) x = c.minX - radius; else if (m === pr) x = c.maxX + radius;
              else if (m === pn) z = c.minZ - radius; else z = c.maxZ + radius;
            } else {
              const d = Math.sqrt(d2);
              x = cx + (ddx / d) * radius;
              z = cz + (ddz / d) * radius;
            }
            pushed = true; blocked = true;
          } else {
            const ddx = x - c.x, ddz = z - c.z;
            const d = Math.hypot(ddx, ddz);
            const R = radius + c.r;
            if (d >= R) continue;
            if (d < 1e-6) { x = c.x + R; } else { x = c.x + (ddx / d) * R; z = c.z + (ddz / d) * R; }
            pushed = true; blocked = true;
          }
        }
        if (!pushed) break;
      }
    }
    return { x, z, blocked };
  }

  /** True if a vertical cylinder at (x, y..y+h, z) overlaps any blocking collider. */
  overlapsCylinder(x, y, z, radius, height, ignoreOwner = null) {
    const list = this.query(x - radius, z - radius, x + radius, z + radius, this._ovList || (this._ovList = []));
    for (const c of list) {
      if (!c.blocksMove || (ignoreOwner && c.owner === ignoreOwner)) continue;
      if (c.maxY <= y || c.minY >= y + height) continue;
      if (c.type === 'box') {
        const cx = Math.max(c.minX, Math.min(x, c.maxX)), cz = Math.max(c.minZ, Math.min(z, c.maxZ));
        if ((cx - x) ** 2 + (cz - z) ** 2 < radius * radius) return c;
      } else if (Math.hypot(x - c.x, z - c.z) < radius + c.r) return c;
    }
    return null;
  }

  /** Lowest box bottom above y within the circle (ceiling). */
  ceilingHeight(x, z, radius, y) {
    let ceil = Infinity;
    const list = this.query(x - radius, z - radius, x + radius, z + radius, this._ceilList || (this._ceilList = []));
    for (const c of list) {
      if (!c.blocksMove || c.type !== 'box') continue;
      if (c.minY < y - 0.01) continue;
      const cx = Math.max(c.minX, Math.min(x, c.maxX)), cz = Math.max(c.minZ, Math.min(z, c.maxZ));
      if ((cx - x) ** 2 + (cz - z) ** 2 < radius * radius * 0.5 && c.minY < ceil) ceil = c.minY;
    }
    return ceil;
  }

  findLadder(x, y, z, radius = 0.7) {
    for (const l of this.ladders) {
      if (Math.hypot(l.x - x, l.z - z) < radius && y >= l.y0 - 0.3 && y <= l.y1 + 0.2) return l;
    }
    return null;
  }

  // ---------------------------------------------------------- raycasting
  /**
   * Ray vs terrain. Returns distance or Infinity. Marches in 1.5 m steps, then bisects.
   */
  raycastTerrain(ox, oy, oz, dx, dy, dz, maxDist) {
    if (oy < UNDERGROUND_Y && oy + dy * maxDist < UNDERGROUND_Y) return Infinity; // underground: no terrain
    const step = 1.5;
    let prevT = 0;
    let prevAbove = oy - this.terrainHeight(ox, oz);
    if (prevAbove < 0) return 0;
    for (let t = step; t <= maxDist + step; t += step) {
      const tt = Math.min(t, maxDist);
      const x = ox + dx * tt, y = oy + dy * tt, z = oz + dz * tt;
      const above = y - this.terrainHeight(x, z);
      if (above < 0) {
        let lo = prevT, hi = tt;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) * 0.5;
          const a = oy + dy * mid - this.terrainHeight(ox + dx * mid, oz + dz * mid);
          if (a < 0) hi = mid; else lo = mid;
        }
        return hi;
      }
      prevT = tt; prevAbove = above;
      if (tt >= maxDist) break;
      // larger steps when far above the ground
      if (above > 30) t += step * 2;
    }
    return Infinity;
  }

  /** Slab test of a ray against a box; returns [tEnter, tExit] or null. */
  static rayBox(ox, oy, oz, dx, dy, dz, c, maxDist) {
    let tmin = 0, tmax = maxDist;
    const inv = (d) => (Math.abs(d) < 1e-9 ? 1e9 : 1 / d);
    const ix = inv(dx), iy = inv(dy), iz = inv(dz);
    let t1 = (c.minX - ox) * ix, t2 = (c.maxX - ox) * ix;
    tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
    t1 = (c.minY - oy) * iy; t2 = (c.maxY - oy) * iy;
    tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
    t1 = (c.minZ - oz) * iz; t2 = (c.maxZ - oz) * iz;
    tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmax < tmin) return null;
    return [tmin, tmax];
  }

  static rayCyl(ox, oy, oz, dx, dy, dz, c, maxDist) {
    const fx = ox - c.x, fz = oz - c.z;
    const a = dx * dx + dz * dz;
    if (a < 1e-9) return null;
    const b = 2 * (fx * dx + fz * dz);
    const cc = fx * fx + fz * fz - c.r * c.r;
    const disc = b * b - 4 * a * cc;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    let t0 = (-b - sq) / (2 * a), t1 = (-b + sq) / (2 * a);
    if (t1 < 0 || t0 > maxDist) return null;
    t0 = Math.max(t0, 0);
    const y0 = oy + dy * t0;
    if (y0 < c.minY || y0 > c.maxY) {
      const y1 = oy + dy * t1;
      if ((y0 < c.minY && y1 < c.minY) || (y0 > c.maxY && y1 > c.maxY)) return null;
    }
    return [t0, Math.min(t1, maxDist)];
  }

  /**
   * Walk the spatial grid along the ray and call visit(collider, tEnter, tExit) for each
   * collider hit, in approximate order. Stops early if visit returns true.
   */
  _traverse(ox, oy, oz, dx, dy, dz, maxDist, visit) {
    const s = ++this.stamp;
    const hd = Math.hypot(dx, dz);
    let ix = Math.floor(ox / CELL), iz = Math.floor(oz / CELL);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dx) > 1e-9 ? CELL / Math.abs(dx) : Infinity;
    const tDeltaZ = Math.abs(dz) > 1e-9 ? CELL / Math.abs(dz) : Infinity;
    let tMaxX = Math.abs(dx) > 1e-9 ? ((dx > 0 ? (ix + 1) * CELL - ox : ox - ix * CELL) / Math.abs(dx)) : Infinity;
    let tMaxZ = Math.abs(dz) > 1e-9 ? ((dz > 0 ? (iz + 1) * CELL - oz : oz - iz * CELL) / Math.abs(dz)) : Infinity;
    let t = 0;
    const maxCells = hd < 1e-6 ? 1 : Math.ceil((maxDist * hd) / CELL) * 2 + 4;
    for (let n = 0; n < maxCells && t <= maxDist; n++) {
      const arr = this.cells.get(keyOf(ix, iz));
      if (arr) {
        for (const c of arr) {
          if (c._stamp === s || !c.enabled) continue;
          c._stamp = s;
          const r = c.type === 'box' ? PhysicsWorld.rayBox(ox, oy, oz, dx, dy, dz, c, maxDist) : PhysicsWorld.rayCyl(ox, oy, oz, dx, dy, dz, c, maxDist);
          if (r && visit(c, r[0], r[1])) return;
        }
      }
      if (hd < 1e-6) break;
      if (tMaxX < tMaxZ) { t = tMaxX; tMaxX += tDeltaX; ix += stepX; } else { t = tMaxZ; tMaxZ += tDeltaZ; iz += stepZ; }
    }
  }

  /**
   * Closest hit along ray. filter(c) -> boolean decides which colliders count.
   * Returns {t, collider|null (terrain), material} or null.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, filter = null, includeTerrain = true) {
    let best = maxDist, bestC = null;
    this._traverse(ox, oy, oz, dx, dy, dz, maxDist, (c, t0) => {
      if (filter && !filter(c)) return false;
      if (t0 < best) { best = t0; bestC = c; }
      return false;
    });
    let terrainT = Infinity;
    if (includeTerrain) terrainT = this.raycastTerrain(ox, oy, oz, dx, dy, dz, best);
    if (terrainT < best) return { t: terrainT, collider: null, material: 'terrain' };
    if (bestC) return { t: best, collider: bestC, material: bestC.material };
    return null;
  }

  /** All collider intersections sorted by entry distance, truncated at terrain. */
  raycastAll(ox, oy, oz, dx, dy, dz, maxDist, filter = null) {
    const hits = [];
    this._traverse(ox, oy, oz, dx, dy, dz, maxDist, (c, t0, t1) => {
      if (filter && !filter(c)) return false;
      hits.push({ t: t0, tExit: t1, collider: c, material: c.material });
      return false;
    });
    hits.sort((a, b) => a.t - b.t);
    const far = hits.length ? Math.min(maxDist, hits[hits.length - 1].tExit + 1) : maxDist;
    const terrainT = this.raycastTerrain(ox, oy, oz, dx, dy, dz, maxDist);
    const out = [];
    for (const h of hits) if (h.t < terrainT) out.push(h);
    if (terrainT < Infinity) out.push({ t: terrainT, tExit: terrainT, collider: null, material: 'terrain' });
    void far;
    return out;
  }

  /** Line of sight between two points; sight passes through glass and non-sight blockers. */
  lineOfSight(ax, ay, az, bx, by, bz, ignoreOwner = null) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const ux = dx / d, uy = dy / d, uz = dz / d;
    const hit = this.raycast(ax, ay, az, ux, uy, uz, d - 0.05,
      (c) => c.blocksSight && c.material !== 'glass' && c.owner !== ignoreOwner && c.tag !== 'character');
    if (hit) return false;
    // smoke clouds: a long enough path through one hides what is behind it
    if (this.smokes?.length) {
      for (const s of this.smokes) {
        const ox = s.x - ax, oy = s.y - ay, oz = s.z - az;
        const t = Math.max(0, Math.min(d, ox * ux + oy * uy + oz * uz));
        const cx = ax + ux * t - s.x, cy = ay + uy * t - s.y, cz = az + uz * t - s.z;
        const m2 = cx * cx + cy * cy * 1.6 + cz * cz, r2 = s.r * s.r;
        if (m2 < r2 && Math.sqrt(r2 - m2) * 2 > Math.min(3, s.r * 0.6)) return false;
      }
    }
    return true;
  }

  /** Line of fire: like sight but glass counts as transparent and bullets pass foliage. */
  lineOfFire(ax, ay, az, bx, by, bz, ignoreOwner = null) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const hit = this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.1,
      (c) => c.blocksShots && c.material !== 'glass' && c.owner !== ignoreOwner);
    return !hit;
  }
}
