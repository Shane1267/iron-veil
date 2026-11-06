import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ItemDB } from '../items/ItemDatabase.js';

// Procedural weapon models, used for the first-person viewmodel, NPC hands, loot on the
// ground and inventory icons. The high-detail path uses bevelled parts (rounded boxes
// catch specular highlights along edges the way machined metal and moulded polymer
// do) and adds mechanical detail; the low-detail path (NPCs) uses plain boxes.
// Convention: barrel points down -Z, origin at the firing hand, +Y up.

let MATS = null;
export function weaponMaterials(materials) {
  if (MATS) return MATS;
  const metalTex = materials.factory.get('metal');
  const woodTex = materials.factory.get('planks');
  const concreteTex = materials.factory.get('concrete');
  const std = (o) => new THREE.MeshStandardMaterial(o);
  MATS = {
    gunmetal: std({ color: 0x55595d, metalness: 0.6, roughness: 0.36, roughnessMap: metalTex.roughnessMap, normalMap: metalTex.normalMap, normalScale: new THREE.Vector2(0.25, 0.25) }),
    parkerized: std({ color: 0x4a4d50, metalness: 0.45, roughness: 0.55, roughnessMap: metalTex.roughnessMap }),
    steel: std({ color: 0x8a8d90, metalness: 0.9, roughness: 0.28, roughnessMap: metalTex.roughnessMap }),
    polymer: std({ color: 0x3e4143, metalness: 0.04, roughness: 0.55, normalMap: concreteTex.normalMap, normalScale: new THREE.Vector2(0.18, 0.18) }),
    tan: std({ color: 0x8a7858, metalness: 0.04, roughness: 0.72, normalMap: concreteTex.normalMap, normalScale: new THREE.Vector2(0.15, 0.15) }),
    olive: std({ color: 0x4a5034, metalness: 0.08, roughness: 0.7, normalMap: concreteTex.normalMap, normalScale: new THREE.Vector2(0.15, 0.15) }),
    wood: std({ color: 0x8a5a34, metalness: 0.0, roughness: 0.5, map: woodTex.map }),
    rubber: std({ color: 0x262626, metalness: 0, roughness: 0.9 }),
    brass: std({ color: 0xb08a40, metalness: 0.9, roughness: 0.3 }),
    lens: std({ color: 0x223040, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.55 }),
    reflexGlass: std({ color: 0x8aa0a8, metalness: 0.1, roughness: 0.0, transparent: true, opacity: 0.18, depthWrite: false }),
    dot: new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false }),
    blade: std({ color: 0xb0b4b8, metalness: 0.95, roughness: 0.18 }),
    rust: std({ color: 0x6a3a22, metalness: 0.4, roughness: 0.85, roughnessMap: metalTex.roughnessMap }),
    tape: std({ color: 0x353535, metalness: 0, roughness: 0.9 }),
    sleeve: std({ color: 0xa8b088, metalness: 0, roughness: 0.95, map: materials.factory.get('canvas').map }),
    cuff: std({ color: 0x4a5038, metalness: 0, roughness: 0.95 }),
    glove: std({ color: 0x3e3832, metalness: 0, roughness: 0.78, normalMap: concreteTex.normalMap, normalScale: new THREE.Vector2(0.2, 0.2) }),
    gloveLeather: std({ color: 0x5e4a38, metalness: 0, roughness: 0.6 }),
    skin: std({ color: 0xb08870, metalness: 0, roughness: 0.7 }),
    watch: std({ color: 0x202020, metalness: 0.3, roughness: 0.4 }),
  };
  return MATS;
}

function toneMat(tone) {
  const M = MATS;
  return { black: M.polymer, tan: M.tan, olive: M.olive, wood: M.wood, steel: M.steel }[tone] || M.polymer;
}

// geometry caches (shared between models; never disposed while cached)
const geoCache = new Map();
function cached(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); g.userData.shared = true; geoCache.set(key, g); }
  return g;
}

