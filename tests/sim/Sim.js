// Headless firefight simulator. Runs the real AI, physics, buildings, terrain props,
// ballistics, damage model and factions without a renderer, so tactical behaviour can be
// exercised in actual firefights many times faster than real time and measured.
//
// Used by tests/sim/run.mjs (scenario report) and tests/unit/ai_sim.test.js (assertions).
import * as THREE from 'three';
import { WorldData } from '../../src/world/WorldData.js';
import { PhysicsWorld } from '../../src/engine/PhysicsWorld.js';
import { POIManager } from '../../src/world/POIManager.js';
import { Characters } from '../../src/combat/Characters.js';
import { Ballistics } from '../../src/weapons/Ballistics.js';
import { FactionManager } from '../../src/ai/FactionManager.js';
import { AIManager } from '../../src/ai/AIManager.js';
import { LootSystem } from '../../src/items/LootSystem.js';
import { ItemDB } from '../../src/items/ItemDatabase.js';
import { effectiveWeapon, fireInterval } from '../../src/weapons/WeaponData.js';
import { computeDamage } from '../../src/combat/DamageSystem.js';
import { generateChunk, VEG_TYPES } from '../../src/world/ChunkGenerator.js';
import { randomCone } from '../../src/weapons/WeaponController.js';
import { bus } from '../../src/core/EventBus.js';
import { mulberry32, angleWrap } from '../../src/core/MathUtil.js';

let WORLD = null;
export function sharedWorld() {
  if (!WORLD) WORLD = new WorldData();
  return WORLD;
}

const noop = () => {};
const EFFECTS = { impact: noop, splash: noop, decal: noop, blood: noop, tracer: noop, worldFlash: noop, muzzle: noop };

export class Sim {
  /**
   * opts: { seed, pois: [poiId], area: {x, z, r} (terrain props), night: 0..1, visibility }
   */
  constructor(opts = {}) {
    bus.clear();
    this.seed = opts.seed ?? 1;
    this._rand = mulberry32(this.seed * 7919 + 13);
    this._origRandom = Math.random;
    Math.random = this._rand; // deterministic runs
    const world = sharedWorld();
    const physics = new PhysicsWorld(world);
    const characters = new Characters();
    const game = {
      headless: true, time: 0, world, physics, characters, effects: EFFECTS,
      settings: { get: (k) => ({ aiDifficulty: 1, eventFrequency: 0 })[k] },
      lighting: { ambientLevel: 1 - (opts.night || 0) * 0.92, nightFactor: opts.night || 0 },
      weather: { visibility: opts.visibility ?? 1 },
      loot: new LootSystem(),
      interactables: { add: (o) => o, remove: noop, move: noop },
      clock: { gameMinutes: 600 },
      pois: { active: new Map() },
      base: null,
      renderer: { scene: { add: noop, remove: noop }, camera: { position: new THREE.Vector3() } },
      materials: {},
      vehicles: null,
    };
    game.factions = new FactionManager();
    game.ballistics = new Ballistics(physics, characters, EFFECTS, world);
    this.game = game;
    // an observer stands in for the player's camera (LOD and garrison spawning are relative to it)
    this.observer = { pos: new THREE.Vector3(opts.observer?.x ?? 0, 0, opts.observer?.z ?? 0) };
    game.player = { character: { faction: 'player', alive: false, pos: this.observer.pos }, controller: { pos: this.observer.pos } };
    game.ai = new AIManager(game);
    this.ai = game.ai;
    this.bots = [];
    this.metrics = new Metrics(this);
    this.t = 0;
    for (const id of opts.pois || []) this.buildPoi(id);
    if (opts.area) this.addTerrainProps(opts.area.x, opts.area.z, opts.area.r);
  }

  dispose() {
    Math.random = this._origRandom;
    bus.clear();
  }

