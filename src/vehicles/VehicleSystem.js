import * as THREE from 'three';
import vehicleData from '../data/vehicles.json';
import { BoxBuilder } from '../world/GeometryKit.js';
import { Inventory } from '../items/Inventory.js';
import { ItemDB } from '../items/ItemDatabase.js';
import { bus } from '../core/EventBus.js';
import { clamp, damp, angleWrap } from '../core/MathUtil.js';

// Drivable vehicles: kinematic bicycle model with terrain-following suspension,
// collision against world colliders, fuel, damage, missing parts, storage, headlights,
// persistence and an AI driver used by convoys.

export const VTYPES = Object.fromEntries(vehicleData.types.map((t) => [t.id, t]));

function buildVehicleMesh(t, materials) {
  const B = new BoxBuilder(materials);
  const [W, H, L] = t.dims;
  const paint = t.style === 'truck' || t.style === 'offroad' ? 'olive' : t.id === 'utility' ? 'paint_white' : 'wood_red';
  const tint = new THREE.Color(t.color);
  void tint;
  const cl = 0.55; // ground clearance to chassis
  B.box('metal_dark', 0, cl, 0, W * 0.9, 0.25, L * 0.92);
  if (t.style === 'pickup' || t.style === 'offroad') {
    B.box(paint, 0, cl + 0.45, -L * 0.3, W, 0.6, L * 0.38); // hood/engine
    B.box(paint, 0, cl + 0.45, L * 0.1, W, 0.6, L * 0.42); // body sides
    B.box(paint, 0, cl + 1.0, -L * 0.02, W * 0.94, 0.62, L * 0.32); // cabin
    B.box('glass', 0, cl + 1.05, -L * 0.18 - 0.02, W * 0.86, 0.48, 0.04);
    B.box('glass', W * 0.47 + 0.01, cl + 1.05, -L * 0.02, 0.02, 0.45, L * 0.26);
    B.box('glass', -W * 0.47 - 0.01, cl + 1.05, -L * 0.02, 0.02, 0.45, L * 0.26);
    if (t.style === 'pickup') {
      B.box('metal_dark', 0, cl + 0.35, L * 0.32, W * 0.92, 0.1, L * 0.34); // bed floor
      B.box(paint, W * 0.47, cl + 0.6, L * 0.32, 0.06, 0.5, L * 0.34);
      B.box(paint, -W * 0.47, cl + 0.6, L * 0.32, 0.06, 0.5, L * 0.34);
      B.box(paint, 0, cl + 0.6, L * 0.49, W, 0.5, 0.06);
    } else {
      B.box(paint, 0, cl + 1.0, L * 0.3, W * 0.94, 0.62, L * 0.32);
      B.box('black', 0, cl + 1.35, 0, W * 0.98, 0.06, L * 0.7);
      B.box('black', 0, cl + 0.9, L / 2 + 0.15, 0.5, 0.5, 0.25); // spare wheel
    }
  } else if (t.style === 'van') {
    B.box(paint, 0, cl + 0.95, 0.15, W, 1.75, L * 0.78);
    B.box(paint, 0, cl + 0.55, -L * 0.38, W, 0.85, L * 0.22);
    B.box('glass', 0, cl + 1.35, -L * 0.24, W * 0.9, 0.6, 0.04, { rotX: -0.3 });
    B.box('corrugated_blue', 0, cl + 1.2, 0.5, W + 0.01, 0.12, L * 0.5);
  } else {
    // military truck: cab + canvas-covered cargo bed
    B.box(paint, 0, cl + 0.55, -L * 0.36, W, 0.9, L * 0.26);
    B.box(paint, 0, cl + 1.35, -L * 0.3, W * 0.96, 0.9, L * 0.2);
    B.box('glass', 0, cl + 1.45, -L * 0.4 - 0.02, W * 0.86, 0.5, 0.04);
    B.box('metal_dark', 0, cl + 0.45, L * 0.15, W, 0.15, L * 0.68);
    B.box('canvas', 0, cl + 1.45, L * 0.15, W * 1.02, 1.85, L * 0.66);
    B.box('olive', 0, cl + 0.35, -L / 2, W, 0.25, 0.15);
  }
  // bumpers & lights
  B.box('metal_dark', 0, cl + 0.2, -L / 2, W * 1.02, 0.18, 0.12);
  B.box('metal_dark', 0, cl + 0.2, L / 2, W * 1.02, 0.18, 0.12);
  // lamp housings (the lenses are separate meshes so they can light up)
  for (const sx of [-1, 1]) {
    B.box('metal_dark', sx * W * 0.35, cl + 0.5, -L / 2 + 0.02, 0.28, 0.2, 0.06);
    B.box('metal_dark', sx * W * 0.38, cl + 0.5, L / 2 - 0.02, 0.2, 0.16, 0.06);
  }
  const body = B.build();
  body.castShadow = true;
  body.receiveShadow = true;
  // paint colour from vehicle type
  const mats = Array.isArray(body.material) ? body.material : [body.material];
  body.material = mats.map((m) => (m.name === paint ? (() => { const c = m.clone(); c.color.set(t.color); return c; })() : m));
  const root = new THREE.Group();
  root.add(body);
  const wheels = [];
  const wr = t.style === 'truck' ? 0.55 : 0.4;
  const wg = new THREE.CylinderGeometry(wr, wr, 0.3, 14);
  wg.rotateZ(Math.PI / 2);
  const wmat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  const hubm = new THREE.MeshStandardMaterial({ color: 0x5a5a5a, metalness: 0.7, roughness: 0.4 });
  const axle = L * 0.33;
  for (const [x, z] of [[-W / 2, -axle], [W / 2, -axle], [-W / 2, axle], [W / 2, axle]]) {
    const w = new THREE.Group();
    const tire = new THREE.Mesh(wg, wmat);
    tire.castShadow = true;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(wr * 0.5, wr * 0.5, 0.32, 8).rotateZ(Math.PI / 2), hubm);
    w.add(tire, hub);
    w.position.set(x * 0.95, wr, z);
    root.add(w);
    wheels.push(w);
  }
  // lamps: lenses with their own materials, glow sprites and faint beam cones seen from outside
  const lamps = { head: [], tail: [], glow: [], beams: [] };
  const headMat = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, emissive: 0xfff0d0, emissiveIntensity: 0, roughness: 0.15, metalness: 0.1 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x5a1010, emissive: 0xff2010, emissiveIntensity: 0, roughness: 0.3 });
  const lensGeo = new THREE.BoxGeometry(0.22, 0.14, 0.03), tailGeo = new THREE.BoxGeometry(0.16, 0.12, 0.03);
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(lensGeo, headMat);
    hl.position.set(sx * W * 0.35, cl + 0.5, -L / 2 - 0.015);
    const tl = new THREE.Mesh(tailGeo, tailMat);
    tl.position.set(sx * W * 0.38, cl + 0.5, L / 2 + 0.015);
    const glow = new THREE.Sprite(glowMaterial());
    glow.position.set(sx * W * 0.35, cl + 0.5, -L / 2 - 0.12);
    glow.scale.set(0.9, 0.9, 1);
    glow.visible = false;
    const beam = new THREE.Mesh(beamGeometry(), beamMaterial());
    beam.position.set(sx * W * 0.35, cl + 0.5, -L / 2 - 0.05);
    beam.rotation.x = -0.06;
    beam.visible = false;
    beam.renderOrder = 6;
    root.add(hl, tl, glow, beam);
    lamps.head.push(hl); lamps.tail.push(tl); lamps.glow.push(glow); lamps.beams.push(beam);
  }
  lamps.headMat = headMat;
  lamps.tailMat = tailMat;
  return { root, body, wheels, wheelRadius: wr, axle, lamps };
}

