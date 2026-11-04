import { describe, it, expect } from 'vitest';
import { Inventory } from '../../src/items/Inventory.js';
import { Equipment } from '../../src/items/Equipment.js';
import { ItemDB } from '../../src/items/ItemDatabase.js';
import { LootSystem, rollLoot, PROFILES } from '../../src/items/LootSystem.js';
import { CraftingSystem, RECIPES } from '../../src/items/CraftingSystem.js';
import { effectiveWeapon, attachmentFits } from '../../src/weapons/WeaponData.js';

describe('ItemDatabase', () => {
  it('mirrors every weapon as an item and every loot entry exists', () => {
    expect(ItemDB.get('wpn_arv7').cat).toBe('weapon');
    for (const [name, p] of Object.entries(PROFILES)) {
      for (const e of [...p.entries, ...(p.fixed || [])]) expect(ItemDB.exists(e.item), `${name}: ${e.item}`).toBe(true);
    }
  });
  it('every weapon references an existing ammo item and attachments', () => {
    for (const w of ItemDB.weapons.values()) {
      if (w.class === 'melee') continue;
      expect(ItemDB.exists(w.ammo), w.id).toBe(true);
      for (const list of Object.values(w.attach || {})) for (const a of list) expect(ItemDB.get(a)?.attach, `${w.id}:${a}`).toBeTruthy();
    }
  });
});

describe('Inventory', () => {
  it('stacks up to the stack limit and reports leftovers', () => {
    const inv = new Inventory(2);
    const max = ItemDB.stackMax('ammo_556');
    const left = inv.add({ id: 'ammo_556', qty: max * 2 + 5 });
    expect(left).toBe(5);
    expect(inv.count('ammo_556')).toBe(max * 2);
  });

  it('never produces negative quantities', () => {
    const inv = new Inventory(4);
    inv.add({ id: 'nails', qty: 10 });
    expect(inv.remove('nails', 25)).toBe(10);
    expect(inv.count('nails')).toBe(0);
    expect(inv.slots.every((s) => s === null)).toBe(true);
  });

  it('consume is atomic', () => {
    const inv = new Inventory(6);
    inv.add({ id: 'wood_plank', qty: 4 });
    inv.add({ id: 'nails', qty: 20 });
    expect(inv.consume({ wood_plank: 6, nails: 12 })).toBe(false);
    expect(inv.count('wood_plank')).toBe(4);
    expect(inv.count('nails')).toBe(20);
    expect(inv.consume({ wood_plank: 4, nails: 12 })).toBe(true);
    expect(inv.count('nails')).toBe(8);
  });

  it('transfers conserve total quantity (no duplication)', () => {
    const a = new Inventory(4), b = new Inventory(1);
    a.add({ id: 'ammo_9mm', qty: 60 });
    a.add({ id: 'ammo_9mm', qty: 30 });
    const total = () => a.count('ammo_9mm') + b.count('ammo_9mm');
    const before = total();
    for (let i = 0; i < 10; i++) a.transfer(0, b);
    expect(total()).toBe(before);
    expect(b.count('ammo_9mm')).toBe(60);
  });

  it('unique items move rather than copy', () => {
    const a = new Inventory(2), b = new Inventory(2);
    a.add(ItemDB.create('wpn_vk9'));
    a.transfer(0, b);
    a.transfer(0, b);
    expect(a.count('wpn_vk9') + b.count('wpn_vk9')).toBe(1);
  });

  it('round-trips through serialisation and rejects garbage', () => {
    const a = new Inventory(5);
    a.add({ id: 'bandage', qty: 3 });
    a.add(ItemDB.create('wpn_arv7'));
    const b = Inventory.deserialize(JSON.parse(JSON.stringify(a.serialize())));
    expect(b.count('bandage')).toBe(3);
    expect(b.count('wpn_arv7')).toBe(1);
    const c = Inventory.deserialize({ cap: 3, slots: [{ id: 'nope', qty: 5 }, { id: 'nails', qty: -4 }, { id: 'nails', qty: 'x' }] });
    expect(c.usedSlots()).toBe(0);
  });

  it('sort merges partial stacks', () => {
    const inv = new Inventory(6);
    inv.slots[0] = { id: 'nails', qty: 10 };
    inv.slots[3] = { id: 'nails', qty: 15 };
    inv.sort();
    expect(inv.usedSlots()).toBe(1);
    expect(inv.count('nails')).toBe(25);
  });
});

