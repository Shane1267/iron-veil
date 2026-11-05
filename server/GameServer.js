// Online co-op server: one shared world, many browsers.
//
// Authority split (stage 1, co-operative play):
//   server  — AI (spawning, perception, tactics, shooting), damage to AI, bodies and their
//             contents, doors, time of day, weather, faction relations.
//   client  — the player's own movement, health, inventory, containers, bases and vehicles.
// The server re-simulates every player shot with the real ballistics, so AI react to it
// exactly as in single player. Damage the AI deals to a player is sent to that player's
// browser, which applies it with their armour.
import { HeadlessGame } from './HeadlessGame.js';
import { NetPlayer } from './NetPlayer.js';
import { ItemDB } from '../src/items/ItemDatabase.js';
import { Inventory } from '../src/items/Inventory.js';
import { effectiveWeapon, fireInterval } from '../src/weapons/WeaponData.js';
import { bus } from '../src/core/EventBus.js';
import { PROTOCOL_VERSION, SNAPSHOT_HZ, INTEREST_RADIUS, SHOT_RADIUS, packAgent, packPlayer, r2, r3 } from '../src/net/protocol.js';

const TICK_HZ = 30;
const MAX_PLAYERS = 16;

class Conn {
  constructor(ws, server) {
    this.ws = ws;
    this.server = server;
    this.player = null;
    this.known = new Map(); // agent id -> dead?
    this.knownPlayers = new Set();
    this.msgCount = 0;
    this.msgWindow = 0;
    this.lastSeen = Date.now();
  }
  send(o) {
    if (this.ws.readyState !== 1) return;
    try { this.ws.send(JSON.stringify(o)); } catch { /* socket closing */ }
  }
}

export class GameServer {
  constructor(opts = {}) {
    this.opts = { pvp: false, maxPlayers: MAX_PLAYERS, ...opts };
    this.game = new HeadlessGame(this.opts);
    this.conns = new Set();
    this.nextId = 1;
    this.shotBuf = new Map();
    this.weaponCache = new Map();
    this.snapT = 0;
    this.envT = 0;
    this.stats = { ticks: 0, tickMs: 0 };
    this._hook();
  }

  get playerCount() { let n = 0; for (const c of this.conns) if (c.player) n++; return n; }

  // ------------------------------------------------------------ world hooks
  _hook() {
    const g = this.game;
    const fire = g.ballistics.fire.bind(g.ballistics);
    g.ballistics.fire = (shot) => {
      const sh = shot.shooter;
      if (sh && !shot.visual) {
        let b = this.shotBuf.get(sh);
        if (!b) {
          b = { s: sh.id, o: [r2(shot.ox), r2(shot.oy), r2(shot.oz)], d: [], w: shot.weapon.id, at: sh.isAI ? (sh.weapon?.data?.attach || null) : (shot.attach || null), tr: 0 };
          this.shotBuf.set(sh, b);
        }
        if (b.d.length < 12) b.d.push([r3(shot.dx), r3(shot.dy), r3(shot.dz)]);
        if (shot.tracer) b.tr = 1;
      }
      return fire(shot);
    };
    bus.on('npc:died', (e) => {
      const a = e.agent;
      const msg = { t: 'die', id: a.id, dir: a.model.deathDir ?? 1, side: r2(a.model.deathSide ?? 0), zone: e.zone || null, by: e.killer?.isPlayer ? e.killer.id : null };
      for (const c of this.conns) if (c.known.has(a.id)) { c.known.set(a.id, true); c.send(msg); }
      if (e.killer?.isPlayer && e.killer.conn) e.killer.conn.send({ t: 'kill', id: a.id, f: a.faction, zone: e.zone || null });
    });
    bus.on('door:toggled', (e) => this.broadcast({ t: 'door', id: e.id, open: e.open }));
    bus.on('notify', (e) => { if (e.kind === 'warn' && /hostile/.test(e.text)) this.broadcast({ t: 'notify', text: e.text, kind: 'warn' }); });
  }

  broadcast(o, except = null) {
    for (const c of this.conns) if (c.player && c !== except) c.send(o);
  }

