// On-demand local navigation: rasterises nearby colliders into a temporary occupancy
// grid (doors count as passable, floors/steps are ignored) and runs A* with octile
// heuristics, then string-pulls the result. Requests are budgeted per frame.
// With opts.threat the search also avoids ground a known enemy can see (flanking and
// falling back): visibility is tested lazily per 3x3-cell block and cached per search.

export class NavGrid {
  constructor(physics, world) {
    this.physics = physics;
    this.world = world;
    this.queue = [];
    this.budget = 3; // path searches per frame
    this.stats = { solved: 0, failed: 0 };
    this._list = [];
  }

  request(agent, from, to, opts = {}) {
    // replace any pending request from this agent
    this.queue = this.queue.filter((q) => q.agent !== agent);
    const req = { agent, from: { x: from.x, z: from.z }, to: { x: to.x, z: to.z }, opts, done: false, path: null };
    this.queue.push(req);
    return req;
  }

  update() {
    let n = 0;
    while (this.queue.length && n < this.budget) {
      const req = this.queue.shift();
      if (req.agent.removed || req.agent.alive === false) continue;
      // start from where the agent is now, not where it was when it asked
      if (req.agent.pos) { req.from.x = req.agent.pos.x; req.from.z = req.agent.pos.z; }
      req.path = this.findPath(req.from, req.to, req.opts);
      req.exposure = req.opts._exposure || 0;
      req.pathLength = req.opts._length || 0;
      req.done = true;
      if (req.path) this.stats.solved++; else this.stats.failed++;
      req.agent.onPath?.(req);
      n += req.opts.threat ? 2 : 1;
    }
  }

