// People of the settlements who are not combatants: traders behind their stalls and
// townsfolk walking the market. They are placed by location layouts (ctx.npcs), drawn
// with the normal character model, and kept while the location is loaded. Traders keep
// their stock, the job board and rumours between visits (saved with the game).
import * as THREE from 'three';
import traderData from '../data/traders.json';
import { CharacterModel } from '../ai/CharacterModel.js';
import { ItemDB } from '../items/ItemDatabase.js';
import { bus } from '../core/EventBus.js';
import { RNG, hashString, angleWrap } from '../core/MathUtil.js';

export const TRADERS = traderData.traders;
const VALUES = traderData.values;
const CAT_VALUE = { weapon: 150, ammo: 2, attachment: 50, medical: 10, food: 5, drink: 4, clothing: 20, backpack: 40, tool: 25, construction: 2, technical: 10, misc: 3 };
const SKINS = ['#c9a080', '#a87c5c', '#8a6040', '#d8b49a', '#6e4a32'];
const CLOTHES = ['#4a4a3e', '#5a4a3a', '#3e4a52', '#5a5040', '#4a3f46', '#3a4436', '#6a5a48'];

/** Full barter value of a stack (per unit for count 1). Weapons and lights lose value with wear. */
export function itemValue(stack, qty = stack.qty ?? 1) {
  const def = ItemDB.get(stack.id);
  if (!def) return 0;
  let v = VALUES[stack.id] ?? CAT_VALUE[def.cat] ?? 3;
  if (def.cat === 'weapon' && stack.data?.cond !== undefined) v *= 0.35 + 0.65 * stack.data.cond;
  return v * qty;
}

export const BUY_RATE = traderData.buyRate;

export class NPCSystem {
  constructor(game) {
    this.game = game;
    this.npcs = [];
    this.state = {}; // trader role -> {stock, day, jobsDay, jobsDone, rumourDay}
    bus.on('poi:built', (rt) => { for (const n of rt.npcs || []) this._spawn(n, rt.poi.id); });
    bus.on('poi:unloading', (rt) => { for (const n of [...this.npcs]) if (n.poiId === rt.poi.id) this._remove(n); });
  }

  // ------------------------------------------------------------ people
  _spawn(def, poiId) {
    if (this.game.headless) return;
    const g = this.game;
    const rng = new RNG(hashString(`${poiId}:${def.role || def.name}`));
    let look, name, title;
    if (def.kind === 'trader') {
      const T = TRADERS[def.role];
      if (!T) return;
      look = { accent: '#2a2622', gloves: '#2a2622', ...T.look };
      name = T.name; title = T.title;
    } else {
      look = { uniform: rng.pick(CLOTHES), accent: rng.pick(CLOTHES), skin: rng.pick(SKINS), pack: rng.chance(0.4), cap: rng.chance(0.35) ? rng.pick(['#3a3a30', '#5a4a3a', '#2a2a2a']) : null, gloves: '#2a2622' };
      name = def.name; title = 'Riverside resident';
    }
    look.skin = look.skin || rng.pick(SKINS);
    const model = new CharacterModel(look, g.materials);
    if (def.kind === 'civilian' && rng.chance(0.25)) model.setWeapon('wpn_rebar', null);
    const n = {
      ...def, poiId, name, title, model, rng,
      pos: new THREE.Vector3(def.x, g.physics.groundHeight(def.x, def.z, 0.3, def.y + 1.2), def.z),
      yaw: def.yaw ?? rng.next() * Math.PI * 2, baseYaw: def.yaw ?? 0, speed: 0, wait: rng.next() * 4, dest: null, talkT: 0,
    };
    model.root.position.copy(n.pos);
    model.root.rotation.y = n.yaw;
    g.renderer.scene.add(model.root);
    // a person the player's bullets can hit (they cannot be killed; shooting them angers the Guard)
    const self = this;
    n.character = {
      id: `npc:${poiId}:${name}`, faction: 'guard', isNPC: true, colliderOwner: `npcp:${name}`, vel: new THREE.Vector3(), stance: 'stand', lightOn: false,
      get pos() { return n.pos; }, get yaw() { return n.yaw; }, alive: true, firedRecently: false,
      onHit(info) { self._shot(n, info); }, onSuppressed() { n.cower = 3; },
    };
    g.characters.add(n.character);
    n.interact = g.interactables.add({
      id: `npci:${poiId}:${name}`, kind: 'npc', x: n.pos.x, y: n.pos.y + 1.2, z: n.pos.z, radius: def.kind === 'trader' ? 2.6 : 1.6,
      label: () => (def.kind === 'trader' ? `Trade with ${name} (${title})` : `Talk to ${name}`), data: { npc: n }, priority: 1,
    });
    this.npcs.push(n);
  }

