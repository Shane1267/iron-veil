import { settings } from '../core/SettingsManager.js';
import { bus } from '../core/EventBus.js';
import { RNG } from '../core/MathUtil.js';
import { rollLoot } from '../items/LootSystem.js';
import { h } from '../ui/dom.js';

// Dynamic base raids. Every raidMinDays–raidMaxDays in-game days an eligible player base
// is picked; a warning goes out with a countdown (raidWarningMinutes, in game minutes) and
// a HUD panel shows the attack time, the base location and the raid status. When the
// countdown ends a raiding force is spawned 140–200 m out, on open ground out of the
// player's sight and never inside structures; it approaches, fights defenders and sentries,
// breaches walls and doors (shooting, tools or demolition charges, by setting), looks for
// another entry point when one holds, and retreats after heavy losses.
// If the player is far away when the attack comes (the AI is not simulated out there),
// the raid is resolved by an honest estimate from the defences and reported on return.

export const RAID_TYPES = {
  small: { name: 'Small raid', squads: [['wolf_raider', 'wolf_raider', 'wolf_shooter']], charges: 0, tools: true, weight: 55 },
  military: { name: 'Military raid', squads: [['vsf_rifleman', 'vsf_rifleman', 'vsf_gunner', 'vsf_rifleman', 'vsf_marksman']], charges: 1, tools: true, weight: 28 },
  large: { name: 'Large assault', squads: [['wolf_raider', 'wolf_shooter', 'wolf_raider', 'wolf_raider'], ['wolf_raider', 'wolf_shooter', 'wolf_raider'], ['wolf_shooter', 'wolf_raider', 'wolf_raider']], charges: 2, tools: true, weight: 10, minPieces: 18 },
  special: { name: 'Special raid', squads: [['free_merc', 'free_merc', 'free_merc', 'free_merc'], ['free_merc', 'free_merc', 'free_merc']], charges: 3, tools: true, special: true },
};
const MAX_RAIDERS = 14; // performance cap

export class RaidDirector {
  constructor(game) {
    this.game = game;
    this.rng = new RNG((Math.random() * 1e9) | 0);
    this.nextAt = null; // game minute of the next warning
    this.raid = null; // {type, phase: 'warning'|'active'|'over', attackAt, base:{x,z}, squads, spawned, status, startCount}
    this.history = [];
    this.t = 0;
    this.panel = h('div', { class: 'raid-panel hidden' });
    document.body.appendChild(this.panel);
  }

  get now() { return this.game.clock.gameMinutes; }

  eligible() {
    const b = this.game.base;
    if (!b.pieces.size || b.pieces.size < 6) return false;
    for (const p of b.pieces.values()) if (/wall|door|gate/.test(p.type)) return true;
    return false;
  }

  /** The raid goes for the densest part of what the player has built (not the average of scattered pieces). */
  target() {
    const ps = [...this.game.base.pieces.values()];
    if (!ps.length) return null;
    let best = null, bn = -1;
    for (const p of ps) {
      let n = 0, sx = 0, sz = 0;
      for (const q of ps) if (Math.abs(q.x - p.x) < 30 && Math.abs(q.z - p.z) < 30) { n += q.inventory ? 3 : 1; sx += q.x; sz += q.z; }
      if (n > bn) { bn = n; let c = 0; sx = 0; sz = 0; for (const q of ps) if (Math.abs(q.x - p.x) < 30 && Math.abs(q.z - p.z) < 30) { sx += q.x; sz += q.z; c++; } best = { x: sx / c, z: sz / c }; }
    }
    return best;
  }

  schedule(from = this.now) {
    const lo = settings.get('raidMinDays'), hi = Math.max(lo, settings.get('raidMaxDays'));
    this.nextAt = from + (lo + this.rng.next() * (hi - lo)) * 1440;
  }

  pickType() {
    if (this.rng.next() < settings.get('raidSpecialChance')) return 'special';
    const pieces = this.game.base.pieces.size;
    const opts = Object.entries(RAID_TYPES).filter(([, t]) => t.weight && (!t.minPieces || pieces >= t.minPieces));
    const total = opts.reduce((a, [, t]) => a + t.weight, 0);
    let r = this.rng.next() * total;
    for (const [k, t] of opts) { r -= t.weight; if (r <= 0) return k; }
    return 'small';
  }

  /** Issue a warning now (also used by the debug menu and tests). */
  warn(type = null) {
    if (this.raid && this.raid.phase !== 'over') return false;
    const c = this.target();
    if (!c) return false;
    type = type || this.pickType();
    const mins = settings.get('raidWarningMinutes');
    this.raid = { type, phase: 'warning', attackAt: this.now + mins, base: { x: c.x, z: c.z }, status: 'Hostile forces moving towards your base', squads: [], spawned: 0, startCount: 0, warnedAt: this.now };
    const hrs = mins >= 90 ? `${Math.round(mins / 60 * 2) / 2} hours` : `${Math.round(mins)} minutes`;
    bus.emit('notify', { text: `WARNING: Hostile forces have been detected moving towards your area. An attack on your base is expected in approximately ${hrs}.`, kind: 'warn', key: 'raidwarn' });
    bus.emit('raid:warning', { type, attackAt: this.raid.attackAt });
    bus.emit('sound', { type: 'radio', ui: true });
    this.schedule();
    return true;
  }

