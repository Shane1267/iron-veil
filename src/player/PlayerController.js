import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/MathUtil.js';
import { settings } from '../core/SettingsManager.js';
import { bus } from '../core/EventBus.js';

// First-person character controller: grounded acceleration-based movement, stances,
// step-up, slopes, ladders, swimming, fall damage, head-bob and camera effects.

const STANCE = {
  stand: { height: 1.8, eye: 1.66, speed: 4.4, sprint: 6.6 },
  crouch: { height: 1.25, eye: 1.12, speed: 2.1, sprint: 2.9 },
  prone: { height: 0.65, eye: 0.42, speed: 0.95, sprint: 0.95 },
};
const RADIUS = 0.34;
const GRAVITY = 17;
const STEP = 0.46;

export class PlayerController {
  constructor(camera, physics, world, input) {
    this.camera = camera;
    this.physics = physics;
    this.world = world;
    this.input = input;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.stance = 'stand';
    this.eyeHeight = STANCE.stand.eye;
    this.grounded = false;
    this.sprinting = false;
    this.moving = false;
    this.onLadder = null;
    this.swimming = false;
    this.inWater = 0;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.landDip = 0;
    this.stepSmooth = 0;
    this.lastStepPhase = 0;
    this.airTime = 0;
    this.fallStartY = 0;
    this.enabled = true;
    this.speedMul = 1;
    this.adsMul = 1;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.shake = 0;
    this.leanTilt = 0;
    this.fovKick = 0;
    this.surface = 'grass';
    this.noiseLevel = 0; // 0..1 movement noise for AI hearing
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this.camQuat = new THREE.Quaternion();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  get height() { return STANCE[this.stance].height; }
  get eyePos() { return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z); }

  teleport(x, y, z, yaw = this.yaw) {
    if (![x, y, z].every(Number.isFinite)) { console.warn('[Player] ignored teleport to a non-finite position', x, y, z); return; }
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.fallStartY = y;
    this.airTime = 0;
  }

  setStance(s) {
    if (s === this.stance) return true;
    const h = STANCE[s].height;
    if (h > this.height) {
      const ceil = this.physics.ceilingHeight(this.pos.x, this.pos.z, RADIUS, this.pos.y + 0.05);
      if (ceil < this.pos.y + h) return false;
      if (this.physics.overlapsCylinder(this.pos.x, this.pos.y + STEP, this.pos.z, RADIUS * 0.95, h - STEP)) return false;
    }
    this.stance = s;
    bus.emit('player:stance', s);
    return true;
  }

  look(dx, dy, sensMul = 1) {
    const s = settings.get('sensitivity') * 0.0022 * sensMul;
    this.yaw -= dx * s;
    this.pitch -= dy * s * (settings.get('invertY') ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.52, 1.52);
  }

