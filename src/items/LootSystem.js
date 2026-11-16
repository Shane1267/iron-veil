import lootData from '../data/lootTables.json';
import { ItemDB } from './ItemDatabase.js';
import { Inventory } from './Inventory.js';
import { RNG, hashString } from '../core/MathUtil.js';
import resetData from '../data/lootResets.json';
import { settings } from '../core/SettingsManager.js';

export const MAJOR_POIS = resetData.major;
const MAJOR_IDS = new Set(MAJOR_POIS.map((m) => m.poi));
const poiOf = (id) => { const i = id.indexOf(':'); return i > 0 ? id.slice(0, i) : null; };

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
  // settings: rare items scale with the rare-loot chance; sentry components can be limited
  // to the bunker and airfield (their own profiles) instead of every military site
  const rareMul = settings.get('rareLootChance') ?? 1;
  const partsOk = settings.get('turretParts') === 'military';
  const entries = profile.entries.filter((e) => !(e.turretPart && !partsOk)).map((e) => (e.rare ? { ...e, weight: e.weight * rareMul } : e)).filter((e) => e.weight > 0);
  for (let r = 0; r < rolls && entries.length; r++) {
    const e = rng.weighted(entries);
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
    } else if (!c.once && !MAJOR_IDS.has(poiOf(id)) && this.respawnMinutes > 0 && cycle > c.cycle && c.inv.usedSlots() === 0) {
      c.inv = rollLoot(profile, hashString(`${id}#${cycle}`), capacity);
      c.cycle = cycle;
    }
    c.inv.name = c.inv.name || 'Container';
    return c.inv;
  }

  /**
   * Reset every generated container of a location (major sites only reset this way).
   * Returns how many containers were actually re-rolled (0 = nothing had been opened).
   */
  resetPOI(poiId, epoch) {
    let n = 0;
    for (const [id, c] of this.containers) {
      if (c.custom || !c.profile || poiOf(id) !== poiId) continue;
      const cap = c.inv.slots.length;
      const fresh = rollLoot(c.profile, hashString(`${id}#reset${epoch}`), cap);
      c.inv.slots = fresh.slots;
      c.inv.version = (c.inv.version || 0) + 1;
      n++;
    }
    return n;
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