let HI = true; // detail level of the model currently being built
function box(parent, mat, x, y, z, w, h, d, rx = 0, ry = 0, rz = 0, bevel = 0.0035) {
  const r = Math.min(bevel, Math.min(w, h, d) * 0.45);
  const g = HI && r > 0.0008
    ? cached(`rb${w.toFixed(4)},${h.toFixed(4)},${d.toFixed(4)},${r.toFixed(4)}`, () => new RoundedBoxGeometry(w, h, d, 2, r))
    : cached(`b${w.toFixed(4)},${h.toFixed(4)},${d.toFixed(4)}`, () => new THREE.BoxGeometry(w, h, d));
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}
function cyl(parent, mat, x, y, z, r, len, axis = 'z', segs = 14, r2 = r) {
  const s = HI ? segs : Math.max(6, Math.floor(segs / 2));
  const g = cached(`c${r.toFixed(4)},${r2.toFixed(4)},${len.toFixed(4)},${s},${axis}`, () => {
    const c = new THREE.CylinderGeometry(r, r2, len, s);
    if (axis === 'z') c.rotateX(Math.PI / 2);
    else if (axis === 'x') c.rotateZ(Math.PI / 2);
    return c;
  });
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
/** Row of small recessed/raised ribs along z (grip texture, vents, serrations). */
function ribs(parent, mat, x, y, z0, count, step, w, h, d) {
  if (!HI) return;
  for (let i = 0; i < count; i++) box(parent, mat, x, y, z0 + i * step, w, h, d, 0, 0, 0, 0);
}

/**
 * Build a weapon model. Returns {root, parts: {mag, bolt, pump, slide, muzzle, sightY, sightZ, scope, reflex, cylinder}, info}
 * opts.detail: 'high' (default) or 'low'
 */
export function buildWeaponModel(weaponId, attach = {}, materials, opts = {}) {
  const M = weaponMaterials(materials);
  HI = opts.detail !== 'low';
  const w = ItemDB.weapon(weaponId);
  const root = new THREE.Group();
  root.name = `weapon ${weaponId}`;
  const parts = { root, sightY: 0.1, sightZ: -0.1, recoilBody: root };
  const kind = w.model.kind;
  const body = new THREE.Group();
  root.add(body);
  parts.body = body;
  const furn = toneMat(w.model.tone);
  const metal = M.gunmetal;

  if (kind === 'pistol' || kind === 'revolver') {
    buildHandgun(body, parts, w, M, furn, metal, kind);
  } else if (kind === 'knife' || kind === 'club') {
    if (kind === 'knife') {
      const bladeGeo = cached('knifeBlade', () => {
        const s = new THREE.Shape();
        s.moveTo(0, 0); s.lineTo(0.17, 0.004); s.quadraticCurveTo(0.19, 0.012, 0.16, 0.028); s.lineTo(0, 0.03); s.lineTo(0, 0);
        const g = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0012, bevelSegments: 1 });
        g.translate(0, -0.015, -0.002);
        g.rotateY(Math.PI / 2);
        return g;
      });
      const blade = new THREE.Mesh(bladeGeo, M.blade);
      blade.position.set(0, 0.01, -0.03);
      if (w.model.long) { blade.scale.set(1, 1.5, 2.6); blade.position.z = -0.03; }
      body.add(blade);
      box(body, M.steel, 0, 0.01, -0.035, 0.012, 0.05, 0.012); // guard
      box(body, M.rubber, 0, 0.008, 0.025, 0.026, 0.03, 0.11, 0, 0, 0, 0.008);
      ribs(body, M.polymer, 0, -0.008, -0.01, 5, 0.018, 0.027, 0.004, 0.006);
      cyl(body, M.steel, 0, 0.008, 0.085, 0.012, 0.012, 'z', 10);
    } else {
      cyl(body, M.rust, 0, 0.0, -0.2, 0.012, 0.55, 'z', 10);
      if (HI) for (let i = 0; i < 12; i++) cyl(body, M.rust, 0, 0.0, -0.45 + i * 0.04, 0.0135, 0.008, 'z', 8); // rebar ribs
      cyl(body, M.tape, 0, 0.0, 0.02, 0.019, 0.16, 'z', 10);
      box(body, M.rust, 0, 0.02, -0.45, 0.03, 0.05, 0.05, 0.3);
    }
    parts.muzzle = new THREE.Object3D();
    parts.muzzle.position.set(0, 0, -0.25);
    body.add(parts.muzzle);
    parts.melee = true;
    parts.length = 0.3;
    parts.gripPos = new THREE.Vector3(0, 0, 0.02);
    parts.supportHand = null;
  } else {
    buildLongGun(body, parts, w, M, furn, metal, kind, attach);
  }

  // ---------------------------------------------------- attachments
  if (!parts.melee) {
    const railY = parts.ironSightY ? parts.ironSightY - 0.022 : parts.sightY - 0.01;
    const opticShape = attach.optic ? ItemDB.get(attach.optic)?.shape : null;
    if (opticShape === 'reflex' || opticShape === 'holo') {
      const g = new THREE.Group();
      const hw = opticShape === 'holo' ? 1.35 : 1; // holographic sights have a wider, boxier window
      box(g, metal, 0, railY + 0.012, 0, 0.028 * hw, 0.012, opticShape === 'holo' ? 0.085 : 0.055);
      box(g, metal, -0.016 * hw, railY + 0.036, 0.004, 0.005, 0.042, 0.03 * hw);
      box(g, metal, 0.016 * hw, railY + 0.036, 0.004, 0.005, 0.042, 0.03 * hw);
      box(g, metal, 0, railY + 0.058, 0.004, 0.037 * hw, 0.005, 0.03 * hw);
      if (opticShape === 'holo') box(g, metal, 0, railY + 0.02, 0.035, 0.034, 0.02, 0.03);
      cyl(g, metal, 0.021, railY + 0.03, 0.01, 0.006, 0.012, 'x', 10); // brightness knob
      box(g, M.reflexGlass, 0, railY + 0.036, -0.008, 0.028, 0.036, 0.002, 0, 0, 0, 0);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0011, 10), M.dot);
      dot.position.set(0, railY + 0.035, -0.0095);
      g.add(dot);
      g.position.z = (parts.ironRear ? parts.ironRear.position.z : 0) - 0.08;
      body.add(g);
      parts.sightY = railY + 0.035;
      parts.reflex = g;
      if (parts.ironRear) parts.ironRear.visible = false;
    } else if (opticShape === 'scope') {
      const g = new THREE.Group();
      const zoom = ItemDB.get(attach.optic).attach.scopeZoom || 4;
      const big = zoom >= 8;
      const tubeY = railY + (zoom <= 2 ? 0.04 : 0.05);
      const L = big ? 0.26 : zoom <= 2 ? 0.14 : 0.21;
      cyl(g, M.parkerized, 0, tubeY, 0, 0.0155, L * 0.55, 'z', 20);
      cyl(g, M.parkerized, 0, tubeY, -L * 0.36, 0.0155, L * 0.2, 'z', 20, big ? 0.025 : 0.021); // objective bell
      cyl(g, M.parkerized, 0, tubeY, -L * 0.5, big ? 0.026 : 0.022, L * 0.08, 'z', 20);
      cyl(g, M.parkerized, 0, tubeY, L * 0.36, 0.019, L * 0.2, 'z', 20, 0.016); // eyepiece
      cyl(g, M.rubber, 0, tubeY, L * 0.48, 0.02, L * 0.05, 'z', 20);
      cyl(g, M.lens, 0, tubeY, -L * 0.545, big ? 0.023 : 0.019, 0.002, 'z', 20);
      cyl(g, metal, 0, tubeY + 0.02, 0, 0.008, 0.016, 'y', 12); // turrets
      cyl(g, metal, 0.02, tubeY, 0, 0.008, 0.016, 'x', 12);
      for (const zz of [-0.05, 0.05]) {
        cyl(g, metal, 0, tubeY, zz, 0.019, 0.014, 'z', 16); // rings
        box(g, metal, 0, railY + 0.02, zz, 0.024, 0.03, 0.014);
      }
      g.position.z = (parts.ironRear ? parts.ironRear.position.z : 0) - 0.07;
      body.add(g);
      parts.sightY = tubeY;
      parts.scope = g;
      if (parts.ironRear) parts.ironRear.visible = false;
    }
    const muzzleShape = attach.muzzle ? ItemDB.get(attach.muzzle)?.shape : null;
    if (muzzleShape === 'brake' && parts.muzzle) {
      // short slotted brake / flash hider
      const mz = parts.muzzle.position;
      cyl(body, M.parkerized, 0, mz.y, mz.z - 0.03, 0.0135, 0.065, 'z', 14);
      if (HI) for (let i = 0; i < 3; i++) box(body, M.rubber, 0, mz.y + 0.012, mz.z - 0.012 - i * 0.018, 0.02, 0.004, 0.007, 0, 0, 0, 0);
      parts.muzzle.position.z -= 0.06;
      if (parts.muzzleDevice) parts.muzzleDevice.visible = false;
    } else if (attach.muzzle && parts.muzzle) {
      const mz = parts.muzzle.position;
      cyl(body, M.parkerized, 0, mz.y, mz.z - 0.075, 0.019, 0.16, 'z', 18);
      cyl(body, M.parkerized, 0, mz.y, mz.z + 0.008, 0.0145, 0.02, 'z', 14); // mount collar
      if (HI) for (let i = 0; i < 3; i++) cyl(body, M.rubber, 0, mz.y, mz.z - 0.03 - i * 0.04, 0.0193, 0.004, 'z', 18);
      parts.muzzle.position.z -= 0.15;
      if (parts.muzzleDevice) parts.muzzleDevice.visible = false;
    }
    if (attach.under === 'grip_vert') {
      box(body, M.polymer, 0, -0.04, parts.handguardZ - 0.02, 0.026, 0.085, 0.03, 0.1, 0, 0, 0.008);
      ribs(body, M.rubber, 0, -0.06, parts.handguardZ - 0.02 + 0.016, 1, 0, 0.027, 0.04, 0.002);
    } else if (attach.under === 'grip_angled') {
      box(body, M.polymer, 0, -0.03, parts.handguardZ - 0.01, 0.024, 0.04, 0.09, -0.6, 0, 0, 0.008);
    } else if (attach.under === 'bipod') {
      box(body, M.parkerized, 0, -0.015, (parts.handguardZ ?? -0.2) - 0.08, 0.03, 0.02, 0.04);
      for (const sx of [-1, 1]) box(body, M.parkerized, sx * 0.012, -0.03, (parts.handguardZ ?? -0.2) + 0.02, 0.008, 0.008, 0.2, 0, 0, 0, 0.002);
    }
    if (attach.light) {
      const lz = (parts.handguardZ ?? -0.1) - 0.04;
      cyl(body, M.polymer, 0.034, 0.03, lz, 0.012, 0.07, 'z', 14);
      cyl(body, M.lens, 0.034, 0.03, lz - 0.036, 0.0115, 0.002, 'z', 14);
      box(body, M.polymer, 0.026, 0.035, lz, 0.012, 0.012, 0.03);
      if (ItemDB.get(attach.light)?.attach?.hipMul) {
        // laser emitter beside the light, with a faint visible beam
        cyl(body, M.lens, 0.034, 0.012, lz - 0.03, 0.004, 0.004, 'z', 8);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 1.2, 4), new THREE.MeshBasicMaterial({ color: 0x40ff60, transparent: true, opacity: 0.35, depthWrite: false }));
        beam.rotation.x = Math.PI / 2;
        beam.position.set(0.034, 0.012, lz - 0.63);
        body.add(beam);
        parts.laser = beam;
      }
      parts.lightPoint = new THREE.Object3D();
      parts.lightPoint.position.set(0.034, 0.03, lz - 0.04);
      body.add(parts.lightPoint);
    }
  }

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  HI = true;
  return parts;
}

