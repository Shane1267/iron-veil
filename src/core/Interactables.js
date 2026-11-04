// Spatial registry of interactable objects (doors, containers, vehicles, pumps, radio,
// placed structures, corpses). The player's interaction ray picks the best candidate.

const CELL = 8;
const key = (ix, iz) => (ix + 32768) * 65536 + (iz + 32768);

export class Interactables {
  constructor() {
    this.cells = new Map();
    this.byId = new Map();
  }

  add(obj) {
    if (this.byId.has(obj.id)) this.remove(this.byId.get(obj.id));
    obj.radius = obj.radius || 1.5;
    obj._key = key(Math.floor(obj.x / CELL), Math.floor(obj.z / CELL));
    if (!this.cells.has(obj._key)) this.cells.set(obj._key, new Set());
    this.cells.get(obj._key).add(obj);
    this.byId.set(obj.id, obj);
    return obj;
  }

  move(obj, x, y, z) {
    const k = key(Math.floor(x / CELL), Math.floor(z / CELL));
    obj.x = x; obj.y = y; obj.z = z;
    if (k !== obj._key) {
      this.cells.get(obj._key)?.delete(obj);
      obj._key = k;
      if (!this.cells.has(k)) this.cells.set(k, new Set());
      this.cells.get(k).add(obj);
    }
  }

  remove(obj) {
    if (!obj) return;
    this.cells.get(obj._key)?.delete(obj);
    if (this.byId.get(obj.id) === obj) this.byId.delete(obj.id);
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  near(x, z, r, out = []) {
    out.length = 0;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const s = this.cells.get(key(ix, iz));
      if (!s) continue;
      for (const o of s) if ((o.x - x) ** 2 + (o.z - z) ** 2 <= r * r) out.push(o);
    }
    return out;
  }

  /**
   * Choose the interactable the player is looking at.
   * eye {x,y,z}, dir {x,y,z} normalized. losCheck(o) optional.
   */
  pick(eye, dir, maxDist = 2.6, losCheck = null) {
    const list = this.near(eye.x, eye.z, maxDist + 2, this._tmp || (this._tmp = []));
    let best = null, bestScore = -Infinity;
    for (const o of list) {
      if (o.enabled === false) continue;
      const dx = o.x - eye.x, dy = o.y - eye.y, dz = o.z - eye.z;
      const along = dx * dir.x + dy * dir.y + dz * dir.z;
      if (along < -0.2 || along > maxDist + o.radius * 0.5) continue;
      const px = eye.x + dir.x * along, py = eye.y + dir.y * along, pz = eye.z + dir.z * along;
      const off = Math.hypot(o.x - px, o.y - py, o.z - pz);
      if (off > o.radius) continue;
      const score = -off * 2 - along * 0.5 + (o.priority || 0);
      if (score > bestScore) {
        if (losCheck && !losCheck(o)) continue;
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  clear() {
    this.cells.clear();
    this.byId.clear();
  }
}
