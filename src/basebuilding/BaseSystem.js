import * as THREE from 'three';
import buildingData from '../data/building.json';
import { buildPieceMesh, pieceColliders, pieceBounds } from './PieceModels.js';
import { Inventory } from '../items/Inventory.js';
import { ItemDB } from '../items/ItemDatabase.js';
import { bus } from '../core/EventBus.js';
import { uid } from '../core/MathUtil.js';

// Player base construction: placement preview with snapping (3 m grid foundations,
// edge-snapped walls, supported floors), validation (cost, tools, slope, overlap,
// protected areas), structural support on destruction, doors/gates/storage, repair,
// dismantling, raid helpers and persistence.

export const PIECES = buildingData.pieces;
export const PIECE = Object.fromEntries(PIECES.map((p) => [p.id, p]));
const G = buildingData.grid;
const WALL_TYPES = new Set(['wall', 'wall_reinforced', 'doorway', 'window_wall', 'firing_wall', 'gate']);
const SUPPORT_TYPES = new Set(['foundation', 'floor']);

const cellOf = (v) => Math.floor(v / G);
const cellCenter = (i) => i * G + G / 2;

export class BaseSystem {
  constructor(game) {
    this.game = game;
    this.pieces = new Map();
    this.discoveredBy = new Set();
    this.group = new THREE.Group();
    this.group.name = 'base';
    game.renderer.scene.add(this.group);
    this.active = false;
    this.selected = null;
    this.rot = 0;
    this.ghost = null;
    this.ghostType = null;
    this.placement = null;
    this.ghostOk = new THREE.MeshBasicMaterial({ color: 0x6fd07a, transparent: true, opacity: 0.38, depthWrite: false });
    this.ghostBad = new THREE.MeshBasicMaterial({ color: 0xe0574a, transparent: true, opacity: 0.38, depthWrite: false });
    this.lastRaid = -1e9;
  }

  // ------------------------------------------------------------ build mode
  enter(type) {
    this.active = true;
    this.select(type || this.selected || 'foundation');
  }

  exit() {
    this.active = false;
    this._clearGhost();
    this.placement = null;
  }

  select(type) {
    if (!PIECE[type]) return;
    this.selected = type;
    this._clearGhost();
  }

  rotate() {
    this.rot = (this.rot + 1) % 4;
  }

  _clearGhost() {
    if (this.ghost) {
      this.group.remove(this.ghost);
      this.ghost.geometry.dispose();
      this.ghost = null;
      this.ghostType = null;
    }
  }

  _ensureGhost(type, legs) {
    const key = `${type}:${legs ? legs.toFixed(1) : ''}`;
    if (this.ghost && this.ghostType === key) return;
    this._clearGhost();
    const m = buildPieceMesh(type === 'door' ? 'door' : type, this.game.materials, { legs });
    m.material = this.ghostOk;
    m.renderOrder = 10;
    m.castShadow = false;
    this.ghost = m;
    this.ghostType = key;
    this.group.add(m);
  }