  _remove(n) {
    const g = this.game;
    g.renderer.scene.remove(n.model.root);
    g.characters.remove(n.character);
    g.interactables.remove(n.interact);
    this.npcs.splice(this.npcs.indexOf(n), 1);
  }

  clear() { for (const n of [...this.npcs]) this._remove(n); }

  _shot(n, info) {
    const g = this.game;
    n.model.flinch = 1;
    n.cower = 6;
    if (info.shooter === g.player.character) {
      g.factions.onPlayerAttack('guard', false);
      bus.emit('notify', { text: `${n.name}: "Are you insane? Guards!"`, kind: 'warn', key: 'npcshot' });
    }
  }

  /** The player pressed E on a person. */
  interact(n) {
    const g = this.game;
    this._face(n, 1.5);
    if (n.kind === 'trader') {
      if (g.factions.hostile('guard', 'player')) { bus.emit('notify', { text: `${n.name}: "I'm not trading with you. Get out before the Guard sees you."`, kind: 'warn' }); return; }
      g.ui.open('trade', { npc: n, trader: this.trader(n.role) });
      return;
    }
    const lines = traderData.civilianLines;
    n.line = (n.line ?? n.rng.int(0, lines.length - 1)) + 1;
    bus.emit('notify', { text: `${n.name}: "${lines[n.line % lines.length]}"`, kind: 'info' });
    n.talkT = 5;
  }

  _face(n, t) { n.faceT = t; }

  // ------------------------------------------------------------ trader state
  trader(role) {
    const T = TRADERS[role];
    const day = this.game.clock.day;
    let s = this.state[role];
    if (!s) s = this.state[role] = { stock: [], day: -1, jobsDay: -1, jobsDone: [], rumourDay: -1 };
    if (s.day !== day) {
      // daily restock: back up to the listed quantities (items you sold them are kept)
      for (const [id, qty] of T.stock) {
        if (!ItemDB.exists(id)) continue;
        const have = s.stock.filter((x) => x.id === id).reduce((a, x) => a + x.qty, 0);
        if (have < qty) this._addStock(s, id, qty - have);
      }
      s.day = day;
    }
    if (s.jobsDay !== day) {
      s.jobsDay = day;
      s.jobsDone = [];
      const rng = new RNG(hashString(`jobs${day}`));
      const all = traderData.jobs.map((j, i) => i);
      s.jobs = [];
      while (s.jobs.length < 3 && all.length) s.jobs.push(all.splice(rng.int(0, all.length - 1), 1)[0]);
    }
    return { def: T, role, state: s, jobs: (s.jobs || []).map((i) => ({ ...traderData.jobs[i], index: i, done: s.jobsDone.includes(i) })) };
  }

  _addStock(s, id, qty) {
    const def = ItemDB.get(id);
    if (def.cat === 'weapon' || def.stack <= 1) {
      for (let i = 0; i < qty; i++) {
        const st = ItemDB.create(id, 1);
        if (st.data && def.cat === 'weapon') { st.data.cond = 0.82 + Math.random() * 0.16; st.data.ammo = 0; }
        s.stock.push(st);
      }
    } else {
      const ex = s.stock.find((x) => x.id === id && !x.data);
      if (ex) ex.qty += qty; else s.stock.push({ id, qty });
    }
  }

