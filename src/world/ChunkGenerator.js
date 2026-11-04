import { hash2, clamp, smoothstep, lerp } from '../core/MathUtil.js';

// Pure terrain/vegetation chunk builder. Runs inside TerrainWorker (preferred) or on
// the main thread as a fallback. Produces typed arrays ready for BufferGeometry.

export const VEG_TYPES = ['pineA', 'pineB', 'broadleaf', 'birch', 'dead', 'bush', 'rockS', 'rockL', 'log', 'fern', 'hay'];

/**
 * params: {x0, z0, size, segs, veg (bool), grass (bool), vegDensity, holes: [minX,minZ,maxX,maxZ] | null, far(bool)}
 */
export function generateChunk(world, params) {
  const { x0, z0, size, segs } = params;
  const step = size / segs;
  const useGrid = Math.abs(step - 2) < 1e-6;
  const n = segs + 1;
  const ext = n + 2; // with border ring for normals
  const hb = new Float32Array(ext * ext);
  for (let j = 0; j < ext; j++) {
    for (let i = 0; i < ext; i++) {
      const x = x0 + (i - 1) * step, z = z0 + (j - 1) * step;
      hb[j * ext + i] = useGrid ? world.gridHeight(Math.round(x / 2), Math.round(z / 2)) : world.heightRaw(x, z);
    }
  }
  const vcount = n * n + 4 * n; // + skirt
  const pos = new Float32Array(vcount * 3);
  const nor = new Float32Array(vcount * 3);
  const col = new Float32Array(vcount * 3);
  const spl = new Float32Array(vcount * 4);
  const uv = new Float32Array(vcount * 2);

  const tint = { r: 1, g: 1, b: 1, dirt: 0, sand: 0, wheat: 0, plowed: 0 };
  let vi = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      const h = hb[(j + 1) * ext + (i + 1)];
      const hl = hb[(j + 1) * ext + i], hr = hb[(j + 1) * ext + i + 2];
      const hd = hb[j * ext + i + 1], hu = hb[(j + 2) * ext + i + 1];
      let nx = hl - hr, ny = 2 * step, nz = hd - hu;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      pos[vi * 3] = x - x0; pos[vi * 3 + 1] = h; pos[vi * 3 + 2] = z - z0;
      nor[vi * 3] = nx; nor[vi * 3 + 1] = ny; nor[vi * 3 + 2] = nz;
      surfaceTint(world, x, z, h, ny, tint, params.far);
      col[vi * 3] = tint.r; col[vi * 3 + 1] = tint.g; col[vi * 3 + 2] = tint.b;
      spl[vi * 4] = tint.dirt; spl[vi * 4 + 1] = tint.sand; spl[vi * 4 + 2] = tint.wheat; spl[vi * 4 + 3] = tint.plowed;
      uv[vi * 2] = x / 4; uv[vi * 2 + 1] = z / 4;
      vi++;
    }
  }
  // skirt vertices: copies of the border lowered by a few metres
  const skirtDrop = Math.max(3, step * 1.5);
  const border = [];
  for (let i = 0; i < n; i++) border.push(i); // z = z0 edge (j=0)
  for (let j = 0; j < n; j++) border.push(j * n + (n - 1));
  for (let i = n - 1; i >= 0; i--) border.push((n - 1) * n + i);
  for (let j = n - 1; j >= 0; j--) border.push(j * n);
  // we only need 4n skirt verts; border has 4n entries
  for (let k = 0; k < 4 * n; k++) {
    const src = border[k];
    pos[vi * 3] = pos[src * 3]; pos[vi * 3 + 1] = pos[src * 3 + 1] - skirtDrop; pos[vi * 3 + 2] = pos[src * 3 + 2];
    nor[vi * 3] = nor[src * 3]; nor[vi * 3 + 1] = nor[src * 3 + 1]; nor[vi * 3 + 2] = nor[src * 3 + 2];
    col[vi * 3] = col[src * 3]; col[vi * 3 + 1] = col[src * 3 + 1]; col[vi * 3 + 2] = col[src * 3 + 2];
    for (let c = 0; c < 4; c++) spl[vi * 4 + c] = spl[src * 4 + c];
    uv[vi * 2] = uv[src * 2]; uv[vi * 2 + 1] = uv[src * 2 + 1];
    vi++;
  }

  // indices (with optional hole for far tiles overlapped by near terrain)
  const idx = [];
  const holes = params.holes;
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      if (holes) {
        const cx = x0 + (i + 0.5) * step, cz = z0 + (j + 0.5) * step;
        if (cx > holes[0] && cx < holes[2] && cz > holes[1] && cz < holes[3]) continue;
      }
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, c, d, b);
    }
  }
  const sk0 = n * n;
  for (let k = 0; k < 4 * n - 1; k++) {
    const a = border[k], b = border[k + 1];
    const sa = sk0 + k, sb = sk0 + k + 1;
    if (a === b) continue;
    idx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
  }
  const index = vcount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);

  const out = { pos, nor, col, spl, uv, index };
  if (params.veg) out.veg = scatterVegetation(world, x0, z0, size, params.vegDensity ?? 1, hb, ext, step);
  if (params.farVeg) out.farVeg = scatterFarTrees(world, x0, z0, size, params.vegDensity ?? 1, holes);
  if (params.grass) out.grass = scatterGrass(world, x0, z0, size, params.vegDensity ?? 1);
  return out;
}

