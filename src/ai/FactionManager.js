import factionData from '../data/factions.json';
import { bus } from '../core/EventBus.js';

// Faction attitudes toward each other and the player. Relations change in response to
// the player's actions; neutral factions become hostile when attacked.

export const FACTIONS = factionData.factions;
export const PROFILES = factionData.profiles;

export class FactionManager {
  constructor() {
    this.reset();
  }

  reset() {
    this.rel = {};
    for (const f of FACTIONS) {
      this.rel[f.id] = { ...f.relations };
    }
    this.provoked = {}; // faction -> game time until which they treat the player as hostile
    this.kills = {};
    this.time = 0;
  }

  get(id) {
    return FACTIONS.find((f) => f.id === id);
  }

  profile(id) {
    return PROFILES.find((p) => p.id === id);
  }

  relation(a, b) {
    if (a === b) return 100;
    if (a === 'player') return this.rel[b]?.player ?? 0;
    return this.rel[a]?.[b] ?? 0;
  }

  hostile(a, b) {
    if (a === b) return false;
    const fa = a === 'player' ? b : a;
    const other = a === 'player' ? 'player' : b;
    if (other === 'player' && this.provoked[fa] > this.time) return true;
    if (a !== 'player' && b === 'player' && this.provoked[a] > this.time) return true;
    return this.relation(a, b) <= -30;
  }

  friendly(a, b) {
    return a === b || this.relation(a, b) >= 30;
  }

  /** Player hurt a member of `faction`. */
  onPlayerAttack(faction, killed = false) {
    const r = this.rel[faction];
    if (!r) return;
    const wasHostile = r.player <= -30;
    r.player = Math.max(-100, r.player - (killed ? 25 : 12));
    this.provoked[faction] = this.time + 600; // ten game-minutes of active hostility
    if (killed) {
      this.kills[faction] = (this.kills[faction] || 0) + 1;
      // enemies of the victim warm slightly to the player
      for (const f of FACTIONS) {
        if (f.id !== faction && (this.rel[f.id]?.[faction] ?? 0) <= -50) this.rel[f.id].player = Math.min(60, this.rel[f.id].player + 3);
      }
    }
    if (!wasHostile && r.player <= -30) bus.emit('notify', { text: `${this.get(faction).name} now consider you hostile`, kind: 'warn' });
  }

  update(dt) {
    this.time += dt;
  }

  serialize() {
    return { rel: this.rel, kills: this.kills };
  }

  deserialize(o) {
    this.reset();
    if (!o || typeof o !== 'object') return;
    for (const [f, rels] of Object.entries(o.rel || {})) {
      if (!this.rel[f] || typeof rels !== 'object') continue;
      for (const [k, v] of Object.entries(rels)) if (Number.isFinite(v)) this.rel[f][k] = Math.max(-100, Math.min(100, v));
    }
    this.kills = { ...(o.kills || {}) };
  }
}
