import * as THREE from 'three';
import { buildHelicopter } from './VehicleModels.js';
import { VTYPES } from './VehicleSystem.js';
import { settings } from '../core/SettingsManager.js';
import { bus } from '../core/EventBus.js';
import { RNG, hashString } from '../core/MathUtil.js';

// Helicopter events.
//  * Crash sites: once per in-game day there is a heliCrashChance roll; on a hit a wreck is
//    placed somewhere open and remote (not water, not a slope, away from locations, roads
//    and the player). It is a real place: the crushed fuselage tipped on its side, the tail
//    boom torn off and lying apart, bent blades and debris strewn along the impact line,
//    scorched ground, a smoke column and a fire glow at night, and three containers of
//    military cargo that include helicopter repair parts. Wrecks burn out after 3 days.
//  * Airfield helicopter: once per day an airfieldHeliChance roll; on a hit (and only if
//    none exists) a damaged, unflyable helicopter appears on the Kessler Airfield helipad.
//    It needs its missing parts installed (F, with a wrench) plus fuel before it flies.

export const HELI_PARTS = ['rotor_assembly', 'turbine_parts', 'avionics', 'fuel_system_kit', 'car_battery'];
const STRICT_EXTRA = ['mech_parts', 'electronics'];
const BUILD_RANGE = 1100;

export class Helicopters {
  constructor(game) {
    this.game = game;
    this.sites = []; // {id, x, z, yaw, day, built}
    this.lastDay = null;
    this.rng = new RNG((Math.random() * 1e9) | 0);
    this.t = 0;
    this.smokeT = 0;
  }

  get day() { return Math.floor(this.game.clock.gameMinutes / 1440); }

