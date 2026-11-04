import { bus } from '../core/EventBus.js';
import { doctrineFor } from './Doctrine.js';

// A squad is a small team that shares what it knows and is given simple orders by a
// "brain" that runs a few times a second:
//  * Contact sharing. Members tell each other where enemies are, by voice (short range,
//    almost instant) or radio (disciplined squads, ~1 s delay). Everything runs in game
//    time so pausing or slow frames never desynchronise it.
//  * Fire and movement. While an enemy is pinned behind cover one member suppresses it and
//    another flanks; a member who announces a reload is covered by the others.
//  * Morale. Casualties and a lopsided fight make the squad fall back to a rally point
//    (disciplined), scatter (aggressive) or flee (cautious).
//  * Search. When contact is lost the squad splits the area around the last known position
//    into search points instead of everyone running to the same spot.

const VOICE_RANGE = 45;
const RADIO_RANGE = 400;

export class Squad {
  constructor(id, faction, mgr = null) {
    this.id = id;
    this.faction = faction;
    this.mgr = mgr;
    this.members = [];
    this.initial = 0;
    this.doctrine = doctrineFor(faction);
    this.contacts = new Map(); // enemy character -> {x, y, z, vx, vz, t, seen}
    this.inbox = [];
    this.phase = 'calm'; // calm | alert | engaged | search | fallback
    this.phaseT = 0;
    this.thinkT = 0;
    this.time = 0;
    this.suppressor = null;
    this.flankers = new Set();
    this.coverFireUntil = 0;
    this.rally = null;
    this.searchPlan = null;
    this.investigation = null;
    this.radio = faction === 'vsf' || faction === 'free' || faction === 'guard';
    this.lastBreak = -999;
  }

  add(a) {
    this.members.push(a);
    a.squad = this;
    this.initial = Math.max(this.initial, this.members.length);
    if (this.members.length === 1) this.doctrine = a.doctrine || this.doctrine;
  }

  alive() { return this.members.filter((m) => m.alive && !m.removed); }
  aliveCount() { return this.alive().length; }
  strength() { return this.initial ? this.aliveCount() / this.initial : 0; }
  leader() { return this.alive()[0] || null; }

  // ------------------------------------------------------------ communication
  /** Schedule a delivery in game time. */
  _send(delay, fn) { this.inbox.push({ at: this.time + delay, fn }); }

  /**
   * A member reports an enemy. accuracy 1 = seen, lower = heard/estimated.
   * Teammates in voice range learn almost at once; others only by radio.
   */
  report(from, enemy, pos, accuracy = 1, vel = null) {
    if (!enemy || !enemy.alive) return;
    const c = this.contacts.get(enemy) || { x: pos.x, y: pos.y, z: pos.z, vx: 0, vz: 0, t: -999, seen: -999, conf: 0 };
    if (accuracy >= c.conf || this.time - c.t > 2) {
      c.x = pos.x; c.y = pos.y ?? c.y; c.z = pos.z;
      if (vel) { c.vx = vel.x; c.vz = vel.z; }
      c.conf = accuracy;
    }
    c.t = this.time;
    if (accuracy >= 1) c.seen = this.time;
    this.contacts.set(enemy, c);
    if (this.phase === 'calm' || this.phase === 'alert' || this.phase === 'search') this._setPhase('engaged');
    // don't flood: one relay per contact per 0.6 s unless the estimate is much better
    if (c._relayed && this.time - c._relayed < 0.6 && accuracy < 1) return;
    c._relayed = this.time;
    for (const m of this.members) {
      if (m === from || !m.alive) continue;
      const d = Math.hypot(m.pos.x - from.pos.x, m.pos.z - from.pos.z);
      let delay;
      if (d < VOICE_RANGE) delay = 0.25 + Math.random() * 0.35;
      else if (this.radio && d < RADIO_RANGE) delay = 0.7 + Math.random() * 0.6;
      else continue;
      const p = { x: pos.x, y: pos.y, z: pos.z };
      this._send(delay, () => { if (m.alive) m.receiveContact(enemy, p, accuracy * 0.85, from); });
    }
    // the radio squelch is audible to the player, but not on every update
    if (this.radio && from.pos && this.time - (this._lastRadio ?? -99) > 4) {
      this._lastRadio = this.time;
      bus.emit('sound', { type: 'radio', x: from.pos.x, y: from.pos.y + 1.5, z: from.pos.z });
    }
  }