  /** Update preview from the camera ray. Returns placement info for the UI. */
  updatePreview(eye, dir) {
    if (!this.active || !this.selected) return null;
    const type = this.selected;
    const def = PIECE[type];
    const hit = this.game.physics.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 7, (c) => c.blocksMove && c.tag !== 'character');
    const t = hit ? hit.t : 5;
    const aim = { x: eye.x + dir.x * t, y: eye.y + dir.y * t, z: eye.z + dir.z * t };
    let p = null;
    if (def.snap === 'foundation') p = this._snapFoundation(aim);
    else if (def.snap === 'wall') p = this._snapWall(aim);
    else if (def.snap === 'door') p = this._snapDoor(aim);
    else if (def.snap === 'floor') p = this._snapFloor(aim);
    else if (def.snap === 'cell') p = this._snapCell(aim);
    else p = this._snapFree(aim, hit);
    if (!p) { if (this.ghost) this.ghost.visible = false; this.placement = null; return { ok: false, reason: 'Aim at a valid surface', def }; }
    p.type = type;
    const reason = p.reason || this._validate(p, def);
    p.ok = !reason;
    p.reason = reason;
    this._ensureGhost(type, p.legs);
    this.ghost.visible = true;
    this.ghost.position.set(p.x, p.y, p.z);
    this.ghost.rotation.y = (p.rot * Math.PI) / 2;
    this.ghost.material = p.ok ? this.ghostOk : this.ghostBad;
    this.placement = p;
    return { ok: p.ok, reason, def };
  }

  _protected(x, z) {
    for (const poi of this.game.world.pois) if (Math.hypot(x - poi.x, z - poi.z) < poi.radius * 0.95) return poi;
    const r = this.game.world.roadQuery(x, z);
    if (r && r.d < r.width * 0.5 + 1) return { name: 'the road' };
    return null;
  }

  _snapFoundation(aim) {
    const ix = cellOf(aim.x), iz = cellOf(aim.z);
    const x = cellCenter(ix), z = cellCenter(iz);
    // terrain range under the cell
    let mn = Infinity, mx = -Infinity;
    for (const [ox, oz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4], [0, 0]]) {
      const h = this.game.world.heightAt(x + ox, z + oz);
      mn = Math.min(mn, h); mx = Math.max(mx, h);
    }
    let top = mx + 0.35;
    // match a neighbouring foundation's height to keep floors level
    for (const n of this._foundationsNear(x, z, 3.2)) {
      if (Math.abs(n.y - top) < 1.0) { top = n.y; break; }
    }
    const p = { x, y: top, z, rot: 0, ix, iz, legs: top - mn, level: 0 };
    if (this._findAt('foundation', x, z, top, 0.5)) p.reason = 'Cell already has a foundation';
    else if (mx - mn > 2.2) p.reason = 'Ground too steep';
    else if (top - mn > 2.8) p.reason = 'Too high above the ground';
    else if (top < mx + 0.05) p.reason = 'Terrain intersects the foundation';
    return p;
  }

  _foundationsNear(x, z, r) {
    const out = [];
    for (const pc of this.pieces.values()) if (pc.type === 'foundation' && Math.hypot(pc.x - x, pc.z - z) < r) out.push(pc);
    return out;
  }

  _findAt(type, x, z, y, tol = 0.3) {
    for (const pc of this.pieces.values()) {
      if (pc.type !== type) continue;
      if (Math.abs(pc.x - x) < tol && Math.abs(pc.z - z) < tol && Math.abs(pc.y - y) < 1.0) return pc;
    }
    return null;
  }

  _supports() {
    return [...this.pieces.values()].filter((p) => SUPPORT_TYPES.has(p.type));
  }

  _edges(s) {
    // edge midpoints of a support cell: [x, z, rot]
    return [[s.x, s.z - G / 2, 0], [s.x, s.z + G / 2, 0], [s.x - G / 2, s.z, 1], [s.x + G / 2, s.z, 1]];
  }

  _wallAt(x, z, y) {
    for (const pc of this.pieces.values()) {
      if (!WALL_TYPES.has(pc.type)) continue;
      if (Math.abs(pc.x - x) < 0.3 && Math.abs(pc.z - z) < 0.3 && Math.abs(pc.y - y) < 0.6) return pc;
    }
    return null;
  }

  _snapWall(aim) {
    let best = null, bd = 2.6;
    for (const s of this._supports()) {
      if (Math.hypot(s.x - aim.x, s.z - aim.z) > 5) continue;
      for (const [x, z, rot] of this._edges(s)) {
        const d = Math.hypot(x - aim.x, z - aim.z) + Math.abs(s.y + 1.5 - aim.y) * 0.4;
        if (d < bd) { bd = d; best = { x, y: s.y, z, rot, support: s }; }
      }
    }
    if (!best) return null;
    if (this._wallAt(best.x, best.z, best.y)) best.reason = 'Edge already has a wall';
    return best;
  }

  _snapDoor(aim) {
    let best = null, bd = 3;
    for (const pc of this.pieces.values()) {
      if (pc.type !== 'doorway') continue;
      const d = Math.hypot(pc.x - aim.x, pc.z - aim.z);
      if (d < bd) { bd = d; best = pc; }
    }
    if (!best) return null;
    const p = { x: best.x, y: best.y, z: best.z, rot: best.rot, doorway: best };
    if (best.door) p.reason = 'Doorway already has a door';
    return p;
  }

  _snapFloor(aim) {
    // candidate cells above supports that have walls, or next to existing floors
    const cands = [];
    for (const s of this._supports()) {
      if (Math.hypot(s.x - aim.x, s.z - aim.z) > 7) continue;
      const hasWall = this._edges(s).some(([x, z]) => this._wallAt(x, z, s.y));
      if (hasWall) cands.push({ x: s.x, z: s.z, y: s.y + 3.0 });
      if (s.type === 'floor') for (const [dx, dz] of [[G, 0], [-G, 0], [0, G], [0, -G]]) cands.push({ x: s.x + dx, z: s.z + dz, y: s.y, cantilever: true });
    }
    let best = null, bd = Infinity;
    for (const c of cands) {
      const d = Math.hypot(c.x - aim.x, c.z - aim.z) + Math.abs(c.y - aim.y) * 0.5;
      if (d < bd) { bd = d; best = c; }
    }
    if (!best || bd > 4) return null;
    const p = { x: best.x, y: best.y, z: best.z, rot: 0 };
    if (this._findAt('floor', p.x, p.z, p.y, 0.3) || this._findAt('foundation', p.x, p.z, p.y, 0.3)) p.reason = 'Cell already built';
    else if (!this._floorSupported(p.x, p.z, p.y)) p.reason = 'Needs a wall below or an adjacent floor';
    return p;
  }

  _floorSupported(x, z, y, ignore = null) {
    const s = { x, z };
    if (this._edges(s).some(([ex, ez]) => { const w = this._wallAt(ex, ez, y - 3.0); return w && w !== ignore; })) return true;
    for (const [dx, dz] of [[G, 0], [-G, 0], [0, G], [0, -G]]) {
      const f = this._findAt('floor', x + dx, z + dz, y, 0.3);
      if (f && f !== ignore && this._edges(f).some(([ex, ez]) => { const w = this._wallAt(ex, ez, y - 3.0); return w && w !== ignore; })) return true;
    }
    return false;
  }

  _snapCell(aim) {
    let best = null, bd = 2.5;
    for (const s of this._supports()) {
      const d = Math.hypot(s.x - aim.x, s.z - aim.z);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) return null;
    const p = { x: best.x, y: best.y, z: best.z, rot: this.rot };
    for (const pc of this.pieces.values()) if (pc.type === 'stairs' && Math.abs(pc.x - p.x) < 0.3 && Math.abs(pc.z - p.z) < 0.3 && Math.abs(pc.y - p.y) < 0.5) p.reason = 'Cell already has stairs';
    return p;
  }

  _snapFree(aim, hit) {
    if (!hit) return null;
    // surface must be roughly flat
    let y = aim.y;
    if (hit.collider === null) {
      const n = this.game.world.normalAt(aim.x, aim.z);
      if (n.y < 0.75) return { x: aim.x, y, z: aim.z, rot: this.rot, reason: 'Surface too steep' };
      y = this.game.world.heightAt(aim.x, aim.z);
    } else if (aim.y < hit.collider.maxY - 0.05) {
      return { x: aim.x, y, z: aim.z, rot: this.rot, reason: 'Place on top of a flat surface' };
    } else y = hit.collider.maxY;
    const type = this.selected;
    if (type === 'ladder') {
      // ladders lean against a wall: face away from the wall we hit
      return { x: aim.x, y: hit.collider === null ? y : y, z: aim.z, rot: this.rot };
    }
    return { x: Math.round(aim.x * 4) / 4, y, z: Math.round(aim.z * 4) / 4, rot: this.rot };
  }

  _validate(p, def) {
    const player = this.game.player;
    const eye = this.game.renderer.camera.position;
    if (Math.hypot(p.x - eye.x, p.z - eye.z) > 7.5) return 'Too far away';
    const prot = this._protected(p.x, p.z);
    if (prot && def.snap !== 'door') return `Cannot build inside ${prot.name}`;
    if (this.game.world.waterAt(p.x, p.z) !== null && def.snap !== 'wall') return 'Cannot build on water';
    // overlap with world / other pieces
    const [bw, bd, bh] = pieceBounds(p.type);
    const [W, D] = p.rot % 2 ? [bd, bw] : [bw, bd];
    if (def.snap === 'free' || def.snap === 'foundation') {
      const shrink = 0.08;
      const y0 = def.snap === 'foundation' ? p.y - 0.35 : p.y + 0.05;
      const y1 = p.y + bh;
      const list = this.game.physics.query(p.x - W / 2 + shrink, p.z - D / 2 + shrink, p.x + W / 2 - shrink, p.z + D / 2 - shrink, []);
      for (const c of list) {
        if (!c.blocksMove || c.maxY <= y0 + 0.02 || c.minY >= y1) continue;
        if (def.snap === 'foundation' && c.owner && String(c.owner).startsWith('base:') && c.maxY <= p.y + 0.01) continue;
        if (c.tag === 'character') continue;
        return 'Blocked by an obstacle';
      }
      // player standing inside?
      const pp = player.controller.pos;
      if (pp.x > p.x - W / 2 - 0.3 && pp.x < p.x + W / 2 + 0.3 && pp.z > p.z - D / 2 - 0.3 && pp.z < p.z + D / 2 + 0.3 && pp.y < y1 && pp.y + 1.8 > y0 && bh > 0.5) return 'You are in the way';
    }
    // cost and tools
    const inv = player.equipment.inventory;
    const missing = [];
    for (const [id, n] of Object.entries(def.cost)) if (inv.count(id) < n) missing.push(`${ItemDB.get(id).name} ${inv.count(id)}/${n}`);
    if (def.tool && inv.count(def.tool) < 1) missing.push(`Tool: ${ItemDB.get(def.tool).name}`);
    if (missing.length) return `Missing: ${missing.join(', ')}`;
    return null;
  }

  /** Try to place the current preview. Materials are consumed only on success. */
  place() {
    const p = this.placement;
    if (!p) return { ok: false, msg: 'Nothing to place' };
    const def = PIECE[p.type];
    const reason = this._validate(p, def);
    if (reason || p.reason) return { ok: false, msg: reason || p.reason };
    const inv = this.game.player.equipment.inventory;
    if (!inv.consume(def.cost)) return { ok: false, msg: 'Missing materials' };
    let piece;
    try {
      piece = this._create({ id: uid('bp'), type: p.type, x: p.x, y: p.y, z: p.z, rot: p.rot, health: def.health, legs: p.legs });
    } catch (e) {
      // refund on unexpected failure
      for (const [id, n] of Object.entries(def.cost)) inv.add({ id, qty: n });
      console.error('[Base] placement failed', e);
      return { ok: false, msg: 'Placement failed' };
    }
    if (p.doorway) { p.doorway.door = piece; piece.doorway = p.doorway; }
    bus.emit('sound', { type: 'build', x: p.x, y: p.y, z: p.z });
    bus.emit('noise', { x: p.x, y: p.y, z: p.z, radius: 60, source: this.game.player.character, type: 'door' });
    bus.emit('base:changed', { added: piece });
    this.game.player.skills?.gain('construction', 1);
    return { ok: true, piece };
  }

  // ------------------------------------------------------------ piece lifecycle
  _create(rec) {
    if (this.pieces.has(rec.id)) return this.pieces.get(rec.id);
    const def = PIECE[rec.type];
    const piece = {
      id: rec.id, type: rec.type, def, x: rec.x, y: rec.y, z: rec.z, rot: rec.rot | 0,
      health: Math.min(def.health, rec.health ?? def.health), maxHealth: def.health, alive: true,
      colliders: [], interact: null, open: !!rec.open, locked: !!rec.locked, legs: rec.legs || 0.6, lit: rec.lit ?? true,
    };
    const owner = `base:${piece.id}`;
    const theta = (piece.rot * Math.PI) / 2;
    if (rec.type !== 'door') {
      const mesh = buildPieceMesh(rec.type, this.game.materials, { legs: piece.legs });
      mesh.position.set(piece.x, piece.y, piece.z);
      mesh.rotation.y = theta;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      piece.mesh = mesh;
    }
    const c = Math.round(Math.cos(theta)), s = Math.round(Math.sin(theta));
    const toWorld = (lx, lz) => [piece.x + lx * c + lz * s, piece.z - lx * s + lz * c];
    const addBox = (lx, ly, lz, w, h, d, opts = {}) => {
      const [wx, wz] = toWorld(lx, lz);
      const [W, D] = piece.rot % 2 ? [d, w] : [w, d];
      const col = this.game.physics.addBox(wx - W / 2, piece.y + ly - h / 2, wz - D / 2, wx + W / 2, piece.y + ly + h / 2, wz + D / 2,
        { material: def.material === 'metal' ? 'metal' : def.material === 'sand' ? 'sand' : 'wood', owner, ...opts });
      col.piece = piece;
      col.onBulletHit = (dmg, shot) => this.damagePiece(piece, dmg * (def.material === 'metal' ? 0.35 : def.material === 'sand' ? 0.25 : 0.6), shot);
      piece.colliders.push(col);
      return col;
    };
    for (const b of pieceColliders(rec.type)) addBox(b[0], b[1], b[2], b[3], b[4], b[5], b[6] || {});
    if (rec.type === 'stairs') {
      for (let i = 0; i < 12; i++) addBox(0, (i + 1) * 0.25 - 0.06, 1.3 - i * 0.24, 1.2, 0.12, 0.26);
    }
    if (rec.type === 'ladder') {
      const [wx, wz] = toWorld(0, 0.35);
      piece.ladder = this.game.physics.addLadder(wx, wz, piece.y, piece.y + 3.1, s, c, owner);
    }
    if (rec.type === 'watchtower') {
      const [wx, wz] = toWorld(-0.7, 1.4);
      piece.ladder = this.game.physics.addLadder(wx, wz, piece.y, piece.y + 4.45, s, c, owner);
    }
    if (rec.type === 'door' || rec.type === 'gate') this._makeLeaves(piece, toWorld, addBox);
    // storage
    if (def.storage) {
      const id = `base:${piece.id}`;
      piece.inventory = this.game.loot.get(id) || this.game.loot.register(id, new Inventory(def.storage, def.name), { meta: { base: true } });
    }
    this._makeInteract(piece);
    if (def.light) {
      piece.lightSource = { x: piece.x, y: piece.y + (rec.type === 'lamp' ? 1.7 : 0.6), z: piece.z, color: rec.type === 'lamp' ? 0xffe0b0 : 0xff9a40, intensity: rec.type === 'lamp' ? 6 : 9, range: rec.type === 'lamp' ? 16 : 14, active: () => piece.alive && piece.lit, flicker: rec.type === 'campfire' };
      this.game.lights?.add(piece.lightSource);
      if (rec.type === 'campfire') this.game.fires?.push({ x: piece.x, y: piece.y + 0.2, z: piece.z, active: () => piece.alive && piece.lit, piece });
    }
    this.pieces.set(piece.id, piece);
    return piece;
  }

  _makeLeaves(piece, toWorld, addBox) {
    const theta = (piece.rot * Math.PI) / 2;
    piece.leaves = [];
    const leafType = piece.type === 'gate' ? 'gateLeaf' : 'door';
    const hinges = piece.type === 'gate' ? [[-1.42, 1], [1.42, -1]] : [[-0.575, 1]];
    for (const [hx, dirSign] of hinges) {
      const pivot = new THREE.Group();
      const [wx, wz] = toWorld(hx, 0);
      pivot.position.set(wx, piece.y, wz);
      const leaf = buildPieceMesh(leafType, this.game.materials);
      leaf.castShadow = true;
      if (dirSign < 0) { leaf.scale.x = -1; }
      pivot.add(leaf);
      pivot.rotation.y = theta;
      pivot.userData.base = theta;
      pivot.userData.sign = dirSign;
      this.group.add(pivot);
      piece.leaves.push(pivot);
    }
    // closed-state collider spanning the opening
    const w = piece.type === 'gate' ? 2.7 : 1.15;
    piece.leafCollider = addBox(0, piece.type === 'gate' ? 1.3 : 1.08, 0, w, piece.type === 'gate' ? 2.6 : 2.15, 0.12, { tag: 'basedoor' });
    piece.leafCollider.enabled = !piece.open;
    this._poseLeaves(piece, true);
  }

  _poseLeaves(piece, instant = false) {
    if (!piece.leaves) return;
    for (const pv of piece.leaves) {
      pv.userData.target = pv.userData.base + (piece.open ? pv.userData.sign * -1.5 : 0);
      if (instant) pv.rotation.y = pv.userData.target;
    }
  }

  toggleDoor(piece, open) {
    if (!piece.leaves) return;
    if (open === undefined) open = !piece.open;
    if (open && piece.locked && arguments.length > 1) return;
    piece.open = open;
    piece.leafCollider.enabled = !open;
    this._poseLeaves(piece);
    bus.emit('sound', { type: 'door', x: piece.x, y: piece.y + 1, z: piece.z, open, npc: true });
  }

  _makeInteract(piece) {
    const def = piece.def;
    const it = { id: `basei:${piece.id}`, x: piece.x, y: piece.y + 1.0, z: piece.z, radius: 1.6, data: { piece } };
    if (def.storage) {
      it.kind = 'container';
      it.label = () => `${piece.locked ? 'Locked ' : ''}${def.name}${def.lockable ? '  [F] ' + (piece.locked ? 'unlock' : 'lock') : ''}`;
      it.data = { containerId: `base:${piece.id}`, name: def.name, custom: true, piece };
      it.y = piece.y + 0.6;
    } else if (piece.type === 'door' || piece.type === 'gate') {
      it.kind = 'basedoor';
      it.label = () => `${piece.open ? 'Close' : 'Open'} ${piece.type}${piece.locked ? ' (locked)' : ''}  [F] ${piece.locked ? 'unlock' : 'lock'}`;
      it.y = piece.y + 1.1;
      it.priority = 1;
    } else if (piece.type === 'workbench') {
      it.kind = 'workbench'; it.label = 'Use workbench'; it.y = piece.y + 1;
    } else if (piece.type === 'bedroll') {
      it.kind = 'bedroll'; it.label = 'Bedroll — respawn point set'; it.y = piece.y + 0.2;
    } else if (piece.type === 'lamp' || piece.type === 'campfire') {
      it.kind = 'toggleLight'; it.label = () => (piece.lit ? `Extinguish ${def.name.toLowerCase()}` : `Light ${def.name.toLowerCase()}`); it.y = piece.y + 0.5;
    } else return;
    piece.interact = this.game.interactables.add(it);
  }

  damagePiece(piece, dmg) {
    if (!piece.alive || dmg <= 0) return;
    piece.health -= dmg;
    if (piece.health <= 0) this.destroy(piece, true);
  }

  destroy(piece, violent = false) {
    if (!piece.alive) return;
    piece.alive = false;
    this.pieces.delete(piece.id);
    if (piece.mesh) { this.group.remove(piece.mesh); piece.mesh.geometry.dispose(); }
    if (piece.leaves) for (const l of piece.leaves) { this.group.remove(l); l.traverse((o) => o.geometry?.dispose()); }
    for (const c of piece.colliders) this.game.physics.remove(c);
    if (piece.ladder) this.game.physics.removeLadder(piece.ladder);
    if (piece.interact) this.game.interactables.remove(piece.interact);
    if (piece.lightSource) this.game.lights?.remove(piece.lightSource);
    if (this.game.fires) this.game.fires = this.game.fires.filter((f) => f.piece !== piece);
    if (piece.inventory) {
      // spill storage contents on the ground
      const inv = piece.inventory;
      if (inv.usedSlots()) this.game.dropInventory(inv, { x: piece.x, y: piece.y, z: piece.z }, `${piece.def.name} remains`);
      this.game.loot.remove(`base:${piece.id}`);
    }
    if (piece.doorway) piece.doorway.door = null;
    if (piece.door) this.destroy(piece.door, violent);
    if (violent) {
      this.game.effects.emit(piece.x, piece.y + 1, piece.z, { color: [0.45, 0.35, 0.25], count: 30, speed: 3, size: 0.2, life: 1.2, gravity: 5, alpha: 0.9 });
      bus.emit('sound', { type: 'collapse', x: piece.x, y: piece.y, z: piece.z });
      bus.emit('notify', { text: `${piece.def.name} destroyed`, kind: 'warn' });
    }
    this._checkSupport();
    bus.emit('base:changed', { removed: piece });
  }

  _checkSupport() {
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 10) {
      changed = false;
      for (const pc of [...this.pieces.values()]) {
        let ok = true;
        if (WALL_TYPES.has(pc.type)) {
          ok = this._supports().some((s) => Math.abs(s.y - pc.y) < 0.3 && this._edges(s).some(([x, z]) => Math.abs(x - pc.x) < 0.3 && Math.abs(z - pc.z) < 0.3));
        } else if (pc.type === 'floor') ok = this._floorSupported(pc.x, pc.z, pc.y);
        else if (pc.type === 'door') ok = !!pc.doorway && pc.doorway.alive;
        else if (pc.type === 'stairs') ok = this._supports().some((s) => Math.abs(s.x - pc.x) < 0.3 && Math.abs(s.z - pc.z) < 0.3 && Math.abs(s.y - pc.y) < 0.3);
        if (!ok) { this.destroy(pc, true); changed = true; }
      }
    }
  }

  repair(piece) {
    if (piece.health >= piece.maxHealth) return { ok: false, msg: 'Already at full condition' };
    const inv = this.game.player.equipment.inventory;
    const frac = buildingData.repair.structureFraction;
    const cost = {};
    for (const [id, n] of Object.entries(piece.def.cost)) cost[id] = Math.max(1, Math.ceil(n * frac));
    if (piece.def.tool && inv.count(piece.def.tool) < 1) return { ok: false, msg: `Requires ${ItemDB.get(piece.def.tool).name}` };
    if (!inv.consume(cost)) return { ok: false, msg: `Repair needs ${Object.entries(cost).map(([k, v]) => `${v} ${ItemDB.get(k).name}`).join(', ')}` };
    piece.health = piece.maxHealth;
    bus.emit('sound', { type: 'build', x: piece.x, y: piece.y, z: piece.z });
    return { ok: true, msg: `${piece.def.name} repaired` };
  }

  dismantle(piece) {
    if (piece.inventory && piece.inventory.usedSlots()) return { ok: false, msg: 'Empty the storage first' };
    const refund = {};
    for (const [id, n] of Object.entries(piece.def.cost)) refund[id] = Math.floor(n * 0.5 * (piece.health / piece.maxHealth));
    this.destroy(piece, false);
    const inv = this.game.player.equipment.inventory;
    for (const [id, n] of Object.entries(refund)) {
      if (n <= 0) continue;
      const left = inv.add({ id, qty: n });
      if (left) this.game.dropItem({ id, qty: left });
    }
    return { ok: true, msg: `${piece.def.name} dismantled` };
  }

  pieceAt(eye, dir) {
    const hit = this.game.physics.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 5, (c) => !!c.piece);
    return hit?.collider?.piece || null;
  }

  // ------------------------------------------------------------ queries for other systems
  center() {
    if (!this.pieces.size) return null;
    let x = 0, y = 0, z = 0, n = 0;
    for (const p of this.pieces.values()) { x += p.x; y += p.y; z += p.z; n++; }
    return { x: x / n, y: y / n, z: z / n };
  }

  respawnPoint() {
    for (const p of this.pieces.values()) if (p.type === 'bedroll') return { x: p.x + 0.8, y: p.y + 0.2, z: p.z };
    return null;
  }

  nearestStorage(pos, r, unlockedOnly) {
    let best = null, bd = r;
    for (const p of this.pieces.values()) {
      if (!p.inventory || (unlockedOnly && p.locked) || !p.inventory.usedSlots()) continue;
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  breachPoint(from, base) {
    let best = null, bd = Infinity;
    for (const p of this.pieces.values()) {
      if (!(WALL_TYPES.has(p.type) || p.type === 'door')) continue;
      const d = Math.hypot(p.x - from.x, p.z - from.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return null;
    // outward normal toward the attacker
    let nx = best.rot % 2 ? 1 : 0, nz = best.rot % 2 ? 0 : 1;
    if ((from.x - best.x) * nx + (from.z - best.z) * nz < 0) { nx = -nx; nz = -nz; }
    void base;
    return { x: best.x, y: best.y, z: best.z, nx, nz, piece: best, get alive() { return best.alive; } };
  }

  isSheltered(pos) {
    const hit = this.game.physics.raycast(pos.x, pos.y + 1.7, pos.z, 0, 1, 0, 15, (c) => c.blocksMove && c.tag !== 'character', false);
    return !!hit;
  }

  update(dt) {
    for (const p of this.pieces.values()) {
      if (!p.leaves) continue;
      for (const pv of p.leaves) {
        const t = pv.userData.target;
        if (t === undefined) continue;
        const d = t - pv.rotation.y;
        if (Math.abs(d) > 0.001) pv.rotation.y += Math.sign(d) * Math.min(Math.abs(d), dt * 3);
      }
    }
  }

  // ------------------------------------------------------------ persistence
  serialize() {
    return {
      pieces: [...this.pieces.values()].map((p) => ({ id: p.id, type: p.type, x: p.x, y: p.y, z: p.z, rot: p.rot, health: Math.round(p.health), open: p.open, locked: p.locked, legs: p.legs, lit: p.lit, doorway: p.doorway?.id || null })),
      discoveredBy: [...this.discoveredBy],
      lastRaid: this.lastRaid,
    };
  }

  clear() {
    for (const p of [...this.pieces.values()]) {
      p.inventory = null; // keep loot entries; they are reset with the loot system
      this.destroy(p, false);
    }
    this.pieces.clear();
    this.discoveredBy.clear();
  }

  deserialize(o) {
    this.clear();
    if (!o || !Array.isArray(o.pieces)) return;
    // supports first, then walls, then doors, then the rest
    const order = (t) => (t === 'foundation' ? 0 : t === 'floor' ? 2 : WALL_TYPES.has(t) ? 1 : t === 'door' ? 3 : 4);
    const recs = o.pieces.filter((r) => r && PIECE[r.type] && Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.z)).sort((a, b) => order(a.type) - order(b.type));
    const seen = new Set();
    for (const r of recs) {
      if (seen.has(r.id)) continue; // never spawn duplicates
      seen.add(r.id);
      const p = this._create(r);
      if (r.type === 'door' && r.doorway && this.pieces.get(r.doorway)) { p.doorway = this.pieces.get(r.doorway); p.doorway.door = p; }
    }
    for (const f of o.discoveredBy || []) this.discoveredBy.add(f);
    this.lastRaid = Number.isFinite(o.lastRaid) ? o.lastRaid : -1e9;
  }
}