let _glowMat = null, _beamGeo = null, _beamMat = null;
function glowMaterial() {
  if (_glowMat) return _glowMat;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,248,230,1)'); gr.addColorStop(0.2, 'rgba(255,235,200,0.55)'); gr.addColorStop(1, 'rgba(255,220,170,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  _glowMat = new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  return _glowMat;
}
function beamGeometry() {
  if (_beamGeo) return _beamGeo;
  // open cone along -z, brighter near the lamp (vertex alpha in colour)
  const g = new THREE.CylinderGeometry(0.1, 2.2, 12, 18, 4, true);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -6);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { const k = Math.max(0, 1 + pos.getZ(i) / 12); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k * k; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  _beamGeo = g;
  return g;
}
function beamMaterial() {
  if (!_beamMat) _beamMat = new THREE.MeshBasicMaterial({ color: 0xfff0d0, vertexColors: true, transparent: true, opacity: 0.022, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide });
  return _beamMat;
}

export class Vehicle {
  constructor(sys, rec) {
    this.sys = sys;
    this.game = sys.game;
    this.id = rec.id;
    this.t = VTYPES[rec.type];
    this.type = rec.type;
    this.pos = new THREE.Vector3(rec.x, rec.y ?? this.game.world.heightAt(rec.x, rec.z), rec.z);
    this.yaw = rec.rot || 0;
    this.speed = 0;
    this.steer = 0;
    this.fuel = clamp(rec.fuel ?? this.t.fuelCap * 0.3, 0, this.t.fuelCap);
    this.health = clamp(rec.health ?? this.t.health, 0, this.t.health);
    this.needs = Array.isArray(rec.needs) ? rec.needs.filter((n) => ItemDB.exists(n)) : [];
    this.engineOn = false;
    this.lightsOn = false;
    this.driver = null;
    this.pitch = 0;
    this.roll = 0;
    this.bodyY = this.pos.y;
    this.vy = 0;
    this.transient = !!rec.transient;
    this.destroyed = this.health <= 0;
    const m = buildVehicleMesh(this.t, this.game.materials);
    this.mesh = m;
    this.game.renderer.scene.add(m.root);
    this.colliders = [];
    this._placeColliders();
    const sid = `veh:${this.id}`;
    this.storage = this.game.loot.get(sid) || this.game.loot.register(sid, new Inventory(this.t.storage, `${this.t.name} storage`), { meta: { vehicle: true }, transient: this.transient });
    this.interact = this.game.interactables.add({ id: `vehi:${this.id}`, kind: 'vehicle', x: this.pos.x, y: this.pos.y + 1, z: this.pos.z, radius: Math.max(this.t.dims[2] * 0.5, 2.2), label: () => this.label(), data: { vehicle: this } });
    this.trunk = this.game.interactables.add({ id: `veht:${this.id}`, kind: 'container', x: this.pos.x, y: this.pos.y + 1, z: this.pos.z, radius: 1.4, label: 'Open storage', priority: 1, data: { containerId: sid, name: `${this.t.name} storage`, custom: true } });
    this.braking = false;
    this.wheelSpin = 0;
    this.aiRoute = null;
    this._sync();
  }