  _weapon(id, attach) {
    const key = `${id}|${attach ? JSON.stringify(attach) : ''}`;
    let w = this.weaponCache.get(key);
    if (w === undefined) {
      const st = ItemDB.weapon(id) ? ItemDB.create(id, 1) : null;
      if (st && attach && typeof attach === 'object') st.data.attach = { ...attach };
      w = st ? effectiveWeapon(st) : null;
      this.weaponCache.set(key, w);
    }
    return w;
  }

  // ------------------------------------------------------------ connections
  attach(wss) {
    wss.on('connection', (ws, req) => {
      const c = new Conn(ws, this);
      c.ip = req?.socket?.remoteAddress || '';
      this.conns.add(c);
      ws.on('message', (data) => {
        c.lastSeen = Date.now();
        // basic flood guard: at most ~120 messages per second
        const now = Date.now();
        if (now - c.msgWindow > 1000) { c.msgWindow = now; c.msgCount = 0; }
        if (++c.msgCount > 120) return;
        if (data.length > 64 * 1024) return;
        let m;
        try { m = JSON.parse(data.toString()); } catch { return; }
        if (!m || typeof m.t !== 'string') return;
        try { this._onMessage(c, m); } catch (err) { console.error('[server] message', m.t, 'failed:', err); }
      });
      ws.on('close', () => this._drop(c));
      ws.on('error', () => this._drop(c));
    });
  }

  _drop(c) {
    if (!this.conns.has(c)) return;
    this.conns.delete(c);
    const p = c.player;
    if (p) {
      p.alive = false;
      p.joined = false;
      this.game.characters.remove(p);
      this.game.players.delete(p.id);
      this.broadcast({ t: 'left', id: p.id, name: p.name });
      console.log(`[server] ${p.name} left (${this.playerCount} online)`);
    }
  }

