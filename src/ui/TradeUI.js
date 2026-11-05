// Barter screen. Left: what you carry (with what the trader will give for it). Right: the
// trader's stock and services (with their price). Click to move items onto the table,
// shift-click for the whole stack; click an item on the table to take it back. The deal
// goes through when what you give is worth at least what you take.
import { h, clear } from './dom.js';
import { ItemDB } from '../items/ItemDatabase.js';
import { itemValue, BUY_RATE } from '../npc/NPCSystem.js';
import { bus } from '../core/EventBus.js';

const fmt = (v) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toString();

export class TradeUI {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.el = h('div', { class: 'screen dim hidden trade-screen' });
    ui.root.appendChild(this.el);
    this.isOpen = false;
  }

  open({ npc, trader }) {
    this.npc = npc;
    this.t = trader;
    this.give = new Map(); // inventory slot index -> qty
    this.take = new Map(); // stock index or 'svc:x' -> qty
    this.tab = 'trade';
    this.isOpen = true;
    this.el.classList.remove('hidden');
    this.render();
  }

  close() {
    this.isOpen = false;
    this.el.classList.add('hidden');
    clear(this.el);
  }

  get inv() { return this.game.player.equipment.inventory; }
  get mul() { return this.game.npcs.priceMul(); }

  /** Services offered as priced entries next to the stock. */
  _services() {
    const g = this.game, out = [];
    const svc = this.t.def.services || [];
    if (svc.includes('treat')) {
      const s = g.player.survival;
      const need = 100 - s.health + s.bleeding * 15 + s.pain * 20;
      out.push({ key: 'svc:treat', name: 'Treatment', desc: need > 1 ? `Stops bleeding, kills the pain, back to full health (${Math.round(s.health)}% now)` : 'You are in good health', price: Math.max(8, Math.round(need * 0.6)), ok: need > 1 });
    }
    if (svc.includes('repair')) {
      for (const slot of ['primary', 'shoulder', 'sidearm']) {
        const st = g.player.equipment.slots[slot];
        if (!st?.data || !ItemDB.weapon(st.id)) continue;
        const cond = st.data.cond ?? 1;
        out.push({ key: `svc:repair:${slot}`, name: `Repair ${ItemDB.get(st.id).name}`, desc: `Condition ${Math.round(cond * 100)}% → 100%`, price: Math.max(6, Math.round((1 - cond) * itemValue({ id: st.id }) * 0.5)), ok: cond < 0.995, slot });
      }
    }
    return out;
  }

  _giveValue() {
    let v = 0;
    for (const [i, q] of this.give) { const s = this.inv.slots[i]; if (s) v += itemValue(s, q) * BUY_RATE; }
    return v;
  }

  _takeValue() {
    let v = 0;
    const svc = this._services();
    for (const [k, q] of this.take) {
      if (typeof k === 'string') { const s = svc.find((x) => x.key === k); if (s) v += s.price; }
      else { const s = this.t.state.stock[k]; if (s) v += itemValue(s, q) * this.mul; }
    }
    return v;
  }

  _row(stack, priceEach, onclick, extra = {}) {
    const def = ItemDB.get(stack.id);
    const cond = def?.cat === 'weapon' && stack.data?.cond !== undefined ? ` · ${Math.round(stack.data.cond * 100)}%` : '';
    return h('div', { class: `trade-row${extra.dim ? ' dim' : ''}`, onclick, title: def?.desc || '' },
      h('img', { class: 'ic', src: this.game.icons.icon(stack.id), alt: '' }),
      h('span', { class: 'nm' }, def?.name || stack.id, h('small', {}, cond)),
      h('span', { class: 'q' }, extra.qty ?? (stack.qty > 1 ? `×${stack.qty}` : '')),
      h('span', { class: 'pr' }, fmt(priceEach)));
  }

  render() {
    if (!this.isOpen) return;
    clear(this.el);
    const T = this.t.def;
    const wrap = h('div', { class: 'panel trade interactive', onmousedown: (e) => e.stopPropagation() });
    const tabs = [['trade', 'Trade']];
    if ((T.services || []).includes('jobs')) tabs.push(['jobs', 'Job board']);
    if ((T.services || []).includes('rumours')) tabs.push(['rumours', 'Ask around']);
    wrap.append(...[
      h('div', { class: 'panel-head' }, h('h2', {}, T.name), h('span', { class: 'sub' }, `${T.title} · Riverside${this.mul !== 1 ? ` · prices ×${this.mul}` : ''}`)),
      h('div', { class: 'trade-greet' }, `“${T.greeting}”`),
      tabs.length > 1 ? h('div', { class: 'trade-tabs' }, ...tabs.map(([k, l]) => h('button', { class: `btn small${this.tab === k ? ' primary' : ''}`, onclick: () => { this.tab = k; this.render(); } }, l))) : null,
    ].filter(Boolean));
    if (this.tab === 'jobs') wrap.appendChild(this._jobs());
    else if (this.tab === 'rumours') wrap.appendChild(this._rumours());
    else wrap.appendChild(this._tradeBody());
    wrap.appendChild(h('div', { class: 'inv-foot' }, h('span', { class: 'hint' }, 'Click: one · Shift+click: whole stack · Esc / E: close'), h('button', { class: 'btn small', onclick: () => this.ui.close() }, 'Leave')));
    this.el.appendChild(wrap);
  }

  _tradeBody() {
    const inv = this.inv, stock = this.t.state.stock;
    const body = h('div', { class: 'trade-body' });
    // your items
    const mine = h('div', { class: 'trade-col' }, h('div', { class: 'ttl' }, h('span', {}, 'You carry'), h('b', {}, 'they pay')));
    inv.slots.forEach((s, i) => {
      if (!s) return;
      const left = s.qty - (this.give.get(i) || 0);
      if (left <= 0) return;
      mine.appendChild(this._row({ ...s, qty: left }, itemValue(s, 1) * BUY_RATE, (e) => { this.give.set(i, (this.give.get(i) || 0) + (e.shiftKey ? left : 1)); this.render(); }));
    });
    if (!inv.usedSlots()) mine.appendChild(h('div', { class: 'trade-empty' }, 'Your pockets are empty'));
    // the table
    const gv = this._giveValue(), tv = this._takeValue();
    const table = h('div', { class: 'trade-col table' });
    table.appendChild(h('div', { class: 'ttl' }, h('span', {}, 'You give'), h('b', {}, fmt(gv))));
    for (const [i, q] of this.give) { const s = inv.slots[i]; if (s) table.appendChild(this._row(s, itemValue(s, q) * BUY_RATE, () => { this.give.delete(i); this.render(); }, { qty: `×${q}` })); }
    table.appendChild(h('div', { class: 'ttl' }, h('span', {}, 'You get'), h('b', {}, fmt(tv))));
    const svc = this._services();
    for (const [k, q] of this.take) {
      if (typeof k === 'string') { const s = svc.find((x) => x.key === k); if (s) table.appendChild(h('div', { class: 'trade-row svc', onclick: () => { this.take.delete(k); this.render(); } }, h('span', { class: 'ic svc-ic' }, '+'), h('span', { class: 'nm' }, s.name), h('span', { class: 'q' }, ''), h('span', { class: 'pr' }, fmt(s.price)))); }
      else { const s = stock[k]; if (s) table.appendChild(this._row(s, itemValue(s, q) * this.mul, () => { this.take.delete(k); this.render(); }, { qty: `×${q}` })); }
    }
    const diff = gv - tv;
    const can = (this.give.size || this.take.size) && diff >= -0.001 && this.take.size;
    table.appendChild(h('div', { class: `trade-bal ${diff >= 0 ? 'ok' : 'bad'}` }, this.take.size ? (diff >= 0 ? (diff > 0.5 ? `You overpay by ${fmt(diff)}` : 'Fair trade') : `Add ${fmt(-diff)} more`) : 'Pick something from the trader'));
    table.appendChild(h('button', { class: 'btn primary', disabled: !can, onclick: () => this._execute() }, 'Trade'));
    if (this.give.size || this.take.size) table.appendChild(h('button', { class: 'btn small', onclick: () => { this.give.clear(); this.take.clear(); this.render(); } }, 'Clear table'));
    // trader stock and services
    const theirs = h('div', { class: 'trade-col' }, h('div', { class: 'ttl' }, h('span', {}, 'Trader has'), h('b', {}, 'price')));
    for (const s of svc) {
      const taken = this.take.has(s.key);
      theirs.appendChild(h('div', { class: `trade-row svc${!s.ok || taken ? ' dim' : ''}`, title: s.desc, onclick: () => { if (s.ok && !taken) { this.take.set(s.key, 1); this.render(); } } },
        h('span', { class: 'ic svc-ic' }, '+'), h('span', { class: 'nm' }, s.name, h('small', {}, ` · ${s.desc}`)), h('span', { class: 'q' }, ''), h('span', { class: 'pr' }, fmt(s.price))));
    }
    stock.forEach((s, i) => {
      const left = s.qty - (this.take.get(i) || 0);
      if (left <= 0) return;
      theirs.appendChild(this._row({ ...s, qty: left }, itemValue(s, 1) * this.mul, (e) => { this.take.set(i, (this.take.get(i) || 0) + (e.shiftKey ? left : 1)); this.render(); }));
    });
    body.append(mine, table, theirs);
    return body;
  }

  _execute() {
    const g = this.game, inv = this.inv, stock = this.t.state.stock;
    if (this._giveValue() + 0.001 < this._takeValue()) return;
    const svc = this._services();
    // take payment out of your inventory (by slot, highest index first so indices stay valid)
    const paid = [];
    for (const [i, q] of [...this.give].sort((a, b) => b[0] - a[0])) {
      const s = inv.slots[i];
      if (!s) continue;
      const n = Math.min(q, s.qty);
      paid.push({ ...s, qty: n, data: s.data ? JSON.parse(JSON.stringify(s.data)) : undefined });
      if (n >= s.qty) inv.slots[i] = null; else s.qty -= n;
    }
    inv.version++;
    for (const p of paid) {
      if (!p.data) { const ex = stock.find((x) => x.id === p.id && !x.data); if (ex) { ex.qty += p.qty; continue; } }
      stock.push(p.data ? p : { id: p.id, qty: p.qty });
    }
    // hand over goods and perform services
    const removeIdx = [];
    for (const [k, q] of this.take) {
      if (typeof k === 'string') {
        const s = svc.find((x) => x.key === k);
        if (!s) continue;
        if (k === 'svc:treat') Object.assign(g.player.survival, { health: 100, bleeding: 0, pain: 0, painkiller: 120 });
        else if (k.startsWith('svc:repair')) { const st = g.player.equipment.slots[s.slot]; if (st?.data) { st.data.cond = 1; st.data.jammed = false; } }
        continue;
      }
      const s = stock[k];
      if (!s) continue;
      const n = Math.min(q, s.qty);
      const given = { ...s, qty: n, ...(s.data ? { data: JSON.parse(JSON.stringify(s.data)) } : {}) };
      let left = n;
      while (left > 0) {
        const part = Math.min(left, ItemDB.stackMax(s.id));
        const rest = inv.add({ ...given, qty: part });
        if (rest) g.dropItem({ ...given, qty: rest });
        left -= part;
      }
      s.qty -= n;
      if (s.qty <= 0) removeIdx.push(k);
    }
    for (const k of removeIdx.sort((a, b) => b - a)) stock.splice(k, 1);
    this.give.clear();
    this.take.clear();
    bus.emit('sound', { type: 'pickup', ui: true });
    bus.emit('notify', { text: `Traded with ${this.t.def.name}`, kind: 'good' });
    g.player.skills?.gain('scavenging', 0.5);
    this.render();
  }

  _jobs() {
    const g = this.game, inv = this.inv;
    const box = h('div', { class: 'trade-jobs' });
    box.appendChild(h('p', { class: 'small' }, 'New work is posted every day. Deliveries are paid on the spot and improve your standing with the Settlement Guard.'));
    for (const j of this.t.jobs) {
      const have = inv.count(j.item);
      const def = ItemDB.get(j.item);
      const reward = j.reward.map(([id, n]) => `${n}× ${ItemDB.get(id)?.name}`).join(', ');
      box.appendChild(h('div', { class: `trade-job${j.done ? ' done' : ''}` },
        h('img', { class: 'ic', src: g.icons.icon(j.item), alt: '' }),
        h('div', { class: 'jt' }, h('b', {}, `Bring ${j.qty}× ${def.name}`), h('span', {}, `Reward: ${reward}`), h('small', {}, j.done ? 'Done for today' : `You have ${have}`)),
        h('button', { class: 'btn small primary', disabled: j.done || have < j.qty, onclick: () => this._handIn(j) }, j.done ? 'Paid' : 'Hand in')));
    }
    return box;
  }

  _handIn(j) {
    const g = this.game, inv = this.inv;
    if (inv.count(j.item) < j.qty || this.t.state.jobsDone.includes(j.index)) return;
    inv.remove(j.item, j.qty);
    for (const [id, n] of j.reward) { const left = inv.add(ItemDB.create(id, n)); if (left) g.dropItem({ id, qty: left }); }
    this.t.state.jobsDone.push(j.index);
    const r = g.factions.rel.guard;
    if (r) r.player = Math.min(100, r.player + 4);
    bus.emit('notify', { text: `${this.t.def.name}: "Good work. Here's your pay."`, kind: 'good' });
    this.t = g.npcs.trader(this.t.role);
    this.render();
  }

  _rumours() {
    const g = this.game, s = this.t.state;
    const box = h('div', { class: 'trade-jobs' });
    const asked = s.rumourDay === g.clock.day;
    box.appendChild(h('p', {}, asked ? `${this.t.def.name}: “That's all I've heard today. Come back tomorrow.”` : 'Travellers stop here all day. Ask what they have been saying.'));
    box.appendChild(h('button', { class: 'btn primary', disabled: asked, onclick: () => {
      const unknown = g.world.pois.filter((q) => !g.discovered.has(q.id) && q.id !== 'riverside');
      const p = g.player.controller.pos;
      unknown.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      const told = unknown.slice(0, 2);
      for (const q of told) g.discovered.add(q.id);
      s.rumourDay = g.clock.day;
      const who = told.map((q) => `${q.name} (${g.poiHostile(q) ? `held by ${g.poiFactionLabel(q) || 'hostiles'}` : g.poiFactionLabel(q) ? `${g.poiFactionLabel(q)} there` : 'nobody there that we know of'})`);
      bus.emit('notify', { text: told.length ? `Marked on your map: ${who.join('; ')}` : 'You already know every place she has heard of.', kind: 'objective' });
      this.render();
    } }, 'Ask what she has heard'));
    const rel = g.factions.relation('player', 'guard');
    box.appendChild(h('p', { class: 'small' }, `Your standing with the Settlement Guard: ${rel >= 50 ? 'trusted' : rel >= 25 ? 'friendly' : rel >= 0 ? 'neutral' : 'distrusted'} (${Math.round(rel)}).`));
    return box;
  }
}