  label() {
    if (this.destroyed) return `${this.t.name} (wrecked)`;
    const parts = this.needs.length ? ` — needs ${this.needs.map((n) => ItemDB.get(n).name).join(', ')}` : '';
    return `Drive ${this.t.name} (fuel ${Math.round(this.fuel)} L, ${Math.round((this.health / this.t.health) * 100)}%)${parts}`;
  }

  get forward() { return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; }

  _circles() {
    const f = this.forward;
    const L = this.t.dims[2];
    const r = this.t.dims[0] * 0.5;
    const n = Math.max(2, Math.round(L / (r * 2)));
    const out = [];
    for (let i = 0; i < n; i++) {
      const o = -L / 2 + r + (i * (L - 2 * r)) / Math.max(1, n - 1);
      out.push({ x: this.pos.x + f.x * o, z: this.pos.z + f.z * o, r });
    }
    return out;
  }

  _placeColliders() {
    for (const c of this.colliders) this.game.physics.remove(c);
    this.colliders = [];
    const H = this.t.dims[1];
    for (const c of this._circles()) {
      const col = this.game.physics.addCylinder(c.x, c.z, c.r * 0.95, this.pos.y + 0.3, this.pos.y + H, { material: 'metal', owner: `veh:${this.id}`, tag: 'vehicle' });
      col.vehicle = this;
      col.onBulletHit = (dmg) => this.damage(dmg * 0.4);
      this.colliders.push(col);
    }
    this._colPos = this.pos.clone();
  }

