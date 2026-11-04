import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Materials } from '../engine/Materials.js';

// Accumulates textured primitives (boxes, cylinders, prisms) by material and merges
// them into one multi-material mesh. UVs are written in metres / material tile size.
// Per-face vertex colour shading is used as cheap baked lighting (darker interiors).

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();

export class BoxBuilder {
  constructor(materials) {
    this.materials = materials;
    this.byMat = new Map();
  }

  _push(mat, geo) {
    if (!this.byMat.has(mat)) this.byMat.set(mat, []);
    this.byMat.get(mat).push(geo);
  }

  /**
   * Box centred at (x,y,z) with size (w,h,d).
   * opts: rotY/rotX/rotZ, shade (number) or faceShade [px,nx,py,ny,pz,nz], uvOffset
   */
  box(mat, x, y, z, w, h, d, opts = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    const tile = mat === 'glass' || mat === 'glass_dirty' || mat === 'emissive_lamp' ? 1 : Materials.tile(mat);
    const uv = g.attributes.uv;
    const off = opts.uvOffset ?? (x * 0.37 + z * 0.61 + y * 0.13) / tile;
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z ; 4 verts each
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      const [du, dv] = dims[f];
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, uv.getX(i) * du / tile + off, uv.getY(i) * dv / tile + (f < 2 || f > 3 ? (y - h / 2) / tile : 0));
      }
    }
    const shade = opts.faceShade || null;
    const base = opts.shade ?? 1;
    const tint = opts.tint || null;
    const col = new Float32Array(24 * 3);
    for (let f = 0; f < 6; f++) {
      const s = shade ? shade[f] : base;
      for (let k = 0; k < 4; k++) {
        const i = (f * 4 + k) * 3;
        col[i] = s * (tint ? tint[0] : 1); col[i + 1] = s * (tint ? tint[1] : 1); col[i + 2] = s * (tint ? tint[2] : 1);
      }
    }
    // darken bottom vertices slightly (contact shadow)
    if (opts.ao !== false && h > 0.5) {
      const pos = g.attributes.position;
      for (let i = 0; i < 24; i++) {
        if (pos.getY(i) < 0) {
          col[i * 3] *= 0.82; col[i * 3 + 1] *= 0.82; col[i * 3 + 2] *= 0.82;
        }
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // indoor mask (1 = surface inside a building): dims sky light and reflections
    const ind = new Float32Array(24);
    for (let f = 0; f < 6; f++) {
      const v = opts.indoor ? 1 : shade && shade[f] < 0.8 ? 1 : 0;
      for (let k = 0; k < 4; k++) ind[f * 4 + k] = v;
    }
    g.setAttribute('indoor', new THREE.BufferAttribute(ind, 1));
    // 'YXZ' order: local tilt (X/Z) first, then building yaw (Y)
    _e.set(opts.rotX || 0, opts.rotY || 0, opts.rotZ || 0, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    this._push(mat, g.toNonIndexed());
    return this;
  }

  cylinder(mat, x, y, z, rTop, rBot, h, segs = 12, opts = {}) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, segs, 1, !!opts.open);
    const tile = Materials.tile(mat);
    const uv = g.attributes.uv;
    const circ = Math.PI * 2 * Math.max(rTop, rBot);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * circ) / tile, (uv.getY(i) * h) / tile);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3).fill(opts.shade ?? 1);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('indoor', new THREE.BufferAttribute(new Float32Array(n).fill(opts.indoor ? 1 : 0), 1));
    _e.set(opts.rotX || 0, opts.rotY || 0, opts.rotZ || 0, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    this._push(mat, g.toNonIndexed());
    return this;
  }

  sphere(mat, x, y, z, r, opts = {}) {
    const g = new THREE.SphereGeometry(r, opts.segs || 16, opts.rings || 10, 0, Math.PI * 2, 0, opts.hemi ? Math.PI / 2 : Math.PI);
    const tile = Materials.tile(mat);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * Math.PI * 2 * r) / tile, (uv.getY(i) * Math.PI * r) / tile);
    const n = g.attributes.position.count;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(opts.shade ?? 1), 3));
    g.setAttribute('indoor', new THREE.BufferAttribute(new Float32Array(n).fill(opts.indoor ? 1 : 0), 1));
    g.translate(x, y, z);
    this._push(mat, g.toNonIndexed());
    return this;
  }

  /** Triangular prism (gable) along Z: base width w at y, apex height h, length d. */
  gable(mat, x, y, z, w, h, d, opts = {}) {
    const hw = w / 2, hd = d / 2;
    const tile = Materials.tile(mat);
    const v = [
      // front triangle (+z)
      -hw, 0, hd, hw, 0, hd, 0, h, hd,
      // back triangle (-z)
      hw, 0, -hd, -hw, 0, -hd, 0, h, -hd,
    ];
    const uvs = [0, 0, w / tile, 0, hw / tile, h / tile, 0, 0, w / tile, 0, hw / tile, h / tile];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    const col = new Float32Array(6 * 3).fill(opts.shade ?? 1);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('indoor', new THREE.BufferAttribute(new Float32Array(6), 1));
    _e.set(0, opts.rotY || 0, 0);
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    this._push(mat, g);
    return this;
  }

  /** Merge an arbitrary non-indexed geometry (must have position, normal, uv, color). */
  raw(mat, geo) {
    this._push(mat, geo);
    return this;
  }

  get empty() {
    return this.byMat.size === 0;
  }

  build() {
    const geos = [];
    const mats = [];
    for (const [mat, list] of this.byMat) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) continue;
      geos.push(merged);
      mats.push(this.materials.get(mat));
    }
    const geo = mergeGeometries(geos, true);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    for (const g of geos) g.dispose();
    for (const list of this.byMat.values()) for (const g of list) g.dispose();
    this.byMat.clear();
    return new THREE.Mesh(geo, mats);
  }
}