function surfaceTint(world, x, z, h, ny, out, far) {
  const p = world.regionBlend(x, z);
  const n = world.noise;
  const macro = n.noise2D(x / 260, z / 260) * 0.5 + 0.5;
  const micro = world.noise2.noise2D(x / 37, z / 37) * 0.5 + 0.5;
  // base grass tint: greener in valleys, olive in forests, straw in dry lands
  let r = lerp(0.92, 1.08, macro), g = lerp(0.95, 1.06, micro), b = lerp(0.9, 1.0, macro);
  let dirt = 0, sand = 0;
  const forest = p.forest * smoothstep(0.25, 0.7, n.noise2D(x / 420 + 40, z / 420 - 9) * 0.5 + 0.5 + p.forest * 0.35);
  dirt += forest * 0.35 * micro;
  r *= 1 - forest * 0.12; g *= 1 - forest * 0.05; b *= 1 - forest * 0.15;
  if (p.dry > 0.05) {
    const d = p.dry;
    r = lerp(r, 1.35, d * 0.6); g = lerp(g, 1.12, d * 0.5); b = lerp(b, 0.75, d * 0.5);
    sand += d * 0.55 * (0.6 + micro * 0.4);
  }
  if (p.marsh > 0.05) {
    sand += p.marsh * 0.25 * micro;
    r *= 1 - p.marsh * 0.1; b *= 1 - p.marsh * 0.05;
  }
  // farmland parcels: crop rows and furrows are drawn in the terrain shader
  let wheat = 0, plowed = 0;
  {
    const f = world.fieldAt(x, z, p.fields);
    if (f === 1) wheat = 1;
    else if (f === 2) plowed = 1;
    else if (f === 3) { g *= 1.1; r *= 1.03; }
  }
  // water edges
  const riv = world.riverQuery(x, z);
  if (riv) {
    const half = riv.width * 0.5;
    const wet = smoothstep(half + 16, half + 2, riv.d);
    sand = Math.max(sand, wet * 0.85);
    dirt *= 1 - wet;
    r = lerp(r, 0.8, wet * 0.5); g = lerp(g, 0.78, wet * 0.5); b = lerp(b, 0.72, wet * 0.5);
  }
  const lake = world.lake;
  if (h < lake.level + 2.5) {
    const dx = (x - lake.center[0]) / lake.radius[0], dz = (z - lake.center[1]) / lake.radius[1];
    if (dx * dx + dz * dz < 3) {
      const wet = smoothstep(lake.level + 2.5, lake.level + 0.3, h);
      sand = Math.max(sand, wet);
    }
  }
  // roads and POI pads get dirt/gravel shoulders
  const road = world.roadQuery(x, z);
  if (road) {
    const hw = road.width * 0.5;
    const shoulder = smoothstep(hw + 3.5, hw - 0.5, road.d);
    dirt = Math.max(dirt, shoulder * (road.type === 'dirt' ? 1.0 : 0.75));
  }
  for (const poi of world.pois) {
    const dx = x - poi.x, dz = z - poi.z;
    const R = poi.radius;
    if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
    const d = Math.hypot(dx, dz);
    // worn patches inside settlements, mostly grass in between
    const patch = smoothstep(0.55, 0.85, world.noise2.noise2D(x / 14, z / 14) * 0.5 + 0.5);
    const w = smoothstep(R, R * 0.5, d) * patch * 0.6;
    dirt = Math.max(dirt, w);
  }
  // steep slopes show more dirt before turning to rock in the shader
  dirt = Math.max(dirt, smoothstep(0.9, 0.78, ny) * 0.6);
  // roads and water edges override crops
  if (road) {
    const hw = road.width * 0.5;
    const k = smoothstep(hw + 4, hw + 1, road.d);
    wheat *= 1 - k; plowed *= 1 - k;
  }
  if (riv) { const k = smoothstep(riv.width * 0.5 + 18, riv.width * 0.5 + 4, riv.d); wheat *= 1 - k; plowed *= 1 - k; }
  out.r = r; out.g = g; out.b = b;
  out.dirt = clamp(dirt, 0, 1);
  out.sand = clamp(sand, 0, 1 - out.dirt * 0.5);
  out.wheat = wheat;
  out.plowed = plowed;
}