  damage(d) {
    if (this.destroyed) return;
    this.health -= d;
    if (this.health <= 0) {
      this.health = 0;
      this.destroyed = true;
      this.engineOn = false;
      bus.emit('sound', { type: 'explosion', x: this.pos.x, y: this.pos.y, z: this.pos.z });
      bus.emit('noise', { x: this.pos.x, y: this.pos.y, z: this.pos.z, radius: 400, source: null, type: 'gunshot' });
      this.game.effects.emit(this.pos.x, this.pos.y + 1, this.pos.z, { color: [0.2, 0.2, 0.2], count: 40, speed: 2, size: 0.6, life: 3, gravity: -1, grow: 1, alpha: 0.6 });
      // burnt look: clone materials so shared materials are untouched
      this.mesh.body.material = [].concat(this.mesh.body.material).map((m) => { const c = m.clone(); if (c.color) c.color.multiplyScalar(0.22); return c; });
      if (this.driver) this.sys.exit(this.driver === 'player' ? this.game.player : null, true);
      this.onDestroyed?.();
    }
  }

  canStart() {
    if (this.destroyed) return 'Wrecked';
    if (this.needs.length) return `Missing ${this.needs.map((n) => ItemDB.get(n).name).join(', ')}`;
    if (this.fuel <= 0.05) return 'Out of fuel';
    return null;
  }

