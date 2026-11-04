// A connected player as the server's world sees them: a character record the AI can see,
// hear, shoot and be shot by. Movement comes from the player's own browser (checked for
// plausible speed); damage the AI deals is forwarded to that browser, which applies it
// with the player's real armour and survival model.
import * as THREE from 'three';
import { bus } from '../src/core/EventBus.js';

const MAX_SPEED = 9; // m/s on foot (sprint is ~6.5)
const MAX_SPEED_VEHICLE = 45;

export class NetPlayer {
  constructor(game, conn, id, name) {
    this.game = game;
    this.conn = conn;
    this.id = id;
    this.name = name;
    this.faction = 'player';
    this.isPlayer = true;
    this.colliderOwner = `player:${id}`;
    this.pos = new THREE.Vector3(0, -1e5, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.stance = 'stand';
    this.alive = false;
    this.joined = false;
    this.lightOn = false;
    this.weaponId = null;
    this.inVehicle = false;
    this.lastShot = -99;
    this.lastState = 0;
    this.stepAcc = 0;
    this.whizT = 0;
    this.health = 100;
    this.lastFireT = 0;
  }

  get firedRecently() { return this.game.time - this.lastShot < 1.5; }

  /** Movement report from the client. Teleports (respawn, load) come with reset = true. */
  applyState(s, reset = false) {
    const nums = [s.x, s.y, s.z, s.yaw];
    if (!nums.every(Number.isFinite)) return;
    const now = this.game.time;
    const dt = Math.max(0.03, now - this.lastState);
    this.lastState = now;
    const dx = s.x - this.pos.x, dz = s.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    const lim = (s.veh ? MAX_SPEED_VEHICLE : MAX_SPEED) * dt + 2;
    if (!reset && this.joined && d > lim) {
      // implausible jump: accept it but do not let it count as movement noise
      this.pos.set(s.x, s.y, s.z);
      this.vel.set(0, 0, 0);
    } else {
      if (this.joined && !reset) this.vel.set(dx / dt, 0, dz / dt); else this.vel.set(0, 0, 0);
      if (!reset) this.stepAcc += Math.min(d, lim);
      this.pos.set(s.x, s.y, s.z);
    }
    this.yaw = s.yaw;
    this.pitch = Number.isFinite(s.pitch) ? s.pitch : 0;
    this.stance = s.st === 'crouch' || s.st === 'prone' ? s.st : 'stand';
    this.lightOn = !!s.light;
    this.weaponId = typeof s.w === 'string' ? s.w.slice(0, 40) : null;
    this.inVehicle = !!s.veh;
    if (typeof s.alive === 'boolean') this.alive = s.alive;
  }

  update(dt) {
    this.whizT -= dt;
    // footsteps the AI can hear, from distance actually covered (no sound in vehicles)
    if (!this.alive || this.inVehicle) { this.stepAcc = 0; return; }
    const stride = this.stance === 'crouch' ? 0.6 : 0.85;
    if (this.stepAcc >= stride) {
      this.stepAcc = 0;
      const speed = Math.hypot(this.vel.x, this.vel.z);
      const volume = this.stance === 'prone' ? 0.15 : this.stance === 'crouch' ? 0.3 : speed > 4.5 ? 1.0 : 0.55;
      bus.emit('footstep', { x: this.pos.x, y: this.pos.y, z: this.pos.z, volume, player: true, char: this });
    }
  }

  /** The AI hit this player: the player's browser applies the damage. */
  onHit(info) {
    if (!this.alive) return;
    const sh = info.shooter;
    this.conn.send({
      t: 'hit', zone: info.zone, base: info.base, w: info.weapon?.id || null, dist: +(info.distance || 0).toFixed(1),
      loss: +(info.penetrationLoss || 0).toFixed(3), mul: info.mul || 1, cause: info.cause || 'gunshot',
      dir: info.dir ? [+info.dir.x.toFixed(3), +info.dir.y.toFixed(3), +info.dir.z.toFixed(3)] : null,
      from: sh?.id || null,
    });
  }

  onSuppressed(info) {
    if (!this.alive || this.whizT > 0) return;
    this.whizT = 0.08;
    this.conn.send({ t: 'whiz', d: +info.distance.toFixed(2), x: +info.x.toFixed(2), y: +info.y.toFixed(2), z: +info.z.toFixed(2) });
  }
}
