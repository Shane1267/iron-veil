import * as THREE from 'three';
import { settings } from '../core/SettingsManager.js';

// Pooled visual effects: particles (dust, sparks, smoke, blood, splashes), tracers,
// bullet-hole decals, ejected shell casings and muzzle-flash lights.

const MAX_PARTICLES = 2400;
const MAX_DECALS = 240;
const MAX_TRACERS = 48;
const MAX_SHELLS = 40;

function softDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function holeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(10,8,6,1)');
  grad.addColorStop(0.25, 'rgba(20,16,12,0.95)');
  grad.addColorStop(0.5, 'rgba(60,50,40,0.5)');
  grad.addColorStop(1, 'rgba(60,50,40,0)');
  g.fillStyle = grad;
  g.beginPath();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2, r = 22 + Math.random() * 9;
    g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 64);
  for (let i = 0; i < 7; i++) {
    g.rotate((Math.PI * 2) / 7 + Math.random() * 0.3);
    const grad = g.createLinearGradient(0, 0, 60, 0);
    grad.addColorStop(0, 'rgba(255,240,200,1)');
    grad.addColorStop(0.4, 'rgba(255,170,60,0.8)');
    grad.addColorStop(1, 'rgba(255,100,20,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, -5); g.lineTo(55 + Math.random() * 8, 0); g.lineTo(0, 5);
    g.fill();
  }
  const r = g.createRadialGradient(0, 0, 0, 0, 0, 30);
  r.addColorStop(0, 'rgba(255,255,230,1)');
  r.addColorStop(1, 'rgba(255,160,60,0)');
  g.fillStyle = r;
  g.fillRect(-64, -64, 128, 128);
  return new THREE.CanvasTexture(c);
}

const SURFACE_FX = {
  concrete: { color: [0.62, 0.6, 0.56], count: 10, speed: 2.5, size: 0.12, spark: 0, decal: [0.25, 0.24, 0.22] },
  brick: { color: [0.55, 0.32, 0.24], count: 10, speed: 2.5, size: 0.12, spark: 0, decal: [0.25, 0.2, 0.18] },
  plaster: { color: [0.78, 0.74, 0.66], count: 12, speed: 2.2, size: 0.14, spark: 0, decal: [0.35, 0.33, 0.3] },
  wood: { color: [0.45, 0.33, 0.2], count: 8, speed: 2.2, size: 0.09, spark: 0, decal: [0.18, 0.12, 0.08] },
  metal: { color: [1.0, 0.75, 0.35], count: 8, speed: 5, size: 0.05, spark: 1, decal: [0.3, 0.3, 0.3] },
  sheet: { color: [1.0, 0.75, 0.35], count: 6, speed: 4, size: 0.05, spark: 1, decal: [0.15, 0.15, 0.15] },
  glass: { color: [0.8, 0.9, 0.95], count: 14, speed: 3, size: 0.05, spark: 0, decal: null },
  sand: { color: [0.6, 0.53, 0.38], count: 12, speed: 2, size: 0.16, spark: 0, decal: null },
  terrain: { color: [0.42, 0.36, 0.26], count: 12, speed: 2.4, size: 0.18, spark: 0, decal: null },
  rock: { color: [0.55, 0.53, 0.5], count: 10, speed: 3, size: 0.1, spark: 0.3, decal: null },
  fabric: { color: [0.45, 0.45, 0.35], count: 6, speed: 1.5, size: 0.1, spark: 0, decal: null },
  water: { color: [0.75, 0.82, 0.85], count: 18, speed: 3.5, size: 0.14, spark: 0, decal: null },
  flesh: { color: [0.45, 0.04, 0.03], count: 10, speed: 1.8, size: 0.1, spark: 0, decal: null },
};

