import * as THREE from 'three';
import vehicleData from '../data/vehicles.json';
import { buildVehicle, buildHelicopter, raycastParts, crackTextures } from './VehicleModels.js';
import { settings } from '../core/SettingsManager.js';
import { Inventory } from '../items/Inventory.js';
import { ItemDB } from '../items/ItemDatabase.js';
import { bus } from '../core/EventBus.js';
import { clamp, damp, angleWrap } from '../core/MathUtil.js';

// Drivable vehicles: kinematic bicycle model with terrain-following suspension,
// collision against world colliders, fuel, damage, missing parts, storage, headlights,
// persistence and an AI driver used by convoys.

export const VTYPES = Object.fromEntries(vehicleData.types.map((t) => [t.id, t]));

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

const _m4 = new THREE.Matrix4();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();

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
    this.occupants = new Map(); // seat index -> 'player' | agent
    this.pitch = 0;
    this.roll = 0;
    this.bodyY = this.pos.y;
    this.vy = 0;
    this.transient = !!rec.transient;
    this.known = !!rec.known;
    this.destroyed = this.health <= 0;
    const m = this.t.flying ? buildHelicopter(this.t, this.game.materials, { wreck: !!rec.wreck }) : buildVehicle(this.t, this.game.materials);
    this.rpm = 0;
    this.vel = new THREE.Vector3();
    this.airborne = false;
    this.mesh = m;
    this.seats = m.seats;
    this.doors = m.doors;
    this.windows = m.windows;
    // restore broken glass / missing doors from a save
    if (Array.isArray(rec.glass)) rec.glass.forEach((g, i) => { const w = this.windows[i]; if (!w || !g) return; w.hp = Math.min(w.maxHp, g.hp ?? w.maxHp); if (g.broken) this._shatter(w, true); else this._crackStage(w); });
    if (Array.isArray(rec.flats)) rec.flats.forEach((f, i) => { if (f && m.wheels[i]) this.damageWheel(m.wheels[i], 1e6, true); });
    if (Array.isArray(rec.doorsGone)) for (const i of rec.doorsGone) if (this.doors[i]) this._loseDoor(this.doors[i], true);
    for (const l of m.wheels) void l;
    this._buildLamps();
    this.game.renderer.scene.add(m.root);
    this.colliders = [];
    this._placeColliders();
    // bullets and sight use the oriented panels (doors, glass, armour) instead of the cylinders
    this.inv = new THREE.Matrix4();
    this.shape = { x: 0, y: 0, z: 0, r: Math.hypot(this.t.dims[0], this.t.dims[1], this.t.dims[2]) * 0.55, raycast: (ox, oy, oz, dx, dy, dz, maxDist) => this._raycast(ox, oy, oz, dx, dy, dz, maxDist) };
    this.game.physics.dynamic.add(this.shape);
    const sid = `veh:${this.id}`;
    this.storage = this.game.loot.get(sid) || this.game.loot.register(sid, new Inventory(this.t.storage, `${this.t.name} storage`), { meta: { vehicle: true }, transient: this.transient });
    this.interact = this.game.interactables.add({ id: `vehi:${this.id}`, kind: 'vehicle', x: this.pos.x, y: this.pos.y + 1, z: this.pos.z, radius: Math.max(this.t.dims[2] * 0.5, 2.2), label: () => this.label(), data: { vehicle: this } });
    this.trunk = this.game.interactables.add({ id: `veht:${this.id}`, kind: 'container', x: this.pos.x, y: this.pos.y + 1, z: this.pos.z, radius: 1.4, label: 'Open storage', priority: 1, data: { containerId: sid, name: `${this.t.name} storage`, custom: true } });
    this.braking = false;
    this.wheelSpin = 0;
    this.aiRoute = null;
    this.domeT = 0;
    if (this.destroyed) this._burnt();
    this._sync();
  }

  _buildLamps() {
    const lp = this.mesh.lamps;
    const W = lp.W;
    for (const sx of [-1, 1]) {
      const hl = new THREE.Mesh(lp.lensGeo, lp.headMat);
      hl.position.set(sx * W * 0.36, lp.headY, lp.front);
      const tl = new THREE.Mesh(lp.tailGeo, lp.tailMat);
      tl.position.set(sx * W * 0.4, lp.tailY, lp.back);
      const glow = new THREE.Sprite(glowMaterial());
      glow.position.set(sx * W * 0.36, lp.headY, lp.front - 0.1);
      glow.scale.set(0.9, 0.9, 1);
      glow.visible = false;
      const beam = new THREE.Mesh(beamGeometry(), beamMaterial());
      beam.position.set(sx * W * 0.36, lp.headY, lp.front - 0.04);
      beam.rotation.x = -0.06;
      beam.visible = false;
      beam.renderOrder = 6;
      this.mesh.root.add(hl, tl, glow, beam);
      lp.head.push(hl); lp.tail.push(tl); lp.glow.push(glow); lp.beams.push(beam);
    }
  }

  label() {
    if (this.destroyed) return `${this.t.name} (wrecked)`;
    const parts = this.needs.length ? ` — needs ${this.needs.map((n) => ItemDB.get(n).name).join(', ')}` : '';
    return `${this.t.flying ? 'Board' : 'Enter'} ${this.t.name} (fuel ${Math.round(this.fuel)} L, ${Math.round((this.health / this.t.health) * 100)}%)${parts}`;
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
      // movement only: bullets and sight are tested against the panels (see _raycast)
      const col = this.game.physics.addCylinder(c.x, c.z, c.r * 0.95, this.pos.y + 0.3, this.pos.y + H, { material: 'metal', owner: `veh:${this.id}`, tag: 'vehicle', blocksShots: false, blocksSight: false });
      col.vehicle = this;
      this.colliders.push(col);
    }
    this._colPos = this.pos.clone();
  }

  /** Ray vs the vehicle's panels; pseudo colliders carry material, glass and damage hooks. */
  _raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    const hits = raycastParts(this.mesh.hitParts, this.inv, ox, oy, oz, dx, dy, dz, maxDist, (p) => {
      if (p.kind === 'glass') return p.win.broken || (p.door !== null && p.door !== undefined && (this.doors[p.door].open > 0.15 || this.doors[p.door].missing));
      if (p.kind === 'door') return this.doors[p.door].open > 0.15 || this.doors[p.door].missing;
      return false;
    });
    const out = [];
    for (const h of hits) {
      const p = h.part;
      if (!p.col) {
        const mat = p.kind === 'wheel' ? 'fabric' : p.kind === 'glass' ? (p.win.armored ? 'armorglass' : 'glass') : p.kind === 'engine' ? 'engine' : p.kind === 'canvas' ? 'fabric' : p.mat === 'armor' ? 'armor' : 'carbody';
        p.col = {
          type: 'obb', material: mat, owner: `veh:${this.id}`, tag: 'vehicle', vehicle: this, blocksShots: true, blocksMove: false,
          blocksSight: p.kind === 'wheel' ? false : p.kind !== 'glass' && p.kind !== 'canvas' ? true : p.kind === 'canvas', enabled: true,
          onBulletHit: (dmg, shot) => this._partHit(p, dmg, shot),
        };
      }
      // world-space normal for impact effects
      _v3.set(h.nLocal[0], h.nLocal[1], h.nLocal[2]).applyQuaternion(this.mesh.root.quaternion);
      p.col.normal = { x: _v3.x, y: _v3.y, z: _v3.z };
      out.push({ t: h.t, tExit: h.tExit, collider: p.col, material: p.col.material });
    }
    return out;
  }

  _partHit(p, dmg, shot) {
    const mul = settings.get('vehicleDamage') ?? 1;
    if (p.kind === 'glass') { this.damageGlass(p.win, dmg, shot); return; }
    if (p.kind === 'wheel') { this.damageWheel(p.wheel, dmg); return; }
    if (p.kind === 'engine') this.damage(dmg * 0.6 * mul);
    else this.damage(dmg * (this.t.armored ? 0.05 : 0.3) * mul);
    if (p.kind === 'door') { const d = this.doors[p.door]; d.hp -= dmg; if (d.hp <= 0 && !this.t.armored) this._loseDoor(d); }
  }

  /** Tyres can be shot out: a flat sits on its rim, slows the vehicle and drags it to that side. */
  damageWheel(w, dmg, silent = false) {
    if (w.flat) return;
    w.hp -= dmg;
    if (w.hp > 0) return;
    w.flat = true;
    w.spin.scale.set(1, 0.8, 0.8);
    w.steer.position.y = w.y * 0.92;
    if (!silent) {
      w.steer.getWorldPosition(_v3);
      bus.emit('sound', { type: 'tyrePop', x: _v3.x, y: _v3.y, z: _v3.z });
      this.game.effects.emit(_v3.x, _v3.y, _v3.z, { color: [0.5, 0.5, 0.5], count: 8, speed: 2, size: 0.25, life: 0.8, gravity: -0.5, grow: 1.5, alpha: 0.5 });
      if (this.driver === 'player') bus.emit('notify', { text: 'Tyre shot out', kind: 'warn', key: 'tyre' });
    }
  }

  get flats() { let n = 0, pull = 0; for (const w of this.mesh.wheels) if (w.flat) { n++; pull += w.side * (w.front ? 1 : 0.4); } return { n, pull }; }

  /** Damage one window: cracks in three stages, then shatters (sound, shards, opening). */
  damageGlass(w, dmg) {
    if (w.broken) return;
    const dur = Math.max(0.1, settings.get('glassDurability') ?? 1);
    w.hp -= dmg / dur;
    if (w.hp <= 0) { this._shatter(w); return; }
    this._crackStage(w);
    bus.emit('sound', { type: 'glassCrack', x: this.pos.x, y: this.pos.y + 1.4, z: this.pos.z });
  }

  _crackStage(w) {
    const f = 1 - w.hp / w.maxHp;
    const stage = f > 0.66 ? 3 : f > 0.33 ? 2 : f > 0.02 ? 1 : 0;
    if (stage === w.stage) return;
    w.stage = stage;
    w.crack.visible = stage > 0;
    if (stage > 0) { w.crackMat.map = crackTextures()[stage - 1]; w.crackMat.opacity = 0.55 + stage * 0.12; w.crackMat.needsUpdate = true; }
    w.pane.material.opacity = (w.armored ? 0.42 : 0.32) + stage * 0.08;
  }

  _shatter(w, silent = false) {
    w.broken = true;
    w.hp = 0;
    w.holder.visible = false;
    if (silent) return;
    w.holder.getWorldPosition(_v3);
    bus.emit('sound', { type: 'glass', x: _v3.x, y: _v3.y, z: _v3.z });
    this.game.effects.emit(_v3.x, _v3.y, _v3.z, { color: [0.75, 0.85, 0.85], count: 26, speed: 2.6, size: 0.05, life: 1.4, gravity: 9, alpha: 0.9 });
  }

  _loseDoor(d, silent = false) {
    if (d.missing) return;
    d.missing = true;
    d.pivot.visible = false;
    for (const w of this.windows) if (w.door === d.idx) w.broken = true;
    if (!silent) {
      d.pivot.getWorldPosition(_v3);
      bus.emit('sound', { type: 'crash', x: _v3.x, y: _v3.y, z: _v3.z, strength: 0.4 });
      this.game.effects.emit(_v3.x, _v3.y + 0.8, _v3.z, { color: [0.3, 0.3, 0.3], count: 10, speed: 2, size: 0.08, life: 1.2, gravity: 9, alpha: 0.9 });
    }
  }

  damage(d) {
    if (this.destroyed) return;
    this.health -= d;
    // heavy damage knocks doors off and blows out glass
    if (this.health < this.t.health * 0.25 && d > 30) {
      for (const w of this.windows) if (!w.broken && Math.random() < 0.3) this._shatter(w);
      if (!this.t.armored) for (const dr of this.doors) if (!dr.missing && Math.random() < 0.12) this._loseDoor(dr);
    }
    if (this.health <= 0) {
      this.health = 0;
      this.destroyed = true;
      this.engineOn = false;
      bus.emit('sound', { type: 'explosion', x: this.pos.x, y: this.pos.y, z: this.pos.z });
      bus.emit('noise', { x: this.pos.x, y: this.pos.y, z: this.pos.z, radius: 400, source: null, type: 'gunshot' });
      this.game.effects.emit(this.pos.x, this.pos.y + 1, this.pos.z, { color: [0.2, 0.2, 0.2], count: 40, speed: 2, size: 0.6, life: 3, gravity: -1, grow: 1, alpha: 0.6 });
      this._burnt();
      for (const w of this.windows) if (!w.broken) this._shatter(w);
      if (this.sys.current === this) this.sys.exit(this.game.player, true);
      this.onDestroyed?.();
    }
  }

  _burnt() {
    // burnt look: darken the paint (per-vehicle material) and the interior
    this.mesh.paintMat.color.multiplyScalar(0.22);
    this.mesh.root.traverse((o) => { if (o.isMesh && o.material && !Array.isArray(o.material) && o.material.map && o.material.roughness > 0.9) o.material = o.material.clone(), o.material.color.multiplyScalar(0.4); });
    for (const w of this.mesh.wheels) w.spin.visible = false; // tyres burnt away
    for (const w of this.windows) { w.broken = true; w.holder.visible = false; }
  }

  canStart() {
    if (this.destroyed) return 'Wrecked';
    if (this.needs.length) return `Missing ${this.needs.map((n) => ItemDB.get(n).name).join(', ')}`;
    if (this.fuel <= 0.05) return 'Out of fuel';
    return null;
  }

  /**
   * Helicopter flight. controls: throttle (W/S: nose down / up → forward / back), steer (A/D:
   * yaw), up (Space: collective up), down (Shift: collective down). The rotor spools up over
   * ~8 s once the engine runs; below ~85% rotor speed there is not enough lift to climb.
   * Hard landings, hitting things and running dry (autorotation) all cause damage.
   */
  _fly(dt, controls = {}) {
    const t = this.t, g = this.game, world = g.world;
    const S = this.mesh.spec;
    const fuelMul = settings.get('heliFuelUse') ?? 1;
    if (this.engineOn && !this.destroyed) this.rpm = Math.min(1, this.rpm + dt / 8);
    else this.rpm = Math.max(0, this.rpm - dt / 12);
    if (this.engineOn) {
      this.fuel -= dt * 0.035 * fuelMul * (0.4 + 0.6 * this.rpm);
      if (this.fuel <= 0) { this.fuel = 0; this.engineOn = false; if (this.sys.current === this) bus.emit('notify', { text: 'Out of fuel — autorotate down (hold Space just before touchdown)', kind: 'warn' }); }
    }
    const lift = this.rpm >= 0.85 ? 1 : this.rpm / 0.85;
    const up = (controls.up ? 1 : 0) - (controls.down ? 1 : 0);
    const damaged = this.health < t.health * 0.3;
    // vertical: hover assist when the rotor is at speed, sink otherwise
    const vyT = lift >= 1 && !this.destroyed ? up * (up > 0 ? 7 : 5) + (damaged ? Math.sin(this.wobT = (this.wobT || 0) + dt * 2) * 0.8 : 0) : -9.8 * (1 - lift) * 2;
    this.vy += (vyT - this.vy) * Math.min(1, dt * (lift >= 1 ? 1.6 : 0.6));
    if (this.destroyed) this.vy -= 9.8 * dt;
    // horizontal: forward/back speed along the heading, yaw from the pedals
    const fwdIn = lift >= 1 && this.airborne && !this.destroyed ? controls.throttle || 0 : 0;
    const fT = fwdIn > 0 ? fwdIn * t.maxSpeed : fwdIn * 10;
    this.speed += Math.max(-6 * dt, Math.min(6 * dt, fT - this.speed)) * (fwdIn ? 1 : 0.35);
    if (this.rpm > 0.5 && !this.destroyed) this.yaw += (controls.steer || 0) * 1.1 * dt * Math.min(1, this.rpm);
    this.steer = damp(this.steer, controls.steer || 0, 6, dt);
    this.pitchIn = damp(this.pitchIn || 0, fwdIn, 3, dt);
    const f = this.forward;
    const ox = this.pos.x, oy = this.pos.y, oz = this.pos.z;
    this.pos.x += f.x * this.speed * dt;
    this.pos.z += f.z * this.speed * dt;
    this.pos.y += this.vy * dt;
    // ground: terrain, bridge decks, roofs and pads, water surface
    let ground = g.physics.groundHeight ? g.physics.groundHeight(this.pos.x, this.pos.z, 1.2, oy + 0.6) : world.heightAt(this.pos.x, this.pos.z);
    if (!Number.isFinite(ground)) ground = world.heightAt(this.pos.x, this.pos.z);
    const water = world.waterAt(this.pos.x, this.pos.z);
    if (water !== null && water > ground) ground = water;
    if (this.pos.y <= ground) {
      const impact = -this.vy;
      this.pos.y = ground;
      if (impact > 6) {
        this.damage((impact - 6) * 120 * (settings.get('vehicleDamage') ?? 1));
        bus.emit('sound', { type: 'crash', x: this.pos.x, y: this.pos.y, z: this.pos.z, strength: impact / 8 });
        if (this.sys.current === this) g.player.survival.damage(Math.max(0, impact - 9) * 8, { cause: 'crash' });
      }
      this.vy = Math.max(0, this.vy);
      this.speed *= Math.pow(0.05, dt); // skids drag on the ground
      if (water !== null && ground === water && this.engineOn) { this.engineOn = false; if (this.sys.current === this) bus.emit('notify', { text: 'Ditched in the water — engine flooded', kind: 'warn' }); }
      this.airborne = false;
    } else this.airborne = this.pos.y > ground + 0.15;
    if (this.pos.y > ground + 400) { this.pos.y = ground + 400; this.vy = Math.min(0, this.vy); }
    // obstacles: buildings, trees, towers
    const hitC = g.physics.overlapsCylinder(this.pos.x, this.pos.y + 0.9, this.pos.z, 1.6, 1.4, `veh:${this.id}`);
    if (hitC && hitC.tag !== 'bush' && hitC.tag !== 'character') {
      const impact = Math.hypot(this.speed, this.vy);
      this.pos.set(ox, Math.max(oy, this.pos.y), oz);
      if (impact > 4) { this.damage((impact - 4) * 60 * (settings.get('vehicleDamage') ?? 1)); bus.emit('sound', { type: 'crash', x: this.pos.x, y: this.pos.y, z: this.pos.z, strength: impact / 10 }); }
      this.speed *= -0.3;
    }
    // attitude: nose down when pushing forward, bank in turns
    this.pitch = damp(this.pitch, -this.pitchIn * 0.22 - this.speed / t.maxSpeed * 0.08, 3, dt);
    this.roll = damp(this.roll, this.airborne ? (controls.steer || 0) * 0.18 : 0, 3, dt);
    if (damaged && this.engineOn && Math.random() < dt * 10) g.effects.emit(this.pos.x, this.pos.y + 2.6, this.pos.z, { color: [0.15, 0.15, 0.15], count: 1, speed: 1, size: 0.8, life: 3, gravity: -1, grow: 1.5, alpha: 0.5 });
    if (Math.hypot(this.pos.x - this._colPos.x, this.pos.z - this._colPos.z) > 0.25 || Math.abs(this.pos.y - this._colPos.y) > 0.3) this._placeColliders();
    this.bodyY = this.pos.y;
    this._sync();
  }

  /** controls: {throttle -1..1, steer -1..1, brake bool} */
  update(dt, controls) {
    const t = this.t;
    if (t.flying) { this._fly(dt, controls); return; }
    const world = this.game.world;
    const water = world.waterAt(this.pos.x, this.pos.z);
    if (water !== null && world.bridgeAt(this.pos.x, this.pos.z) === null && water - world.heightAt(this.pos.x, this.pos.z) > 1.1 && this.engineOn) {
      this.engineOn = false;
      if (this.driver === 'player') bus.emit('notify', { text: 'Engine flooded', kind: 'warn' });
    }
    const flat = this.flats;
    let throttle = controls?.throttle || 0;
    this.braking = !!controls?.brake || (throttle < 0 && this.speed > 0.5);
    const steerIn = controls?.steer || 0;
    if (!this.engineOn) throttle = 0;
    const maxSteer = 0.6 * t.steer / 0.55 * (1 - Math.min(0.65, Math.abs(this.speed) / t.maxSpeed * 0.7));
    this.steer = damp(this.steer, steerIn * maxSteer - flat.pull * 0.05 * Math.min(1, Math.abs(this.speed) / 6), 6, dt);
    const mass = t.mass;
    let acc = 0;
    const vmax = t.maxSpeed * Math.max(0.2, 1 - flat.n * 0.22);
    if (throttle > 0) acc += (t.engine / mass) * throttle * (1 - Math.max(0, this.speed) / vmax);
    acc -= Math.sign(this.speed) * flat.n * 0.9;
    if (throttle < 0) {
      if (this.speed > 0.5) acc -= 9 * -throttle;
      else acc += (t.engine / mass) * throttle * 0.6 * (1 - Math.max(0, -this.speed) / t.reverse);
    }
    if (controls?.brake) acc -= Math.sign(this.speed) * 10;
    acc -= this.speed * 0.08 + Math.sign(this.speed) * (0.4 + 0.0022 * this.speed * this.speed);
    acc -= 9.8 * Math.sin(this.pitch) * 0.9;
    const prev = this.speed;
    this.speed += acc * dt;
    if (!throttle && Math.abs(this.speed) < 0.15) this.speed = 0;
    if (controls?.brake && Math.sign(prev) !== Math.sign(this.speed)) this.speed = 0;
    const wheelbase = this.mesh.axle * 2;
    this.yaw += (this.speed / wheelbase) * Math.tan(this.steer) * dt;
    const f = this.forward;
    const dx = f.x * this.speed * dt, dz = f.z * this.speed * dt;
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x += dx; this.pos.z += dz;
    const hitC = this._collides();
    if (hitC) {
      this.pos.x = ox; this.pos.z = oz;
      const impact = Math.abs(this.speed);
      if (impact > 4) {
        this.damage((impact - 4) * 18 * (settings.get('vehicleDamage') ?? 1));
        bus.emit('sound', { type: 'crash', x: this.pos.x, y: this.pos.y, z: this.pos.z, strength: impact / 15 });
        if (this.sys.current === this) this.game.player.survival.damage(Math.max(0, impact - 9) * 4, { cause: 'crash' });
        if (impact > 12) { const w = this.windows.find((x) => x.key.startsWith('ws')); if (w) this.damageGlass(w, impact * 6); }
      }
      this.speed *= -0.2;
    }
    if (Math.abs(this.speed) > 3) {
      for (const c of this._circles()) {
        for (const ch of this.game.characters.near(c.x, c.z, c.r + 0.4)) {
          if (ch === this.game.player.character && this.sys.current === this) continue;
          if (ch.isAI && ch.mountedOn === this) continue;
          ch.onHit({ zone: 'torso', base: Math.abs(this.speed) * 6, weapon: null, distance: 0, mul: 1, shooter: this.driver === 'player' ? this.game.player.character : null, dir: { x: f.x, y: 0, z: f.z }, cause: 'vehicle' });
          this.speed *= 0.7;
        }
      }
    }
    if (this.engineOn) {
      this.fuel -= (Math.abs(this.speed * dt) / 1000) * t.consumption * 10 + dt * 0.0006;
      if (this.fuel <= 0) { this.fuel = 0; this.engineOn = false; if (this.driver === 'player') bus.emit('notify', { text: 'Out of fuel', kind: 'warn' }); }
    }
    // suspension: four contact points at the actual wheel positions
    const S = this.mesh.spec;
    const Wt = S.W / 2 - 0.15;
    const r = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
    const gh = (lx, lz) => {
      const x = this.pos.x + r.x * lx + f.x * -lz, z = this.pos.z + r.z * lx + f.z * -lz;
      // a wheel just past the deck edge still rides at deck height while the body is on the bridge
      const deck = world.bridgeAt(x, z) ?? world.bridgeAt(this.pos.x, this.pos.z);
      const h = world.heightAt(x, z);
      return deck !== null && deck > h - 0.5 ? deck : h;
    };
    const sag = (i) => (this.mesh.wheels[i]?.flat ? this.mesh.wheelRadius * 0.2 : 0);
    const fl = gh(-Wt, S.axleF) - sag(0), fr = gh(Wt, S.axleF) - sag(1), bl = gh(-Wt, S.axleR) - sag(2), br = gh(Wt, S.axleR) - sag(3);
    const target = (fl + fr + bl + br) / 4;
    const span = S.axleR - S.axleF;
    const targetPitch = Math.atan2((fl + fr) / 2 - (bl + br) / 2, span);
    const targetRoll = Math.atan2((fl + bl) / 2 - (fr + br) / 2, Wt * 2);
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

  /** Door animation, interior details and the dome light; runs every frame for nearby vehicles. */
  animate(dt, camDist) {
    const m = this.mesh;
    let moving = false;
    for (const d of this.doors) {
      if (d.missing) continue;
      const prev = d.open;
      d.open = damp(d.open, d.target, 7, dt);
      if (Math.abs(d.open - d.target) < 0.002) d.open = d.target;
      if (d.open !== prev) moving = true;
      d.pivot.rotation.y = d.side * d.open * 1.15; // swings outward about the front hinge
      if (prev < 0.05 && d.open >= 0.05 && d.target > 0) bus.emit('sound', { type: 'door', open: true, metal: true, x: this.pos.x, y: this.pos.y + 1, z: this.pos.z });
      if (prev > 0.05 && d.open <= 0.05 && d.target === 0) bus.emit('sound', { type: 'door', open: false, metal: true, x: this.pos.x, y: this.pos.y + 1, z: this.pos.z });
    }
    void moving;
    // interior detail only near the camera
    m.interior.visible = camDist < 60;
    if (this.t.flying && !m.interior.visible) { m.rotor.rotation.y += this.rpm * dt * 32; m.tailRotor.rotation.x += this.rpm * dt * 60; }
    if (!m.interior.visible) return;
    if (this.t.flying) {
      m.rotor.rotation.y += this.rpm * dt * 32;
      m.tailRotor.rotation.x += this.rpm * dt * 60;
      m.steeringSpin.rotation.set(-(this.pitchIn || 0) * 0.3, 0, this.steer * 0.25);
    } else m.steeringSpin.rotation.z = this.steer * 4.2;
    const kmh = Math.abs(this.speed) * 3.6;
    // dial angle a (canvas, clockwise from +x) -> needle rotation -a - pi/2
    m.needles.speed.rotation.z = -(Math.PI * 0.75 + Math.min(120, kmh) / 120 * Math.PI * 1.5) - Math.PI / 2;
    m.needles.fuel.rotation.z = -(Math.PI * 0.75 + (this.fuel / this.t.fuelCap) * Math.PI * 1.5) - Math.PI / 2;
    m.clusterMat.emissiveIntensity = this.engineOn && this.lightsOn ? 0.55 : this.engineOn ? 0.18 : 0;
    m.clusterMat.emissiveMap = m.clusterMat.map;
    // dome light: on while a door is open or briefly after getting in or out in the dark
    const anyOpen = this.doors.some((d) => d.open > 0.1 && !d.missing);
    this.domeT = Math.max(0, this.domeT - dt);
    const dark = (this.game.lighting?.nightFactor || 0) > 0.3 || this.game.lighting?.underground;
    this.domeOn = !this.destroyed && dark && (anyOpen || this.domeT > 0);
    m.domeMat.emissiveIntensity = this.domeOn ? 2.2 : 0;
  }

  _sync() {
    const m = this.mesh;
    m.root.position.copy(this.pos);
    m.root.rotation.set(0, 0, 0);
    m.root.rotateY(this.yaw);
    m.root.rotateX(this.pitch);
    m.root.rotateZ(this.roll);
    m.root.updateMatrixWorld(true);
    this.inv.copy(m.root.matrixWorld).invert();
    this.shape.x = this.pos.x; this.shape.y = this.pos.y + this.t.dims[1] / 2; this.shape.z = this.pos.z;
    for (const w of m.wheels) {
      w.steer.rotation.y = w.front ? this.steer : 0;
      w.spin.rotation.x = -this.wheelSpin;
    }
    this.game.interactables.move(this.interact, this.pos.x, this.pos.y + 1.0, this.pos.z);
    const f = this.forward;
    const L = this.t.dims[2];
    this.game.interactables.move(this.trunk, this.pos.x - f.x * (L / 2 + 0.3), this.pos.y + 1.0, this.pos.z - f.z * (L / 2 + 0.3));
    const on = this.lightsOn && !this.destroyed;
    const lp = m.lamps;
    lp.headMat.emissiveIntensity = on ? (this.highBeam ? 6 : 4) : 0;
    lp.tailMat.emissiveIntensity = on ? (this.braking ? 5 : 1.6) : this.braking && this.engineOn ? 4 : 0;
    for (const g of lp.glow) { g.visible = on; g.scale.setScalar(this.highBeam ? 1.25 : 0.9); }
    const inside = this.sys.current === this;
    for (const b of lp.beams) { b.visible = on && !inside; b.scale.set(1, 1, this.highBeam ? 1.5 : 1); b.rotation.x = this.highBeam ? -0.02 : -0.07; }
  }

  /** World position of a seat's hip (feet for hit boxes) or eye. */
  seatWorld(i, which = 'eye', out = new THREE.Vector3()) {
    const s = this.seats[i] || this.seats[0];
    return out.copy(s[which]).applyMatrix4(this.mesh.root.matrixWorld);
  }

  /** Back-compat: the driver's eye. */
  seatPosition(out = new THREE.Vector3()) { return this.seatWorld(0, 'eye', out); }

  /** Index of the door nearest a world point, and the seat it serves. */
  doorFor(x, z) {
    let best = null, bd = Infinity;
    for (const d of this.doors) {
      _v3.set(d.side * (this.mesh.spec.W / 2 + 0.4), 1, (d.z0 + d.z1) / 2).applyMatrix4(this.mesh.root.matrixWorld);
      const dd = Math.hypot(_v3.x - x, _v3.z - z);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }

  /** Seats a door serves (front doors: front row on that side; rear doors: rear row). */
  seatsForDoor(d) {
    const out = [];
    this.seats.forEach((s, i) => { if (s.row === 9) return; if ((d.rear ? s.row >= 1 : s.row === 0) && Math.sign(s.x || 0) === d.side) out.push(i); });
    if (!out.length) this.seats.forEach((s, i) => { if (s.row === (d.rear ? 1 : 0)) out.push(i); });
    return out;
  }

  dispose() {
    this.game.renderer.scene.remove(this.mesh.root);
    for (const c of this.colliders) this.game.physics.remove(c);
    this.game.physics.dynamic.delete(this.shape);
    this.game.interactables.remove(this.interact);
    this.game.interactables.remove(this.trunk);
  }

  serialize() {
    return {
      id: this.id, type: this.type, x: this.pos.x, y: this.pos.y, z: this.pos.z, rot: this.yaw, fuel: this.fuel, health: this.health, needs: this.needs,
      glass: this.windows.map((w) => ({ hp: Math.round(w.hp), broken: w.broken })), doorsGone: this.doors.filter((d) => d.missing).map((d) => d.idx), flats: this.mesh.wheels.map((w) => (w.flat ? 1 : 0)), known: !!this.known,
    };
  }
}

export class VehicleSystem {
  constructor(game) {
    this.game = game;
    this.vehicles = new Map();
    this.current = null;
    this.seatIndex = 0;
    this.camYaw = 0;
    this.camPitch = 0;
    // two real headlights, shared: they follow whichever lit vehicle matters most (the one you
    // drive, else the nearest lit one), so a dozen parked cars cost no extra lights
    this.heads = [0, 1].map(() => {
      const l = new THREE.SpotLight(0xfff0d8, 0, 70, 0.42, 0.55, 1.35);
      game.renderer.scene.add(l, l.target);
      return l;
    });
    // one shared cabin light (dome lamp of the nearest vehicle that has it on)
    this.domeLight = new THREE.PointLight(0xfff0d8, 0, 4.5, 1.6);
    game.renderer.scene.add(this.domeLight);
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
    if (settings.get('vehicleAvailability') === 'none') return;
    const fewer = settings.get('vehicleAvailability') === 'rare';
    for (const s of vehicleData.spawns) {
      if (this.vehicles.has(s.id)) continue;
      if (fewer && s.optional) continue;
      this.add({ id: s.id, type: s.type, x: s.pos[0], z: s.pos[1], rot: s.rot, fuel: s.fuel, needs: s.needs, health: s.health });
    }
  }

  add(rec) {
    const v = new Vehicle(this, rec);
    this.vehicles.set(v.id, v);
    return v;
  }

  remove(v) {
    if (this.current === v) this.current = null;
    v.dispose();
    this.vehicles.delete(v.id);
  }

  clear() {
    if (this.current) this.current = null;
    for (const v of this.vehicles.values()) v.dispose();
    this.vehicles.clear();
  }

  /**
   * Get in. The player uses the door nearest to them (driver's door → driver's seat); the
   * door swings open, the camera moves to that seat's eye point and the door shuts again.
   */
  enter(v, seatIdx = null) {
    if (v.destroyed) return { ok: false, msg: 'This vehicle is wrecked' };
    const pp = this.game.player.controller.pos;
    let door = v.doorFor(pp.x, pp.z);
    let idx = seatIdx;
    if (idx === null) {
      const cand = door ? v.seatsForDoor(door).filter((i) => !v.occupants.has(i)) : [];
      idx = cand.length ? cand[0] : [...v.seats.keys()].find((i) => !v.occupants.has(i));
      // the driver's seat is preferred when the driver's door is the nearest
      if (idx === undefined) return { ok: false, msg: 'No free seat' };
    }
    if (v.occupants.has(idx)) return { ok: false, msg: 'That seat is taken' };
    if (!door || !v.seatsForDoor(door).includes(idx)) door = v.doors.find((d) => v.seatsForDoor(d).includes(idx)) || door;
    v.occupants.set(idx, 'player');
    this.current = v;
    v.known = true; // shown on the map from now on
    this.seatIndex = idx;
    const seat = v.seats[idx];
    if (seat.driver) v.driver = 'player';
    this.camYaw = seat.faceYaw || 0;
    this.camPitch = -0.08;
    if (door && !door.missing) { door.target = 1; this._closeLater = { v, door, t: 0.9 }; }
    v.domeT = 6;
    v.mesh.driverRig.visible = !!seat.driver;
    v.mesh.driverRig.userData.hands.visible = !!seat.driver;
    if (seat.driver) this._startEngine(v);
    bus.emit('vehicle:entered', v);
    return { ok: true };
  }

  _startEngine(v) {
    const why = v.canStart();
    if (!why) { if (!v.engineOn) bus.emit('sound', { type: 'engineStart', x: v.pos.x, y: v.pos.y, z: v.pos.z }); v.engineOn = true; }
    else bus.emit('notify', { text: `Engine won't start: ${why}`, kind: 'warn' });
  }

  /** Move to the next free seat (C). Moving into the driver's seat starts the engine. */
  switchSeat() {
    const v = this.current;
    if (!v) return;
    if (Math.abs(v.speed) > 1.5 && v.seats[this.seatIndex].driver) { bus.emit('notify', { text: 'Stop before leaving the wheel', kind: 'info' }); return; }
    const n = v.seats.length;
    for (let k = 1; k < n; k++) {
      const i = (this.seatIndex + k) % n;
      if (v.occupants.has(i)) continue;
      const was = v.seats[this.seatIndex];
      v.occupants.delete(this.seatIndex);
      if (was.driver) { v.driver = null; v.engineOn = false; }
      v.occupants.set(i, 'player');
      this.seatIndex = i;
      const s = v.seats[i];
      this.camYaw = s.faceYaw || 0;
      v.mesh.driverRig.visible = !!s.driver;
      v.mesh.driverRig.userData.hands.visible = !!s.driver;
      if (s.driver) { v.driver = 'player'; this._startEngine(v); }
      bus.emit('notify', { text: s.driver ? "Driver's seat" : 'Passenger seat', kind: 'info', key: 'seat' });
      return;
    }
    bus.emit('notify', { text: 'No other free seat', kind: 'info' });
  }

  exit(player, force = false) {
    const v = this.current;
    if (!v) return false;
    if (!force && Math.abs(v.speed) > 3) { bus.emit('notify', { text: 'Slow down before getting out', kind: 'info' }); return false; }
    if (!force && v.t.flying && v.airborne) { bus.emit('notify', { text: 'Land before getting out', kind: 'info' }); return false; }
    const seat = v.seats[this.seatIndex];
    const door = v.doors.find((d) => !d.missing && v.seatsForDoor(d).includes(this.seatIndex)) || null;
    const r = { x: Math.cos(v.yaw), z: -Math.sin(v.yaw) };
    // step out beside the seat's own door first, then the other side, then behind
    const side = Math.sign(seat.x || -1) || -1;
    const hip = v.seatWorld(this.seatIndex, 'hip');
    const W = v.t.dims[0] / 2 + 0.75;
    const cands = [[r.x * side * W, r.z * side * W, hip], [-r.x * side * W, -r.z * side * W, hip], [-v.forward.x * (v.t.dims[2] / 2 + 1), -v.forward.z * (v.t.dims[2] / 2 + 1), v.pos]];
    let spot = null;
    for (const [ox, oz, base] of cands) {
      const x = base.x + ox, z = base.z + oz;
      const y = this.game.physics.groundHeight ? this.game.physics.groundHeight(x, z, 0.3, v.pos.y + 2) : this.game.world.heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      if (!this.game.physics.overlapsCylinder(x, y + 0.3, z, 0.35, 1.5)) { spot = { x, y, z }; break; }
    }
    if (!spot) spot = { x: v.pos.x, y: v.pos.y + v.t.dims[1] + 0.2, z: v.pos.z };
    v.occupants.delete(this.seatIndex);
    if (seat.driver) { v.driver = null; v.engineOn = false; v.speed = force ? v.speed : 0; }
    this.current = null;
    v.mesh.driverRig.visible = false;
    if (door) { door.target = 1; this._closeLater = { v, door, t: 1.1 }; }
    v.domeT = 6;
    if (player) player.controller.teleport(spot.x, spot.y, spot.z, v.yaw + this.camYaw);
    bus.emit('vehicle:exited', v);
    return true;
  }

  /** Install a part, refuel or repair from the player's inventory. */
  service(v, inv) {
    for (const part of [...v.needs]) {
      const tool = ItemDB.get(part)?.needsTool;
      if (inv.count(part) > 0 && tool && inv.count(tool) < 1) return { ok: false, msg: `Installing the ${ItemDB.get(part).name} needs a ${ItemDB.get(tool).name}` };
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
    const strict = settings.get('vehicleRepair') === 'strict';
    const kit = inv.count('repair_kit') > 0;
    if ((v.health < v.t.health || v.flats.n > 0) && !v.destroyed && (kit || (inv.count('tool_wrench') > 0 && inv.count('mech_parts') > 0))) {
      if (kit) inv.remove('repair_kit', 1); else inv.remove('mech_parts', strict ? 2 : 1);
      v.health = Math.min(v.t.health, v.health + v.t.health * (kit ? 0.6 : strict ? 0.25 : 0.35));
      for (const w of v.mesh.wheels) if (w.flat) { w.flat = false; w.hp = 90; w.spin.scale.set(1, 1, 1); w.steer.position.y = w.y; }
      return { ok: true, msg: kit ? 'Repaired vehicle with a repair kit' : 'Repaired vehicle' };
    }
    // replace broken glass with a glass pane + tools
    const broken = v.windows.filter((w) => w.broken && !(w.door !== null && v.doors[w.door].missing));
    if (broken.length && inv.count('glass_pane') > 0 && inv.count('tool_wrench') > 0) {
      inv.remove('glass_pane', 1);
      const w = broken[0];
      w.broken = false; w.hp = w.maxHp; w.stage = -1; w.holder.visible = true; v._crackStage(w);
      return { ok: true, msg: 'Fitted a new window' };
    }
    if (v.needs.length) return { ok: false, msg: `Needs ${v.needs.map((n) => ItemDB.get(n).name).join(', ')}` };
    return { ok: false, msg: 'Nothing to service (fuel: jerrycan, repair: wrench + mechanical parts or a repair kit, window: glass pane + wrench)' };
  }

  update(dt, input, mouse) {
    const p = this.game.player;
    const cam = this.game.renderer.camera;
    for (const v of this.vehicles.values()) {
      if (v === this.current) {
        const drive = v.seats[this.seatIndex]?.driver;
        const controls = input.uiCapture || !drive ? {} : {
          throttle: (input.is('forward') ? 1 : 0) - (input.is('back') ? 1 : 0),
          steer: (input.is('left') ? 1 : 0) - (input.is('right') ? 1 : 0),
          brake: input.is('jump'),
          up: input.is('jump'),
          down: input.is('sprint'),
        };
        if (!input.uiCapture && drive && input.hit('vehLights')) this.cycleLights(v);
        if (!input.uiCapture && input.hit('crouch')) this.switchSeat();
        v.update(dt, controls);
        if (mouse) {
          const s = this.game.settings.get('sensitivity') * 0.0022;
          const base = v.seats[this.seatIndex]?.faceYaw || 0;
          this.camYaw = clamp(this.camYaw - mouse.dx * s, base - 2.3, base + 2.3);
          this.camPitch = clamp(this.camPitch - mouse.dy * s * (this.game.settings.get('invertY') ? -1 : 1), -1.0, 0.75);
        }
        // camera at this seat's eye point, carried by the body's pitch and roll
        v.seatWorld(this.seatIndex, 'eye', cam.position);
        _q.setFromEuler(new THREE.Euler(this.camPitch, this.camYaw, 0, 'YXZ'));
        cam.quaternion.copy(v.mesh.root.quaternion).multiply(_q);
        // the player's body (hit box) sits on the seat
        const hip = v.seatWorld(this.seatIndex, 'hip');
        p.controller.pos.set(hip.x, hip.y, hip.z);
        p.controller.yaw = v.yaw + this.camYaw;
      } else if (v.aiRoute) {
        this._aiDrive(v, dt);
      } else if (Math.abs(v.speed) > 0.05 || v.vy !== 0 || (v.t.flying && (v.airborne || v.rpm > 0))) {
        v.update(dt, {});
      }
      // crew positions (AI seated in the cab)
      for (const [i, occ] of v.occupants) {
        if (occ === 'player') continue;
        const hip = v.seatWorld(i, 'hip');
        occ.pos.set(hip.x, hip.y, hip.z);
        occ.yaw = v.yaw + (v.seats[i].faceYaw || 0);
      }
      v.animate(dt, Math.hypot(v.pos.x - cam.position.x, v.pos.z - cam.position.z));
    }
    // close the door behind the player after getting in or out
    if (this._closeLater) {
      this._closeLater.t -= dt;
      if (this._closeLater.t <= 0) { this._closeLater.door.target = 0; this._closeLater = null; }
    }
    // shared cabin light
    let lit = this.current?.domeOn ? this.current : null;
    if (!lit) {
      let bd = 25;
      for (const v of this.vehicles.values()) {
        if (!v.domeOn) continue;
        const d = Math.hypot(v.pos.x - cam.position.x, v.pos.z - cam.position.z);
        if (d < bd) { bd = d; lit = v; }
      }
    }
    this.domeLight.intensity = lit ? 3.2 : 0;
    if (lit) lit.mesh.dome.getWorldPosition(this.domeLight.position).y -= 0.12;
    this._updateHeadlights();
  }

  /** Seat an AI crew member (visible, can be shot through the glass). */
  seatAgent(v, agent, idx) {
    if (v.occupants.has(idx) || !v.seats[idx]) return false;
    v.occupants.set(idx, agent);
    agent.vehicleSeat = idx;
    agent.stance = 'sit';
    agent.model.setSeated?.(true, !!v.seats[idx].driver);
    if (v.seats[idx].driver) v.driver = agent;
    return true;
  }

  unseatAgent(v, agent) {
    for (const [i, occ] of v.occupants) if (occ === agent) { v.occupants.delete(i); if (v.driver === agent) v.driver = null; }
    agent.vehicleSeat = undefined;
    agent.stance = 'stand';
    agent.model.setSeated?.(false);
  }

  _aiDrive(v, dt) {
    const route = v.aiRoute;
    const driver = v.driver && v.driver !== 'player' ? v.driver : null;
    if (v.aiStopped || v.destroyed || (driver && !driver.alive)) { v.update(dt, { brake: true }); return; }
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
    v.lightsOn = (this.game.lighting?.nightFactor || 0) > 0.45;
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