  /**
   * dt step. ctx: {stamina, canSprint, encumbrance (0..1+), pain (0..1), ads}
   * returns events {jumped, landed, impact}
   */
  update(dt, ctx) {
    if (this.freeCam) {
      // debug photo camera: fixed position/orientation, world streaming follows it
      const c = this.freeCam;
      this.pos.set(c.x, this.world.heightAt(c.x, c.z), c.z);
      this.vel.set(0, 0, 0);
      this.camera.position.set(c.x, c.y, c.z);
      this.euler.set(c.pitch, c.yaw, 0);
      this.camera.quaternion.setFromEuler(this.euler);
      this.camQuat.copy(this.camera.quaternion);
      this.grounded = true; this.moving = false; this.airTime = 0; this.fallStartY = this.pos.y;
      return {};
    }
    const inp = this.input;
    const st = STANCE[this.stance];
    const events = {};

    // sitting on a chair or bench: any movement stands you up
    if (this.seat) {
      const wants = !inp.uiCapture && ['forward', 'back', 'left', 'right', 'jump'].some((a) => inp.is(a));
      if (wants || !this.enabled) { this.seat = null; this.stance = 'stand'; }
      else {
        this.pos.set(this.seat.x, this.seat.y, this.seat.z);
        this.vel.set(0, 0, 0);
        this.stance = 'crouch';
        this.grounded = true; this.moving = false; this.airTime = 0; this.fallStartY = this.pos.y;
        this._updateCamera(dt, 0);
        return events;
      }
    }

    // stance toggles
    if (this.enabled && !inp.uiCapture) {
      if (inp.hit('crouch')) this.setStance(this.stance === 'crouch' ? 'stand' : 'crouch');
      if (inp.hit('prone')) this.setStance(this.stance === 'prone' ? 'stand' : 'prone');
    }

    // wish direction
    let fx = 0, fz = 0;
    if (this.enabled && !inp.uiCapture) {
      if (inp.is('forward')) fz -= 1;
      if (inp.is('back')) fz += 1;
      if (inp.is('left')) fx -= 1;
      if (inp.is('right')) fx += 1;
    }
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    let wx = fx * cosY + fz * sinY;
    let wz = -fx * sinY + fz * cosY;

    const wantSprint = this.enabled && inp.is('sprint') && fz < 0 && ctx.canSprint && !ctx.ads && this.stance !== 'prone';
    if (wantSprint && this.stance === 'crouch' && this.grounded) this.setStance('stand');
    this.sprinting = wantSprint && len > 0 && this.grounded;
    let speed = (this.sprinting ? st.sprint : st.speed) * this.speedMul * (this.debugSpeed || 1);
    if (ctx.ads) speed *= this.stance === 'stand' ? 0.6 : 0.8;
    if (fz > 0) speed *= 0.82; // backpedal slower
    speed *= 1 - clamp(ctx.encumbrance - 1, 0, 0.6) * 0.6; // overweight
    speed *= 1 - (ctx.pain || 0) * 0.3;

    // water
    const water = this.pos.y < -250 ? null : this.world.waterAt(this.pos.x, this.pos.z);
    const depth = water !== null ? water - this.pos.y : 0;
    this.inWater = Math.max(0, depth);
    if (depth > 0.5) speed *= depth > 1.3 ? 0.45 : 0.7;
    this.swimming = depth > 1.35;

    // ladder climbing
    const ladder = this.physics.findLadder(this.pos.x, this.pos.y, this.pos.z, 0.75);
    if (ladder && this.enabled) {
      const facing = -(Math.sin(this.yaw) * ladder.nx + Math.cos(this.yaw) * ladder.nz);
      if (!this.onLadder && fz < 0 && facing > 0.2) this.onLadder = ladder;
    } else this.onLadder = null;
    if (this.onLadder) {
      const L = this.onLadder;
      if (this.stance !== 'stand') this.setStance('stand');
      const climb = (inp.is('forward') ? 1 : 0) - (inp.is('back') ? 1 : 0);
      this.vel.set(0, climb * 2.2, 0);
      // gently pull toward the ladder line
      this.pos.x = damp(this.pos.x, L.x, 6, dt);
      this.pos.z = damp(this.pos.z, L.z, 6, dt);
      this.pos.y += this.vel.y * dt;
      if (this.pos.y >= L.y1) {
        // step off at the top onto the platform
        this.pos.y = L.y1 + 0.05;
        this.pos.x -= L.nx * 0.9; this.pos.z -= L.nz * 0.9;
        this.onLadder = null;
      }
      const g = this.physics.groundHeight(this.pos.x, this.pos.z, RADIUS, this.pos.y + 0.2);
      if (this.pos.y <= g && climb < 0) { this.pos.y = g; this.onLadder = null; }
      if (inp.hit('jump')) { this.onLadder = null; this.vel.set(L.nx * 2.5, 1.5, L.nz * 2.5); }
      this.grounded = false;
      this.airTime = 0;
      this.fallStartY = this.pos.y;
      this._updateCamera(dt, 0);
      if (Math.abs(climb) > 0 && Math.floor(this.pos.y * 2.5) !== this._ladderStep) {
        this._ladderStep = Math.floor(this.pos.y * 2.5);
        bus.emit('footstep', { x: this.pos.x, y: this.pos.y, z: this.pos.z, surface: 'metal', volume: 0.5, player: true });
      }
      return events;
    }

    // horizontal acceleration
    const accel = this.grounded ? (len > 0 ? 38 : 28) : 4;
    const targetX = wx * speed, targetZ = wz * speed;
    const k = 1 - Math.exp(-accel * dt / Math.max(1, speed));
    this.vel.x = lerp(this.vel.x, targetX, this.grounded ? Math.min(1, accel * dt / 4) : k);
    this.vel.z = lerp(this.vel.z, targetZ, this.grounded ? Math.min(1, accel * dt / 4) : k);

    // slope handling: steep terrain resists uphill motion
    if (this.grounded) {
      const n = this.world.normalAt(this.pos.x, this.pos.z);
      if (n.y < 0.7) {
        const uphill = -(this.vel.x * n.x + this.vel.z * n.z);
        if (uphill > 0) {
          const f = clamp((0.7 - n.y) * 5, 0, 1);
          this.vel.x += n.x * uphill * f;
          this.vel.z += n.z * uphill * f;
        }
      }
    }

    // jump
    if (this.enabled && !inp.uiCapture && inp.hit('jump') && this.grounded && this.stance === 'stand' && !this.swimming && ctx.stamina > 10) {
      this.vel.y = 5.0;
      this.grounded = false;
      events.jumped = true;
    }

    // gravity / swimming buoyancy
    if (this.swimming) {
      this.vel.y = damp(this.vel.y, (water - 1.35 - this.pos.y) * 4, 5, dt);
    } else {
      this.vel.y -= GRAVITY * dt;
    }

    // horizontal collision
    const moved = this.physics.moveCylinder(this.pos, this.vel.x * dt, this.vel.z * dt, RADIUS, this.height, STEP);
    const blockedFrac = moved.blocked;
    const nx = moved.x, nz = moved.z;
    // step-up check: ground at new position
    const prevY = this.pos.y;
    const gNew = this.physics.groundHeight(nx, nz, RADIUS, this.pos.y + STEP + 0.02);
    if (gNew - this.pos.y > STEP + 0.01 && this.grounded) {
      // too high: cancel horizontal move
    } else {
      this.pos.x = nx;
      this.pos.z = nz;
    }
    if (blockedFrac) {
      // remove velocity into walls approximately
      const ax = (nx - (this.pos.x)) || 0;
      void ax;
    }

    // vertical
    this.pos.y += this.vel.y * dt;
    const ground = this.physics.groundHeight(this.pos.x, this.pos.z, RADIUS, Math.max(prevY, this.pos.y) + STEP + 0.02);
    const ceil = this.physics.ceilingHeight(this.pos.x, this.pos.z, RADIUS * 0.8, Math.max(prevY, this.pos.y) + this.height - 0.05);
    if (this.pos.y + this.height > ceil && this.vel.y > 0) {
      this.pos.y = ceil - this.height;
      this.vel.y = 0;
    }
    const wasGrounded = this.grounded;
    if (this.pos.y <= ground + 0.001 || (wasGrounded && this.pos.y - ground < 0.35 && this.vel.y <= 0 && !this.swimming)) {
      // snap to ground (handles walking down slopes and stairs)
      const stepUp = ground - this.pos.y;
      if (stepUp > 0.05 && wasGrounded) this.stepSmooth -= stepUp;
      this.pos.y = ground;
      if (!wasGrounded) {
        const fall = this.fallStartY - this.pos.y;
        const impactV = -this.vel.y;
        events.landed = true;
        events.impact = impactV;
        events.fall = fall;
        this.landDip = Math.min(0.25, impactV * 0.025);
        if (impactV > 3) bus.emit('footstep', { x: this.pos.x, y: this.pos.y, z: this.pos.z, surface: this.surface, volume: Math.min(1.5, impactV / 6), player: true, land: true });
      }
      this.vel.y = 0;
      this.grounded = true;
      this.airTime = 0;
      this.fallStartY = this.pos.y;
    } else {
      if (wasGrounded && this.vel.y <= 0) this.fallStartY = Math.max(this.fallStartY, this.pos.y);
      this.grounded = this.swimming;
      if (!this.swimming) this.airTime += dt;
      if (this.vel.y > 0) this.fallStartY = this.pos.y;
    }
    // world bounds
    const lim = this.world.data.worldSize / 2 - 60;
    this.pos.x = clamp(this.pos.x, -lim, lim);
    this.pos.z = clamp(this.pos.z, -lim, lim);

    // movement state & footsteps
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.moving = hs > 0.4 && this.grounded;
    if (this.moving) {
      this.surface = this._surface();
      const rate = this.sprinting ? 2.6 : this.stance === 'crouch' ? 1.3 : this.stance === 'prone' ? 0.8 : 1.9;
      this.bobPhase += dt * rate * Math.PI * 2 * clamp(hs / Math.max(1, speed), 0.4, 1.2);
      const stepPhase = Math.floor(this.bobPhase / Math.PI);
      if (stepPhase !== this.lastStepPhase) {
        this.lastStepPhase = stepPhase;
        const vol = this.sprinting ? 1.0 : this.stance === 'crouch' ? 0.3 : this.stance === 'prone' ? 0.15 : 0.6;
        bus.emit('footstep', { x: this.pos.x, y: this.pos.y, z: this.pos.z, surface: this.inWater > 0.15 ? 'water' : this.surface, volume: vol, player: true });
      }
    }
    this.noiseLevel = this.moving ? (this.sprinting ? 1 : this.stance === 'stand' ? 0.45 : 0.15) : 0;
    this.bobAmount = damp(this.bobAmount, this.moving ? (this.sprinting ? 1.6 : 1) : 0, 8, dt);
    this._updateCamera(dt, hs);
    return events;
  }

