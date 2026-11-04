import { bus } from './EventBus.js';
import { ItemDB } from '../items/ItemDatabase.js';

// "Signal from Northwatch" — the playable survival scenario that frames the first
// release's core loop. Each step is checked against real game state.

export const STEPS = [
  { id: 'arm', title: 'Arm yourself', hint: 'Search houses and cabins near Millbrook for a firearm and ammunition.' },
  { id: 'materials', title: 'Gather building materials', hint: 'Collect at least 20 wooden planks, 40 nails and a hammer (farms, logging camp, warehouses).' },
  { id: 'base', title: 'Establish a base', hint: 'Press G to build: a foundation, three walls (any type) and a storage crate.' },
  { id: 'codebook', title: 'Recover the Northwatch codebook', hint: 'The VSF headquarters at Northwatch Military Base (north) holds signal tables on its upper floor.' },
  { id: 'transmit', title: 'Transmit from the Old Communications Tower', hint: 'Use the radio in the tower compound west of the highway checkpoint while carrying the codebook.' },
  { id: 'survive', title: 'Survive in Vesper', hint: 'The Settlement Guard at Riverside and the Evacuation Centre now treat you as an ally. Explore, build and survive.' },
];

export class Objectives {
  constructor(game) {
    this.game = game;
    this.index = 0;
    this.completed = new Set();
    this.timer = 0;
  }

  get current() {
    return STEPS[this.index] || null;
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1;
    const s = this.current;
    if (!s || s.id === 'survive') return;
    if (this._check(s.id)) this._complete(s.id);
  }

  _check(id) {
    const g = this.game;
    const eq = g.player.equipment;
    const inv = eq.inventory;
    const base = g.base;
    const count = (t) => [...base.pieces.values()].filter((p) => (Array.isArray(t) ? t.includes(p.type) : p.type === t)).length;
    switch (id) {
      case 'arm':
        return ['primary', 'shoulder', 'sidearm'].some((s) => eq.slots[s] && ItemDB.get(eq.slots[s].id)?.weapon?.class !== 'melee');
      case 'materials':
        return (inv.count('wood_plank') >= 20 && inv.count('nails') >= 40 && inv.count('tool_hammer') >= 1) || base.pieces.size >= 3;
      case 'base':
        return count('foundation') >= 1 && count(['wall', 'wall_reinforced', 'doorway', 'window_wall', 'firing_wall', 'gate']) >= 3 && count(['crate', 'locker']) >= 1;
      case 'codebook':
        return inv.count('codebook') > 0 || [...base.pieces.values()].some((p) => p.inventory?.count('codebook') > 0);
      default:
        return false;
    }
  }

  _complete(id) {
    this.completed.add(id);
    this.index = Math.min(STEPS.length - 1, this.index + 1);
    bus.emit('objective:complete', { id, next: this.current });
    bus.emit('notify', { text: `Objective complete: ${STEPS.find((s) => s.id === id).title}`, kind: 'objective' });
  }

  /** Radio interaction at the comm tower. */
  transmit() {
    const s = this.current;
    if (!s || s.id !== 'transmit') {
      if (this.completed.has('transmit')) return { ok: false, msg: 'Only static on the band now.' };
      return { ok: false, msg: 'Static. Without authentication tables nobody will answer.' };
    }
    if (this.game.player.equipment.inventory.count('codebook') < 1) return { ok: false, msg: 'You need the Northwatch codebook in your inventory.' };
    // consequence: the Settlement Guard become allies; VSF are furious
    const F = this.game.factions;
    F.rel.guard.player = 60;
    F.rel.indep.player = Math.max(F.rel.indep.player, 30);
    F.rel.vsf.player = -90;
    this._complete('transmit');
    return { ok: true, msg: 'Riverside answers: "Authenticated. You are welcome at Riverside and the Evacuation Centre." The VSF heard it too.' };
  }

  serialize() {
    return { index: this.index, completed: [...this.completed] };
  }

  deserialize(o) {
    this.index = Math.max(0, Math.min(STEPS.length - 1, o?.index | 0));
    this.completed = new Set(Array.isArray(o?.completed) ? o.completed : []);
  }
}