  // ------------------------------------------------------------ world content
  buildPoi(id) {
    const poi = this.game.world.poiById.get(id);
    const pm = new POIManager({ add: noop }, this.game.world, this.game.physics, { get: () => ({}), factory: {} }, { add: (o) => o, remove: noop }, {});
    pm._begin(poi);
    const job = pm.building;
    while (job.i < job.commands.length) { try { job.commands[job.i](); } catch { /* layout errors are covered by unit tests */ } job.i++; }
    job.ctx.containers.forEach((c, i) => { c.id = `${poi.id}:c${i}`; });
    const rt = { poi, containers: job.ctx.containers, spots: job.ctx.spots, colliders: job.ctx.colliders, doors: job.ctx.doors, buildings: job.ctx.buildings };
    this.game.pois.active.set(poi.id, rt);
    return rt;
  }

  /** Tree, rock, log and hay colliders from the real vegetation scatter, as the terrain streamer adds them. */
  addTerrainProps(x, z, r) {
    const world = this.game.world, phys = this.game.physics;
    const S = 128;
    for (let cz = Math.floor((z - r) / S); cz <= Math.floor((z + r) / S); cz++) {
      for (let cx = Math.floor((x - r) / S); cx <= Math.floor((x + r) / S); cx++) {
        const o = generateChunk(world, { x0: cx * S, z0: cz * S, size: S, segs: 8, veg: true, vegDensity: 1 });
        const v = o.veg;
        for (let i = 0; i < v.length; i += 6) {
          const t = VEG_TYPES[v[i]];
          const px = v[i + 1], py = v[i + 2], pz = v[i + 3], s = v[i + 5];
          if (t === 'pineA' || t === 'pineB' || t === 'broadleaf' || t === 'birch' || t === 'dead') phys.addCylinder(px, pz, 0.28 * s + 0.08, py - 1, py + 9 * s, { material: 'wood', tag: 'tree' });
          else if (t === 'rockL') phys.addCylinder(px, pz, 2.3 * s, py - 1, py + 1.6 * s, { material: 'rock', tag: 'rock' });
          else if (t === 'rockS') phys.addCylinder(px, pz, 0.7 * s, py - 1, py + 0.45 * s, { material: 'rock', tag: 'rock' });
          else if (t === 'bush') phys.addCylinder(px, pz, 1.0 * s, py, py + 1.3 * s, { material: 'fabric', tag: 'bush', blocksMove: false, blocksShots: false, blocksSight: true });
          else if (t === 'hay') phys.addCylinder(px, pz, 0.85 * s, py, py + 1.45 * s, { material: 'fabric', tag: 'hay' });
          else if (t === 'log') phys.addCylinder(px, pz, 0.5, py, py + 0.65, { material: 'wood', tag: 'log' });
        }
      }
    }
  }

  // ------------------------------------------------------------ actors
  squad(profiles, x, z, opts = {}) {
    const s = this.ai.spawnSquad(profiles, x, z, opts);
    for (const m of s.members) {
      if (opts.ammoMags !== undefined) {
        // limited ammunition: keep the magazine, cut reserves to N magazines
        const w = ItemDB.weapon(m.primary.id);
        if (w.magSize) {
          m.inventory.remove(w.ammo, 9999);
          m.inventory.add({ id: w.ammo, qty: w.magSize * opts.ammoMags });
        }
        if (opts.noSidearm) { m.sidearm = null; }
      }
      if (opts.weapon) m.equipWeapon?.(ItemDB.create(opts.weapon, 1));
    }
    return s;
  }

  bot(opts) {
    const b = new PlayerBot(this, opts);
    this.bots.push(b);
    this.game.characters.add(b);
    if (opts.asPlayer !== false) {
      this.game.player.character = b;
      this.game.player.controller.pos = b.pos;
      this.observer.pos = b.pos;
    }
    return b;
  }

  /** Fire a weapon at a point with no target (distant gunfire for hearing tests). */
  gunshot(x, z, weaponId = 'wpn_arv7', shooter = null) {
    const w = effectiveWeapon(ItemDB.create(weaponId, 1));
    const y = this.game.world.heightAt(x, z) + 1.5;
    bus.emit('weapon:fired', { weapon: w, x, y, z, player: !shooter || shooter.isPlayer, npc: shooter && !shooter.isPlayer ? shooter : null, noise: w.noise * (w.noiseMul || 1), shooter });
  }

