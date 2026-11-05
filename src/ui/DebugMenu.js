// Field debug menu: opened with Tab+3, behind a keypad code. A compact list menu in the
// top-left corner that stays open while you play: a banner, the current page title, a
// scrolling list with one highlighted row, value pickers shown as ‹ value ›, a position
// counter and a description line. Navigation: ↑/↓ move, Enter selects, ←/→ change a value,
// Backspace goes back (closes on the first page). Numpad 8/2/4/6/5/0 work the same.
import * as THREE from 'three';
import { h, clear } from './dom.js';
import { bus } from '../core/EventBus.js';
import { ItemDB } from '../items/ItemDatabase.js';
import { SKILLS } from '../player/Player.js';
import { settings } from '../core/SettingsManager.js';

const CODE = '3209';
const VISIBLE = 11;
const WEATHER = ['clear', 'cloudy', 'overcast', 'fog', 'rain', 'storm'];
const CAT_NAMES = { weapon: 'Weapons', ammo: 'Ammunition', attachment: 'Attachments', medical: 'Medical', food: 'Food', drink: 'Drink', clothing: 'Clothing', backpack: 'Backpacks', tool: 'Tools', construction: 'Building materials', technical: 'Technical', misc: 'Miscellaneous' };

const KITS = {
  'Rifleman kit': [['wpn_arv7', 1], ['ammo_556', 180], ['opt_4x', 1], ['vest_plate', 1], ['helmet_mil', 1], ['bandage', 4], ['pack_military', 1]],
  'Builder kit': [['tool_hammer', 1], ['tool_saw', 1], ['tool_wrench', 1], ['wood_plank', 80], ['nails', 99], ['metal_sheet', 10], ['bolts', 60], ['scrap_metal', 20], ['rope', 5], ['electronics', 6], ['mech_parts', 6]],
  'Medic kit': [['medkit', 1], ['bandage', 6], ['painkillers', 4], ['saline', 2]],
  'Survival supplies': [['water_bottle', 3], ['can_meat', 3], ['energy_bar', 6], ['battery', 4], ['flashlight', 1]],
  'Mechanic kit': [['fuel_can', 1], ['spark_plug', 2], ['car_battery', 1], ['mech_parts', 6], ['tool_wrench', 1]],
};

export class DebugMenu {
  constructor(game) {
    this.game = game;
    this.unlocked = false;
    this.open = false;
    this.flags = { god: false, stamina: false, ammo: false, hunger: false, carry: false, freeBuild: false, invisible: false, freezeTime: false, coords: false, speed: 1 };
    this.stack = [];
    this.el = h('div', { class: 'dbg hidden' });
    this.pad = h('div', { class: 'dbg-pad hidden' });
    this.coordsEl = h('div', { class: 'dbg-coords hidden' });
    document.body.append(this.el, this.pad, this.coordsEl);
    this._entry = '';
    // keys are taken before the game sees them while the menu or keypad is open
    window.addEventListener('keydown', (e) => this._key(e), true);
  }

  get padOpen() { return !this.pad.classList.contains('hidden'); }

  /** Tab+3 pressed. */
  toggle() {
    if (this.open) { this.close(); return; }
    if (this.padOpen) { this._closePad(); return; }
    if (this.unlocked) this._show();
    else this._openPad();
  }

