import { bus } from '../core/EventBus.js';
import { RNG } from '../core/MathUtil.js';
import { ItemDB } from '../items/ItemDatabase.js';
import { rollLoot } from '../items/LootSystem.js';

// Dynamic world events built from real systems: patrols walking real roads, faction
// skirmishes between actual squads, raiders scavenging a location, armed convoys driving
// a real route, guarded supply caches, and AI raids on discovered player bases.
// Events spawn out of the player's sight and never announce themselves with fake text.

export class WorldEvents {
  constructor(game) {
    this.game = game;
    this.rng = new RNG(Date.now() & 0xffffff);
    this.timer = 90;
    this.active = [];
    this.history = [];
    this.nextId = 1;
  }

  get freq() {
    return this.game.settings.get('eventFrequency');
  }

  update(dt) {
    if (this.freq <= 0) return;
    this.timer -= dt * this.freq;
    // clean up finished events
    this.active = this.active.filter((e) => {
      const alive = e.squads.some((s) => s.members.some((m) => m.alive && !m.removed));
      if (!alive) this.history.push({ type: e.type, ended: this.game.clock.gameMinutes });
      return alive || (e.vehicle && !e.vehicle.destroyed && this.game.vehicles.vehicles.has(e.vehicle.id));
    });
    this._raidCheck(dt);
    if (this.timer > 0) return;
    this.timer = 150 + this.rng.next() * 200;
    if (this.active.length >= 2) return;
    const pick = this.rng.weighted([
      { t: 'patrol', weight: 3 }, { t: 'skirmish', weight: 2 }, { t: 'scavengers', weight: 2 },
      { t: 'convoy', weight: 1.5 }, { t: 'cache', weight: 1 },
    ]).t;
    try {
      this[`_${pick}`]();
    } catch (e) {
      console.warn('[Events] failed to start', pick, e);
    }
  }