  /**
   * Find a standing spot on a ring around `center` (minD..maxD) for which test(p) holds.
   * Spots must be free of colliders and out of water. Deterministic for a seed.
   */
  findSpot(center, minD, maxD, test = null, tries = 160) {
    const phys = this.game.physics, world = this.game.world;
    for (let i = 0; i < tries; i++) {
      const a = this._rand() * Math.PI * 2, r = minD + this._rand() * (maxD - minD);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      if (world.waterAt(x, z) !== null) continue;
      const y = world.heightAt(x, z);
      if (phys.overlapsCylinder(x, y + 0.3, z, 0.4, 1.4)) continue;
      const p = { x, y, z };
      if (!test || test(p)) return p;
    }
    return null;
  }

  sees(a, b, ha = 1.6, hb = 1.4) {
    return this.game.physics.lineOfSight(a.x, (a.y ?? this.game.world.heightAt(a.x, a.z)) + ha, a.z, b.x, (b.y ?? this.game.world.heightAt(b.x, b.z)) + hb, b.z);
  }

  // ------------------------------------------------------------ stepping
  step(dt = 1 / 30) {
    this.t += dt;
    this.game.time += dt;
    this.game.factions.time = this.game.time;
    for (const b of this.bots) b.update(dt);
    this.ai.update(dt);
    this.game.ballistics.update(dt);
    this.metrics.sample(dt);
  }

  run(seconds, dt = 1 / 30, until = null) {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) {
      this.step(dt);
      if (until && i % 15 === 0 && until(this)) break;
    }
    return this;
  }

  agents(filter = null) {
    return this.ai.agents.filter((a) => !filter || filter(a));
  }
}

// ---------------------------------------------------------------- scripted player
/**
 * A scripted human-like combatant standing in for the player: walks waypoints, shoots at
 * visible hostiles with a configurable accuracy, reloads, can hide. It uses the same
 * ballistics and hit model the real player does.
 */
export class PlayerBot {
  constructor(sim, o) {
    this.sim = sim;
    this.game = sim.game;
    this.isPlayer = o.asPlayer !== false;
    this.faction = o.faction || 'player';
    this.colliderOwner = o.id || 'player';
    this.id = this.colliderOwner;
    const y = this.game.world.heightAt(o.x, o.z);
    this.pos = new THREE.Vector3(o.x, y, o.z);
    this.vel = new THREE.Vector3();
    this.yaw = o.yaw || 0;
    this.stance = o.stance || 'stand';
    this.health = o.health ?? 100;
    this.maxHealth = this.health;
    this.alive = true;
    this.lastShot = -99;
    this.lightOn = false;
    this.accuracyDeg = o.accuracyDeg ?? 1.6;
    this.weaponStack = ItemDB.create(o.weapon || 'wpn_arv7', 1);
    this.w = effectiveWeapon(this.weaponStack);
    this.ammo = this.w.magSize || 0;
    this.reserve = o.reserve ?? 240;
    this.reloadT = 0;
    this.nextShot = 0;
    this.burst = 0;
    this.shoot = o.shoot ?? true;
    this.range = o.range ?? 160;
    this.waypoints = o.waypoints || null;
    this.wpIdx = 0;
    this.speed = o.speed || 3.5;
    this.script = o.script || null; // function(bot, dt)
    this.hits = 0;
    this.damageTaken = 0;
    this.killedBy = null;
    this.shotsFired = 0;
  }

  get firedRecently() { return this.game.time - this.lastShot < 1.5; }

  onHit(info) {
    if (!this.alive) return;
    const dmg = computeDamage({ ...info, armor: this.armor?.[info.zone] || 0 });
    this.health -= dmg;
    this.damageTaken += dmg;
    this.hits++;
    if (this.health <= 0) { this.alive = false; this.killedBy = info.shooter; bus.emit('bot:died', { bot: this, killer: info.shooter }); }
  }

  onSuppressed() { this.suppressedT = this.game.time; }

  eye() { return { x: this.pos.x, y: this.pos.y + (this.stance === 'crouch' ? 1.1 : this.stance === 'prone' ? 0.35 : 1.6), z: this.pos.z }; }

