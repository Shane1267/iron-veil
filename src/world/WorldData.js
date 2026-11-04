import locations from '../data/locations.json';
import { SimplexNoise, clamp, lerp, smoothstep, pointSegDist, hash2 } from '../core/MathUtil.js';

// Deterministic description of the whole 16 km VESPER map: region blending,
// height field, water, road network and POI placement. Pure math (no Three.js),
// so it is shared by rendering, collision, AI and unit tests.

export const WORLD_SIZE = locations.worldSize;
export const HALF_WORLD = WORLD_SIZE / 2;
export const GRID_STEP = 2; // terrain sample spacing (m) used by collision and LOD0 mesh

const ROAD_WIDTH = { highway: 5.2, road: 4.2, dirt: 2.8, rail: 2.6 };

class SegmentIndex {
  constructor(cell = 128) {
    this.cell = cell;
    this.map = new Map();
  }
  key(ix, iz) { return (ix + 1000) * 4096 + (iz + 1000); }
  add(seg, pad) {
    const minX = Math.min(seg.ax, seg.bx) - pad, maxX = Math.max(seg.ax, seg.bx) + pad;
    const minZ = Math.min(seg.az, seg.bz) - pad, maxZ = Math.max(seg.az, seg.bz) + pad;
    for (let ix = Math.floor(minX / this.cell); ix <= Math.floor(maxX / this.cell); ix++) {
      for (let iz = Math.floor(minZ / this.cell); iz <= Math.floor(maxZ / this.cell); iz++) {
        const k = this.key(ix, iz);
        let arr = this.map.get(k);
        if (!arr) this.map.set(k, (arr = []));
        arr.push(seg);
      }
    }
  }
  query(x, z) {
    return this.map.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) || EMPTY;
  }
}
const EMPTY = [];

export class WorldData {
  constructor(data = locations) {
    this.data = data;
    this.seed = data.seed;
    this.noise = new SimplexNoise(this.seed);
    this.noise2 = new SimplexNoise(this.seed + 7);
    this.regions = data.regions;
    this.lake = data.lake;
    this.pois = data.pois.map((p) => ({ ...p, x: p.pos[0], z: p.pos[1] }));
    this.poiById = new Map(this.pois.map((p) => [p.id, p]));
    this.regionById = new Map(this.regions.map((r) => [r.id, r]));
    this._regionCache = new Map();
    this._heightCache = new Map();
    this._heightCacheOrder = [];

    // POI pad heights (after macro terrain and hills)
    for (const p of this.pois) p.padHeight = this.preFlatten(p.x, p.z);

    this.rivers = [];
    this.riverIndex = new SegmentIndex(128);
    this._buildRivers(data.rivers);

    this.roads = [];
    this.roadIndex = new SegmentIndex(128);
    for (const r of data.roads) this._buildRoad(r.id, r.type, r.points);
    for (const r of data.rails) this._buildRoad(r.id, 'rail', r.points);

    this.bridges = [];
    this._findBridges();
  }

  // ------------------------------------------------------------- regions
  _regionBlendRaw(x, z) {
    const out = { hills: 0, mountain: 0, rough: 0, forest: 0, pine: 0, dry: 0, fields: 0, marsh: 0, primary: null };
    let total = 0, best = -1;
    const sigma2 = 2 * 2100 * 2100;
    for (const r of this.regions) {
      const dx = x - r.center[0], dz = z - r.center[1];
      const w = Math.exp(-(dx * dx + dz * dz) / sigma2) + 1e-9;
      total += w;
      out.hills += w * r.hills; out.mountain += w * r.mountain; out.rough += w * r.rough;
      out.forest += w * r.forest; out.pine += w * r.pine; out.dry += w * r.dry;
      out.fields += w * r.fields; out.marsh += w * (r.marsh || 0);
      if (w > best) { best = w; out.primary = r; }
    }
    for (const k of ['hills', 'mountain', 'rough', 'forest', 'pine', 'dry', 'fields', 'marsh']) out[k] /= total;
    return out;
  }