  _onMessage(c, m) {
    const g = this.game;
    if (m.t === 'hello') {
      if (c.player) return;
      if (m.v !== PROTOCOL_VERSION) { c.send({ t: 'reject', reason: `This server runs a different version of the game (protocol ${PROTOCOL_VERSION}, yours ${m.v}). Reload the page.` }); c.ws.close(); return; }
      if (this.playerCount >= this.opts.maxPlayers) { c.send({ t: 'reject', reason: 'Server is full' }); c.ws.close(); return; }
      const name = String(m.name || 'Survivor').replace(/[^\w \-.']/g, '').trim().slice(0, 20) || 'Survivor';
      const id = `p${this.nextId++}`;
      const p = new NetPlayer(g, c, id, name);
      c.player = p;
      g.players.set(id, p);
      c.send({
        t: 'welcome', id, pvp: !!this.opts.pvp, name,
        gm: g.clock.gameMinutes, wx: g.weather.state, fac: this._factions(),
        doors: [...g.doorState.entries()],
        players: [...g.players.values()].filter((o) => o !== p).map((o) => ({ id: o.id, name: o.name })),
        motd: this.opts.motd || '',
      });
      this.broadcast({ t: 'joined', id, name }, c);
      console.log(`[server] ${name} joined (${this.playerCount} online)`);
      return;
    }
    const p = c.player;
    if (!p) return;
    switch (m.t) {
      case 'spawn': {
        p.applyState(m, true);
        p.alive = true;
        p.joined = true;
        g.characters.add(p);
        c.known.clear();
        break;
      }
      case 'st': if (p.joined) p.applyState(m); break;
      case 'died': {
        if (!p.alive) break;
        p.alive = false;
        this.broadcast({ t: 'notify', text: `${p.name} died`, kind: 'warn' }, c);
        break;
      }
      case 'fire': this._fire(c, p, m); break;
      case 'melee': this._melee(p, m); break;
      case 'door': {
        if (typeof m.id !== 'string') break;
        const open = !!m.open;
        const d = g.doors.get(m.id);
        if (d) {
          // out of reach: put the client's door back the way everyone else sees it
          if (Math.hypot(d.center.x - p.pos.x, d.center.z - p.pos.z) > 6) { c.send({ t: 'door', id: m.id, open: d.open }); break; }
          d.toggle(open);
        } else {
          // a location the server has not built (nobody else near): just remember the state
          g.doorState.set(m.id, open);
          this.broadcast({ t: 'door', id: m.id, open });
        }
        bus.emit('sound', { type: 'door', x: p.pos.x, y: p.pos.y, z: p.pos.z, char: p });
        break;
      }
      case 'corpse': this._corpseOpen(c, p, m); break;
      case 'corpse:set': this._corpseSet(c, p, m); break;
      case 'chat': {
        const text = String(m.text || '').slice(0, 200).trim();
        if (text) this.broadcast({ t: 'chat', from: p.name, id: p.id, text });
        break;
      }
      case 'ping': c.send({ t: 'pong', c: m.c }); break;
      case 'ka': break; // keep-alive (lastSeen already updated)
      default: break;
    }
  }

  _fire(c, p, m) {
    const g = this.game;
    if (!p.alive || !Array.isArray(m.o) || !Array.isArray(m.d) || !m.d.length) { p.rejected = (p.rejected || 0) + 1; return; }
    const w = this._weapon(m.w, m.at);
    if (!w || w.class === 'melee') return;
    const [ox, oy, oz] = m.o.map(Number);
    if (![ox, oy, oz].every(Number.isFinite)) return;
    // the muzzle has to be where the player is
    if (Math.hypot(ox - p.pos.x, oz - p.pos.z) > 3 || Math.abs(oy - (p.pos.y + 1.2)) > 2.5) { p.rejected = (p.rejected || 0) + 1; return; }
    // fire rate (lenient: network jitter bunches shots together)
    const minGap = Math.min(fireInterval(w), w.cycleTime || 0) * 0.45;
    if (g.time - p.lastFireT < minGap) return;
    p.lastFireT = g.time;
    const pellets = Math.min(m.d.length, w.pellets || 1);
    for (let i = 0; i < pellets; i++) {
      let [dx, dy, dz] = (m.d[i] || []).map(Number);
      const L = Math.hypot(dx, dy, dz);
      if (!(L > 0.5 && L < 1.5)) continue;
      dx /= L; dy /= L; dz /= L;
      g.ballistics.fire({ ox, oy, oz, dx, dy, dz, weapon: w, shooter: p, damageMul: w.damageMul, tracer: !!m.tr, attach: m.at || null });
    }
    p.lastShot = g.time;
    p.shots = (p.shots || 0) + 1;
    bus.emit('weapon:fired', { weapon: w, x: ox, y: oy, z: oz, player: true, shooter: p, noise: w.noise * (w.noiseMul || 1), suppressed: !w.flash || w.noiseMul < 1 });
  }

  _melee(p, m) {
    const g = this.game;
    if (!p.alive) return;
    const a = g.ai.agents.find((x) => x.id === m.id);
    const w = ItemDB.weapon(m.w);
    if (!a || !a.alive || !w || w.class !== 'melee') return;
    if (Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) > (w.range || 2) + 1.5) return;
    const zone = ['head', 'torso', 'arm', 'leg'].includes(m.zone) ? m.zone : 'torso';
    const dir = Array.isArray(m.dir) ? { x: +m.dir[0] || 0, y: +m.dir[1] || 0, z: +m.dir[2] || 0 } : { x: 0, y: 0, z: -1 };
    a.onHit({ zone, base: w.damage, weapon: null, distance: 1, mul: 1, shooter: p, dir, point: { x: a.pos.x, y: a.pos.y + 1.2, z: a.pos.z }, cause: 'melee' });
    bus.emit('noise', { x: p.pos.x, y: p.pos.y, z: p.pos.z, radius: 15, source: p, type: 'melee' });
  }

  // ------------------------------------------------------------ bodies
  _corpse(id) {
    return this.game.ai.corpses.find((c) => c.agent.id === id) || null;
  }

  _corpseOpen(c, p, m) {
    const k = this._corpse(m.id);
    if (!k) { c.send({ t: 'corpse', id: m.id, gone: true }); return; }
    if (Math.hypot(k.agent.pos.x - p.pos.x, k.agent.pos.z - p.pos.z) > 5) { c.send({ t: 'corpse', id: m.id, far: true }); return; }
    k.rev = k.rev || 1;
    c.send({ t: 'corpse', id: m.id, rev: k.rev, inv: k.inv.serialize() });
  }

  /** A player changed a body's contents. Last writer wins only if they saw the latest version. */
  _corpseSet(c, p, m) {
    const k = this._corpse(m.id);
    if (!k) { c.send({ t: 'corpse', id: m.id, gone: true }); return; }
    k.rev = k.rev || 1;
    if (m.rev !== k.rev || Math.hypot(k.agent.pos.x - p.pos.x, k.agent.pos.z - p.pos.z) > 6) {
      c.send({ t: 'corpse', id: m.id, rev: k.rev, inv: k.inv.serialize(), denied: true });
      return;
    }
    const inv = Inventory.deserialize(m.inv, 'Body');
    k.inv.slots = inv.slots;
    k.inv.version++;
    k.rev++;
    const out = { t: 'corpse', id: m.id, rev: k.rev, inv: k.inv.serialize() };
    for (const o of this.conns) if (o.player && o.known.has(m.id)) o.send(out);
  }

  // ------------------------------------------------------------ ticking
  _factions() {
    const f = this.game.factions;
    const prov = {};
    for (const [k, v] of Object.entries(f.provoked)) if (v > f.time) prov[k] = r2(v - f.time);
    return { rel: f.rel, prov };
  }

  tick(dt) {
    const t0 = performance.now();
    const g = this.game;
    g.step(dt);
    // gunfire heard and seen by everyone near it
    for (const [sh, b] of this.shotBuf) {
      for (const c of this.conns) {
        const p = c.player;
        if (!p || !p.joined || p === sh) continue;
        if (Math.hypot(p.pos.x - b.o[0], p.pos.z - b.o[2]) > SHOT_RADIUS) continue;
        c.send({ t: 'shot', ...b });
      }
    }
    this.shotBuf.clear();
    this.snapT -= dt;
    if (this.snapT <= 0) { this.snapT += 1 / SNAPSHOT_HZ; this._snapshots(); }
    this.envT -= dt;
    if (this.envT <= 0) {
      this.envT = 2;
      this.broadcast({ t: 'env', gm: r2(g.clock.gameMinutes), wx: g.weather.state, fac: this._factions(), n: this.playerCount });
    }
    this.stats.ticks++;
    this.stats.tickMs = this.stats.tickMs * 0.98 + (performance.now() - t0) * 0.02;
  }

  _snapshots() {
    const g = this.game;
    for (const c of this.conns) {
      const me = c.player;
      if (!me || !me.joined) continue;
      const a = [], s = [], gone = [], seen = new Set();
      for (const ag of g.ai.agents) {
        if (ag.removed) continue;
        if (Math.hypot(ag.pos.x - me.pos.x, ag.pos.z - me.pos.z) > INTEREST_RADIUS) continue;
        seen.add(ag.id);
        if (!c.known.has(ag.id)) {
          c.known.set(ag.id, !ag.alive);
          s.push({ id: ag.id, f: ag.faction, look: ag.look, w: ag.weapon?.id || null, at: ag.weapon?.data?.attach || null, dead: !ag.alive, dir: ag.model.deathDir ?? 1, side: r2(ag.model.deathSide ?? 0), x: r2(ag.pos.x), y: r2(ag.pos.y), z: r2(ag.pos.z), yaw: r3(ag.yaw) });
        }
        if (ag.alive) a.push(packAgent(ag));
      }
      for (const id of c.known.keys()) if (!seen.has(id)) { gone.push(id); c.known.delete(id); }
      const p = [], ps = [], pg = [], pseen = new Set();
      for (const o of g.players.values()) {
        if (o === me || !o.joined) continue;
        if (Math.hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z) > INTEREST_RADIUS * 1.5) continue;
        pseen.add(o.id);
        if (!c.knownPlayers.has(o.id)) { c.knownPlayers.add(o.id); ps.push({ id: o.id, name: o.name }); }
        p.push(packPlayer(o));
      }
      for (const id of c.knownPlayers) if (!pseen.has(id)) { pg.push(id); c.knownPlayers.delete(id); }
      const msg = { t: 'snap', T: r2(g.time), a, p };
      if (s.length) msg.s = s;
      if (gone.length) msg.g = gone;
      if (ps.length) msg.ps = ps;
      if (pg.length) msg.pg = pg;
      c.send(msg);
    }
  }

  start() {
    let last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      try { this.tick(dt); } catch (e) { console.error('[server] tick failed', e); }
    }, 1000 / TICK_HZ);
    // drop silent connections
    this.reaper = setInterval(() => {
      const now = Date.now();
      for (const c of this.conns) if (now - c.lastSeen > 45000) { try { c.ws.terminate?.(); } catch { /* gone */ } this._drop(c); }
    }, 5000);
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.reaper);
  }
}