  update(dt) {
    const g = this.game;
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 2;
      const day = this.day;
      if (this.lastDay === null) this.lastDay = day;
      if (day > this.lastDay) {
        this.lastDay = day;
        if (this.rng.next() < settings.get('heliCrashChance')) this.spawnCrash();
        if (this.rng.next() < settings.get('airfieldHeliChance')) this.spawnAirfieldHeli();
      }
      // expire old wrecks; build / unbuild by distance
      const pp = g.player.controller.pos;
      for (const s of [...this.sites]) {
        if (day - s.day > 3) { this._unbuild(s); this.sites.splice(this.sites.indexOf(s), 1); continue; }
        const d = Math.hypot(s.x - pp.x, s.z - pp.z);
        if (d < BUILD_RANGE && !s.built) this._build(s);
        else if (d > BUILD_RANGE + 150 && s.built) this._unbuild(s);
        if (d < 160 && !s.found) { s.found = true; g.markers?.push?.({ x: s.x, z: s.z, label: 'Crash site' }); bus.emit('notify', { text: 'You found the helicopter crash site', kind: 'good', key: `crash${s.id}` }); }
      }
    }
    // smoke columns and the fire glow (cheap: a few particles per second per visible wreck)
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.25;
      for (const s of this.sites) {
        if (!s.built) continue;
        const age = this.day - s.day;
        const k = Math.max(0.25, 1 - age * 0.3);
        g.effects.emit(s.x + (Math.random() - 0.5) * 2, s.y + 1.5, s.z + (Math.random() - 0.5) * 2, { color: [0.12, 0.12, 0.12], count: 2, speed: 1.5, size: 2.4 * k, dir: { x: 0.2, y: 1, z: 0 }, spread: 0.3, life: 9, gravity: -0.9, grow: 1.6, alpha: 0.55 * k });
        if (age < 1) g.effects.fireEmbers?.(s.x + (Math.random() - 0.5) * 1.5, s.y + 0.8, s.z + (Math.random() - 0.5) * 1.5);
      }
    }
  }

  /** Pick a remote, flat, dry spot and register a crash site there. */
  spawnCrash(near = null) {
    const g = this.game, w = g.world;
    const pp = g.player.controller.pos;
    for (let k = 0; k < 80; k++) {
      const x = near ? near.x + (this.rng.next() - 0.5) * 300 : -5000 + this.rng.next() * 11000;
      const z = near ? near.z + (this.rng.next() - 0.5) * 300 : -5600 + this.rng.next() * 11200;
      if (w.waterAt(x, z) !== null || w.hasWaterIn(x - 25, z - 25, x + 25, z + 25)) continue;
      if (w.normalAt(x, z).y < 0.9) continue;
      if (w.nearestPOI(x, z).d < 220) continue;
      const r = w.roadQuery(x, z, 30);
      if (r && r.d < 30) continue;
      if (!near && Math.hypot(x - pp.x, z - pp.z) < 500) continue;
      const s = { id: `${Date.now().toString(36)}${k}`, x, z, y: w.heightAt(x, z), yaw: this.rng.next() * Math.PI * 2, day: this.day };
      this.sites.push(s);
      // with a field radio you hear the mayday and roughly where it came down
      if (g.player.equipment.inventory.count('field_radio') > 0) {
        const region = w.regionAt(x, z);
        bus.emit('notify', { text: `Field radio: mayday call — a helicopter went down near ${region?.name || 'the hills'}. Look for the smoke.`, kind: 'warn' });
        g.markers?.push?.({ x: Math.round(x / 200) * 200, z: Math.round(z / 200) * 200, label: 'Mayday (approx.)' });
      }
      bus.emit('heli:crash', { x, z });
      return s;
    }
    return null;
  }

  _build(s) {
    const g = this.game;
    const group = new THREE.Group();
    const t = VTYPES.heli;
    const m = buildHelicopter(t, g.materials, { wreck: true });
    m.paintMat.color.multiplyScalar(0.3);
    m.root.position.set(s.x, s.y + 0.4, s.z);
    m.root.rotation.set(0.12, s.yaw, 1.15, 'YXZ'); // on its side
    m.interior.visible = true;
    for (const w of m.windows) if (Math.random() < 0.7) w.holder.visible = false;
    group.add(m.root);
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    const mat = (n) => g.materials.get(n);
    // torn-off tail boom
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, 4.2, 10), m.paintMat);
    tail.position.set(s.x + fx * 9 + fz * 2, s.y + 0.3, s.z + fz * 9 - fx * 2);
    tail.rotation.set(Math.PI / 2, s.yaw + 0.6, 0.1, 'YXZ');
    group.add(tail);
    // bent blades and debris along the impact line
    const debrisGeo = new THREE.BoxGeometry(1, 1, 1);
    const R = new RNG(hashString(s.id));
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 2 + R.next() * 2), mat('metal_dark'));
      const a = s.yaw + (R.next() - 0.5) * 2.4, d = 5 + R.next() * 14;
      b.position.set(s.x + Math.sin(a) * d, s.y + 0.1, s.z + Math.cos(a) * d);
      b.rotation.set(R.next() * 0.4, R.next() * 6, R.next() * 0.4);
      group.add(b);
    }
    for (let i = 0; i < 14; i++) {
      const piece = new THREE.Mesh(debrisGeo, i % 3 ? m.paintMat : mat('metal_dark'));
      const d = -6 - R.next() * 30, side = (R.next() - 0.5) * 10;
      piece.position.set(s.x + fx * d + fz * side, s.y + 0.1, s.z + fz * d - fx * side);
      piece.scale.set(0.2 + R.next() * 0.8, 0.05 + R.next() * 0.25, 0.2 + R.next() * 1.0);
      piece.rotation.set(R.next(), R.next() * 6, R.next());
      group.add(piece);
    }
    // scorched ground and a gouge where it hit and slid
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(7, 20), new THREE.MeshStandardMaterial({ color: 0x14110e, roughness: 1, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.set(s.x, s.y + 0.05, s.z);
    group.add(scorch);
    const gouge = new THREE.Mesh(new THREE.PlaneGeometry(3, 26), new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    gouge.rotation.set(-Math.PI / 2, 0, -s.yaw);
    gouge.position.set(s.x - fx * 14, s.y + 0.06, s.z - fz * 14);
    group.add(gouge);
    g.renderer.scene.add(group);
    // terrain-following heights for the scattered parts
    group.traverse((o) => { if (o !== group && o.parent === group && o !== m.root && o !== scorch && o !== gouge) o.position.y = g.world.heightAt(o.position.x, o.position.z) + 0.1; });
    s.group = group;
    s.built = true;
    s.colliders = [g.physics.addBox(s.x - 2.2, s.y, s.z - 2.2, s.x + 2.2, s.y + 2.2, s.z + 2.2, { material: 'metal', owner: `heli:${s.id}`, tag: 'wreck' })];
    // fire glow during the first day
    s.light = { x: s.x, y: s.y + 1.5, z: s.z, color: 0xff7a30, intensity: 8, range: 18, flicker: true, active: () => this.day - s.day < 1 };
    g.lights?.add(s.light);
    // cargo: three containers with military kit and helicopter parts
    const spots = [[3, 2.5, "Pilot's Locker", 'heli_crash'], [-3.5, 4, 'Cargo Crate', 'heli_crash'], [1, -7, 'Cargo Crate', 'heli_cargo']];
    s.inter = spots.map(([lx, lz, name, profile], i) => {
      const x = s.x + lx * Math.cos(s.yaw) + lz * fx, z = s.z - lx * Math.sin(s.yaw) + lz * fz, y = g.world.heightAt(x, z);
      const box = new THREE.Mesh(new THREE.BoxGeometry(1, 0.7, 0.7), mat('olive'));
      box.position.set(x, y + 0.35, z);
      box.rotation.y = s.yaw + i;
      group.add(box);
      s.colliders.push(g.physics.addBox(x - 0.55, y, z - 0.55, x + 0.55, y + 0.7, z + 0.55, { material: 'metal', owner: `heli:${s.id}` }));
      return g.interactables.add({ id: `heli:${s.id}:c${i}`, kind: 'container', x, y: y + 0.6, z, radius: 1.4, label: `Search ${name}`, data: { containerId: `heli:${s.id}:c${i}`, profile, capacity: 10, name } });
    });
  }

  _unbuild(s) {
    const g = this.game;
    if (!s.built) return;
    g.renderer.scene.remove(s.group);
    s.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const c of s.colliders || []) g.physics.remove(c);
    for (const i of s.inter || []) g.interactables.remove(i);
    if (s.light) g.lights?.remove?.(s.light);
    s.built = false;
  }

  /** A damaged helicopter on the airfield pad: needs parts, repair and fuel before it flies. */
  spawnAirfieldHeli(force = false) {
    const g = this.game;
    for (const v of g.vehicles.vehicles.values()) if (v.t.flying && !v.destroyed) return null;
    const a = g.world.poiById.get('airfield');
    if (!a) return null;
    const x = a.x + 150, z = a.z - 50;
    const needs = [...HELI_PARTS, ...(settings.get('heliRepair') === 'strict' ? STRICT_EXTRA : [])];
    const v = g.vehicles.add({ id: 'veh_airfield_heli', type: 'heli', x, z, rot: Math.PI / 2, fuel: 0, health: VTYPES.heli.health * 0.4, needs });
    if (g.player.equipment.inventory.count('field_radio') > 0 || force) bus.emit('notify', { text: 'Field radio: ground crew at Kessler Airfield abandoned a damaged helicopter on the pad.', kind: 'info' });
    bus.emit('heli:airfield', { id: v.id });
    return v;
  }

  serialize() {
    return { lastDay: this.lastDay, sites: this.sites.map((s) => ({ id: s.id, x: s.x, z: s.z, y: s.y, yaw: s.yaw, day: s.day, found: !!s.found })) };
  }

  deserialize(o) {
    for (const s of this.sites) this._unbuild(s);
    this.sites = [];
    this.lastDay = Number.isFinite(o?.lastDay) ? o.lastDay : null;
    for (const s of o?.sites || []) if (Number.isFinite(s.x) && Number.isFinite(s.z)) this.sites.push({ ...s, built: false });
  }
}