function buildHandgun(body, parts, w, M, furn, metal, kind) {
  const heavy = w.model.heavy ? 1.12 : 1;
  if (kind === 'pistol') {
    const slide = new THREE.Group();
    body.add(slide);
    const slideMat = w.model.tone === 'steel' ? M.steel : M.parkerized;
    const L = 0.19 * heavy;
    box(slide, slideMat, 0, 0.046, -0.06 * heavy, 0.029, 0.033, L, 0, 0, 0, 0.004);
    box(slide, slideMat, 0, 0.062, -0.06 * heavy, 0.022, 0.006, L - 0.01, 0, 0, 0, 0.002); // top flat
    // rear and front cocking serrations
    for (let i = 0; i < (HI ? 7 : 0); i++) {
      box(slide, M.rubber, 0.0148, 0.046, 0.022 - i * 0.0045, 0.0012, 0.024, 0.0018, 0, 0, 0, 0);
      box(slide, M.rubber, -0.0148, 0.046, 0.022 - i * 0.0045, 0.0012, 0.024, 0.0018, 0, 0, 0, 0);
    }
    box(slide, M.rubber, 0.0149, 0.05, -0.05 * heavy, 0.001, 0.012, 0.035, 0, 0, 0, 0); // ejection port
    box(slide, metal, 0, 0.067, 0.022, 0.016, 0.008, 0.008); // rear sight
    box(slide, M.rubber, 0, 0.069, 0.022, 0.004, 0.006, 0.0085, 0, 0, 0, 0); // notch
    box(slide, metal, 0, 0.067, -0.145 * heavy, 0.004, 0.009, 0.006); // front sight
    parts.slide = slide;
    // frame with accessory rail and trigger guard
    box(body, furn, 0, 0.02, -0.075 * heavy, 0.027, 0.02, 0.14 * heavy, 0, 0, 0, 0.004);
    ribs(body, furn, 0, 0.009, -0.12 * heavy, 3, 0.01, 0.022, 0.004, 0.005);
    cyl(body, metal, 0, 0.042, -0.162 * heavy, 0.0065, 0.012, 'z', 12); // barrel crown
    if (w.model.tone === 'steel') box(body, M.steel, 0, 0.055, 0.035, 0.012, 0.02, 0.012, -0.5); // hammer
    parts.sightY = 0.067;
  } else {
    cyl(body, M.steel, 0, 0.046, -0.125, 0.0095, 0.15, 'z', 16);
    box(body, M.steel, 0, 0.057, -0.13, 0.009, 0.012, 0.145); // rib
    box(body, M.steel, 0, 0.032, -0.135, 0.012, 0.012, 0.11); // ejector rod shroud
    const cylinder = new THREE.Group();
    cyl(cylinder, M.steel, 0, 0, 0, 0.022, 0.048, 'z', 16);
    if (HI) for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      box(cylinder, M.parkerized, Math.cos(a) * 0.0205, Math.sin(a) * 0.0205, 0, 0.004, 0.004, 0.036, 0, 0, a, 0);
    }
    cylinder.position.set(0, 0.035, -0.02);
    body.add(cylinder);
    parts.cylinder = cylinder;
    box(body, M.steel, 0, 0.03, 0.02, 0.026, 0.052, 0.06, 0, 0, 0, 0.004); // frame
    box(body, M.steel, 0, 0.06, 0.04, 0.01, 0.022, 0.012, -0.6); // hammer
    box(body, M.steel, 0, 0.067, -0.2, 0.004, 0.012, 0.006);
    box(body, M.steel, 0, 0.066, 0.03, 0.012, 0.01, 0.01);
    parts.sightY = 0.068;
  }
  // grip with panels and texture
  const gripMat = kind === 'revolver' ? M.wood : furn;
  box(body, gripMat, 0, -0.035, 0.036, 0.029, 0.1, 0.042, -0.25, 0, 0, 0.007);
  if (HI) for (let i = 0; i < 5; i++) box(body, M.rubber, 0, -0.012 - i * 0.016, 0.018 + i * 0.004, 0.0295, 0.002, 0.03, -0.25, 0, 0, 0);
  box(body, metal, 0, -0.004, -0.028, 0.006, 0.004, 0.04, 0, 0, 0, 0.001); // guard bottom
  box(body, metal, 0, 0.006, -0.046, 0.006, 0.022, 0.004, 0, 0, 0, 0.001); // guard front
  box(body, metal, 0, 0.004, -0.018, 0.004, 0.016, 0.004, 0.3, 0, 0, 0.001); // trigger
  const mag = new THREE.Group();
  if (kind === 'pistol') {
    box(mag, metal, 0, -0.03, 0.035, 0.022, 0.1, 0.034, -0.25, 0, 0, 0.002);
    box(mag, M.polymer, 0, -0.082, 0.049, 0.026, 0.008, 0.04, -0.25, 0, 0, 0.002); // baseplate
  }
  body.add(mag);
  parts.mag = mag;
  parts.magHome = mag.position.clone();
  parts.muzzle = new THREE.Object3D();
  parts.muzzle.position.set(0, kind === 'revolver' ? 0.046 : 0.043, kind === 'revolver' ? -0.2 : -0.17 * heavy);
  body.add(parts.muzzle);
  parts.handguardZ = -0.02;
  parts.supportHand = new THREE.Vector3(-0.025, -0.05, 0.03);
  parts.gripPos = new THREE.Vector3(0, -0.035, 0.04);
  parts.magWell = new THREE.Vector3(0, -0.06, 0.04);
  parts.length = 0.22;
}

