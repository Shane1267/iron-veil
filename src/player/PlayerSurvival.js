import { clamp } from '../core/MathUtil.js';
import { settings } from '../core/SettingsManager.js';
import { bus } from '../core/EventBus.js';
import { ItemDB } from '../items/ItemDatabase.js';
import { computeDamage, bleedChance } from '../combat/DamageSystem.js';

// Health, hunger, hydration, stamina, bleeding, pain, body temperature and wetness.
// Rates are tuned so food/water matter over an hour of play, not every few minutes.

export class PlayerSurvival {
  constructor() {
    this.reset();
  }

  reset() {
    this.health = 100;
    this.hunger = 85;
    this.thirst = 85;
    this.stamina = 100;
    this.bleeding = 0; // number of open wounds
    this.pain = 0; // 0..1
    this.painkiller = 0; // seconds remaining
    this.temperature = 0; // -1 freezing .. +1 warm (0 neutral)
    this.wet = 0;
    this.staminaDelay = 0;
    this.lastDamage = 0;
    this.damageFlash = 0;
    this.dead = false;
    this.useAction = null; // {item, t, time}
    this.holdBreath = false;
    this.exhausted = false;
  }

  get canSprint() {
    return this.stamina > 3 && !this.exhausted && this.health > 5;
  }

  /**
   * env: {sprinting, moving, jumped, swimming, raining, sheltered, night, warmthNearby, insulation, rainProtection, encumbrance, holdBreath}
   */
  update(dt, env) {
    if (this.dead) return;
    const rate = settings.get('survivalRate');
    // hunger 100->0 in ~75 min, thirst in ~55 min (rate 1)
    const exert = env.sprinting ? 2.2 : env.moving ? 1.15 : 1;
    this.hunger = clamp(this.hunger - dt * 0.022 * rate * exert, 0, 100);
    this.thirst = clamp(this.thirst - dt * 0.030 * rate * exert * (this.temperature > 0.5 ? 1.3 : 1), 0, 100);

    // stamina
    const enc = env.encumbrance || 0;
    if (env.sprinting) {
      this.stamina -= dt * (11 + Math.max(0, enc - 0.6) * 12);
      this.staminaDelay = 1.0;
    } else if (env.holdBreath) {
      this.stamina -= dt * 16;
      this.staminaDelay = 0.8;
    } else if (env.swimming) {
      this.stamina -= dt * 4;
      this.staminaDelay = 0.5;
    } else {
      this.staminaDelay -= dt;
      if (this.staminaDelay <= 0) {
        const regen = 16 * (this.hunger > 15 ? 1 : 0.5) * (this.thirst > 15 ? 1 : 0.5);
        this.stamina += dt * regen;
      }
    }
    if (env.jumped) { this.stamina -= 9; this.staminaDelay = 0.8; }
    this.stamina = clamp(this.stamina, 0, 100);
    if (this.stamina <= 0.5) this.exhausted = true;
    if (this.exhausted && this.stamina > 30) this.exhausted = false;

    // bleeding
    if (this.bleeding > 0) {
      this.damage(dt * 0.55 * Math.min(3, this.bleeding), { silent: true, cause: 'bleeding' });
      this._bleedFx = (this._bleedFx || 0) - dt;
      if (this._bleedFx <= 0) { this._bleedFx = 2.5; bus.emit('player:bleedTick'); }
    }

    // pain fades slowly unless suppressed
    if (this.painkiller > 0) this.painkiller -= dt;
    this.pain = clamp(this.pain - dt / 90, 0, 1);

    // starvation / dehydration
    if (this.hunger <= 0) this.damage(dt * 0.12, { silent: true, cause: 'starvation' });
    if (this.thirst <= 0) this.damage(dt * 0.18, { silent: true, cause: 'dehydration' });

    // temperature & wetness
    const rainWet = env.raining && !env.sheltered ? (1 - (env.rainProtection || 0)) : 0;
    if (env.swimming) this.wet = 1;
    else if (rainWet > 0) this.wet = clamp(this.wet + dt * 0.01 * rainWet, 0, 1);
    else this.wet = clamp(this.wet - dt * (env.warmthNearby ? 0.02 : 0.004), 0, 1);
    let target = 0.15 + (env.insulation || 0) * 1.2 - (env.night ? 0.55 : 0) - this.wet * 0.8 - (env.raining ? 0.15 : 0) + (env.sheltered ? 0.15 : 0);
    if (env.warmthNearby) target += 0.9;
    if (env.sprinting) target += 0.2;
    target = clamp(target, -1, 1);
    this.temperature += (target - this.temperature) * Math.min(1, dt / 60);
    if (this.temperature < -0.6) this.damage(dt * 0.05, { silent: true, cause: 'hypothermia' });

    // slow natural recovery when well fed, hydrated, warm and not bleeding
    if (this.bleeding === 0 && this.hunger > 50 && this.thirst > 50 && this.temperature > -0.4 && performance.now() - this.lastDamage > 15000) {
      this.health = clamp(this.health + dt * 0.04, 0, 100);
    }

    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.8);