  moveToward(p, dt, speed = this.speed) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.4) { this.vel.set(0, 0, 0); return true; }
    const s = Math.min(speed, d / dt);
    const r = this.game.physics.moveCylinder(this.pos, (dx / d) * s * dt, (dz / d) * s * dt, 0.33, 1.75, 0.45, this.colliderOwner);
    this.vel.set((r.x - this.pos.x) / dt, 0, (r.z - this.pos.z) / dt);
    this.pos.x = r.x; this.pos.z = r.z;
    this.pos.y = this.game.physics.groundHeight(this.pos.x, this.pos.z, 0.33, this.pos.y + 0.5);
    if (!this.target) this.yaw = Math.atan2(-dx, -dz);
    return false;
  }

  visibleHostile() {
    const e = this.eye();
    let best = null, bd = Infinity;
    for (const a of this.game.characters.list) {
      if (a === this || !a.alive || !a.isAI) continue;
      if (this.faction !== 'player' ? a.faction === this.faction : !this.game.factions.hostile(a.faction, 'player') && !a.attackers?.has(this)) continue;
      const d = Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z);
      if (d > this.range || d > bd) continue;
      const ty = a.pos.y + (a.stance === 'crouch' ? 1.0 : 1.4);
      if (!this.game.physics.lineOfSight(e.x, e.y, e.z, a.pos.x, ty, a.pos.z, this.colliderOwner)) continue;
      best = a; bd = d;
    }
    return best;
  }

  fireAt(p) {
    const e = this.eye();
    const dir = new THREE.Vector3(p.x - e.x, p.y - e.y, p.z - e.z).normalize();
    this.yaw = Math.atan2(-dir.x, -dir.z);
    const pellets = this.w.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const err = ((this.accuracyDeg + (pellets > 1 ? this.w.pelletSpread : 0)) * Math.PI / 180) * Math.sqrt(Math.random());
      const sd = randomCone(dir.clone(), err);
      this.game.ballistics.fire({ ox: e.x, oy: e.y, oz: e.z, dx: sd.x, dy: sd.y, dz: sd.z, weapon: this.w, shooter: this, damageMul: 1 });
    }
    this.ammo--;
    this.shotsFired++;
    this.lastShot = this.game.time;
    bus.emit('weapon:fired', { weapon: this.w, x: e.x, y: e.y, z: e.z, player: this.isPlayer, npc: this.isPlayer ? null : this, noise: this.w.noise * (this.w.noiseMul || 1), shooter: this });
  }

  update(dt) {
    if (!this.alive) return;
    const t = this.game.time;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { const n = Math.min(this.reserve, this.w.magSize - this.ammo); this.ammo += n; this.reserve -= n; }
    }
    if (this.script) this.script(this, dt);
    if (this.waypoints && this.wpIdx < this.waypoints.length && !this.holdMove) {
      if (this.moveToward(this.waypoints[this.wpIdx], dt, this.waypoints[this.wpIdx].speed || this.speed)) this.wpIdx++;
    } else this.vel.set(0, 0, 0);
    if (!this.shoot) { this.target = null; return; }
    const tgt = this.visibleHostile();
    this.target = tgt;
    if (!tgt) return;
    this.yaw = Math.atan2(-(tgt.pos.x - this.pos.x), -(tgt.pos.z - this.pos.z));
    if (this.reloadT > 0 || t < this.nextShot) return;
    if (this.ammo <= 0) { if (this.reserve > 0) this.reloadT = this.w.reloadTime; return; }
    const ty = tgt.pos.y + (tgt.stance === 'crouch' ? 0.85 : 1.25);
    this.fireAt({ x: tgt.pos.x, y: ty, z: tgt.pos.z });
    // short controlled bursts with pauses, like a person
    this.burst++;
    this.nextShot = t + (this.burst % 3 === 0 ? 0.6 + Math.random() * 0.5 : fireInterval(this.w) * 1.4);
  }
}

