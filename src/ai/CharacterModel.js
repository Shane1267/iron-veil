import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildWeaponModel } from '../weapons/WeaponModels.js';
import { clamp, damp, lerp } from '../core/MathUtil.js';

// Procedural humanoid built as a single SkinnedMesh (one draw call per NPC). Each body
// part is rigidly bound to one bone; clothing and gear colours come from vertex colours.
// Animation is procedural: walk/run cycles, aiming, crouching, reloading, flinches and a
// physically-flavoured death fall.

const BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'shL', 'armL', 'foreL', 'handL', 'shR', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const PARENT = { hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', shL: 'chest', armL: 'shL', foreL: 'armL', handL: 'foreL', shR: 'chest', armR: 'shR', foreR: 'armR', handR: 'foreR', thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR' };
// bind-pose local offsets (metres)
const OFFSET = {
  root: [0, 0, 0], hips: [0, 0.95, 0], spine: [0, 0.12, 0], chest: [0, 0.2, 0], neck: [0, 0.24, 0], head: [0, 0.1, 0],
  shL: [-0.19, 0.18, 0], armL: [0, 0, 0], foreL: [0, -0.29, 0], handL: [0, -0.26, 0],
  shR: [0.19, 0.18, 0], armR: [0, 0, 0], foreR: [0, -0.29, 0], handR: [0, -0.26, 0],
  thighL: [-0.1, -0.05, 0], shinL: [0, -0.43, 0], footL: [0, -0.42, 0],
  thighR: [0.1, -0.05, 0], shinR: [0, -0.43, 0], footR: [0, -0.42, 0],
};

const _c = new THREE.Color();

function part(geo, color, boneIdx, bindPos, rot = null) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot));
  g.translate(bindPos.x, bindPos.y, bindPos.z);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = boneIdx; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

const geoCache = new Map();
let sharedMaterial = null;

function bodyMaterial(materials) {
  if (sharedMaterial) return sharedMaterial;
  // plain vertex colours: the canvas albedo is dark olive and would multiply every uniform
  // colour down to near-black (and some parts carry no UVs for a normal map)
  void materials;
  sharedMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.02 });
  return sharedMaterial;
}

/**
 * look: {uniform, accent, skin, helmet, vest, pack, cap, mask}
 */