  /** controls: {throttle -1..1, steer -1..1, brake bool} */
  update(dt, controls) {
    const t = this.t;
    const world = this.game.world;
    const water = world.waterAt(this.pos.x, this.pos.z);
    if (water !== null && water - world.heightAt(this.pos.x, this.pos.z) > 1.1 && this.engineOn) {
      this.engineOn = false;
      if (this.driver === 'player') bus.emit('notify', { text: 'Engine flooded', kind: 'warn' });
    }
    let throttle = controls?.throttle || 0;
    this.braking = !!controls?.brake || (throttle < 0 && this.speed > 0.5);
    const steerIn = controls?.steer || 0;
    if (!this.engineOn) throttle = 0;
    const maxSteer = 0.6 * t.steer / 0.55 * (1 - Math.min(0.65, Math.abs(this.speed) / t.maxSpeed * 0.7));
    this.steer = damp(this.steer, steerIn * maxSteer, 6, dt);
    // longitudinal dynamics
    const mass = t.mass;
    let acc = 0;
    if (throttle > 0) acc += (t.engine / mass) * throttle * (1 - Math.max(0, this.speed) / t.maxSpeed);
    if (throttle < 0) {
      if (this.speed > 0.5) acc -= 9 * -throttle; // braking with S while moving forward
      else acc += (t.engine / mass) * throttle * 0.6 * (1 - Math.max(0, -this.speed) / t.reverse);
    }
    if (controls?.brake) acc -= Math.sign(this.speed) * 10;
    acc -= this.speed * 0.08 + Math.sign(this.speed) * (0.4 + 0.0022 * this.speed * this.speed);
    acc -= 9.8 * Math.sin(this.pitch) * 0.9;
    const prev = this.speed;
    this.speed += acc * dt;
    if (!throttle && Math.abs(this.speed) < 0.15) this.speed = 0;
    if (controls?.brake && Math.sign(prev) !== Math.sign(this.speed)) this.speed = 0;
    // steering (bicycle model)
    const wheelbase = this.mesh.axle * 2;
    this.yaw += (this.speed / wheelbase) * Math.tan(this.steer) * dt;
    const f = this.forward;
    const dx = f.x * this.speed * dt, dz = f.z * this.speed * dt;
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x += dx; this.pos.z += dz;
    // collisions with world geometry
    const hitC = this._collides();
    if (hitC) {
      this.pos.x = ox; this.pos.z = oz;
      const impact = Math.abs(this.speed);
      if (impact > 4) {
        this.damage((impact - 4) * 18);
        bus.emit('sound', { type: 'crash', x: this.pos.x, y: this.pos.y, z: this.pos.z, strength: impact / 15 });
        if (this.driver === 'player') this.game.player.survival.damage(Math.max(0, impact - 9) * 4, { cause: 'crash' });
      }
      this.speed *= -0.2;
    }
    // run over characters
    if (Math.abs(this.speed) > 3) {
      for (const c of this._circles()) {
        for (const ch of this.game.characters.near(c.x, c.z, c.r + 0.4)) {
          if (ch === this.game.player.character && this.driver === 'player') continue;
          if (ch.isAI && ch.mountedOn === this) continue;
          ch.onHit({ zone: 'torso', base: Math.abs(this.speed) * 6, weapon: null, distance: 0, mul: 1, shooter: this.driver === 'player' ? this.game.player.character : null, dir: { x: f.x, y: 0, z: f.z }, cause: 'vehicle' });
          this.speed *= 0.7;
        }
      }
    }
    // fuel
    if (this.engineOn) {
      this.fuel -= (Math.abs(this.speed * dt) / 1000) * t.consumption * 10 + dt * 0.0006;
      if (this.fuel <= 0) { this.fuel = 0; this.engineOn = false; if (this.driver === 'player') bus.emit('notify', { text: 'Out of fuel', kind: 'warn' }); }
    }
    // suspension: sample four wheel contact heights
    const W = t.dims[0] / 2, A = this.mesh.axle;
    const r = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
    const gh = (lx, lz) => {
      const x = this.pos.x + r.x * lx + f.x * -lz, z = this.pos.z + r.z * lx + f.z * -lz;
      const deck = world.bridgeAt(x, z);
      const h = world.heightAt(x, z);
      return deck !== null && deck > h ? deck : h;
    };
    const fl = gh(-W, -A), fr = gh(W, -A), bl = gh(-W, A), br = gh(W, A);
    const target = (fl + fr + bl + br) / 4;
    const targetPitch = Math.atan2((fl + fr) / 2 - (bl + br) / 2, A * 2);
    const targetRoll = Math.atan2((fl + bl) / 2 - (fr + br) / 2, W * 2);
    // spring toward ground; allow brief airtime over crests
    this.vy -= 18 * dt;
    this.bodyY += this.vy * dt;
    if (this.bodyY <= target) { this.bodyY = target; this.vy = Math.max(0, this.vy) * 0.2; }
    if (this.bodyY - target > 3) this.bodyY = target + 3;
    this.pos.y = this.bodyY;
    this.pitch = damp(this.pitch, targetPitch, 10, dt);
    this.roll = damp(this.roll, targetRoll + this.steer * this.speed * 0.004, 8, dt);
    this.wheelSpin += (this.speed * dt) / this.mesh.wheelRadius;
    if (Math.hypot(this.pos.x - this._colPos.x, this.pos.z - this._colPos.z) > 0.25 || Math.abs(this.pos.y - this._colPos.y) > 0.3) this._placeColliders();
    this._sync();
  }

  _collides() {
    const H = this.t.dims[1];
    for (const c of this._circles()) {
      const hit = this.game.physics.overlapsCylinder(c.x, this.pos.y + 0.55, c.z, c.r * 0.9, H - 0.5, `veh:${this.id}`);
      if (hit && hit.tag !== 'bush' && hit.tag !== 'character') return hit;
    }
    return null;
  }