function treeDensity(world, x, z, p) {
  const n = world.noise;
  const cluster = n.noise2D(x / 420 + 40, z / 420 - 9) * 0.5 + 0.5;
  const small = world.noise2.noise2D(x / 90, z / 90) * 0.5 + 0.5;
  let d = p.forest * smoothstep(0.25, 0.7, cluster + p.forest * 0.35);
  d *= 0.6 + small * 0.6;
  // clearings
  if (world.noise2.noise2D(x / 230 - 50, z / 230 + 20) > 0.55) d *= 0.15;
  return d;
}

function scatterVegetation(world, x0, z0, size, density, hb, ext, step) {
  const out = [];
  const cell = 7;
  const cells = Math.floor(size / cell);
  for (let cj = 0; cj < cells; cj++) {
    for (let ci = 0; ci < cells; ci++) {
      const gx = Math.floor(x0 / cell) + ci, gz = Math.floor(z0 / cell) + cj;
      const r1 = hash2(gx, gz, 11), r2 = hash2(gx, gz, 12), r3 = hash2(gx, gz, 13), r4 = hash2(gx, gz, 14);
      const x = (gx + 0.15 + r1 * 0.7) * cell, z = (gz + 0.15 + r2 * 0.7) * cell;
      if (x < x0 || z < z0 || x >= x0 + size || z >= z0 + size) continue;
      const p = world.regionBlend(x, z);
      const td = treeDensity(world, x, z, p) * density;
      const isTree = r3 < td * 0.85;
      const isBush = !isTree && r3 < td * 0.85 + (0.05 + p.forest * 0.12) * density;
      const isRock = !isTree && !isBush && r4 < (0.012 + p.mountain * 0.08 + p.rough * 0.01) * density;
      const isDead = !isTree && !isBush && !isRock && r4 > 1 - (0.004 + p.dry * 0.02) * density;
      if (!isTree && !isBush && !isRock && !isDead) continue;
      if (world.isDeveloped(x, z, isTree ? 4 : 1)) continue;
      if (world.waterAt(x, z) !== null) continue;
      const ri = world.riverQuery(x, z);
      if (ri && ri.d < ri.width * 0.5 + 3) continue;
      const h = world.heightAt(x, z);
      const nrm = world.normalAt(x, z);
      if (isTree && nrm.y < 0.72) continue;
      const fld = world.fieldAt(x, z, p.fields);
      if (fld && (isTree || isBush)) continue;
      let type;
      const rr = hash2(gx, gz, 15);
      const s = 0.75 + hash2(gx, gz, 16) * 0.6;
      if (isTree) {
        if (rr < p.pine) type = rr < p.pine * 0.55 ? 0 : 1;
        else type = rr < p.pine + (1 - p.pine) * 0.5 ? 2 : 3;
        if (p.dry > 0.6 && hash2(gx, gz, 17) < 0.5) type = 4;
      } else if (isBush) type = 5;
      else if (isRock) type = hash2(gx, gz, 18) < 0.75 ? 6 : 7;
      else type = hash2(gx, gz, 19) < 0.5 ? 4 : 8;
      out.push(type, x, h, z, r1 * Math.PI * 2, s);
    }
  }
  scatterHedgerows(world, x0, z0, size, density, out);
  scatterGroundCover(world, x0, z0, size, density, out);
  return new Float32Array(out);
}