  // ------------------------------------------------------------ keypad
  _openPad() {
    this._entry = '';
    clear(this.pad);
    this.padDisplay = h('div', { class: 'dbg-pad-display' }, '');
    this.padMsg = h('div', { class: 'dbg-pad-msg' }, 'Enter access code');
    const keys = h('div', { class: 'dbg-pad-keys' });
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK']) {
      keys.appendChild(h('button', { class: `dbg-pad-key${k === 'OK' ? ' ok' : k === 'C' ? ' clr' : ''}`, onclick: () => this._padPress(k) }, k));
    }
    this.pad.append(h('div', { class: 'dbg-pad-head' }, 'RESTRICTED'), this.padDisplay, this.padMsg, keys, h('div', { class: 'dbg-pad-foot' }, 'Type the code or click the keys · Esc to cancel'));
    this.pad.classList.remove('hidden');
    this.game.input.unlock();
    this.game.input.uiCapture = true;
  }

  _padPress(k) {
    if (k === 'C') this._entry = '';
    else if (k === 'OK') { this._submit(); return; }
    else if (this._entry.length < 8) this._entry += k;
    this.padDisplay.textContent = '•'.repeat(this._entry.length);
    this.padMsg.textContent = 'Enter access code';
    this.padMsg.classList.remove('bad');
    bus.emit('sound', { type: 'click', ui: true });
  }

  _submit() {
    if (this._entry === CODE) {
      this.unlocked = true;
      this.padMsg.textContent = 'ACCESS GRANTED';
      this.padMsg.classList.add('good');
      setTimeout(() => { this._closePad(); this._show(); }, 350);
    } else {
      this.padMsg.textContent = 'ACCESS DENIED';
      this.padMsg.classList.add('bad');
      this.pad.classList.remove('shake'); void this.pad.offsetWidth; this.pad.classList.add('shake');
      this._entry = '';
      this.padDisplay.textContent = '';
    }
  }

  _closePad() {
    this.pad.classList.add('hidden');
    const ui = this.game.ui;
    this.game.input.uiCapture = ui.mode !== 'playing';
    if (ui.mode === 'playing') this.game.input.lock();
  }

  // ------------------------------------------------------------ menu
  _show() {
    this.open = true;
    this.stack = [{ page: this._main(), sel: 0 }];
    this.el.classList.remove('hidden');
    this.render();
  }

  close() {
    this.open = false;
    this.el.classList.add('hidden');
  }

  get cur() { return this.stack[this.stack.length - 1]; }

  _key(e) {
    // Tab+3, detected when the key goes down so a quick tap is not missed between frames
    const g = this.game;
    if (e.code === 'Tab' && !e.repeat) g._tabChord = false;
    if (e.code === 'Digit3' && g.input.down.has('Tab') && g.started && (g.ui.mode === 'playing' || this.open || this.padOpen)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      g._tabChord = true;
      this.toggle();
      return;
    }
    if (this.padOpen) {
      if (/^(Digit|Numpad)[0-9]$/.test(e.code)) { this._padPress(e.code.slice(-1)); e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { this._submit(); e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (e.code === 'Backspace') { this._entry = this._entry.slice(0, -1); this.padDisplay.textContent = '•'.repeat(this._entry.length); e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (e.code === 'Escape') { this._closePad(); e.preventDefault(); e.stopImmediatePropagation(); return; }
      return;
    }
    if (!this.open) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const map = { ArrowUp: 'up', Numpad8: 'up', ArrowDown: 'down', Numpad2: 'down', ArrowLeft: 'left', Numpad4: 'left', ArrowRight: 'right', Numpad6: 'right', Enter: 'select', NumpadEnter: 'select', Numpad5: 'select', Backspace: 'back', Numpad0: 'back' };
    const a = map[e.code];
    if (!a) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.nav(a);
  }

  /** up | down | left | right | select | back (also used by tests). */
  nav(a) {
    const c = this.cur;
    const items = this._items(c.page);
    if (!items.length && a !== 'back') return;
    if (a === 'up') c.sel = (c.sel - 1 + items.length) % items.length;
    else if (a === 'down') c.sel = (c.sel + 1) % items.length;
    else if (a === 'back') { if (this.stack.length > 1) this.stack.pop(); else { this.close(); return; } }
    else {
      const it = items[c.sel];
      if (it.disabled) { this._flash(it.disabled); }
      else if (a === 'select') {
        if (it.page) this.stack.push({ page: it.page(), sel: 0 });
        else if (it.toggle) { it.set(!it.get()); }
        else if (it.choose) it.choose();
        else if (it.action) it.action();
      } else if (it.values) {
        const vals = it.values();
        let i = vals.indexOf(it.get());
        i = (i + (a === 'left' ? -1 : 1) + vals.length) % vals.length;
        it.set(vals[i]);
      } else if (it.toggle && (a === 'left' || a === 'right')) it.set(!it.get());
    }
    bus.emit('sound', { type: 'click', ui: true });
    this.render();
  }

  _items(page) { return typeof page.items === 'function' ? page.items() : page.items; }

  _flash(text) {
    this.note = text;
    this.noteT = performance.now();
  }

  render() {
    if (!this.open) return;
    const c = this.cur;
    const items = this._items(c.page);
    if (c.sel >= items.length) c.sel = Math.max(0, items.length - 1);
    clear(this.el);
    const top = Math.max(0, Math.min(c.sel - Math.floor(VISIBLE / 2), items.length - VISIBLE));
    const list = h('div', { class: 'dbg-list' });
    items.slice(top, top + VISIBLE).forEach((it, k) => {
      const i = top + k;
      let right = null;
      if (it.page) right = h('span', { class: 'dbg-r' }, '›');
      else if (it.toggle) right = h('span', { class: `dbg-tog${it.get() ? ' on' : ''}` }, it.get() ? 'ON' : 'OFF');
      else if (it.values) right = h('span', { class: 'dbg-r' }, `‹ ${it.fmt ? it.fmt(it.get()) : it.get()} ›`);
      else if (it.info) right = h('span', { class: 'dbg-r dim' }, it.info());
      list.appendChild(h('div', { class: `dbg-row${i === c.sel ? ' sel' : ''}${it.disabled ? ' off' : ''}` }, h('span', {}, it.label), right));
    });
    if (!items.length) list.appendChild(h('div', { class: 'dbg-row off' }, h('span', {}, 'Nothing here')));
    const sel = items[c.sel];
    const desc = this.note && performance.now() - this.noteT < 2500 ? this.note : sel?.disabled || sel?.desc || '';
    this.el.append(...[
      h('div', { class: 'dbg-banner' }, h('div', { class: 'dbg-title' }, 'IRON VEIL'), h('div', { class: 'dbg-sub' }, 'field debug')),
      h('div', { class: 'dbg-head' }, h('span', {}, c.page.title.toUpperCase()), h('span', {}, `${items.length ? c.sel + 1 : 0} / ${items.length}`)),
      list,
      h('div', { class: 'dbg-foot' }, items.length > VISIBLE ? '▲ ▼' : ''),
      desc ? h('div', { class: 'dbg-desc' }, desc) : null,
    ].filter(Boolean));
  }

  /** Per-frame upkeep for active cheats. */
  update(dt) {
    const g = this.game, f = this.flags;
    const s = g.player.survival;
    s.invulnerable = f.god;
    if (f.god && !s.dead) { s.health = 100; s.bleeding = 0; s.pain = 0; }
    if (f.stamina) { s.stamina = 100; s.exhausted = false; }
    if (f.hunger) { s.hunger = 100; s.thirst = 100; }
    if (f.ammo && g.weapons.stack?.data && g.weapons.w?.magSize && g.weapons.state !== 'reload') g.weapons.stack.data.ammo = g.weapons.w.magSize;
    g.player.controller.debugSpeed = f.speed;
    g.clock.paused = f.freezeTime;
    if (f.coords) {
      const p = g.player.controller.pos;
      this.coordsEl.textContent = `X ${p.x.toFixed(1)}  Y ${p.y.toFixed(1)}  Z ${p.z.toFixed(1)}  · heading ${Math.round((((-g.player.controller.yaw * 180) / Math.PI) % 360 + 360) % 360)}°`;
    }
    this.coordsEl.classList.toggle('hidden', !f.coords || !g.started);
    if (this.open) { this._rT = (this._rT || 0) - dt; if (this._rT <= 0) { this._rT = 0.3; this.render(); } }
  }

  // ------------------------------------------------------------ actions
  _notify(text) { bus.emit('notify', { text, kind: 'info' }); }

  async teleport(x, z, label, y = null) {
    const g = this.game;
    if (this._busy) return;
    this._busy = true;
    try {
      if (g.vehicles.current) g.vehicles.exit(g.player, true);
      const pc = g.player.controller;
      const far = Math.hypot(x - pc.pos.x, z - pc.pos.z) > 300;
      pc.teleport(x, (y ?? g.world.heightAt(x, z)) + 0.05, z, pc.yaw);
      if (far) {
        // load the terrain and buildings there first, so you do not land inside a wall
        g.ui.open('loading');
        await g._streamIn();
        g.ui.open('playing');
      }
      const gy = y ?? g.physics.groundHeight(x, z, 0.35, g.world.heightAt(x, z) + 60);
      pc.teleport(x, gy + 0.05, z, pc.yaw);
      g._settleSpawn(true);
      if (label) this._notify(`Teleported to ${label}`);
    } finally { this._busy = false; }
  }

  _give(id, qty) {
    const g = this.game;
    let left = qty;
    while (left > 0) {
      const n = Math.min(left, ItemDB.stackMax(id));
      const st = ItemDB.create(id, n);
      const w = ItemDB.weapon(id);
      if (w?.magSize) st.data.ammo = w.magSize;
      const rest = g.player.equipment.inventory.add(st);
      if (rest) g.dropItem({ ...st, qty: rest });
      left -= n;
    }
  }

  _offline() { return null; }

  _main() {
    return { title: 'Main menu', items: [
      { label: 'Teleport', page: () => this._teleportPage(), desc: 'Waypoint, landmarks, markers, your base and body' },
      { label: 'Player', page: () => this._playerPage(), desc: 'Health, god mode, stamina, ammo, skills' },
      { label: 'Items', page: () => this._itemsPage(), desc: 'Spawn any item or a ready-made kit' },
      { label: 'World', page: () => this._worldPage(), desc: 'Time, weather, map, AI' },
      { label: 'Base', page: () => this._basePage(), desc: 'Free building, repairs, farm output' },
      { label: 'Vehicles', page: () => this._vehiclePage(), desc: 'Spawn, refuel and repair' },
      { label: 'Debug', page: () => this._debugPage(), desc: 'Overlays and movement speed' },
      { label: 'Close menu', action: () => this.close(), desc: 'Tab+3 opens it again' },
    ] };
  }

  _teleportPage() {
    const g = this.game;
    return { title: 'Teleport', items: () => [
      { label: 'To waypoint', disabled: g.waypoint ? null : 'Set a waypoint on the map first (M, click)', action: () => this.teleport(g.waypoint.x, g.waypoint.z, 'waypoint') },
      { label: 'Landmarks', page: () => ({ title: 'Landmarks', items: [...g.world.pois].sort((a, b) => a.name.localeCompare(b.name)).map((q) => ({ label: q.name, desc: `${g.world.regionAt(q.x, q.z)?.name || ''} · ${Math.round(Math.hypot(q.x - g.player.controller.pos.x, q.z - g.player.controller.pos.z))} m away`, action: () => { const a = Math.random() * Math.PI * 2; this.teleport(q.x + Math.cos(a) * (q.radius + 12), q.z + Math.sin(a) * (q.radius + 12), q.name); } })) }) },
      { label: 'Map markers', page: () => ({ title: 'Map markers', items: g.markers.map((m, i) => ({ label: m.label || `Marker ${i + 1}`, action: () => this.teleport(m.x, m.z, m.label || 'marker') })) }) },
      { label: 'Your base', disabled: g.base.center() ? null : 'You have not built anything yet', action: () => { const c = g.base.respawnPoint() || g.base.center(); this.teleport(c.x + 2, c.z + 2, 'your base'); } },
      { label: 'Nearest vehicle', action: () => { const v = g._nearestVehicle(1e9); if (!v) { this._flash('No vehicles'); return; } this.teleport(v.pos.x + 3, v.pos.z + 3, v.t.name); } },
      { label: 'Random spawn point', action: () => { const p = g._spawnPoint(); this.teleport(p.x, p.z, 'a spawn point'); } },
      { label: 'Forward 50 m', action: () => { const pc = g.player.controller; this.teleport(pc.pos.x - Math.sin(pc.yaw) * 50, pc.pos.z - Math.cos(pc.yaw) * 50, null); } },
      { label: 'Straight up 30 m', desc: 'For a look around (you will fall)', action: () => { const pc = g.player.controller; pc.teleport(pc.pos.x, pc.pos.y + 30, pc.pos.z, pc.yaw); } },
      { label: 'Position', info: () => { const p = g.player.controller.pos; return `${Math.round(p.x)}, ${Math.round(p.z)}`; }, action: () => {} },
    ] };
  }

  _playerPage() {
    const g = this.game, f = this.flags;
    const tog = (k, label, desc) => ({ label, toggle: true, get: () => f[k], set: (v) => { f[k] = v; }, desc });
    return { title: 'Player', items: () => [
      { label: 'Heal fully', desc: 'Health, wounds, pain, food, water and stamina', action: () => { const s = g.player.survival; if (s.dead) { this._flash('You are dead — respawn first'); return; } Object.assign(s, { health: 100, bleeding: 0, pain: 0, hunger: 100, thirst: 100, stamina: 100, temperature: 0, wet: 0, exhausted: false }); this._notify('Fully healed'); } },
      tog('god', 'God mode', 'Nothing can hurt you'),
      tog('stamina', 'Unlimited stamina'),
      tog('hunger', 'No hunger or thirst'),
      tog('ammo', 'Unlimited ammunition', 'Magazine stays full'),
      tog('carry', 'Unlimited carry weight'),
      tog('invisible', 'AI ignore you', 'Nobody treats you as an enemy'),
      { label: 'Fill ammo for current weapon', action: () => { const w = g.weapons.w; if (!w?.ammo) { this._flash('Hold a firearm'); return; } this._give(w.ammo, ItemDB.stackMax(w.ammo) * 2); this._notify(`Added ${ItemDB.get(w.ammo).name}`); } },
      { label: 'Repair current weapon', action: () => { const st = g.weapons.stack; if (!st?.data) { this._flash('Hold a weapon'); return; } st.data.cond = 1; st.data.jammed = false; this._notify('Weapon repaired'); } },
      { label: 'Max all skills', action: () => { for (const k of Object.keys(SKILLS)) g.player.skills.xp[k] = 1200; this._notify('All skills at level 10'); } },
      { label: 'Recharge lights', action: () => { const eq = g.player.equipment; for (const s of [eq.slots.util, g.weapons.stack]) if (s?.data && 'charge' in s.data) s.data.charge = 1; this._notify('Lights recharged'); } },
    ] };
  }

  _itemsPage() {
    const g = this.game;
    const cats = ItemDB.categories.filter((c) => [...ItemDB.items.values()].some((i) => i.cat === c));
    return { title: 'Items', items: [
      { label: 'Kits', page: () => ({ title: 'Kits', items: Object.entries(KITS).map(([name, list]) => ({ label: name, desc: list.map(([id, n]) => `${n}× ${ItemDB.get(id)?.name}`).join(', '), action: () => { for (const [id, n] of list) if (ItemDB.exists(id)) this._give(id, n); this._notify(`${name} added (extra items dropped at your feet)`); } })) }) },
      ...cats.map((c) => ({ label: CAT_NAMES[c] || c, page: () => ({ title: CAT_NAMES[c] || c, items: [...ItemDB.items.values()].filter((i) => i.cat === c).sort((a, b) => a.name.localeCompare(b.name)).map((i) => ({ label: i.name, desc: `Enter: add ${i.stack > 1 ? `a stack of ${i.stack}` : 'one'} · ${i.id}`, action: () => { this._give(i.id, i.stack || 1); this._flash(`Added ${i.stack > 1 ? `${i.stack}× ` : ''}${i.name}`); } })) }) })),
      { label: 'Clear inventory', desc: 'Deletes everything in your pockets and bags (not worn items)', action: () => { const inv = g.player.equipment.inventory; for (let i = 0; i < inv.slots.length; i++) inv.slots[i] = null; inv.version++; this._notify('Inventory cleared'); } },
    ] };
  }

  _worldPage() {
    const g = this.game, f = this.flags;
    const off = this._offline();
    return { title: 'World', items: () => [
      { label: 'Time of day', values: () => Array.from({ length: 24 }, (_, i) => i), get: () => Math.floor(g.clock.hours), set: (v) => { if (off) { this._flash(off); return; } g.clock.gameMinutes = Math.floor(g.clock.gameMinutes / 1440) * 1440 + v * 60; }, fmt: (v) => `${String(v).padStart(2, '0')}:00`, disabled: off },
      { label: 'Freeze time', toggle: true, get: () => f.freezeTime, set: (v) => { f.freezeTime = v; }, disabled: off },
      { label: 'Weather', values: () => WEATHER, get: () => g.weather.state, set: (v) => g.weather.set(v, true), disabled: off },
      { label: 'Reveal the whole map', action: () => { for (const q of g.world.pois) g.discovered.add(q.id); g.fog.data.fill(1); this._notify('Map revealed'); } },
      { label: 'Remove nearby hostiles', disabled: off, desc: 'Everyone hostile within 150 m vanishes', action: () => { let n = 0; const p = g.player.controller.pos; for (const a of [...g.ai.agents]) if (a.alive && a.isEnemy(g.player.character) && Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < 150) { g.ai._despawn(a); n++; } this._notify(`${n} removed`); } },
      { label: 'Spawn squad', page: () => ({ title: 'Spawn squad (40 m ahead)', items: g.factions.constructor && ['vsf_rifleman', 'wolf_raider', 'wolf_shooter', 'guard_militia', 'free_merc', 'indep_scav'].map((pid) => ({ label: `${g.factions.get(g.factions.profile(pid).faction).name} ×3`, disabled: off, action: () => { const pc = g.player.controller; g.ai.spawnSquad([pid, pid, pid], pc.pos.x - Math.sin(pc.yaw) * 40, pc.pos.z - Math.cos(pc.yaw) * 40, {}); this._flash('Squad spawned'); } })) }), disabled: off },
      { label: 'AI ignore you', toggle: true, get: () => f.invisible, set: (v) => { f.invisible = v; }, disabled: off },
      { label: 'Restock all containers', desc: 'Searched containers fill up again', action: () => { for (const [id, c] of [...g.loot.containers]) if (!c.custom && /:c\d+$/.test(id)) g.loot.containers.delete(id); this._notify('Containers restocked'); } },
    ] };
  }

  _basePage() {
    const g = this.game, f = this.flags;
    return { title: 'Base', items: () => [
      { label: 'Free building', toggle: true, get: () => f.freeBuild, set: (v) => { f.freeBuild = v; }, desc: 'No materials or tools needed' },
      { label: 'Repair every piece', action: () => { let n = 0; for (const p of g.base.pieces.values()) if (p.health < p.maxHealth) { p.health = p.maxHealth; n++; } this._notify(`${n} pieces repaired`); } },
      { label: 'Farms: produce a day now', desc: 'Lumber yards, scrap yards and fuel pumps make one day of output', action: () => { const n = g.base.debugProduce?.(1440) || 0; this._notify(n ? `${n} producers filled` : 'No farms or pumps built'); } },
      { label: 'Sentries: refill ammo', action: () => { let n = 0; for (const p of g.base.pieces.values()) if (p.sentry && p.inventory) { const st = p.inventory.slots[0]; const w = st && ItemDB.weapon(st.id); if (w?.ammo) { p.inventory.add({ id: w.ammo, qty: ItemDB.stackMax(w.ammo) * 2 }); n++; } } this._notify(n ? `${n} sentries refilled` : 'No armed sentries'); } },
    ] };
  }

  _vehiclePage() {
    const g = this.game;
    return { title: 'Vehicles', items: () => [
      { label: 'Refuel and repair nearest', action: () => { const v = g.vehicles.current || g._nearestVehicle(50); if (!v) { this._flash('No vehicle within 50 m'); return; } v.fuel = v.t.fuelCap; v.health = v.t.health; v.destroyed = false; v.needs = []; this._notify(`${v.t.name} ready to drive`); } },
      ...['pickup', 'utility', 'offroad', 'mil_truck'].map((type) => ({ label: `Spawn ${type.replace('_', ' ')}`, action: () => { const pc = g.player.controller; const x = pc.pos.x - Math.sin(pc.yaw) * 7, z = pc.pos.z - Math.cos(pc.yaw) * 7; g.vehicles.add({ id: `dbg${Date.now().toString(36)}`, type, x, z, rot: pc.yaw, fuel: 80 }); this._flash('Vehicle spawned ahead of you'); } })),
    ] };
  }

  _debugPage() {
    const g = this.game, f = this.flags;
    return { title: 'Debug', items: () => [
      { label: 'Show FPS and stats', toggle: true, get: () => !!settings.get('showFPS'), set: (v) => settings.apply({ showFPS: v }) },
      { label: 'Show coordinates', toggle: true, get: () => f.coords, set: (v) => { f.coords = v; } },
      { label: 'Movement speed', values: () => [1, 1.5, 2, 3, 5], get: () => f.speed, set: (v) => { f.speed = v; }, fmt: (v) => `${v}×` },
      { label: 'Save now', action: () => g.saveGame('auto') },
      { label: 'Frame time', info: () => `${g.renderer.fps} fps`, action: () => {} },
    ] };
  }
}

void THREE;