  /** Build occupancy for a rectangle. Returns {x0,z0,cell,w,h,blocked:Uint8Array, doorCells}. */
  _grid(minX, minZ, maxX, maxZ, cell, opts) {
    const w = Math.ceil((maxX - minX) / cell), h = Math.ceil((maxZ - minZ) / cell);
    const blocked = new Uint8Array(w * h);
    const ground = new Float32Array(w * h);
    const checkWater = this.world.hasWaterIn(minX, minZ, maxX, maxZ);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const x = minX + (i + 0.5) * cell, z = minZ + (j + 0.5) * cell;
      const g = this.world.heightAt(x, z);
      ground[j * w + i] = g;
      if (checkWater) {
        const water = this.world.waterAt(x, z);
        if (water !== null && water - g > 1.2 && this.world.bridgeAt(x, z) === null) blocked[j * w + i] = 1;
      }
    }
    // steep terrain
    for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
      const k = j * w + i;
      const dx = ground[k + 1] - ground[k - 1], dz = ground[k + w] - ground[k - w];
      if (Math.hypot(dx, dz) / (2 * cell) > 1.0) blocked[k] = 1;
    }
    const cols = this.physics.query(minX, minZ, maxX, maxZ, this._list);
    // walkable surfaces raised above the terrain (building plinths, raised ground floors, steps,
    // loading docks): the floor of a cell is the top of the highest such surface under its centre
    const FLOOR_MAX = 2.0;
    const floor = new Float32Array(ground);
    for (const c of cols) {
      if (!c.blocksMove || c.tag === 'character' || c.tag === 'door' || c.type === 'cyl') continue;
      // floors are wide (plinths, docks, platforms); furniture and crates are obstacles, not floors
      if (c.tag !== 'step' && (c.maxX - c.minX < 2 || c.maxZ - c.minZ < 2)) continue;
      const x0 = Math.max(0, Math.ceil((c.minX - minX) / cell - 0.5)), x1 = Math.min(w - 1, Math.floor((c.maxX - minX) / cell - 0.5));
      const z0 = Math.max(0, Math.ceil((c.minZ - minZ) / cell - 0.5)), z1 = Math.min(h - 1, Math.floor((c.maxZ - minZ) / cell - 0.5));
      for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
        const k = j * w + i;
        if (c.maxY > ground[k] + 0.05 && c.maxY <= ground[k] + FLOOR_MAX && c.maxY > floor[k]) floor[k] = c.maxY;
      }
    }
    // a cell is blocked only if its centre is within `inflate` of a collider: with 0.5 m cells a 1 m
    // doorway always keeps at least one free cell (blocking any overlapping cell sealed every door)
    const inflate = opts.radius ?? 0.25;
    for (const c of cols) {
      if (!c.blocksMove || c.tag === 'character') continue;
      if (c.tag === 'door' && !opts.noDoors) continue;
      if (opts.ignoreOwner && c.owner === opts.ignoreOwner) continue;
      const x0 = Math.max(0, Math.ceil((c.minX - inflate - minX) / cell - 0.5)), x1 = Math.min(w - 1, Math.floor((c.maxX + inflate - minX) / cell - 0.5));
      const z0 = Math.max(0, Math.ceil((c.minZ - inflate - minZ) / cell - 0.5)), z1 = Math.min(h - 1, Math.floor((c.maxZ + inflate - minZ) / cell - 0.5));
      if (x1 < x0 || z1 < z0) continue;
      for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
        const k = j * w + i;
        const g = floor[k];
        // surfaces up to 0.5 m above the floor are steps (climbable), overhead geometry is ignored
        if (c.maxY <= g + 0.42 || c.minY >= g + 1.9) continue;
        if (c.type === 'cyl') {
          const cx = minX + (i + 0.5) * cell, cz = minZ + (j + 0.5) * cell;
          if (Math.hypot(cx - c.x, cz - c.z) > c.r + inflate) continue;
        }
        blocked[k] = 1;
      }
    }
    // cells touching an obstacle are passable but cost more, so paths keep a body's width from walls
    const tight = new Uint8Array(w * h);
    for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
      const k = j * w + i;
      if (blocked[k]) continue;
      if (blocked[k - 1] || blocked[k + 1] || blocked[k - w] || blocked[k + w] || blocked[k - w - 1] || blocked[k - w + 1] || blocked[k + w - 1] || blocked[k + w + 1]) tight[k] = 1;
    }
    return { x0: minX, z0: minZ, cell, w, h, blocked, tight, ground: floor, terrain: ground };
  }

  findPath(from, to, opts = {}) {
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    if (!opts.cell) {
      // coarse grids can't see through doorways: try the cheap grid first, then a fine one
      const coarse = dist > 120 ? 2 : dist > 45 ? 1 : 0.5;
      const p = this.findPath(from, to, { ...opts, cell: coarse, radius: opts.radius ?? (coarse === 0.5 ? 0.2 : 0.25) });
      if (p || coarse === 0.5 || dist > 90) return p;
      return this.findPath(from, to, { ...opts, cell: 0.5, radius: opts.radius ?? 0.2 });
    }
    const cell = opts.cell;
    const margin = opts.margin ?? Math.min(40, 12 + dist * 0.35);
    let minX = Math.min(from.x, to.x) - margin, maxX = Math.max(from.x, to.x) + margin;
    let minZ = Math.min(from.z, to.z) - margin, maxZ = Math.max(from.z, to.z) + margin;
    // cap grid size
    const maxCells = 220;
    if ((maxX - minX) / cell > maxCells || (maxZ - minZ) / cell > maxCells) return null;
    const G = this._grid(minX, minZ, maxX, maxZ, cell, opts);
    const idx = (x, z) => {
      const i = Math.floor((x - G.x0) / cell), j = Math.floor((z - G.z0) / cell);
      if (i < 0 || j < 0 || i >= G.w || j >= G.h) return -1;
      return j * G.w + i;
    };
    let s = idx(from.x, from.z), t = idx(to.x, to.z);
    if (s < 0 || t < 0) return null;
    s = this._nearestFree(G, s);
    t = this._nearestFree(G, t, opts.goalTolerance ?? 4);
    if (s < 0 || t < 0) return null;
    const N = G.w * G.h;
    const gScore = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new MinHeap();
    gScore[s] = 0;
    const tx = t % G.w, tz = (t / G.w) | 0;
    const hfn = (k) => {
      const dx = Math.abs((k % G.w) - tx), dz = Math.abs(((k / G.w) | 0) - tz);
      return (dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz));
    };
    heap.push(s, hfn(s));
    // exposure cost: cells the threat can see are expensive to cross
    let exposed = null;
    if (opts.threat) {
      const T = opts.threat, B = 3;
      const bw = Math.ceil(G.w / B), bh = Math.ceil(G.h / B);
      const cache = new Int8Array(bw * bh).fill(-1);
      const ty = (T.y ?? this.world.heightAt(T.x, T.z)) + 1.5;
      exposed = (k) => {
        const i = k % G.w, j = (k / G.w) | 0;
        const b = ((j / B) | 0) * bw + ((i / B) | 0);
        if (cache[b] < 0) {
          const x = G.x0 + (((i / B) | 0) * B + B / 2) * cell, z = G.z0 + (((j / B) | 0) * B + B / 2) * cell;
          const far = Math.hypot(x - T.x, z - T.z) > 150;
          cache[b] = far ? 0 : this.physics.lineOfSight(T.x, ty, T.z, x, this.world.heightAt(x, z) + 1.2, z, opts.ignoreOwner) ? 1 : 0;
        }
        return cache[b];
      };
      G.exposed = exposed;
    }
    const exposurePenalty = opts.exposurePenalty ?? 5;
    let iterations = 0;
    const maxIter = opts.maxIter || 30000;
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    let found = false;
    while (heap.size && iterations++ < maxIter) {
      const cur = heap.pop();
      if (cur === t) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % G.w, cz = (cur / G.w) | 0;
      for (const [dx, dz, cost] of dirs) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= G.w || nz >= G.h) continue;
        const nk = nz * G.w + nx;
        if (G.blocked[nk] || closed[nk]) continue;
        if (dx && dz && (G.blocked[cz * G.w + nx] || G.blocked[nz * G.w + cx])) continue; // no corner cutting
        // climbing: a step up onto a raised floor of more than ~half a metre can't be walked
        const dh = Math.abs(G.ground[nk] - G.ground[cur]);
        if (dh > 0.42 && (G.ground[nk] - G.terrain[nk] > 0.05 || G.ground[cur] - G.terrain[cur] > 0.05)) continue; // physics steps up 0.45 m
        let g = gScore[cur] + cost + dh * 0.8;
        if (exposed && exposed(nk)) g += exposurePenalty * cost;
        if (G.tight[nk] && cell <= 1) g += 0.9 * cost;
        if (g < gScore[nk]) {
          gScore[nk] = g;
          came[nk] = cur;
          heap.push(nk, g + hfn(nk));
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = t; k !== -1; k = came[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map((k) => ({ x: G.x0 + ((k % G.w) + 0.5) * cell, z: G.z0 + (((k / G.w) | 0) + 0.5) * cell }));
    if (exposed) {
      let n = 0;
      for (const k of cells) if (exposed(k)) n++;
      opts._exposure = n / Math.max(1, cells.length);
    }
    opts._length = cells.length * cell;
    return this._smooth(G, pts, to);
  }

  _nearestFree(G, k, radius = 3) {
    if (!G.blocked[k]) return k;
    const cx = k % G.w, cz = (k / G.w) | 0;
    for (let r = 1; r <= radius; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx + dx, z = cz + dz;
        if (x < 0 || z < 0 || x >= G.w || z >= G.h) continue;
        const nk = z * G.w + x;
        if (!G.blocked[nk]) return nk;
      }
    }
    return -1;
  }

  _clear(G, a, b) {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const ki = (p) => Math.floor((p.z - G.z0) / G.cell) * G.w + Math.floor((p.x - G.x0) / G.cell);
    const ka = ki(a), kb = ki(b);
    const steps = Math.ceil(d / (G.cell * 0.5));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const i = Math.floor((x - G.x0) / G.cell), j = Math.floor((z - G.z0) / G.cell);
      if (i < 0 || j < 0 || i >= G.w || j >= G.h) return false;
      if (G.blocked[j * G.w + i]) return false;
      if (G.exposed && G.exposed(j * G.w + i)) return false;
      if (G.cell <= 1 && G.tight[j * G.w + i] && !G.tight[ka] && !G.tight[kb]) return false; // don't straighten a path into a wall-hugging line
    }
    return true;
  }

  _smooth(G, pts, goal) {
    if (pts.length <= 2) {
      // tiny paths: still finish at the exact goal when it can be walked to
      const last = pts[pts.length - 1];
      if (Math.hypot(last.x - goal.x, last.z - goal.z) > 0.3 && this.walkable(last, goal)) pts.push({ x: goal.x, z: goal.z });
      return pts;
    }
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this._clear(G, pts[i], pts[j])) j--;
      out.push(pts[j]);
      i = j;
    }
    // replace final cell centre with exact goal when it is reachable
    const last = out[out.length - 1];
    if (Math.hypot(last.x - goal.x, last.z - goal.z) < G.cell * 1.5) out[out.length - 1] = { x: goal.x, z: goal.z };
    else if (this.walkable(last, goal)) out.push({ x: goal.x, z: goal.z });
    return out;
  }

  /** True if a straight walk between two points is free of blocking colliders. */
  walkable(a, b, radius = 0.35) {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(d / 0.7);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const y = this.world.heightAt(x, z);
      const hit = this.physics.overlapsCylinder(x, y + 0.5, z, radius, 1.3);
      if (hit && hit.tag !== 'door') return false;
    }
    return true;
  }
}

class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(key, pri) {
    const k = this.k, p = this.p;
    k.push(key); p.push(pri);
    let i = k.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (p[par] <= p[i]) break;
      [k[par], k[i]] = [k[i], k[par]];
      [p[par], p[i]] = [p[i], p[par]];
      i = par;
    }
  }
  pop() {
    const k = this.k, p = this.p;
    const top = k[0];
    const lk = k.pop(), lp = p.pop();
    if (k.length) {
      k[0] = lk; p[0] = lp;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < k.length && p[l] < p[m]) m = l;
        if (r < k.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [p[m], p[i]] = [p[i], p[m]];
        i = m;
      }
    }
    return top;
  }
}