  _sync() {
    const m = this.mesh;
    m.root.position.copy(this.pos);
    m.root.rotation.set(0, 0, 0);
    m.root.rotateY(this.yaw);
    m.root.rotateX(this.pitch);
    m.root.rotateZ(this.roll);
    m.wheels.forEach((w, i) => {
      w.rotation.set(this.wheelSpin, i < 2 ? this.steer : 0, 0, 'YXZ');
    });
    this.game.interactables.move(this.interact, this.pos.x, this.pos.y + 1.0, this.pos.z);
    const f = this.forward;
    const L = this.t.dims[2];
    this.game.interactables.move(this.trunk, this.pos.x - f.x * (L / 2 + 0.3), this.pos.y + 1.0, this.pos.z - f.z * (L / 2 + 0.3));
    // lamps (the light itself comes from the shared headlight pair in VehicleSystem)
    const on = this.lightsOn && !this.destroyed;
    const lp = m.lamps;
    lp.headMat.emissiveIntensity = on ? (this.highBeam ? 6 : 4) : 0;
    lp.tailMat.emissiveIntensity = on ? (this.braking ? 5 : 1.6) : this.braking && this.engineOn ? 4 : 0;
    for (const g of lp.glow) { g.visible = on; g.scale.setScalar(this.highBeam ? 1.25 : 0.9); }
    const inside = this.sys.current === this;
    for (const b of lp.beams) { b.visible = on && !inside; b.scale.set(1, 1, this.highBeam ? 1.5 : 1); b.rotation.x = this.highBeam ? -0.02 : -0.07; }
  }

  seatPosition(out = new THREE.Vector3()) {
    const f = this.forward;
    const r = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
    const L = this.t.dims[2];
    const fwdOff = this.t.style === 'truck' ? -L * 0.33 : this.t.style === 'van' ? -L * 0.28 : -L * 0.05;
    return out.set(this.pos.x + f.x * fwdOff - r.x * 0.4, this.pos.y + (this.t.style === 'truck' ? 2.1 : 1.55), this.pos.z + f.z * fwdOff - r.z * 0.4);
  }

  dispose() {
    this.game.renderer.scene.remove(this.mesh.root);
    for (const c of this.colliders) this.game.physics.remove(c);
    this.game.interactables.remove(this.interact);
    this.game.interactables.remove(this.trunk);
  }

  serialize() {
    return { id: this.id, type: this.type, x: this.pos.x, y: this.pos.y, z: this.pos.z, rot: this.yaw, fuel: this.fuel, health: this.health, needs: this.needs };
  }
}

export class VehicleSystem {
  constructor(game) {
    this.game = game;
    this.vehicles = new Map();
    this.current = null;
    this.camYaw = 0;
    this.camPitch = 0;
    // two real headlights, shared: they follow whichever lit vehicle matters most (the one you
    // drive, else the nearest lit one), so a dozen parked cars cost no extra lights
    this.heads = [0, 1].map(() => {
      const l = new THREE.SpotLight(0xfff0d8, 0, 70, 0.42, 0.55, 1.35);
      game.renderer.scene.add(l, l.target);
      return l;
    });
  }

  /** Off → low beam → high beam → off. */
  cycleLights(v) {
    if (!v.lightsOn) { v.lightsOn = true; v.highBeam = false; }
    else if (!v.highBeam) v.highBeam = true;
    else { v.lightsOn = false; v.highBeam = false; }
    bus.emit('sound', { type: 'click', ui: true });
  }