function buildLongGun(body, parts, w, M, furn, metal, kind, attach) {
  const L = w.model.length || 0.9;
  const recLen = kind === 'smg' ? 0.24 : kind === 'lmg' ? 0.36 : kind === 'shotgun' ? 0.26 : kind === 'bolt' ? 0.22 : 0.3;
  const barrelLen = Math.max(0.12, L - recLen - 0.22);
  const recH = kind === 'lmg' ? 0.11 : kind === 'smg' ? 0.075 : 0.085;
  const recZ = -recLen / 2 + 0.05;
  const upperMat = kind === 'shotgun' ? M.parkerized : metal;
  // ---- receiver
  if (kind === 'bolt') {
    cyl(body, metal, 0, 0.045, recZ, 0.021, recLen, 'z', 18);
    box(body, metal, 0, 0.026, recZ, 0.03, 0.02, recLen * 0.9);
  } else {
    box(body, upperMat, 0, 0.045, recZ, 0.056, recH * 0.55, recLen, 0, 0, 0, 0.006);
    box(body, kind === 'shotgun' ? upperMat : furn, 0, 0.0, recZ + 0.01, 0.052, recH * 0.55, recLen - 0.02, 0, 0, 0, 0.006);
    // magazine well flare and bolt release / forward assist bumps
    box(body, kind === 'shotgun' ? upperMat : furn, 0, -0.022, recZ - recLen * 0.18, 0.05, 0.03, 0.08, 0, 0, 0, 0.005);
    if (kind === 'rifle' && w.model.mag === 'curved') {
      cyl(body, metal, 0.03, 0.05, recZ + recLen * 0.3, 0.008, 0.03, 'z', 12); // forward assist
      box(body, metal, 0.03, 0.06, recZ + recLen * 0.18, 0.006, 0.014, 0.02); // brass deflector
    }
    box(body, metal, -0.027, 0.012, recZ + recLen * 0.18, 0.005, 0.014, 0.012); // selector
  }
  // top rail with ridges
  const railTop = 0.045 + recH * 0.275 + 0.006;
  if (kind !== 'bolt' && !w.model.improvised) {
    box(body, metal, 0, railTop, recZ - 0.02, 0.022, 0.012, recLen * 0.9, 0, 0, 0, 0.002);
    const n = HI ? Math.floor(recLen * 0.9 / 0.01) : 0;
    for (let i = 0; i < n; i++) box(body, metal, 0, railTop + 0.007, recZ - recLen * 0.43 + i * 0.01, 0.024, 0.004, 0.005, 0, 0, 0, 0);
  }
  // ejection port with dust cover
  box(body, M.rubber, 0.0285, 0.05, recZ + 0.02, 0.002, 0.018, 0.06, 0, 0, 0, 0);
  if (HI && kind !== 'bolt') box(body, upperMat, 0.0295, 0.05, recZ + 0.02, 0.0015, 0.016, 0.055, 0, 0, 0, 0);
  // ---- barrel
  const bStart = recZ - recLen / 2;
  const bCenter = bStart - barrelLen / 2;
  const barrelR = kind === 'lmg' ? 0.014 : kind === 'shotgun' ? 0.012 : 0.0105;
  cyl(body, M.parkerized, 0, 0.045, bCenter, barrelR, barrelLen, 'z', 16, barrelR * 1.08);
  let hgLen = barrelLen * (kind === 'bolt' ? 0.7 : 0.62);
  if (kind === 'bolt' || w.model.stock === 'wood') {
    // full stock running under the barrel
    box(body, furn, 0, 0.022, bStart - hgLen / 2 + 0.02, 0.048, 0.048, hgLen, 0, 0, 0, 0.012);
    if (w.model.stock === 'wood' && kind !== 'bolt') {
      box(body, furn, 0, 0.05, bStart - hgLen * 0.35, 0.044, 0.02, hgLen * 0.6, 0, 0, 0, 0.008); // upper handguard
      cyl(body, metal, 0, 0.03, bStart - hgLen + 0.02, 0.026, 0.012, 'z', 14); // barrel band
    }
  } else if (kind === 'shotgun') {
    cyl(body, M.parkerized, 0, 0.012, bStart - barrelLen * 0.42, 0.011, barrelLen * 0.84, 'z', 14); // tube magazine
    cyl(body, metal, 0, 0.012, bStart - barrelLen * 0.84, 0.013, 0.02, 'z', 14); // mag cap
    const pump = new THREE.Group();
    box(pump, furn, 0, 0.018, 0, 0.05, 0.05, 0.16, 0, 0, 0, 0.012);
    for (let i = 0; i < (HI ? 7 : 0); i++) box(pump, M.rubber, 0, 0.018, -0.066 + i * 0.022, 0.0515, 0.04, 0.005, 0, 0, 0, 0.001);
    pump.position.set(0, 0, bStart - 0.12);
    body.add(pump);
    parts.pump = pump;
    parts.pumpZ = pump.position.z;
    hgLen = 0.16;
    cyl(body, M.brass, 0, 0.045 + barrelR + 0.002, bStart - barrelLen + 0.01, 0.0025, 0.004, 'y', 8); // bead sight
  } else {
    // free-float style handguard with vent slots and a continuous top rail
    box(body, furn, 0, 0.045, bStart - hgLen / 2, 0.056, 0.062, hgLen, 0, 0, 0, 0.01);
    if (HI) {
      const slots = Math.max(3, Math.floor(hgLen / 0.035));
      for (let i = 0; i < slots; i++) {
        const z = bStart - 0.025 - i * (hgLen - 0.04) / slots;
        for (const sx of [-1, 1]) box(body, M.rubber, sx * 0.0282, 0.045, z, 0.002, 0.022, 0.014, 0, 0, 0, 0.002);
      }
      box(body, metal, 0, railTop, bStart - hgLen / 2, 0.022, 0.012, hgLen - 0.01, 0, 0, 0, 0.002);
      const n = Math.floor((hgLen - 0.01) / 0.01);
      for (let i = 0; i < n; i++) box(body, metal, 0, railTop + 0.007, bStart - 0.008 - i * 0.01, 0.024, 0.004, 0.005, 0, 0, 0, 0);
    }
    if (kind === 'lmg') {
      box(body, M.polymer, 0, 0.125, recZ, 0.02, 0.022, 0.13, 0, 0, 0, 0.006); // carry handle
      box(body, M.polymer, 0, 0.1, recZ - 0.05, 0.012, 0.04, 0.012);
      box(body, M.polymer, 0, 0.1, recZ + 0.05, 0.012, 0.04, 0.012);
      // folded bipod legs and cooling holes in the barrel shroud
      box(body, metal, 0.012, 0.018, bStart - hgLen - 0.06, 0.008, 0.008, 0.2);
      box(body, metal, -0.012, 0.018, bStart - hgLen - 0.06, 0.008, 0.008, 0.2);
      cyl(body, M.parkerized, 0, 0.045, bStart - hgLen - 0.06, 0.02, 0.1, 'z', 16);
      if (HI) for (let i = 0; i < 4; i++) box(body, M.rubber, 0.0195, 0.045, bStart - hgLen - 0.025 - i * 0.022, 0.002, 0.008, 0.01, 0, 0, 0, 0);
    }
  }
  parts.handguardZ = bStart - hgLen * 0.55;
  // ---- gas block / front sight
  const muzzleZ = bStart - barrelLen;
  if (kind !== 'shotgun') {
    box(body, metal, 0, 0.058, muzzleZ + 0.06, 0.02, 0.026, 0.022, 0, 0, 0, 0.003);
    if (kind !== 'bolt') {
      box(body, metal, 0, railTop + 0.012, muzzleZ + 0.06, 0.016, 0.03, 0.012, 0, 0, 0, 0.002); // post base
      box(body, metal, -0.008, railTop + 0.03, muzzleZ + 0.06, 0.003, 0.02, 0.008, 0, 0, 0.25, 0); // ears
      box(body, metal, 0.008, railTop + 0.03, muzzleZ + 0.06, 0.003, 0.02, 0.008, 0, 0, -0.25, 0);
    }
  }
  const fsY = railTop + 0.034;
  if (kind !== 'shotgun') box(body, metal, 0, fsY - 0.005, muzzleZ + 0.06, 0.003, 0.024, 0.004, 0, 0, 0, 0);
  // ---- muzzle device
  const md = new THREE.Group();
  cyl(md, M.parkerized, 0, 0, 0, barrelR + 0.005, 0.05, 'z', 14);
  if (HI && kind !== 'shotgun') for (let i = 0; i < 3; i++) box(md, M.rubber, 0, barrelR + 0.004, -0.015 + i * 0.012, 0.006, 0.004, 0.005, 0, 0, 0, 0);
  md.position.set(0, 0.045, muzzleZ - 0.025);
  body.add(md);
  parts.muzzleDevice = md;
  parts.muzzle = new THREE.Object3D();
  parts.muzzle.position.set(0, 0.045, muzzleZ - 0.06);
  body.add(parts.muzzle);
  // ---- rear sight
  const rear = new THREE.Group();
  if (kind === 'bolt') {
    box(rear, metal, 0, railTop + 0.012, 0, 0.02, 0.016, 0.012);
    box(rear, M.rubber, 0, railTop + 0.022, 0, 0.004, 0.006, 0.0125, 0, 0, 0, 0);
  } else {
    box(rear, metal, 0, railTop + 0.01, 0, 0.024, 0.008, 0.016, 0, 0, 0, 0.002);
    box(rear, metal, -0.008, railTop + 0.022, 0, 0.004, 0.02, 0.01, 0, 0, 0, 0.001);
    box(rear, metal, 0.008, railTop + 0.022, 0, 0.004, 0.02, 0.01, 0, 0, 0, 0.001);
    if (HI) cyl(rear, metal, 0.016, railTop + 0.012, 0, 0.005, 0.004, 'x', 10); // windage knob
  }
  rear.position.z = recZ + recLen * 0.35;
  body.add(rear);
  parts.ironRear = rear;
  parts.ironSightY = railTop + 0.028;
  parts.sightY = parts.ironSightY;
  // ---- magazine
  const mag = new THREE.Group();
  const magType = w.model.mag;
  const ext = attach.mag ? 1.35 : 1;
  const drumMag = attach.mag && ItemDB.get(attach.mag)?.shape === 'drum';
  const magMat = kind === 'rifle' && w.model.tone === 'black' ? M.parkerized : metal;
  if (magType === 'curved') {
    // three segments with increasing forward sweep fake the curve
    const segH = 0.045 * ext;
    for (let i = 0; i < 3; i++) {
      const a = 0.1 + i * 0.12;
      const y = -0.022 - segH * (i + 0.5) * 0.98;
      const z = Math.sin(0.1 + i * 0.06) * segH * i * 1.1;
      box(mag, magMat, 0, y, -z, 0.026, segH + 0.004, 0.064, a, 0, 0, 0.004);
      if (HI) box(mag, M.rubber, 0.0132, y, -z, 0.0008, segH * 0.7, 0.006, a, 0, 0, 0);
    }
    box(mag, M.polymer, 0, -0.022 - segH * 3 - 0.004, -0.05 * ext, 0.03, 0.01, 0.074, 0.42, 0, 0, 0.003);
  } else if (magType === 'box' && drumMag) {
    cyl(mag, metal, 0.0, -0.075, 0, 0.065, 0.065, 'x', 22);
    box(mag, metal, 0, -0.02, 0, 0.026, 0.04, 0.05, 0, 0, 0, 0.004);
  } else if (magType === 'box') {
    const tilt = kind === 'smg' ? 0 : 0.08;
    box(mag, magMat, 0, -0.06 * ext, 0, 0.026, 0.1 * ext, 0.06, tilt, 0, 0, 0.004);
    box(mag, M.polymer, 0, -0.112 * ext, 0.004, 0.03, 0.01, 0.066, tilt, 0, 0, 0.003);
    if (HI) box(mag, M.rubber, 0.0132, -0.06 * ext, 0, 0.0008, 0.07 * ext, 0.006, tilt, 0, 0, 0);
  } else if (magType === 'drum') {
    cyl(mag, M.olive, 0.0, -0.065, 0, 0.075, 0.07, 'x', 24);
    cyl(mag, M.parkerized, 0.0, -0.065, 0, 0.03, 0.074, 'x', 16);
    box(mag, M.olive, 0, -0.012, 0, 0.03, 0.03, 0.05, 0, 0, 0, 0.004);
  }
  mag.position.set(0, 0.0, recZ - recLen * 0.18);
  body.add(mag);
  parts.mag = mag;
  parts.magHome = mag.position.clone();
  // ---- pistol grip, trigger group
  if (kind !== 'bolt' && w.model.stock !== 'wood') {
    const gm = kind === 'shotgun' ? furn : M.polymer;
    box(body, gm, 0, -0.047, recZ + recLen / 2 - 0.05, 0.03, 0.1, 0.044, -0.3, 0, 0, 0.008);
    if (HI) for (let i = 0; i < 3; i++) box(body, M.rubber, 0, -0.03 - i * 0.025, recZ + recLen / 2 - 0.068 + i * 0.008, 0.031, 0.008, 0.004, -0.3, 0, 0, 0.002); // finger grooves
  }
  box(body, metal, 0, -0.021, recZ + recLen / 2 - 0.1, 0.006, 0.004, 0.05, 0, 0, 0, 0.001); // guard bottom
  box(body, metal, 0, -0.01, recZ + recLen / 2 - 0.124, 0.006, 0.022, 0.004, 0, 0, 0, 0.001); // guard front
  box(body, metal, 0, -0.01, recZ + recLen / 2 - 0.09, 0.004, 0.018, 0.004, 0.3, 0, 0, 0.001); // trigger
  // ---- stock
  const stockZ = recZ + recLen / 2;
  if (w.model.stock === 'fixed') {
    if (kind === 'rifle' || kind === 'lmg') {
      cyl(body, M.parkerized, 0, 0.032, stockZ + 0.09, 0.015, 0.18, 'z', 14); // buffer tube
      box(body, furn, 0, 0.022, stockZ + 0.17, 0.042, 0.075, 0.13, 0, 0, 0, 0.01);
      box(body, furn, 0, -0.012, stockZ + 0.16, 0.036, 0.04, 0.11, 0.25, 0, 0, 0.008); // toe
      box(body, M.rubber, 0, 0.012, stockZ + 0.24, 0.044, 0.112, 0.015, 0, 0, 0, 0.004);
    } else {
      box(body, furn, 0, 0.025, stockZ + 0.12, 0.045, 0.07, 0.24, 0, 0, 0, 0.012);
      box(body, furn, 0, -0.02, stockZ + 0.15, 0.04, 0.05, 0.18, 0.2, 0, 0, 0.01);
      box(body, M.rubber, 0, 0.015, stockZ + 0.245, 0.046, 0.11, 0.015, 0, 0, 0, 0.004);
    }
    if (kind === 'bolt') box(body, furn, 0, 0.06, stockZ + 0.12, 0.04, 0.02, 0.12, 0, 0, 0, 0.008); // cheek riser
  } else if (w.model.stock === 'wood' || kind === 'bolt') {
    box(body, furn, 0, 0.0, stockZ + 0.16, 0.046, 0.095, 0.3, 0.12, 0, 0, 0.014);
    box(body, furn, 0, -0.03, stockZ + 0.03, 0.04, 0.07, 0.1, -0.5, 0, 0, 0.012); // wrist
    box(body, M.rubber, 0, -0.01, stockZ + 0.31, 0.047, 0.12, 0.015, 0.12, 0, 0, 0.004);
    if (HI) cyl(body, metal, 0, -0.04, stockZ + 0.2, 0.004, 0.012, 'x', 8); // sling stud
  } else if (w.model.stock === 'folding') {
    const padded = attach.stock;
    cyl(body, metal, 0, 0.03, stockZ + 0.11, 0.005, 0.22, 'z', 8);
    cyl(body, metal, 0, -0.008, stockZ + 0.11, 0.005, 0.22, 'z', 8);
    box(body, padded ? M.polymer : metal, 0, 0.011, stockZ + 0.22, 0.03, padded ? 0.09 : 0.07, padded ? 0.03 : 0.01, 0, 0, 0, 0.004);
    box(body, metal, 0, 0.011, stockZ + 0.005, 0.03, 0.05, 0.012, 0, 0, 0, 0.003); // hinge
  }
  // ---- bolt handle / charging handle
  if (w.action === 'bolt') {
    const bolt = new THREE.Group();
    cyl(bolt, M.steel, 0.03, 0.05, 0, 0.004, 0.05, 'x', 8);
    const knob = new THREE.Mesh(cached('boltKnob', () => new THREE.SphereGeometry(0.009, 12, 8)), M.steel);
    knob.position.set(0.055, 0.05, 0);
    bolt.add(knob);
    cyl(bolt, M.steel, 0, 0.045, 0.03, 0.017, 0.06, 'z', 14); // bolt body shroud
    bolt.position.z = recZ + recLen * 0.2;
    body.add(bolt);
    parts.bolt = bolt;
    parts.boltZ = bolt.position.z;
  } else if (kind !== 'shotgun') {
    const ch = new THREE.Group();
    if (kind === 'rifle' && w.model.mag === 'curved') {
      box(ch, metal, 0, railTop - 0.003, 0, 0.012, 0.006, 0.03, 0, 0, 0, 0.001);
      box(ch, metal, 0, railTop - 0.003, 0.016, 0.04, 0.008, 0.008, 0, 0, 0, 0.002); // T-handle
      ch.position.z = recZ + recLen / 2 - 0.005;
    } else {
      box(ch, metal, 0.031, 0.055, 0, 0.008, 0.012, 0.03, 0, 0, 0, 0.002);
      ch.position.z = recZ + 0.02;
    }
    body.add(ch);
    parts.charging = ch;
    parts.chargingZ = ch.position.z;
  }
  // sling swivel up front
  if (HI) cyl(body, metal, 0, 0.01, parts.handguardZ - 0.05, 0.006, 0.004, 'x', 10);
  parts.length = L;
  parts.supportHand = new THREE.Vector3(0, 0.0, parts.pump ? parts.pumpZ : parts.handguardZ);
  parts.gripPos = new THREE.Vector3(0, -0.045, recZ + recLen / 2 - 0.04);
  parts.magWell = new THREE.Vector3(0, -0.06, recZ - recLen * 0.18);
}

