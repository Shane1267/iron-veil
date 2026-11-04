import * as THREE from 'three';
import { AIAgent } from './AIAgent.js';
import { NavGrid } from './NavGrid.js';
import { Squad } from './Squad.js';
import { bus } from '../core/EventBus.js';
import { RNG, hashString } from '../core/MathUtil.js';
import { ItemDB } from '../items/ItemDatabase.js';

// Spawns and simulates human AI: POI garrisons (persistent casualties), squads with
// shared knowledge (Squad.js), sound propagation, corpses that can be scavenged,
// distance-based LOD and despawning.

const SPAWN_RADIUS = 480;
const DESPAWN_RADIUS = 700;

export { Squad };

export class AIManager {
  constructor(game) {
    this.game = game;
    this.agents = [];
    this.squads = [];
    this.nav = new NavGrid(game.physics, game.world);
    this.garrisons = {}; // poiId -> {killed, total, respawnAt}
    this.spawned = new Map(); // poiId -> [agents]
    this.corpses = [];
    this.frame = 0;
    this.squadId = 0;
    this.coneMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.coneGeo = new THREE.ConeGeometry(2.2, 14, 16, 1, true);
    this.coneGeo.rotateX(-Math.PI / 2);
    this.coneGeo.translate(0, 0, -7);
    this.checkT = 0;

    this._unsub = [
      bus.on('weapon:fired', (e) => this._gunshot(e)),
      bus.on('footstep', (e) => {
        if (e.player) this.emitSound({ x: e.x, y: e.y, z: e.z, radius: (e.volume || 0.5) * 26, source: e.char || game.player.character, type: 'footstep' });
        else if (e.npc && e.npc.isAI) this.emitSound({ x: e.x, y: e.y, z: e.z, radius: (e.volume || 0.5) * 20, source: e.npc, type: 'footstep' });
      }),
      bus.on('noise', (e) => this.emitSound(e)),
      bus.on('impact', (e) => this._impact(e)),
      bus.on('sound', (e) => {
        if (e.type === 'door' && !e.npc) this.emitSound({ x: e.x, y: e.y, z: e.z, radius: 14, source: e.char || game.player.character, type: 'door' });
        if (e.type === 'glass') this.emitSound({ x: e.x, y: e.y, z: e.z, radius: 35, source: null, type: 'glass' });
      }),
    ];
    this.soundLog = [];
  }

  dispose() {
    for (const u of this._unsub) u();
    this._unsub = [];
  }

  // ------------------------------------------------------------ spawning
  newSquad(faction) {
    const s = new Squad(++this.squadId, faction, this);
    this.squads.push(s);
    return s;
  }

  spawn(opts) {
    const a = new AIAgent(this, opts);
    this.agents.push(a);
    return a;
  }

  garrisonState(poi) {
    if (!this.garrisons[poi.id]) {
      const total = (poi.garrison || []).reduce((s, g) => s + g.count, 0);
      this.garrisons[poi.id] = { killed: 0, total, respawnAt: 0 };
    }
    return this.garrisons[poi.id];
  }

  _spawnGarrison(rt) {
    const poi = rt.poi;
    if (this.spawned.has(poi.id) || !poi.garrison?.length) return;
    const gs = this.garrisonState(poi);
    const now = this.game.clock.gameMinutes;
    if (gs.killed > 0 && gs.respawnAt && now >= gs.respawnAt) { gs.killed = 0; gs.respawnAt = 0; }
    let remaining = gs.total - gs.killed;
    const list = [];
    this.spawned.set(poi.id, list);
    if (remaining <= 0) return;
    const rng = new RNG(hashString(poi.id) + Math.floor(now / 60));
    const spots = rt.spots.slice();
    const towers = spots.filter((s) => s.type === 'tower');
    const doors = spots.filter((s) => s.type === 'door');
    const inside = spots.filter((s) => s.type === 'inside');
    const squad = this.newSquad(poi.garrison[0] ? this.game.factions.profile(poi.garrison[0].profile).faction : 'indep');
    for (const g of poi.garrison) {
      const profile = this.game.factions.profile(g.profile);
      if (!profile) continue;
      const sq = profile.faction === squad.faction ? squad : this.newSquad(profile.faction);
      for (let i = 0; i < g.count && remaining > 0; i++, remaining--) {
        let p;
        if (g.role === 'sniper' && towers.length) p = towers.splice(rng.int(0, towers.length - 1), 1)[0];
        else if (g.role === 'guard' && doors.length && rng.chance(0.6)) p = doors.splice(rng.int(0, doors.length - 1), 1)[0];
        else if (inside.length && rng.chance(0.4)) p = inside[rng.int(0, inside.length - 1)];
        if (!p) {
          const a = rng.next() * Math.PI * 2, r = poi.radius * (0.2 + rng.next() * 0.5);
          p = { x: poi.x + Math.cos(a) * r, z: poi.z + Math.sin(a) * r };
        }
        const ok = this.freeSpot(p.x, p.z, p.y);
        if (!ok) continue;
        const route = g.role === 'patrol' ? this._perimeterRoute(poi, rng) : null;
        const agent = this.spawn({
          profile, role: g.role === 'sniper' ? 'sniper' : g.role, x: ok.x, y: ok.y, z: ok.z, yaw: rng.next() * Math.PI * 2,
          home: { x: poi.x, z: poi.z, radius: poi.radius }, post: { x: ok.x, z: ok.z, yaw: Math.atan2(-(ok.x - poi.x), -(ok.z - poi.z)) + Math.PI },
          route, poiId: poi.id, seed: hashString(poi.id + i + g.profile),
        });
        agent.garrisonOf = poi.id;
        sq.add(agent);
        list.push(agent);
      }
    }
  }