describe('Equipment', () => {
  it('backpacks add capacity and cannot be removed while needed', () => {
    const eq = new Equipment();
    eq.inventory.add(ItemDB.create('pack_small'));
    expect(eq.equipFromInventory(0).ok).toBe(true);
    expect(eq.inventory.capacity).toBe(6 + 8);
    for (let i = 0; i < 10; i++) eq.inventory.add(ItemDB.create('tool_hammer'));
    expect(eq.unequip('back').ok).toBe(false);
  });

  it('rejects incompatible slots', () => {
    const eq = new Equipment();
    eq.inventory.add(ItemDB.create('helmet_mil'));
    expect(eq.equipFromInventory(0, 'vest').ok).toBe(false);
    expect(eq.equipFromInventory(0, 'head').ok).toBe(true);
    expect(eq.armorFor('head')).toBeGreaterThan(0.4);
  });
});

describe('Loot', () => {
  it('is deterministic per container and seed', () => {
    const a = rollLoot('military', 1234, 12).serialize();
    const b = rollLoot('military', 1234, 12).serialize();
    expect(JSON.stringify(a.slots.map((s) => s && s.id))).toBe(JSON.stringify(b.slots.map((s) => s && s.id)));
  });

  it('does not restock a container that still has items, restocks an emptied one later', () => {
    const L = new LootSystem();
    L.respawnMinutes = 30;
    const inv = L.open('test:c0', 'starter', 10, 0);
    expect(inv.count('wpn_vk9')).toBe(1);
    // take everything
    for (let i = 0; i < inv.slots.length; i++) inv.slots[i] = null;
    expect(L.open('test:c0', 'starter', 10, 10).usedSlots()).toBe(0); // same cycle
    expect(L.open('test:c0', 'starter', 10, 65).usedSlots()).toBeGreaterThan(0); // next cycle
  });

  it('never restocks once-only quest containers', () => {
    const L = new LootSystem();
    L.respawnMinutes = 10;
    const inv = L.open('q', 'codebook', 4, 0);
    expect(inv.count('codebook')).toBe(1);
    inv.remove('codebook', 1);
    expect(L.open('q', 'codebook', 4, 999).count('codebook')).toBe(0);
  });
});

describe('Crafting', () => {
  it('consumes inputs exactly once and refuses concurrent jobs', () => {
    const c = new CraftingSystem();
    const inv = new Inventory(6);
    inv.add({ id: 'cloth', qty: 4 });
    const near = () => false;
    expect(c.start('r_rag', inv, near).ok).toBe(true);
    expect(c.start('r_rag', inv, near).ok).toBe(false); // second click while busy
    let r;
    for (let i = 0; i < 100 && !(r && r.done); i++) r = c.update(0.1, near);
    expect(r.ok).toBe(true);
    expect(inv.count('cloth')).toBe(2);
    expect(inv.count('rag_bandage')).toBe(1);
  });

  it('enforces workbench and tool requirements', () => {
    const c = new CraftingSystem();
    const inv = new Inventory(6);
    inv.add({ id: 'log', qty: 1 });
    expect(c.start('r_planks', inv, () => false).ok).toBe(false);
    inv.add(ItemDB.create('tool_saw'));
    expect(c.start('r_planks', inv, () => true).ok).toBe(true);
  });

  it('every recipe references real items', () => {
    for (const r of RECIPES) {
      expect(ItemDB.exists(r.out)).toBe(true);
      for (const id of Object.keys(r.in)) expect(ItemDB.exists(id), id).toBe(true);
    }
  });
});

describe('Weapon attachments', () => {
  it('applies only compatible attachments', () => {
    const st = ItemDB.create('wpn_arv7');
    st.data.attach = { mag: 'mag_ext_556', muzzle: 'sup_556', optic: 'opt_8x' };
    const w = effectiveWeapon(st);
    expect(w.magSize).toBe(45);
    expect(w.noise).toBeLessThan(ItemDB.weapon('wpn_arv7').noise);
    expect(w.sight).toBe('iron'); // 8x scope does not fit the AR-V7
    expect(attachmentFits('wpn_arv7', 'opt_8x')).toBe(false);
    expect(attachmentFits('wpn_vbr30', 'opt_8x')).toBe(true);
  });
});