  /** A member hears or sees something worth checking that is not (yet) a contact. */
  alert(from, point, reason) {
    if (this.phase === 'engaged' || this.phase === 'fallback') return;
    if (this.investigation && Math.hypot(this.investigation.point.x - point.x, this.investigation.point.z - point.z) < 12 && this.time - this.investigation.t < 30) return;
    this.investigation = { point: { x: point.x, z: point.z }, reason, t: this.time, mover: 0, legT: 0 };
    this._setPhase('alert');
    for (const m of this.members) {
      if (m === from || !m.alive) continue;
      const d = Math.hypot(m.pos.x - from.pos.x, m.pos.z - from.pos.z);
      if (d > VOICE_RANGE && !(this.radio && d < RADIO_RANGE)) continue;
      this._send(d < VOICE_RANGE ? 0.4 : 1.0, () => { if (m.alive) m.onSquadAlert(point, reason); });
    }
  }

  onReload(member) {
    // teammates who can see the enemy push their peeks to cover the reload
    this.coverFireUntil = this.time + Math.max(2, member.reloading || 2);
    bus.emit('ai:tactic', { type: 'cover-reload', agent: member });
  }

  onMemberDied(dead, killer) {
    this.suppressor = this.suppressor === dead ? null : this.suppressor;
    this.flankers.delete(dead);
    for (const m of this.members) {
      if (!m.alive || m === dead) continue;
      const d = Math.hypot(m.pos.x - dead.pos.x, m.pos.z - dead.pos.z);
      if (d > (this.radio ? RADIO_RANGE : VOICE_RANGE * 2)) continue;
      this._send(d < VOICE_RANGE ? 0.3 : 1.0, () => {
        if (!m.alive) return;
        m.morale = Math.max(0, (m.morale ?? 1) - 0.22);
        if (killer && killer.alive) m.receiveContact(killer, { x: dead.pos.x, y: dead.pos.y, z: dead.pos.z }, 0.35, dead);
        else m.onSquadAlert({ x: dead.pos.x, z: dead.pos.z }, 'casualty');
      });
    }
  }

  // ------------------------------------------------------------ brain
  _setPhase(p) {
    if (this.phase === p) return;
    this.phase = p;
    this.phaseT = 0;
    if (p !== 'engaged') { this.suppressor = null; this.flankers.clear(); }
    if (p !== 'search') this.searchPlan = null;
  }

  update(dt) {
    this.time += dt;
    this.phaseT += dt;
    if (this.inbox.length) {
      const due = this.inbox.filter((m) => m.at <= this.time);
      if (due.length) {
        this.inbox = this.inbox.filter((m) => m.at > this.time);
        for (const m of due) m.fn();
      }
    }
    this.thinkT -= dt;
    if (this.thinkT > 0) return;
    this.thinkT = 0.5;
    const alive = this.alive();
    if (!alive.length) return;
    // forget dead or stale contacts
    for (const [e, c] of this.contacts) if (!e.alive || this.time - c.t > 120) this.contacts.delete(e);

    const fighting = alive.filter((m) => m.state === 'combat');
    if (this.phase === 'engaged') {
      if (!fighting.length && !alive.some((m) => m.state === 'retreat')) {
        // nobody is fighting any more: either searching or done
        this._setPhase(alive.some((m) => m.state === 'search') ? 'search' : 'calm');
      } else {
        this._morale(alive);
        if (this.phase === 'engaged') this._fireAndMovement(fighting);
      }
    } else if (this.phase === 'fallback') {
      const settled = alive.every((m) => m.state !== 'retreat');
      if (settled && this.phaseT > 6) this._setPhase(alive.some((m) => m.state === 'combat') ? 'engaged' : 'calm');
    } else if (this.phase === 'alert') {
      if (this.phaseT > 60 || alive.every((m) => m.state !== 'investigate')) this._setPhase('calm');
      if (this.investigation) this._bounding(alive);
    } else if (this.phase === 'search') {
      if (alive.every((m) => m.state !== 'search')) this._setPhase('calm');
      else this._bounding(alive, 'search');
    }
  }