  /** Region parameter blend, bilinearly interpolated from a 128 m lattice. */
  regionBlend(x, z) {
    const C = 128;
    const gx = x / C, gz = z / C;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const a = this._regionAtLattice(ix, iz), b = this._regionAtLattice(ix + 1, iz);
    const c = this._regionAtLattice(ix, iz + 1), d = this._regionAtLattice(ix + 1, iz + 1);
    const out = { primary: (fx < 0.5 ? (fz < 0.5 ? a : c) : (fz < 0.5 ? b : d)).primary };
    for (const k of ['hills', 'mountain', 'rough', 'forest', 'pine', 'dry', 'fields', 'marsh']) {
      out[k] = lerp(lerp(a[k], b[k], fx), lerp(c[k], d[k], fx), fz);
    }
    return out;
  }

  _regionAtLattice(ix, iz) {
    const k = (ix + 1000) * 4096 + (iz + 1000);
    let v = this._regionCache.get(k);
    if (!v) {
      v = this._regionBlendRaw(ix * 128, iz * 128);
      this._regionCache.set(k, v);
    }
    return v;
  }

  regionAt(x, z) {
    return this.regionBlend(x, z).primary;
  }

  // ------------------------------------------------------------- height
  macro(x, z) {
    const n = this.noise;
    const p = this.regionBlend(x, z);
    let h = 34 + n.fbm(x / 3200, z / 3200, 3) * 38;
    h += n.fbm(x / 760 + 13.1, z / 760 - 7.7, 4) * p.hills;
    h += this.noise2.fbm(x / 150, z / 150, 3) * 3.2 * p.rough;
    if (p.mountain > 0.02) {
      const r = n.ridged(x / 1500 + 3.3, z / 1500 + 1.1, 4);
      h += p.mountain * Math.pow(r, 1.7) * 330;
    }
    // world border mountains
    const e = Math.max(Math.abs(x), Math.abs(z));
    if (e > HALF_WORLD - 900) {
      const t = (e - (HALF_WORLD - 900)) / 900;
      h += t * t * 260;
    }
    return h;
  }

  /** Height before POI flattening, rivers and roads: macro + POI hills + lake basin. */
  preFlatten(x, z) {
    let h = this.macro(x, z);
    for (const p of this.pois) {
      if (!p.hill) continue;
      const dx = x - p.x, dz = z - p.z;
      const s = p.radius * 2.2;
      const d2 = dx * dx + dz * dz;
      if (d2 < s * s * 9) h += p.hill * Math.exp(-d2 / (2 * s * s));
    }
    const L = this.lake;
    const dx = (x - L.center[0]) / L.radius[0], dz = (z - L.center[1]) / L.radius[1];
    const r = Math.hypot(dx, dz);
    if (r < 1.7) {
      const bed = L.level + (r - 1) * 16;
      const s = smoothstep(1.7, 1.0, r);
      h = lerp(h, bed, s);
      if (r < 1) h = Math.min(h, bed);
    }
    return h;
  }

  /** Height after POI pads (used for road profile smoothing). */
  padded(x, z) {
    let h = this.preFlatten(x, z);
    for (const p of this.pois) {
      const dx = x - p.x, dz = z - p.z;
      const R = p.radius * 1.3;
      if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
      const d = Math.hypot(dx, dz);
      const w = smoothstep(p.radius * 1.3, p.radius * 0.9, d);
      if (w > 0) h = lerp(h, p.padHeight, w);
    }
    return h;
  }

