import lootData from '../data/lootTables.json';
import { ItemDB } from './ItemDatabase.js';
import { Inventory } from './Inventory.js';
import { RNG, hashString } from '../core/MathUtil.js';

// Container contents: generated deterministically on first access from the container's
// loot profile, persisted once touched, and restocked only when empty and after the
// configured respawn interval (in game minutes).

export const PROFILES = lootData.profiles;

export function rollLoot(profileName, seed, capacity = 12) {
  const profile = PROFILES[profileName] || PROFILES.residential;
  const rng = new RNG(seed);
  const inv = new Inventory(capacity);
  for (const f of profile.fixed || []) {
    if (!ItemDB.exists(f.item)) continue;
    const st = ItemDB.create(f.item, f.min !== undefined ? rng.int(f.min, f.max ?? f.min) : 1);
    if (st.data && ItemDB.get(f.item).cat === 'weapon') { st.data.cond = 0.7 + rng.next() * 0.2; st.data.ammo = 0; }
    inv.add(st);
  }
  if (rng.chance(profile.empty || 0)) return inv;
  const rolls = rng.int(profile.rolls[0], profile.rolls[1]);
  for (let r = 0; r < rolls; r++) {
    const e = rng.weighted(profile.entries);
    if (!ItemDB.exists(e.item)) continue;
    const def = ItemDB.get(e.item);
    const qty = e.min !== undefined ? rng.int(e.min, e.max ?? e.min) : 1;
    const stack = ItemDB.create(e.item, qty);
    if (def.cat === 'weapon') {
      const w = def.weapon;
      stack.data.cond = 0.45 + rng.next() * 0.5;
      if (w.magSize) stack.data.ammo = rng.chance(0.45) ? rng.int(0, w.magSize) : 0;
    }
    inv.add(stack);
  }
  return inv;
}

export class LootSystem {
  constructor() {
    this.containers = new Map(); // id -> {inv, cycle, profile, onceTaken}
    this.respawnMinutes = 45;
  }

  /** Get (and lazily generate / restock) a container inventory. gameMinutes = world clock. */
  open(id, profile, capacity, gameMinutes) {
    let c = this.containers.get(id);
    const cycle = this.respawnMinutes > 0 ? Math.floor(gameMinutes / this.respawnMinutes) : 0;
    const once = PROFILES[profile]?.once;
    if (!c) {
      const inv = rollLoot(profile, hashString(`${id}#${cycle}`), capacity);
      c = { inv, cycle, profile, once: !!once };
      this.containers.set(id, c);
    } else if (!c.once && this.respawnMinutes > 0 && cycle > c.cycle && c.inv.usedSlots() === 0) {
      c.inv = rollLoot(profile, hashString(`${id}#${cycle}`), capacity);
      c.cycle = cycle;
    }
    c.inv.name = c.inv.name || 'Container';
    return c.inv;
  }

  /** Register an existing inventory (corpses, dropped piles, base storage). */
  register(id, inv, opts = {}) {
    this.containers.set(id, { inv, cycle: Infinity, profile: null, once: true, custom: true, ...opts });
    return inv;
  }

  get(id) {
    return this.containers.get(id)?.inv || null;
  }

  remove(id) {
    this.containers.delete(id);
  }

  serialize() {
    const out = {};
    for (const [id, c] of this.containers) {
      if (c.transient) continue;
      out[id] = { cycle: Number.isFinite(c.cycle) ? c.cycle : -1, profile: c.profile, once: c.once, custom: !!c.custom, inv: c.inv.serialize(), meta: c.meta || null };
    }
    return out;
  }

  deserialize(obj) {
    this.containers.clear();
    if (!obj || typeof obj !== 'object') return;
    for (const [id, c] of Object.entries(obj)) {
      if (!c || typeof c !== 'object') continue;
      this.containers.set(id, {
        inv: Inventory.deserialize(c.inv, 'Container'), cycle: c.cycle >= 0 ? c.cycle : Infinity, profile: c.profile, once: !!c.once, custom: !!c.custom, meta: c.meta || null,
      });
    }
  }
}