  /** The freshest contact: where the squad thinks the enemy is. */
  primaryContact() {
    let best = null, bc = null;
    for (const [e, c] of this.contacts) {
      if (!e.alive) continue;
      if (!bc || c.t > bc.t) { best = e; bc = c; }
    }
    return best ? { enemy: best, ...bc } : null;
  }

  threatCentroid() {
    let x = 0, z = 0, n = 0;
    for (const [e, c] of this.contacts) if (e.alive && this.time - c.t < 30) { x += c.x; z += c.z; n++; }
    return n ? { x: x / n, z: z / n } : null;
  }

  _morale(alive) {
    const D = this.doctrine;
    const strength = this.strength();
    const avgMorale = alive.reduce((s, m) => s + (m.morale ?? 1), 0) / alive.length;
    let known = 0;
    for (const [e, c] of this.contacts) if (e.alive && this.time - c.t < 20) known++;
    const outnumbered = known >= alive.length * 2;
    const broken = strength < D.breakStrength || (outnumbered && avgMorale < 0.6) || avgMorale < 0.25;
    if (!broken || this.time - this.lastBreak < 25) return;
    this.lastBreak = this.time;
    const threat = this.threatCentroid();
    if (!threat) return;
    this._setPhase('fallback');
    const ld = this.leader();
    // rally point: away from the threat, toward home when the squad has one
    const home = ld.home;
    let rx = ld.pos.x - threat.x, rz = ld.pos.z - threat.z;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    let rally = { x: ld.pos.x + rx * 45, z: ld.pos.z + rz * 45 };
    if (home && ld.role !== 'patrol') {
      const hx = home.x - threat.x, hz = home.z - threat.z;
      if (Math.hypot(hx, hz) > 25) rally = { x: home.x + (hx / Math.hypot(hx, hz)) * Math.min(20, home.radius * 0.4), z: home.z + (hz / Math.hypot(hx, hz)) * Math.min(20, home.radius * 0.4) };
    }
    this.rally = rally;
    bus.emit('ai:tactic', { type: 'squad-break', agent: ld, doctrine: D.id });
    for (const m of alive) {
      // aggressive gangs scatter: each picks its own way out
      const r = D.id === 'aggressive' ? null : rally;
      m.orderRetreat(r, threat);
    }
  }

