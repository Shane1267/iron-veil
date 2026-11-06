import itemsData from '../data/items.json';
import weaponsData from '../data/weapons.json';

// Single source of truth for item definitions. Weapons from weapons.json are mirrored
// as items (category "weapon", stack 1) so inventories treat everything uniformly.

const CATEGORY_ORDER = ['weapon', 'ammo', 'explosive', 'attachment', 'medical', 'food', 'drink', 'clothing', 'backpack', 'tool', 'construction', 'technical', 'misc'];

class ItemDatabaseImpl {
  constructor() {
    this.items = new Map();
    this.weapons = new Map();
    for (const w of weaponsData.weapons) {
      this.weapons.set(w.id, w);
      this.items.set(w.id, {
        id: w.id, name: w.name, cat: 'weapon', stack: 1, weight: w.weight, weapon: w,
        desc: weaponDesc(w), shape: 'weapon',
      });
    }
    for (const it of itemsData.items) this.items.set(it.id, it);
  }

  get(id) {
    return this.items.get(id) || null;
  }

  weapon(id) {
    return this.weapons.get(id) || null;
  }

  exists(id) {
    return this.items.has(id);
  }

  stackMax(id) {
    return this.items.get(id)?.stack ?? 1;
  }

  categoryIndex(cat) {
    const i = CATEGORY_ORDER.indexOf(cat);
    return i < 0 ? 99 : i;
  }

  get categories() {
    return CATEGORY_ORDER;
  }

  /** Create a fresh item stack, including default weapon state. */
  create(id, qty = 1) {
    const def = this.get(id);
    if (!def) throw new Error(`Unknown item ${id}`);
    const stack = { id, qty: Math.max(1, Math.min(qty, def.stack)) };
    if (def.cat === 'weapon') {
      const w = def.weapon;
      stack.qty = 1;
      stack.data = { ammo: 0, mode: 0, cond: 0.75 + Math.random() * 0.25, attach: { ...(w.defaultAttach || {}) }, chambered: true };
    }
    if (def.equip?.light || def.attach?.light) stack.data = { ...(stack.data || {}), charge: 0.5 + Math.random() * 0.5 };
    return stack;
  }
}

function weaponDesc(w) {
  if (w.class === 'melee') return `Melee weapon. Damage ${w.damage}.`;
  const ammo = itemsData.items.find((i) => i.id === w.ammo)?.name || w.ammo;
  const modes = w.fireModes.map((m) => m.toUpperCase()).join(' / ');
  return `${capital(w.class)} · ${ammo} · ${w.magSize} rds · ${modes}${w.action ? ` · ${w.action}-action` : ''}`;
}
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const ItemDB = new ItemDatabaseImpl();