  _surface() {
    // indoors (standing on a box collider) vs terrain surface
    if (this.pos.y < -250) return 'concrete';
    const t = this.world.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y - t > 0.12) return this.world.bridgeAt(this.pos.x, this.pos.z) !== null ? 'concrete' : 'wood';
    return this.world.surfaceAt(this.pos.x, this.pos.z);
  }

  _updateCamera(dt, hs) {
    const st = STANCE[this.stance];
    this.eyeHeight = damp(this.eyeHeight, this.swimming ? 1.5 : st.eye, 10, dt);
    this.stepSmooth = damp(this.stepSmooth, 0, 14, dt);
    this.landDip = damp(this.landDip, 0, 7, dt);
    const bobOn = settings.get('headBob');
    const bob = bobOn ? this.bobAmount : this.bobAmount * 0.15;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.045 * bob - 0.02 * bob;
    const bobX = Math.cos(this.bobPhase) * 0.03 * bob;
    const shakeOn = settings.get('cameraShake');
    const shake = shakeOn ? this.shake : this.shake * 0.25;
    const sx = (Math.random() - 0.5) * shake * 0.02, sy = (Math.random() - 0.5) * shake * 0.02;
    this.shake = damp(this.shake, 0, 6, dt);

    const ey = this.pos.y + this.eyeHeight + bobY - this.landDip + this.stepSmooth;
    const right = this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.camera.position.set(this.pos.x + right.x * bobX, ey, this.pos.z + right.z * bobX);
    const roll = (bobOn ? Math.sin(this.bobPhase) * 0.004 * bob : 0) + this.leanTilt;
    this.euler.set(this.pitch + this.recoilPitch + sy, this.yaw + this.recoilYaw + sx, roll);
    this.camera.quaternion.setFromEuler(this.euler);
    this.camQuat.copy(this.camera.quaternion);
    void hs;
  }

  forward(out = this._fwd) {
    return out.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }
}

export { STANCE };
