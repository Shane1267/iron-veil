import { describe, it, expect } from 'vitest';
import { WorldData } from '../../src/world/WorldData.js';
import { PhysicsWorld } from '../../src/engine/PhysicsWorld.js';
import { NavGrid } from '../../src/ai/NavGrid.js';
import { computeDamage, falloff, ZONE_MULT } from '../../src/combat/DamageSystem.js';
import { humanoidHitTest } from '../../src/combat/Characters.js';
import { validateSave, SAVE_VERSION } from '../../src/core/SaveManager.js';
import { FactionManager } from '../../src/ai/FactionManager.js';
import { ItemDB } from '../../src/items/ItemDatabase.js';
import { generateChunk } from '../../src/world/ChunkGenerator.js';

const world = new WorldData();

describe('World generation', () => {
  it('is deterministic', () => {
    const w2 = new WorldData();
    for (const [x, z] of [[0, 0], [1234, -2222], [-5000, 3000]]) expect(w2.heightRaw(x, z)).toBeCloseTo(world.heightRaw(x, z), 6);
  });

  it('defines 25+ points of interest across all 10 regions', () => {
    expect(world.pois.length).toBeGreaterThanOrEqual(25);
    expect(world.regions.length).toBe(10);
    const ids = new Set(world.pois.map((p) => p.id));
    expect(ids.size).toBe(world.pois.length);
  });

  it('flattens POI pads', () => {
    for (const p of world.pois) {
      const a = world.heightAt(p.x + p.radius * 0.3, p.z);
      const b = world.heightAt(p.x - p.radius * 0.3, p.z + p.radius * 0.2);
      expect(Math.abs(a - b), p.id).toBeLessThan(2.5);
    }
  });

  it('places bridges where roads cross rivers', () => {
    expect(world.bridges.length).toBeGreaterThan(0);
    for (const b of world.bridges) {
      const mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2;
      expect(world.bridgeAt(mx, mz)).not.toBeNull();
    }
  });

  it('grid heights match the analytic surface at sample points', () => {
    expect(world.heightAt(100, 200)).toBeCloseTo(world.heightRaw(100, 200), 3);
  });

  it('chunk generator produces consistent geometry', () => {
    const o = generateChunk(world, { x0: 0, z0: 512, size: 128, segs: 16, veg: true, vegDensity: 1 });
    expect(o.pos.length / 3).toBe(17 * 17 + 4 * 17);
    expect(Math.max(...o.index)).toBeLessThan(o.pos.length / 3);
    expect(o.veg.length % 6).toBe(0);
  });
});

describe('Physics', () => {
  it('blocks movement through a wall and allows step-up onto low boxes', () => {
    const phys = new PhysicsWorld(world);
    const x = 10, z = 10;
    const g = world.heightAt(x, z);
    phys.addBox(x + 1, g - 1, z - 5, x + 1.3, g + 3, z + 5, { material: 'concrete' });
    const pos = { x, y: g, z };
    const r = phys.moveCylinder(pos, 3, 0, 0.35, 1.8);
    expect(r.x).toBeLessThan(x + 1 - 0.3);
    // low step: ignored by horizontal resolution
    phys.addBox(x - 2, g - 1, z + 1, x - 1, g + 0.3, z + 2, { material: 'wood' });
    const r2 = phys.moveCylinder({ x: x - 1.5, y: g, z: z + 0.4 }, 0, 1, 0.35, 1.8, 0.45);
    expect(r2.z).toBeGreaterThan(z + 1.2);
  });

  it('raycasts hit boxes and terrain, and line of sight ignores glass', () => {
    const phys = new PhysicsWorld(world);
    const g = world.heightAt(50, 50);
    phys.addBox(54, g, 49, 54.2, g + 3, 51, { material: 'glass' });
    const hit = phys.raycast(50, g + 1.5, 50, 1, 0, 0, 20);
    expect(hit.material).toBe('glass');
    expect(phys.lineOfSight(50, g + 1.5, 50, 58, g + 1.5, 50)).toBe(true);
    const down = phys.raycast(50, g + 10, 50, 0, -1, 0, 50);
    expect(down.collider).toBeNull();
    expect(down.t).toBeCloseTo(10, 0);
  });

  it('pathfinding routes around a wall', () => {
    const phys = new PhysicsWorld(world);
    const nav = new NavGrid(phys, world);
    const cx = 900, cz = -560; // open valley ground
    const g = world.heightAt(cx, cz);
    phys.addBox(cx - 0.2, g - 1, cz - 10, cx + 0.2, g + 3, cz + 10, { material: 'concrete' });
    const path = nav.findPath({ x: cx - 6, z: cz }, { x: cx + 6, z: cz }, {});
    expect(path).not.toBeNull();
    expect(path.some((p) => Math.abs(p.z - cz) > 9)).toBe(true); // went around an end of the wall
  });
});

