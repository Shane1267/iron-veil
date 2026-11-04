// The shared world an online server simulates: terrain, buildings, doors, terrain-prop
// colliders, AI, ballistics, factions, time and weather — the same modules the browser
// game uses, without a renderer. Buildings and props are built around every connected
// player and dropped when nobody is near.
import * as THREE from 'three';
import { WorldData } from '../src/world/WorldData.js';
import { PhysicsWorld } from '../src/engine/PhysicsWorld.js';
import { POIManager, addDoorCollider } from '../src/world/POIManager.js';
import { Characters } from '../src/combat/Characters.js';
import { Ballistics } from '../src/weapons/Ballistics.js';
import { FactionManager } from '../src/ai/FactionManager.js';
import { AIManager } from '../src/ai/AIManager.js';
import { LootSystem } from '../src/items/LootSystem.js';
import { GameClock } from '../src/core/GameClock.js';
import { WeatherSystem } from '../src/world/WeatherSystem.js';
import { generateChunk, VEG_TYPES } from '../src/world/ChunkGenerator.js';
import { bus } from '../src/core/EventBus.js';

const noop = () => {};
const EFFECTS = { impact: noop, splash: noop, decal: noop, blood: noop, tracer: noop, worldFlash: noop, muzzle: noop };
const SCENE = { add: noop, remove: noop };

const POI_IN = 650; // build locations this close to a player (AI garrisons spawn within 480 m)
const POI_OUT = 900;
const PROP_CHUNK = 128;
const PROP_IN = 420; // tree and rock colliders this close to a player
const PROP_OUT = 600;

/** A door without a mesh: same collider and toggle surface the AI uses. */
class HeadlessDoor {
  constructor(def, physics, owner, id) {
    this.def = def;
    this.id = id;
    this.open = !!def.open;
    const dc = addDoorCollider(def, physics, owner);
    this.collider = dc.collider;
    this.collider.door = this;
    this.collider.enabled = !this.open;
    this.center = dc.center;
  }
  toggle(force, remote = false) {
    const was = this.open;
    this.open = force !== undefined ? force : !this.open;
    this.collider.enabled = !this.open;
    if (was !== this.open) bus.emit('door:toggled', { id: this.id, open: this.open, remote });
    return this.open;
  }
  update() {}
}

export class HeadlessGame {
  constructor(opts = {}) {
    this.opts = opts;
    const world = new WorldData();
    const physics = new PhysicsWorld(world);
    this.world = world;
    this.physics = physics;
    this.headless = true;
    this.time = 0;
    this.characters = new Characters();
    this.characters.pvp = !!opts.pvp;
    this.effects = EFFECTS;
    const vals = { aiDifficulty: opts.aiDifficulty ?? 1, eventFrequency: 0, viewDistance: 1200 };
    this.settings = { get: (k) => vals[k] };
    this.clock = new GameClock();
    this.weather = new WeatherSystem(SCENE);
    this.weather.rainCount = 0; // no rain particles to move on a server
    this.lighting = { ambientLevel: 1, nightFactor: 0 };
    this.loot = new LootSystem();
    this.interactables = { add: (o) => o, remove: noop, move: noop };
    this.renderer = { scene: SCENE, camera: { position: new THREE.Vector3() } };
    this.materials = {};
    this.base = null;
    this.vehicles = null;
    this.players = new Map(); // id -> NetPlayer
    // a stand-in local player keeps legacy code paths (sounds without a source) harmless
    this.player = { character: null, controller: { pos: new THREE.Vector3(0, -1e6, 0) } };
    this.factions = new FactionManager();
    this.ballistics = new Ballistics(physics, this.characters, EFFECTS, world, { onGlass: (pane) => { pane.broken = true; if (pane.collider) pane.collider.blocksShots = false; } });
    this.pois = new POIManager(SCENE, world, physics, { get: () => ({}), factory: {} }, this.interactables, {});
    this.pois.active = new Map();
    this.ai = new AIManager(this);
    this.doorState = new Map(); // door id -> open (only doors moved from their default)
    this.doors = new Map(); // door id -> HeadlessDoor (built locations only)
    this.propChunks = new Map(); // key -> [colliders]
    this.streamT = 0;
    bus.on('door:toggled', (e) => {
      const d = this.doors.get(e.id);
      if (!d) return;
      if (d.open === !!d.def.open) this.doorState.delete(e.id); else this.doorState.set(e.id, d.open);
    });
  }

  /** Positions the AI and streaming are centred on: every living, connected player. */
  observers() {
    const out = [];
    for (const p of this.players.values()) if (p.joined) out.push(p.pos);
    return out;
  }

  // ------------------------------------------------------------ world streaming
  _buildPoi(poi) {
    const pm = this.pois;
    pm._begin(poi);
    const job = pm.building;
    while (job.i < job.commands.length) {
      try { job.commands[job.i](); } catch (e) { if (!this._warned) { console.warn('[server] layout command failed in', poi.id, e.message); this._warned = true; } }
      job.i++;
    }
    pm.building = null;
    const owner = `poi:${poi.id}`;
    for (const gu of poi.guaranteed || []) if (job.ctx.containers[gu.container]) job.ctx.containers[gu.container].profile = gu.profile;
    job.ctx.containers.forEach((c, i) => { c.id = `${poi.id}:c${i}`; });
    const doors = job.ctx.doors.map((def, i) => {
      const id = `${poi.id}:d${i}`;
      const d = new HeadlessDoor(def, this.physics, owner, id);
      if (this.doorState.has(id)) { d.open = this.doorState.get(id); d.collider.enabled = !d.open; }
      this.doors.set(id, d);
      return d;
    });
    // windows: AI shoots through broken panes only
    for (const g of job.ctx.glass) if (g.collider && g.broken) g.collider.blocksShots = false;
    const rt = { poi, containers: job.ctx.containers, spots: job.ctx.spots, colliders: job.ctx.colliders, doors, buildings: job.ctx.buildings, glass: job.ctx.glass, lights: [], fires: [], ladders: job.ctx.ladders || [], interactables: [] };
    pm.active.set(poi.id, rt);
    bus.emit('poi:built', rt);
    return rt;
  }