  _updateHeadlights() {
    const cam = this.game.renderer.camera.position;
    let best = this.current?.lightsOn && !this.current.destroyed ? this.current : null;
    if (!best) {
      let bd = 160;
      for (const v of this.vehicles.values()) {
        if (!v.lightsOn || v.destroyed) continue;
        const d = Math.hypot(v.pos.x - cam.x, v.pos.z - cam.z);
        if (d < bd) { bd = d; best = v; }
      }
    }
    const _p = new THREE.Vector3();
    this.heads.forEach((l, i) => {
      if (!best) { l.intensity = 0; return; }
      const lamp = best.mesh.lamps.head[i];
      lamp.getWorldPosition(_p);
      const f = best.forward;
      const hi = best.highBeam;
      l.intensity = hi ? 110 : 45;
      l.distance = hi ? 140 : 75;
      l.angle = hi ? 0.36 : 0.5;
      l.penumbra = hi ? 0.45 : 0.6;
      l.position.copy(_p);
      const reach = hi ? 60 : 22;
      const side = (i === 0 ? -1 : 1) * 0.04;
      l.target.position.set(_p.x + (f.x - f.z * side) * reach, _p.y - (hi ? 0.6 : 2.2), _p.z + (f.z + f.x * side) * reach);
      l.target.updateMatrixWorld();
    });
  }

  spawnDefaults() {
    for (const s of vehicleData.spawns) {
      if (this.vehicles.has(s.id)) continue;
      this.add({ id: s.id, type: s.type, x: s.pos[0], z: s.pos[1], rot: s.rot, fuel: s.fuel, needs: s.needs });
    }
  }

  add(rec) {
    const v = new Vehicle(this, rec);
    this.vehicles.set(v.id, v);
    return v;
  }

  remove(v) {
    v.dispose();
    this.vehicles.delete(v.id);
  }

  clear() {
    if (this.current) this.current = null;
    for (const v of this.vehicles.values()) v.dispose();
    this.vehicles.clear();
  }

  enter(v) {
    if (v.destroyed) return { ok: false, msg: 'This vehicle is wrecked' };
    if (v.driver) return { ok: false, msg: 'Occupied' };
    v.driver = 'player';
    this.current = v;
    this.camYaw = 0;
    this.camPitch = -0.05;
    const why = v.canStart();
    if (!why) { v.engineOn = true; bus.emit('sound', { type: 'engineStart', x: v.pos.x, y: v.pos.y, z: v.pos.z }); }
    else bus.emit('notify', { text: `Engine won't start: ${why}`, kind: 'warn' });
    bus.emit('vehicle:entered', v);
    return { ok: true };
  }

  exit(player, force = false) {
    const v = this.current;
    if (!v) return false;
    if (!force && Math.abs(v.speed) > 3) { bus.emit('notify', { text: 'Slow down before getting out', kind: 'info' }); return false; }
    const r = { x: Math.cos(v.yaw), z: -Math.sin(v.yaw) };
    const W = v.t.dims[0] / 2 + 0.9;
    const cands = [[-r.x * W, -r.z * W], [r.x * W, r.z * W], [-v.forward.x * (v.t.dims[2] / 2 + 1), -v.forward.z * (v.t.dims[2] / 2 + 1)]];
    let spot = null;
    for (const [ox, oz] of cands) {
      const x = v.pos.x + ox, z = v.pos.z + oz;
      const y = this.game.world.heightAt(x, z);
      if (!this.game.physics.overlapsCylinder(x, y + 0.3, z, 0.35, 1.5)) { spot = { x, y, z }; break; }
    }
    if (!spot) spot = { x: v.pos.x, y: v.pos.y + v.t.dims[1] + 0.2, z: v.pos.z };
    v.driver = null;
    v.engineOn = false;
    this.current = null;
    if (player) player.controller.teleport(spot.x, spot.y, spot.z, v.yaw);
    bus.emit('vehicle:exited', v);
    return true;
  }