  /** Price multiplier from standing with the Settlement Guard. */
  priceMul() {
    const rel = this.game.factions.relation('player', 'guard');
    return rel >= 50 ? 0.85 : rel >= 25 ? 0.95 : rel < 0 ? 1.25 : 1;
  }

  // ------------------------------------------------------------ per frame
  update(dt) {
    const g = this.game;
    const pp = g.player.controller.pos;
    for (const n of this.npcs) {
      const d = Math.hypot(n.pos.x - pp.x, n.pos.z - pp.z);
      if (d > 250) { n.model.root.visible = false; continue; }
      n.model.root.visible = true;
      n.cower = Math.max(0, (n.cower || 0) - dt);
      n.talkT = Math.max(0, n.talkT - dt);
      n.faceT = Math.max(0, (n.faceT || 0) - dt);
      let speed = 0;
      let want = n.yaw;
      const near = d < 5;
      if (n.kind === 'civilian' && !n.cower && !n.talkT && !(near && d < 2.2)) {
        if (!n.dest) {
          n.wait -= dt;
          if (n.wait <= 0) {
            const A = n.area;
            const t = (n.rng.next() * 2 - 1) * A.len, o = (n.rng.next() * 2 - 1) * A.wid;
            n.dest = { x: g.pois.active.get(n.poiId)?.poi.x + A.x + A.dx * t + A.nx * o, z: g.pois.active.get(n.poiId)?.poi.z + A.z + A.dz * t + A.nz * o };
            if (!Number.isFinite(n.dest.x)) n.dest = null;
            n.stuck = 0;
          }
        } else {
          const dx = n.dest.x - n.pos.x, dz = n.dest.z - n.pos.z, L = Math.hypot(dx, dz);
          if (L < 0.6 || n.stuck > 3) { n.dest = null; n.wait = 2 + n.rng.next() * 7; }
          else {
            const sp = 1.25;
            const r = g.physics.moveCylinder(n.pos, (dx / L) * sp * dt, (dz / L) * sp * dt, 0.3, 1.7, 0.45, n.character.colliderOwner);
            const moved = Math.hypot(r.x - n.pos.x, r.z - n.pos.z);
            if (moved < sp * dt * 0.3) n.stuck += dt; else n.stuck = Math.max(0, n.stuck - dt);
            n.pos.x = r.x; n.pos.z = r.z;
            n.pos.y = g.physics.groundHeight(n.pos.x, n.pos.z, 0.3, n.pos.y + 0.5);
            speed = moved / Math.max(dt, 1e-4);
            want = Math.atan2(-dx, -dz);
          }
        }
      }
      // look at the player when they come close (traders always face their customer)
      if ((near || n.faceT || n.talkT) && !n.cower) want = Math.atan2(-(pp.x - n.pos.x), -(pp.z - n.pos.z));
      else if (n.kind === 'trader') want = n.baseYaw;
      n.yaw += angleWrap(want - n.yaw) * Math.min(1, dt * 5);
      n.model.root.position.copy(n.pos);
      n.model.root.rotation.y = n.yaw;
      if (d < 120 || g.ai.frame % 3 === 0) n.model.animate(d < 120 ? dt : dt * 3, { speed, crouch: n.cower ? 1 : 0, aiming: 0, aimPitch: 0 });
      g.interactables.move(n.interact, n.pos.x, n.pos.y + 1.2, n.pos.z);
    }
  }

  // ------------------------------------------------------------ persistence
  serialize() { return { traders: this.state }; }

  deserialize(o) {
    this.state = {};
    const t = o?.traders;
    if (!t || typeof t !== 'object') return;
    for (const [role, s] of Object.entries(t)) {
      if (!TRADERS[role] || !s || !Array.isArray(s.stock)) continue;
      this.state[role] = {
        stock: s.stock.filter((x) => x && ItemDB.exists(x.id) && x.qty > 0),
        day: s.day | 0, jobsDay: s.jobsDay ?? -1, jobs: Array.isArray(s.jobs) ? s.jobs : [], jobsDone: Array.isArray(s.jobsDone) ? s.jobsDone : [], rumourDay: s.rumourDay ?? -1,
      };
    }
  }
}
