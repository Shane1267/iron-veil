// Browser side of online co-op. Connects to the server, reports the player's movement and
// shots, and mirrors what the server simulates: AI people, other players, gunfire, bodies,
// doors, time of day, weather and faction standing.
import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { ItemDB } from '../items/ItemDatabase.js';
import { Inventory } from '../items/Inventory.js';
import { effectiveWeapon } from '../weapons/WeaponData.js';
import { PROTOCOL_VERSION, CLIENT_STATE_HZ, unpackAgent, unpackPlayer, r2, r3 } from './protocol.js';
import { RemoteAgent, RemotePlayer, INTERP_DELAY } from './RemoteActors.js';
import { h } from '../ui/dom.js';

/** Turn what a player typed ("iron-veil.onrender.com", "https://…", "") into a WebSocket URL. */
export function serverUrl(input) {
  let s = String(input || '').trim();
  if (!s) {
    if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }
  if (/^wss?:\/\//i.test(s)) return s.replace(/\/+$/, '').replace(/(\/ws)?$/, '/ws');
  let secure = true;
  if (/^http:\/\//i.test(s)) secure = false;
  s = s.replace(/^https?:\/\//i, '').replace(/\/+$/, '').replace(/\/ws$/, '');
  if (/^(localhost|127\.|192\.168\.|10\.)/.test(s)) secure = /^https:/i.test(input.trim());
  return `${secure ? 'wss' : 'ws'}://${s}/ws`;
}

export class NetClient {
  constructor(game) {
    this.game = game;
    this.ws = null;
    this.id = null;
    this.connected = false;
    this.agents = new Map();
    this.players = new Map();
    this.names = new Map();
    this.doorState = new Map();
    this.doorIndex = new Map();
    this.frame = 0;
    this.stateT = 0;
    this.serverT = 0;
    this.recvAt = 0;
    this.fireBuf = null;
    this.corpses = new Map(); // agent id -> {inv, rev, sentVersion}
    this.weapons = new Map();
    this.ping = 0;
    this.pingT = 0;
    this.chatting = false;
    this.onClose = null;
    this._unsub = [];
    this.counts = {}; // messages received by type (status line, tests)
    this.shotsFrom = {};
  }

  // ------------------------------------------------------------ connection
  connect(input, name, onStatus = () => {}) {
    const url = serverUrl(input);
    if (!url) return Promise.reject(new Error('Enter the server address'));
    this.url = url;
    return new Promise((resolve, reject) => {
      let done = false;
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject(new Error(`Bad server address (${e.message})`)); return; }
      this.ws = ws;
      // free hosting sleeps when idle: the first connection can take up to a minute
      const slow = setTimeout(() => { if (!done) onStatus('Waking the server up (free servers sleep when nobody plays — this can take a minute)…'); }, 4000);
      const timeout = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch { /* closed */ } reject(new Error('The server did not answer. Check the address and try again.')); } }, 90000);
      const finish = (err, val) => { if (done) return; done = true; clearTimeout(slow); clearTimeout(timeout); if (err) reject(err); else resolve(val); };
      ws.onopen = () => { onStatus('Connected — joining'); ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name })); };
      ws.onerror = () => finish(new Error('Could not reach the server. Check the address — and that the server is running.'));
      ws.onclose = (ev) => {
        if (!done) { finish(new Error(this.rejectReason || `Connection closed (${ev.code})`)); return; }
        if (this.connected) { this.connected = false; this.onClose?.(this.rejectReason || 'Lost connection to the server'); }
      };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'reject') { this.rejectReason = m.reason; finish(new Error(m.reason)); return; }
        if (m.t === 'welcome') { this._welcome(m); finish(null, m); return; }
        try { this._onMessage(m); } catch (e) { console.error('[net] message', m.t, e); }
      };
    });
  }

  send(o) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o));
  }

  _welcome(m) {
    const g = this.game;
    this.id = m.id;
    this.connected = true;
    this.pvp = !!m.pvp;
    g.characters.pvp = this.pvp;
    for (const p of m.players || []) this.names.set(p.id, p.name);
    for (const [id, open] of m.doors || []) this.doorState.set(id, open);
    this.welcome = m;
    this._env(m, true);
    this._hook();
  }

  /** Wire local game events to the server. */
  _hook() {
    const g = this.game;
    const fire = g.ballistics.fire.bind(g.ballistics);
    this._origFire = fire;
    g.ballistics.fire = (shot) => {
      if (shot.shooter === g.player.character && !shot.visual) {
        if (!this.fireBuf) this.fireBuf = { t: 'fire', o: [r2(shot.ox), r2(shot.oy), r2(shot.oz)], d: [], w: shot.weapon.id, at: g.weapons?.stack?.data?.attach || null, tr: shot.tracer ? 1 : 0 };
        this.fireBuf.d.push([r3(shot.dx), r3(shot.dy), r3(shot.dz)]);
      }
      return fire(shot);
    };
    this._unsub.push(
      bus.on('door:toggled', (e) => this.send({ t: 'door', id: e.id, open: e.open })),
      bus.on('player:died', () => this.send({ t: 'died' })),
      bus.on('poi:built', (rt) => {
        for (const d of rt.doors || []) {
          if (!d.id) continue;
          this.doorIndex.set(d.id, d);
          if (this.doorState.has(d.id) && this.doorState.get(d.id) !== d.open) { d.toggle(this.doorState.get(d.id), true); d.angle = d.open ? d.def.swing : 0; d.pivot.rotation.y = d.baseYaw + d.angle; }
        }
      }),
      bus.on('poi:unloading', (rt) => { for (const d of rt.doors || []) this.doorIndex.delete(d.id); }),
    );
    // doors already standing
    for (const rt of g.pois.active.values()) for (const d of rt.doors || []) if (d.id) this.doorIndex.set(d.id, d);
    this._chatKey = (e) => {
      if (e.code !== 'Enter' || this.chatting || !g.started || g.ui.mode !== 'playing') return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      this.openChat();
    };
    window.addEventListener('keydown', this._chatKey);
    this._chatLog();
  }

  /** The player has a body in the world (joined, respawned, loaded). */
  spawned() {
    const pc = this.game.player.controller;
    this.send({ t: 'spawn', ...this._state(), x: pc.pos.x, y: pc.pos.y, z: pc.pos.z });
  }

  _state() {
    const g = this.game, pc = g.player.controller;
    const veh = g.vehicles?.current;
    const p = veh ? veh.pos : pc.pos;
    return {
      x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r3(veh ? veh.yaw || 0 : pc.yaw), pitch: r3(pc.pitch), st: pc.stance,
      alive: !g.player.survival.dead, light: !!g.weapons?.lightActive, w: g.weapons?.w?.id || null, veh: veh ? 1 : 0,
    };
  }

  dispose() {
    const g = this.game;
    for (const u of this._unsub) u();
    this._unsub = [];
    if (this._origFire) g.ballistics.fire = this._origFire;
    if (this._chatKey) window.removeEventListener('keydown', this._chatKey);
    this.chatEl?.remove();
    this.logEl?.remove();
    for (const a of this.agents.values()) a.dispose();
    for (const p of this.players.values()) p.dispose();
    this.agents.clear();
    this.players.clear();
    g.characters.pvp = true;
    this.connected = false;
    try { this.ws?.close(); } catch { /* already closed */ }
  }

  // ------------------------------------------------------------ per frame
  update(dt) {
    this.frame++;
    if (!this.connected) return;
    if (this.fireBuf) { this.send(this.fireBuf); this.fireBuf = null; }
    this.stateT -= dt;
    if (this.stateT <= 0) { this.stateT = 1 / CLIENT_STATE_HZ; this.send({ t: 'st', ...this._state() }); }
    this.pingT -= dt;
    if (this.pingT <= 0) { this.pingT = 5; this.send({ t: 'ping', c: performance.now() }); }
    const T = this.serverT + (performance.now() - this.recvAt) / 1000 - INTERP_DELAY;
    for (const a of this.agents.values()) a.apply(dt, T);
    for (const p of this.players.values()) p.apply(dt, T);
    // body contents changed in the inventory screen: send them to the server
    for (const [id, c] of this.corpses) {
      if (c.inv.version !== c.sentVersion) {
        c.sentVersion = c.inv.version;
        this.send({ t: 'corpse:set', id, rev: c.rev, inv: c.inv.serialize() });
      }
    }
  }

  // ------------------------------------------------------------ messages
  _onMessage(m) {
    const g = this.game;
    this.counts[m.t] = (this.counts[m.t] || 0) + 1;
    switch (m.t) {
      case 'snap': this._snap(m); break;
      case 'shot': this._shot(m); break;
      case 'hit': this._hit(m); break;
      case 'whiz': g.player.onSuppressed({ distance: m.d, x: m.x, y: m.y, z: m.z }); break;
      case 'die': { const a = this.agents.get(m.id); if (a) a.die(m.dir, m.side); break; }
      case 'kill': {
        const a = this.agents.get(m.id);
        bus.emit('npc:died', { agent: a || { id: m.id, faction: m.f }, killer: g.player.character, zone: m.zone, remote: true });
        break;
      }
      case 'door': {
        this.doorState.set(m.id, m.open);
        const d = this.doorIndex.get(m.id);
        if (d && d.open !== m.open) d.toggle(m.open, true);
        break;
      }
      case 'corpse': this._corpse(m); break;
      case 'env': this._env(m); break;
      case 'chat': this._log(`${m.from}: ${m.text}`, m.id === this.id ? 'me' : 'chat'); break;
      case 'joined': this.names.set(m.id, m.name); this._log(`${m.name} joined`, 'sys'); break;
      case 'left': {
        this._log(`${m.name} left`, 'sys');
        const p = this.players.get(m.id);
        if (p) { p.dispose(); this.players.delete(m.id); }
        break;
      }
      case 'notify': bus.emit('notify', { text: m.text, kind: m.kind || 'info' }); break;
      case 'pong': this.ping = performance.now() - m.c; break;
      default: break;
    }
  }

  _snap(m) {
    this.serverT = m.T;
    this.recvAt = performance.now();
    for (const info of m.s || []) {
      this.agents.get(info.id)?.dispose();
      const a = new RemoteAgent(this, info);
      a.push(m.T - 0.001, { x: info.x, y: info.y, z: info.z, yaw: info.yaw, speed: 0 });
      this.agents.set(info.id, a);
    }
    for (const id of m.g || []) {
      const a = this.agents.get(id);
      if (a) { a.dispose(); this.agents.delete(id); this.corpses.delete(id); }
    }
    for (const e of m.a) {
      const s = unpackAgent(e);
      this.agents.get(s.id)?.push(m.T, s);
    }
    for (const info of m.ps || []) {
      this.players.get(info.id)?.dispose();
      this.names.set(info.id, info.name);
      this.players.set(info.id, new RemotePlayer(this, info));
    }
    for (const id of m.pg || []) {
      const p = this.players.get(id);
      if (p) { p.dispose(); this.players.delete(id); }
    }
    for (const e of m.p || []) {
      const s = unpackPlayer(e);
      this.players.get(s.id)?.push(m.T, s);
    }
  }

  _weapon(id, attach) {
    const key = `${id}|${attach ? JSON.stringify(attach) : ''}`;
    let w = this.weapons.get(key);
    if (w === undefined) {
      const st = ItemDB.weapon(id) ? ItemDB.create(id, 1) : null;
      if (st && attach) st.data.attach = { ...attach };
      w = st ? effectiveWeapon(st) : null;
      this.weapons.set(key, w);
    }
    return w;
  }

  /** Someone else fired: replay it for sound, muzzle flash, tracers and impacts. */
  _shot(m) {
    const g = this.game;
    this.shotsFrom[m.s] = (this.shotsFrom[m.s] || 0) + 1;
    const w = this._weapon(m.w, m.at);
    if (!w) return;
    const who = this.agents.get(m.s) || this.players.get(m.s) || null;
    const [ox, oy, oz] = m.o;
    const pc = g.player.controller.pos;
    const near = Math.hypot(ox - pc.x, oz - pc.z) < 150;
    const muzzle = near && who?.model?.weapon && who.model.root.visible ? who.model.muzzleWorld(new THREE.Vector3()) : null;
    m.d.forEach((d, i) => {
      g.ballistics.fire({ ox, oy, oz, dx: d[0], dy: d[1], dz: d[2], weapon: w, shooter: who, visual: true, muzzle, tracer: !!(muzzle && m.tr && i === 0) });
    });
    if (muzzle && w.flash && g.effects.worldFlash) g.effects.worldFlash(muzzle.x, muzzle.y, muzzle.z, w.class === 'pistol' ? 0.7 : 1, true);
    if (who?.model) who.model.flinch = Math.max(who.model.flinch, 0.15);
    bus.emit('weapon:fired', { weapon: w, x: ox, y: oy, z: oz, npc: who, remote: true, noise: (w.noise || 300) * (w.noiseMul || 1), suppressed: !w.flash || (w.noiseMul || 1) < 1 });
  }

  /** The server says we were hit: apply it with our own armour and health. */
  _hit(m) {
    const g = this.game;
    if (g.player.survival.dead) return;
    const w = m.w ? ItemDB.weapon(m.w) : null;
    const dir = m.dir ? { x: m.dir[0], y: m.dir[1], z: m.dir[2] } : null;
    const shooter = this.agents.get(m.from) || this.players.get(m.from) || null;
    g.player.onHit({ zone: m.zone, base: m.base, weapon: w, distance: m.dist, penetrationLoss: m.loss, mul: m.mul, dir, cause: m.cause, shooter });
    const pc = g.player.controller.pos;
    g.effects.blood({ x: pc.x, y: pc.y + 1.3, z: pc.z }, dir || { x: 0, y: 0, z: -1 });
  }

  _env(m, instant = false) {
    const g = this.game;
    if (Number.isFinite(m.gm) && (instant || Math.abs(g.clock.gameMinutes - m.gm) > 0.5)) g.clock.gameMinutes = m.gm;
    if (m.wx && g.weather.state !== m.wx) g.weather.set(m.wx, instant);
    if (m.fac?.rel) {
      const f = g.factions;
      for (const [k, v] of Object.entries(m.fac.rel)) f.rel[k] = { ...v };
      f.provoked = {};
      for (const [k, v] of Object.entries(m.fac.prov || {})) f.provoked[k] = f.time + v;
    }
    if (Number.isFinite(m.n)) this.online = m.n;
  }

  // ------------------------------------------------------------ bodies
  /** Open a body the server owns. The contents arrive from the server, then the normal inventory screen opens. */
  openCorpse(id, name) {
    this.pendingCorpse = { id, name };
    this.send({ t: 'corpse', id });
  }

  _corpse(m) {
    const g = this.game;
    const lootId = `net:${m.id}`;
    if (m.gone) {
      this.corpses.delete(m.id);
      if (this.pendingCorpse?.id === m.id) { this.pendingCorpse = null; bus.emit('notify', { text: 'Nothing here', kind: 'info' }); }
      return;
    }
    const fresh = Inventory.deserialize(m.inv, 'Body');
    let c = this.corpses.get(m.id);
    if (c) {
      // update in place so an open inventory screen refreshes
      c.inv.slots.length = fresh.slots.length;
      for (let i = 0; i < fresh.slots.length; i++) c.inv.slots[i] = fresh.slots[i];
      c.inv.version++;
      c.sentVersion = c.inv.version;
      c.rev = m.rev;
      if (m.denied) bus.emit('notify', { text: 'Someone else moved items on this body first', kind: 'info' });
    } else {
      c = { inv: fresh, rev: m.rev, sentVersion: fresh.version };
      this.corpses.set(m.id, c);
      g.loot.register(lootId, fresh, { transient: true });
    }
    if (this.pendingCorpse?.id === m.id) {
      this.pendingCorpse = null;
      g.ui.open('inventory', { inv: c.inv, name: 'Body', id: lootId, onClose: () => { /* contents already sent as they changed */ } });
    }
  }

  // ------------------------------------------------------------ chat
  _chatLog() {
    this.logEl = h('div', { class: 'net-chat-log' });
    document.body.appendChild(this.logEl);
  }

  _log(text, kind = 'chat') {
    if (!this.logEl) return;
    const line = h('div', { class: `line ${kind}` }, text);
    this.logEl.appendChild(line);
    while (this.logEl.children.length > 8) this.logEl.firstChild.remove();
    setTimeout(() => line.classList.add('fade'), 12000);
    setTimeout(() => line.remove(), 14000);
  }

  openChat() {
    const g = this.game;
    this.chatting = true;
    const input = h('input', { class: 'net-chat-input', maxlength: '200', placeholder: 'Say something — Enter to send, Esc to cancel' });
    this.chatEl = input;
    document.body.appendChild(input);
    try { document.exitPointerLock?.(); } catch { /* not locked */ }
    input.focus();
    const close = (sendIt) => {
      if (!this.chatting) return;
      if (sendIt && input.value.trim()) this.send({ t: 'chat', text: input.value.trim() });
      input.remove();
      this.chatEl = null;
      // keep the lock-change handler from opening the pause menu
      setTimeout(() => { this.chatting = false; }, 50);
      g.input.lock();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter') { e.preventDefault(); close(true); }
      if (e.code === 'Escape') { e.preventDefault(); close(false); }
    });
    input.addEventListener('blur', () => close(false));
  }
}
