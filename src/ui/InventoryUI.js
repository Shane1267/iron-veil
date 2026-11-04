import { h, clear, fmtKg } from './dom.js';
import { ItemDB } from '../items/ItemDatabase.js';
import { Equipment, WEAPON_SLOTS, GEAR_SLOTS } from '../items/Equipment.js';
import { effectiveWeapon, attachmentFits } from '../weapons/WeaponData.js';
import { bus } from '../core/EventBus.js';

// Inventory, equipment, looting and weapon attachment interface. Supports click,
// double-click, shift-click, right-click context menu and drag & drop; every action is
// routed through the atomic Inventory/Equipment APIs so items cannot be duplicated.

const FILTERS = [
  ['all', 'All'], ['weapon', 'Weapons'], ['ammo', 'Ammo'], ['attachment', 'Mods'], ['medical', 'Medical'],
  ['food', 'Food'], ['gear', 'Gear'], ['construction', 'Build'], ['other', 'Other'],
];
const SLOT_LABEL = { primary: 'Primary', shoulder: 'Shoulder', sidearm: 'Sidearm', melee: 'Melee', head: 'Head', body: 'Body', vest: 'Vest', back: 'Back', util: 'Utility' };
const ATTACH_SLOTS = ['optic', 'muzzle', 'under', 'light', 'mag', 'stock'];

function matchFilter(def, f) {
  if (f === 'all') return true;
  if (f === 'food') return def.cat === 'food' || def.cat === 'drink';
  if (f === 'gear') return ['clothing', 'backpack', 'tool'].includes(def.cat);
  if (f === 'other') return ['technical', 'misc'].includes(def.cat);
  return def.cat === f;
}

