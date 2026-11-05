// Automatic sentry gun on a base. It has no weapon or ammunition of its own: the player
// puts a firearm and matching rounds in its storage. It turns toward the nearest hostile
// person it can see, fires short bursts with the weapon's own ballistics and rate of fire,
// reloads from the stored rounds and goes quiet when they run out.
import * as THREE from 'three';
import { buildPieceMesh } from './PieceModels.js';
import { npcWeapon } from '../ai/CharacterModel.js';
import { ItemDB } from '../items/ItemDatabase.js';
import { effectiveWeapon, fireInterval } from '../weapons/WeaponData.js';
import { randomCone } from '../weapons/WeaponController.js';
import { bus } from '../core/EventBus.js';
import { angleWrap } from '../core/MathUtil.js';

const HEAD_Y = 1.08;
const RANGE = { pistol: 45, smg: 60, shotgun: 30, rifle: 140, lmg: 140, dmr: 180, sniper: 220 };
const _v = new THREE.Vector3();

export class Sentry {
  constructor(piece, game) {
    this.piece = piece;
    this.game = game;
    this.head = new THREE.Group();
    this.head.position.set(piece.x, piece.y + HEAD_Y, piece.z);
    this.yaw = (piece.rot * Math.PI) / 2;
    this.pitch = 0;
    this.head.rotation.y = this.yaw;
    const body = buildPieceMesh('sentryHead', game.materials);
    body.castShadow = true;
    this.head.add(body);
    this.pitchGroup = new THREE.Group();
    this.head.add(this.pitchGroup);
    game.base.group.add(this.head);
    this.weaponId = null;
    this.gun = null;
    this.loaded = piece.sentryLoaded || 0; // rounds in the gun
    this.reloadT = 0;
    this.nextShot = 0;
    this.scanT = 0;
    this.target = null;
    this.burst = 0;
    this.time = 0;
    this.status = 'No weapon';
    // the shooter AI see and blame: a player-side gun at the head position
    const self = this;
    this.shooter = {
      id: `sentry:${piece.id}`, isPlayer: true, isSentry: true, faction: 'player', colliderOwner: `base:${piece.id}`,
      pos: new THREE.Vector3(piece.x, piece.y, piece.z), vel: new THREE.Vector3(), yaw: 0, stance: 'stand', lightOn: false,
      get alive() { return self.piece.alive; },
      get firedRecently() { return self.time - (self.lastShotT ?? -99) < 1.5; },
      onHit(info) { game.base.damagePiece(piece, (info.base || 20) * 0.5); },
      onSuppressed() {},
    };
  }

  _weaponStack() {
    const inv = this.piece.inventory;
    if (!inv) return null;
    for (const s of inv.slots) if (s && ItemDB.weapon(s.id)?.magSize) return s;
    return null;
  }

  _syncWeapon(stack) {
    const id = stack?.id || null;
    if (id === this.weaponId && this._synced) return;
    const first = !this._synced;
    this._synced = true;
    this.weaponId = id;
    if (this.gun) { this.pitchGroup.remove(this.gun.mesh); this.gun = null; }
    // ammunition already in the old gun goes back to storage (rounds restored from a save stay loaded)
    if (!first || !stack) {
      if (this.loaded && this.w?.ammo) this.piece.inventory.add({ id: this.w.ammo, qty: this.loaded });
      this.loaded = 0;
    }
    this.w = stack ? effectiveWeapon(stack) : null;
    if (!stack) return;
    this.gun = npcWeapon(stack.id, stack.data?.attach || {}, this.game.materials);
    this.gun.mesh.position.set(0.0, 0.16, 0.05);
    this.pitchGroup.add(this.gun.mesh);
  }

  /** Visible hostile person closest to the gun. */
  _findTarget(range) {
    const g = this.game, phys = g.physics;
    const o = this.head.position;
    let best = null, bd = range;
    for (const c of g.characters.list) {
      if (!c.alive || !c.isAI) continue;
      if (!this._hostile(c)) continue;
      const d = Math.hypot(c.pos.x - o.x, c.pos.z - o.z);
      if (d > bd) continue;
      const ty = c.pos.y + (c.stance === 'crouch' ? 0.9 : 1.25);
      if (!phys.lineOfFire(o.x, o.y + 0.2, o.z, c.pos.x, ty, c.pos.z, `base:${this.piece.id}`)) continue;
      best = c; bd = d;
    }
    return best;
  }

  _hostile(c) {
    const g = this.game;
    if (g.factions.hostile(c.faction, 'player')) return true;
    // anyone shooting at the player or the base
    return !!(c.target && (c.target.isPlayer || c.target.isSentry) && c.state === 'combat');
  }