  update(dt) {
    this.t -= dt;
    this._panel();
    if (this.t > 0) return;
    this.t = 1;
    if (!settings.get('raidsEnabled')) { if (this.raid?.phase === 'warning') this.raid = null; return; }
    const R = this.raid;
    if (!R || R.phase === 'over') {
      if (R && this.now - R.endedAt > 120) this.raid = null;
      if (!this.eligible()) { this.nextAt = null; return; }
      if (this.nextAt === null) this.schedule();
      if (this.now >= this.nextAt) this.warn();
      return;
    }
    if (R.phase === 'warning' && this.now >= R.attackAt) this._attack();
    else if (R.phase === 'active') this._monitor();
  }

  // ------------------------------------------------------------------ attack
  _attack() {
    const R = this.raid;
    const T = RAID_TYPES[R.type];
    const pp = this.game.player.controller.pos;
    const far = Math.hypot(pp.x - R.base.x, pp.z - R.base.z) > 700;
    if (far) { this._resolveAway(); return; }
    R.phase = 'active';
    R.status = 'Raiders approaching';
    const scale = settings.get('raidSize') * (0.75 + 0.25 * settings.get('raidDifficulty'));
    const breaching = settings.get('raidBreaching');
    let budget = MAX_RAIDERS;
    const baseAng = this.rng.next() * Math.PI * 2;
    T.squads.forEach((list, si) => {
      // each squad comes from its own direction (large assaults surround the base)
      const want = Math.max(2, Math.min(budget, Math.round(list.length * scale)));
      const members = [];
      for (let i = 0; i < want; i++) members.push(list[i % list.length]);
      const spot = this._spawnSpot(R.base, baseAng + (si * Math.PI * 2) / T.squads.length);
      if (!spot || budget <= 0) return;
      const squad = this.game.ai.spawnSquad(members, spot.x, spot.z, { role: 'raider', state: 'raid' });
      budget -= squad.members.length;
      squad.members.forEach((m, i) => {
        m.role = 'raider';
        m.raidTarget = { x: R.base.x, z: R.base.z };
        m.raidSquad = si;
        m.raidRetreat = { x: spot.x, z: spot.z };
        m.breachMode = breaching;
        m.charges = breaching === 'explosives' && i === 0 ? T.charges : 0;
        m.raidTools = breaching !== 'none' && T.tools;
        if (settings.get('raidDifficulty') > 1.2) m.accuracyMul = (m.accuracyMul || 1) * 1.15;
        if (T.special && i === 0) {
          // the leader carries something worth the fight
          const loot = rollLoot('launch_armory', (Math.random() * 1e9) | 0, 6);
          for (const st of loot.slots) if (st) m.inventory.add(st);
        }
        m._enter('raid');
      });
      R.squads.push(squad);
    });
    R.startCount = R.squads.reduce((a, s) => a + s.members.length, 0);
    R.spawned = R.startCount;
    if (!R.startCount) { this._end('The raiders never arrived'); return; }
    bus.emit('notify', { text: `${RAID_TYPES[R.type].name.toUpperCase()}: raiders are attacking your base!`, kind: 'warn', key: 'raidstart' });
    bus.emit('raid:started', { type: R.type, count: R.startCount });
  }

  _spawnSpot(c, ang) {
    const g = this.game;
    const eye = g.renderer.camera.position;
    for (let k = 0; k < 24; k++) {
      const a = ang + (this.rng.next() - 0.5) * 1.2;
      const r = 140 + this.rng.next() * 60;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (g.world.waterAt(x, z) !== null) continue;
      const y = g.world.heightAt(x, z);
      if (g.physics.overlapsCylinder(x, y + 0.3, z, 3, 1.6)) continue; // not inside anything
      let nearPiece = false;
      for (const p of g.base.pieces.values()) if (Math.hypot(p.x - x, p.z - z) < 40) { nearPiece = true; break; }
      if (nearPiece) continue;
      if (k < 16 && g.physics.lineOfSight(eye.x, eye.y, eye.z, x, y + 1.6, z)) continue; // out of sight if possible
      return { x, z };
    }
    return null;
  }

  _monitor() {
    const R = this.raid;
    const alive = R.squads.flatMap((s) => s.members).filter((m) => m.alive);
    const lost = R.startCount - alive.length;
    const breached = alive.some((m) => m.raidBreached);
    R.status = breached ? 'Base breached!' : alive.some((m) => m._breach) ? 'Raiders breaching your defences' : 'Raiders approaching';
    if (!alive.length) { this._end('Raid repelled'); return; }
    // heavy losses: the survivors fall back to where they came from
    if (lost / R.startCount >= 0.6 && !R.retreating) {
      R.retreating = true;
      for (const m of alive) { m.raidTarget = null; m._breach = null; m.travelTarget = m.raidRetreat; m._enter('retreat'); }
      bus.emit('notify', { text: 'The raiders are falling back', kind: 'good', key: 'raidretreat' });
    }
    if (R.retreating) {
      R.status = 'Raiders retreating';
      const pp = this.game.player.controller.pos;
      if (alive.every((m) => Math.hypot(m.pos.x - pp.x, m.pos.z - pp.z) > 220)) { for (const m of alive) this.game.ai.despawn?.(m); this._end('Raid repelled'); }
    }
    // the raid gives up after two in-game hours
    if (this.now - R.attackAt > 120) { for (const m of alive) { m.raidTarget = null; m._enter('return'); } this._end(breached ? 'Raiders left with what they could carry' : 'Raid ended'); }
  }

