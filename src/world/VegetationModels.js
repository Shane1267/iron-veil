import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/MathUtil.js';

// Procedural vegetation. Trees use a single texture atlas (bark | pine needles |
// broadleaf twigs | birch twigs) so every tree type is one instanced draw call.
// Broadleaf crowns are built on a real branch skeleton: leaf clusters (crossed,
// alpha-tested cards showing a twig with leaves) sit at branch ends, which gives
// irregular, lobed silhouettes with gaps instead of round blobs. Normals are bent
// outward from the crown and from each cluster for soft volumetric lighting.

// atlas regions [u0, v0, u1, v1]
export const ATLAS = {
  bark: [0.0, 0.0, 0.5, 0.5],
  pine: [0.5, 0.0, 1.0, 0.5],
  leaf: [0.0, 0.5, 0.5, 1.0],
  birch: [0.5, 0.5, 1.0, 1.0],
};

/** Draw the vegetation atlas (1024²) on a canvas. */
export function createVegetationAtlas() {
  const S = 1024, H = S / 2;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rnd = mulberry32(4242);
  g.clearRect(0, 0, S, S);

  // --- bark (UV bottom-left = canvas bottom-left)
  const barkY = S - H;
  const bg = g.createLinearGradient(0, 0, H, 0);
  bg.addColorStop(0, '#463a2e'); bg.addColorStop(0.5, '#5e4e3e'); bg.addColorStop(1, '#463a2e');
  g.fillStyle = bg;
  g.fillRect(0, barkY, H, H);
  // vertical plates separated by dark fissures
  for (let i = 0; i < 70; i++) {
    const x = rnd() * H;
    g.strokeStyle = `rgba(${22 + rnd() * 14},${18 + rnd() * 10},${14 + rnd() * 8},${0.55 + rnd() * 0.35})`;
    g.lineWidth = 2 + rnd() * 4;
    g.beginPath();
    let px = x, py = barkY;
    g.moveTo(px, py);
    while (py < S) { py += 12 + rnd() * 30; px += (rnd() - 0.5) * 10; g.lineTo(px, py); }
    g.stroke();
  }
  for (let i = 0; i < 220; i++) {
    g.fillStyle = `rgba(${110 + rnd() * 40},${100 + rnd() * 30},${84 + rnd() * 20},${0.12 + rnd() * 0.15})`;
    g.fillRect(rnd() * H, barkY + rnd() * H, 2 + rnd() * 6, 8 + rnd() * 26);
  }
  // lichen
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${96 + rnd() * 30},${110 + rnd() * 25},${70 + rnd() * 20},${0.18 + rnd() * 0.2})`;
    g.beginPath(); g.ellipse(rnd() * H, barkY + rnd() * H, 4 + rnd() * 12, 3 + rnd() * 8, rnd() * 3, 0, Math.PI * 2); g.fill();
  }

  // --- pine branch (bottom-right): stem along x with needles
  const px0 = H, py0 = S - H;
  const drawBranch = (cx, cy, len, ang, depth) => {
    const ex = cx + Math.cos(ang) * len, ey = cy + Math.sin(ang) * len;
    g.strokeStyle = '#3a2e22';
    g.lineWidth = depth === 0 ? 6 : 3;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(ex, ey); g.stroke();
    const n = Math.floor(len / 3.2);
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const bx = cx + (ex - cx) * t, by = cy + (ey - cy) * t;
      const nl = (1 - t * 0.45) * (depth === 0 ? 34 : 24) * (0.8 + rnd() * 0.4);
      for (const side of [-1, 1]) {
        const na = ang + side * (0.9 + rnd() * 0.3) + 0.35;
        const shade = 34 + rnd() * 40;
        g.strokeStyle = `rgb(${shade * 0.55},${shade + 26},${shade * 0.52})`;
        g.lineWidth = 2.4;
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(na) * nl, by + Math.sin(na) * nl); g.stroke();
      }
    }
    if (depth === 0) {
      for (let k = 1; k < 6; k++) {
        const t = k / 6;
        const bx = cx + (ex - cx) * t, by = cy + (ey - cy) * t;
        for (const side of [-1, 1]) drawBranch(bx, by, len * (0.45 - t * 0.3), ang + side * (0.7 + rnd() * 0.3), 1);
      }
    }
  };
  g.save();
  g.beginPath(); g.rect(px0 + 34, py0 + 34, H - 68, H - 68); g.clip();
  for (let i = 0; i < 260; i++) {
    const t = rnd();
    const x = px0 + 20 + t * (H - 60);
    const spread = (1 - t * 0.7) * H * 0.33;
    const y = py0 + H / 2 + (rnd() - 0.5) * 2 * spread;
    g.fillStyle = `rgba(${24 + rnd() * 18},${46 + rnd() * 24},${22 + rnd() * 14},0.9)`;
    g.beginPath(); g.ellipse(x, y, 9 + rnd() * 10, 4 + rnd() * 5, (rnd() - 0.5) * 1.2, 0, Math.PI * 2); g.fill();
  }
  drawBranch(px0 + 12, py0 + H / 2, H - 40, 0, 0);
  g.restore();

  // --- twig clusters (top halves): twigs fan out from the card centre with leaves
  // along them, so each card reads as the end of a branch with a ragged outline
  const twigs = (x0, y0, opts) => {
    const { palette, twigCount, leafLen, leafW, spacing, droop, twigColor } = opts;
    g.save();
    g.beginPath(); g.rect(x0 + 34, y0 + 34, H - 68, H - 68); g.clip();
    const cx = x0 + H / 2, cy = y0 + H / 2;
    const leaves = [];
    for (let t = 0; t < twigCount; t++) {
      const a = (t / twigCount) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
      const len = H * (0.28 + rnd() * 0.18);
      // gently curved twig
      const pts = [];
      let ang = a, x = cx + Math.cos(a) * 12, y = cy + Math.sin(a) * 12;
      const segs = 10;
      for (let k = 0; k <= segs; k++) {
        pts.push([x, y]);
        ang += (rnd() - 0.5) * 0.25 + droop * 0.03 * Math.cos(ang);
        x += Math.cos(ang) * (len / segs); y += Math.sin(ang) * (len / segs);
      }
      g.strokeStyle = twigColor;
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts) g.lineTo(p[0], p[1]);
      g.stroke();
      // side twigs
      for (let k = 3; k < segs; k += 3) {
        const [bx, by] = pts[k];
        const sa = a + (k % 2 ? 0.7 : -0.7);
        const sl = len * 0.3;
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(sa) * sl, by + Math.sin(sa) * sl); g.stroke();
        for (let m = 1; m <= 3; m++) leaves.push([bx + Math.cos(sa) * sl * m / 3, by + Math.sin(sa) * sl * m / 3, sa]);
      }
      for (let k = 1; k <= segs; k++) {
        const [lx, ly] = pts[k];
        if (rnd() > spacing) continue;
        leaves.push([lx, ly, a]);
      }
    }
    // leaves: pairs on alternating sides of the twig
    for (const [lx, ly, a] of leaves) {
      for (const side of [-1, 1]) {
        if (rnd() < 0.15) continue;
        const la = a + side * (0.6 + rnd() * 0.5);
        const L = leafLen * (0.75 + rnd() * 0.5), W = leafW * (0.8 + rnd() * 0.4);
        const col = palette[Math.floor(rnd() * palette.length)];
        const k = 0.72 + rnd() * 0.5;
        g.save();
        g.translate(lx + Math.cos(la) * L * 0.5, ly + Math.sin(la) * L * 0.5);
        g.rotate(la);
        g.fillStyle = `rgb(${col[0] * k | 0},${col[1] * k | 0},${col[2] * k | 0})`;
        g.beginPath();
        g.moveTo(-L / 2, 0);
        g.quadraticCurveTo(0, -W, L / 2, 0);
        g.quadraticCurveTo(0, W, -L / 2, 0);
        g.fill();
        // lighter upper half (sky-lit side)
        g.fillStyle = `rgba(255,255,230,${0.05 + rnd() * 0.08})`;
        g.beginPath(); g.moveTo(-L / 2, 0); g.quadraticCurveTo(0, -W, L / 2, 0); g.fill();
        g.restore();
      }
    }
    g.restore();
  };
  twigs(0, 0, {
    palette: [[62, 86, 34], [74, 98, 38], [54, 76, 30], [86, 104, 42], [70, 84, 36]],
    twigCount: 9, leafLen: 26, leafW: 11, spacing: 0.95, droop: 0.2, twigColor: '#3e3226',
  });
  twigs(H, 0, {
    palette: [[104, 124, 50], [118, 134, 56], [92, 112, 44], [130, 140, 62]],
    twigCount: 11, leafLen: 17, leafW: 9, spacing: 0.9, droop: 1.0, twigColor: '#5a4c3e',
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  // Hand-built mip chain: each atlas quadrant is downsampled on its own so the opaque
  // bark never bleeds into the leaf cards at distance, and foliage alpha is boosted
  // slightly per level so crowns keep their density far away.
  tex.mipmaps = buildMips(c, 1.12);
  tex.generateMipmaps = false;
  return tex;
}

function buildMips(c, alphaBoost) {
  const mips = [c];
  let size = c.width;
  while (size > 1) {
    const prev = mips[mips.length - 1];
    const ps = prev.width;
    size = Math.max(1, size >> 1);
    const m = document.createElement('canvas');
    m.width = m.height = size;
    const mg = m.getContext('2d', { willReadFrequently: true });
    mg.imageSmoothingEnabled = true;
    mg.imageSmoothingQuality = 'high';
    if (size >= 2) {
      const h = ps / 2, hs = size / 2;
      for (const [qx, qy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) mg.drawImage(prev, qx * h, qy * h, h, h, qx * hs, qy * hs, hs, hs);
      if (size >= 4 && alphaBoost !== 1) {
        const id = mg.getImageData(0, 0, size, size);
        const d = id.data;
        for (let i = 3; i < d.length; i += 4) d[i] = Math.min(255, d[i] * alphaBoost);
        mg.putImageData(id, 0, 0);
      }
    } else {
      mg.drawImage(prev, 0, 0, ps, ps, 0, 0, 1, 1);
    }
    mips.push(m);
  }
  return mips;
}

/** Grass blade card texture (alpha): many tapered blades rising from the bottom edge. */
export function createGrassTexture() {
  const W = 512, Hh = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = Hh;
  const g = c.getContext('2d');
  const rnd = mulberry32(9090);
  g.clearRect(0, 0, W, Hh);
  for (let i = 0; i < 110; i++) {
    const x = 16 + rnd() * (W - 32);
    const h = Hh * (0.22 + Math.pow(rnd(), 0.7) * 0.74);
    const lean = (rnd() - 0.5) * 80;
    const w = 1.6 + rnd() * 2.2;
    const dry = rnd() < 0.12;
    const base = dry ? [104, 96, 62] : [56, 74, 34];
    const tip = dry ? [158, 146, 96] : [94 + rnd() * 26, 122 + rnd() * 22, 48 + rnd() * 14];
    const grad = g.createLinearGradient(0, Hh, 0, Hh - h);
    grad.addColorStop(0, `rgb(${base[0]},${base[1]},${base[2]})`);
    grad.addColorStop(1, `rgb(${tip[0] | 0},${tip[1] | 0},${tip[2] | 0})`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x - w, Hh);
    g.quadraticCurveTo(x - w * 0.4 + lean * 0.45, Hh - h * 0.55, x + lean, Hh - h);
    g.quadraticCurveTo(x + w * 0.4 + lean * 0.45, Hh - h * 0.55, x + w, Hh);
    g.closePath();
    g.fill();
  }
  // a few thin seed stalks
  for (let i = 0; i < 10; i++) {
    const x = 20 + rnd() * (W - 40), h = Hh * (0.78 + rnd() * 0.18);
    const tx = x + (rnd() - 0.5) * 30;
    g.strokeStyle = 'rgb(128,120,76)'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(x, Hh); g.quadraticCurveTo(x + 6, Hh - h * 0.5, tx, Hh - h); g.stroke();
    g.strokeStyle = 'rgb(150,138,92)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(tx, Hh - h); g.lineTo(tx + (rnd() - 0.5) * 4, Hh - h + 14); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  return tex;
}

// UV inset inside each atlas region so mip levels never sample the neighbouring region
const PAD = 0.03;
function regionUV(geo, region) {
  const uv = geo.attributes.uv;
  const [u0, v0, u1, v1] = [region[0] + PAD, region[1] + PAD, region[2] - PAD, region[3] - PAD];
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return geo;
}

function setColor(geo, color, jitter, rnd, darkenBottom = 0, yMin = 0, yMax = 1) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const pos = geo.attributes.position;
  for (let i = 0; i < n; i++) {
    const t = Math.max(0, Math.min(1, (pos.getY(i) - yMin) / Math.max(0.001, yMax - yMin)));
    const k = (1 + (rnd() - 0.5) * jitter) * (1 - darkenBottom * (1 - t));
    arr[i * 3] = c.r * k; arr[i * 3 + 1] = c.g * k; arr[i * 3 + 2] = c.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function prep(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
  return g;
}

function trunkGeo(height, r0, r1, segs, rnd, bendX = 0) {
  const g = new THREE.CylinderGeometry(r1, r0, height, segs, 5, true);
  g.translate(0, height / 2, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / height;
    // root flare at the base and a gentle bend
    const flare = 1 + Math.max(0, 0.12 - y) * 3.5;
    pos.setX(i, pos.getX(i) * flare + Math.sin(y * 2.2) * bendX);
    pos.setZ(i, pos.getZ(i) * flare);
  }
  g.computeVertexNormals();
  // bark runs once up the trunk and once around it (no wrap seams)
  regionUV(g, ATLAS.bark);
  setColor(g, '#ffffff', 0.15, rnd, 0.4, 0, height);
  return prep(g);
}

/** Tapered branch cylinder from point a to point b. */
function branchGeo(a, b, r0, r1, segs, color, rnd) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1, true);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  regionUV(g, ATLAS.bark);
  setColor(g, color, 0.1, rnd);
  return prep(g);
}

/**
 * Crossed card cluster at centre c with size s. Normals blend the crown direction with
 * the cluster's own sphere so each lobe shades separately.
 */
function cluster(c, s, region, color, rnd, crownCentre, cards = 3, tilt = 0.9) {
  const parts = [];
  for (let k = 0; k < cards; k++) {
    const q = new THREE.PlaneGeometry(s, s);
    regionUV(q, region);
    q.rotateY((k / cards) * Math.PI + rnd() * 0.5);
    q.rotateX((rnd() - 0.5) * tilt);
    q.translate(c.x, c.y, c.z);
    parts.push(q.toNonIndexed());
  }
  // a horizontal card so clusters read from below and above
  if (cards >= 3 && s > 2.0) {
    const h = new THREE.PlaneGeometry(s * 0.85, s * 0.85);
    regionUV(h, region);
    h.rotateX(-Math.PI / 2 + (rnd() - 0.5) * 0.5);
    h.rotateY(rnd() * Math.PI);
    h.translate(c.x, c.y + s * 0.05, c.z);
    parts.push(h.toNonIndexed());
  }
  const g = mergeGeometries(parts);
  const pos = g.attributes.position, nor = g.attributes.normal;
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  const crownDir = new THREE.Vector3(c.x - crownCentre.x, (c.y - crownCentre.y) * 0.8, c.z - crownCentre.z);
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i) - crownCentre.x, (pos.getY(i) - crownCentre.y) * 0.8 + 0.5, pos.getZ(i) - crownCentre.z).normalize();
    w.set(pos.getX(i) - c.x, pos.getY(i) - c.y + s * 0.25, pos.getZ(i) - c.z).normalize();
    v.lerp(w, 0.45).normalize();
    nor.setXYZ(i, v.x, v.y, v.z);
  }
  setColor(g, color, 0.22, rnd);
  // interior darkening: clusters deep in the crown and on its underside are darker
  const col = g.attributes.color;
  const depth = Math.min(1, crownDir.length() / 3.5);
  const under = Math.max(0, -crownDir.y / 3);
  for (let i = 0; i < pos.count; i++) {
    const local = (pos.getY(i) - c.y) / s + 0.5; // 0 bottom .. 1 top of cluster
    const k = (0.62 + depth * 0.3 + local * 0.14) * (1 - under * 0.25);
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  return g;
}

export function makePine(variant, detail) {
  const rnd = mulberry32(100 + variant);
  const parts = [];
  const H = variant === 0 ? 17 : 12.5;
  parts.push(trunkGeo(H * 0.94, 0.36, 0.06, detail === 'full' ? 8 : 5, rnd));
  const tiers = detail === 'full' ? (variant === 0 ? 12 : 10) : 6;
  const perTier = detail === 'full' ? 7 : 4;
  const crown = new THREE.Vector3(0, H * 0.55, 0);
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = H * (0.22 + t * 0.73);
    // slightly irregular, narrower spruce-like profile with a few gaps
    const r = (variant === 0 ? 3.0 : 3.4) * Math.pow(1 - t, 0.9) * (0.88 + rnd() * 0.24) + 0.3;
    for (let k = 0; k < perTier; k++) {
      if (detail === 'full' && rnd() < 0.08) continue;
      const a = (k / perTier) * Math.PI * 2 + i * 0.7 + rnd() * 0.5;
      const w = r * (0.75 + rnd() * 0.25);
      for (const roll of [-0.55, 0.55]) {
        const q = new THREE.PlaneGeometry(r * 1.15, w);
        regionUV(q, ATLAS.pine);
        q.translate(r * 0.575, 0, 0);
        q.rotateX(-Math.PI / 2 + roll);
        q.rotateZ(-0.3 - rnd() * 0.22 - t * 0.1);
        q.rotateY(a);
        q.translate(0, y, 0);
        const g = q.toNonIndexed();
        const pos = g.attributes.position, nor = g.attributes.normal;
        for (let j = 0; j < pos.count; j++) {
          const v = new THREE.Vector3(pos.getX(j), (pos.getY(j) - crown.y) * 0.35 + 1.0, pos.getZ(j)).normalize();
          nor.setXYZ(j, v.x, v.y, v.z);
        }
        setColor(g, variant === 0 ? '#84a066' : '#93ac70', 0.22, rnd, 0, 0, 1);
        const col = g.attributes.color;
        const shade = 0.55 + t * 0.45;
        for (let j = 0; j < pos.count; j++) col.setXYZ(j, col.getX(j) * shade, col.getY(j) * shade, col.getZ(j) * shade);
        parts.push(g);
      }
    }
  }
  // a few dead lower branches on the bare trunk
  if (detail === 'full') {
    for (let i = 0; i < 6; i++) {
      const y = H * (0.1 + rnd() * 0.12);
      const a = rnd() * Math.PI * 2;
      const L = 0.8 + rnd() * 1.0;
      parts.push(branchGeo(new THREE.Vector3(0, y, 0), new THREE.Vector3(Math.cos(a) * L, y - 0.2, Math.sin(a) * L), 0.035, 0.01, 3, '#b8aca0', rnd));
    }
  }
  const top = new THREE.PlaneGeometry(1.2, 2.4);
  regionUV(top, ATLAS.pine);
  top.rotateZ(Math.PI / 2);
  top.translate(0, H * 0.97, 0);
  setColor(top, '#6e8a52', 0.1, rnd);
  parts.push(prep(top));
  const geo = mergeGeometries(parts.map(prep));
  geo.computeBoundingSphere();
  return geo;
}

/** Broadleaf tree on a branch skeleton. variant 0 = oak/lime type, 1 = birch. */
export function makeBroadleaf(variant, detail) {
  const rnd = mulberry32(200 + variant);
  const parts = [];
  const birch = variant === 1;
  const full = detail === 'full';
  const H = birch ? 12 : 10.5;
  const trunkH = H * (birch ? 0.62 : 0.5);
  const trunk = trunkGeo(trunkH + 0.4, birch ? 0.2 : 0.4, birch ? 0.11 : 0.24, full ? 8 : 5, rnd, birch ? 0.12 : 0.2);
  if (birch) {
    // pale bark with dark bands
    const col = trunk.attributes.color, pos = trunk.attributes.position;
    for (let i = 0; i < col.count; i++) {
      const band = Math.sin(pos.getY(i) * 5.3 + pos.getX(i) * 9) > 0.82 ? 0.45 : 1;
      col.setXYZ(i, 2.1 * band, 2.05 * band, 1.95 * band);
    }
  }
  parts.push(trunk);
  const barkCol = birch ? '#e6e2da' : '#ffffff';
  const leafCol = birch ? '#bfcc96' : '#a6bd7e';
  const region = birch ? ATLAS.birch : ATLAS.leaf;
  const tips = [];
  const primaries = birch ? 6 : 5;
  const base = new THREE.Vector3(0, trunkH, 0);
  for (let i = 0; i < primaries; i++) {
    const az = (i / primaries) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
    const elev = birch ? 0.95 + rnd() * 0.35 : 0.55 + rnd() * 0.45;
    const L = (birch ? 4.2 : 4.4) * (0.8 + rnd() * 0.4);
    const start = base.clone().add(new THREE.Vector3(0, (rnd() - 0.3) * (birch ? 2.2 : 1.2), 0));
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
    const end = start.clone().addScaledVector(dir, L);
    if (birch) end.y -= 0.6; // drooping tips
    parts.push(branchGeo(start, end, birch ? 0.09 : 0.15, 0.04, full ? 5 : 3, barkCol, rnd));
    tips.push({ p: end, s: 1 });
    tips.push({ p: start.clone().lerp(end, 0.55).add(new THREE.Vector3(0, 0.5, 0)), s: 0.85 });
    // secondaries
    const nSec = full ? 2 : 1;
    for (let k = 0; k < nSec; k++) {
      const from = start.clone().lerp(end, 0.45 + rnd() * 0.3);
      const a2 = az + (k ? 0.7 : -0.7) + (rnd() - 0.5) * 0.3;
      const e2 = elev + 0.25 + rnd() * 0.2;
      const d2 = new THREE.Vector3(Math.cos(a2) * Math.cos(e2), Math.sin(e2), Math.sin(a2) * Math.cos(e2));
      const to = from.clone().addScaledVector(d2, L * (0.45 + rnd() * 0.2));
      if (full) parts.push(branchGeo(from, to, 0.06, 0.025, 4, barkCol, rnd));
      tips.push({ p: to, s: 0.9 });
    }
  }
  // leader continuing up the middle
  const leaderTop = new THREE.Vector3((rnd() - 0.5) * 0.6, H * 0.97, (rnd() - 0.5) * 0.6);
  parts.push(branchGeo(base, leaderTop, birch ? 0.1 : 0.16, 0.04, full ? 5 : 3, barkCol, rnd));
  tips.push({ p: leaderTop, s: 1.1 });
  tips.push({ p: base.clone().lerp(leaderTop, 0.6), s: 0.9 });
  const crown = tips.reduce((acc, t) => acc.add(t.p), new THREE.Vector3()).multiplyScalar(1 / tips.length);
  const sz = birch ? 2.3 : 3.0;
  for (const t of tips) {
    const s = sz * t.s * (0.8 + rnd() * 0.4) * (full ? 1 : 1.3);
    parts.push(cluster(t.p, s, region, leafCol, rnd, crown, full ? 3 : 2));
    // a satellite cluster offset outward on full detail fills the crown without blobbing it
    if (full && rnd() < 0.45) {
      const out = t.p.clone().sub(crown).setY(0).normalize().multiplyScalar(s * 0.35);
      const p2 = t.p.clone().add(out).add(new THREE.Vector3((rnd() - 0.5) * 0.8, -s * 0.3, (rnd() - 0.5) * 0.8));
      parts.push(cluster(p2, s * 0.75, region, leafCol, rnd, crown, 2));
    }
  }
  const geo = mergeGeometries(parts.map(prep));
  geo.computeBoundingSphere();
  return geo;
}

export function makeDeadTree(detail) {
  const rnd = mulberry32(301);
  const parts = [trunkGeo(7.5, 0.3, 0.06, detail === 'full' ? 7 : 4, rnd, 0.3)];
  const n = detail === 'full' ? 9 : 4;
  for (let i = 0; i < n; i++) {
    const y = 2.4 + rnd() * 4.4;
    const a = rnd() * Math.PI * 2, e = 0.3 + rnd() * 0.8;
    const L = 1.4 + rnd() * 2.2;
    const s = new THREE.Vector3(0, y, 0);
    const end = s.clone().add(new THREE.Vector3(Math.cos(a) * Math.cos(e) * L, Math.sin(e) * L, Math.sin(a) * Math.cos(e) * L));
    parts.push(branchGeo(s, end, 0.08, 0.02, detail === 'full' ? 4 : 3, '#c8c0b8', rnd));
    if (detail === 'full' && rnd() < 0.6) {
      const m = s.clone().lerp(end, 0.6);
      const e2 = new THREE.Vector3(Math.cos(a + 0.6) * 0.8, 0.7, Math.sin(a + 0.6) * 0.8).add(m);
      parts.push(branchGeo(m, e2, 0.035, 0.01, 3, '#c8c0b8', rnd));
    }
  }
  const col = parts[0].attributes.color;
  for (let i = 0; i < col.count; i++) col.setXYZ(i, col.getX(i) * 1.15, col.getY(i) * 1.1, col.getZ(i) * 1.05);
  const geo = mergeGeometries(parts.map(prep));
  geo.computeBoundingSphere();
  return geo;
}

export function makeBush(detail) {
  const rnd = mulberry32(401);
  const parts = [];
  const crown = new THREE.Vector3(0, 0.55, 0);
  const n = detail === 'full' ? 9 : 5;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = 0.3 + rnd() * 0.8;
    const c = new THREE.Vector3(Math.cos(a) * r, 0.45 + rnd() * 0.7, Math.sin(a) * r);
    if (detail === 'full') parts.push(branchGeo(new THREE.Vector3(0, 0, 0), c, 0.04, 0.015, 3, '#ffffff', rnd));
    parts.push(cluster(c, 1.3 + rnd() * 0.7, ATLAS.leaf, '#96aa74', rnd, crown, detail === 'full' ? 3 : 2));
  }
  const geo = mergeGeometries(parts.map(prep));
  geo.computeBoundingSphere();
  return geo;
}

export function makeRock(large, detail) {
  const rnd = mulberry32(large ? 501 : 502);
  const r = large ? 2.2 : 0.7;
  let g = new THREE.IcosahedronGeometry(r, detail === 'full' ? 2 : 1);
  g = mergeVerticesSimple(g);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let k = 1 + Math.sin(x * 2.1 + z * 1.3) * 0.12 + Math.sin(y * 3.3 + x) * 0.08 + Math.sin(x * 7 + y * 5 + z * 3) * 0.04;
    // flattened facets like fractured stone
    if (y > r * 0.35) k *= 0.92;
    pos.setXYZ(i, x * k * 1.25, y * k * (large ? 0.7 : 0.55), z * k);
  }
  g.translate(0, r * 0.15, 0);
  g.computeVertexNormals();
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uv[i * 2] = (pos.getX(i) + pos.getZ(i)) * 0.35; uv[i * 2 + 1] = pos.getY(i) * 0.35; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  setColor(g, large ? '#b0aa9e' : '#a29c90', 0.12, rnd, 0.45, -r * 0.5, r);
  // moss on top surfaces
  const nor = g.attributes.normal, col = g.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const m = Math.max(0, nor.getY(i) - 0.55) * 1.6 * (0.6 + rnd() * 0.4);
    col.setXYZ(i, col.getX(i) * (1 - m * 0.35), col.getY(i) * (1 - m * 0.12), col.getZ(i) * (1 - m * 0.5));
  }
  const geo = prep(g);
  geo.computeBoundingSphere();
  return geo;
}

function mergeVerticesSimple(geo) {
  const pos = geo.attributes.position;
  const map = new Map();
  const verts = [];
  const index = [];
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let k = map.get(key);
    if (k === undefined) { k = verts.length / 3; map.set(key, k); verts.push(pos.getX(i), pos.getY(i), pos.getZ(i)); }
    index.push(k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(index);
  return g;
}

export function makeLog(detail) {
  const rnd = mulberry32(601);
  const g = new THREE.CylinderGeometry(0.32, 0.38, 6, detail === 'full' ? 9 : 5, 1, false);
  g.rotateZ(Math.PI / 2);
  g.translate(0, 0.3, 0);
  regionUV(g, ATLAS.bark);
  setColor(g, '#d0c8bc', 0.12, rnd);
  const parts = [prep(g)];
  if (detail === 'full') {
    // broken branch stubs
    for (let i = 0; i < 3; i++) {
      const x = -2 + i * 1.8;
      parts.push(branchGeo(new THREE.Vector3(x, 0.45, 0), new THREE.Vector3(x + 0.3, 0.9 + rnd() * 0.4, (rnd() - 0.5) * 0.6), 0.06, 0.02, 4, '#c0b8ac', rnd));
    }
  }
  const geo = mergeGeometries(parts);
  geo.computeBoundingSphere();
  return geo;
}

/** Far impostors: crossed cards for broadleaf, a few tiers for pines. */
export function makeFarTree(pine) {
  const rnd = mulberry32(pine ? 701 : 702);
  const parts = [];
  if (pine) {
    for (const [y, w, h] of [[5, 5.0, 7], [9, 3.5, 6], [12.5, 2, 4.5]]) {
      for (let k = 0; k < 2; k++) {
        const q = new THREE.PlaneGeometry(w, h);
        regionUV(q, ATLAS.pine);
        q.rotateZ(Math.PI / 2);
        q.rotateY(k * Math.PI / 2);
        q.translate(0, y, 0);
        setColor(q, '#4a6040', 0.15, rnd, 0.4, y - h / 2, y + h / 2);
        parts.push(prep(q));
      }
    }
  } else {
    // a few lobes on crossed planes approximate the branchy crown outline
    for (const [x, y, s] of [[0, 7.4, 4.6], [-1.6, 6.2, 3.6], [1.7, 6.4, 3.8], [0.3, 5.2, 3.4]]) {
      for (let k = 0; k < 2; k++) {
        const q = new THREE.PlaneGeometry(s, s);
        regionUV(q, ATLAS.leaf);
        q.translate(x, y, 0);
        q.rotateY((k / 2) * Math.PI + 0.4);
        setColor(q, '#8ea274', 0.15, rnd, 0.4, 3.3, 10.3);
        parts.push(prep(q));
      }
    }
    const t = new THREE.PlaneGeometry(0.5, 4.5);
    regionUV(t, ATLAS.bark);
    t.translate(0, 2.2, 0);
    parts.push(prep(t));
  }
  const geo = mergeGeometries(parts);
  const nor = geo.attributes.normal;
  for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0, 1, 0);
  geo.computeBoundingSphere();
  return geo;
}

/** Grass clump: three crossed alpha cards (blade texture); normals point up so the
 *  grass is lit like the ground it grows from. */
export function makeGrassClump() {
  const parts = [];
  const rnd = mulberry32(801);
  for (let k = 0; k < 3; k++) {
    const q = new THREE.PlaneGeometry(0.95, 0.48);
    q.translate(0, 0.24, 0);
    q.rotateY((k / 3) * Math.PI + rnd() * 0.3);
    parts.push(q.toNonIndexed());
  }
  const g = mergeGeometries(parts);
  const pos = g.attributes.position, nor = g.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    nor.setXYZ(i, 0, 1, 0);
    const t = pos.getY(i) / 0.48;
    const k = 0.78 + t * 0.3; // slightly darker at the roots
    col[i * 3] = k; col[i * 3 + 1] = k; col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/** Single fern frond (alpha) on a 256x512 canvas: stem from the bottom centre to the top. */
export function createFernTexture() {
  const W = 256, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const rnd = mulberry32(7711);
  g.clearRect(0, 0, W, H);
  const pts = [];
  for (let k = 0; k <= 40; k++) {
    const t = k / 40;
    pts.push([W / 2 + Math.sin(t * 2.2) * 18 * t, H - 8 - t * (H - 24)]);
  }
  g.strokeStyle = '#4a5a2a'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts) g.lineTo(p[0], p[1]);
  g.stroke();
  for (let k = 3; k < 40; k++) {
    const t = k / 40;
    const [x, y] = pts[k];
    const len = (W * 0.42) * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.95) * (0.85 + rnd() * 0.2);
    for (const side of [-1, 1]) {
      // pinna: a tapered leaflet with notched edges
      const ang = side * (1.15 - t * 0.35);
      const ex = x + Math.sin(ang) * len, ey = y - Math.cos(ang) * len * 0.45;
      const shade = 0.75 + rnd() * 0.35;
      g.fillStyle = `rgb(${(70 + t * 30) * shade | 0},${(104 + t * 26) * shade | 0},${(38 + t * 12) * shade | 0})`;
      g.beginPath();
      g.moveTo(x, y);
      const segs = 7;
      for (let q = 1; q <= segs; q++) {
        const u = q / segs;
        const w = 7 * (1 - u) + 1.5;
        g.lineTo(x + (ex - x) * u, y + (ey - y) * u - w * (q % 2 ? 1 : 0.4));
      }
      for (let q = segs; q >= 0; q--) {
        const u = q / segs;
        const w = 7 * (1 - u) + 1.5;
        g.lineTo(x + (ex - x) * u, y + (ey - y) * u + w * (q % 2 ? 1 : 0.4));
      }
      g.closePath();
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

/** Fern clump: fronds radiating from the centre and arching outward. */
export function makeFern() {
  const rnd = mulberry32(912);
  const parts = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const q = new THREE.PlaneGeometry(0.42, 1.0, 1, 3);
    q.translate(0, 0.5, 0);
    // arch: bend the upper rows outward and down
    const pos = q.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k);
      pos.setZ(k, y * y * 0.35);
      pos.setY(k, y * (1 - y * 0.2));
    }
    q.rotateX(-0.75 - rnd() * 0.3);
    q.rotateY((i / n) * Math.PI * 2 + rnd() * 0.4);
    parts.push(q.toNonIndexed());
  }
  const g = mergeGeometries(parts);
  const pos = g.attributes.position, nor = g.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    nor.setXYZ(i, pos.getX(i) * 0.4, 1, pos.getZ(i) * 0.4);
    const k = 0.7 + Math.min(1, Math.hypot(pos.getX(i), pos.getZ(i))) * 0.35;
    col[i * 3] = k; col[i * 3 + 1] = k; col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/** Round hay bale lying on its side (uses the hay material, not the atlas). */
export function makeHayBale(detail) {
  const g = new THREE.CylinderGeometry(0.75, 0.75, 1.2, detail === 'full' ? 20 : 10, 1, false);
  g.rotateZ(Math.PI / 2);
  g.translate(0, 0.72, 0);
  const pos = g.attributes.position;
  // slightly squashed and bulging like a settled bale
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) - 0.72;
    pos.setY(i, 0.72 + y * (y < 0 ? 0.92 : 1));
    pos.setX(i, pos.getX(i) * (1 + 0.04 * Math.cos(y * 2)));
  }
  g.computeVertexNormals();
  const ng = g.toNonIndexed();
  const col = new Float32Array(ng.attributes.position.count * 3);
  for (let i = 0; i < ng.attributes.position.count; i++) {
    const k = 0.75 + (ng.attributes.position.getY(i) / 1.5) * 0.3;
    col[i * 3] = k; col[i * 3 + 1] = k; col[i * 3 + 2] = k;
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  ng.computeBoundingSphere();
  return ng;
}
