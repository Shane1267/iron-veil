import { ItemDB } from './ItemDatabase.js';

// Slot-grid inventory with stacking, atomic consume/transfer and weight tracking.
// All mutations validate quantities so stacks can never go negative or duplicate.

export class Inventory {
  constructor(capacity = 12, name = 'Inventory') {
    this.name = name;
    this.slots = new Array(capacity).fill(null);
    this.version = 0; // bumps on every change (UI refresh, save dirty flag)
    this.locked = false; // transfer lock to prevent re-entrant duplication
  }

  get capacity() {
    return this.slots.length;
  }

  setCapacity(n) {
    n = Math.max(0, n | 0);
    if (n < this.slots.length) {
      // only allowed if the removed tail is empty
      for (let i = n; i < this.slots.length; i++) if (this.slots[i]) return false;
      this.slots.length = n;
    } else {
      while (this.slots.length < n) this.slots.push(null);
    }
    this.version++;
    return true;
  }

  usedSlots() {
    return this.slots.reduce((a, s) => a + (s ? 1 : 0), 0);
  }

  /** Lowest number of trailing slots that could be removed after compacting. */
  canShrinkTo(n) {
    return this.usedSlots() <= n;
  }

  compact() {
    const items = this.slots.filter(Boolean);
    this.slots.fill(null);
    items.forEach((s, i) => { this.slots[i] = s; });
    this.version++;
  }

  weight() {
    let w = 0;
    for (const s of this.slots) if (s) w += (ItemDB.get(s.id)?.weight || 0) * s.qty;
    return w;
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.qty;
    return n;
  }

  has(requirements) {
    for (const [id, qty] of Object.entries(requirements)) if (this.count(id) < qty) return false;
    return true;
  }