  /** Final terrain height at an arbitrary point (analytic, not grid-interpolated). */
  heightRaw(x, z) {
    let h = this.padded(x, z);
    // rivers carve channels
    const riv = this.riverQuery(x, z);
    let riverW = 0;
    if (riv) {
      const half = riv.width * 0.5;
      const d = riv.d;
      let carved;
      if (d < half) {
        const q = d / half;
        carved = riv.water - riv.depth * (1 - q * q * 0.75);
      } else {
        carved = riv.water - riv.depth * 0.25 + (d - half) * 0.42;
      }
      if (carved < h) {
        const blend = smoothstep(half + 60, half + 6, d);
        h = lerp(h, Math.min(h, carved), Math.max(blend, d < half + 6 ? 1 : 0));
      }
      riverW = smoothstep(half + 10, half, d);
    }
    // roads flatten (bridges skip the river corridor)
    const road = this.roadQuery(x, z);
    if (road && !(riv && riv.d < riv.width * 0.5 + 14)) {
      const hw = road.width * 0.5;
      const w = smoothstep(hw + 7, hw + 0.6, road.d);
      if (w > 0) h = lerp(h, road.h - 0.05, w * (1 - riverW));
    }
    return h;
  }

  /** Grid-consistent terrain height (matches the rendered LOD0 mesh and collision). */
  heightAt(x, z) {
    const S = GRID_STEP;
    const gx = x / S, gz = z / S;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const a = this.gridHeight(ix, iz);
    const b = this.gridHeight(ix + 1, iz);
    const c = this.gridHeight(ix, iz + 1);
    if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
    const d = this.gridHeight(ix + 1, iz + 1);
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  /** Cached height at integer grid coordinates (tiles of 32x32 samples). */
  gridHeight(ix, iz) {
    const T = 32;
    const tx = Math.floor(ix / T), tz = Math.floor(iz / T);
    const key = (tx + 2048) * 8192 + (tz + 2048);
    let tile = this._heightCache.get(key);
    if (!tile) {
      tile = new Float32Array(T * T).fill(NaN);
      this._heightCache.set(key, tile);
      this._heightCacheOrder.push(key);
      if (this._heightCacheOrder.length > 900) {
        const old = this._heightCacheOrder.shift();
        this._heightCache.delete(old);
      }
    }
    const lx = ix - tx * T, lz = iz - tz * T;
    const i = lz * T + lx;
    let h = tile[i];
    if (Number.isNaN(h)) {
      h = this.heightRaw(ix * GRID_STEP, iz * GRID_STEP);
      tile[i] = h;
    }
    return h;
  }

  normalAt(x, z, out = { x: 0, y: 1, z: 0 }) {
    const e = 1.0;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const len = Math.hypot(hx, 2 * e, hz);
    out.x = -hx / len; out.y = (2 * e) / len; out.z = -hz / len;
    return out;
  }

  // ------------------------------------------------------------- rivers
  _buildRivers(list) {
    for (const r of list) {
      const pts = this._resample(r.points, 24, hashString32(r.id), 0);
      // water level: smoothed pre-flatten height minus offset, forced monotonic downstream
      const raw = pts.map(([x, z]) => this.padded(x, z));
      const smooth = smoothArray(raw, 6);
      const water = new Float32Array(pts.length);
      let prev = Infinity;
      for (let i = 0; i < pts.length; i++) {
        let w = smooth[i] - 3.0;
        // keep river at or above lake level where it meets the lake
        w = Math.max(w, this.lake.level + 0.2);
        if (w > prev - 0.02) w = prev - 0.02;
        water[i] = w;
        prev = w;
      }
      const river = { id: r.id, name: r.name, width: r.width, depth: r.depth, points: pts, water };
      this.rivers.push(river);
      for (let i = 0; i < pts.length - 1; i++) {
        const seg = { river, i, ax: pts[i][0], az: pts[i][1], bx: pts[i + 1][0], bz: pts[i + 1][1] };
        this.riverIndex.add(seg, r.width + 70);
      }
    }
  }

  riverQuery(x, z) {
    const segs = this.riverIndex.query(x, z);
    let best = null;
    for (const s of segs) {
      const r = pointSegDist(x, z, s.ax, s.az, s.bx, s.bz);
      if (!best || r.d < best.d) best = { d: r.d, t: r.t, seg: s };
    }
    if (!best || best.d > best.seg.river.width + 70) return null;
    const R = best.seg.river;
    const water = lerp(R.water[best.seg.i], R.water[best.seg.i + 1], best.t);
    return { d: best.d, water, width: R.width, depth: R.depth, river: R };
  }

  /** Water surface height if (x,z) is over water, else null. */
  waterAt(x, z) {
    const L = this.lake;
    const dx = (x - L.center[0]) / L.radius[0], dz = (z - L.center[1]) / L.radius[1];
    if (dx * dx + dz * dz < 1.6 * 1.6 && this.heightAt(x, z) < L.level) return L.level;
    const r = this.riverQuery(x, z);
    if (r && r.d < r.width * 0.5 + 4 && this.heightAt(x, z) < r.water) return r.water;
    return null;
  }

  // ------------------------------------------------------------- roads
  _resample(points, step, seed, wiggle) {
    const out = [];
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, az] = points[i], [bx, bz] = points[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / step));
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      for (let k = 0; k < n; k++) {
        const t = k / n;
        // gentle meander, zero at control points
        const m = wiggle ? Math.sin(t * Math.PI) * this.noise2.noise2D(ax * 0.01 + t * 2.3, seed * 0.001) * wiggle : 0;
        out.push([lerp(ax, bx, t) + nx * m, lerp(az, bz, t) + nz * m]);
      }
    }
    out.push([...points[points.length - 1]]);
    return out;
  }

  _buildRoad(id, type, points) {
    const pts = this._resample(points, 12, hashString32(id), type === 'rail' ? 0 : type === 'dirt' ? 26 : 14);
    const raw = pts.map(([x, z]) => this.padded(x, z));
    const heights = smoothArray(raw, type === 'rail' ? 9 : 4);
    const road = { id, type, width: ROAD_WIDTH[type], points: pts, heights };
    this.roads.push(road);
    for (let i = 0; i < pts.length - 1; i++) {
      const seg = { road, i, ax: pts[i][0], az: pts[i][1], bx: pts[i + 1][0], bz: pts[i + 1][1] };
      this.roadIndex.add(seg, road.width + 12);
    }
  }

  roadQuery(x, z) {
    const segs = this.roadIndex.query(x, z);
    let best = null;
    for (const s of segs) {
      const r = pointSegDist(x, z, s.ax, s.az, s.bx, s.bz);
      if (!best || r.d - s.road.width * 0.5 < best.d - best.seg.road.width * 0.5) best = { d: r.d, t: r.t, seg: s };
    }
    if (!best || best.d > best.seg.road.width * 0.5 + 12) return null;
    const R = best.seg.road;
    const h = lerp(R.heights[best.seg.i], R.heights[best.seg.i + 1], best.t);
    return { d: best.d, h, width: R.width, type: R.type, road: R, seg: best.seg, t: best.t };
  }

  _findBridges() {
    for (const road of this.roads) {
      let inBridge = null;
      for (let i = 0; i < road.points.length; i++) {
        const [x, z] = road.points[i];
        const r = this.riverQuery(x, z);
        const crossing = r && r.d < r.width * 0.5 + 14;
        if (crossing && !inBridge) inBridge = { road, start: Math.max(0, i - 1), river: r };
        if (!crossing && inBridge) {
          inBridge.end = Math.min(road.points.length - 1, i);
          this._finishBridge(inBridge);
          inBridge = null;
        }
      }
      if (inBridge) { inBridge.end = road.points.length - 1; this._finishBridge(inBridge); }
    }
  }

  _finishBridge(b) {
    const { road, start, end } = b;
    const [ax, az] = road.points[start], [bx, bz] = road.points[end];
    const deck = Math.max(road.heights[start], road.heights[end], b.river.water + 3.2);
    this.bridges.push({ road, ax, az, bx, bz, deck, width: road.width + 1.2, type: road.type });
  }

  /** Conservative test: could any water surface exist inside this rectangle? */
  hasWaterIn(minX, minZ, maxX, maxZ) {
    const C = this.riverIndex.cell;
    for (let ix = Math.floor(minX / C); ix <= Math.floor(maxX / C); ix++) {
      for (let iz = Math.floor(minZ / C); iz <= Math.floor(maxZ / C); iz++) {
        if ((this.riverIndex.map.get(this.riverIndex.key(ix, iz)) || []).length) return true;
      }
    }
    const L = this.lake;
    const cx = Math.max(minX, Math.min(L.center[0], maxX)), cz = Math.max(minZ, Math.min(L.center[1], maxZ));
    const dx = (cx - L.center[0]) / L.radius[0], dz = (cz - L.center[1]) / L.radius[1];
    return dx * dx + dz * dz < 1.8 * 1.8;
  }

  /** Deck height if (x,z) lies on a bridge deck, else null. */
  bridgeAt(x, z) {
    for (const b of this.bridges) {
      if (x < Math.min(b.ax, b.bx) - b.width || x > Math.max(b.ax, b.bx) + b.width) continue;
      if (z < Math.min(b.az, b.bz) - b.width || z > Math.max(b.az, b.bz) + b.width) continue;
      const r = pointSegDist(x, z, b.ax, b.az, b.bx, b.bz);
      if (r.d < b.width * 0.5 && r.t > 0.0 && r.t < 1.0) return b.deck;
    }
    return null;
  }

  /** Surface classification for footsteps, impacts and AI cover. */
  surfaceAt(x, z) {
    if (this.waterAt(x, z) !== null) return 'water';
    const road = this.roadQuery(x, z);
    if (road && road.d < road.width * 0.5) return road.type === 'dirt' ? 'dirt' : road.type === 'rail' ? 'gravel' : 'asphalt';
    const n = this.normalAt(x, z);
    if (n.y < 0.78) return 'rock';
    const p = this.regionBlend(x, z);
    if (p.dry > 0.6) return 'dirt';
    return 'grass';
  }

  /** Farmland parcels: returns 0 (none), 1 wheat, 2 plowed, 3 meadow. */
  fieldAt(x, z, fieldsWeight) {
    if (fieldsWeight < 0.08) return 0;
    const C = 140;
    const ix = Math.floor(x / C), iz = Math.floor(z / C);
    const hv = hash2(ix, iz, 991);
    if (hv > fieldsWeight * 1.1) return 0;
    const fx = x / C - ix, fz = z / C - iz;
    if (fx < 0.04 || fz < 0.04) return 0; // hedgerow gap
    return 1 + Math.floor(hash2(ix, iz, 77) * 3);
  }

  nearestPOI(x, z) {
    let best = null, bd = Infinity;
    for (const p of this.pois) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < bd) { bd = d; best = p; }
    }
    return { poi: best, d: bd };
  }

  /** True if the point lies inside any POI pad or road corridor (vegetation exclusion). */
  isDeveloped(x, z, margin = 0) {
    for (const p of this.pois) {
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz < (p.radius + margin) * (p.radius + margin)) return true;
    }
    const r = this.roadQuery(x, z);
    if (r && r.d < r.width * 0.5 + 3 + margin) return true;
    return false;
  }
}

function smoothArray(arr, radius) {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let s = 0, n = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = clamp(i + k, 0, arr.length - 1);
      const w = 1 - Math.abs(k) / (radius + 1);
      s += arr[j] * w; n += w;
    }
    out[i] = s / n;
  }
  return out;
}

function hashString32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

let _instance = null;
export function getWorldData() {
  if (!_instance) _instance = new WorldData();
  return _instance;
}
