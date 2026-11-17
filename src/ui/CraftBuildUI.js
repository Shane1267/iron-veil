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
  /** Blueprints tab: save the base to a file, load a file, check materials, build. */
  _blueprints() {
    const g = this.game, B = g.blueprints;
    const box = h('div', { class: 'bp-panel' });
    const say = (r) => { bus.emit('notify', { text: r.msg, kind: r.ok ? 'good' : 'warn' }); this.render(); };
    // save
    const name = h('input', { type: 'text', class: 'bp-name', maxlength: 40, value: this._bpName || 'My base', oninput: (e) => { this._bpName = e.target.value; } });
    const mine = B.capture(this._bpName || 'My base');
    box.appendChild(h('div', { class: 'bp-sec' }, h('h4', {}, 'Save your base'),
      h('div', { class: 'd' }, mine ? `${mine.count} pieces built. The file holds the layout only (no stored items).` : 'You have not built anything yet.'),
      h('div', { class: 'bp-row' }, name, h('button', { class: 'btn small primary', disabled: !mine, onclick: () => say(B.exportFile(name.value || 'My base')) }, 'Save blueprint file'))));
    // load
    const file = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, onchange: (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      if (f.size > 2e6) { say({ ok: false, msg: 'File too large to be a blueprint' }); return; }
      f.text().then((t) => { const r = B.load(t); this._turns = 0; say(r.ok ? { ok: true, msg: `Loaded “${r.blueprint.name}”: ${r.blueprint.count} pieces${r.blueprint.skipped ? ` (${r.blueprint.skipped} unknown pieces skipped)` : ''}` } : r); });
    } });
    const sec = h('div', { class: 'bp-sec' }, h('h4', {}, 'Build from a blueprint'), file,
      h('div', { class: 'bp-row' }, h('button', { class: 'btn small', onclick: () => file.click() }, 'Load blueprint file…'),
        h('button', { class: 'btn small', disabled: !mine, title: 'Use your current base as the blueprint (to build a copy)', onclick: () => { B.loaded = B.parse(mine).blueprint; this._turns = 0; this.render(); } }, 'Use my current base')));
    const bp = B.loaded;
    if (bp) {
      const S = B.site(bp, this._turns || 0);
      const miss = B.missing(bp, S.x, S.z);
      const src = B._sources(S.x, S.z);
      const rows = Object.entries(bp.cost).sort((a, b) => b[1] - a[1]).map(([id, n]) => {
        const have = src.reduce((a, inv) => a + inv.count(id), 0);
        return h('span', { class: have < n ? 'miss' : '' }, `${ItemDB.get(id)?.name || id} ${Math.min(have, n)}/${n}`);
      });
      const ready = !Object.keys(miss).length;
      sec.appendChild(h('div', { class: 'bp-loaded' },
        h('div', { class: 'n' }, `${bp.name} — ${bp.count} pieces, about ${Math.round(S.r * 2)} m across`),
        h('div', { class: 'bp-cost' }, ...rows),
        h('div', { class: 'd' }, ready ? 'You have everything. It will be built in front of you.' : 'Bring the materials shown in red (pockets, or storage within 40 m of the site).'),
        h('div', { class: 'bp-row' },
          h('button', { class: 'btn small', onclick: () => { this._turns = ((this._turns || 0) + 1) % 4; this.render(); } }, `Rotate (${(this._turns || 0) * 90}°)`),
          h('button', { class: `btn small${ready ? ' primary' : ''}`, onclick: () => { const r = B.build(bp, { turns: this._turns || 0 }); bus.emit('notify', { text: r.msg, kind: r.ok ? 'good' : 'warn' }); if (r.ok) this.ui.close(); else this.render(); } }, 'Build here'),
          h('button', { class: 'btn small', onclick: () => { B.loaded = null; this.render(); } }, 'Clear'))));
    }
    box.appendChild(sec);
    return box;
  }

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
    const CATS = [['all', 'All'], ['structure', 'Structure'], ['defence', 'Defence'], ['storage', 'Storage'], ['production', 'Production'], ['utility', 'Utility'], ['furniture', 'Furniture'], ['blueprints', 'Blueprints']];
    this.cat = this.cat || 'all';
    wrap.appendChild(h('div', { class: 'trade-tabs' }, ...CATS.map(([k, l]) => h('button', { class: `btn small${this.cat === k ? ' primary' : ''}`, onclick: () => { this.cat = k; this.render(); } }, l))));
    if (this.cat === 'blueprints') { wrap.appendChild(this._blueprints()); wrap.appendChild(h('div', { class: 'inv-foot' }, h('span', {}, 'Blueprints build in front of you, on the grid. Materials come from your pockets and your storage within 40 m.'), h('button', { class: 'btn small', onclick: () => this.ui.close() }, 'Close'))); this.el.appendChild(wrap); return; }
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