function buildBodyGeometry(look) {
  const key = JSON.stringify(look);
  if (geoCache.has(key)) return geoCache.get(key);
  // bind pose world positions of bones
  const world = {};
  for (const b of BONES) {
    const p = PARENT[b] ? world[PARENT[b]].clone() : new THREE.Vector3();
    world[b] = p.add(new THREE.Vector3(...OFFSET[b]));
  }
  const bi = (n) => BONES.indexOf(n);
  const W = (n, x = 0, y = 0, z = 0) => world[n].clone().add(new THREE.Vector3(x, y, z));
  const U = look.uniform, A = look.accent, S = look.skin;
  // trousers a shade darker than the jacket; webbing/boots/gloves in neutral darks
  const T = '#' + new THREE.Color(U).multiplyScalar(0.82).getHexString();
  const WEB = '#2c2a26', BOOT = '#1e1b18';
  const parts = [];
  const cap = (r, len, segs = 8) => new THREE.CapsuleGeometry(r, len, 3, segs);
  const rb = (w, h, d) => new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  // torso & pelvis
  parts.push(part(rb(0.34, 0.2, 0.21), T, bi('hips'), W('hips', 0, 0.04, 0)));
  parts.push(part(cap(0.15, 0.16, 10), U, bi('spine'), W('spine', 0, 0.08, 0), new THREE.Euler(0, 0, 0)));
  parts.push(part(cap(0.17, 0.12, 10), U, bi('chest'), W('chest', 0, 0.12, 0), new THREE.Euler(0, 0, Math.PI / 2)));
  parts.push(part(rb(0.38, 0.22, 0.22), U, bi('chest'), W('chest', 0, 0.08, 0)));
  parts.push(part(rb(0.16, 0.05, 0.14), U, bi('chest'), W('chest', 0, 0.26, -0.01))); // collar
  // gear
  if (look.vest) {
    parts.push(part(rb(0.4, 0.34, 0.27), A, bi('chest'), W('chest', 0, 0.08, 0)));
    // three rifle magazine pouches and an admin pouch above
    for (const x of [-0.11, 0, 0.11]) parts.push(part(rb(0.09, 0.13, 0.06), A, bi('chest'), W('chest', x, -0.02, -0.165)));
    parts.push(part(rb(0.2, 0.07, 0.04), WEB, bi('chest'), W('chest', 0, 0.11, -0.15)));
    // shoulder straps and side pouches
    for (const x of [-0.13, 0.13]) parts.push(part(rb(0.07, 0.05, 0.3), A, bi('chest'), W('chest', x, 0.25, 0)));
    for (const x of [-0.2, 0.2]) parts.push(part(rb(0.06, 0.12, 0.1), A, bi('chest'), W('chest', x, 0.0, 0.0)));
    // radio pouch with antenna
    parts.push(part(rb(0.07, 0.12, 0.06), WEB, bi('chest'), W('chest', -0.16, 0.12, 0.15)));
    parts.push(part(new THREE.CylinderGeometry(0.004, 0.004, 0.3, 4), '#111111', bi('chest'), W('chest', -0.17, 0.33, 0.15)));
  }
  if (look.pack) {
    parts.push(part(rb(0.32, 0.42, 0.18), look.packColor || A, bi('chest'), W('chest', 0, 0.06, 0.2)));
    parts.push(part(rb(0.26, 0.14, 0.06), look.packColor || A, bi('chest'), W('chest', 0, -0.06, 0.31))); // lower pocket
    if (!look.vest) for (const x of [-0.12, 0.12]) parts.push(part(rb(0.05, 0.4, 0.02), WEB, bi('chest'), W('chest', x, 0.1, -0.12)));
  }
  parts.push(part(rb(0.36, 0.05, 0.23), WEB, bi('hips'), W('hips', 0, 0.12, 0))); // belt
  parts.push(part(rb(0.05, 0.04, 0.02), '#5a5448', bi('hips'), W('hips', 0, 0.12, -0.12))); // buckle
  // neck & head
  parts.push(part(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 10), S, bi('neck'), W('neck', 0, 0.02, 0)));
  const head = new THREE.SphereGeometry(0.11, 14, 12);
  head.scale(0.9, 1.08, 1.0);
  const skinOrMask = look.mask ? '#2a2826' : S;
  parts.push(part(head, skinOrMask, bi('head'), W('head', 0, 0.1, 0)));
  parts.push(part(rb(0.13, 0.06, 0.1), skinOrMask, bi('head'), W('head', 0, 0.035, -0.04))); // jaw
  for (const x of [-0.1, 0.1]) parts.push(part(rb(0.02, 0.05, 0.035), skinOrMask, bi('head'), W('head', x, 0.1, 0.0))); // ears
  parts.push(part(rb(0.03, 0.045, 0.04), skinOrMask, bi('head'), W('head', 0, 0.085, -0.115))); // nose
  if (!look.mask) parts.push(part(rb(0.12, 0.02, 0.02), '#1a1614', bi('head'), W('head', 0, 0.13, -0.1))); // brow shadow
  else parts.push(part(rb(0.1, 0.025, 0.02), S, bi('head'), W('head', 0, 0.125, -0.105))); // eye slit skin
  if (look.helmet) {
    const hc = look.helmetColor || A;
    const h = new THREE.SphereGeometry(0.138, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
    parts.push(part(h, hc, bi('head'), W('head', 0, 0.12, 0.005)));
    const rim = new THREE.CylinderGeometry(0.15, 0.155, 0.025, 14, 1, true);
    parts.push(part(rim, hc, bi('head'), W('head', 0, 0.13, 0.005)));
    parts.push(part(rb(0.1, 0.03, 0.03), '#202020', bi('head'), W('head', 0, 0.21, -0.11))); // NVG mount
    parts.push(part(rb(0.02, 0.06, 0.12), WEB, bi('head'), W('head', -0.12, 0.07, 0.0))); // chin strap
    parts.push(part(rb(0.02, 0.06, 0.12), WEB, bi('head'), W('head', 0.12, 0.07, 0.0)));
  } else if (look.cap) {
    parts.push(part(new THREE.CylinderGeometry(0.115, 0.12, 0.07, 12), look.cap, bi('head'), W('head', 0, 0.18, 0)));
    parts.push(part(rb(0.16, 0.015, 0.09), look.cap, bi('head'), W('head', 0, 0.15, -0.11)));
  }
  // arms (hanging along -Y from shoulders in bind pose)
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    parts.push(part(cap(0.058, 0.2), U, bi('arm' + side), W('arm' + side, 0, -0.14, 0)));
    parts.push(part(cap(0.05, 0.18), U, bi('fore' + side), W('fore' + side, 0, -0.13, 0)));
    parts.push(part(new THREE.CylinderGeometry(0.052, 0.052, 0.04, 10), T, bi('fore' + side), W('fore' + side, 0, -0.25, 0))); // cuff
    parts.push(part(rb(0.07, 0.09, 0.045), look.gloves || S, bi('hand' + side), W('hand' + side, 0, -0.04, 0)));
    parts.push(part(rb(0.025, 0.05, 0.03), look.gloves || S, bi('hand' + side), W('hand' + side, -sx * 0.035, -0.02, -0.02))); // thumb
    // legs
    parts.push(part(cap(0.078, 0.3), T, bi('thigh' + side), W('thigh' + side, 0, -0.21, 0)));
    parts.push(part(rb(0.06, 0.11, 0.1), T, bi('thigh' + side), W('thigh' + side, sx * 0.075, -0.24, 0))); // cargo pocket
    parts.push(part(cap(0.064, 0.28), T, bi('shin' + side), W('shin' + side, 0, -0.2, 0)));
    // boots: shaft, foot and sole
    parts.push(part(new THREE.CylinderGeometry(0.07, 0.068, 0.16, 10), BOOT, bi('shin' + side), W('shin' + side, 0, -0.36, 0)));
    parts.push(part(rb(0.1, 0.09, 0.26), BOOT, bi('foot' + side), W('foot' + side, 0, -0.005, -0.045)));
    parts.push(part(rb(0.105, 0.025, 0.27), '#111010', bi('foot' + side), W('foot' + side, 0, -0.05, -0.045)));
    if (look.vest) parts.push(part(rb(0.1, 0.1, 0.05), A, bi('shin' + side), W('shin' + side, 0, -0.02, -0.07))); // knee pads
  }
  const geo = mergeGeometries(parts);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geoCache.set(key, geo);
  return geo;
}