  freeSpot(x, z, y = null) {
    for (let k = 0; k < 8; k++) {
      const ox = k === 0 ? 0 : (Math.random() - 0.5) * 6, oz = k === 0 ? 0 : (Math.random() - 0.5) * 6;
      const px = x + ox, pz = z + oz;
      const gy = y ?? this.game.physics.groundHeight(px, pz, 0.35, this.game.world.heightAt(px, pz) + 0.5);
      if (this.game.world.waterAt(px, pz) !== null) continue;
      if (!this.game.physics.overlapsCylinder(px, gy + 0.3, pz, 0.35, 1.4)) return { x: px, y: gy, z: pz };
    }
    return null;
  }

  _perimeterRoute(poi, rng) {
    const n = 5 + rng.int(0, 2);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.next() * 0.3;
      const r = poi.radius * (0.75 + rng.next() * 0.35);
      out.push({ x: poi.x + Math.cos(a) * r, z: poi.z + Math.sin(a) * r });
    }
    return out;
  }

  /** Spawn an independent squad (events, raids). Returns squad. */
  spawnSquad(profileIds, x, z, opts = {}) {
    const first = this.game.factions.profile(profileIds[0]);
    const squad = this.newSquad(first.faction);
    profileIds.forEach((pid, i) => {
      const profile = this.game.factions.profile(pid);
      if (!profile || profile.faction !== squad.faction) return; // squads never mix factions
      const a = (i / profileIds.length) * Math.PI * 2;
      const spot = this.freeSpot(x + Math.cos(a) * 2.5, z + Math.sin(a) * 2.5);
      if (!spot) return;
      const agent = this.spawn({ profile, role: opts.role || profile.role, x: spot.x, y: spot.y, z: spot.z, home: { x, z, radius: 40 }, post: { x: spot.x, z: spot.z }, state: opts.state, route: opts.route, seed: Math.floor(Math.random() * 1e9) });
      agent.eventId = opts.eventId || null;
      squad.add(agent);
    });
    return squad;
  }

  relocate(agent) {
    // scavengers occasionally travel to another nearby location
    const pois = this.game.world.pois.filter((p) => p.id !== agent.poiId && Math.hypot(p.x - agent.pos.x, p.z - agent.pos.z) < 1500 && (!p.garrison?.length || p.type === 'village'));
    if (!pois.length) return false;
    const p = pois[Math.floor(Math.random() * pois.length)];
    agent._enter('travel');
    agent.travelTarget = { x: p.x, z: p.z };
    agent.onArrive = (a) => { a.poiId = p.id; a.home = { x: p.x, z: p.z, radius: p.radius }; a.visited = new Set(); a._enter('scav'); };
    return true;
  }

  // ------------------------------------------------------------ corpses
  registerCorpse(agent, inv) {
    const id = `corpse:${agent.id}`;
    this.game.loot.register(id, inv, { transient: true });
    const it = this.game.interactables.add({ id, kind: 'container', x: agent.pos.x, y: agent.pos.y + 0.4, z: agent.pos.z, radius: 1.6, label: `Search body (${this.game.factions.get(agent.faction).short})`, data: { containerId: id, name: 'Body', custom: true } });
    this.corpses.push({ agent, id, inv, interact: it, time: 0 });
    if (agent.garrisonOf) {
      const gs = this.garrisons[agent.garrisonOf];
      if (gs) { gs.killed++; gs.respawnAt = this.game.clock.gameMinutes + 120; }
    }
  }

  /** Nearest body that holds ammunition (or a loaded gun) the agent can use. */
  lootableCorpse(agent, radius) {
    let best = null, bd = radius;
    const ammo = new Set([agent.w.ammo, agent.sidearm ? ItemDB.weapon(agent.sidearm.id)?.ammo : null].filter(Boolean));
    const needGun = !agent._usable();
    for (const c of this.corpses) {
      if (!c.inv || (c.blocked && agent.time - c.blocked < 30)) continue;
      const d = Math.hypot(c.agent.pos.x - agent.pos.x, c.agent.pos.z - agent.pos.z);
      if (d > bd) continue;
      let useful = false;
      for (const s of c.inv.slots) {
        if (!s) continue;
        if (ammo.has(s.id)) { useful = true; break; }
        if (needGun) { const w = ItemDB.weapon(s.id); if (w?.magSize && ((s.data?.ammo || 0) > 0 || c.inv.count(w.ammo) > 0)) { useful = true; break; } }
        if (!needGun && ItemDB.get(s.id)?.cat === 'medical' && agent.D.lootDead > 0.5) { useful = true; break; }
      }
      if (!useful) continue;
      best = c; bd = d;
    }
    return best;
  }

  _removeCorpse(c) {
    c.agent.dispose();
    this.game.interactables.remove(c.interact);
    this.game.loot.remove(c.id);
    const i = this.agents.indexOf(c.agent);
    if (i >= 0) this.agents.splice(i, 1);
  }

  // ------------------------------------------------------------ sound propagation
  _gunshot(e) {
    const source = e.player ? (e.shooter || this.game.player.character) : e.npc || e.shooter || null;
    if (e.player && source) source.lastShot = this.game.time;
    const radius = e.noise || 300; // already scaled by suppressors (noiseMul)
    this.emitSound({ x: e.x, y: e.y, z: e.z, radius, source, type: 'gunshot' });
  }

  /**
   * Propagate a sound. Everyone inside its radius may hear it; walls and terrain between
   * source and listener cut the effective radius (a gunshot inside a building is heard
   * outside, but not as far), and the further/more muffled it is, the vaguer the position.
   */
  emitSound(e) {
    if (this.soundLog.length > 50) this.soundLog.shift();
    this.soundLog.push({ t: this.game.time, type: e.type, x: e.x, z: e.z, r: e.radius });
    const occl = e.type === 'gunshot' ? 0.55 : e.type === 'voice' || e.type === 'death' ? 0.4 : 0.3;
    for (const a of this.agents) {
      if (!a.alive || a === e.source || a.removed) continue;
      const d = Math.hypot(a.pos.x - e.x, a.pos.z - e.z);
      if (d > e.radius) continue;
      let occluded = false;
      if (d > 6) occluded = !this.game.physics.lineOfSight(e.x, (e.y ?? a.pos.y) + 1, e.z, a.pos.x, a.pos.y + 1.6, a.pos.z);
      const eff = e.radius * (occluded ? occl : 1);
      if (d > eff) continue;
      a.hear(e, d, { occluded, intensity: 1 - d / eff });
    }
  }

  /** Back-compat name. */
  _noise(e) { this.emitSound(e); }

  _impact(e) {
    if (!e.shooter) return;
    for (const a of this.agents) {
      if (!a.alive || a === e.shooter) continue;
      const d = Math.hypot(a.pos.x - e.x, a.pos.z - e.z);
      if (d < 6 && a.isEnemy(e.shooter)) {
        a.suppression = Math.min(1, a.suppression + (d < 2 ? 0.25 : 0.12));
        if (a.state !== 'combat' && a.state !== 'retreat') a.onSuppressed({ distance: d, shooter: e.shooter });
      }
    }
  }

  /** Hiding places around a point: corners and edges of solid structures. */
  hidingSpots(c, radius, n) {
    const out = [];
    const phys = this.game.physics;
    const cols = phys.query(c.x - radius, c.z - radius, c.x + radius, c.z + radius, this._hs || (this._hs = []));
    for (const col of cols) {
      if (col.type !== 'box' || !col.blocksSight || col.maxY - col.minY < 1.2 || col.tag === 'door') continue;
      const w = col.maxX - col.minX, dpt = col.maxZ - col.minZ;
      if (w > 40 || dpt > 40 || (w < 0.6 && dpt < 0.6)) continue;
      for (const [x, z] of [[col.minX - 0.8, col.minZ - 0.8], [col.maxX + 0.8, col.minZ - 0.8], [col.minX - 0.8, col.maxZ + 0.8], [col.maxX + 0.8, col.maxZ + 0.8]]) {
        const d = Math.hypot(x - c.x, z - c.z);
        if (d > radius || d < 4) continue;
        if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 6)) continue;
        const gy = this.game.world.heightAt(x, z);
        if (phys.overlapsCylinder(x, gy + 0.3, z, 0.35, 1.3)) continue;
        out.push({ x, z, d });
      }
    }
    out.sort((a, b) => a.d - b.d);
    return out.slice(0, n);
  }

  makeLightCone() {
    const m = new THREE.Mesh(this.coneGeo, this.coneMat);
    m.renderOrder = 6;
    this.game.renderer.scene.add(m);
    return m;
  }

  // ------------------------------------------------------------ update
  /** Positions the world is simulated around: the local player, or every connected player on a server. */
  observers() {
    if (this.game.observers) return this.game.observers();
    return [this.game.player.controller.pos];
  }

  /** Horizontal distance from (x, z) to the nearest observer. */
  nearestObserver(x, z, obs = this.observers()) {
    let d = Infinity;
    for (const o of obs) { const v = Math.hypot(o.x - x, o.z - z); if (v < d) d = v; }
    return d;
  }

  update(dt) {
    this.frame++;
    const obs = this.observers();
    const near = (x, z) => this.nearestObserver(x, z, obs);
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 1.0;
      // spawn garrisons for nearby built POIs
      for (const rt of this.game.pois.active.values()) {
        const d = near(rt.poi.x, rt.poi.z) - rt.poi.radius;
        if (d < SPAWN_RADIUS) this._spawnGarrison(rt);
      }
      // despawn far garrisons
      for (const [poiId, list] of this.spawned) {
        const poi = this.game.world.poiById.get(poiId);
        const d = near(poi.x, poi.z) - poi.radius;
        if (d > DESPAWN_RADIUS) {
          for (const a of list) if (a.alive) this._despawn(a);
          this.spawned.delete(poiId);
        }
      }
      // despawn far event agents
      for (const a of [...this.agents]) {
        if (!a.alive || a.garrisonOf) continue;
        const d = near(a.pos.x, a.pos.z);
        if (d > DESPAWN_RADIUS + 300) this._despawn(a);
      }
      // corpses
      for (const c of [...this.corpses]) {
        c.time += 1;
        const d = near(c.agent.pos.x, c.agent.pos.z);
        if (c.time > 1200 || d > DESPAWN_RADIUS + 200) {
          this._removeCorpse(c);
          this.corpses.splice(this.corpses.indexOf(c), 1);
        }
      }
      this.squads = this.squads.filter((s) => s.members.some((m) => m.alive));
      this._baseDiscovery();
    }
    this.nav.update();
    for (const s of this.squads) s.update(dt);
    for (const a of this.agents) {
      const d = near(a.pos.x, a.pos.z);
      a.update(dt, d);
    }
  }

  _despawn(a) {
    a.dispose();
    const i = this.agents.indexOf(a);
    if (i >= 0) this.agents.splice(i, 1);
  }

  _baseDiscovery() {
    const base = this.game.base;
    if (!base || !base.pieces.size) return;
    const c = base.center();
    if (!c) return;
    for (const a of this.agents) {
      if (!a.alive || a.faction === 'guard') continue;
      const d = Math.hypot(a.pos.x - c.x, a.pos.z - c.z);
      if (d < 90 && this.game.physics.lineOfSight(a.pos.x, a.pos.y + 1.6, a.pos.z, c.x, c.y + 1.5, c.z, a.id)) {
        if (!base.discoveredBy.has(a.faction)) {
          base.discoveredBy.add(a.faction);
          bus.emit('base:discovered', { faction: a.faction, agent: a });
        }
      }
    }
  }

  clear() {
    for (const a of this.agents) a.dispose();
    for (const c of this.corpses) { this.game.interactables.remove(c.interact); this.game.loot.remove(c.id); }
    this.agents = [];
    this.corpses = [];
    this.spawned.clear();
    this.squads = [];
  }

  alive() {
    return this.agents.filter((a) => a.alive);
  }

  serialize() {
    return { garrisons: this.garrisons };
  }

  deserialize(o) {
    this.garrisons = {};
    if (o?.garrisons && typeof o.garrisons === 'object') {
      for (const [k, v] of Object.entries(o.garrisons)) {
        if (v && Number.isFinite(v.killed) && Number.isFinite(v.total)) this.garrisons[k] = { killed: v.killed, total: v.total, respawnAt: v.respawnAt || 0 };
      }
    }
  }
}

