// Ceiling-mounted defence turrets in the underground facility. They still run on old
// power: they track anyone they can see within range and fire bursts. Shoot them (or blow
// them up) to shut them down; destroyed turrets stay destroyed (saved with the game).
import * as THREE from 'three';
import { npcWeapon } from '../ai/CharacterModel.js';
import { ItemDB } from '../items/ItemDatabase.js';
import { effectiveWeapon, fireInterval } from '../weapons/WeaponData.js';
import { randomCone } from '../weapons/WeaponController.js';
import { bus } from '../core/EventBus.js';
import { angleWrap } from '../core/MathUtil.js';

const RANGE = 48;
const HEALTH = 260;

export class FacilityTurrets {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.destroyed = new Set();
    bus.on('poi:built', (rt) => (rt.turrets || []).forEach((d, i) => this._spawn(d, `${rt.poi.id}:t${i}`, rt.poi.id)));
    bus.on('poi:unloading', (rt) => { for (const t of [...this.list]) if (t.poiId === rt.poi.id) this._remove(t); });
  }

  _spawn(def, id, poiId) {
    if (this.game.headless) return;
    const g = this.game;
    const root = new THREE.Group();
    root.position.set(def.x, def.y, def.z);
    const mat = g.materials.get('metal_dark');
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.5), mat);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.02), g.materials.get('emissive_lamp'));
    eye.position.set(0, 0.06, -0.26);
    const head = new THREE.Group();
    head.add(body, eye);
    const gun = npcWeapon(def.weapon, {}, g.materials);
    gun.mesh.position.set(0.0, -0.12, -0.05);
    head.add(gun.mesh);
    root.add(head);
    g.renderer.scene.add(root);
    const w = effectiveWeapon(ItemDB.create(def.weapon, 1));
    const dead = this.destroyed.has(id);
    const t = { id, poiId, def, root, head, gun, eye, w, health: dead ? 0 : HEALTH, alive: !dead, yaw: 0, pitch: 0, nextShot: 0, burst: 0, seenT: 0, time: Math.random() * 3 };
    if (dead) this._wreck(t, true);
    // hit box: bullets and blasts damage it
    t.collider = g.physics.addBox(def.x - 0.3, def.y - 0.35, def.z - 0.3, def.x + 0.3, def.y + 0.25, def.z + 0.3, { material: 'metal', owner: `turret:${id}`, blocksMove: false, blocksSight: false });
    t.collider.onBulletHit = (dmg) => this.damage(t, dmg);
    t.shooter = { id: `turret:${id}`, faction: 'free', isAI: true, colliderOwner: `turret:${id}`, pos: new THREE.Vector3(def.x, def.y - 1.4, def.z), vel: new THREE.Vector3(), alive: true, yaw: 0, stance: 'stand', onHit() {}, onSuppressed() {} };
    this.list.push(t);
  }

  _remove(t) {
    this.game.renderer.scene.remove(t.root);
    this.game.physics.remove(t.collider);
    this.list.splice(this.list.indexOf(t), 1);
  }

  damage(t, dmg) {
    if (!t.alive) return;
    t.health -= dmg;
    this.game.effects.emit(t.def.x, t.def.y, t.def.z, { color: [1.3, 0.9, 0.4], count: 4, speed: 3, size: 0.04, life: 0.3, gravity: 9, alpha: 1 });
    if (t.health <= 0) this._wreck(t);
  }

  _wreck(t, quiet = false) {
    t.alive = false;
    t.health = 0;
    this.destroyed.add(t.id);
    t.eye.visible = false;
    t.head.rotation.set(0.7, t.yaw, 0.2);
    if (!quiet) {
      const { x, y, z } = t.def;
      this.game.effects.emit(x, y, z, { color: [1.4, 0.8, 0.3], count: 18, speed: 4, size: 0.06, life: 0.6, gravity: 9, alpha: 1 });
      this.game.effects.emit(x, y, z, { color: [0.2, 0.2, 0.2], count: 8, speed: 0.6, size: 0.5, life: 3, gravity: -0.3, grow: 0.6, alpha: 0.5 });
      bus.emit('sound', { type: 'glass', x, y, z });
      bus.emit('notify', { text: 'Defence turret destroyed', kind: 'good', key: 'turret' });
    }
  }

  /** Explosions near turrets. */
  blast(x, y, z, r, dmg) {
    for (const t of this.list) {
      const d = Math.hypot(t.def.x - x, t.def.y - y, t.def.z - z);
      if (d < r) this.damage(t, dmg * (1 - d / r));
    }
  }

  update(dt) {
    const g = this.game;
    if (!this.list.length) return;
    const pc = g.player.controller;
    const ch = g.player.character;
    const target = { x: pc.pos.x, y: pc.pos.y + (pc.stance === 'prone' ? 0.3 : pc.stance === 'crouch' ? 0.9 : 1.3), z: pc.pos.z };
    for (const t of this.list) {
      if (!t.alive) continue;
      t.time += dt;
      const { x, y, z } = t.def;
      const dx = target.x - x, dy = target.y - y, dz = target.z - z;
      const dist = Math.hypot(dx, dy, dz);
      let sees = false;
      if (dist < RANGE && ch?.alive && !g.debug?.flags.invisible) {
        sees = g.physics.lineOfSight(x, y - 0.2, z, target.x, target.y, target.z, `turret:${t.id}`);
      }
      t.seenT = sees ? t.seenT + dt : 0;
      let wantYaw, wantPitch;
      if (sees) { wantYaw = Math.atan2(-dx, -dz); wantPitch = Math.atan2(dy, Math.hypot(dx, dz)); }
      else { wantYaw = Math.sin(t.time * 0.4) * 1.4; wantPitch = -0.25; }
      const turn = (sees ? 2.2 : 0.8) * dt;
      const dyaw = angleWrap(wantYaw - t.yaw);
      t.yaw += Math.max(-turn, Math.min(turn, dyaw));
      t.pitch += Math.max(-turn, Math.min(turn, wantPitch - t.pitch));
      t.head.rotation.set(t.pitch, t.yaw, 0, 'YXZ');
      t.eye.material = g.materials.get('emissive_lamp');
      if (!sees || t.seenT < 0.7 || Math.abs(dyaw) > 0.08 || t.time < t.nextShot) continue;
      // fire: bursts of 6, then a pause
      const w = t.w;
      const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(t.pitch, t.yaw, 0, 'YXZ'));
      const d = randomCone(dir, (2.4 * Math.PI) / 180 * Math.sqrt(Math.random()));
      const mz = t.gun.muzzle.getWorldPosition(new THREE.Vector3());
      t.shooter.pos.set(x, y - 1.4, z);
      g.ballistics.fire({ ox: mz.x, oy: mz.y, oz: mz.z, dx: d.x, dy: d.y, dz: d.z, weapon: w, shooter: t.shooter, damageMul: 1, muzzle: mz, tracer: t.burst % 3 === 0 });
      g.effects.worldFlash?.(mz.x, mz.y, mz.z, 1, true);
      bus.emit('weapon:fired', { weapon: w, x: mz.x, y: mz.y, z: mz.z, npc: t.shooter, noise: w.noise, suppressed: false });
      t.burst++;
      t.nextShot = t.time + (t.burst % 6 === 0 ? 1.4 : fireInterval(w));
    }
  }

  serialize() { return [...this.destroyed]; }
  deserialize(o) { this.destroyed = new Set(Array.isArray(o) ? o.filter((x) => typeof x === 'string') : []); }
}