const weaponGeoCache = new Map();
let weaponMat = null;
/** Merge a weapon model into one vertex-coloured geometry for NPC use. */
function npcWeapon(weaponId, attach, materials) {
  const key = weaponId + JSON.stringify(attach || {});
  if (!weaponGeoCache.has(key)) {
    const parts = buildWeaponModel(weaponId, attach || {}, materials, { detail: 'low' });
    parts.root.updateMatrixWorld(true);
    const geos = [];
    parts.root.traverse((o) => {
      if (!o.isMesh || !o.visible || o.material.transparent || o.material.isMeshBasicMaterial) return;
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      const c = o.material.color;
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
      geos.push(g);
    });
    const merged = mergeGeometries(geos);
    weaponGeoCache.set(key, { geo: merged, muzzle: parts.muzzle ? parts.muzzle.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 0, -0.6) });
  }
  if (!weaponMat) weaponMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.5 });
  const entry = weaponGeoCache.get(key);
  const mesh = new THREE.Mesh(entry.geo, weaponMat);
  mesh.castShadow = true;
  const muzzle = new THREE.Object3D();
  muzzle.position.copy(entry.muzzle);
  mesh.add(muzzle);
  return { mesh, muzzle };
}

export class CharacterModel {
  constructor(look, materials) {
    this.materials = materials;
    this.root = new THREE.Group();
    this.bones = {};
    const boneList = [];
    for (const b of BONES) {
      const bone = new THREE.Bone();
      bone.name = b;
      bone.position.set(...OFFSET[b]);
      this.bones[b] = bone;
      boneList.push(bone);
      if (PARENT[b]) this.bones[PARENT[b]].add(bone);
    }
    const geo = buildBodyGeometry(look);
    this.mesh = new THREE.SkinnedMesh(geo, bodyMaterial(materials));
    this.mesh.add(this.bones.root);
    this.mesh.bind(new THREE.Skeleton(boneList));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.weapon = null;
    this.phase = Math.random() * 10;
    this.aimPitch = 0;
    this.speed = 0;
    this.crouch = 0;
    this.aiming = 0;
    this.reload = 0;
    this.flinch = 0;
    this.dead = false;
    this.deathT = 0;
    this.deathDir = 1;
    this.deathSide = 0;
    this.light = null;
  }

