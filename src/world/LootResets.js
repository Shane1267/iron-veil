import { MAJOR_POIS } from '../items/LootSystem.js';
import { settings } from '../core/SettingsManager.js';
import { bus } from '../core/EventBus.js';

// Timed loot resets for major locations (data/lootResets.json). A location resets when its
// interval (game hours, from settings) has passed since its last reset. Only containers that
// had been generated (somebody opened them) are re-rolled; the announcement is made only
// when at least one container was actually reset, once per reset (the epoch advances first).
export class LootResets {
  constructor(game) {
    this.game = game;
    this.last = {}; // poi id -> game minute of the last reset
    this.epoch = {}; // poi id -> reset counter (seeds the new loot)
    this.t = 0;
    this.log = [];
  }

  get major() { return MAJOR_POIS; }
  interval(m) { return Math.max(2, settings.get(m.setting) || 24) * 60; }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 5;
    const now = this.game.clock.gameMinutes;
    for (const m of MAJOR_POIS) this.check(m, now);
  }

  check(m, now) {
    if (this.last[m.poi] === undefined) { this.last[m.poi] = now; return false; }
    const interval = Math.max(2, settings.get(m.setting) || 24) * 60;
    if (now - this.last[m.poi] < interval) return false;
    // advance the clock first so a reset can never be announced twice
    this.last[m.poi] = now;
    this.epoch[m.poi] = (this.epoch[m.poi] || 0) + 1;
    const n = this.game.loot.resetPOI(m.poi, this.epoch[m.poi]);
    bus.emit('loot:reset', { poi: m.poi, containers: n });
    if (n > 0) {
      this.log.push({ poi: m.poi, at: now, containers: n });
      if (settings.get('lootResetNotify')) bus.emit('notify', { text: `LOOT RESET: ${m.name} ${m.label} have been replenished.`, kind: 'good', key: `lootreset:${m.poi}`, sticky: 8 });
    }
    return n > 0;
  }

  serialize() { return { last: this.last, epoch: this.epoch }; }

  deserialize(o) {
    this.last = {}; this.epoch = {};
    if (!o || typeof o !== 'object') return;
    for (const m of MAJOR_POIS) {
      if (Number.isFinite(o.last?.[m.poi])) this.last[m.poi] = o.last[m.poi];
      if (Number.isFinite(o.epoch?.[m.poi])) this.epoch[m.poi] = o.epoch[m.poi];
    }
  }
}
