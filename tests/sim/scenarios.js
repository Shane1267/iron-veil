// Firefight scenarios for the headless simulator. Each returns { sim, extra() } after running.
import { Sim } from './Sim.js';

const hyp = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export const SCENARIOS = {
  /** Two squads meet in open, wooded farmland. Disciplined soldiers vs aggressive raiders. */
  'skirmish-field'(seed) {
    const c = { x: 1100, z: 220 };
    const sim = new Sim({ seed, area: { x: c.x, z: c.z, r: 110 }, observer: c });
    const vsf = sim.squad(['vsf_rifleman', 'vsf_rifleman', 'vsf_gunner', 'vsf_rifleman'], c.x - 45, c.z, { role: 'rifleman' });
    const wolves = sim.squad(['wolf_raider', 'wolf_shooter', 'wolf_raider', 'wolf_raider'], c.x + 45, c.z + 10, { role: 'rusher' });
    // they spot each other's lead element
    for (const m of vsf.members) m._reveal(wolves.members[0], 0.6);
    for (const m of wolves.members) m._reveal(vsf.members[0], 0.6);
    sim.run(150, 1 / 30, (s) => !s.agents((a) => a.alive && a.faction === 'vsf').length || !s.agents((a) => a.alive && a.faction === 'wolves').length);
    return { sim, extra: () => ({ vsfAlive: vsf.members.filter((m) => m.alive).length, wolvesAlive: wolves.members.filter((m) => m.alive).length }) };
  },

  /** Fight through Millbrook's houses: cover, doors, collisions and navigation around buildings. */
  'skirmish-village'(seed) {
    const c = { x: 320, z: 1080 };
    const sim = new Sim({ seed, pois: ['millbrook'], area: { x: c.x, z: c.z, r: 130 }, observer: c });
    const vsf = sim.squad(['vsf_rifleman', 'vsf_rifleman', 'vsf_rifleman'], c.x - 10, c.z + 95, { role: 'rifleman' });
    const wolves = sim.squad(['wolf_raider', 'wolf_shooter', 'wolf_raider'], c.x + 5, c.z - 70, { role: 'rusher' });
    // they start unaware; the raiders' gunshots should draw the soldiers in
    sim.run(4);
    sim.gunshot(wolves.members[0].pos.x, wolves.members[0].pos.z, 'wpn_fieldline', wolves.members[0]);
    sim.run(170, 1 / 30, (s) => !s.agents((a) => a.alive && a.faction === 'vsf').length || !s.agents((a) => a.alive && a.faction === 'wolves').length);
    return { sim, extra: () => ({ vsfAlive: vsf.members.filter((m) => m.alive).length, wolvesAlive: wolves.members.filter((m) => m.alive).length }) };
  },

  /** A scripted player attacks the checkpoint garrison from range; the guards must defend, not wander off. */
  'garrison-defense'(seed) {
    const poi = { x: 905, z: -1110 };
    const sim = new Sim({ seed, pois: ['checkpoint'], area: { x: poi.x, z: poi.z, r: 160 }, observer: { x: poi.x + 140, z: poi.z } });
    sim.run(3); // the garrison spawns relative to the observer
    const guards = sim.agents((a) => a.garrisonOf === 'checkpoint');
    // a firing position 60-95 m out that can see at least one guard
    const fire = sim.findSpot(poi, 60, 95, (p) => guards.some((g) => sim.sees(p, g.pos, 1.1, 1.4))) || { x: poi.x + 80, z: poi.z };
    const dx = fire.x - poi.x, dz = fire.z - poi.z, dl = Math.hypot(dx, dz);
    const start = { x: fire.x + (dx / dl) * 40, z: fire.z + (dz / dl) * 40 };
    const bot = sim.bot({ x: start.x, z: start.z, weapon: 'wpn_vbr30', accuracyDeg: 1.0, health: 400, stance: 'crouch', range: 170 });
    bot.waypoints = [{ x: fire.x, z: fire.z, speed: 2.5 }];
    sim.run(120, 1 / 30, (s) => !s.agents((a) => a.alive).length || !bot.alive);
    return {
      sim,
      extra: () => ({
        guards: guards.length,
        guardsAlive: guards.filter((a) => a.alive).length,
        maxLeash: Math.round(Math.max(0, ...guards.map((a) => hyp(a.pos, poi)))),
        botShots: bot.shotsFired,
        botHealth: Math.round(bot.health),
        botHitsTaken: bot.hits,
      }),
    };
  },

  /** Out-of-sight gunfire 170 m away: raiders go and look; cautious survivors move away from it. */
  'distant-gunfire'(seed) {
    const c = { x: 1100, z: 220 };
    const shotAt = { x: c.x + 170, z: c.z - 30 };
    const out = {};
    let sim = null;
    for (const [key, profiles] of [['wolves', ['wolf_raider', 'wolf_shooter', 'wolf_raider']], ['survivors', ['indep_scav', 'indep_scav']], ['soldiers', ['vsf_rifleman', 'vsf_rifleman', 'vsf_rifleman']]]) {
      if (sim) sim.dispose();
      sim = new Sim({ seed, area: { x: c.x + 80, z: c.z, r: 150 }, observer: c });
      const sq = sim.squad(profiles, c.x, c.z, { role: key === 'wolves' ? 'rusher' : key === 'survivors' ? 'scavenger' : 'rifleman' });
      sim.run(2);
      const d0 = Math.min(...sq.members.map((m) => hyp(m.pos, shotAt)));
      for (let i = 0; i < 6; i++) { sim.gunshot(shotAt.x, shotAt.z, 'wpn_arv7'); sim.run(0.15); }
      sim.run(5);
      for (let i = 0; i < 4; i++) { sim.gunshot(shotAt.x, shotAt.z, 'wpn_arv7'); sim.run(0.15); }
      let dMin = Infinity, maxSpread = 0;
      for (let k = 0; k < 80; k++) {
        sim.run(1);
        for (const m of sq.members) dMin = Math.min(dMin, hyp(m.pos, shotAt));
        const al = sq.members.filter((m) => m.alive);
        for (const a of al) for (const b of al) maxSpread = Math.max(maxSpread, hyp(a.pos, b.pos));
      }
      out[key] = { start: Math.round(d0), closest: Math.round(dMin), end: Math.round(Math.min(...sq.members.map((m) => hyp(m.pos, shotAt)))), spread: Math.round(maxSpread), tactics: { ...sim.metrics.tactics } };
    }
    return { sim, extra: () => out };
  },

  /** The player opens fire on a patrol, then breaks contact behind cover and stays hidden: the squad must search the last known position. */
  'lkp-search'(seed) {
    const c = { x: 320, z: 1080 };
    const sim = new Sim({ seed, pois: ['millbrook'], area: { x: c.x, z: c.z, r: 140 }, observer: c });
    sim.ai.spawned.set('millbrook', []); // no scavengers in the way
    const start = sim.findSpot(c, 20, 70) || c;
    const squad = sim.squad(['vsf_rifleman', 'vsf_rifleman', 'vsf_rifleman'], start.x, start.z, { role: 'rifleman' });
    sim.run(1);
    const sq = squad.members[0].pos;
    // a firing spot that sees the squad, and a hiding spot nearby that neither it nor the squad can see
    let fire = null, hide = null;
    for (let k = 0; k < 60 && !hide; k++) {
      fire = sim.findSpot(sq, 30, 60, (p) => sim.sees(p, sq));
      if (!fire) continue;
      hide = sim.findSpot(fire, 10, 30, (p) => !sim.sees(p, sq, 1.1, 1.6) && !sim.sees(p, fire, 1.1, 1.6), 120);
    }
    if (!hide) throw new Error('lkp-search: no fire/hide spot pair found');
    const bot = sim.bot({ x: fire.x, z: fire.z, weapon: 'wpn_arv7', accuracyDeg: 3.5, health: 600, range: 90 });
    let phase = 'fight';
    let lkp = null;
    bot.script = (b) => {
      if (phase === 'fight' && (b.shotsFired >= 12 || sim.t > 30)) {
        phase = 'hide';
        lkp = { x: b.pos.x, z: b.pos.z };
        b.shoot = false;
        b.waypoints = [{ x: hide.x, z: hide.z, speed: 5 }];
        b.wpIdx = 0;
      }
      if (phase === 'hide' && b.wpIdx >= b.waypoints.length) { b.stance = 'crouch'; b.shoot = true; b.range = 25; }
    };
    let closest = Infinity;
    let reached = null;
    sim.run(130, 1 / 30, () => {
      if (lkp) for (const m of squad.members) if (m.alive) {
        const d = hyp(m.pos, lkp);
        if (d < closest) closest = d;
        if (d < 6 && reached === null) reached = +(sim.t).toFixed(1);
      }
      return !bot.alive;
    });
    return {
      sim,
      extra: () => ({
        brokeContact: lkp ? +(sim.t).toFixed(0) && 'yes' : 'never',
        closestToLKP: Math.round(closest), reachedLKPat: reached,
        searchersAlive: squad.members.filter((m) => m.alive).length,
        botFound: bot.hits > 0 && phase === 'hide', botAlive: bot.alive,
        hideDist: hide && fire ? Math.round(hyp(hide, fire)) : null,
      }),
    };
  },

  /** Raiders with one magazine and no sidearm against a durable target: reload, run dry, disengage, scavenge. */
  'ammo-starvation'(seed) {
    const c = { x: 1100, z: 220 };
    const sim = new Sim({ seed, area: { x: c.x, z: c.z, r: 100 }, observer: c });
    const wolves = sim.squad(['wolf_shooter', 'wolf_shooter'], c.x, c.z, { role: 'rifleman', ammoMags: 1, noSidearm: true });
    const bot = sim.bot({ x: c.x + 60, z: c.z, weapon: 'wpn_arv7', accuracyDeg: 6, health: 5000, shoot: true, range: 120 });
    for (const m of wolves.members) m._reveal(bot, 0.8);
    sim.run(150, 1 / 30, () => wolves.members.every((m) => !m.alive));
    return {
      sim,
      extra: () => ({
        ammoLeft: wolves.members.map((m) => (m.weapon.data.ammo || 0) + m.inventory.count(m.w.ammo)),
        states: wolves.members.map((m) => m.state),
        dryFireAttempts: sim.metrics.ammoViolations,
      }),
    };
  },

  /** Night: flashlights, reduced vision; patrol meets the player at short range. */
  'night-contact'(seed) {
    const c = { x: 1100, z: 220 };
    const sim = new Sim({ seed, area: { x: c.x, z: c.z, r: 100 }, observer: c, night: 1 });
    const squad = sim.squad(['vsf_rifleman', 'vsf_rifleman'], c.x - 30, c.z, { role: 'patrol', route: [{ x: c.x + 40, z: c.z }, { x: c.x - 40, z: c.z }] });
    const bot = sim.bot({ x: c.x + 35, z: c.z + 6, weapon: 'wpn_arv7', accuracyDeg: 2.5, health: 300, range: 60, stance: 'crouch' });
    sim.run(90, 1 / 30, () => !bot.alive || squad.members.every((m) => !m.alive));
    return { sim, extra: () => ({ botHealth: Math.round(bot.health), squadAlive: squad.members.filter((m) => m.alive).length }) };
  },
};
