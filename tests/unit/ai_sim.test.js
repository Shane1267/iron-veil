// Tactical AI checks run in the headless firefight simulator (tests/sim): real world,
// buildings, physics, ballistics and damage, many times faster than real time.
import { describe, it, expect, afterEach } from 'vitest';
import { SCENARIOS } from '../sim/scenarios.js';
import { Sim } from '../sim/Sim.js';
import { bus } from '../../src/core/EventBus.js';

let current = null;
afterEach(() => { current?.dispose(); current = null; });

function run(name, seed) {
  const r = SCENARIOS[name](seed);
  current = r.sim;
  return { s: r.sim.metrics.summary(), e: r.extra(), sim: r.sim };
}

/** Things that must never happen in any fight. */
function sane(s, label) {
  expect(s.stuck, `${label}: agents stuck`).toEqual([]);
  expect(s.insideGeometry, `${label}: agents inside walls`).toBe(0);
  expect(s.badFacing, `${label}: shots fired while facing away`).toBe(0);
  expect(s.ammoViolations, `${label}: negative ammunition`).toBe(0);
  expect(s.friendlyHits, `${label}: friendly fire`).toBeLessThanOrEqual(1);
}

describe('AI firefights (headless simulation)', () => {
  it('squad vs squad in open farmland: cover, suppression, flanking, reloads', () => {
    const tactics = {};
    for (const seed of [1, 2]) {
      const { s } = run('skirmish-field', seed);
      sane(s, `field#${seed}`);
      expect(s.shots).toBeGreaterThan(50);
      expect(s.deaths.length).toBeGreaterThan(0);
      expect(s.coverShare).toBeGreaterThan(0.2);
      expect(s.reloads).toBeGreaterThan(0);
      for (const [k, v] of Object.entries(s.tactics)) tactics[k] = (tactics[k] || 0) + v;
      current.dispose(); current = null;
    }
    expect(tactics.suppress || 0).toBeGreaterThan(0);
    expect(tactics.flank || 0).toBeGreaterThan(0);
    expect(tactics['cover-reload'] || 0).toBeGreaterThan(0);
  }, 120000);

  it('fight through village buildings without getting stuck or walking through walls', () => {
    const { s } = run('skirmish-village', 1);
    sane(s, 'village');
    expect(s.combatTime).toBeGreaterThan(30);
    expect(s.coverShare).toBeGreaterThan(0.25);
  }, 120000);

  it('garrison guards defend their post and do not chase out of their area', () => {
    // judged over three seeded fights: one short fight can go badly for the defenders
    // (two die in the opening seconds), which says little about how they use cover
    let cover = 0;
    for (const seed of [1, 2, 3]) {
      const { s, e } = run('garrison-defense', seed);
      sane(s, 'garrison');
      expect(s.shots).toBeGreaterThan(0);
      cover += s.coverShare / 3;
      // checkpoint radius 70 m; disciplined leash 1.6x
      expect(e.maxLeash).toBeLessThan(70 * 1.6 + 10);
    }
    expect(cover).toBeGreaterThan(0.5);
  }, 120000);

  it('distant gunfire: raiders and soldiers investigate, survivors stay away', () => {
    const { e } = run('distant-gunfire', 1);
    expect(e.wolves.closest).toBeLessThan(40);
    expect(e.soldiers.closest).toBeLessThan(60);
    expect(e.survivors.closest).toBeGreaterThanOrEqual(e.survivors.start - 5);
    // soldiers spread out to search rather than bunching on one spot
    expect(e.soldiers.spread).toBeGreaterThan(10);
  }, 120000);

  it('ammunition is finite: empty AI reloads, switches, scavenges or disengages', () => {
    const { s, e } = run('ammo-starvation', 1);
    sane(s, 'ammo');
    const issued = 2 * 30 * 2; // two raiders, one magazine loaded + one in reserve (at most 30 rounds each)
    expect(s.shots).toBeLessThanOrEqual(issued);
    expect(s.tactics['out-of-ammo'] || 0).toBeGreaterThan(0);
    expect((s.tactics['loot-body'] || 0) + (s.tactics.retreat || 0)).toBeGreaterThan(0);
    for (const a of e.ammoLeft) expect(a).toBeGreaterThanOrEqual(0);
  }, 120000);

  it('a player who breaks contact is searched for, not forgotten', () => {
    const { s, e } = run('lkp-search', 1);
    sane(s, 'lkp');
    // either they found the player again, or they actively searched the area
    expect(e.botFound || (s.tactics.search || 0) > 0).toBe(true);
  }, 120000);
});

describe('Sound propagation', () => {
  it('walls cut how far a gunshot carries, and only squads in earshot react', () => {
    const sim = new Sim({ seed: 3, pois: ['millbrook'], observer: { x: 320, z: 1080 } });
    current = sim;
    sim.ai.spawned.set('millbrook', []);
    const heard = [];
    const sq = sim.squad(['vsf_rifleman'], 320, 1080, { role: 'rifleman' });
    const a = sq.members[0];
    a.hear = (ev, d, info) => heard.push({ d, ...info });
    // find a spot 120 m away with a clear line, and one behind buildings
    const open = sim.findSpot(a.pos, 110, 130, (p) => sim.sees(p, a.pos, 1, 1.6));
    const hidden = sim.findSpot(a.pos, 110, 130, (p) => !sim.sees(p, a.pos, 1, 1.6));
    expect(open && hidden).toBeTruthy();
    sim.ai.emitSound({ x: open.x, y: open.y, z: open.z, radius: 150, type: 'gunshot', source: null });
    expect(heard.length).toBe(1);
    expect(heard[0].occluded).toBe(false);
    heard.length = 0;
    // 150 m * 0.55 occlusion < 110 m: muffled by walls, not heard
    sim.ai.emitSound({ x: hidden.x, y: hidden.y, z: hidden.z, radius: 150, type: 'gunshot', source: null });
    expect(heard.length).toBe(0);
    sim.ai.emitSound({ x: hidden.x, y: hidden.y, z: hidden.z, radius: 400, type: 'gunshot', source: null });
    expect(heard.length).toBe(1);
    expect(heard[0].occluded).toBe(true);
  });

  it('squad radio relays contacts in game time, not wall-clock time', () => {
    const sim = new Sim({ seed: 4, area: { x: 1100, z: 220, r: 60 }, observer: { x: 1100, z: 220 } });
    current = sim;
    const sq = sim.squad(['vsf_rifleman', 'vsf_rifleman'], 1100, 220, { role: 'rifleman' });
    const [a, b] = sq.members;
    b.pos.x += 120; // out of voice range, inside radio range
    const enemy = sim.squad(['wolf_raider'], 1100, 320, { role: 'rusher' }).members[0];
    sq.report(a, enemy, enemy.pos, 1);
    expect(b.contacts.has(enemy)).toBe(false); // nothing is instant
    sim.run(2);
    expect(b.contacts.has(enemy)).toBe(true);
    void bus;
  });
});