/** Cylinder mesh stretched between two points (used for arms). */
export class Limb {
  constructor(parent, mat, r0, r1, segs = 12) {
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1, segs, 1, false), mat);
    parent.add(this.mesh);
    this._a = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }
  set(a, b) {
    const d = this._a.subVectors(b, a);
    const len = d.length();
    this.mesh.position.copy(a).addScaledVector(d, 0.5);
    this.mesh.scale.set(1, len, 1);
    this.mesh.quaternion.setFromUnitVectors(this._up, d.normalize());
  }
}

/**
 * Gloved hands posed around the weapon. Local frame after lookAt: +Z forward (toward
 * the muzzle), +Y up, +X to the right.
 */
function buildRightHand(M) {
  // closed around a near-vertical pistol grip centred on the origin
  const h = new THREE.Group();
  const G = M.glove;
  box(h, G, 0.021, -0.006, -0.006, 0.022, 0.075, 0.055, 0, 0, 0, 0.01); // back of hand
  box(h, M.gloveLeather, 0.021, -0.006, -0.006, 0.0235, 0.05, 0.03, 0, 0, 0, 0.006); // knuckle pad
  for (let i = 0; i < 4; i++) {
    const y = 0.012 - i * 0.017;
    box(h, G, 0.017, y, 0.02, 0.017, 0.016, 0.024, 0, 0, 0, 0.006); // proximal, forward
    box(h, G, 0.002, y, 0.032, 0.026, 0.015, 0.016, 0, 0, 0, 0.006); // middle, across the front
    box(h, G, -0.014, y - 0.001, 0.022, 0.014, 0.014, 0.02, 0, 0, 0, 0.006); // tip, back along the left side
  }
  // trigger finger extended along the frame above the others
  box(h, G, 0.012, 0.03, 0.03, 0.015, 0.015, 0.04, 0, 0.25, 0, 0.006);
  // thumb over the left side
  box(h, G, -0.017, 0.028, 0.004, 0.016, 0.017, 0.044, 0.15, -0.15, 0, 0.007);
  cyl(h, M.cuff, 0.016, -0.045, -0.03, 0.03, 0.034, 'y', 14); // glove cuff toward the wrist
  return h;
}

