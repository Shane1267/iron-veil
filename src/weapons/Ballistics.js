import { MATERIALS, PhysicsWorld } from '../engine/PhysicsWorld.js';
import { bus } from '../core/EventBus.js';

// Shot resolution for every firearm in the game. Hitscan for short-range/pistol
// calibres, simulated projectiles (travel time + drop) for rifles. Both share the same
// penetration model: bullets keep a "power" budget that thin materials subtract from.

const GRAVITY = 9.81;
const MAX_LIFE = 2.6;

function faceNormal(c, x, y, z) {
  if (!c) return null;
  if (c.type === 'cyl') {
    const dx = x - c.x, dz = z - c.z;
    const l = Math.hypot(dx, dz) || 1;
    if (y >= c.maxY - 0.02) return { x: 0, y: 1, z: 0 };
    return { x: dx / l, y: 0, z: dz / l };
  }
  const d = [
    [Math.abs(x - c.minX), -1, 0, 0], [Math.abs(x - c.maxX), 1, 0, 0],
    [Math.abs(y - c.minY), 0, -1, 0], [Math.abs(y - c.maxY), 0, 1, 0],
    [Math.abs(z - c.minZ), 0, 0, -1], [Math.abs(z - c.maxZ), 0, 0, 1],
  ];
  d.sort((a, b) => a[0] - b[0]);
  return { x: d[0][1], y: d[0][2], z: d[0][3] };
}

export class Ballistics {
  constructor(physics, characters, effects, world, opts = {}) {
    this.physics = physics;
    this.characters = characters;
    this.effects = effects;
    this.world = world;
    this.onGlass = opts.onGlass || null;
    this.listenerPos = opts.listenerPos || null; // function returning player eye pos
    this.projectiles = [];
    this.stats = { shots: 0, hits: 0 };
  }

  /**
   * Fire one projectile/pellet.
   * shot: {ox,oy,oz, dx,dy,dz, weapon, shooter (character), damageMul, tracer, muzzle {x,y,z}}
   */
  fire(shot) {
    this.stats.shots++;
    const w = shot.weapon;
    if (w.projectile) {
      this.projectiles.push({
        x: shot.ox, y: shot.oy, z: shot.oz,
        vx: shot.dx * w.velocity, vy: shot.dy * w.velocity, vz: shot.dz * w.velocity,
        travelled: 0, life: 0, power: w.penetration, loss: 0, shot,
        whizzed: false, tracer: shot.tracer,
      });
      if (shot.tracer && shot.muzzle) this._pendingTracer(shot);
      return null;
    }
    const range = w.class === 'shotgun' ? 120 : w.class === 'pistol' || w.class === 'smg' ? 350 : 600;
    const res = this._trace(shot.ox, shot.oy, shot.oz, shot.dx, shot.dy, shot.dz, range, w.penetration, 0, shot, 0);
    if (shot.tracer && shot.muzzle) {
      const end = res?.point || { x: shot.ox + shot.dx * range, y: shot.oy + shot.dy * range, z: shot.oz + shot.dz * range };
      this.effects.tracer(shot.muzzle, end, 600);
    }
    this._whizCheck(shot, shot.ox, shot.oy, shot.oz, shot.dx, shot.dy, shot.dz, res ? res.dist : range);
    return res;
  }

  _pendingTracer(shot) {
    const w = shot.weapon;
    const len = 600;
    this.effects.tracer(shot.muzzle, { x: shot.ox + shot.dx * len, y: shot.oy + shot.dy * len - 0.5 * GRAVITY * (len / w.velocity) ** 2, z: shot.oz + shot.dz * len }, w.velocity * 0.9);
  }

