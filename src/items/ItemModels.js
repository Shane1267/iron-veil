import * as THREE from 'three';
import { ItemDB } from './ItemDatabase.js';
import { buildWeaponModel } from '../weapons/WeaponModels.js';

// Procedural 3D models for every item, used for ground drops and rendered once into
// inventory icons (so the UI never relies on emoji or placeholder glyphs).

const std = (color, rough = 0.7, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const add = (g, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  g.add(m);
  return m;
};

export function buildItemModel(id, materials) {
  const def = ItemDB.get(id);
  if (!def) return new THREE.Group();
  if (def.cat === 'weapon') {
    const p = buildWeaponModel(id, def.weapon.defaultAttach || {}, materials);
    return p.root;
  }
  const g = new THREE.Group();
  const col = def.color || '#888';
  const c = std(col);
  switch (def.shape) {
    case 'ammo': {
      add(g, new THREE.BoxGeometry(0.1, 0.06, 0.07), std('#6a5a3a', 0.9), 0, 0.03, 0);
      for (let i = 0; i < 5; i++) {
        add(g, new THREE.CylinderGeometry(0.006, 0.006, 0.04, 8), std(col, 0.3, 0.9), -0.03 + i * 0.015, 0.075, 0.015);
        add(g, new THREE.ConeGeometry(0.006, 0.012, 8), std('#b06a3a', 0.3, 0.9), -0.03 + i * 0.015, 0.1, 0.015);
      }
      break;
    }
    case 'shell': {
      add(g, new THREE.BoxGeometry(0.1, 0.05, 0.07), std('#3a3a34', 0.9), 0, 0.025, 0);
      for (let i = 0; i < 4; i++) {
        add(g, new THREE.CylinderGeometry(0.01, 0.01, 0.05, 10), std(col, 0.6), -0.03 + i * 0.02, 0.07, 0.01);
        add(g, new THREE.CylinderGeometry(0.0105, 0.0105, 0.012, 10), std('#b08a40', 0.3, 0.9), -0.03 + i * 0.02, 0.05, 0.01);
      }
      break;
    }
    case 'reflex': add(g, new THREE.BoxGeometry(0.03, 0.012, 0.05), c, 0, 0.006, 0); add(g, new THREE.BoxGeometry(0.036, 0.04, 0.004), c, 0, 0.03, 0); add(g, new THREE.BoxGeometry(0.028, 0.03, 0.002), std('#8ab', 0.05), 0, 0.03, 0.004); break;
    case 'scope': add(g, new THREE.CylinderGeometry(0.016, 0.016, 0.2, 14), std(col, 0.4, 0.8), 0, 0.03, 0, Math.PI / 2); add(g, new THREE.CylinderGeometry(0.024, 0.016, 0.05, 14), std(col, 0.4, 0.8), 0, 0.03, -0.11, Math.PI / 2); break;
    case 'suppressor': add(g, new THREE.CylinderGeometry(0.02, 0.02, 0.17, 14), c, 0, 0.02, 0, Math.PI / 2); break;
    case 'grip': add(g, new THREE.BoxGeometry(0.025, 0.08, 0.03), c, 0, 0.04, 0); break;
    case 'light': case 'flashlight': add(g, new THREE.CylinderGeometry(0.015, 0.02, 0.14, 12), c, 0, 0.02, 0, Math.PI / 2); add(g, new THREE.CylinderGeometry(0.019, 0.019, 0.003, 12), std('#fff6d0', 0.1), 0, 0.02, -0.071, Math.PI / 2); break;
    case 'mag': add(g, new THREE.BoxGeometry(0.03, 0.16, 0.07), c, 0, 0.08, 0, 0.2); break;
    case 'stock': add(g, new THREE.BoxGeometry(0.04, 0.08, 0.22), c, 0, 0.04, 0); break;
    case 'roll': add(g, new THREE.CylinderGeometry(0.03, 0.03, 0.07, 16), c, 0, 0.035, 0); break;
    case 'kit': add(g, new THREE.BoxGeometry(0.16, 0.08, 0.1), c, 0, 0.04, 0); add(g, new THREE.BoxGeometry(0.06, 0.004, 0.018), std('#c0392b'), 0, 0.081, 0); add(g, new THREE.BoxGeometry(0.018, 0.004, 0.06), std('#c0392b'), 0, 0.081, 0); break;
    case 'pills': add(g, new THREE.CylinderGeometry(0.02, 0.02, 0.06, 14), std('#d8a040', 0.4), 0, 0.03, 0); add(g, new THREE.CylinderGeometry(0.022, 0.022, 0.015, 14), std('#eee'), 0, 0.067, 0); break;
    case 'bag': add(g, new THREE.BoxGeometry(0.1, 0.14, 0.02), std(col, 0.3), 0, 0.07, 0); add(g, new THREE.CylinderGeometry(0.004, 0.004, 0.06), std('#ccc'), 0, -0.02, 0); break;
    case 'can': add(g, new THREE.CylinderGeometry(0.035, 0.035, 0.1, 16), std('#9a9a9a', 0.35, 0.8), 0, 0.05, 0); add(g, new THREE.CylinderGeometry(0.0355, 0.0355, 0.06, 16), c, 0, 0.05, 0); break;
    case 'box': add(g, new THREE.BoxGeometry(0.1, 0.12, 0.04), c, 0, 0.06, 0); break;
    case 'bar': add(g, new THREE.BoxGeometry(0.12, 0.015, 0.035), c, 0, 0.008, 0); break;
    case 'apple': add(g, new THREE.SphereGeometry(0.04, 12, 10), std(col, 0.5), 0, 0.04, 0); add(g, new THREE.CylinderGeometry(0.002, 0.002, 0.02), std('#4a3a20'), 0, 0.085, 0); break;
    case 'bottle': add(g, new THREE.CylinderGeometry(0.032, 0.032, 0.18, 14), new THREE.MeshStandardMaterial({ color: col, roughness: 0.1, transparent: true, opacity: 0.7 }), 0, 0.09, 0); add(g, new THREE.CylinderGeometry(0.012, 0.02, 0.04, 12), std('#3a6ab0'), 0, 0.2, 0); break;
    case 'battery': add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.05, 12), c, 0, 0.025, 0); break;
    case 'hammer': add(g, new THREE.CylinderGeometry(0.01, 0.012, 0.3, 8), std('#7a5a34'), 0, 0.15, 0); add(g, new THREE.BoxGeometry(0.1, 0.03, 0.03), std('#555', 0.4, 0.8), 0, 0.3, 0); break;
    case 'saw': add(g, new THREE.BoxGeometry(0.35, 0.08, 0.004), std('#aaa', 0.3, 0.9), 0, 0.04, 0); add(g, new THREE.BoxGeometry(0.08, 0.1, 0.02), std('#8a3a1a'), 0.2, 0.05, 0); break;
    case 'wrench': add(g, new THREE.BoxGeometry(0.22, 0.02, 0.006), std('#888', 0.3, 0.9), 0, 0.01, 0); add(g, new THREE.TorusGeometry(0.02, 0.008, 6, 10, 4.5), std('#888', 0.3, 0.9), 0.12, 0.01, 0); break;
    case 'map': case 'paper': add(g, new THREE.BoxGeometry(0.14, 0.004, 0.1), std(col, 0.9), 0, 0.002, 0); break;
    case 'book': add(g, new THREE.BoxGeometry(0.12, 0.03, 0.16), c, 0, 0.015, 0); add(g, new THREE.BoxGeometry(0.115, 0.025, 0.155), std('#e8e0c8'), 0.003, 0.015, 0); break;
    case 'cap': add(g, new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), c, 0, 0, 0); add(g, new THREE.BoxGeometry(0.12, 0.006, 0.08), c, 0, 0.005, 0.09); break;
    case 'helmet': add(g, new THREE.SphereGeometry(0.12, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), std(col, 0.8), 0, 0, 0); break;
    case 'jacket': add(g, new THREE.BoxGeometry(0.3, 0.32, 0.08), c, 0, 0.16, 0); add(g, new THREE.BoxGeometry(0.08, 0.28, 0.08), c, -0.19, 0.16, 0, 0, 0, 0.25); add(g, new THREE.BoxGeometry(0.08, 0.28, 0.08), c, 0.19, 0.16, 0, 0, 0, -0.25); break;
    case 'vest': add(g, new THREE.BoxGeometry(0.3, 0.34, 0.1), c, 0, 0.17, 0); for (const x of [-0.08, 0, 0.08]) add(g, new THREE.BoxGeometry(0.07, 0.1, 0.04), c, x, 0.12, 0.07); break;
    case 'pack': add(g, new THREE.BoxGeometry(0.28, 0.38, 0.16), c, 0, 0.19, 0); add(g, new THREE.BoxGeometry(0.22, 0.14, 0.06), c, 0, 0.12, 0.1); break;
    case 'cloth': add(g, new THREE.BoxGeometry(0.16, 0.03, 0.12), c, 0, 0.015, 0, 0, 0.3); break;
    case 'plank': for (let i = 0; i < 3; i++) add(g, new THREE.BoxGeometry(0.5, 0.025, 0.08), std(col, 0.85), 0, 0.012 + i * 0.026, 0, 0, i * 0.08); break;
    case 'log': add(g, new THREE.CylinderGeometry(0.08, 0.09, 0.5, 12), std(col, 0.9), 0, 0.08, 0, 0, 0, Math.PI / 2); break;
    case 'nails': add(g, new THREE.BoxGeometry(0.08, 0.05, 0.06), std('#8a6a3a', 0.9), 0, 0.025, 0); break;
    case 'sheet': add(g, new THREE.BoxGeometry(0.3, 0.01, 0.2), std(col, 0.5, 0.6), 0, 0.005, 0); break;
    case 'scrap': add(g, new THREE.BoxGeometry(0.12, 0.02, 0.08), std(col, 0.7, 0.5), 0, 0.01, 0, 0.2, 0.4); add(g, new THREE.CylinderGeometry(0.01, 0.01, 0.15), std('#6a6a6a', 0.5, 0.7), 0.02, 0.02, 0, 0, 0, 1.4); break;
    case 'rope': add(g, new THREE.TorusGeometry(0.06, 0.012, 8, 20), std(col, 0.9), 0, 0.012, 0, Math.PI / 2); break;
    case 'sack': add(g, new THREE.BoxGeometry(0.22, 0.08, 0.3), std(col, 0.95), 0, 0.04, 0); break;
    case 'board': add(g, new THREE.BoxGeometry(0.12, 0.004, 0.08), std(col, 0.5), 0, 0.002, 0); for (let i = 0; i < 4; i++) add(g, new THREE.BoxGeometry(0.015, 0.006, 0.015), std('#222'), -0.04 + i * 0.025, 0.006, 0); break;
    case 'gear': add(g, new THREE.TorusGeometry(0.04, 0.012, 6, 12), std('#777', 0.4, 0.8), 0, 0.012, 0, Math.PI / 2); break;
    case 'plug': add(g, new THREE.CylinderGeometry(0.008, 0.012, 0.08, 8), std('#ddd', 0.3), 0, 0.04, 0); break;
    case 'carbattery': add(g, new THREE.BoxGeometry(0.25, 0.18, 0.17), std('#222', 0.6), 0, 0.09, 0); add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.02), std('#c33'), 0.08, 0.19, 0); add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.02), std('#333'), -0.08, 0.19, 0); break;
    case 'jerrycan': add(g, new THREE.BoxGeometry(0.17, 0.34, 0.26), std(col, 0.6, 0.3), 0, 0.17, 0); add(g, new THREE.BoxGeometry(0.03, 0.04, 0.12), std(col, 0.6, 0.3), 0, 0.36, 0.02); break;
    case 'watch': add(g, new THREE.CylinderGeometry(0.02, 0.02, 0.008, 16), std(col, 0.3, 0.9), 0, 0.004, 0); add(g, new THREE.BoxGeometry(0.018, 0.004, 0.09), std('#3a2a1a'), 0, 0.002, 0); break;
    default: add(g, new THREE.BoxGeometry(0.1, 0.1, 0.1), c, 0, 0.05, 0);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** Renders item models to small PNG data URLs for the inventory UI. */
