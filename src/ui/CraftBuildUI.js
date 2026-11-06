import { h, clear } from './dom.js';
import { ItemDB } from '../items/ItemDatabase.js';
import { RECIPES, REPAIR } from '../items/CraftingSystem.js';
import { PIECES } from '../basebuilding/BaseSystem.js';
import { WEAPON_SLOTS } from '../items/Equipment.js';
import { bus } from '../core/EventBus.js';

// Crafting (with workbench-only recipes and weapon repair) and the base-building
// piece selector.

export class CraftUI {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.el = h('div', { class: 'screen dim hidden' });
    ui.root.appendChild(this.el);
    this.selected = RECIPES[0].id;
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }
  open() { this.el.classList.remove('hidden'); this.render(); }
  close() { this.el.classList.add('hidden'); }

  render() {
    if (!this.isOpen) return;
    clear(this.el);
    const g = this.game;
    const inv = g.player.equipment.inventory;
    const near = (st) => g.nearStation(st);
    const wrap = h('div', { class: 'panel craft-wrap interactive' });
    wrap.appendChild(h('div', { class: 'panel-head' }, h('h2', {}, 'Crafting'), h('span', { class: 'sub' }, g.nearStation('workbench') ? 'Workbench available' : 'No workbench nearby — advanced recipes unavailable')));
    const body = h('div', { class: 'craft-body' });
    const list = h('div', { class: 'recipes' });
    for (const r of RECIPES) {
      const miss = g.crafting.missing(r, inv, near);
      const out = ItemDB.get(r.out);
      const reqs = Object.entries(r.in).map(([id, n]) => {
        const have = inv.count(id);
        return h('span', { class: have < n ? 'miss' : '' }, `${ItemDB.get(id).name} ${have}/${n}  `);
      });
      list.appendChild(h('div', { class: `recipe ${this.selected === r.id ? 'sel' : ''}`, onclick: () => { this.selected = r.id; this.render(); } },
        h('div', { class: 'ic', style: { backgroundImage: `url(${g.icons.icon(r.out)})` } }),
        h('div', {}, h('div', { class: 'n' }, `${out.name}${r.qty > 1 ? ` ×${r.qty}` : ''}`), h('div', { class: 'r' }, ...reqs, r.station ? h('span', { class: near(r.station) ? '' : 'miss' }, '· Workbench') : '', ...(r.tools || []).map((t) => h('span', { class: inv.count(t) ? '' : 'miss' }, ` · ${ItemDB.get(t).name}`)))),
        h('span', { class: miss.length ? 'no' : 'ok' }, miss.length ? 'Missing' : 'Ready')));
    }
    body.appendChild(list);
    const r = RECIPES.find((x) => x.id === this.selected);
    const det = h('div', { class: 'craft-detail' });
    if (r) {
      const out = ItemDB.get(r.out);
      const miss = g.crafting.missing(r, inv, near);
      det.append(
        h('div', { class: 'big', style: { backgroundImage: `url(${g.icons.icon(r.out)})` } }),
        h('div', { style: { fontSize: '18px' } }, out.name, r.qty > 1 ? ` ×${r.qty}` : ''),
        h('div', { style: { color: 'var(--ink-dim)', fontSize: '13px' } }, out.desc || ''),
        h('div', { style: { color: miss.length ? '#e79a8c' : 'var(--good)', fontSize: '12px' } }, miss.length ? miss.join(' · ') : `Takes ${r.time}s`),
        h('button', { class: 'btn primary', disabled: !!miss.length || !!g.crafting.job, onclick: () => {
          const res = g.crafting.start(r.id, inv, near);
          if (!res.ok) bus.emit('notify', { text: res.msg, kind: 'warn' });
          this.render();
        } }, g.crafting.job ? 'Crafting…' : 'Craft'),
      );
    }
    // weapon repair at a workbench
    det.appendChild(h('div', { style: { marginTop: '18px', borderTop: '1px solid var(--line)', paddingTop: '12px' } },
      h('div', { style: { fontSize: '10px', letterSpacing: '0.22em', color: 'var(--amber)', textTransform: 'uppercase' } }, 'Weapon maintenance'),
      h('div', { style: { fontSize: '12px', color: 'var(--ink-dim)', margin: '6px 0' } }, `Restores ${REPAIR.weaponAmount}% condition. Costs ${Object.entries(REPAIR.weaponCost).map(([k, v]) => `${v} ${ItemDB.get(k).name}`).join(', ')}. Requires a workbench.`),
      ...WEAPON_SLOTS.filter((s) => g.player.equipment.slots[s] && ItemDB.get(g.player.equipment.slots[s].id).weapon.class !== 'melee').map((s) => {
        const st = g.player.equipment.slots[s];
        const cond = Math.round((st.data?.cond ?? 1) * 100);
        const can = g.nearStation('workbench') && inv.has(REPAIR.weaponCost) && cond < 100;
        return h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0', fontSize: '13px' } },
          h('span', {}, `${ItemDB.get(st.id).name} — ${cond}%`),
          h('button', { class: 'btn small', disabled: !can, onclick: () => {
            if (!inv.consume(REPAIR.weaponCost)) return;
            st.data.cond = Math.min(1, (st.data.cond ?? 1) + REPAIR.weaponAmount / 100);
            g.player.skills.gain('crafting', 1);
            bus.emit('notify', { text: `${ItemDB.get(st.id).name} repaired`, kind: 'good' });
            bus.emit('sound', { type: 'build', ui: true });
            this.render();
          } }, 'Repair'));
      })));
    body.appendChild(det);
    wrap.appendChild(body);
    this.el.appendChild(wrap);
  }
}