  _fireAndMovement(fighting) {
    const D = this.doctrine;
    const pc = this.primaryContact();
    if (!pc) return;
    const sinceSeen = this.time - pc.seen;
    // the enemy is "pinned" when it has been hidden behind something for a while but recently seen
    const pinned = sinceSeen > 1.5 && sinceSeen < 12;
    if (this.suppressor && (!this.suppressor.alive || this.suppressor.state !== 'combat' || !this.suppressor.canSuppress())) this.suppressor = null;
    for (const f of [...this.flankers]) if (!f.alive || f.state !== 'combat' || f.tactic !== 'flank') this.flankers.delete(f);

    const wantSuppressor = (pinned || this.flankers.size > 0) && fighting.length >= 1;
    if (wantSuppressor && !this.suppressor && Math.random() < D.suppress) {
      // prefer machine gunners, then whoever has the most ammunition and is in cover
      const cands = fighting.filter((m) => m.canSuppress() && !this.flankers.has(m));
      cands.sort((a, b) => b.suppressScore() - a.suppressScore());
      if (cands[0]) {
        this.suppressor = cands[0];
        cands[0].orderSuppress(pc.enemy, { x: pc.x, y: pc.y, z: pc.z }, 6 + Math.random() * 4);
      }
    }
    // flank while the enemy is pinned (and covered by the suppressor unless doctrine allows solo)
    const maxFlankers = D.id === 'aggressive' ? 2 : 1;
    const covered = !!this.suppressor || D.flankSolo;
    if (pinned && covered && this.flankers.size < maxFlankers && fighting.length >= (D.flankSolo ? 1 : 2) && Math.random() < D.flank * 0.6) {
      const cands = fighting.filter((m) => m !== this.suppressor && !this.flankers.has(m) && m.canFlank());
      cands.sort((a, b) => b.skill.flank - a.skill.flank);
      const f = cands[0];
      if (f && f.orderFlank(pc.enemy, { x: pc.x, y: pc.y, z: pc.z }, this.flankers.size ? -this._flankSide : null)) {
        this._flankSide = f.flankSide;
        this.flankers.add(f);
      }
    }
  }

  /** Fireteam investigation: one member moves while the others watch, then they swap. */
  _bounding(alive, state = 'investigate') {
    const inv = state === 'search' ? (this._searchBound || (this._searchBound = { mover: 0, legT: 0 })) : this.investigation;
    const movers = alive.filter((m) => m.state === state);
    if (this.doctrine.investigate !== 'bound' || movers.length < 2) { for (const m of movers) m.overwatch = false; return; }
    inv.legT -= 0.5;
    if (inv.legT <= 0) {
      inv.mover = (inv.mover + 1) % movers.length;
      inv.legT = 5 + Math.random() * 3;
    }
    movers.forEach((m, i) => { m.overwatch = i !== inv.mover; });
  }

  /** Split the area around the last known position into search points for the members. */
  planSearch(lkp, vel = null) {
    if (this.searchPlan && this.time - this.searchPlan.t < 20 && Math.hypot(this.searchPlan.lkp.x - lkp.x, this.searchPlan.lkp.z - lkp.z) < 15) return this.searchPlan;
    const pts = [{ x: lkp.x, z: lkp.z, look: 4 }];
    if (vel && Math.hypot(vel.x, vel.z) > 0.5) {
      const s = Math.hypot(vel.x, vel.z);
      pts.push({ x: lkp.x + (vel.x / s) * 14, z: lkp.z + (vel.z / s) * 14, look: 4 });
    }
    // nearby hiding places: corners of structures and big cover around the LKP
    const mgr = this.mgr;
    if (mgr) for (const p of mgr.hidingSpots(lkp, 22, 6)) pts.push({ ...p, look: 3 });
    for (let i = 0; pts.length < 6 && i < 6; i++) {
      const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 14;
      pts.push({ x: lkp.x + Math.cos(a) * r, z: lkp.z + Math.sin(a) * r, look: 3 });
    }
    this.searchPlan = { lkp: { x: lkp.x, z: lkp.z }, points: pts, taken: new Map(), t: this.time };
    this._setPhase('search');
    return this.searchPlan;
  }

  /** Next unclaimed search point for a member (nearest first). */
  claimSearchPoint(m) {
    const plan = this.searchPlan;
    if (!plan) return null;
    let best = null, bd = Infinity;
    plan.points.forEach((p, i) => {
      if (plan.taken.has(i) || p.done) return;
      const d = Math.hypot(p.x - m.pos.x, p.z - m.pos.z);
      if (d < bd) { bd = d; best = i; }
    });
    if (best === null) return null;
    plan.taken.set(best, m);
    const p = plan.points[best];
    p.claimedBy = m;
    return p;
  }

  releaseSearchPoint(p) {
    if (!this.searchPlan || !p) return;
    p.done = true;
  }
}