/** Ferns under forest canopy and round hay bales lying in meadows and harvested fields. */
function scatterGroundCover(world, x0, z0, size, density, out) {
  const step = 2.6;
  const n = Math.floor(size / step);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const gx = Math.floor(x0 / step) + i, gz = Math.floor(z0 / step) + j;
      const x = (gx + hash2(gx, gz, 51)) * step, z = (gz + hash2(gx, gz, 52)) * step;
      if (x < x0 || z < z0 || x >= x0 + size || z >= z0 + size) continue;
      const r = hash2(gx, gz, 53);
      const p = world.regionBlend(x, z);
      if (p.forest > 0.2) {
        const td = treeDensity(world, x, z, p);
        if (r < td * 0.55 * density && p.dry < 0.6) {
          if (world.isDeveloped(x, z, 0) || world.waterAt(x, z) !== null) continue;
          if (world.normalAt(x, z).y < 0.75) continue;
          out.push(9, x, world.heightAt(x, z), z, hash2(gx, gz, 54) * 6.283, 0.7 + hash2(gx, gz, 55) * 0.7);
          continue;
        }
      }
      if (p.fields > 0.1 && r < 0.0035 * density) {
        const fld = world.fieldAt(x, z, p.fields);
        if (fld !== 1 && fld !== 3) continue;
        if (world.isDeveloped(x, z, 2)) continue;
        out.push(10, x, world.heightAt(x, z), z, hash2(gx, gz, 56) * 6.283, 0.95 + hash2(gx, gz, 57) * 0.15);
      }
    }
  }
}

/** Field type of a 140 m farmland cell ignoring the hedgerow gap (mirrors WorldData.fieldAt). */
function cellField(ix, iz, w) {
  if (w < 0.08) return 0;
  if (hash2(ix, iz, 991) > w * 1.1) return 0;
  return 1 + Math.floor(hash2(ix, iz, 77) * 3);
}

/** Bushes and the odd tree along the boundaries of farmland parcels. */
function scatterHedgerows(world, x0, z0, size, density, out) {
  const C = 140, step = 3.2;
  const n = Math.floor(size / step);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const gx = Math.floor(x0 / step) + i, gz = Math.floor(z0 / step) + j;
      const x = (gx + 0.2 + hash2(gx, gz, 41) * 0.6) * step, z = (gz + 0.2 + hash2(gx, gz, 42) * 0.6) * step;
      if (x < x0 || z < z0 || x >= x0 + size || z >= z0 + size) continue;
      const fx = x / C - Math.floor(x / C), fz = z / C - Math.floor(z / C);
      const onX = fx > 0.008 && fx < 0.032, onZ = fz > 0.008 && fz < 0.032;
      if (!onX && !onZ) continue;
      const p = world.regionBlend(x, z);
      if (p.fields < 0.08) continue;
      const ix = Math.floor(x / C), iz = Math.floor(z / C);
      const fieldNear = onX ? (cellField(ix, iz, p.fields) || cellField(ix - 1, iz, p.fields)) : (cellField(ix, iz, p.fields) || cellField(ix, iz - 1, p.fields));
      if (!fieldNear) continue;
      // gaps in the hedge
      if (world.noise2.noise2D(x / 40 + 7, z / 40 - 3) > 0.45) continue;
      const r = hash2(gx, gz, 43);
      if (r > 0.8 * density) continue;
      if (world.isDeveloped(x, z, 2) || world.waterAt(x, z) !== null) continue;
      const h = world.heightAt(x, z);
      const tree = hash2(gx, gz, 44) < 0.12;
      const type = tree ? (hash2(gx, gz, 45) < 0.6 ? 2 : 3) : 5;
      const s = tree ? 0.8 + hash2(gx, gz, 46) * 0.45 : 0.9 + hash2(gx, gz, 46) * 0.7;
      out.push(type, x, h, z, hash2(gx, gz, 47) * Math.PI * 2, s);
    }
  }
}