export class InventoryUI {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.el = h('div', { class: 'screen dim hidden' });
    ui.root.appendChild(this.el);
    this.container = null;
    this.sel = null; // {src: 'pockets'|'container'|'equip', index|slot}
    this.filter = 'all';
    this.cfilter = 'all';
    this.drag = null;
    this.ctx = null;
    this._lastAction = 0;
    window.addEventListener('mousemove', (e) => this._dragMove(e));
    window.addEventListener('mouseup', (e) => this._dragEnd(e));
    window.addEventListener('mousedown', (e) => { if (this.ctx && !this.ctx.contains(e.target)) this._closeCtx(); });
  }

  get inv() { return this.game.player.equipment.inventory; }
  get eq() { return this.game.player.equipment; }

  open(container = null) {
    this.container = container; // {inv, name, id}
    this.sel = null;
    this.el.classList.remove('hidden');
    this.render();
  }

  close() {
    this.el.classList.add('hidden');
    this._closeCtx();
    if (this.container?.onClose) this.container.onClose();
    this.container = null;
    this.game.weapons.refresh();
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }

  _guard() {
    // rate-limit structural actions (protects against double-click races)
    const now = performance.now();
    if (now - this._lastAction < 90) return false;
    this._lastAction = now;
    return true;
  }

  changed() {
    this.game.weapons.refresh();
    this.render();
  }

  // ------------------------------------------------------------ render
  render() {
    if (!this.isOpen) return;
    clear(this.el);
    const wrap = h('div', { class: 'panel inv-wrap interactive', onmousedown: (e) => e.stopPropagation() });
    wrap.append(this._equipCol(), this._pocketCol(), this._containerCol());
    this.el.appendChild(wrap);
  }

  _icon(id) {
    return this.game.icons.icon(id);
  }

  _equipCol() {
    const col = h('div', { class: 'inv-col' });
    col.appendChild(h('div', { class: 'ttl' }, h('span', {}, 'Character'), h('b', {}, 'Equipment')));
    const grid = h('div', { class: 'equip' });
    for (const s of [...WEAPON_SLOTS, ...GEAR_SLOTS]) {
      const it = this.eq.slots[s];
      const wide = WEAPON_SLOTS.includes(s) && s !== 'melee' && s !== 'sidearm';
      const el = h('div', {
        class: `eslot ${wide ? 'wide' : ''} ${this.sel?.src === 'equip' && this.sel.slot === s ? 'sel' : ''}`,
        style: it ? { backgroundImage: `url(${this._icon(it.id)})` } : {},
      }, h('span', { class: 'lab' }, SLOT_LABEL[s]), h('span', { class: 'nm' }, it ? ItemDB.get(it.id).name : ''));
      el.dataset.slot = s;
      el.addEventListener('mousedown', (e) => this._down(e, { src: 'equip', slot: s }));
      el.addEventListener('dblclick', () => this._unequip(s));
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); this._context(e, { src: 'equip', slot: s }); });
      grid.appendChild(el);
    }
    col.appendChild(grid);
    const s = this.game.player.survival;
    const w = this.eq.totalWeight();
    const cap = this.game.carryCapacity();
    const statsEl = h('div', { class: 'char-stats' },
      h('span', {}, 'Health'), h('b', {}, `${Math.round(s.health)}`),
      h('span', {}, 'Food / Water'), h('b', {}, `${Math.round(s.hunger)} / ${Math.round(s.thirst)}`),
      h('span', {}, 'Armour head / torso'), h('b', {}, `${Math.round(this.eq.armorFor('head') * 100)}% / ${Math.round(this.eq.armorFor('torso') * 100)}%`),
      h('span', {}, 'Insulation'), h('b', {}, `${Math.round(this.eq.insulation() * 100)}`),
      h('span', {}, 'Carried weight'), h('b', { class: w > cap ? 'weight over' : 'weight' }, `${fmtKg(w)} / ${cap} kg`),
      h('span', {}, 'Pocket slots'), h('b', {}, `${this.inv.usedSlots()} / ${this.inv.capacity}`),
      h('span', {}, 'Kills'), h('b', {}, String(this.game.player.stats.kills)),
    );
    col.appendChild(statsEl);
    // skills summary
    const sk = this.game.player.skills;
    const skills = h('div', { class: 'char-stats', style: { borderTop: '1px solid var(--line)', paddingTop: '10px' } });
    for (const k of Object.keys(sk.xp)) skills.append(h('span', {}, k.replace('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase())), h('b', {}, `Lv ${sk.level(k)}`));
    col.appendChild(skills);
    return col;
  }

  _filters(cur, set) {
    return h('div', { class: 'filters' }, ...FILTERS.map(([k, n]) => h('button', { class: k === cur ? 'on' : '', onclick: () => { set(k); this.render(); } }, n)));
  }

  _grid(inv, src, filter) {
    const grid = h('div', { class: 'grid' });
    inv.slots.forEach((s, i) => {
      const def = s ? ItemDB.get(s.id) : null;
      const dim = s && !matchFilter(def, filter);
      const cell = h('div', {
        class: `cell ${s ? '' : 'empty'} ${dim ? 'dim' : ''} ${this.sel?.src === src && this.sel.index === i ? 'sel' : ''}`,
        style: s ? { backgroundImage: `url(${this._icon(s.id)})` } : {},
        title: s ? def.name : '',
      });
      cell.dataset.src = src;
      cell.dataset.index = String(i);
      if (s) {
        if (s.qty > 1) cell.appendChild(h('span', { class: 'q' }, String(s.qty)));
        if (s.data?.cond !== undefined && def.cat === 'weapon') cell.appendChild(h('span', { class: 'c', style: { width: `${Math.round(s.data.cond * 18)}px`, background: s.data.cond < 0.4 ? 'var(--red)' : 'var(--good)' } }));
        const qk = this.eq.quick.indexOf(s.id);
        if (src === 'pockets' && qk >= 0) cell.appendChild(h('span', { class: 'qk' }, String(qk + 5)));
        cell.addEventListener('mousedown', (e) => this._down(e, { src, index: i }));
        cell.addEventListener('dblclick', () => this._quick({ src, index: i }));
        cell.addEventListener('contextmenu', (e) => { e.preventDefault(); this._context(e, { src, index: i }); });
      }
      grid.appendChild(cell);
    });
    return grid;
  }

  _pocketCol() {
    const col = h('div', { class: 'inv-col' });
    col.appendChild(h('div', { class: 'ttl' }, h('span', {}, 'Inventory'), h('span', {},
      h('button', { class: 'btn small', onclick: () => { if (this._guard()) { this.inv.sort(); this.render(); } } }, 'Sort'))));
    col.appendChild(this._filters(this.filter, (f) => { this.filter = f; }));
    col.appendChild(this._grid(this.inv, 'pockets', this.filter));
    this._detailEl = this._detail();
    col.appendChild(this._detailEl);
    return col;
  }

  _containerCol() {
    const col = h('div', { class: 'inv-col' });
    const c = this.container;
    if (!c) {
      col.appendChild(h('div', { class: 'ttl' }, h('span', {}, 'Ground'), h('b', {}, 'Drop items here')));
      const drop = h('div', { class: 'grid', style: { alignContent: 'center', justifyItems: 'center' } },
        h('div', { style: { color: 'var(--ink-faint)', fontSize: '12px', textAlign: 'center', lineHeight: '1.6', gridColumn: '1 / -1' } },
          'Drag items here or use Drop to leave them on the ground.', h('br'), 'Look at a container, body or vehicle and press E to loot.'));
      drop.dataset.src = 'ground';
      col.appendChild(drop);
      col.appendChild(this._help());
      return col;
    }
    col.appendChild(h('div', { class: 'ttl' }, h('span', {}, c.name || 'Container'), h('span', {},
      h('button', { class: 'btn small', onclick: () => { if (this._guard()) { c.inv.transferAll(this.inv); bus.emit('sound', { type: 'pickup', ui: true }); this.changed(); } } }, 'Take all'), ' ',
      h('button', { class: 'btn small', onclick: () => { if (this._guard()) { c.inv.sort(); this.render(); } } }, 'Sort'))));
    col.appendChild(this._filters(this.cfilter, (f) => { this.cfilter = f; }));
    col.appendChild(this._grid(c.inv, 'container', this.cfilter));
    col.appendChild(h('div', { class: 'inv-foot' }, h('span', {}, `${c.inv.usedSlots()} / ${c.inv.capacity} slots`), h('span', {}, 'Shift-click or double-click to transfer')));
    return col;
  }

  _help() {
    return h('div', { class: 'inv-foot', style: { flexDirection: 'column', alignItems: 'flex-start', gap: '3px' } },
      h('span', {}, 'Double-click: use / equip / transfer'),
      h('span', {}, 'Right-click: more actions · Drag: move'),
      h('span', {}, 'Keys 5-8: bind quick items (right-click)'));
  }

  // ------------------------------------------------------------ detail / inspect
  _getStack(ref) {
    if (!ref) return null;
    if (ref.src === 'equip') return this.eq.slots[ref.slot];
    if (ref.src === 'pockets') return this.inv.slots[ref.index];
    if (ref.src === 'container') return this.container?.inv.slots[ref.index];
    return null;
  }

  _detail() {
    const box = h('div', { class: 'detail' });
    const s = this._getStack(this.sel);
    if (!s) {
      box.append(h('div', { class: 'ic' }), h('div', {}, h('div', { class: 'cat' }, 'Inspect'), h('p', {}, 'Select an item to inspect it, compare weapons and manage attachments.')));
      return box;
    }
    const def = ItemDB.get(s.id);
    const info = h('div', {});
    info.append(h('div', { class: 'cat' }, def.cat), h('h3', {}, def.name), h('p', {}, def.desc || ''));
    if (def.cat === 'weapon') info.append(this._weaponStats(s), ...this._attachUI(s));
    if (def.equip) {
      const e = def.equip;
      const bits = [];
      if (e.armor) bits.push(`Armour ${Math.round(e.armor * 100)}% (${e.zones.join(', ')})`);
      if (e.slots) bits.push(`+${e.slots} slots`);
      if (e.insulation) bits.push(`Insulation ${Math.round(e.insulation * 100)}`);
      if (e.rain) bits.push('Rain protection');
      info.append(h('p', {}, bits.join(' · ')));
    }
    if (def.use) {
      const u = def.use;
      const bits = [];
      if (u.hunger) bits.push(`Food ${u.hunger > 0 ? '+' : ''}${u.hunger}`);
      if (u.thirst) bits.push(`Water ${u.thirst > 0 ? '+' : ''}${u.thirst}`);
      if (u.health) bits.push(`Health +${u.health}`);
      if (u.stopBleed) bits.push('Stops bleeding');
      if (u.painkiller) bits.push(`Pain relief ${u.painkiller}s`);
      if (u.stamina) bits.push(`Stamina +${u.stamina}`);
      if (bits.length) info.append(h('p', {}, bits.join(' · ')));
    }
    const w = (def.weight || 0) * s.qty;
    info.append(h('p', { style: { color: 'var(--ink-faint)' } }, `Weight ${fmtKg(w)}${s.qty > 1 ? ` (${s.qty})` : ''}`));
    const acts = h('div', { class: 'acts' });
    for (const [label, fn] of this._actions(this.sel)) acts.appendChild(h('button', { class: 'btn small', onclick: () => fn() }, label));
    info.appendChild(acts);
    box.append(h('div', { class: 'ic', style: { backgroundImage: `url(${this._icon(s.id)})` } }), info);
    return box;
  }

  _weaponStats(s) {
    const w = effectiveWeapon(s);
    if (w.class === 'melee') return h('p', {}, `Damage ${w.damage} · Reach ${w.range} m`);
    // compare with the weapon currently in the matching equipment slot
    const slot = w.slot === 'primary' ? 'primary' : w.slot;
    const other = this.eq.slots[slot] && this.eq.slots[slot] !== s ? effectiveWeapon(this.eq.slots[slot]) : null;
    const rows = [
      ['Damage', (x) => x.damage * (x.pellets || 1), 160],
      ['Fire rate', (x) => x.rpm, 900],
      ['Range', (x) => x.falloffEnd, 800],
      ['Accuracy', (x) => 1 / Math.max(0.02, x.spreadAds), 50],
      ['Handling', (x) => 1 / x.adsTime, 6],
      ['Recoil control', (x) => 1 / Math.max(0.3, x.recoil.v), 1.6],
    ];
    const g = h('div', { class: 'stats' });
    for (const [name, f, max] of rows) {
      const v = f(w), o = other ? f(other) : null;
      const bar = h('div', { class: 'sb' }, h('i', { style: { transform: `scaleX(${Math.min(1, v / max)})` } }));
      if (o !== null) bar.appendChild(h('i', { class: 'cmp', style: { width: `${Math.min(100, (o / max) * 100)}%`, transform: 'none' } }));
      g.append(h('span', {}, name), bar, h('span', { style: { fontFamily: 'var(--mono)' } }, name === 'Fire rate' ? `${v}` : name === 'Range' ? `${v}m` : name === 'Damage' ? `${Math.round(v)}` : ''));
    }
    const cap = h('p', {}, `${ItemDB.get(w.ammo)?.name} · ${s.data.ammo}/${w.magSize} loaded · ${w.fireModes.join('/')} · cond ${Math.round((s.data.cond ?? 1) * 100)}%${other ? ' · amber line = equipped' : ''}`);
    return h('div', {}, g, cap);
  }

  _attachUI(s) {
    const base = ItemDB.weapon(s.id);
    const out = [];
    const slots = ATTACH_SLOTS.filter((k) => (base.attach?.[k] || []).length);
    if (!slots.length) return out;
    const row = h('div', { class: 'attach-row' });
    for (const k of slots) {
      const cur = s.data.attach?.[k];
      if (cur) row.appendChild(h('span', { class: 'attach on', title: 'Click to remove', onclick: () => this._detach(s, k) }, `${k}: ${ItemDB.get(cur).name} ✕`));
      // compatible attachments in pockets
      for (const id of base.attach[k]) {
        if (id === cur || this.inv.count(id) < 1) continue;
        row.appendChild(h('span', { class: 'attach', title: 'Click to attach', onclick: () => this._attach(s, k, id) }, `+ ${ItemDB.get(id).name}`));
      }
      if (!cur && !base.attach[k].some((id) => this.inv.count(id))) row.appendChild(h('span', { class: 'attach', style: { opacity: 0.5, cursor: 'default' } }, `${k}: empty`));
    }
    out.push(h('div', { class: 'cat', style: { marginTop: '6px' } }, 'Attachments'), row);
    return out;
  }

  _attach(stack, slot, id) {
    if (!this._guard()) return;
    if (!attachmentFits(stack.id, id)) return;
    if (this.inv.remove(id, 1) !== 1) return;
    stack.data.attach = stack.data.attach || {};
    const prev = stack.data.attach[slot];
    stack.data.attach[slot] = id;
    if (prev) { const left = this.inv.add({ id: prev, qty: 1 }); if (left) this.game.dropItem({ id: prev, qty: 1 }); }
    bus.emit('sound', { type: 'click', ui: true });
    this.changed();
  }

  _detach(stack, slot) {
    if (!this._guard()) return;
    const id = stack.data.attach?.[slot];
    if (!id) return;
    if (!this.inv.canAdd({ id, qty: 1 })) { bus.emit('notify', { text: 'No room for the attachment', kind: 'warn' }); return; }
    delete stack.data.attach[slot];
    this.inv.add({ id, qty: 1 });
    bus.emit('sound', { type: 'click', ui: true });
    this.changed();
  }

  // ------------------------------------------------------------ actions
  _actions(ref) {
    const s = this._getStack(ref);
    if (!s) return [];
    const def = ItemDB.get(s.id);
    const acts = [];
    if (ref.src === 'pockets') {
      if (def.use) acts.push([def.cat === 'food' ? 'Eat' : def.cat === 'drink' ? 'Drink' : 'Use', () => { this.game.player.useItem(ref.index); this.ui.close(); }]);
      for (const slot of Equipment.slotsFor(s.id)) acts.push([`Equip ${SLOT_LABEL[slot]}`, () => this._equip(ref.index, slot)]);
      if (this.container) acts.push(['Transfer', () => this._transfer(ref, Infinity)]);
      if (s.qty > 1) acts.push(['Split', () => this._split(ref)]);
      if (def.cat === 'weapon' && s.data?.ammo > 0) acts.push(['Unload', () => this._unload(s)]);
      if (def.use || def.cat === 'ammo') for (let q = 0; q < 4; q++) acts.push([`Quick ${q + 5}`, () => { this.eq.quick[q] = s.id; this.render(); }]);
      acts.push(['Drop', () => this._drop(ref)]);
    } else if (ref.src === 'container') {
      acts.push(['Take', () => this._transfer(ref, Infinity)]);
      if (s.qty > 1) acts.push(['Take half', () => this._transfer(ref, Math.ceil(s.qty / 2))]);
    } else if (ref.src === 'equip') {
      acts.push(['Unequip', () => this._unequip(ref.slot)]);
      if (def.cat === 'weapon' && s.data?.ammo > 0) acts.push(['Unload', () => this._unload(s)]);
      acts.push(['Drop', () => this._drop(ref)]);
    }
    return acts;
  }

  _context(e, ref) {
    this._closeCtx();
    this.sel = ref;
    this.render();
    const acts = this._actions(ref);
    if (!acts.length) return;
    const m = h('div', { class: 'ctx interactive' }, ...acts.map(([l, fn]) => h('button', { onclick: () => { this._closeCtx(); fn(); } }, l)));
    m.style.left = `${Math.min(e.clientX, window.innerWidth - 170)}px`;
    m.style.top = `${Math.min(e.clientY, window.innerHeight - acts.length * 30 - 10)}px`;
    this.ui.root.appendChild(m);
    this.ctx = m;
  }

  _closeCtx() {
    if (this.ctx) { this.ctx.remove(); this.ctx = null; }
  }

  _quick(ref) {
    const s = this._getStack(ref);
    if (!s) return;
    if (ref.src === 'equip') { this._unequip(ref.slot); return; }
    if (ref.src === 'container') { this._transfer(ref, Infinity); return; }
    const def = ItemDB.get(s.id);
    if (this.container) { this._transfer(ref, Infinity); return; }
    if (Equipment.slotsFor(s.id).length) { this._equip(ref.index); return; }
    if (def.use) { this.game.player.useItem(ref.index); this.ui.close(); }
  }

  _equip(index, slot) {
    if (!this._guard()) return;
    const r = this.eq.equipFromInventory(index, slot);
    if (!r.ok) bus.emit('notify', { text: r.msg, kind: 'warn' });
    else bus.emit('sound', { type: 'equip', ui: true });
    this.sel = r.ok ? { src: 'equip', slot: r.slot } : this.sel;
    if (r.ok && WEAPON_SLOTS.includes(r.slot) && !this.game.weapons.stack) this.game.weapons.select(r.slot);
    this.changed();
  }

  _unequip(slot) {
    if (!this._guard()) return;
    const r = this.eq.unequip(slot);
    if (!r.ok) bus.emit('notify', { text: r.msg, kind: 'warn' });
    this.sel = null;
    if (this.game.weapons.slot === slot) this.game.weapons.select(null);
    this.changed();
  }

  _transfer(ref, qty) {
    if (!this._guard() || !this.container) return;
    const from = ref.src === 'pockets' ? this.inv : this.container.inv;
    const to = ref.src === 'pockets' ? this.container.inv : this.inv;
    const s = from.slots[ref.index];
    if (!s) return;
    const n = from.transfer(ref.index, to, qty);
    if (!n) bus.emit('notify', { text: 'No room', kind: 'warn', key: 'noroom' });
    else { bus.emit('sound', { type: 'pickup', ui: true }); if (ref.src === 'container') this.game.player.skills.gain('scavenging', 0.2); }
    this.sel = null;
    this.changed();
  }

  _split(ref) {
    if (!this._guard()) return;
    const inv = ref.src === 'pockets' ? this.inv : this.container.inv;
    const s = inv.slots[ref.index];
    if (!s || s.qty < 2) return;
    const free = inv.slots.indexOf(null);
    if (free < 0) { bus.emit('notify', { text: 'No free slot to split into', kind: 'warn' }); return; }
    const half = Math.floor(s.qty / 2);
    s.qty -= half;
    inv.slots[free] = { id: s.id, qty: half };
    inv.version++;
    this.render();
  }

  _unload(s) {
    if (!this._guard()) return;
    const w = ItemDB.weapon(s.id);
    const n = s.data.ammo;
    if (!n) return;
    const left = this.inv.add({ id: w.ammo, qty: n });
    s.data.ammo = left; // anything that did not fit stays loaded
    bus.emit('sound', { type: 'reload', stage: 'start', ui: true, weapon: w });
    this.changed();
  }

  _drop(ref) {
    if (!this._guard()) return;
    let stack = null;
    if (ref.src === 'pockets') stack = this.inv.takeSlot(ref.index);
    else if (ref.src === 'equip') {
      stack = this.eq.takeEquipped(ref.slot);
      if (!stack) { bus.emit('notify', { text: 'Empty some slots first', kind: 'warn' }); return; }
      if (this.game.weapons.slot === ref.slot) this.game.weapons.select(null);
    }
    if (stack) this.game.dropItem(stack);
    this.sel = null;
    this.changed();
  }

  // ------------------------------------------------------------ drag & drop
  _down(e, ref) {
    if (e.button !== 0) return;
    this._closeCtx();
    const s = this._getStack(ref);
    if (e.shiftKey && s) {
      if (ref.src === 'pockets' && this.container) this._transfer(ref, Infinity);
      else if (ref.src === 'container') this._transfer(ref, Infinity);
      else if (ref.src === 'pockets') this._quick(ref);
      e.preventDefault();
      return;
    }
    this.sel = ref;
    this.drag = s ? { ref, x: e.clientX, y: e.clientY, active: false, ghost: null, id: s.id } : null;
    this._refreshSelection();
  }

  /** Update highlight + detail panel without rebuilding the grids (keeps dblclick working). */
  _refreshSelection() {
    for (const el of this.el.querySelectorAll('.sel')) el.classList.remove('sel');
    const r = this.sel;
    if (r) {
      const q = r.src === 'equip' ? `.eslot[data-slot="${r.slot}"]` : `.cell[data-src="${r.src}"][data-index="${r.index}"]`;
      this.el.querySelector(q)?.classList.add('sel');
    }
    if (this._detailEl) {
      const d = this._detail();
      this._detailEl.replaceWith(d);
      this._detailEl = d;
    }
  }

  _dragMove(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) {
      d.active = true;
      d.ghost = h('div', { class: 'drag-ghost', style: { backgroundImage: `url(${this._icon(d.id)})` } });
      this.ui.root.appendChild(d.ghost);
    }
    if (d.active) {
      d.ghost.style.left = `${e.clientX - 27}px`;
      d.ghost.style.top = `${e.clientY - 27}px`;
      for (const el of this.el.querySelectorAll('.drop-ok')) el.classList.remove('drop-ok');
      const t = this._target(e);
      if (t?.el) t.el.classList.add('drop-ok');
    }
  }

  _target(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return null;
    const cell = el.closest('.cell');
    if (cell) return { el: cell, src: cell.dataset.src, index: Number(cell.dataset.index) };
    const eslot = el.closest('.eslot');
    if (eslot) return { el: eslot, src: 'equip', slot: eslot.dataset.slot };
    const grid = el.closest('.grid');
    if (grid) return { el: grid, src: grid.dataset.src || (grid.querySelector('.cell')?.dataset.src), index: -1 };
    return null;
  }

  _dragEnd(e) {
    const d = this.drag;
    this.drag = null;
    if (!d || !d.active) return;
    d.ghost?.remove();
    for (const el of this.el.querySelectorAll('.drop-ok')) el.classList.remove('drop-ok');
    const t = this._target(e);
    if (!t || !this._guard()) { this.render(); return; }
    const from = d.ref;
    const invOf = (src) => (src === 'pockets' ? this.inv : src === 'container' ? this.container?.inv : null);
    if (from.src === 'equip') {
      if (t.src === 'pockets') {
        const it = this.eq.slots[from.slot];
        if (!it) return;
        const r = this.eq.unequip(from.slot);
        if (!r.ok) bus.emit('notify', { text: r.msg, kind: 'warn' });
        if (this.game.weapons.slot === from.slot) this.game.weapons.select(null);
      } else if (t.src === 'equip' && t.slot !== from.slot) {
        // swap between compatible weapon slots
        const a = this.eq.slots[from.slot], b = this.eq.slots[t.slot];
        if (a && Equipment.slotsFor(a.id).includes(t.slot) && (!b || Equipment.slotsFor(b.id).includes(from.slot))) {
          this.eq.slots[t.slot] = a; this.eq.slots[from.slot] = b || null; this.eq.version++;
        }
      } else if (t.src === 'ground' || t.src === 'container') {
        const it = this.eq.takeEquipped(from.slot);
        if (it) {
          if (t.src === 'container' && this.container) { const left = this.container.inv.add(it); if (left) this.game.dropItem(it); }
          else this.game.dropItem(it);
        }
      }
      this.changed();
      return;
    }
    const src = invOf(from.src);
    if (!src) return;
    if (t.src === 'equip') {
      if (from.src === 'pockets') this._equip(from.index, t.slot);
      else {
        // equip straight from a container: move to pockets first
        const moved = src.transfer(from.index, this.inv, 1);
        if (moved) { const i = this.inv.find((x) => x.id === d.id); if (i >= 0) this.eq.equipFromInventory(i, t.slot); }
      }
    } else if (t.src === from.src && t.index >= 0) {
      src.moveSlot(from.index, t.index);
    } else if (t.src === 'ground') {
      const st = src.takeSlot(from.index);
      if (st) this.game.dropItem(st);
    } else {
      const dst = invOf(t.src);
      if (dst && dst !== src) src.transfer(from.index, dst, Infinity, t.index);
    }
    bus.emit('sound', { type: 'pickup', ui: true });
    this.sel = null;
    this.changed();
  }
}