export class IconRenderer {
  constructor(materials, size = 112) {
    this.materials = materials;
    this.size = size;
    this.cache = new Map();
    this.renderer = null;
  }

  _init() {
    if (this.renderer) return;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = this.size;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.size, this.size, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x3a3428, 1.4));
    const key = new THREE.DirectionalLight(0xfff4e0, 2.4);
    key.position.set(2, 3, 2.5);
    const rim = new THREE.DirectionalLight(0xa0b8ff, 1.0);
    rim.position.set(-3, 1, -2);
    this.scene.add(key, rim);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  }

  icon(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    let url = '';
    try {
      this._init();
      const model = buildItemModel(id, this.materials);
      const def = ItemDB.get(id);
      // weapons lie sideways, everything else at a three-quarter angle
      if (def?.cat === 'weapon') model.rotation.set(0, Math.PI / 2, 0);
      else model.rotation.set(0.35, -0.7, 0);
      this.scene.add(model);
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      const dist = size / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) * 1.05;
      this.camera.position.set(center.x + dist * 0.15, center.y + dist * 0.35, center.z + dist * 0.92);
      this.camera.lookAt(center);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.render(this.scene, this.camera);
      url = this.renderer.domElement.toDataURL('image/png');
      this.scene.remove(model);
      model.traverse((o) => { if (o.isMesh && !o.geometry.userData.shared) o.geometry.dispose(); });
    } catch (e) {
      console.warn('[Icons] render failed for', id, e);
    }
    this.cache.set(id, url);
    return url;
  }
}