export class Effects {
  constructor(scene, viewScene, world) {
    this.scene = scene;
    this.viewScene = viewScene;
    this.world = world;

    // ---- particles
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 4);
    this.pSize = new Float32Array(MAX_PARTICLES);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pMax = new Float32Array(MAX_PARTICLES);
    this.pGrav = new Float32Array(MAX_PARTICLES);
    this.pGrow = new Float32Array(MAX_PARTICLES);
    this.pBaseA = new Float32Array(MAX_PARTICLES);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: softDotTexture() }, scale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float size; attribute vec4 color; varying vec4 vColor;
        uniform float scale;
        void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; varying vec4 vColor;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor.rgb, vColor.a * t.a); if (gl_FragColor.a < 0.01) discard; }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.pNext = 0;
    this.pAlive = 0;

    // ---- decals
    const dGeo = new THREE.PlaneGeometry(1, 1);
    this.decalMat = new THREE.MeshStandardMaterial({ map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.9 });
    this.decals = new THREE.InstancedMesh(dGeo, this.decalMat, MAX_DECALS);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 4;
    scene.add(this.decals);
    this.dNext = 0;
    this.decalColor = new THREE.Color();

    // ---- tracers
    const tGeo = new THREE.BoxGeometry(0.025, 0.025, 1);
    tGeo.translate(0, 0, -0.5);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending });
    this.tracerMesh = new THREE.InstancedMesh(tGeo, this.tracerMat, MAX_TRACERS);
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.count = MAX_TRACERS;
    this.tracers = [];
    for (let i = 0; i < MAX_TRACERS; i++) this.tracers.push({ life: 0 });
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_TRACERS; i++) this.tracerMesh.setMatrixAt(i, this._zero);
    scene.add(this.tracerMesh);

    // ---- shells
    const sGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 0.04, 6);
    sGeo.rotateX(Math.PI / 2);
    this.shellMesh = new THREE.InstancedMesh(sGeo, new THREE.MeshStandardMaterial({ color: 0xb08a40, metalness: 0.9, roughness: 0.3 }), MAX_SHELLS);
    this.shellMesh.frustumCulled = false;
    this.shells = [];
    for (let i = 0; i < MAX_SHELLS; i++) { this.shells.push({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3() }); this.shellMesh.setMatrixAt(i, this._zero); }
    this.sNext = 0;
    scene.add(this.shellMesh);

    // ---- muzzle flash (viewmodel) and light pool
    this.flashTex = flashTexture();
    this.flashMat = new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true });
    this.flashSprite = new THREE.Sprite(this.flashMat);
    this.flashSprite.visible = false;
    viewScene.add(this.flashSprite);
    this.worldFlashMat = this.flashMat.clone();
    this.worldFlashes = [];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(this.worldFlashMat);
      s.visible = false;
      s.scale.set(0.5, 0.5, 0.5);
      scene.add(s);
      this.worldFlashes.push({ sprite: s, life: 0 });
    }
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      // lights stay "visible" with zero intensity: toggling visibility changes the
      // light count and forces shader recompiles (frame hitches)
      const l = new THREE.PointLight(0xffb060, 0, 14, 2);
      scene.add(l);
      this.lights.push({ light: l, life: 0 });
    }
    this.lNext = 0;
    this.flashLife = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._z = new THREE.Vector3(0, 0, 1);
  }

  get quality() {
    return settings.get('effects');
  }

  // ------------------------------------------------------------ particles
  emit(x, y, z, opts) {
    const q = this.quality;
    const count = Math.max(1, Math.round((opts.count || 8) * (q === 0 ? 0.4 : q === 1 ? 0.75 : 1)));
    for (let n = 0; n < count; n++) {
      const i = this.pNext;
      this.pNext = (this.pNext + 1) % MAX_PARTICLES;
      const sp = opts.speed || 2;
      let vx = (Math.random() - 0.5) * 2, vy = Math.random() * 1.2, vz = (Math.random() - 0.5) * 2;
      if (opts.dir) {
        vx = opts.dir.x + (Math.random() - 0.5) * (opts.spread ?? 1);
        vy = opts.dir.y + (Math.random() - 0.5) * (opts.spread ?? 1) + 0.3;
        vz = opts.dir.z + (Math.random() - 0.5) * (opts.spread ?? 1);
      }
      const l = Math.hypot(vx, vy, vz) || 1;
      const s = sp * (0.4 + Math.random() * 0.8) / l;
      this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
      this.pVel[i * 3] = vx * s; this.pVel[i * 3 + 1] = vy * s; this.pVel[i * 3 + 2] = vz * s;
      const c = opts.color;
      const j = 0.85 + Math.random() * 0.3;
      this.pCol[i * 4] = c[0] * j; this.pCol[i * 4 + 1] = c[1] * j; this.pCol[i * 4 + 2] = c[2] * j;
      this.pBaseA[i] = opts.alpha ?? 1;
      this.pCol[i * 4 + 3] = this.pBaseA[i];
      this.pSize[i] = (opts.size || 0.1) * (0.6 + Math.random() * 0.8);
      this.pMax[i] = this.pLife[i] = (opts.life || 0.8) * (0.6 + Math.random() * 0.8);
      this.pGrav[i] = opts.gravity ?? 6;
      this.pGrow[i] = opts.grow ?? 0;
    }
  }

  impact(point, normal, material, dir) {
    const fx = SURFACE_FX[material] || SURFACE_FX.concrete;
    const refl = { x: normal.x * 1.2 - dir.x * 0.3, y: normal.y * 1.2 - dir.y * 0.3, z: normal.z * 1.2 - dir.z * 0.3 };
    this.emit(point.x, point.y, point.z, { color: fx.color, count: fx.count, speed: fx.speed, size: fx.size, dir: refl, spread: 1.2, life: fx.spark ? 0.35 : 0.9, gravity: fx.spark ? 9 : 3, grow: fx.spark ? 0 : 0.25, alpha: fx.spark ? 1 : 0.8 });
    if (fx.spark) this.emit(point.x, point.y, point.z, { color: [0.4, 0.38, 0.36], count: 3, speed: 0.6, size: 0.15, life: 0.8, gravity: -0.5, grow: 0.4, alpha: 0.5 });
    if (material === 'terrain' || material === 'sand') {
      this.emit(point.x, point.y, point.z, { color: fx.color, count: 5, speed: 1.0, size: 0.35, dir: { x: 0, y: 1, z: 0 }, spread: 0.6, life: 1.4, gravity: 0.6, grow: 0.5, alpha: 0.5 });
    }
    if (fx.decal) this.decal(point, normal, fx.decal, 0.07 + Math.random() * 0.04);
  }

  splash(x, y, z) {
    this.emit(x, y, z, { color: [0.8, 0.86, 0.9], count: 16, speed: 3, size: 0.1, dir: { x: 0, y: 2, z: 0 }, spread: 1.2, life: 0.7, gravity: 9, alpha: 0.8 });
  }

  blood(point, dir) {
    this.emit(point.x, point.y, point.z, { color: SURFACE_FX.flesh.color, count: 8, speed: 1.6, size: 0.09, dir: { x: dir.x, y: 0.3, z: dir.z }, spread: 0.8, life: 0.5, gravity: 8, alpha: 0.9 });
    this.emit(point.x, point.y, point.z, { color: [0.35, 0.05, 0.04], count: 3, speed: 0.3, size: 0.25, life: 0.6, gravity: 0.5, grow: 0.3, alpha: 0.5 });
  }

  smoke(x, y, z, amount = 1) {
    this.emit(x, y, z, { color: [0.6, 0.6, 0.58], count: Math.ceil(3 * amount), speed: 0.4, size: 0.18, life: 1.3, gravity: -0.4, grow: 0.5, alpha: 0.28, dir: { x: 0, y: 0.6, z: 0 }, spread: 0.6 });
  }

  fireEmbers(x, y, z) {
    this.emit(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4, { color: [1.2, 0.55, 0.15], count: 2, speed: 0.6, size: 0.12, dir: { x: 0, y: 1.5, z: 0 }, spread: 0.4, life: 0.8, gravity: -1.2, alpha: 0.9 });
    if (Math.random() < 0.4) this.emit(x, y + 0.6, z, { color: [0.3, 0.3, 0.3], count: 1, speed: 0.4, size: 0.4, dir: { x: 0, y: 1, z: 0 }, spread: 0.2, life: 2.5, gravity: -0.4, grow: 0.6, alpha: 0.25 });
  }

  decal(point, normal, color, size) {
    const i = this.dNext;
    this.dNext = (this.dNext + 1) % MAX_DECALS;
    this._q.setFromUnitVectors(this._z, this._v.set(normal.x, normal.y, normal.z).normalize());
    const spin = new THREE.Quaternion().setFromAxisAngle(this._z, Math.random() * Math.PI * 2);
    this._q.multiply(spin);
    this._m.compose(this._v.set(point.x + normal.x * 0.01, point.y + normal.y * 0.01, point.z + normal.z * 0.01), this._q, this._s.set(size, size, size));
    this.decals.setMatrixAt(i, this._m);
    this.decals.setColorAt(i, this.decalColor.setRGB(color[0] * 3, color[1] * 3, color[2] * 3));
    this.decals.count = Math.max(this.decals.count, i + 1);
    this.decals.instanceMatrix.needsUpdate = true;
    if (this.decals.instanceColor) this.decals.instanceColor.needsUpdate = true;
  }

  clearDecals() {
    this.decals.count = 0;
  }

  // ------------------------------------------------------------ tracers & flashes
  tracer(from, to, speed = 700) {
    const t = this.tracers.find((x) => x.life <= 0);
    if (!t) return;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 3) return;
    t.from = { x: from.x, y: from.y, z: from.z };
    t.dir = { x: dx / len, y: dy / len, z: dz / len };
    t.len = len;
    t.d = 2;
    t.speed = speed;
    t.life = len / speed + 0.05;
    t.index = this.tracers.indexOf(t);
  }

  muzzleFlashView(muzzleObj, scale = 1) {
    muzzleObj.getWorldPosition(this.flashSprite.position);
    this.flashSprite.scale.setScalar(0.16 * scale * (0.8 + Math.random() * 0.4));
    this.flashMat.rotation = Math.random() * Math.PI;
    this.flashSprite.visible = true;
    this.flashLife = 0.045;
  }

  worldFlash(x, y, z, scale = 1, light = true) {
    const f = this.worldFlashes.find((w) => w.life <= 0) || this.worldFlashes[0];
    f.sprite.position.set(x, y, z);
    f.sprite.scale.setScalar(0.6 * scale);
    f.sprite.visible = true;
    f.life = 0.05;
    if (light) this.flashLight(x, y, z, 2.5 * scale);
  }

  flashLight(x, y, z, intensity = 3) {
    const L = this.lights[this.lNext];
    this.lNext = (this.lNext + 1) % this.lights.length;
    L.light.position.set(x, y, z);
    L.light.intensity = intensity;
    L.life = 0.06;
  }

  shell(pos, vel) {
    const s = this.shells[this.sNext];
    this.sNext = (this.sNext + 1) % MAX_SHELLS;
    s.p.copy(pos);
    s.v.copy(vel);
    s.w.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
    s.r.set(0, Math.random() * 6, 0);
    s.life = 2.5;
    s.bounced = 0;
  }

  update(dt, camera) {
    // particles
    let alive = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) {
        if (this.pCol[i * 4 + 3] !== 0) { this.pCol[i * 4 + 3] = 0; this.pSize[i] = 0; }
        continue;
      }
      alive++;
      this.pLife[i] -= dt;
      this.pVel[i * 3 + 1] -= this.pGrav[i] * dt;
      const drag = Math.exp(-dt * 1.5);
      this.pVel[i * 3] *= drag; this.pVel[i * 3 + 2] *= drag;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      this.pSize[i] += this.pGrow[i] * dt;
      const t = Math.max(0, this.pLife[i] / this.pMax[i]);
      this.pCol[i * 4 + 3] = this.pBaseA[i] * Math.min(1, t * 2.5);
    }
    this.pAlive = alive;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    this.points.material.uniforms.scale.value = (window.innerHeight || 800) * 0.75;

    // tracers
    let tracerDirty = false;
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      tracerDirty = true;
      t.life -= dt;
      t.d += t.speed * dt;
      const segLen = Math.min(14, t.d);
      if (t.life <= 0 || t.d > t.len) {
        t.life = 0;
        this.tracerMesh.setMatrixAt(t.index, this._zero);
        continue;
      }
      const head = this._v.set(t.from.x + t.dir.x * t.d, t.from.y + t.dir.y * t.d, t.from.z + t.dir.z * t.d);
      this._q.setFromUnitVectors(this._z, new THREE.Vector3(-t.dir.x, -t.dir.y, -t.dir.z));
      this._m.compose(head, this._q, this._s.set(1, 1, segLen));
      this.tracerMesh.setMatrixAt(t.index, this._m);
    }
    if (tracerDirty) this.tracerMesh.instanceMatrix.needsUpdate = true;

    // shells
    let shellDirty = false;
    for (let i = 0; i < MAX_SHELLS; i++) {
      const s = this.shells[i];
      if (s.life <= 0) continue;
      shellDirty = true;
      s.life -= dt;
      s.v.y -= 9.8 * dt;
      s.p.addScaledVector(s.v, dt);
      s.r.x += s.w.x * dt; s.r.y += s.w.y * dt; s.r.z += s.w.z * dt;
      const gy = this.world.heightAt(s.p.x, s.p.z);
      if (s.p.y < gy + 0.01) {
        s.p.y = gy + 0.01;
        if (s.bounced < 2 && s.v.y < -1) {
          s.v.y *= -0.3; s.v.x *= 0.5; s.v.z *= 0.5; s.bounced++;
          if (s.bounced === 1) this.onShellBounce?.(s.p);
        } else { s.v.set(0, 0, 0); s.w.multiplyScalar(0.9); }
      }
      if (s.life <= 0) { this.shellMesh.setMatrixAt(i, this._zero); continue; }
      this._q.setFromEuler(s.r);
      this._m.compose(s.p, this._q, this._s.set(1, 1, 1));
      this.shellMesh.setMatrixAt(i, this._m);
    }
    if (shellDirty) this.shellMesh.instanceMatrix.needsUpdate = true;

    // flashes
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      if (this.flashLife <= 0) this.flashSprite.visible = false;
    }
    for (const f of this.worldFlashes) if (f.life > 0) { f.life -= dt; if (f.life <= 0) f.sprite.visible = false; }
    for (const L of this.lights) {
      if (L.life > 0) {
        L.life -= dt;
        L.light.intensity *= 0.6;
        if (L.life <= 0) L.light.intensity = 0;
      }
    }
    void camera;
  }
}
