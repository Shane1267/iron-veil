// Registry of every combatant (player + AI) with simplified humanoid hit volumes.
// Hit tests are done in each character's local frame: head sphere, torso, arms, legs.

const HIT = {
  stand: { head: [0, 1.6, 0, 0.12], torso: [0, 1.17, 0, 0.21, 0.32, 0.14], legs: [0, 0.45, 0, 0.19, 0.45, 0.13], armX: 0.3, armY: 1.18, armH: 0.3 },
  crouch: { head: [0, 1.12, 0.05, 0.12], torso: [0, 0.8, 0.05, 0.21, 0.28, 0.16], legs: [0, 0.3, 0.05, 0.22, 0.3, 0.26], armX: 0.3, armY: 0.82, armH: 0.26 },
  prone: { head: [0, 0.18, -0.8, 0.12], torso: [0, 0.16, -0.25, 0.22, 0.14, 0.38], legs: [0, 0.12, 0.6, 0.2, 0.12, 0.5], armX: 0.3, armY: 0.18, armH: 0.12 },
};

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const fx = ox - cx, fy = oy - cy, fz = oz - cz;
  const b = fx * dx + fy * dy + fz * dz;
  const c = fx * fx + fy * fy + fz * fz - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

function rayAABB(ox, oy, oz, dx, dy, dz, cx, cy, cz, hx, hy, hz) {
  let tmin = 0, tmax = Infinity;
  const axes = [[ox, dx, cx - hx, cx + hx], [oy, dy, cy - hy, cy + hy], [oz, dz, cz - hz, cz + hz]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return Infinity; continue; }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmax < tmin) return Infinity;
  }
  return tmin;
}

/** Ray vs humanoid at pos (feet) with yaw and stance. Returns {t, zone} or null. */
export function humanoidHitTest(pos, yaw, stance, ox, oy, oz, dx, dy, dz, maxT) {
  // broad phase: vertical cylinder
  const R = stance === 'prone' ? 1.2 : 0.6;
  const fx = ox - pos.x, fz = oz - pos.z;
  const a = dx * dx + dz * dz;
  if (a > 1e-9) {
    const b = fx * dx + fz * dz;
    const tc = -b / a;
    const cx = fx + dx * tc, cz = fz + dz * tc;
    if (cx * cx + cz * cz > R * R) return null;
    if (tc < -R || tc > maxT + R) return null;
  }
  // into local frame (rotate by -yaw around Y)
  const c = Math.cos(-yaw), s = Math.sin(-yaw);
  const lx = fx * c + fz * s, lz = -fx * s + fz * c, ly = oy - pos.y;
  const ldx = dx * c + dz * s, ldz = -dx * s + dz * c, ldy = dy;
  const H = HIT[stance] || HIT.stand;
  let best = Infinity, zone = null;
  const tryT = (t, z) => { if (t < best && t <= maxT) { best = t; zone = z; } };
  tryT(raySphere(lx, ly, lz, ldx, ldy, ldz, H.head[0], H.head[1], H.head[2], H.head[3]), 'head');
  tryT(rayAABB(lx, ly, lz, ldx, ldy, ldz, H.torso[0], H.torso[1], H.torso[2], H.torso[3], H.torso[4], H.torso[5]), 'torso');
  tryT(rayAABB(lx, ly, lz, ldx, ldy, ldz, H.legs[0], H.legs[1], H.legs[2], H.legs[3], H.legs[4], H.legs[5]), 'leg');
  for (const side of [-1, 1]) {
    tryT(rayAABB(lx, ly, lz, ldx, ldy, ldz, side * H.armX, H.armY, H.torso[2] - 0.05, 0.07, H.armH, 0.09), 'arm');
  }
  return zone ? { t: best, zone } : null;
}

export class Characters {
  constructor() {
    this.list = new Set();
  }

  add(c) {
    this.list.add(c);
    return c;
  }

  remove(c) {
    this.list.delete(c);
  }

  /** Closest character hit along a ray (excluding `ignore`). */
  raycast(ox, oy, oz, dx, dy, dz, maxT, ignore = null) {
    let best = null;
    for (const c of this.list) {
      if (!c.alive || c === ignore) continue;
      const p = c.pos;
      // quick reject on distance from ray start
      const rx = p.x - ox, rz = p.z - oz;
      if (rx * rx + rz * rz > (maxT + 2) * (maxT + 2)) continue;
      const h = humanoidHitTest(p, c.yaw, c.stance || 'stand', ox, oy, oz, dx, dy, dz, best ? best.t : maxT);
      if (h && (!best || h.t < best.t)) best = { t: h.t, zone: h.zone, character: c };
    }
    return best;
  }

  near(x, z, r, filter = null) {
    const out = [];
    for (const c of this.list) {
      if (!c.alive) continue;
      if ((c.pos.x - x) ** 2 + (c.pos.z - z) ** 2 > r * r) continue;
      if (filter && !filter(c)) continue;
      out.push(c);
    }
    return out;
  }
}
