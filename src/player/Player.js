import * as THREE from 'three';
import { PlayerController } from './PlayerController.js';
import { PlayerSurvival } from './PlayerSurvival.js';
import { Equipment } from '../items/Equipment.js';
import { ItemDB } from '../items/ItemDatabase.js';
import { bus } from '../core/EventBus.js';

// The player: controller + survival + equipment + practical skills, and the
// "character" record other systems (AI perception, ballistics) interact with.

export const SKILLS = {
  weapon_handling: { name: 'Weapon Handling', desc: 'Faster reloads, less recoil' },
  marksmanship: { name: 'Marksmanship', desc: 'Tighter spread' },
  scavenging: { name: 'Scavenging', desc: 'Faster searching' },
  medical: { name: 'Medical Treatment', desc: 'Faster treatment' },
  construction: { name: 'Construction', desc: 'Experience building structures' },
  crafting: { name: 'Crafting', desc: 'Faster crafting' },
  survival: { name: 'Survival', desc: 'Slower hunger and thirst' },
  vehicles: { name: 'Vehicle Operation', desc: 'Experience with vehicles' },
};

export class Skills {
  constructor() {
    this.xp = Object.fromEntries(Object.keys(SKILLS).map((k) => [k, 0]));
  }
  level(k) {
    return Math.min(10, Math.floor(Math.sqrt((this.xp[k] || 0) / 12)));
  }
  gain(k, amount) {
    if (!(k in this.xp)) return;
    const before = this.level(k);
    this.xp[k] += amount;
    const after = this.level(k);
    if (after > before) bus.emit('notify', { text: `${SKILLS[k].name} improved to ${after}`, kind: 'good' });
  }
  /** Small, grounded multipliers (max ~20% at level 10). */
  mul(k, what) {
    const l = this.level(k);
    switch (what) {
      case 'reload': case 'recoil': case 'spread': return 1 - l * 0.02;
      case 'time': return 1 - l * 0.03;
      case 'drain': return 1 - l * 0.02;
      default: return 1;
    }
  }
  serialize() { return { ...this.xp }; }
  deserialize(o) {
    for (const k of Object.keys(this.xp)) this.xp[k] = Number.isFinite(o?.[k]) ? Math.max(0, o[k]) : 0;
  }
}

export class Player {
  constructor(game) {
    this.game = game;
    this.controller = new PlayerController(game.renderer.camera, game.physics, game.world, game.input);
    this.survival = new PlayerSurvival();
    this.equipment = new Equipment();
    this.skills = new Skills();
    this.kills = 0;
    this.stats = { kills: 0, distance: 0, looted: 0, timeAlive: 0 };
    const self = this;
    this.character = {
      faction: 'player', isPlayer: true, colliderOwner: 'player',
      get pos() { return self.controller.pos; },
      get yaw() { return self.controller.yaw; },
      get stance() { return self.controller.stance; },
      get vel() { return self.controller.vel; },
      get alive() { return !self.survival.dead; },
      get lightOn() { return self.game.weapons?.lightActive || false; },
      get firedRecently() { return self.game.time - (this.lastShot || -99) < 1.5; },
      lastShot: -99,
      onHit(info) { self.onHit(info); },
      onSuppressed(info) { self.onSuppressed(info); },
    };
    this.suppression = 0;
    this.damageDirs = [];
  }

  onHit(info) {
    const dmg = this.survival.hit(info, this.equipment);
    if (info.dir) this.damageDirs.push({ x: -info.dir.x, z: -info.dir.z, t: 1.2 });
    this.controller.shake += Math.min(4, dmg / 8);
    if (info.zone === 'leg' && dmg > 10) bus.emit('notify', { text: 'Leg wound — limping', kind: 'warn', key: 'leg' });
  }

  onSuppressed(info) {
    this.suppression = Math.min(1, this.suppression + 0.35);
    this.controller.shake += 0.6;
    bus.emit('audio:whiz', info);
  }

  /** Use a consumable from the inventory slot (timed). */
  useItem(slotIndex) {
    const inv = this.equipment.inventory;
    const s = inv.slots[slotIndex];
    if (!s) return;
    const def = ItemDB.get(s.id);
    if (!def.use) {
      bus.emit('notify', { text: `${def.name} can't be used directly`, kind: 'info' });
      return;
    }
    if (def.use.refuel || def.use.revealRegion || def.use.read || def.use.placeCharge || def.use.detonate) {
      this.game.useSpecialItem(s.id, slotIndex);
      return;
    }
    const itemId = s.id;
    const medical = def.cat === 'medical';
    const timeMul = medical ? this.skills.mul('medical', 'time') : 1;
    const res = this.survival.beginUse(itemId, () => {
      // consume on completion (re-check the item still exists)
      if (inv.remove(itemId, 1) !== 1) { bus.emit('notify', { text: 'Item missing', kind: 'warn' }); return; }
      const msgs = this.survival.applyItem(def);
      if (def.use.leaves) { const left = inv.add({ id: def.use.leaves, qty: 1 }); if (left) this.game.dropItem({ id: def.use.leaves, qty: 1 }); }
      bus.emit('notify', { text: [`Used ${def.name}`, ...msgs].join(' · '), kind: 'good' });
      if (medical) this.skills.gain('medical', 1);
      this.skills.gain('survival', 0.3);
    });
    if (res.ok) {
      this.survival.useAction.time *= timeMul;
      this.survival.useAction.label = def.name;
      bus.emit('sound', { type: 'pickup', ui: true });
    } else bus.emit('notify', { text: res.msg, kind: 'info' });
  }

  quickUse(i) {
    const id = this.equipment.quick[i];
    if (!id) return;
    const idx = this.equipment.inventory.find((s) => s.id === id);
    if (idx < 0) { bus.emit('notify', { text: `No ${ItemDB.get(id).name} left`, kind: 'info' }); return; }
    this.useItem(idx);
  }

  update(dt) {
    this.suppression = Math.max(0, this.suppression - dt * 0.5);
    for (const d of this.damageDirs) d.t -= dt;
    this.damageDirs = this.damageDirs.filter((d) => d.t > 0);
    this.stats.timeAlive += dt;
  }

  serialize() {
    const c = this.controller;
    return {
      pos: { x: c.pos.x, y: c.pos.y, z: c.pos.z }, yaw: c.yaw, pitch: c.pitch, stance: c.stance,
      survival: this.survival.serialize(), equipment: this.equipment.serialize(), skills: this.skills.serialize(), stats: this.stats,
      weaponSlot: this.game.weapons?.slot || null,
    };
  }

  deserialize(o) {
    const c = this.controller;
    const p = o?.pos;
    if (p && [p.x, p.y, p.z].every(Number.isFinite)) c.teleport(p.x, p.y, p.z, Number.isFinite(o.yaw) ? o.yaw : 0);
    if (Number.isFinite(o?.pitch)) c.pitch = o.pitch;
    c.stance = ['stand', 'crouch', 'prone'].includes(o?.stance) ? o.stance : 'stand';
    this.survival.deserialize(o?.survival);
    this.equipment = Equipment.deserialize(o?.equipment);
    this.skills.deserialize(o?.skills);
    if (o?.stats) this.stats = { ...this.stats, ...o.stats };
  }
}

void THREE;