export class BuildMenuUI {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.el = h('div', { class: 'screen dim hidden' });
    ui.root.appendChild(this.el);
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }
  open() { this.el.classList.remove('hidden'); this.render(); }
  close() { this.el.classList.add('hidden'); }

  render() {
    clear(this.el);
    const g = this.game;
    const inv = g.player.equipment.inventory;
    const wrap = h('div', { class: 'panel craft-wrap interactive', style: { height: 'auto', maxHeight: '86vh' } });
    wrap.appendChild(h('div', { class: 'panel-head' }, h('h2', {}, 'Construction'), h('span', { class: 'sub' }, 'Select a piece, then place it in the world')));
    const CATS = [['all', 'All'], ['structure', 'Structure'], ['defence', 'Defence'], ['storage', 'Storage'], ['production', 'Production'], ['utility', 'Utility'], ['furniture', 'Furniture']];
    this.cat = this.cat || 'all';
    wrap.appendChild(h('div', { class: 'trade-tabs' }, ...CATS.map(([k, l]) => h('button', { class: `btn small${this.cat === k ? ' primary' : ''}`, onclick: () => { this.cat = k; this.render(); } }, l))));
    const grid = h('div', { class: 'build-grid' });
    grid.appendChild(h('div', { class: 'bpiece', onclick: () => { g.base.enter(); g.base.selected = null; g.base._clearGhost(); this.ui.close(); } },
      h('div', { class: 'n' }, 'Repair / Move / Dismantle'), h('div', { class: 'c' }, 'Aim at a piece: E repairs (30% cost), R picks it up to move it (full refund, undamaged and empty), F dismantles (50% refund).')));
    for (const p of PIECES.filter((x) => this.cat === 'all' || x.cat === this.cat)) {
      const ok = inv.has(p.cost) && (!p.tool || inv.count(p.tool));
      const cost = Object.entries(p.cost).map(([id, n]) => h('span', { class: inv.count(id) < n ? 'miss' : '' }, `${ItemDB.get(id).name} ${inv.count(id)}/${n}`, h('br')));
      grid.appendChild(h('div', { class: `bpiece ${ok ? '' : 'cant'}`, onclick: () => { g.base.enter(p.id); this.ui.close(); } },
        h('div', { class: 'n' }, p.name), h('div', { class: 'c' }, ...(p.desc ? [h('span', { class: 'd' }, p.desc), h('br')] : []), ...cost, p.tool ? h('span', { class: inv.count(p.tool) ? '' : 'miss' }, `Tool: ${ItemDB.get(p.tool).name}`) : '')));
    }
    wrap.appendChild(grid);
    wrap.appendChild(h('div', { class: 'inv-foot' }, h('span', {}, 'Mouse wheel: next piece in the same group · Q rotates · right click leaves build mode · foundations snap to a 3 m grid'), h('button', { class: 'btn small', onclick: () => this.ui.close() }, 'Close')));
    this.el.appendChild(wrap);
  }
}