// ---------------------------------------------------------------- measurement
export class Metrics {
  constructor(sim) {
    this.sim = sim;
    this.shots = 0;
    this.shotsByFaction = {};
    this.badFacing = 0;
    this.muzzleBlocked = 0;
    this.friendlyHits = 0;
    this.hits = 0;
    this.deaths = [];
    this.reloads = 0;
    this.tactics = {};
    this.stuckEvents = [];
    this.insideGeometry = 0;
    this.ammoViolations = 0;
    this.stateTime = {};
    this.coverTime = 0;
    this.combatTime = 0;
    this.openIdleTime = 0;
    this.perAgent = new Map();
    this._t = 0;
    this.firstContact = null;
    this.pathFails = {};
    this.hitsByFaction = {};
    const g = sim.game;
    const origFire = g.ballistics.fire.bind(g.ballistics);
    g.ballistics.fire = (shot) => {
      const sh = shot.shooter;
      if (sh?.isAI) {
        this.shots++;
        this.shotsByFaction[sh.faction] = (this.shotsByFaction[sh.faction] || 0) + 1;
        const yawShot = Math.atan2(-shot.dx, -shot.dz);
        if (Math.abs(angleWrap(yawShot - sh.yaw)) > 0.6) this.badFacing++;
        // first obstacle right at the muzzle = firing into its own cover
        const hit = g.physics.raycast(shot.ox, shot.oy, shot.oz, shot.dx, shot.dy, shot.dz, 0.9, (c) => c.blocksShots && c.owner !== sh.colliderOwner && c.tag !== 'character', false);
        if (hit) this.muzzleBlocked++;
        const pa = this._agent(sh);
        pa.shots++;
        if (sh.state) pa.shotStates[sh.tactic || sh.state] = (pa.shotStates[sh.tactic || sh.state] || 0) + 1;
      }
      return origFire(shot);
    };
    bus.on('hit', (e) => {
      if (!e.shooter?.isAI) return;
      this.hits++;
      this.hitsByFaction[e.shooter.faction] = (this.hitsByFaction[e.shooter.faction] || 0) + 1;
      if (e.target.faction === e.shooter.faction && e.target !== e.shooter) this.friendlyHits++;
    });
    bus.on('npc:died', (e) => {
      this.deaths.push({ t: +sim.t.toFixed(1), id: e.agent.id, faction: e.agent.faction, killer: e.killer?.faction || null });
      const p = this._agent(e.agent);
      p.timeline.push(`${sim.t.toFixed(1).padStart(6)} DIED (${e.zone || '?'}) by ${e.killer?.id || e.killer?.faction || '?'} while ${e.agent.state}/${e.agent.tactic || ''} stance ${e.agent.stance} cover ${e.agent._atCover?.() ? 'yes' : 'no'}`);
    });
    bus.on('npc:reload', () => { this.reloads++; });
    bus.on('ai:tactic', (e) => {
      this.tactics[e.type] = (this.tactics[e.type] || 0) + 1;
      if (e.type === 'path-failed') { const k = `pf:${e.state}/${e.tactic || '-'}`; this.pathFails[k] = (this.pathFails[k] || 0) + 1; }
      if (e.type === 'contact' && this.firstContact === null) this.firstContact = sim.t;
      const pa = this._agent(e.agent);
      pa.tactics[e.type] = (pa.tactics[e.type] || 0) + 1;
    });
  }

  _agent(a) {
    let p = this.perAgent.get(a);
    if (!p) {
      p = { id: a.id, faction: a.faction, shots: 0, shotStates: {}, tactics: {}, lastPos: a.pos.clone(), still: 0, stuckLogged: false, ammo0: this._ammoOf(a), minDistTo: {}, trail: [], timeline: [] };
      this.perAgent.set(a, p);
    }
    return p;
  }

  _ammoOf(a) {
    if (!a.primary) return 0;
    const w = ItemDB.weapon(a.primary.id);
    let n = (a.primary.data.ammo || 0) + (w.ammo ? a.inventory.count(w.ammo) : 0);
    if (a.sidearm) { const s = ItemDB.weapon(a.sidearm.id); n += (a.sidearm.data.ammo || 0) + (s.ammo && s.ammo !== w.ammo ? a.inventory.count(s.ammo) : 0); }
    return n;
  }