  setWeapon(weaponId, attach) {
    if (this.weapon) { this.bones.handR.remove(this.weapon.mesh); this.weapon = null; }
    if (!weaponId) return;
    const w = npcWeapon(weaponId, attach, this.materials);
    // hold: barrel forward (-z), grip in right hand
    w.mesh.position.set(-0.02, -0.06, 0.03);
    w.mesh.rotation.set(-Math.PI / 2, 0, 0);
    this.bones.handR.add(w.mesh);
    this.weapon = w;
  }

  muzzleWorld(out = new THREE.Vector3()) {
    if (!this.weapon) return this.bones.head.getWorldPosition(out);
    return this.weapon.muzzle.getWorldPosition(out);
  }

  headWorld(out = new THREE.Vector3()) {
    return this.bones.head.getWorldPosition(out).add({ x: 0, y: 0.1, z: 0 });
  }

  /**
   * Animate. s: {speed (m/s), crouch 0..1, aiming 0..1, aimPitch, reloading, moving}
   */
  animate(dt, s) {
    const B = this.bones;
    if (this.dead) { this._death(dt); return; }
    this.speed = damp(this.speed, s.speed, 10, dt);
    this.crouch = damp(this.crouch, s.crouch, 8, dt);
    this.aiming = damp(this.aiming, s.aiming, 9, dt);
    this.aimPitch = damp(this.aimPitch, s.aimPitch || 0, 10, dt);
    this.reload = damp(this.reload, s.reloading ? 1 : 0, 8, dt);
    this.flinch = damp(this.flinch, 0, 6, dt);
    const run = clamp((this.speed - 2) / 3, 0, 1);
    const freq = lerp(1.7, 2.6, run) * (this.speed > 0.2 ? 1 : 0);
    this.phase += dt * freq * Math.PI * (0.6 + this.speed * 0.25);
    const swing = clamp(this.speed / 2, 0, 1) * lerp(0.45, 0.75, run);
    const sn = Math.sin(this.phase), cs = Math.cos(this.phase);
    const cr = this.crouch;

    // legs (+X rotation swings a limb forward; knees bend with -X)
    B.thighL.rotation.x = sn * swing + cr * 1.25;
    B.thighR.rotation.x = -sn * swing + cr * 1.25;
    B.shinL.rotation.x = -Math.max(0, -cs) * swing * 1.2 - cr * 2.2;
    B.shinR.rotation.x = -Math.max(0, cs) * swing * 1.2 - cr * 2.2;
    B.footL.rotation.x = cr * 0.95;
    B.footR.rotation.x = cr * 0.95;
    B.hips.position.y = 0.95 - cr * 0.4 + Math.abs(sn) * 0.03 * swing;
    B.hips.position.z = cr * 0.1;
    B.hips.rotation.y = sn * 0.08 * swing;
    // torso: lean forward when running/crouching, pitch with aim
    const spineP = -run * 0.18 - cr * 0.3 + this.flinch * 0.3;
    const chestP = this.aimPitch * 0.5 * this.aiming;
    B.spine.rotation.x = spineP;
    B.chest.rotation.x = chestP;
    B.chest.rotation.y = -0.22 * this.aiming;
    // idle life: breathing, slow weight shift and looking around when not aiming
    this.idleT = (this.idleT || Math.random() * 20) + dt;
    const still = (1 - clamp(this.speed / 0.6, 0, 1)) * (1 - this.aiming);
    const breathe = Math.sin(this.idleT * 1.6) * 0.015;
    B.chest.rotation.x += breathe * (0.6 + still * 0.4);
    B.hips.rotation.z = Math.sin(this.idleT * 0.35) * 0.035 * still;
    B.hips.position.x = Math.sin(this.idleT * 0.35) * 0.02 * still;
    const look = (Math.sin(this.idleT * 0.27) + Math.sin(this.idleT * 0.61 + 1.3) * 0.5) * 0.45 * still;
    B.neck.rotation.x = this.aimPitch * 0.4 * this.aiming - spineP * 0.6 + Math.sin(this.idleT * 0.43) * 0.06 * still;
    B.neck.rotation.y = 0.2 * this.aiming + look;

    // arms: relaxed carry vs aiming hold
    const a = this.aiming;
    const carryR = [0.45, 0, 0.12], carryRf = [1.0, 0, 0];
    const carryL = [0.75, 0, 0.3], carryLf = [1.1, 0, 0];
    const aimR = [1.2, 0.1, 0.32], aimRf = [0.35, 0, 0];
    const aimL = [1.35, 0.45, 0.35], aimLf = [0.25, 0, 0];
    const mix = (x, y) => [lerp(x[0], y[0], a), lerp(x[1], y[1], a), lerp(x[2], y[2], a)];
    const R1 = mix(carryR, aimR), R2 = mix(carryRf, aimRf);
    const L1 = mix(carryL, aimL), L2 = mix(carryLf, aimLf);
    const armSwing = (1 - a) * sn * swing * 0.25;
    B.armR.rotation.set(R1[0] + armSwing, R1[1], R1[2]);
    B.foreR.rotation.set(R2[0], R2[1], R2[2]);
    B.armL.rotation.set(L1[0] - armSwing - this.reload * 0.4, L1[1] - this.reload * 0.3, L1[2]);
    B.foreL.rotation.set(L2[0] + this.reload * 0.5, L2[1], L2[2]);
    // keep the rifle level with the aim direction regardless of arm angles
    const total = R1[0] + R2[0] + spineP + chestP;
    B.handR.rotation.set(lerp(Math.PI / 2 - total - 0.35, Math.PI / 2 - total + this.aimPitch, a), 0, 0);
    B.handL.rotation.set(0, 0, 0);
    if (this.reload > 0.05) {
      B.armR.rotation.x -= this.reload * 0.35;
      B.handR.rotation.z = this.reload * 0.5;
    } else B.handR.rotation.z = 0;
  }