  /** Install a part, refuel or repair from the player's inventory. */
  service(v, inv) {
    for (const part of [...v.needs]) {
      if (inv.remove(part, 1)) {
        v.needs = v.needs.filter((n) => n !== part);
        this.game.player.skills?.gain('vehicles', 2);
        return { ok: true, msg: `Installed ${ItemDB.get(part).name}` };
      }
    }
    if (v.fuel < v.t.fuelCap - 1 && inv.count('fuel_can') > 0) {
      inv.remove('fuel_can', 1);
      const left = inv.add({ id: 'fuel_can_empty', qty: 1 });
      if (left) this.game.dropItem({ id: 'fuel_can_empty', qty: 1 });
      v.fuel = Math.min(v.t.fuelCap, v.fuel + 20);
      return { ok: true, msg: `Refuelled: ${Math.round(v.fuel)} L` };
    }
    if (v.health < v.t.health && !v.destroyed && inv.count('tool_wrench') > 0 && inv.count('mech_parts') > 0) {
      inv.remove('mech_parts', 1);
      v.health = Math.min(v.t.health, v.health + v.t.health * 0.35);
      return { ok: true, msg: 'Repaired vehicle' };
    }
    if (v.needs.length) return { ok: false, msg: `Needs ${v.needs.map((n) => ItemDB.get(n).name).join(', ')}` };
    return { ok: false, msg: 'Nothing to service (fuel: jerrycan, repair: wrench + mechanical parts)' };
  }

  update(dt, input, mouse) {
    const p = this.game.player;
    for (const v of this.vehicles.values()) {
      if (v === this.current) {
        const controls = input.uiCapture ? {} : {
          throttle: (input.is('forward') ? 1 : 0) - (input.is('back') ? 1 : 0),
          steer: (input.is('left') ? 1 : 0) - (input.is('right') ? 1 : 0),
          brake: input.is('jump'),
        };
        if (!input.uiCapture && input.hit('vehLights')) this.cycleLights(v);
        v.update(dt, controls);
        // camera: driver's seat with free look
        if (mouse) {
          const s = this.game.settings.get('sensitivity') * 0.0022;
          this.camYaw = clamp(this.camYaw - mouse.dx * s, -2.2, 2.2);
          this.camPitch = clamp(this.camPitch - mouse.dy * s * (this.game.settings.get('invertY') ? -1 : 1), -1.0, 0.8);
        }
        const seat = v.seatPosition();
        const cam = this.game.renderer.camera;
        cam.position.copy(seat);
        const e = new THREE.Euler(this.camPitch + v.pitch * 0.8, v.yaw + this.camYaw, -v.roll * 0.6, 'YXZ');
        cam.quaternion.setFromEuler(e);
        p.controller.pos.set(v.pos.x, v.pos.y, v.pos.z);
        p.controller.yaw = v.yaw + this.camYaw;
      } else if (v.aiRoute) {
        this._aiDrive(v, dt);
      } else if (Math.abs(v.speed) > 0.05 || v.vy !== 0) {
        v.update(dt, {});
      }
    }
    this._updateHeadlights();
  }

  _aiDrive(v, dt) {
    const route = v.aiRoute;
    if (v.aiStopped || v.destroyed) { v.update(dt, { brake: true }); return; }
    const wp = route.points[route.idx];
    if (!wp) { v.aiStopped = true; v.onRouteEnd?.(); return; }
    const dx = wp.x - v.pos.x, dz = wp.z - v.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 8) { route.idx++; return; }
    const desired = Math.atan2(-dx, -dz);
    const diff = angleWrap(desired - v.yaw);
    const steer = clamp(diff * 2.2, -1, 1);
    const throttle = Math.abs(v.speed) < (route.speed || 11) * (1 - Math.min(0.6, Math.abs(diff))) ? 0.8 : 0;
    v.engineOn = true;
    v.lightsOn = (this.game.lighting?.nightFactor || 0) > 0.45; // convoys drive with lights at night
    v.update(dt, { throttle, steer });
  }

  serialize() {
    return [...this.vehicles.values()].filter((v) => !v.transient).map((v) => v.serialize());
  }

  deserialize(list) {
    this.clear();
    if (!Array.isArray(list)) return;
    for (const r of list) {
      if (!r || !VTYPES[r.type] || !Number.isFinite(r.x) || !Number.isFinite(r.z)) continue;
      this.add({ ...r, y: Number.isFinite(r.y) ? r.y : undefined });
    }
  }
}
