import { describe, it, expect } from 'vitest';
import { WorldData } from '../../src/world/WorldData.js';
import { PhysicsWorld } from '../../src/engine/PhysicsWorld.js';
import { POIManager } from '../../src/world/POIManager.js';
import { generateChunk, VEG_TYPES } from '../../src/world/ChunkGenerator.js';
import * as Veg from '../../src/world/VegetationModels.js';
import vehicles from '../../src/data/vehicles.json';

const world = new WorldData();

describe('POI construction', () => {
  it('every location layout builds without errors and plants valid trees', () => {
    const physics = new PhysicsWorld(world);
    const mats = { get: () => ({}), factory: {} };
    const pm = new POIManager({ add() {} }, world, physics, mats, { add: () => ({}), remove() {} }, {});
    for (const poi of world.pois) {
      pm._begin(poi);
      const job = pm.building;
      let errors = 0;
      while (job.i < job.commands.length) {
        try { job.commands[job.i](); } catch (e) { errors++; }
        job.i++;
      }
      expect(errors, poi.id).toBe(0);
      for (const t of job.ctx.trees) {
        expect(Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z), poi.id).toBe(true);
        expect(VEG_TYPES.includes(t.type), `${poi.id} tree ${t.type}`).toBe(true);
      }
      pm.building = null;
      physics.removeOwner(`poi:${poi.id}`);
    }
  }, 60000);

  it('Millbrook has its church landmark and fenced yards', () => {
    const physics = new PhysicsWorld(world);
    const pm = new POIManager({ add() {} }, world, physics, { get: () => ({}), factory: {} }, { add: () => ({}), remove() {} }, {});
    pm._begin(world.pois.find((p) => p.id === 'millbrook'));
    const ctx = pm.building.ctx;
    expect(ctx.buildings.some((b) => b.arch === 'church')).toBe(true);
    while (pm.building.i < pm.building.commands.length) pm.building.commands[pm.building.i++]();
    // fences add many wooden colliders around the yards
    expect(ctx.colliders.filter((c) => c.material === 'wood').length).toBeGreaterThan(60);
  });
});

describe('Vehicle spawns', () => {
  it('no POI prop blocks a parked vehicle or the first 8 m ahead/behind it', () => {
    const physics = new PhysicsWorld(world);
    const pm = new POIManager({ add() {} }, world, physics, { get: () => ({}), factory: {} }, { add: () => ({}), remove() {} }, {});
    for (const poi of world.pois) {
      pm._begin(poi);
      while (pm.building.i < pm.building.commands.length) { try { pm.building.commands[pm.building.i](); } catch { /* covered above */ } pm.building.i++; }
      pm.building = null;
    }
    for (const v of vehicles.spawns) {
      const [x, z] = v.pos;
      const y = world.heightAt(x, z);
      // forward = (-sin rot, -cos rot); sample along the length of the parking spot and the run-out
      for (let s = -8; s <= 8; s += 1) {
        const px = x - Math.sin(v.rot) * s, pz = z - Math.cos(v.rot) * s;
        const hit = physics.overlapsCylinder(px, y + 0.55, pz, 1.0, 1.2, null);
        const solid = hit && hit.tag !== 'bush' && hit.tag !== 'character' && hit.material !== 'foliage';
        expect(solid ? `${v.id} blocked at ${s} m by ${hit.material} (${hit.owner}) x${hit.minX?.toFixed(1)}..${hit.maxX?.toFixed(1)} z${hit.minZ?.toFixed(1)}..${hit.maxZ?.toFixed(1)} y${hit.minY?.toFixed(1)}..${hit.maxY?.toFixed(1)}` : null).toBe(null);
      }
    }
  }, 60000);
});

describe('Terrain chunk data', () => {
  it('splat carries dirt, sand, wheat and plowed weights in 0..1', () => {
    const o = generateChunk(world, { x0: -3600, z0: 3000, size: 128, segs: 16, veg: true, vegDensity: 1 });
    expect(o.spl.length).toBe((o.pos.length / 3) * 4);
    for (const v of o.spl) expect(v >= 0 && v <= 1).toBe(true);
  });
  it('vegetation entries use known types including ground cover', () => {
    const o = generateChunk(world, { x0: -2600, z0: -400, size: 128, segs: 16, veg: true, vegDensity: 1 });
    const types = new Set();
    for (let i = 0; i < o.veg.length; i += 6) types.add(VEG_TYPES[o.veg[i]]);
    expect([...types].every(Boolean)).toBe(true);
    expect(types.has('fern')).toBe(true); // Blackwood forest floor
  });
});

describe('Vegetation models', () => {
  it('stay within a sensible triangle budget', () => {
    const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
    expect(tris(Veg.makeBroadleaf(0, 'full'))).toBeLessThan(700);
    expect(tris(Veg.makeBroadleaf(0, 'mid'))).toBeLessThan(260);
    expect(tris(Veg.makePine(0, 'full'))).toBeLessThan(700);
    expect(tris(Veg.makeGrassClump())).toBeLessThanOrEqual(8);
  });
});