  find(pred) {
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i] && pred(this.slots[i])) return i;
    return -1;
  }

  static stackable(a, b) {
    return a && b && a.id === b.id && !a.data && !b.data && ItemDB.stackMax(a.id) > 1;
  }

  /**
   * Add a stack. Returns leftover quantity that did not fit (0 = everything added).
   * The passed object is not retained if it was merged.
   */
  add(stack) {
    if (!stack || !ItemDB.exists(stack.id) || !(stack.qty > 0)) return 0;
    let qty = Math.floor(stack.qty);
    const max = ItemDB.stackMax(stack.id);
    if (!stack.data && max > 1) {
      for (const s of this.slots) {
        if (!s || s.id !== stack.id || s.data) continue;
        const room = max - s.qty;
        if (room <= 0) continue;
        const n = Math.min(room, qty);
        s.qty += n;
        qty -= n;
        if (qty === 0) break;
      }
    }
    while (qty > 0) {
      const i = this.slots.indexOf(null);
      if (i < 0) break;
      const n = Math.min(max, qty);
      this.slots[i] = { id: stack.id, qty: n, ...(stack.data ? { data: structuredCloneSafe(stack.data) } : {}) };
      qty -= n;
      if (stack.data) break; // unique items are never split
    }
    this.version++;
    return qty;
  }

  /** Can the whole stack fit? */
  canAdd(stack) {
    const max = ItemDB.stackMax(stack.id);
    let room = 0;
    for (const s of this.slots) {
      if (!s) room += max;
      else if (!stack.data && s.id === stack.id && !s.data) room += max - s.qty;
      if (room >= stack.qty) return true;
    }
    return room >= stack.qty;
  }

  /** Remove up to qty of an item id. Returns amount removed. */
  remove(id, qty) {
    qty = Math.floor(qty);
    if (qty <= 0) return 0;
    let removed = 0;
    // take from the smallest stacks first to tidy the inventory
    const idx = [];
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i] && this.slots[i].id === id) idx.push(i);
    idx.sort((a, b) => this.slots[a].qty - this.slots[b].qty);
    for (const i of idx) {
      const s = this.slots[i];
      const n = Math.min(s.qty, qty - removed);
      s.qty -= n;
      removed += n;
      if (s.qty <= 0) this.slots[i] = null;
      if (removed >= qty) break;
    }
    if (removed) this.version++;
    return removed;
  }

  /** Atomically consume a requirement map. Returns false (and changes nothing) if short. */
  consume(requirements) {
    if (!this.has(requirements)) return false;
    for (const [id, qty] of Object.entries(requirements)) this.remove(id, qty);
    return true;
  }

  takeSlot(i, qty = Infinity) {
    const s = this.slots[i];
    if (!s) return null;
    const n = Math.min(s.qty, Math.max(1, Math.floor(qty)));
    if (n >= s.qty) {
      this.slots[i] = null;
      this.version++;
      return s;
    }
    s.qty -= n;
    this.version++;
    return { id: s.id, qty: n };
  }

  /** Move/merge/swap between two slots of this inventory. */
  moveSlot(from, to) {
    if (from === to || from < 0 || to < 0 || from >= this.slots.length || to >= this.slots.length) return false;
    const a = this.slots[from], b = this.slots[to];
    if (!a) return false;
    if (Inventory.stackable(a, b)) {
      const max = ItemDB.stackMax(a.id);
      const n = Math.min(max - b.qty, a.qty);
      b.qty += n;
      a.qty -= n;
      if (a.qty <= 0) this.slots[from] = null;
    } else {
      this.slots[from] = b;
      this.slots[to] = a;
    }
    this.version++;
    return true;
  }

  /**
   * Transfer a slot (or part of it) into another inventory. Atomic with respect to
   * duplication: quantity is removed from this inventory only for what was accepted.
   */
  transfer(i, target, qty = Infinity, targetSlot = -1) {
    if (this.locked || target.locked) return 0;
    const s = this.slots[i];
    if (!s) return 0;
    this.locked = target.locked = true;
    try {
      const n = Math.min(s.qty, Math.max(1, Math.floor(qty === Infinity ? s.qty : qty)));
      if (targetSlot >= 0 && targetSlot < target.slots.length) {
        const t = target.slots[targetSlot];
        if (!t) {
          target.slots[targetSlot] = { id: s.id, qty: n, ...(s.data ? { data: s.data } : {}) };
          this._reduce(i, n);
          target.version++;
          return n;
        }
        if (Inventory.stackable(s, t)) {
          const room = ItemDB.stackMax(t.id) - t.qty;
          const m = Math.min(room, n);
          if (m <= 0) return 0;
          t.qty += m;
          this._reduce(i, m);
          target.version++;
          return m;
        }
        // occupied by something else: fall through to normal add
      }
      const probe = { id: s.id, qty: n, ...(s.data ? { data: s.data } : {}) };
      const leftover = target.add(probe);
      const moved = n - leftover;
      if (moved > 0) this._reduce(i, moved);
      return moved;
    } finally {
      this.locked = target.locked = false;
    }
  }

  _reduce(i, n) {
    const s = this.slots[i];
    s.qty -= n;
    if (s.qty <= 0) this.slots[i] = null;
    this.version++;
  }

  /** Move everything possible into target. Returns number of stacks fully moved. */
  transferAll(target) {
    let moved = 0;
    for (let i = 0; i < this.slots.length; i++) {
      if (!this.slots[i]) continue;
      const before = this.slots[i].qty;
      const n = this.transfer(i, target);
      if (n === before) moved++;
    }
    return moved;
  }

  sort() {
    const items = this.slots.filter(Boolean);
    // merge partial stacks first
    const merged = [];
    for (const s of items) {
      const m = merged.find((x) => Inventory.stackable(x, s) && x.qty < ItemDB.stackMax(x.id));
      if (m) {
        const room = ItemDB.stackMax(m.id) - m.qty;
        const n = Math.min(room, s.qty);
        m.qty += n;
        if (s.qty - n > 0) merged.push({ ...s, qty: s.qty - n });
      } else merged.push(s);
    }
    merged.sort((a, b) => {
      const da = ItemDB.get(a.id), db = ItemDB.get(b.id);
      return ItemDB.categoryIndex(da.cat) - ItemDB.categoryIndex(db.cat) || da.name.localeCompare(db.name) || b.qty - a.qty;
    });
    this.slots.fill(null);
    merged.forEach((s, i) => { if (i < this.slots.length) this.slots[i] = s; });
    this.version++;
  }

  serialize() {
    return { cap: this.slots.length, slots: this.slots.map((s) => (s ? { id: s.id, qty: s.qty, ...(s.data ? { data: s.data } : {}) } : null)) };
  }

  static deserialize(obj, name) {
    const inv = new Inventory(Math.max(0, Math.min(200, obj?.cap | 0)), name);
    if (Array.isArray(obj?.slots)) {
      obj.slots.forEach((s, i) => {
        if (i >= inv.slots.length || !s || !ItemDB.exists(s.id)) return;
        const qty = Math.floor(Number(s.qty));
        if (!(qty > 0)) return;
        inv.slots[i] = { id: s.id, qty: Math.min(qty, ItemDB.stackMax(s.id)), ...(s.data && typeof s.data === 'object' ? { data: s.data } : {}) };
      });
    }
    return inv;
  }
}

function structuredCloneSafe(o) {
  return JSON.parse(JSON.stringify(o));
}