function scatterFarTrees(world, x0, z0, size, density, holes) {
  const out = [];
  const cell = 14;
  const cells = Math.floor(size / cell);
  for (let cj = 0; cj < cells; cj++) {
    for (let ci = 0; ci < cells; ci++) {
      const gx = Math.floor(x0 / cell) + ci, gz = Math.floor(z0 / cell) + cj;
      const x = (gx + 0.2 + hash2(gx, gz, 21) * 0.6) * cell, z = (gz + 0.2 + hash2(gx, gz, 22) * 0.6) * cell;
      if (holes && x > holes[0] && x < holes[2] && z > holes[1] && z < holes[3]) continue;
      const p = world.regionBlend(x, z);
      const td = treeDensity(world, x, z, p) * density;
      if (hash2(gx, gz, 23) > td * 0.9 * 3.0) continue; // 4x larger cells -> scale probability
      if (world.isDeveloped(x, z, 3)) continue;
      const h = world.heightRaw(x, z);
      if (h < world.lake.level + 0.5 && world.waterAt(x, z) !== null) continue;
      const pine = hash2(gx, gz, 24) < p.pine ? 1 : 0;
      out.push(pine, x, h, z, 0, 0.8 + hash2(gx, gz, 25) * 0.6);
    }
  }
  return new Float32Array(out);
}

function scatterGrass(world, x0, z0, size, density) {
  const out = [];
  const cell = 1.15 / Math.sqrt(Math.max(0.2, density));
  const cells = Math.floor(size / cell);
  for (let cj = 0; cj < cells; cj++) {
    for (let ci = 0; ci < cells; ci++) {
      const gx = Math.floor(x0 / cell) + ci, gz = Math.floor(z0 / cell) + cj;
      const r = hash2(gx, gz, 31);
      const x = (gx + hash2(gx, gz, 32)) * cell, z = (gz + hash2(gx, gz, 33)) * cell;
      const p = world.regionBlend(x, z);
      const local = world.noise2.noise2D(x / 18, z / 18) * 0.5 + 0.5;
      const want = (0.25 + (1 - p.dry) * 0.6) * (0.4 + local * 0.9) * (1 - p.forest * 0.35);
      if (r > want) continue;
      const fld = world.fieldAt(x, z, p.fields);
      if (fld === 2) continue;
      const road = world.roadQuery(x, z);
      if (road && road.d < road.width * 0.5 + 0.8) continue;
      let pad = false;
      for (const poi of world.pois) {
        const dx = x - poi.x, dz = z - poi.z;
        if (dx * dx + dz * dz < poi.radius * poi.radius * 0.45) { pad = true; break; }
      }
      if (pad) continue;
      if (world.waterAt(x, z) !== null) continue;
      const h = world.heightAt(x, z);
      const tintIdx = fld === 1 ? 2 : p.dry > 0.5 ? 1 : 0;
      out.push(x, h, z, r * 6.283, 0.8 + hash2(gx, gz, 34) * 0.6 + (fld === 1 ? 0.9 : 0), tintIdx);
    }
  }
  return new Float32Array(out);
}