  _end(status) {
    const R = this.raid;
    R.phase = 'over';
    R.status = status;
    R.endedAt = this.now;
    this.history.push({ type: R.type, at: R.attackAt, result: status });
    bus.emit('notify', { text: `RAID OVER: ${status}`, kind: status.includes('repelled') ? 'good' : 'info', key: 'raidend' });
    bus.emit('raid:ended', { type: R.type, status });
  }

  /** Away from home: estimate the outcome from the defences instead of simulating unseen AI. */
  _resolveAway() {
    const R = this.raid, T = RAID_TYPES[R.type];
    const b = this.game.base;
    const force = T.squads.flat().length * settings.get('raidSize') * settings.get('raidDifficulty');
    let defence = 0;
    for (const p of b.pieces.values()) if (p.sentry && p.sentry.w && (p.sentryLoaded || p.inventory?.count(p.sentry.w.ammo))) defence += 3;
    const walls = [...b.pieces.values()].filter((p) => /wall|gate|door/.test(p.type));
    const breaches = Math.max(0, Math.round((force - defence) / 3));
    let destroyed = 0, stolen = 0;
    for (let i = 0; i < breaches && walls.length; i++) {
      const p = walls.splice(Math.floor(this.rng.next() * walls.length), 1)[0];
      b.damagePiece(p, settings.get('raidBreaching') === 'none' ? p.maxHealth * 0.5 : p.maxHealth + 1);
      if (!p.alive) destroyed++;
    }
    if (breaches > 0) {
      for (const p of b.pieces.values()) {
        if (!p.inventory || stolen >= breaches * 3) continue;
        for (let i = 0; i < p.inventory.slots.length && stolen < breaches * 3; i++) if (p.inventory.slots[i] && this.rng.next() < 0.4) { p.inventory.slots[i] = null; stolen++; }
        p.inventory.version++;
      }
    }
    R.phase = 'active';
    this._end(breaches ? `Your base was raided while you were away: ${destroyed} structure${destroyed === 1 ? '' : 's'} destroyed, ${stolen} item stack${stolen === 1 ? '' : 's'} stolen` : 'Your defences held off a raid while you were away');
  }

  // ------------------------------------------------------------------ HUD
  _panel() {
    const R = this.raid;
    const show = R && (R.phase === 'warning' || R.phase === 'active' || (R.phase === 'over' && this.now - R.endedAt < 20));
    this.panel.classList.toggle('hidden', !show || this.game.ui.mode !== 'playing');
    if (!show) return;
    const key = `${R.phase}|${Math.floor(this.now)}|${R.status}`;
    if (key === this._key) return;
    this._key = key;
    const left = Math.max(0, R.attackAt - this.now);
    const clock = (m) => { const d = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(Math.floor(d % 60)).padStart(2, '0')}`; };
    const realS = left / this.game.clock.scale;
    const grid = `${Math.round(R.base.x)}, ${Math.round(R.base.z)}`;
    this.panel.innerHTML = '';
    this.panel.append(
      h('div', { class: 'rt' }, R.phase === 'warning' ? 'RAID WARNING' : R.phase === 'active' ? 'BASE UNDER ATTACK' : 'RAID OVER'),
      h('div', {}, `${RAID_TYPES[R.type].name} · base at ${grid}`),
      R.phase === 'warning' ? h('div', {}, `Expected ${clock(R.attackAt)} — in ${Math.floor(left / 60)} h ${Math.floor(left % 60)} min (~${Math.ceil(realS / 60)} min real time)`) : '',
      h('div', { class: 'rs' }, R.status),
    );
  }

  serialize() {
    const R = this.raid;
    // an active fight is not saved mid-battle: it is restored as a fresh warning
    const raid = R && R.phase !== 'over' ? { type: R.type, attackAt: R.phase === 'warning' ? R.attackAt : this.now + 30, base: R.base } : null;
    return { nextAt: this.nextAt, raid, history: this.history.slice(-10) };
  }

  deserialize(o) {
    this.raid = null;
    this.nextAt = Number.isFinite(o?.nextAt) ? o.nextAt : null;
    this.history = Array.isArray(o?.history) ? o.history : [];
    if (o?.raid && RAID_TYPES[o.raid.type] && Number.isFinite(o.raid.attackAt)) this.raid = { type: o.raid.type, phase: 'warning', attackAt: o.raid.attackAt, base: o.raid.base, status: 'Hostile forces moving towards your base', squads: [], spawned: 0, startCount: 0 };
  }
}
