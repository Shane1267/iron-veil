import { PIECE } from './BaseSystem.js';
import { ItemDB } from '../items/ItemDatabase.js';
import { uid } from '../core/MathUtil.js';
import { bus } from '../core/EventBus.js';
import buildingData from '../data/building.json';

// Base blueprints. Export writes every piece you have built (type, position relative to an
// anchor on the building grid, rotation, style, sign text) to a .json file. Import reads
// such a file (yours or somebody else's), totals the materials, and builds the whole base
// at once where you stand if you can supply them: materials are taken from your pockets
// first and then from your own base storage within 40 m. Nothing is built if anything is
// missing, the ground is too uneven, or the site is blocked.

const G = buildingData.grid;
const FORMAT = 'ironveil-blueprint';
const MAX_PIECES = 800;
const order = (t) => (t === 'foundation' ? 0 : /wall|doorway|window/.test(t) && PIECE[t].snap !== 'perimeter' ? 1 : t === 'floor' ? 2 : PIECE[t].snap === 'door' ? 3 : 4);

export class Blueprints {
  constructor(game) {
    this.game = game;
    this.loaded = null; // {name, pieces, cost}
  }

  /** Blueprint object for the current base (or the cluster within `radius` of the player). */
  capture(name = 'My base', radius = null) {
    const g = this.game;
    let ps = [...g.base.pieces.values()].filter((p) => p.alive);
    if (radius) { const pp = g.player.controller.pos; ps = ps.filter((p) => Math.hypot(p.x - pp.x, p.z - pp.z) < radius); }
    if (!ps.length) return null;
    // anchor on the grid so cell-snapped pieces stay aligned wherever it is rebuilt
    const cx = ps.reduce((a, p) => a + p.x, 0) / ps.length, cz = ps.reduce((a, p) => a + p.z, 0) / ps.length;
    const ax = Math.round(cx / G) * G, az = Math.round(cz / G) * G;
    const ay = Math.min(...ps.map((p) => p.y));
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const pieces = ps.map((p) => {
      const o = { t: p.type, x: r3(p.x - ax), y: r3(p.y - ay), z: r3(p.z - az), r: p.rot | 0 };
      // pieces standing on the ground remember that, so they follow the terrain where rebuilt
      const og = p.y - g.world.heightAt(p.x, p.z);
      if (Math.abs(og) < 0.35 && (p.def.snap === 'free' || p.def.snap === 'perimeter')) o.g = r3(og);
      if (p.variant) o.v = p.variant;
      if (p.text) o.s = String(p.text).slice(0, 80);
      if (p.legs) o.l = r3(p.legs);
      if (p.locked) o.k = 1;
      return o;
    }).sort((a, b) => order(a.t) - order(b.t));
    return { format: FORMAT, version: 1, name: String(name).slice(0, 60), grid: G, count: pieces.length, cost: this.cost(pieces), pieces };
  }

  cost(pieces) {
    const total = {};
    for (const p of pieces) for (const [id, n] of Object.entries(PIECE[p.t].cost || {})) total[id] = (total[id] || 0) + n;
    return total;
  }