describe('Damage', () => {
  const rifle = ItemDB.weapon('wpn_arv7');
  it('applies distance falloff', () => {
    expect(falloff(rifle, 10)).toBe(1);
    expect(falloff(rifle, 1000)).toBeCloseTo(rifle.minDamage, 5);
  });
  it('headshots hurt more, armour and penetration reduce damage', () => {
    const body = computeDamage({ base: 34, weapon: rifle, distance: 20, zone: 'torso' });
    const head = computeDamage({ base: 34, weapon: rifle, distance: 20, zone: 'head' });
    expect(head / body).toBeCloseTo(ZONE_MULT.head, 5);
    expect(computeDamage({ base: 34, weapon: rifle, distance: 20, zone: 'torso', armor: 0.5 })).toBeLessThan(body);
    expect(computeDamage({ base: 34, weapon: rifle, distance: 20, zone: 'torso', penetrationLoss: 0.5 })).toBeCloseTo(body / 2, 5);
  });
  it('hit zones resolve on a humanoid', () => {
    const pos = { x: 0, y: 0, z: 0 };
    const head = humanoidHitTest(pos, 0, 'stand', 0, 1.6, 10, 0, 0, -1, 50);
    const torso = humanoidHitTest(pos, 0, 'stand', 0, 1.15, 10, 0, 0, -1, 50);
    const leg = humanoidHitTest(pos, 0, 'stand', 0, 0.5, 10, 0, 0, -1, 50);
    const miss = humanoidHitTest(pos, 0, 'stand', 2, 1.2, 10, 0, 0, -1, 50);
    expect(head.zone).toBe('head');
    expect(torso.zone).toBe('torso');
    expect(leg.zone).toBe('leg');
    expect(miss).toBeNull();
  });
});

describe('Factions', () => {
  it('neutral factions turn hostile when attacked', () => {
    const f = new FactionManager();
    expect(f.hostile('guard', 'player')).toBe(false);
    expect(f.hostile('wolves', 'player')).toBe(true);
    f.onPlayerAttack('guard', false);
    expect(f.hostile('guard', 'player')).toBe(true);
    expect(f.hostile('guard', 'guard')).toBe(false);
  });
});

describe('Save validation', () => {
  const good = { version: SAVE_VERSION, data: { player: { pos: { x: 1, y: 2, z: 3 }, equipment: {} }, world: { clock: { gameMinutes: 10 } }, base: { pieces: [] }, loot: {} } };
  it('accepts a well-formed save', () => expect(validateSave(good)).toBeNull());
  it('rejects malformed saves', () => {
    expect(validateSave(null)).not.toBeNull();
    expect(validateSave({ ...good, version: 99 })).not.toBeNull();
    expect(validateSave({ ...good, data: { ...good.data, player: { pos: { x: NaN, y: 0, z: 0 }, equipment: {} } } })).not.toBeNull();
    expect(validateSave({ ...good, data: { ...good.data, base: { pieces: 'oops' } } })).not.toBeNull();
  });
});