  /** Random spot 280-450 m from the player that the player cannot currently see. */
  _hiddenSpot(minD = 280, maxD = 450, nearRoad = false) {
    const p = this.game.player.controller.pos;
    const eye = this.game.renderer.camera.position;
    for (let i = 0; i < 25; i++) {
      let x, z;
      if (nearRoad) {
        const roads = this.game.world.roads.filter((r) => r.type !== 'rail');
        const road = this.rng.pick(roads);
        const pt = this.rng.pick(road.points);
        [x, z] = pt;
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < minD || d > maxD) continue;
      } else {
        const a = this.rng.next() * Math.PI * 2, r = minD + this.rng.next() * (maxD - minD);
        x = p.x + Math.cos(a) * r; z = p.z + Math.sin(a) * r;
      }
      if (this.game.world.waterAt(x, z) !== null) continue;
      if (Math.abs(x) > 7600 || Math.abs(z) > 7600) continue;
      const y = this.game.world.heightAt(x, z);
      if (this.game.physics.lineOfSight(eye.x, eye.y, eye.z, x, y + 1.6, z)) continue;
      return { x, y, z };
    }
    return null;
  }

  _register(type, squads, extra = {}) {
    const e = { id: this.nextId++, type, squads, started: this.game.clock.gameMinutes, ...extra };
    this.active.push(e);
    bus.emit('event:started', e);
    return e;
  }

  _patrol() {
    const s = this._hiddenSpot(300, 500, true);
    if (!s) return;
    // route along the nearest road
    const rq = this.game.world.roadQuery(s.x, s.z);
    const road = rq?.road || this.game.world.roads[0];
    const i0 = rq ? rq.seg.i : 0;
    const dir = this.rng.chance(0.5) ? 1 : -1;
    const route = [];
    for (let k = 0; k < 30; k++) {
      const idx = Math.max(0, Math.min(road.points.length - 1, i0 + dir * k * 4));
      route.push({ x: road.points[idx][0], z: road.points[idx][1] });
    }
    route.push(...route.slice().reverse());
    const faction = this.rng.pick(['vsf', 'vsf', 'wolves', 'free']);
    const prof = { vsf: ['vsf_rifleman', 'vsf_rifleman', 'vsf_rifleman'], wolves: ['wolf_raider', 'wolf_shooter', 'wolf_raider'], free: ['free_merc', 'free_merc'] }[faction];
    const squad = this.game.ai.spawnSquad(prof, s.x, s.z, { role: 'patrol', state: 'patrol', route });
    this._register('patrol', [squad]);
  }

  _skirmish() {
    const s = this._hiddenSpot(250, 420);
    if (!s) return;
    const a = this.rng.next() * Math.PI * 2;
    const off = 30 + this.rng.next() * 15;
    const sideA = this.game.ai.spawnSquad(['wolf_raider', 'wolf_shooter', 'wolf_raider'], s.x + Math.cos(a) * off, s.z + Math.sin(a) * off, { role: 'rusher' });
    const other = this.rng.pick([['vsf_rifleman', 'vsf_rifleman', 'vsf_gunner'], ['guard_militia', 'guard_militia', 'guard_militia'], ['free_merc', 'free_merc']]);
    const sideB = this.game.ai.spawnSquad(other, s.x - Math.cos(a) * off, s.z - Math.sin(a) * off, { role: 'rifleman' });
    // they are already aware of each other
    for (const m of sideA.members) { const t = sideB.members[0]; if (t) { m._reveal(t, 0.7); } }
    for (const m of sideB.members) { const t = sideA.members[0]; if (t) { m._reveal(t, 0.7); } }
    this._register('skirmish', [sideA, sideB]);
  }

  _scavengers() {
    const p = this.game.player.controller.pos;
    const pois = this.game.world.pois.filter((q) => {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      return d > 250 && d < 700;
    });
    if (!pois.length) return;
    const poi = this.rng.pick(pois);
    const s = this._hiddenSpot(350, 520);
    if (!s) return;
    // either a raider gang or a band of survivors (squads never mix factions: these two shoot each other)
    const band = this.rng.chance(0.5) ? ['wolf_raider', 'wolf_raider', 'wolf_shooter'] : ['indep_scav', 'indep_scav', 'indep_scav'];
    const squad = this.game.ai.spawnSquad(band.slice(0, 2 + this.rng.int(0, 1)), s.x, s.z, { role: 'scav', state: 'travel' });
    for (const m of squad.members) {
      m.travelTarget = { x: poi.x, z: poi.z };
      m.travelMode = 'walk';
      m.onArrive = (a) => { a.poiId = poi.id; a.home = { x: poi.x, z: poi.z, radius: poi.radius }; a.visited = new Set(); a._enter('scav'); };
    }
    this._register('scavengers', [squad], { poi: poi.id });
  }

  _convoy() {
    const s = this._hiddenSpot(400, 650, true);
    if (!s) return;
    const rq = this.game.world.roadQuery(s.x, s.z);
    if (!rq || rq.type === 'dirt') return;
    const road = rq.road;
    const dir = this.rng.chance(0.5) ? 1 : -1;
    const pts = [];
    for (let i = rq.seg.i; i >= 0 && i < road.points.length; i += dir * 3) pts.push({ x: road.points[i][0], z: road.points[i][1] });
    if (pts.length < 10) return;
    const start = pts[0], next = pts[1];
    const yaw = Math.atan2(-(next.x - start.x), -(next.z - start.z));
    const veh = this.game.vehicles.add({ id: `convoy${this.nextId}`, type: 'mil_truck', x: start.x, z: start.z, rot: yaw, fuel: 80, transient: true });
    veh.aiRoute = { points: pts, idx: 1, speed: 10 };
    // stock the cargo with real loot
    const cargo = rollLoot('military', (Math.random() * 1e9) | 0, 12);
    for (const st of cargo.slots) if (st) veh.storage.add(st);
    const squad = this.game.ai.spawnSquad(['vsf_rifleman', 'vsf_rifleman', 'vsf_rifleman', 'vsf_gunner'], start.x, start.z, { role: 'rifleman' });
    for (const m of squad.members) this._mount(m, veh);
    const e = this._register('convoy', [squad], { vehicle: veh });
    const dismount = () => {
      if (e.dismounted) return;
      e.dismounted = true;
      veh.aiStopped = true;
      for (const m of squad.members) this._dismount(m, veh);
    };
    veh.onDestroyed = dismount;
    veh.onRouteEnd = () => { dismount(); };
    e.update = () => {
      if (e.dismounted) return;
      // stop and dismount when the player is close and visible, or the truck is damaged
      const pp = this.game.player.controller.pos;
      const d = Math.hypot(pp.x - veh.pos.x, pp.z - veh.pos.z);
      if (veh.health < veh.t.health * 0.85 || (d < 70 && this.game.physics.lineOfSight(veh.pos.x, veh.pos.y + 2.4, veh.pos.z, pp.x, pp.y + 1.5, pp.z))) dismount();
      for (const m of squad.members) if (m.mountedOn) { m.pos.copy(veh.pos); m.pos.y = veh.pos.y + 1.2; }
    };
  }

  _mount(agent, veh) {
    agent.mountedOn = veh;
    agent.model.root.visible = false;
    agent.state = 'mounted';
    this.game.characters.remove(agent);
  }

  _dismount(agent, veh) {
    if (!agent.alive) return;
    agent.mountedOn = null;
    const f = veh.forward;
    const r = { x: Math.cos(veh.yaw), z: -Math.sin(veh.yaw) };
    const side = this.rng.chance(0.5) ? 1 : -1;
    const back = (this.rng.next() - 0.5) * veh.t.dims[2] * 0.6;
    const x = veh.pos.x + r.x * side * 2.2 + f.x * back, z = veh.pos.z + r.z * side * 2.2 + f.z * back;
    agent.pos.set(x, this.game.world.heightAt(x, z), z);
    agent.model.root.visible = true;
    this.game.characters.add(agent);
    agent.state = 'idle';
    agent.post = { x, z, yaw: veh.yaw };
    const pc = this.game.player.character;
    if (agent.isEnemy(pc)) agent._reveal(pc, 0.4);
    else agent._enter('idle');
  }

  _cache() {
    const s = this._hiddenSpot(350, 600, true);
    if (!s) return;
    // an abandoned supply truck with real cargo, guarded by scavengers who found it first
    const veh = this.game.vehicles.add({ id: `cache${this.nextId}`, type: this.rng.pick(['pickup', 'utility']), x: s.x + 5, z: s.z, rot: this.rng.next() * 6, fuel: 0, health: 300, transient: true, needs: ['spark_plug'] });
    const cargo = rollLoot(this.rng.pick(['military', 'medical', 'industrial']), (Math.random() * 1e9) | 0, 12);
    for (const st of cargo.slots) if (st) veh.storage.add(st);
    if (ItemDB.exists('fuel_can')) veh.storage.add({ id: 'fuel_can', qty: 1 });
    const squad = this.game.ai.spawnSquad(this.rng.chance(0.5) ? ['indep_scav', 'indep_scav'] : ['wolf_raider', 'wolf_shooter'], s.x, s.z, { role: 'guard' });
    this._register('cache', [squad], { vehicle: veh });
  }

  // ------------------------------------------------------------ base raids
  _raidCheck(dt) {
    const base = this.game.base;
    if (!base.pieces.size) return;
    this._raidT = (this._raidT || 30) - dt;
    if (this._raidT > 0) return;
    this._raidT = 60;
    const hostile = [...base.discoveredBy].filter((f) => f !== 'guard' && this.game.factions.hostile(f, 'player'));
    if (!hostile.length) return;
    const now = this.game.clock.gameMinutes;
    if (now - base.lastRaid < 24 * 60 / Math.max(0.25, this.freq)) return; // at most one raid per game day
    if (base.pieces.size < 4) return;
    const c = base.center();
    const pp = this.game.player.controller.pos;
    if (Math.hypot(pp.x - c.x, pp.z - c.z) > 600) return; // raids happen while the player can respond
    if (this.rng.next() > 0.35 * this.freq) return;
    const faction = this.rng.pick(hostile);
    const prof = { wolves: ['wolf_raider', 'wolf_raider', 'wolf_shooter', 'wolf_raider'], vsf: ['vsf_rifleman', 'vsf_rifleman', 'vsf_gunner'], free: ['free_merc', 'free_merc', 'free_merc'], indep: ['indep_scav', 'indep_scav'] }[faction] || ['wolf_raider', 'wolf_raider'];
    const savedPos = { ...this.game.player.controller.pos };
    // spawn hidden from the player, roughly 300 m from the base
    let spot = null;
    for (let i = 0; i < 20 && !spot; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const x = c.x + Math.cos(a) * 300, z = c.z + Math.sin(a) * 300;
      if (this.game.world.waterAt(x, z) !== null) continue;
      const y = this.game.world.heightAt(x, z);
      const eye = this.game.renderer.camera.position;
      if (!this.game.physics.lineOfSight(eye.x, eye.y, eye.z, x, y + 1.6, z)) spot = { x, z };
    }
    void savedPos;
    if (!spot) return;
    const squad = this.game.ai.spawnSquad(prof, spot.x, spot.z, { role: 'raider', state: 'raid' });
    for (const m of squad.members) { m.raidTarget = { x: c.x, z: c.z }; m.role = 'raider'; }
    base.lastRaid = now;
    this._register('raid', [squad]);
    bus.emit('base:raid', { faction });
  }

  tick(dt) {
    for (const e of this.active) e.update?.(dt);
  }

  serialize() {
    return { history: this.history.slice(-20), timer: this.timer };
  }

  deserialize(o) {
    this.active = [];
    this.history = Array.isArray(o?.history) ? o.history.slice(-20) : [];
    this.timer = Number.isFinite(o?.timer) ? o.timer : 90;
  }
}