  update(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      let remaining = dt;
      let done = false;
      while (remaining > 1e-5 && !done) {
        const step = Math.min(remaining, 1 / 60);
        remaining -= step;
        const nvx = p.vx * 0.9995, nvz = p.vz * 0.9995;
        const nvy = p.vy - GRAVITY * step;
        const sx = (p.vx + nvx) * 0.5 * step, sy = (p.vy + nvy) * 0.5 * step, sz = (p.vz + nvz) * 0.5 * step;
        const segLen = Math.hypot(sx, sy, sz);
        const dx = sx / segLen, dy = sy / segLen, dz = sz / segLen;
        const res = this._trace(p.x, p.y, p.z, dx, dy, dz, segLen, p.power, p.loss, p.shot, p.travelled, p);
        this._whizCheck(p.shot, p.x, p.y, p.z, dx, dy, dz, res && res.stopped ? res.dist : segLen, p);
        if (res && res.stopped) { done = true; break; }
        p.x += sx; p.y += sy; p.z += sz;
        p.vx = nvx; p.vy = nvy; p.vz = nvz;
        p.travelled += segLen;
        p.life += step;
        if (p.life > MAX_LIFE || p.y < -50) done = true;
      }
      if (done) this.projectiles.splice(i, 1);
    }
  }

  /**
   * Trace a segment with penetration. Mutates projectile power/loss if given.
   * Returns {stopped, dist, point, hit} or null if nothing hit.
   */
  _trace(ox, oy, oz, dx, dy, dz, maxDist, power, loss, shot, travelled, proj = null) {
    const shooterOwner = shot.shooter?.colliderOwner || null;
    const hits = this.physics.raycastAll(ox, oy, oz, dx, dy, dz, maxDist, (c) => c.blocksShots && c.owner !== shooterOwner && c.tag !== 'character');
    const ch = this.characters.raycast(ox, oy, oz, dx, dy, dz, maxDist, shot.shooter);
    let result = null;
    let lastPoint = null;
    for (const h of hits) {
      if (ch && ch.t < h.t) break;
      const point = { x: ox + dx * h.t, y: oy + dy * h.t, z: oz + dz * h.t };
      lastPoint = point;
      const mat = h.material;
      if (h.collider === null || mat === 'terrain') {
        const n = this.world.normalAt(point.x, point.z);
        const water = this.world.waterAt(point.x, point.z);
        if (water !== null && point.y < water + 0.3) {
          this.effects.splash(point.x, water, point.z);
          bus.emit('impact', { x: point.x, y: water, z: point.z, material: 'water', shooter: shot.shooter });
        } else {
          this.effects.impact(point, n, 'terrain', { x: dx, y: dy, z: dz });
          bus.emit('impact', { x: point.x, y: point.y, z: point.z, material: 'terrain', shooter: shot.shooter });
        }
        return { stopped: true, dist: h.t, point, hit: null };
      }
      const resist = (MATERIALS[mat] || MATERIALS.concrete).resist;
      const thick = Math.max(0.02, Math.min(h.tExit, maxDist + 2) - h.t);
      const cost = thick * resist;
      const n = faceNormal(h.collider, point.x, point.y, point.z);
      if (h.collider.glass && !h.collider.glass.broken) this.onGlass?.(h.collider.glass);
      this.effects.impact(point, n || { x: -dx, y: -dy, z: -dz }, mat, { x: dx, y: dy, z: dz });
      bus.emit('impact', { x: point.x, y: point.y, z: point.z, material: mat, shooter: shot.shooter, collider: h.collider });
      if (h.collider.onBulletHit) h.collider.onBulletHit(shot.weapon.damage * (shot.damageMul || 1) * (1 - loss), shot);
      if (power > cost && mat !== 'rock') {
        power -= cost;
        loss = Math.min(0.95, loss + cost / Math.max(0.1, shot.weapon.penetration) * 0.6);
        // exit hole
        const ex = { x: ox + dx * h.tExit, y: oy + dy * h.tExit, z: oz + dz * h.tExit };
        if (mat !== 'glass' && n) this.effects.decal(ex, { x: -n.x, y: -n.y, z: -n.z }, [0.2, 0.18, 0.16], 0.06);
        if (proj) { proj.power = power; proj.loss = loss; }
        continue;
      }
      return { stopped: true, dist: h.t, point, hit: null };
    }
    if (ch) {
      const point = { x: ox + dx * ch.t, y: oy + dy * ch.t, z: oz + dz * ch.t };
      this.stats.hits++;
      const dist = travelled + ch.t;
      ch.character.onHit({
        zone: ch.zone, base: shot.weapon.damage, weapon: shot.weapon, distance: dist, penetrationLoss: loss,
        mul: shot.damageMul || 1, shooter: shot.shooter, dir: { x: dx, y: dy, z: dz }, point, cause: 'gunshot',
      });
      this.effects.blood(point, { x: dx, y: dy, z: dz });
      bus.emit('hit', { target: ch.character, shooter: shot.shooter, zone: ch.zone, point });
      return { stopped: true, dist: ch.t, point, hit: ch };
    }
    void lastPoint;
    if (proj) { proj.power = power; proj.loss = loss; }
    return result;
  }

  /** Near-miss detection: bullets passing close to a character cause suppression/whiz. */
  _whizCheck(shot, ox, oy, oz, dx, dy, dz, len, proj = null) {
    if (proj && proj.whizzed) return;
    for (const c of this.characters.list) {
      if (!c.alive || c === shot.shooter) continue;
      const px = c.pos.x - ox, py = c.pos.y + 1.4 - oy, pz = c.pos.z - oz;
      const t = px * dx + py * dy + pz * dz;
      if (t < 0 || t > len) continue;
      const cx = px - dx * t, cy = py - dy * t, cz = pz - dz * t;
      const d = Math.hypot(cx, cy, cz);
      if (d < 3.5) {
        c.onSuppressed?.({ distance: d, shooter: shot.shooter, x: ox + dx * t, y: oy + dy * t, z: oz + dz * t, weapon: shot.weapon });
        if (proj) proj.whizzed = true;
      }
    }
  }
}

export { faceNormal };
void PhysicsWorld;
