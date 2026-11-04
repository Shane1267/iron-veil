import * as THREE from 'three';
import { mulberry32, clamp } from '../core/MathUtil.js';

// Procedurally generated, tileable PBR-ish textures (albedo + normal + roughness).
// Every material in the game is built from these so the project ships with no
// third-party texture assets. Resolution follows the "textures" quality setting.

class TileNoise {
  constructor(seed, period) {
    this.period = period;
    const rnd = mulberry32(seed);
    this.v = new Float32Array(period * period);
    for (let i = 0; i < this.v.length; i++) this.v[i] = rnd();
  }
  at(x, y) {
    const p = this.period;
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p;
    const x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = this.v[y0 * p + x0], b = this.v[y0 * p + x1];
    const c = this.v[y1 * p + x0], d = this.v[y1 * p + x1];
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  }
}

/** Tileable fbm over unit square u,v in [0,1). baseFreq must be an integer. */
function makeFbm(seed, baseFreq, octaves = 5, gain = 0.5) {
  const layers = [];
  let f = baseFreq;
  for (let o = 0; o < octaves; o++) {
    layers.push(new TileNoise(seed + o * 101, f));
    f *= 2;
  }
  return (u, v) => {
    let amp = 1, sum = 0, norm = 0;
    for (let o = 0; o < layers.length; o++) {
      const L = layers[o];
      sum += amp * L.at(u * L.period, v * L.period);
      norm += amp;
      amp *= gain;
    }
    return sum / norm;
  };
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a, b, t) => a + (b - a) * t;
const mixRgb = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/**
 * Generic generator. fn(u, v, out) fills out = {h, r, g, b, rough} for one texel.
 */
function generate(size, fn, normalStrength = 2.0, seed = 1) {
  const n = size * size;
  const height = new Float32Array(n);
  const color = new Uint8ClampedArray(n * 4);
  const rough = new Uint8ClampedArray(n * 4);
  const out = { h: 0, r: 0, g: 0, b: 0, rough: 0.8 };
  const rnd = mulberry32(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out.rough = 0.85;
      fn(x / size, y / size, out, rnd);
      const i = y * size + x;
      height[i] = out.h;
      color[i * 4] = out.r; color[i * 4 + 1] = out.g; color[i * 4 + 2] = out.b; color[i * 4 + 3] = 255;
      const rv = clamp(out.rough, 0, 1) * 255;
      rough[i * 4] = rv; rough[i * 4 + 1] = rv; rough[i * 4 + 2] = rv; rough[i * 4 + 3] = 255;
    }
  }
  // normal map from height (wrapping Sobel)
  const normal = new Uint8ClampedArray(n * 4);
  const s = normalStrength * (size / 256);
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size, yp = ((y + 1) % size) * size, y0 = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const dx = (height[y0 + xm] - height[y0 + xp]) * s;
      const dy = (height[ym + x] - height[yp + x]) * s;
      const len = Math.hypot(dx, dy, 1);
      const i = (y0 + x) * 4;
      normal[i] = (dx / len * 0.5 + 0.5) * 255;
      normal[i + 1] = (dy / len * 0.5 + 0.5) * 255;
      normal[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  }
  return { size, color, normal, rough };
}