  die(dir = 1, side = 0) {
    this.dead = true;
    this.deathT = 0;
    this.deathDir = dir; // 1 backward, -1 forward
    this.deathSide = side;
  }

  _death(dt) {
    const B = this.bones;
    this.deathT += dt;
    const t = clamp(this.deathT / 0.75, 0, 1);
    const e = t * t;
    // knees buckle first, then the body topples
    B.thighL.rotation.x = lerp(B.thighL.rotation.x, 0.4 * this.deathDir, 0.1);
    B.thighR.rotation.x = lerp(B.thighR.rotation.x, 0.15 * this.deathDir, 0.1);
    B.shinL.rotation.x = lerp(B.shinL.rotation.x, -0.6, 0.1);
    B.shinR.rotation.x = lerp(B.shinR.rotation.x, -0.3, 0.1);
    B.armL.rotation.x = lerp(B.armL.rotation.x, this.deathDir > 0 ? 2.4 : 0.6, 0.08);
    B.armR.rotation.x = lerp(B.armR.rotation.x, this.deathDir > 0 ? 2.0 : 0.4, 0.08);
    B.foreL.rotation.x = lerp(B.foreL.rotation.x, 0.4, 0.08);
    B.foreR.rotation.x = lerp(B.foreR.rotation.x, 0.6, 0.08);
    B.spine.rotation.x = lerp(B.spine.rotation.x, 0.2 * this.deathDir, 0.1);
    B.neck.rotation.x = lerp(B.neck.rotation.x, 0.4 * this.deathDir, 0.1);
    B.hips.position.y = lerp(0.95, 0.9, e);
    // backward fall = top moves to +z = positive X rotation of the root
    B.root.rotation.x = (Math.PI / 2) * e * this.deathDir * 0.97;
    B.root.position.y = 0.14 * e;
    B.root.rotation.z = this.deathSide * 0.3 * e;
    if (this.weapon && t > 0.4 && this.weapon.mesh.parent === B.handR) {
      B.handR.remove(this.weapon.mesh);
      this.weapon = null;
    }
  }
}

export { BONES };