  _unloadPoi(id) {
    const rt = this.pois.active.get(id);
    if (!rt) return;
    bus.emit('poi:unloading', rt);
    this.physics.removeOwner(`poi:${id}`);
    for (const d of rt.doors) this.doors.delete(d.id);
    this.pois.active.delete(id);
  }

  _propChunk(cx, cz) {
    const o = generateChunk(this.world, { x0: cx * PROP_CHUNK, z0: cz * PROP_CHUNK, size: PROP_CHUNK, segs: 8, veg: true, vegDensity: 1 });
    const v = o.veg, phys = this.physics, list = [];
    for (let i = 0; i < v.length; i += 6) {
      const t = VEG_TYPES[v[i]];
      const px = v[i + 1], py = v[i + 2], pz = v[i + 3], s = v[i + 5];
      if (t === 'pineA' || t === 'pineB' || t === 'broadleaf' || t === 'birch' || t === 'dead') list.push(phys.addCylinder(px, pz, 0.28 * s + 0.08, py - 1, py + 9 * s, { material: 'wood', tag: 'tree' }));
      else if (t === 'rockL') list.push(phys.addCylinder(px, pz, 2.3 * s, py - 1, py + 1.6 * s, { material: 'rock', tag: 'rock' }));
      else if (t === 'rockS') list.push(phys.addCylinder(px, pz, 0.7 * s, py - 1, py + 0.45 * s, { material: 'rock', tag: 'rock' }));
      else if (t === 'bush') list.push(phys.addCylinder(px, pz, 1.0 * s, py, py + 1.3 * s, { material: 'fabric', tag: 'bush', blocksMove: false, blocksShots: false, blocksSight: true }));
      else if (t === 'hay') list.push(phys.addCylinder(px, pz, 0.85 * s, py, py + 1.45 * s, { material: 'fabric', tag: 'hay' }));
      else if (t === 'log') list.push(phys.addCylinder(px, pz, 0.5, py, py + 0.65, { material: 'wood', tag: 'log' }));
    }
    return list;
  }

  /** Build what is near players, drop what nobody is near. Bounded work per call. */
  stream(force = false) {
    const obs = this.observers();
    const near = (x, z) => this.ai.nearestObserver(x, z, obs);
    let budget = force ? Infinity : 2; // POIs per call
    for (const p of this.world.pois) {
      const d = near(p.x, p.z) - p.radius;
      if (this.pois.active.has(p.id)) { if (d > POI_OUT) this._unloadPoi(p.id); continue; }
      if (d < POI_IN && budget > 0) { this._buildPoi(p); budget--; }
    }
    let cbudget = force ? Infinity : 6; // prop chunks per call
    const want = new Set();
    for (const o of obs) {
      const r = Math.ceil(PROP_IN / PROP_CHUNK);
      const ocx = Math.floor(o.x / PROP_CHUNK), ocz = Math.floor(o.z / PROP_CHUNK);
      for (let cz = ocz - r; cz <= ocz + r; cz++) for (let cx = ocx - r; cx <= ocx + r; cx++) {
        const mx = (cx + 0.5) * PROP_CHUNK, mz = (cz + 0.5) * PROP_CHUNK;
        if (Math.hypot(mx - o.x, mz - o.z) < PROP_IN + PROP_CHUNK * 0.7) want.add(`${cx},${cz}`);
      }
    }
    for (const k of want) {
      if (this.propChunks.has(k) || cbudget <= 0) continue;
      const [cx, cz] = k.split(',').map(Number);
      this.propChunks.set(k, this._propChunk(cx, cz));
      cbudget--;
    }
    for (const [k, list] of this.propChunks) {
      if (want.has(k)) continue;
      const [cx, cz] = k.split(',').map(Number);
      if (near((cx + 0.5) * PROP_CHUNK, (cz + 0.5) * PROP_CHUNK) < PROP_OUT) continue;
      for (const c of list) this.physics.remove(c);
      this.propChunks.delete(k);
    }
  }

  // ------------------------------------------------------------ simulation
  step(dt) {
    this.time += dt;
    this.factions.update(dt);
    this.clock.update(dt);
    const h = this.clock.hours;
    // same day/night curve as the client lighting, reduced to what AI perception reads
    const a = ((h - 6) / 24) * Math.PI * 2;
    const sy = Math.sin(a) / Math.hypot(Math.cos(a) * 0.82, Math.sin(a), -0.45 + Math.cos(a) * 0.1);
    const k = Math.min(1, Math.max(0, (0.1 - sy) / 0.2));
    const night = k * k * (3 - 2 * k);
    this.lighting.nightFactor = night;
    this.lighting.ambientLevel = 1 - night * 0.92;
    this.weather.update(dt, { x: 0, y: 0, z: 0 }, false, this.clock.scale / 24);
    this.streamT -= dt;
    if (this.streamT <= 0) { this.streamT = 0.5; this.stream(); }
    for (const p of this.players.values()) p.update(dt);
    this.ai.update(dt);
    this.ballistics.update(dt);
  }
}