function toTexture(data, buf, srgb) {
  const tex = new THREE.DataTexture(data[buf], data.size, data.size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- recipes
const RECIPES = {
  grass(size) {
    const f = makeFbm(11, 4, 6);
    const patch = makeFbm(13, 2, 3);
    const clump = makeFbm(14, 16, 3);
    const rnd = mulberry32(15);
    const c1 = hexToRgb('#4b5730'), c2 = hexToRgb('#66703c'), c3 = hexToRgb('#35411f'), dry = hexToRgb('#7f7548');
    // pre-scattered blade strokes (tileable by wrapping)
    const N = size;
    const strokes = new Float32Array(N * N);
    for (let i = 0; i < N * N * 0.55; i++) {
      const x = Math.floor(rnd() * N), y = Math.floor(rnd() * N);
      const len = 2 + Math.floor(rnd() * 5 * (N / 256));
      const dx = rnd() < 0.5 ? 1 : -1;
      const val = rnd() < 0.5 ? 1 : -1;
      for (let k = 0; k < len; k++) {
        const xx = (x + Math.round(k * 0.3 * dx) + N) % N, yy = (y + k) % N;
        strokes[yy * N + xx] += val * (1 - k / len);
      }
    }
    return generate(size, (u, v, o) => {
      const n = f(u, v), p = patch(u, v), cl = clump(u, v);
      const sx = Math.floor(u * N) % N, sy = Math.floor(v * N) % N;
      const st = clamp(strokes[sy * N + sx], -1.5, 1.5);
      let c = mixRgb(c3, c1, clamp(n * 1.5 - 0.2 + cl * 0.3, 0, 1));
      c = mixRgb(c, c2, clamp(st * 0.35 + 0.2, 0, 0.8));
      c = mixRgb(c, dry, clamp((p - 0.55) * 2.2, 0, 0.55) + (st < -0.8 ? 0.1 : 0));
      c = c.map((x) => x * (0.92 + st * 0.08));
      o.h = 0.4 + st * 0.25 + cl * 0.2; o.r = c[0]; o.g = c[1]; o.b = c[2]; o.rough = 0.92;
    }, 2.0, 3);
  },
  dirt(size) {
    const f = makeFbm(21, 4, 6);
    const fine = makeFbm(23, 64, 2);
    const rnd = mulberry32(22);
    const c1 = hexToRgb('#56463a'), c2 = hexToRgb('#6e5c48'), c3 = hexToRgb('#3c3128');
    // scattered small stones: [x, y, r, tone]
    const stones = [];
    for (let i = 0; i < 110; i++) stones.push([rnd(), rnd(), (0.005 + rnd() * rnd() * 0.022), rnd()]);
    const grid = new Map();
    for (const st of stones) {
      const k = `${Math.floor(st[0] * 16)},${Math.floor(st[1] * 16)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(st);
    }
    return generate(size, (u, v, o) => {
      const n = f(u, v), fn = fine(u, v);
      let c = mixRgb(c3, c1, clamp(n * 1.5 - 0.15, 0, 1));
      c = mixRgb(c, c2, clamp((fn - 0.5) * 0.8, 0, 0.4));
      let h = n * 0.4 + fn * 0.2;
      const gi = Math.floor(u * 16), gj = Math.floor(v * 16);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const list = grid.get(`${(gi + di + 16) % 16},${(gj + dj + 16) % 16}`);
        if (!list) continue;
        for (const [sx, sy, r, t] of list) {
          let dx = u - sx, dy = v - sy;
          dx -= Math.round(dx); dy -= Math.round(dy);
          const d = Math.hypot(dx, dy) / r;
          if (d < 1) {
            const dome = Math.sqrt(1 - d * d);
            c = mixRgb([66 + t * 30, 60 + t * 26, 52 + t * 22], [104, 98, 88], clamp((dome - 0.5) * 0.6 + 0.2, 0, 1)).map((x) => x * (0.7 + dome * 0.3));
            h = 0.6 + dome * 0.5;
          }
        }
      }
      o.h = h; o.r = c[0]; o.g = c[1]; o.b = c[2]; o.rough = 0.95;
    }, 3.0, 5);
  },
  rock(size) {
    const f = makeFbm(31, 3, 6, 0.55);
    const cr = makeFbm(32, 6, 4);
    const c1 = hexToRgb('#6f6b63'), c2 = hexToRgb('#8c877c'), c3 = hexToRgb('#4a4741'), lich = hexToRgb('#5d6440');
    return generate(size, (u, v, o) => {
      const n = f(u, v);
      const crack = 1 - Math.abs(cr(u, v) * 2 - 1);
      let c = mixRgb(c3, c1, clamp(n * 1.5 - 0.15, 0, 1));
      c = mixRgb(c, c2, clamp((n - 0.6) * 3, 0, 1));
      const k = clamp((crack - 0.86) * 8, 0, 1);
      c = mixRgb(c, [40, 38, 34], k);
      c = mixRgb(c, lich, clamp((f(v, u) - 0.62) * 3, 0, 0.5));
      o.h = n - k * 0.6; o.r = c[0]; o.g = c[1]; o.b = c[2]; o.rough = 0.88;
    }, 4.0, 7);
  },
  mud(size) {
    const f = makeFbm(41, 4, 5);
    const c1 = hexToRgb('#4a4232'), c2 = hexToRgb('#6c6447'), c3 = hexToRgb('#2f2a20');
    return generate(size, (u, v, o) => {
      const n = f(u, v);
      let c = mixRgb(c3, c1, clamp(n * 1.6, 0, 1));
      c = mixRgb(c, c2, clamp((n - 0.6) * 3, 0, 1));
      o.h = n * 0.6; o.r = c[0]; o.g = c[1]; o.b = c[2]; o.rough = 0.6 + n * 0.3;
    }, 2.0, 9);
  },
  asphalt(size) {
    const f = makeFbm(51, 8, 5);
    const ag = makeFbm(52, 128, 1);
    const cr = makeFbm(53, 5, 4);
    return generate(size, (u, v, o) => {
      const n = f(u, v), a = ag(u, v);
      let g = 52 + n * 26 + (a > 0.7 ? 22 : 0);
      const crack = 1 - Math.abs(cr(u, v) * 2 - 1);
      const k = clamp((crack - 0.93) * 14, 0, 1);
      g *= 1 - k * 0.5;
      o.h = a * 0.4 - k; o.r = g; o.g = g; o.b = g * 1.02; o.rough = 0.88;
    }, 2.0, 11);
  },
  road(size) {
    // worn asphalt: fine aggregate, faded edge lines and a dashed white centre line;
    // u runs across the road, v along it
    const f = makeFbm(54, 8, 5);
    const ag = makeFbm(55, 160, 1);
    const fine = makeFbm(57, 64, 2);
    const wear = makeFbm(56, 4, 4);
    const cr = makeFbm(58, 6, 4);
    return generate(size, (u, v, o) => {
      const n = f(u, v), a = ag(u, v), fn = fine(u, v);
      let r = 56 + n * 12 + fn * 8 + (a > 0.74 ? 12 : 0);
      const crack = 1 - Math.abs(cr(u, v) * 2 - 1);
      const k = clamp((crack - 0.95) * 18, 0, 1);
      r *= 1 - k * 0.45;
      let g = r, b = r * 1.03;
      const w = wear(u, v);
      const edge = (u > 0.055 && u < 0.08) || (u > 0.92 && u < 0.945);
      const centre = Math.abs(u - 0.5) < 0.011 && (v * 4) % 1 < 0.5;
      if ((edge || centre) && w > 0.42) {
        const paint = 150 * (0.7 + n * 0.25) * clamp((w - 0.42) * 4, 0.35, 1);
        r = Math.max(r, paint); g = Math.max(g, paint * 0.99); b = Math.max(b, paint * 0.95);
      }
      o.h = a * 0.25 + fn * 0.2 - k * 0.6; o.r = r; o.g = g; o.b = b; o.rough = 0.88 - (edge || centre ? 0.15 : 0);
    }, 1.2, 13);
  },
  dirtroad(size) {
    const f = makeFbm(61, 6, 5);
    const peb = makeFbm(62, 64, 2);
    const grass = makeFbm(63, 6, 4);
    const c1 = hexToRgb('#6a5a42'), c2 = hexToRgb('#4f4232'), gr = hexToRgb('#4f5a30');
    return generate(size, (u, v, o) => {
      const n = f(u, v), p = peb(u, v);
      const rut = Math.exp(-Math.pow((u - 0.3) / 0.07, 2)) + Math.exp(-Math.pow((u - 0.7) / 0.07, 2));
      let c = mixRgb(c1, c2, clamp(n * 1.2 + rut * 0.4 - 0.3, 0, 1));
      const centreGrass = Math.exp(-Math.pow((u - 0.5) / 0.08, 2)) * clamp(grass(u, v) * 2 - 0.6, 0, 1);
      const edgeGrass = clamp((Math.abs(u - 0.5) - 0.38) * 10, 0, 1);
      c = mixRgb(c, gr, clamp(centreGrass + edgeGrass, 0, 1));
      o.h = n * 0.4 + (p > 0.7 ? 0.4 : 0) - rut * 0.5; o.r = c[0]; o.g = c[1]; o.b = c[2]; o.rough = 0.95;
    }, 3.0, 15);
  },
  concrete(size) {
    const f = makeFbm(71, 6, 6);
    const stain = makeFbm(72, 2, 4);
    const pit = makeFbm(73, 96, 1);
    return generate(size, (u, v, o) => {
      const n = f(u, v), s = stain(u, v), p = pit(u, v);
      let g = 132 + n * 30 - clamp((s - 0.5) * 80, 0, 40);
      const seam = (v * 2) % 1 < 0.008 || (u * 2) % 1 < 0.006 ? 0.75 : 1;
      g *= seam;
      // vertical rain streaks
      const streak = clamp((stain(u * 0.2, v * 3) - 0.6) * 2, 0, 0.25);
      g *= 1 - streak;
      o.h = n * 0.3 - (p > 0.85 ? 0.5 : 0) - (seam < 1 ? 0.5 : 0); o.r = g; o.g = g * 0.99; o.b = g * 0.96; o.rough = 0.9;
    }, 2.0, 17);
  },
  plaster(size) {
    const f = makeFbm(81, 6, 5);
    const grain = makeFbm(83, 96, 2);
    const cloud = makeFbm(82, 2, 4);
    const crack = makeFbm(84, 5, 4);
    const spall = makeFbm(85, 3, 4);
    const base = hexToRgb('#bdb4a0');
    return generate(size, (u, v, o) => {
      const n = f(u, v), g = grain(u, v), c = cloud(u, v);
      let col = mixRgb(base, [150, 142, 126], clamp((c - 0.45) * 1.2, 0, 0.45));
      col = col.map((x) => x * (0.94 + g * 0.1 + n * 0.05));
      // hairline cracks
      const cr = 1 - Math.abs(crack(u, v) * 2 - 1);
      // cracks only in some areas, not a contour-like network everywhere
      const k = clamp((cr - 0.986) * 60, 0, 1) * clamp((spall(u * 1.7 + 0.3, v * 1.3) - 0.5) * 4, 0, 1);
      col = mixRgb(col, [104, 98, 88], k * 0.3);
      // patches where the render has fallen away, exposing brick
      const sp = spall(u, v);
      let h = n * 0.25 + g * 0.15 - k * 0.12;
      if (sp > 0.77) {
        const row = Math.floor(v * 24), bx = (u * 12 + (row % 2) * 0.5) % 1;
        const mortar = bx < 0.06 || (v * 24) % 1 < 0.12;
        col = mortar ? [118, 110, 98] : mixRgb([116, 60, 44], [140, 82, 60], grain(u * 0.3, v));
        h = mortar ? -0.6 : -0.35;
        if (sp < 0.778) { col = mixRgb(col, [96, 90, 80], 0.5); h = -0.2; } // ragged edge
      }
      o.h = h; o.r = col[0]; o.g = col[1]; o.b = col[2]; o.rough = 0.94;
    }, 1.8, 19);
  },
  stone(size) {
    // rubble masonry: jittered cells (tileable) with recessed mortar joints
    const P = 7;
    const rnd = mulberry32(611);
    const pts = [];
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) pts.push([(i + 0.15 + rnd() * 0.7) / P, (j + 0.15 + rnd() * 0.7) / P, rnd()]);
    const f = makeFbm(612, 8, 4);
    return generate(size, (u, v, o) => {
      let d1 = 9, d2 = 9, id = 0;
      const ci = Math.floor(u * P), cj = Math.floor(v * P);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = ((ci + di) % P + P) % P, jj = ((cj + dj) % P + P) % P;
        const p = pts[jj * P + ii];
        const px = p[0] + Math.floor((ci + di) / P) * 1, pz = p[1] + Math.floor((cj + dj) / P) * 1;
        const dx = (u - px) * 1.25, dz = v - pz;
        const d = Math.hypot(dx, dz);
        if (d < d1) { d2 = d1; d1 = d; id = p[2]; } else if (d < d2) d2 = d;
      }
      const edge = d2 - d1;
      const mortar = edge < 0.012;
      const n = f(u, v);
      let col = mortar ? [96, 92, 84] : mixRgb([96, 92, 86], [150, 142, 128], id * 0.8 + n * 0.3);
      if (!mortar && id > 0.8) col = mixRgb(col, [128, 104, 80], 0.4);
      col = col.map((x) => x * (0.9 + n * 0.15));
      o.h = mortar ? 0 : 0.4 + clamp(edge * 8, 0, 0.5) + n * 0.2; o.r = col[0]; o.g = col[1]; o.b = col[2]; o.rough = 0.9;
    }, 3.0, 47);
  },
  rooftile(size) {
    // clay pantiles: S-profile across, overlapping courses down the slope
    const rows = 10, cols = 8;
    const f = makeFbm(621, 4, 5);
    const moss = makeFbm(622, 3, 4);
    const rnd = mulberry32(623);
    const tone = [];
    for (let i = 0; i < rows * cols; i++) tone.push(0.82 + rnd() * 0.3);
    return generate(size, (u, v, o) => {
      const ry = v * rows, row = Math.floor(ry), fy = ry - row;
      const rx = u * cols + (row % 2) * 0.5, col0 = Math.floor(rx), fx = rx - col0;
      const prof = Math.sin(fx * Math.PI * 2) * 0.5 + 0.5;
      const t = tone[((row % rows) * cols + ((col0 % cols) + cols) % cols)];
      // lower edge of each course casts a shadow onto the one below
      const lap = fy < 0.1 ? 0.55 + fy * 4.5 : 1;
      let c = mixRgb([126, 64, 42], [152, 86, 58], f(u, v));
      c = c.map((x) => x * t * (0.78 + prof * 0.3) * lap);
      const m = clamp((moss(u, v) - 0.6) * 2.5, 0, 0.6) * (1 - prof * 0.5);
      c = mixRgb(c, [88, 92, 52], m);
      o.h = prof * 0.6 + fy * 0.5; o.r = c[0]; o.g = c[1]; o.b = c[2]; o.rough = 0.75 + m * 0.2;
    }, 3.0, 49);
  },
  brick(size) {
    const f = makeFbm(91, 8, 4);
    const tint = makeFbm(92, 16, 2);
    const rows = 16, cols = 8;
    return generate(size, (u, v, o) => {
      const ry = v * rows;
      const row = Math.floor(ry);
      const rx = u * cols + (row % 2) * 0.5;
      const fx = rx - Math.floor(rx), fy = ry - row;
      const mortar = fx < 0.05 || fy < 0.1;
      const t = tint(Math.floor(rx) / cols, row / rows);
      const n = f(u, v);
      let c = mortar ? [120, 112, 100] : mixRgb([120, 58, 42], [150, 82, 58], t);
      c = mixRgb(c, [70, 60, 52], clamp((n - 0.6) * 1.5, 0, 0.5));
      o.h = mortar ? 0 : 0.6 + n * 0.3; o.r = c[0]; o.g = c[1]; o.b = c[2]; o.rough = 0.92;
    }, 3.0, 21);
  },
  planks(size) {
    const grain = makeFbm(101, 2, 5);
    const knots = makeFbm(102, 12, 2);
    const boards = 6;
    return generate(size, (u, v, o) => {
      const by = v * boards;
      const b = Math.floor(by), fy = by - b;
      const gap = fy < 0.04;
      const off = (b * 0.37) % 1;
      const g = grain(u * 0.5 + off, v * 6 + b * 0.13);
      const ring = Math.sin((g * 30 + u * 4) * Math.PI) * 0.5 + 0.5;
      const tone = 0.8 + ((b * 7919) % 13) / 60;
      let c = mixRgb([92, 66, 42], [128, 96, 62], ring * 0.6 + g * 0.4);
      c = c.map((x) => x * tone);
      const k = knots(u, v) > 0.8 ? 0.6 : 1;
      c = c.map((x) => x * k);
      // weathering grey
      c = mixRgb(c, [110, 104, 96], clamp(grain(v, u) - 0.45, 0, 0.45));
      o.h = gap ? 0 : 0.5 + ring * 0.15; o.r = c[0]; o.g = c[1]; o.b = c[2]; o.rough = 0.88;
    }, 2.5, 23);
  },
  logs(size) {
    const grain = makeFbm(111, 3, 5);
    const n = 5;
    return generate(size, (u, v, o) => {
      const ly = v * n; const L = Math.floor(ly); const fy = ly - L;
      const round = Math.sin(fy * Math.PI);
      const g = grain(u * 0.5, v * 8 + L);
      let c = mixRgb([58, 42, 30], [104, 78, 52], round * 0.7 + g * 0.3);
      if (fy < 0.06 || fy > 0.94) c = [40, 34, 28];
      o.h = round * 0.8 + g * 0.1; o.r = c[0]; o.g = c[1]; o.b = c[2]; o.rough = 0.9;
    }, 3.5, 25);
  },
  corrugated(size) {
    const f = makeFbm(121, 4, 5);
    const rust = makeFbm(122, 3, 5);
    const paint = hexToRgb('#6b7466');
    return generate(size, (u, v, o) => {
      const ridge = Math.sin(u * Math.PI * 2 * 16) * 0.5 + 0.5;
      const r = rust(u, v);
      const rk = clamp((r - 0.52) * 3 + (1 - v) * 0.0, 0, 1);
      let c = mixRgb(paint, [118, 70, 40], rk);
      c = mixRgb(c, [70, 52, 40], clamp((f(u, v) - 0.6) * 2, 0, 0.5));
      c = c.map((x) => x * (0.82 + ridge * 0.25));
      o.h = ridge; o.r = c[0]; o.g = c[1]; o.b = c[2]; o.rough = 0.55 + rk * 0.35;
    }, 2.5, 27);
  },
  metal(size) {
    const f = makeFbm(131, 4, 5);
    const scratch = makeFbm(132, 64, 1);
    return generate(size, (u, v, o) => {
      const n = f(u, v), s = scratch(u * 0.1, v);
      const g = 120 + n * 40 + (s > 0.8 ? 30 : 0);
      o.h = n * 0.2; o.r = g; o.g = g; o.b = g * 1.03; o.rough = 0.45 + n * 0.25;
    }, 1.0, 29);
  },
  olive(size) {
    const f = makeFbm(141, 4, 5);
    const chip = makeFbm(142, 24, 3);
    const base = hexToRgb('#4b5236');
    return generate(size, (u, v, o) => {
      const n = f(u, v), c2 = chip(u, v);
      let c = mixRgb(base, [62, 66, 46], n);
      const k = c2 > 0.75 ? 1 : 0;
      if (k) c = [96, 90, 82];
      c = mixRgb(c, [86, 62, 40], clamp((f(v, u) - 0.62) * 2, 0, 0.5));
      o.h = n * 0.2 - k * 0.3; o.r = c[0]; o.g = c[1]; o.b = c[2]; o.rough = 0.7;
    }, 1.2, 31);
  },
  roof(size) {
    const f = makeFbm(151, 6, 4);
    const rows = 12;
    return generate(size, (u, v, o) => {
      const ry = v * rows; const row = Math.floor(ry); const fy = ry - row;
      const rx = u * 10 + (row % 2) * 0.5; const fx = rx - Math.floor(rx);
      const shade = 0.6 + fy * 0.4;
      const tone = 0.85 + (((Math.floor(rx) * 31 + row * 17) % 7) / 30);
      let g = (52 + f(u, v) * 22) * shade * tone;
      if (fx < 0.03) g *= 0.6;
      o.h = fy * 0.8 + (fx < 0.03 ? -0.3 : 0); o.r = g * 1.05; o.g = g * 0.95; o.b = g * 0.9; o.rough = 0.85;
    }, 3.0, 33);
  },
  canvas(size) {
    const f = makeFbm(161, 4, 4);
    const base = hexToRgb('#5a5a40');
    return generate(size, (u, v, o) => {
      const weave = (Math.sin(u * Math.PI * 2 * 96) * Math.sin(v * Math.PI * 2 * 96)) * 0.5 + 0.5;
      const n = f(u, v);
      let c = mixRgb(base, [74, 72, 52], n);
      c = c.map((x) => x * (0.9 + weave * 0.12));
      o.h = weave * 0.4; o.r = c[0]; o.g = c[1]; o.b = c[2]; o.rough = 0.95;
    }, 1.0, 35);
  },
  tiles(size) {
    const f = makeFbm(171, 6, 4);
    return generate(size, (u, v, o) => {
      const tx = Math.floor(u * 8), ty = Math.floor(v * 8);
      const grout = (u * 8) % 1 < 0.04 || (v * 8) % 1 < 0.04;
      const checker = (tx + ty) % 2 === 0;
      const n = f(u, v);
      let g = checker ? 150 : 112;
      g = g * (0.85 + n * 0.2);
      if (grout) g = 70;
      const dirt = clamp((f(v, u) - 0.5) * 0.8, 0, 0.35);
      o.h = grout ? 0 : 0.5; o.r = g * (1 - dirt); o.g = g * (0.98 - dirt); o.b = g * (0.92 - dirt); o.rough = grout ? 0.9 : 0.55;
    }, 1.5, 37);
  },
  bark(size) {
    const f = makeFbm(181, 4, 5);
    return generate(size, (u, v, o) => {
      const ridges = Math.abs(Math.sin((u * 12 + f(u, v) * 2) * Math.PI));
      const n = f(u, v * 0.25);
      const c = mixRgb([48, 36, 28], [92, 74, 58], ridges * 0.7 + n * 0.3);
      o.h = ridges; o.r = c[0]; o.g = c[1]; o.b = c[2]; o.rough = 0.95;
    }, 4.0, 39);
  },
  foliage(size) {
    const f = makeFbm(191, 8, 4);
    const leaf = makeFbm(192, 48, 2);
    return generate(size, (u, v, o) => {
      const n = f(u, v), l = leaf(u, v);
      const g = 0.55 + l * 0.6 + n * 0.2;
      o.h = l; o.r = 200 * g; o.g = 210 * g; o.b = 190 * g; o.rough = 0.8;
    }, 2.0, 41);
  },
  sand(size) {
    const f = makeFbm(201, 4, 5);
    const g2 = makeFbm(202, 96, 1);
    const c1 = hexToRgb('#a08a62'), c2 = hexToRgb('#7e6a4a');
    return generate(size, (u, v, o) => {
      const n = f(u, v), g = g2(u, v);
      const c = mixRgb(c2, c1, clamp(n * 1.3, 0, 1));
      o.h = n * 0.3 + g * 0.2; o.r = c[0] * (0.95 + g * 0.1); o.g = c[1] * (0.95 + g * 0.1); o.b = c[2]; o.rough = 0.95;
    }, 2.0, 43);
  },
  water(size) {
    const f = makeFbm(211, 8, 4, 0.55);
    return generate(size, (u, v, o) => {
      const n = f(u, v);
      o.h = n; o.r = 128; o.g = 128; o.b = 128; o.rough = 0.1;
    }, 3.0, 45);
  },
};

export class TextureFactory {
  constructor(renderer, size = 512) {
    this.renderer = renderer;
    this.size = size;
    this.cache = new Map();
    this.maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
  }

  /** Returns {map, normalMap, roughnessMap} for a recipe name. */
  get(name, sizeOverride) {
    const size = sizeOverride || this.size;
    const key = `${name}@${size}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const recipe = RECIPES[name];
    if (!recipe) throw new Error(`Unknown texture recipe ${name}`);
    const data = recipe(size);
    const set = {
      map: toTexture(data, 'color', true),
      normalMap: toTexture(data, 'normal', false),
      roughnessMap: toTexture(data, 'rough', false),
    };
    const aniso = Math.min(8, this.maxAniso);
    for (const t of Object.values(set)) t.anisotropy = aniso;
    this.cache.set(key, set);
    return set;
  }

  static recipes() {
    return Object.keys(RECIPES);
  }

  /**
   * Tileable RGBA value noise for large-scale variation (four independent fbm channels at
   * different base frequencies). Linear colour space, mipmapped.
   */
  noise(size = 256) {
    const key = `noise@${size}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const ch = [makeFbm(901, 4, 5), makeFbm(902, 6, 5), makeFbm(903, 8, 4), makeFbm(904, 16, 3)];
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size, i = (y * size + x) * 4;
        for (let c = 0; c < 4; c++) {
          // stretch contrast: fbm output clusters around 0.5
          data[i + c] = clamp((ch[c](u, v) - 0.5) * 2.2 + 0.5, 0, 1) * 255;
        }
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    this.cache.set(key, tex);
    return tex;
  }
}