  sample(dt) {
    this._t += dt;
    if (this._t < 0.5) return;
    const step = this._t;
    this._t = 0;
    const phys = this.sim.game.physics;
    for (const a of this.sim.ai.agents) {
      if (!a.alive || a.removed) continue;
      const p = this._agent(a);
      this.stateTime[a.state] = (this.stateTime[a.state] || 0) + step;
      if (p.trail.length < 2000) p.trail.push([+this.sim.t.toFixed(1), +a.pos.x.toFixed(1), +a.pos.z.toFixed(1), a.state, a.tactic || '']);
      // geometry penetration
      const hit = phys.overlapsCylinder(a.pos.x, a.pos.y + 0.5, a.pos.z, 0.15, 1.0, a.colliderOwner);
      if (hit && hit.blocksMove && hit.tag !== 'character' && hit.tag !== 'door' && hit.tag !== 'bush') this.insideGeometry++;
      // ammunition never negative and never more than issued + scavenged
      if ((a.weapon?.data?.ammo ?? 0) < 0) this.ammoViolations++;
      // stuck: wants to move but hasn't for 6 s
      const moved = Math.hypot(a.pos.x - p.lastPos.x, a.pos.z - p.lastPos.z);
      const wantsMove = !!(a.path && a.path.length);
      if (wantsMove && moved < 0.25) p.still += step; else { p.still = 0; p.stuckLogged = false; }
      if (p.still >= 6 && !p.stuckLogged) {
        p.stuckLogged = true;
        this.stuckEvents.push({ t: +this.sim.t.toFixed(1), id: a.id, state: a.state, tactic: a.tactic || null, x: +a.pos.x.toFixed(1), z: +a.pos.z.toFixed(1) });
      }
      p.lastPos.copy(a.pos);
      // timeline entry when anything notable changed
      const tgt = a.target;
      const td = tgt ? Math.round(Math.hypot(tgt.pos.x - a.pos.x, tgt.pos.z - a.pos.z)) : null;
      const key = `${a.state}|${a.tactic || ''}|${a.targetVisible ? 'V' : '-'}|${a.stance}|${a._atCover?.() ? 'C' : '-'}|${a.reloading > 0 ? 'R' : '-'}`;
      if (key !== p.lastKey || this.sim.t - (p.lastLogT || 0) > 8) {
        p.lastKey = key; p.lastLogT = this.sim.t;
        if (p.timeline.length < 600) p.timeline.push(`${this.sim.t.toFixed(1).padStart(6)} ${key.padEnd(34)} hp${Math.round(a.health)} ammo${a.weapon?.data?.ammo ?? '-'}+${a.w?.ammo ? a.inventory.count(a.w.ammo) : 0} tgt${td ?? '-'} pos(${a.pos.x.toFixed(0)},${a.pos.z.toFixed(0)}) shots${p.shots} mor${(a.morale ?? 1).toFixed(2)} sup${a.suppression.toFixed(1)}`);
      }
      if (a.state === 'combat') {
        this.combatTime += step;
        const inCover = a.cover && a._atCover?.();
        if (inCover) this.coverTime += step;
        const seesTarget = a.targetVisible;
        const moving = wantsMove;
        if (!inCover && !moving && !seesTarget && a.reloading <= 0) this.openIdleTime += step;
      }
    }
  }

  summary() {
    const agents = [...this.perAgent.values()];
    return {
      t: +this.sim.t.toFixed(1),
      shots: this.shots, hits: this.hits, hitRate: this.shots ? +(this.hits / this.shots).toFixed(3) : 0,
      shotsByFaction: this.shotsByFaction, hitsByFaction: this.hitsByFaction,
      badFacing: this.badFacing, muzzleBlocked: this.muzzleBlocked, friendlyHits: this.friendlyHits,
      deaths: this.deaths, reloads: this.reloads, tactics: this.tactics,
      stuck: this.stuckEvents, insideGeometry: this.insideGeometry, ammoViolations: this.ammoViolations,
      combatTime: +this.combatTime.toFixed(1), coverShare: this.combatTime ? +(this.coverTime / this.combatTime).toFixed(2) : 0,
      openIdleShare: this.combatTime ? +(this.openIdleTime / this.combatTime).toFixed(2) : 0,
      stateTime: Object.fromEntries(Object.entries(this.stateTime).map(([k, v]) => [k, +v.toFixed(1)])),
      firstContact: this.firstContact,
      pathFails: this.pathFails,
      agents: agents.length,
    };
  }
}