function buildLeftHand(M) {
  // supporting the handguard from below, fingers wrapping up the far side
  const h = new THREE.Group();
  const G = M.glove;
  box(h, G, 0.0, -0.022, -0.004, 0.054, 0.022, 0.07, 0, 0, 0, 0.01); // palm under the handguard
  box(h, M.gloveLeather, 0.0, -0.0115, -0.004, 0.04, 0.002, 0.05, 0, 0, 0, 0.001);
  for (let i = 0; i < 4; i++) {
    const z = 0.026 - i * 0.018;
    box(h, G, 0.031, -0.006, z, 0.016, 0.03, 0.016, 0, 0, 0.15, 0.006); // up the right side
    box(h, G, 0.033, 0.022, z, 0.014, 0.024, 0.015, 0, 0, -0.25, 0.006); // over the shoulder
  }
  box(h, G, -0.03, 0.0, 0.012, 0.016, 0.03, 0.03, 0, 0, -0.2, 0.007); // thumb on the near side
  box(h, G, -0.031, 0.026, 0.02, 0.014, 0.02, 0.02, 0, 0, 0.1, 0.006);
  cyl(h, M.cuff, -0.004, -0.03, -0.055, 0.03, 0.034, 'z', 14);
  return h;
}

/** First-person arms rig (sleeves, cuffs, gloved hands, wristwatch on the left). */
export function buildArms(materials) {
  const M = weaponMaterials(materials);
  const g = new THREE.Group();
  const rFore = new Limb(g, M.sleeve, 0.046, 0.036, 14);
  const lFore = new Limb(g, M.sleeve, 0.046, 0.036, 14);
  const rHand = buildRightHand(M), lHand = buildLeftHand(M);
  cyl(lHand, M.watch, -0.004, -0.03, -0.078, 0.033, 0.014, 'z', 16);
  box(lHand, M.watch, -0.004, -0.064, -0.078, 0.02, 0.006, 0.022, 0, 0, 0, 0.003);
  g.add(rHand, lHand);
  return { group: g, rFore, lFore, rHand, lHand };
}