  /** Save the current base as a file download. */
  exportFile(name) {
    const bp = this.capture(name);
    if (!bp) return { ok: false, msg: 'You have not built anything to save' };
    const blob = new Blob([JSON.stringify(bp)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${bp.name.replace(/[^a-z0-9_-]+/gi, '_') || 'base'}.blueprint.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    return { ok: true, msg: `Blueprint saved: ${bp.count} pieces`, blueprint: bp };
  }

  /** Validate untrusted blueprint data. Returns {ok, blueprint | msg}. */
  parse(data) {
    let o = data;
    if (typeof data === 'string') { try { o = JSON.parse(data); } catch { return { ok: false, msg: 'Not a blueprint file (invalid JSON)' }; } }
    if (!o || o.format !== FORMAT || !Array.isArray(o.pieces)) return { ok: false, msg: 'Not an Iron Veil blueprint file' };
    if (o.pieces.length > MAX_PIECES) return { ok: false, msg: `Blueprint too large (${o.pieces.length} pieces, limit ${MAX_PIECES})` };
    const pieces = [];
    let unknown = 0;
    for (const p of o.pieces) {
      if (!p || typeof p.t !== 'string' || !Object.prototype.hasOwnProperty.call(PIECE, p.t)) { unknown++; continue; }
      if (![p.x, p.y, p.z].every((v) => Number.isFinite(v) && Math.abs(v) < 400)) { unknown++; continue; }
      const q = { t: p.t, x: p.x, y: Math.max(0, Math.min(60, p.y)), z: p.z, r: ((p.r | 0) % 4 + 4) % 4 };
      if (Number.isFinite(p.g) && Math.abs(p.g) < 0.5) q.g = p.g;
      if (Number.isFinite(p.v)) q.v = Math.abs(p.v | 0) % 5;
      if (typeof p.s === 'string') q.s = p.s.slice(0, 80);
      if (Number.isFinite(p.l)) q.l = Math.max(0, Math.min(12, p.l));
      if (p.k) q.k = 1;
      pieces.push(q);
    }
    if (!pieces.length) return { ok: false, msg: 'The blueprint has no usable pieces' };
    pieces.sort((a, b) => order(a.t) - order(b.t));
    const bp = { format: FORMAT, version: 1, name: String(o.name || 'Imported base').slice(0, 60), count: pieces.length, cost: this.cost(pieces), pieces, skipped: unknown };
    return { ok: true, blueprint: bp };
  }

  load(data) {
    const r = this.parse(data);
    if (r.ok) this.loaded = r.blueprint;
    return r;
  }

  /** Inventories materials may come from: pockets, then own storage within 40 m. */
  _sources(x, z) {
    const g = this.game;
    const list = [g.player.equipment.inventory];
    for (const p of g.base.pieces.values()) if (p.inventory && !p.sentry && Math.hypot(p.x - x, p.z - z) < 40) list.push(p.inventory);
    return list;
  }

  /** What is still missing for a blueprint at (x, z): {id: n}. */
  missing(bp, x, z) {
    if (this.game.debug?.flags.freeBuild) return {};
    const src = this._sources(x, z);
    const out = {};
    for (const [id, n] of Object.entries(bp.cost)) {
      const have = src.reduce((a, inv) => a + inv.count(id), 0);
      if (have < n) out[id] = n - have;
    }
    return out;
  }

  /** Where the loaded blueprint would go: in front of the player, on the grid. */
  site(bp, turns = 0) {
    const g = this.game, pc = g.player.controller;
    let maxR = 0;
    for (const p of bp.pieces) maxR = Math.max(maxR, Math.hypot(p.x, p.z));
    const d = maxR + 4;
    const ax = Math.round((pc.pos.x - Math.sin(pc.yaw) * d) / G) * G, az = Math.round((pc.pos.z - Math.cos(pc.yaw) * d) / G) * G;
    return { x: ax, z: az, r: maxR, turns: ((turns | 0) % 4 + 4) % 4 };
  }

  /**
   * Build the blueprint. opts: {turns: quarter turns}. Returns {ok, msg, built}.
   * All or nothing on materials; pieces that would overlap something already built are
   * skipped (and their materials are not taken).
   */
  build(bp = this.loaded, opts = {}) {
    const g = this.game, base = g.base;
    if (!bp) return { ok: false, msg: 'No blueprint loaded' };
    const S = this.site(bp, opts.turns || 0);
    const w = g.world;
    // site checks: dry, not on a road or inside a location, ground within 2 m across the footprint
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      for (const rr of [0, 0.5, 1]) {
        const x = S.x + Math.cos(a) * S.r * rr, z = S.z + Math.sin(a) * S.r * rr;
        if (w.waterAt(x, z) !== null) return { ok: false, msg: 'Blueprint site is in water — stand somewhere dry and face open ground' };
        const hgt = w.heightAt(x, z);
        mn = Math.min(mn, hgt); mx = Math.max(mx, hgt);
      }
    }
    if (mx - mn > 4) return { ok: false, msg: `Ground too uneven for this blueprint (${(mx - mn).toFixed(1)} m of fall across ${Math.round(S.r * 2)} m). Find flatter ground.` };
    const near = w.nearestPOI(S.x, S.z);
    if (near.poi && near.d < near.poi.radius + S.r) return { ok: false, msg: `Too close to ${near.poi.name}` };
    const rot = (p) => {
      // quarter turns about the anchor (same convention as piece rotation)
      let x = p.x, z = p.z;
      for (let k = 0; k < S.turns; k++) [x, z] = [z, -x];
      return { x: S.x + x, z: S.z + z, r: (p.r + S.turns) % 4 };
    };
    const baseY = mx; // sit on the highest ground; foundations get legs down to the rest
    const todo = [];
    for (const p of bp.pieces) {
      const q = rot(p);
      const y = p.g !== undefined ? w.heightAt(q.x, q.z) + p.g : baseY + p.y;
      let clash = false;
      for (const e of base.pieces.values()) if (e.type === p.t && Math.abs(e.x - q.x) < 0.25 && Math.abs(e.z - q.z) < 0.25 && Math.abs(e.y - y) < 0.25) { clash = true; break; }
      if (!clash) todo.push({ p, q, y });
    }
    if (!todo.length) return { ok: false, msg: 'Everything in this blueprint is already built here' };
    const need = this.cost(todo.map((t) => t.p));
    const miss = this.missing({ cost: need }, S.x, S.z);
    if (Object.keys(miss).length) {
      const txt = Object.entries(miss).map(([id, n]) => `${n}× ${ItemDB.get(id)?.name || id}`).join(', ');
      return { ok: false, msg: `Missing materials: ${txt}`, missing: miss };
    }
    if (!g.debug?.flags.freeBuild) {
      const src = this._sources(S.x, S.z);
      for (const [id, n] of Object.entries(need)) {
        let left = n;
        for (const inv of src) { if (left <= 0) break; const take = Math.min(left, inv.count(id)); if (take > 0) left -= inv.remove(id, take); }
      }
    }
    let built = 0;
    const made = new Map();
    for (const { p, q, y } of todo) {
      const def = PIECE[p.t];
      const ground = w.heightAt(q.x, q.z);
      const rec = { id: uid('bp'), type: p.t, x: q.x, y, z: q.z, rot: q.r, health: def.health, variant: p.v || 0, text: p.s, locked: !!p.k };
      if (p.t === 'foundation') rec.legs = Math.max(p.l || 0, y - ground);
      try {
        const piece = base._create(rec);
        if (p.s && base.setSignText) base.setSignText(piece, p.s);
        made.set(`${Math.round(q.x * 4)}|${Math.round(q.z * 4)}|${Math.round(y * 4)}|${p.t}`, piece);
        // doors attach to the doorway at the same spot
        if (def.snap === 'door') for (const e of base.pieces.values()) if (/doorway/.test(e.type) && !e.door && Math.abs(e.x - q.x) < 0.3 && Math.abs(e.z - q.z) < 0.3 && Math.abs(e.y - y) < 0.3) { e.door = piece; piece.doorway = e; break; }
        built++;
      } catch (e) { console.error('[Blueprint] piece failed', p.t, e); }
    }
    bus.emit('sound', { type: 'build', x: S.x, y: baseY, z: S.z });
    bus.emit('base:changed', {});
    g.player.skills?.gain('construction', Math.min(30, built));
    return { ok: true, msg: `Built ${built} pieces from “${bp.name}”${todo.length < bp.pieces.length ? ` (${bp.pieces.length - todo.length} already there)` : ''}`, built, site: S };
  }
}
