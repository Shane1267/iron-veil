import { ItemDB } from './ItemDatabase.js';
import { Inventory } from './Inventory.js';

// Character equipment: weapon slots, clothing/armour slots and the carried inventory
// whose capacity is derived from worn clothing, vest and backpack.

export const WEAPON_SLOTS = ['primary', 'shoulder', 'sidearm', 'melee'];
export const GEAR_SLOTS = ['head', 'body', 'vest', 'back', 'util'];
export const BASE_SLOTS = 6;

export class Equipment {
  constructor() {
    this.slots = {};
    for (const s of [...WEAPON_SLOTS, ...GEAR_SLOTS]) this.slots[s] = null;
    this.inventory = new Inventory(BASE_SLOTS, 'Pockets');
    this.quick = [null, null, null, null]; // item ids bound to keys 5-8
    this.version = 0;
  }

  capacity() {
    let n = BASE_SLOTS;
    for (const s of GEAR_SLOTS) {
      const it = this.slots[s];
      if (it) n += ItemDB.get(it.id)?.equip?.slots || 0;
    }
    return n;
  }

  refreshCapacity() {
    const cap = this.capacity();
    if (cap < this.inventory.capacity) {
      this.inventory.compact();
    }
    return this.inventory.setCapacity(cap);
  }

  /** Which slot(s) can an item occupy. */
  static slotsFor(id) {
    const def = ItemDB.get(id);
    if (!def) return [];
    if (def.cat === 'weapon') {
      const s = def.weapon.slot;
      if (s === 'primary') return ['primary', 'shoulder'];
      return [s];
    }
    if (def.equip) return [def.equip.slot];
    return [];
  }

  canEquipTo(id, slot) {
    return Equipment.slotsFor(id).includes(slot);
  }

  /**
   * Equip the stack at inventory slot index into an equipment slot.
   * Returns {ok, msg}. The previous item goes back into the inventory slot.
   */
  equipFromInventory(index, slot) {
    const inv = this.inventory;
    const s = inv.slots[index];
    if (!s) return { ok: false, msg: 'Nothing there' };
    const options = Equipment.slotsFor(s.id);
    if (!options.length) return { ok: false, msg: 'Cannot equip that' };
    if (!slot) slot = options.find((o) => !this.slots[o]) || options[0];
    if (!options.includes(slot)) return { ok: false, msg: 'Wrong slot for that item' };
    const prev = this.slots[slot];
    // capacity check: swapping gear may reduce capacity
    const item = s.qty > 1 ? { id: s.id, qty: 1, ...(s.data ? { data: s.data } : {}) } : s;
    const before = this.slots[slot];
    this.slots[slot] = item;
    const capAfter = this.capacity();
    const usedAfter = inv.usedSlots() - (s.qty > 1 ? 0 : 1) + (prev ? 1 : 0);
    if (usedAfter > capAfter) {
      this.slots[slot] = before;
      return { ok: false, msg: 'Not enough space: empty some slots first' };
    }
    if (s.qty > 1) {
      s.qty -= 1;
      if (prev) {
        const left = inv.add(prev);
        if (left) { s.qty += 1; this.slots[slot] = prev; return { ok: false, msg: 'No room for the swapped item' }; }
      }
    } else {
      inv.slots[index] = prev || null;
    }
    inv.version++;
    this.refreshCapacity();
    this.version++;
    return { ok: true, slot };
  }

  /** Unequip into the inventory (or fail if there is no room / capacity would shrink). */
  unequip(slot) {
    const it = this.slots[slot];
    if (!it) return { ok: false, msg: 'Slot empty' };
    const def = ItemDB.get(it.id);
    const lose = def.equip?.slots || 0;
    const capAfter = this.capacity() - lose;
    if (this.inventory.usedSlots() + 1 > capAfter) return { ok: false, msg: 'No room in inventory' };
    this.slots[slot] = null;
    this.refreshCapacity();
    const left = this.inventory.add(it);
    if (left) {
      this.slots[slot] = it;
      this.refreshCapacity();
      return { ok: false, msg: 'No room in inventory' };
    }
    this.version++;
    return { ok: true };
  }

  /** Remove an equipped item entirely (e.g. drop). */
  takeEquipped(slot) {
    const it = this.slots[slot];
    if (!it) return null;
    const def = ItemDB.get(it.id);
    const lose = def.equip?.slots || 0;
    if (lose && this.inventory.usedSlots() > this.capacity() - lose) return null;
    this.slots[slot] = null;
    this.refreshCapacity();
    this.version++;
    return it;
  }

  armorFor(zone) {
    let a = 0;
    for (const s of ['head', 'vest', 'body']) {
      const it = this.slots[s];
      const e = it && ItemDB.get(it.id)?.equip;
      if (e?.armor && e.zones?.includes(zone)) a = Math.max(a, e.armor);
    }
    return a;
  }

  insulation() {
    let v = 0;
    for (const s of GEAR_SLOTS) {
      const it = this.slots[s];
      if (it) v += ItemDB.get(it.id)?.equip?.insulation || 0;
    }
    return v;
  }

  rainProtection() {
    let v = 0;
    for (const s of GEAR_SLOTS) {
      const it = this.slots[s];
      if (it) v = Math.max(v, ItemDB.get(it.id)?.equip?.rain || 0);
    }
    return v;
  }

  totalWeight() {
    let w = this.inventory.weight();
    for (const s of Object.keys(this.slots)) {
      const it = this.slots[s];
      if (it) w += ItemDB.get(it.id)?.weight || 0;
    }
    return w;
  }

  serialize() {
    return { slots: this.slots, inventory: this.inventory.serialize(), quick: this.quick };
  }

  static deserialize(o) {
    const e = new Equipment();
    if (o && typeof o === 'object') {
      for (const k of Object.keys(e.slots)) {
        const it = o.slots?.[k];
        if (it && ItemDB.exists(it.id) && Equipment.slotsFor(it.id).includes(k)) e.slots[k] = { id: it.id, qty: 1, ...(it.data ? { data: it.data } : {}) };
      }
      e.inventory = Inventory.deserialize(o.inventory, 'Pockets');
      if (Array.isArray(o.quick)) e.quick = o.quick.slice(0, 4).map((q) => (q && ItemDB.exists(q) ? q : null));
      while (e.quick.length < 4) e.quick.push(null);
      // capacity must match equipment; never drop items silently
      const cap = e.capacity();
      if (e.inventory.capacity < cap) e.inventory.setCapacity(cap);
    }
    return e;
  }
}