  update(dt) {
    const p = this.piece;
    if (!p.alive) return;
    this.time += dt;
    const stack = this._weaponStack();
    this._syncWeapon(stack);
    const w = this.w;
    if (!w) { this.status = 'No weapon — put a firearm inside'; this._idle(dt); return; }
    const inv = p.inventory;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const got = inv.remove(w.ammo, w.magSize - this.loaded);
        this.loaded += got;
        bus.emit('sound', { type: 'reload', stage: 'end', weapon: w, x: p.x, y: p.y + 1, z: p.z });
      }
    }
    if (this.loaded <= 0 && this.reloadT <= 0) {
      if (inv.count(w.ammo) > 0) { this.reloadT = w.reloadTime * 1.2; bus.emit('sound', { type: 'reload', stage: 'start', weapon: w, x: p.x, y: p.y + 1, z: p.z }); }
    }
    const stored = inv.count(w.ammo);
    this.status = this.loaded + stored <= 0 ? `Out of ammunition (${ItemDB.get(w.ammo).name})` : this.reloadT > 0 ? 'Reloading' : this.target ? 'Engaging' : 'Watching';
    p.sentryLoaded = this.loaded;
    // target selection a few times a second
    this.scanT -= dt;
    const range = RANGE[w.class] || 80;
    if (this.scanT <= 0) {
      this.scanT = 0.3;
      this.target = this._findTarget(range);
      if (this.target && !this._had) bus.emit('sound', { type: 'click', x: p.x, y: p.y + 1, z: p.z });
      this._had = !!this.target;
    }
    const t = this.target;
    if (!t || !t.alive) { this.target = null; this._idle(dt); return; }
    // aim
    const o = this.head.position;
    const ty = t.pos.y + (t.stance === 'crouch' ? 0.85 : 1.2);
    const dx = t.pos.x - o.x, dz = t.pos.z - o.z, dist = Math.hypot(dx, dz);
    const lead = (w.projectile ? dist / (w.velocity || 800) : 0);
    const ax = dx + (t.vel?.x || 0) * lead, az = dz + (t.vel?.z || 0) * lead;
    const wantYaw = Math.atan2(-ax, -az);
    const wantPitch = Math.atan2(ty - (o.y + 0.2), dist);
    const turn = 2.4 * dt;
    const dy = angleWrap(wantYaw - this.yaw);
    this.yaw += Math.max(-turn, Math.min(turn, dy));
    this.pitch += Math.max(-turn, Math.min(turn, wantPitch - this.pitch));
    this._pose();
    if (Math.abs(dy) > 0.06 || this.reloadT > 0 || this.loaded <= 0 || this.time < this.nextShot) return;
    this._fire(w, dist);
  }

  _idle(dt) {
    // slow sweep back and forth across the piece's facing
    const base = (this.piece.rot * Math.PI) / 2;
    const want = base + Math.sin(this.time * 0.35) * 1.1;
    this.yaw += angleWrap(want - this.yaw) * Math.min(1, dt * 0.8);
    this.pitch += (0 - this.pitch) * Math.min(1, dt * 2);
    this._pose();
  }

  _pose() {
    this.head.rotation.y = this.yaw;
    this.pitchGroup.rotation.x = this.pitch;
  }

  _fire(w, dist) {
    const g = this.game, p = this.piece;
    const muzzle = this.gun ? this.gun.muzzle.getWorldPosition(_v.set(0, 0, 0)).clone() : this.head.position.clone();
    this.head.updateMatrixWorld(true);
    const dir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const pellets = w.pellets || 1;
    const cond = p.health / p.maxHealth;
    this.shooter.pos.set(p.x, p.y, p.z);
    this.shooter.yaw = this.yaw;
    for (let i = 0; i < pellets; i++) {
      const err = ((1.1 + (1 - cond) * 1.5 + (pellets > 1 ? w.pelletSpread : 0)) * Math.PI / 180) * Math.sqrt(Math.random());
      const d = randomCone(dir.clone(), err);
      g.ballistics.fire({ ox: muzzle.x, oy: muzzle.y, oz: muzzle.z, dx: d.x, dy: d.y, dz: d.z, weapon: w, shooter: this.shooter, damageMul: w.damageMul, muzzle, tracer: i === 0 && this.loaded % 4 === 0, attach: this.piece.inventory.slots.find((s) => s?.id === w.id)?.data?.attach || null });
    }
    this.loaded--;
    this.lastShotT = this.time;
    if (w.flash && g.effects.worldFlash) g.effects.worldFlash(muzzle.x, muzzle.y, muzzle.z, 1, true);
    g.effects.smoke?.(muzzle.x, muzzle.y, muzzle.z, 0.6);
    bus.emit('weapon:fired', { weapon: w, x: muzzle.x, y: muzzle.y, z: muzzle.z, shooter: this.shooter, sentry: true, noise: (w.noise || 300) * (w.noiseMul || 1), suppressed: !w.flash || (w.noiseMul || 1) < 1 });
    // short bursts for automatics, aimed singles otherwise
    const auto = w.fireModes?.includes('auto');
    this.burst++;
    if (w.action) this.nextShot = this.time + (w.cycleTime || 1) + 0.4;
    else if (auto) this.nextShot = this.time + (this.burst % 5 === 0 ? 0.5 + dist / 200 : fireInterval(w));
    else this.nextShot = this.time + Math.max(fireInterval(w), 0.3 + dist / 250);
  }

  dispose() {
    if (this.loaded && this.w?.ammo && this.piece.inventory) this.piece.inventory.add({ id: this.w.ammo, qty: this.loaded });
    this.loaded = 0;
    this.game.base.group.remove(this.head);
  }
}