    // timed item use
    if (this.useAction) {
      this.useAction.t += dt;
      if (this.useAction.t >= this.useAction.time) {
        const a = this.useAction;
        this.useAction = null;
        a.complete();
      }
    }
  }

  get painEffective() {
    return this.painkiller > 0 ? 0 : this.pain;
  }

  /** Apply a hit. info: {zone, base, weapon, distance, armor, penetrationLoss, cause, dir} */
  hit(info, equipment) {
    if (this.dead) return 0;
    const armor = equipment ? equipment.armorFor(info.zone === 'head' ? 'head' : 'torso') * (info.zone === 'head' || info.zone === 'torso' ? 1 : 0) : 0;
    const dmg = computeDamage({ ...info, armor });
    if (Math.random() < bleedChance(info.zone, dmg, armor)) {
      this.bleeding = Math.min(3, this.bleeding + 1);
      bus.emit('notify', { text: 'You are bleeding', kind: 'warn' });
    }
    if (info.zone === 'leg' || info.zone === 'arm') this.pain = clamp(this.pain + dmg / 40, 0, 1);
    this.damage(dmg, { cause: info.cause || 'gunshot', dir: info.dir });
    return dmg;
  }

  damage(amount, opts = {}) {
    if (this.dead || amount <= 0 || this.invulnerable) return;
    this.health -= amount;
    if (!opts.silent) {
      this.lastDamage = performance.now();
      this.damageFlash = clamp(this.damageFlash + amount / 30, 0, 1);
      bus.emit('player:damaged', { amount, dir: opts.dir, cause: opts.cause });
    }
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      bus.emit('player:died', { cause: opts.cause || 'unknown' });
    }
  }

  /** Begin a timed consumable use. Returns {ok,msg}. complete() is called on success. */
  beginUse(itemId, complete) {
    if (this.useAction) return { ok: false, msg: 'Busy' };
    const def = ItemDB.get(itemId);
    if (!def?.use) return { ok: false, msg: 'Cannot use that' };
    this.useAction = { itemId, t: 0, time: def.use.time || 2, complete };
    return { ok: true };
  }

  cancelUse() {
    this.useAction = null;
  }

  /** Apply an item's effect (called on completion). */
  applyItem(def) {
    const u = def.use;
    const msgs = [];
    if (u.hunger) this.hunger = clamp(this.hunger + u.hunger, 0, 100);
    if (u.thirst) this.thirst = clamp(this.thirst + u.thirst, 0, 100);
    if (u.health) this.health = clamp(this.health + u.health, 0, 100);
    if (u.stamina) this.stamina = clamp(this.stamina + u.stamina, 0, 100);
    if (u.stopBleed && this.bleeding) { this.bleeding = 0; msgs.push('Bleeding stopped'); }
    if (u.painkiller) { this.painkiller = u.painkiller; msgs.push('Pain suppressed'); }
    if (u.pain === -1) this.pain = 0;
    return msgs;
  }

  serialize() {
    return { health: this.health, hunger: this.hunger, thirst: this.thirst, stamina: this.stamina, bleeding: this.bleeding, pain: this.pain, painkiller: this.painkiller, temperature: this.temperature, wet: this.wet };
  }

  deserialize(o) {
    this.reset();
    if (!o) return;
    const num = (v, d, a, b) => (Number.isFinite(v) ? clamp(v, a, b) : d);
    this.health = num(o.health, 100, 1, 100);
    this.hunger = num(o.hunger, 80, 0, 100);
    this.thirst = num(o.thirst, 80, 0, 100);
    this.stamina = num(o.stamina, 100, 0, 100);
    this.bleeding = num(o.bleeding, 0, 0, 3) | 0;
    this.pain = num(o.pain, 0, 0, 1);
    this.painkiller = num(o.painkiller, 0, 0, 600);
    this.temperature = num(o.temperature, 0, -1, 1);
    this.wet = num(o.wet, 0, 0, 1);
  }
}
