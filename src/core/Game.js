import * as THREE from 'three';
import { bus } from './EventBus.js';
import { settings, BOOT } from './SettingsManager.js';
import { Input } from './Input.js';
import { Interactables } from './Interactables.js';
import { GameClock } from './GameClock.js';
import { Objectives } from './Objectives.js';
import { saves } from './SaveManager.js';
import { Renderer } from '../engine/Renderer.js';
import { Lighting } from '../engine/Lighting.js';
import { Materials } from '../engine/Materials.js';
import { PhysicsWorld, UNDERGROUND_Y } from '../engine/PhysicsWorld.js';
import { LightPool } from '../engine/LightPool.js';
import { getWorldData } from '../world/WorldData.js';
import { TerrainManager } from '../world/TerrainManager.js';
import { Infrastructure } from '../world/Infrastructure.js';
import { POIManager } from '../world/POIManager.js';
import { WeatherSystem } from '../world/WeatherSystem.js';
import { Player } from '../player/Player.js';
import { Characters } from '../combat/Characters.js';
import { Effects } from '../weapons/Effects.js';
import { Ballistics } from '../weapons/Ballistics.js';
import { WeaponController } from '../weapons/WeaponController.js';
import { FactionManager } from '../ai/FactionManager.js';
import { AIManager } from '../ai/AIManager.js';
import { WorldEvents } from '../ai/WorldEvents.js';
import { BaseSystem } from '../basebuilding/BaseSystem.js';
import { VehicleSystem } from '../vehicles/VehicleSystem.js';
import { LootSystem } from '../items/LootSystem.js';
import { Inventory } from '../items/Inventory.js';
import { ItemDB } from '../items/ItemDatabase.js';
import { CraftingSystem } from '../items/CraftingSystem.js';
import { IconRenderer, buildItemModel } from '../items/ItemModels.js';
import { CharacterModel } from '../ai/CharacterModel.js';
import { audio } from '../audio/AudioManager.js';
import { UIManager } from '../ui/UIManager.js';
import { clamp } from './MathUtil.js';
import { DebugMenu } from '../ui/DebugMenu.js';
import { NPCSystem } from '../npc/NPCSystem.js';
import { Explosives } from '../weapons/Explosives.js';
import { NightVision } from '../player/NightVision.js';
import { FacilityTurrets } from '../world/FacilityTurrets.js';

// Top-level orchestrator: owns every system, runs the frame loop, routes input to
// gameplay or UI, handles interactions, item drops, death/respawn and save/load.

const LORE = [
  'Field journal, ranger station: "They cut the power to Old Vesper on the fourth day. The Security Forces said it was temporary. That was two winters ago."',
  'Torn page: "The Iron Wolves do not want the towns. They want what is in them. Lock everything, and never light a fire you cannot defend."',
  'Notebook, logging camp: "Planks, nails, a hammer. That is all a wall is. A wall is the difference between sleeping and waiting."',
  'Radio log fragment: "Northwatch keeps its signal tables in the command building, top floor. Riverside will only answer an authenticated call."',
  'Letter, never sent: "If you find this at the farm, the pickup still runs. It just drinks fuel like the old man did."',
  'Water treatment memo: "Do not let the Free Companies take the plant. Whoever holds the water holds the valley."',
  'Scrawled note: "Gunshots echo off Redstone Ridge for a long time. You hear the fight long after it is over."',
  'Evacuation notice: "Civilian Evacuation Centre suspended. Remaining residents should report to Riverside Settlement."',
  'Mercenary contract: "Ironhaven complex — hold the warehouses, sell to whoever pays. No questions about where the trucks go."',
  'Child\'s drawing on the back of a map: a house, a tree, a tall tower with a red light at the top.',
];

export class Game {
  constructor() {
    this.settings = settings;
    this.container = document.getElementById('viewport');
    this.renderer = new Renderer(this.container);
    this.input = new Input(this.renderer.renderer.domElement);
    this.materials = new Materials(this.renderer.renderer, BOOT.textures, BOOT.lite);
    this.world = getWorldData();
    this.physics = new PhysicsWorld(this.world);
    this.interactables = new Interactables();
    this.characters = new Characters();
    this.clock = new GameClock();
    this.lighting = new Lighting(this.renderer.renderer, this.renderer.scene, this.renderer);
    this.weather = new WeatherSystem(this.renderer.scene);
    this.lights = new LightPool(this.renderer.scene, 6);
    this.fires = [];
    this.loot = new LootSystem();
    this.crafting = new CraftingSystem();
    this.factions = new FactionManager();
    this.effects = new Effects(this.renderer.scene, this.renderer.viewScene, this.world);
    this.terrain = new TerrainManager(this.renderer.scene, this.world, this.physics, this.materials);
    this.infra = new Infrastructure(this.renderer.scene, this.world, this.physics, this.materials, this.interactables, this.loot);
    this.pois = new POIManager(this.renderer.scene, this.world, this.physics, this.materials, this.interactables, {
      waterMat: this.infra.waterMat,
      vegetation: { geos: this.terrain.vegGeos.full, material: this.terrain.vegMaterial, depth: this.terrain.vegDepth },
    });
    this.npcs = new NPCSystem(this);
    this.player = new Player(this);
    this.characters.add(this.player.character);
    this.ballistics = new Ballistics(this.physics, this.characters, this.effects, this.world, { onGlass: (pane) => this.pois.breakGlass(pane) });
    this.weapons = new WeaponController(this);
    this.ai = new AIManager(this);
    this.events = new WorldEvents(this);
    this.base = new BaseSystem(this);
    this.vehicles = new VehicleSystem(this);
    this.objectives = new Objectives(this);
    this.icons = new IconRenderer(this.materials);
    this.ui = new UIManager(this);
    this.debug = new DebugMenu(this);
    this.explosives = new Explosives(this);
    this.nightVision = new NightVision(this);
    this.turrets = new FacilityTurrets(this);
    this.openGates = new Set();

    this.started = false;
    this.dead = false;
    this.time = 0;
    this.discovered = new Set();
    this.fog = { size: 128, data: new Uint8Array(128 * 128) };
    this.markers = [];
    this.waypoint = null;
    this.journalPages = [];
    this.piles = new Map();
    this.lookTarget = null;
    this.interactionAction = null;
    this.autosaveT = 240;
    this.envT = 0;
    this.indoor = false;
    this.lastFrame = performance.now();

    this._wireEvents();
    this.loot.respawnMinutes = settings.get('lootRespawnMinutes');
    bus.on('settings:changed', (c) => { if ('lootRespawnMinutes' in c) this.loot.respawnMinutes = c.lootRespawnMinutes; });
    window.__IV = this._debugApi();
    this.ui.open('menu');
    requestAnimationFrame((t) => this._frame(t));
  }

  // ------------------------------------------------------------ events
  _wireEvents() {
    bus.on('weapon:fired', (e) => audio.gunshot(e));
    bus.on('sound', (e) => audio.play(e));
    bus.on('footstep', (e) => audio.footstep(e));
    bus.on('impact', (e) => audio.impact(e));
    bus.on('audio:whiz', (e) => audio.whiz(e));
    bus.on('glass:break', (p) => this.effects.emit(p.x, p.y, p.z, { color: [0.8, 0.9, 0.95], count: 26, speed: 2.5, size: 0.05, life: 1.0, gravity: 9, alpha: 0.9 }));
    bus.on('player:died', (e) => this._onDeath(e));
    bus.on('poi:built', (rt) => {
      for (const gt of rt.gates || []) if (this.openGates.has(gt.id)) { gt.open = true; gt.slide = 1; gt.collider.enabled = false; if (gt.def.sink) gt.mesh.position.y = gt.home.y - (gt.def.h - 0.05); else gt.mesh.position.set(gt.home.x + Math.cos(gt.def.yaw) * gt.def.w * 0.95, gt.home.y, gt.home.z - Math.sin(gt.def.yaw) * gt.def.w * 0.95); }
      for (const l of rt.lights) l.source = this.lights.add({ x: l.x, y: l.y, z: l.z, street: l.street, color: l.color || 0xffd090, intensity: l.intensity || 8, range: l.range || 22 });
      for (const f of rt.fires) {
        f.source = this.lights.add({ x: f.x, y: f.y + 0.5, z: f.z, color: 0xff9040, intensity: 8, range: 14, flicker: true, active: () => (this.lighting.nightFactor || 0) > 0.3 });
        f.active = () => (this.lighting.nightFactor || 0) > 0.3;
        this.fires.push(f);
      }
    });
    bus.on('poi:unloading', (rt) => {
      for (const l of rt.lights) if (l.source) this.lights.remove(l.source);
      for (const f of rt.fires) { if (f.source) this.lights.remove(f.source); this.fires = this.fires.filter((x) => x !== f); }
    });
    bus.on('objective:complete', () => { if (this.started) this.saveGame('auto', true); });
    bus.on('npc:died', (e) => {
      if (e.killer === this.player.character) this.player.skills.gain('marksmanship', 2);
    });
    bus.on('base:raid', () => bus.emit('notify', { text: 'Movement spotted near your base…', kind: 'warn' }));
  }

  // ------------------------------------------------------------ helpers used by systems
  carryCapacity() {
    if (this.debug?.flags.carry) return 1e6;
    return 30;
  }

  encumbrance() {
    return this.player.equipment.totalWeight() / this.carryCapacity();
  }

  nearStation(type) {
    const p = this.player.controller.pos;
    for (const pc of this.base.pieces.values()) if (pc.def.station === type && Math.hypot(pc.x - p.x, pc.z - p.z) < 3.5) return true;
    for (const rt of this.pois.active.values()) {
      for (const c of rt.containers) if (c.kind === type && Math.hypot(c.x - p.x, c.z - p.z) < 3) return true;
    }
    return false;
  }

  poiHostile(q) {
    const g = q.garrison?.[0];
    if (!g) return false;
    const prof = this.factions.profile(g.profile);
    return prof ? this.factions.hostile(prof.faction, 'player') : false;
  }

  poiFactionLabel(q) {
    const g = q.garrison?.[0];
    if (!g) return '';
    const prof = this.factions.profile(g.profile);
    return prof ? this.factions.get(prof.faction).short : '';
  }

  factionList() {
    return this.factions.constructor && Object.keys(this.factions.rel).map((id) => ({ id, name: this.factions.get(id).name, rel: this.factions.hostile(id, 'player') ? -100 : this.factions.relation('player', id) }));
  }

  /** Drop an item stack on the ground near the player (merging into a nearby pile). */
  dropItem(stack, pos = null) {
    const p = pos || this.player.controller.pos;
    const fwd = this.player.controller.forward(new THREE.Vector3());
    const x = pos ? p.x : p.x + fwd.x * 0.9, z = pos ? p.z : p.z + fwd.z * 0.9;
    let pile = null;
    for (const pl of this.piles.values()) if (Math.hypot(pl.x - x, pl.z - z) < 1.6 && !pl.body) { pile = pl; break; }
    if (!pile) pile = this._createPile({ x, z });
    const left = pile.inv.add(stack);
    if (left) {
      const p2 = this._createPile({ x: x + 0.8, z });
      p2.inv.add({ ...stack, qty: left });
    }
    this._refreshPile(pile);
    bus.emit('sound', { type: 'pickup', ui: true });
  }

  dropInventory(inv, pos, name = 'Items') {
    const pile = this._createPile({ x: pos.x, z: pos.z, name, cap: Math.max(20, inv.capacity) });
    inv.transferAll(pile.inv);
    this._refreshPile(pile);
    return pile;
  }

  _createPile({ x, z, name = 'Dropped items', cap = 24, id = null, body = false, y = null }) {
    id = id || `pile:${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const gy = y ?? this.physics.groundHeight(x, z, 0.3, this.player.controller.pos.y + 1.5);
    let inv = this.loot.get(id);
    if (!inv) inv = this.loot.register(id, new Inventory(cap, name), { meta: { pile: true, x, y: gy, z, name, body } });
    const group = new THREE.Group();
    group.position.set(x, gy, z);
    this.renderer.scene.add(group);
    const pile = { id, x, y: gy, z, inv, group, body, name };
    pile.interact = this.interactables.add({ id: `pi:${id}`, kind: 'container', x, y: gy + 0.4, z, radius: 1.4, label: () => (body ? name : `Pick up: ${this._pileLabel(pile)}`), data: { containerId: id, name, custom: true, pile } });
    this.piles.set(id, pile);
    if (body) {
      const model = new CharacterModel({ uniform: '#3a3f48', accent: '#2a2622', skin: '#c9a080', pack: false }, this.materials);
      model.die(1, 0.3);
      for (let i = 0; i < 60; i++) model.animate(1 / 30, {});
      group.add(model.root);
    }
    return pile;
  }

  _pileLabel(pile) {
    const first = pile.inv.slots.find(Boolean);
    const n = pile.inv.usedSlots();
    return first ? `${ItemDB.get(first.id).name}${n > 1 ? ` +${n - 1}` : ''}` : 'empty';
  }

  _refreshPile(pile) {
    if (!this.piles.has(pile.id)) return;
    if (!pile.inv.usedSlots() && !pile.body) { this._removePile(pile); return; }
    if (pile.body) return;
    // show a model of the first item
    const first = pile.inv.slots.find(Boolean);
    if (pile.modelId !== first.id) {
      for (const c of [...pile.group.children]) pile.group.remove(c);
      const m = buildItemModel(first.id, this.materials);
      m.rotation.y = Math.random() * 6;
      if (ItemDB.get(first.id).cat === 'weapon') { m.rotation.set(0, Math.random() * 6, Math.PI / 2); m.position.y = 0.03; }
      pile.group.add(m);
      pile.modelId = first.id;
    }
  }

  _removePile(pile) {
    this.renderer.scene.remove(pile.group);
    this.interactables.remove(pile.interact);
    this.loot.remove(pile.id);
    this.piles.delete(pile.id);
  }

  _restorePiles() {
    for (const [id, c] of this.loot.containers) {
      if (!c.meta?.pile) continue;
      const pile = this._createPile({ x: c.meta.x, z: c.meta.z, y: c.meta.y, id, name: c.meta.name, body: c.meta.body });
      this._refreshPile(pile);
    }
  }

  useSpecialItem(id, slotIndex) {
    const inv = this.player.equipment.inventory;
    const def = ItemDB.get(id);
    if (def.use.placeCharge) {
      const r = this.explosives.plant();
      if (r.ok) inv.remove(id, 1);
      bus.emit('notify', { text: r.msg, kind: r.ok ? 'good' : 'info' });
      return;
    }
    if (def.use.detonate) {
      const r = this.explosives.detonate();
      bus.emit('notify', { text: r.msg, kind: r.ok ? 'warn' : 'info' });
      return;
    }
    if (def.use.revealRegion) {
      const p = this.player.controller.pos;
      const region = this.world.regionAt(p.x, p.z);
      let n = 0;
      for (const q of this.world.pois) {
        if (this.world.regionAt(q.x, q.z) === region && !this.discovered.has(q.id)) { this.discovered.add(q.id); n++; }
      }
      inv.remove(id, 1);
      bus.emit('notify', { text: n ? `Map read: ${n} locations in ${region.name} marked` : `Nothing new on the ${region.name} map`, kind: 'good' });
      return;
    }
    if (def.use.read) {
      const unread = LORE.filter((l) => !this.journalPages.includes(l));
      const page = unread.length ? unread[Math.floor(Math.random() * unread.length)] : LORE[Math.floor(Math.random() * LORE.length)];
      if (!this.journalPages.includes(page)) this.journalPages.push(page);
      inv.remove(id, 1);
      bus.emit('notify', { text: page, kind: 'info' });
      return;
    }
    if (def.use.refuel) {
      const v = this._nearestVehicle(5);
      if (!v) { bus.emit('notify', { text: 'Stand next to a vehicle to refuel it', kind: 'info' }); return; }
      const r = this.vehicles.service(v, inv);
      bus.emit('notify', { text: r.msg, kind: r.ok ? 'good' : 'info' });
    }
    void slotIndex;
  }

  _nearestVehicle(r) {
    const p = this.player.controller.pos;
    let best = null, bd = r;
    for (const v of this.vehicles.vehicles.values()) {
      const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  secondaryLabel(it) {
    const inv = this.player.equipment.inventory;
    if (it.kind === 'vehicle') {
      const v = it.data.vehicle;
      if (v.needs.some((n) => inv.count(n))) return 'Install part';
      if (v.fuel < v.t.fuelCap - 1 && inv.count('fuel_can')) return 'Refuel (jerrycan)';
      if (v.health < v.t.health && !v.destroyed && inv.count('tool_wrench') && inv.count('mech_parts')) return 'Repair';
      return null;
    }
    if (it.kind === 'basedoor') return it.data.piece.locked ? 'Unlock' : 'Lock';
    if (it.kind === 'container' && it.data.piece?.def.lockable) return it.data.piece.locked ? 'Unlock' : 'Lock';
    if (it.kind === 'water' || it.kind === 'pump') return null;
    return null;
  }

  // ------------------------------------------------------------ game flow
  _resetWorld() {
    this.ai.clear();
    this.pois.unloadAll();
    this.base.clear();
    this.vehicles.clear();
    for (const p of [...this.piles.values()]) this._removePile(p);
    this.loot.containers.clear();
    this.factions.reset();
    this.objectives = new Objectives(this);
    this.clock = new GameClock();
    this.events.deserialize(null);
    this.npcs.deserialize(null);
    this.explosives.clear();
    this.openGates.clear();
    this.turrets.deserialize(null);
    this.nightVision.on = false;
    this.discovered.clear();
    this.fog.data.fill(0);
    this.markers = [];
    this.waypoint = null;
    this.journalPages = [];
    this.effects.clearDecals();
    this.dead = false;
    this.player.survival.reset();
    this.player.stats = { kills: 0, distance: 0, looted: 0, timeAlive: 0 };
  }

  _starterKit() {
    const eq = this.player.equipment;
    for (const k of Object.keys(eq.slots)) eq.slots[k] = null;
    eq.inventory = new Inventory(eq.capacity(), 'Pockets');
    eq.slots.body = ItemDB.create('hoodie', 1);
    eq.slots.util = ItemDB.create('flashlight', 1);
    eq.refreshCapacity();
    eq.inventory.add(ItemDB.create('rag_bandage', 2));
    eq.inventory.add(ItemDB.create('water_bottle', 1));
    eq.inventory.add(ItemDB.create('energy_bar', 1));
    eq.inventory.add(ItemDB.create('battery', 1));
    eq.quick = ['rag_bandage', 'water_bottle', 'energy_bar', null];
    this.weapons.select(null);
  }

  _spawnPoint() {
    const pts = this.world.data.spawnPoints;
    const [x, z] = pts[Math.floor(Math.random() * pts.length)];
    return { x, z, y: this.world.heightAt(x, z) + 0.05 };
  }

  async newGame() {
    audio.init();
    this.ui.open('loading');
    this._resetWorld();
    this.vehicles.spawnDefaults();
    this.weather.set('clear', true);
    this.player.skills.deserialize({});
    this._starterKit();
    const sp = this._spawnPoint();
    this.player.controller.teleport(sp.x, sp.y, sp.z, Math.random() * Math.PI * 2);
    await this._streamIn();
    this._settleSpawn();
    this.started = true;
    this.ui.open('playing');
    bus.emit('notify', { text: 'Find a weapon. Millbrook village lies close by — follow the road.', kind: 'objective' });
  }

  /**
   * After the area around the player has loaded, make sure the player stands on clear ground:
   * not inside a tree, rock, wreck or building wall, not in deep water. keepNear keeps the
   * player as close as possible to the exact point (loaded saves, bedrolls).
   */
  _settleSpawn(keepNear = false) {
    const pc = this.player.controller;
    const phys = this.physics, world = this.world;
    const R = 0.4, H = 1.75;
    const ok = (x, z, y) => {
      if (world.waterAt(x, z) !== null && world.waterAt(x, z) - world.heightAt(x, z) > 0.6) return false;
      if (phys.overlapsCylinder(x, y + 0.3, z, R, H - 0.3)) return false;
      return true;
    };
    const floorAt = (x, z, fromY) => phys.groundHeight(x, z, 0.35, fromY);
    // a saved position (e.g. inside a building) is fine as long as nothing overlaps the player
    const y0 = keepNear ? floorAt(pc.pos.x, pc.pos.z, pc.pos.y + 0.6) : floorAt(pc.pos.x, pc.pos.z, world.heightAt(pc.pos.x, pc.pos.z) + 0.6);
    if (ok(pc.pos.x, pc.pos.z, y0)) { pc.teleport(pc.pos.x, y0 + 0.05, pc.pos.z, pc.yaw); return; }
    // otherwise spiral outward to the nearest clear spot on open ground
    for (let r = 1; r <= 40; r += 1) {
      const n = Math.max(6, Math.round(r * 2.5));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const x = pc.pos.x + Math.cos(a) * r, z = pc.pos.z + Math.sin(a) * r;
        const g = world.heightAt(x, z);
        const y = floorAt(x, z, g + 0.6);
        if (y - g > 0.3) continue; // standing on top of a prop
        if (!ok(x, z, y)) continue;
        pc.teleport(x, y + 0.05, z, pc.yaw);
        return;
      }
    }
  }

  async _streamIn() {
    const p = this.player.controller.pos;
    this.terrain.reset();
    const t0 = performance.now();
    // terrain around the player
    while (!this.terrain.ready && performance.now() - t0 < 40000) {
      this.terrain.update(0.016, p, 0, 0.3);
      const frac = Math.min(1, this.terrain.near.size / 25);
      this.ui.setLoading(frac * 0.6, `Generating terrain ${this.terrain.near.size} chunks`);
      await new Promise((r) => setTimeout(r, 30));
    }
    // POIs in range
    this.ui.setLoading(0.65, 'Constructing locations');
    await new Promise((r) => setTimeout(r, 20));
    const near = this.world.pois.filter((q) => Math.hypot(q.x - p.x, q.z - p.z) - q.radius < this.pois.radiusIn);
    for (let i = 0; i < near.length; i++) {
      const q = near[i];
      this.ui.setLoading(0.65 + (i / near.length) * 0.25, `Constructing ${q.name}`);
      await new Promise((r) => setTimeout(r, 10));
      if (!this.pois.isBuilt(q.id)) { this.pois._begin(q); while (this.pois.building) this.pois._continue(1e9); }
    }
    this.infra.lastTile = null;
    this.infra.update(0, p, 0);
    // settle the player on the ground (buildings may have appeared under them)
    const g = this.physics.groundHeight(p.x, p.z, 0.34, p.y + 1.5);
    if (p.y < g) p.y = g;
    this.ui.setLoading(0.95, 'Warming up');
    this.map = this.ui.map;
    this.ui.map.requestImage();
    // let the renderer compile shaders before handing over control
    this.renderer.render(0.016, true);
    await new Promise((r) => setTimeout(r, 50));
    this.ui.setLoading(1, 'Ready');
  }

  serialize() {
    return {
      player: this.player.serialize(),
      world: {
        clock: this.clock.serialize(), weather: this.weather.serialize(), discovered: [...this.discovered],
        fog: Array.from(this.fog.data).join(''), markers: this.markers, waypoint: this.waypoint, journal: this.journalPages,
        gates: [...this.openGates], turretsDown: this.turrets.serialize(),
      },
      objectives: this.objectives.serialize(),
      loot: this.loot.serialize(),
      base: this.base.serialize(),
      vehicles: this.vehicles.serialize(),
      factions: this.factions.serialize(),
      ai: this.ai.serialize(),
      events: this.events.serialize(),
      npcs: this.npcs.serialize(),
      settings: { ...settings.values },
    };
  }

  summary() {
    const p = this.player.controller.pos;
    const region = this.world.regionAt(p.x, p.z);
    return { label: `Day ${this.clock.day} ${this.clock.label} · ${region?.name || ''}`, health: Math.round(this.player.survival.health), objective: this.objectives.current?.title };
  }

  async saveGame(slot, quiet = false) {
    if (!this.started) return;
    if (this.dead) { if (!quiet) bus.emit('notify', { text: 'Cannot save while dead', kind: 'warn' }); return; }
    const data = this.serialize();
    // defer the write so the frame is not blocked
    await new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 500 }) : setTimeout(r, 0)));
    const res = await saves.save(slot, data, this.summary());
    if (!quiet || !res.ok) bus.emit('notify', { text: res.ok ? `Game saved (${slot === 'auto' ? 'autosave' : slot})` : `Save failed: ${res.msg}`, kind: res.ok ? 'good' : 'warn' });
    return res;
  }

  async loadGame(slot) {
    audio.init();
    const res = await saves.load(slot);
    if (!res.ok) { bus.emit('notify', { text: res.msg, kind: 'warn' }); alert(res.msg); return; }
    this.ui.open('loading');
    try {
      this._applySave(res.rec.data);
    } catch (e) {
      console.error('[Load] failed to apply save', e);
      alert(`Could not load this save: ${e.message}`);
      this.quitToMenu();
      return;
    }
    await this._streamIn();
    this._settleSpawn(true);
    this.started = true;
    this.ui.open('playing');
    if (res.recovered) bus.emit('notify', { text: 'Main save was damaged — restored from backup', kind: 'warn' });
  }

  _applySave(d) {
    this._resetWorld();
    this.clock.deserialize(d.world.clock);
    this.weather.deserialize(d.world.weather);
    this.factions.deserialize(d.factions);
    this.loot.deserialize(d.loot);
    this.base.deserialize(d.base);
    this.vehicles.deserialize(d.vehicles);
    if (!this.vehicles.vehicles.size) this.vehicles.spawnDefaults();
    this.player.deserialize(d.player);
    this.player.equipment.refreshCapacity();
    this.ai.deserialize(d.ai);
    this.events.deserialize(d.events);
    this.npcs.deserialize(d.npcs);
    this.objectives.deserialize(d.objectives);
    for (const id of d.world.discovered || []) if (this.world.poiById.has(id)) this.discovered.add(id);
    if (typeof d.world.fog === 'string' && d.world.fog.length === this.fog.data.length) for (let i = 0; i < this.fog.data.length; i++) this.fog.data[i] = d.world.fog.charCodeAt(i) === 49 ? 1 : 0;
    this.markers = Array.isArray(d.world.markers) ? d.world.markers.filter((m) => Number.isFinite(m?.x) && Number.isFinite(m?.z)) : [];
    this.waypoint = d.world.waypoint && Number.isFinite(d.world.waypoint.x) ? d.world.waypoint : null;
    this.journalPages = Array.isArray(d.world.journal) ? d.world.journal.filter((x) => typeof x === 'string') : [];
    this.openGates = new Set(Array.isArray(d.world.gates) ? d.world.gates.filter((x) => typeof x === 'string') : []);
    this.turrets.deserialize(d.world.turretsDown);
    this._restorePiles();
    const slot = d.player?.weaponSlot;
    this.weapons.select(slot && this.player.equipment.slots[slot] ? slot : null);
  }

  quitToMenu() {
    this.started = false;
    this.vehicles.current = null;
    this.base.exit();
    this.ui.open('menu');
  }

  _onDeath(e) {
    this.dead = true;
    if (this.vehicles.current) this.vehicles.exit(null, true);
    this.base.exit();
    this.weapons.select(null);
    const p = this.player.controller.pos;
    // everything you carried stays with your body
    const eq = this.player.equipment;
    const inv = new Inventory(40, 'Your body');
    for (const k of Object.keys(eq.slots)) if (eq.slots[k]) { inv.add(eq.slots[k]); eq.slots[k] = null; }
    eq.inventory.transferAll(inv);
    const body = this._createPile({ x: p.x, z: p.z, name: 'Your body', cap: 40, body: true });
    inv.transferAll(body.inv);
    this.markers.push({ x: p.x, z: p.z, label: 'Your body' });
    this.player.stats.deaths = (this.player.stats.deaths || 0) + 1;
    setTimeout(() => this.ui.open('dead', e), 900);
  }

  async respawn() {
    if (this._respawning) return; // double-clicked respawn
    this._respawning = true;
    try { await this._respawn(); } finally { this._respawning = false; }
  }

  async _respawn() {
    this.dead = false;
    this.player.survival.reset();
    this.player.survival.hunger = 70;
    this.player.survival.thirst = 70;
    this._starterKit();
    const rp = this.base.respawnPoint() || this._spawnPoint();
    this.player.controller.teleport(rp.x, rp.y, rp.z, Math.random() * 6);
    this.player.stats.timeAlive = 0;
    // the respawn point can be far away: load the terrain and buildings there before placing the player
    this.ui.open('loading');
    await this._streamIn();
    this._settleSpawn(!!this.base.respawnPoint());
    this.ui.open('playing');
    bus.emit('notify', { text: 'Your body is marked on the map. Your gear is still on it.', kind: 'info' });
  }

  // ------------------------------------------------------------ interaction
  _interact(it) {
    const inv = this.player.equipment.inventory;
    switch (it.kind) {
      case 'door': it.data.door.toggle(); break;
      case 'basedoor': this.base.toggleDoor(it.data.piece); break;
      case 'container': this._openContainer(it); break;
      case 'vehicle': { const r = this.vehicles.enter(it.data.vehicle); if (!r.ok) bus.emit('notify', { text: r.msg, kind: 'info' }); else this.weapons.select(null); break; }
      case 'pump': {
        if (inv.remove('fuel_can_empty', 1)) { inv.add(ItemDB.create('fuel_can', 1)); bus.emit('notify', { text: 'Filled jerrycan with fuel', kind: 'good' }); }
        else bus.emit('notify', { text: 'You need an empty jerrycan', kind: 'info' });
        break;
      }
      case 'water': this._water(); break;
      case 'radio': { const r = this.objectives.transmit(); bus.emit('notify', { text: r.msg, kind: r.ok ? 'objective' : 'info' }); bus.emit('sound', { type: 'radio', x: it.x, y: it.y, z: it.z }); break; }
      case 'workbench': this.ui.open('craft'); break;
      case 'bedroll': bus.emit('notify', { text: 'You will respawn here if you die', kind: 'info' }); break;
      case 'toggleLight': { const pc = it.data.piece; pc.lit = !pc.lit; break; }
      case 'npc': this.npcs.interact(it.data.npc); break;
      case 'sit': {
        const pc = it.data.piece;
        const th = (pc.rot * Math.PI) / 2;
        this.player.controller.seat = { x: pc.x + Math.sin(th) * 0.05, y: pc.y + 0.05, z: pc.z + Math.cos(th) * 0.05 };
        this.player.controller.yaw = th;
        bus.emit('notify', { text: 'Sitting — move to stand up', kind: 'info', key: 'sit' });
        break;
      }
      case 'sleep': this._sleep(it.data.piece); break;
      case 'editSign': this._editSign(it.data.piece); break;
      case 'keygate': {
        const gt = it.data.gate;
        if (gt.open) { bus.emit('notify', { text: `${gt.def.name} is open`, kind: 'info' }); break; }
        if (this.player.equipment.inventory.count('keycard_launch') < 1) {
          bus.emit('sound', { type: 'uiError', ui: true });
          bus.emit('notify', { text: 'ACCESS DENIED — you need the Launch Site key card. Word is it is kept at Kessler Airfield.', kind: 'warn' });
          break;
        }
        gt.open = true;
        gt.collider.enabled = false;
        this.openGates.add(gt.id);
        bus.emit('sound', { type: 'door', x: gt.def.x, y: gt.def.y, z: gt.def.z, open: true, metal: true });
        bus.emit('notify', { text: `Key card accepted — ${gt.def.name} opening`, kind: 'good' });
        break;
      }
      case 'lift': {
        const L = it.data.lift;
        if (L.needsCard && this.player.equipment.inventory.count('keycard_launch') < 1) {
          bus.emit('sound', { type: 'uiError', ui: true });
          bus.emit('notify', { text: 'The lift panel wants a key card', kind: 'warn' });
          break;
        }
        this._ride(L.to);
        break;
      }
      case 'fuelPump': { const r = this.base.usePump(it.data.piece); bus.emit('notify', { text: r.msg, kind: r.ok ? 'good' : 'info' }); break; }
      default: break;
    }
  }

  _secondary(it) {
    const inv = this.player.equipment.inventory;
    if (it.kind === 'vehicle') {
      const r = this.vehicles.service(it.data.vehicle, inv);
      bus.emit('notify', { text: r.msg, kind: r.ok ? 'good' : 'info' });
    } else if ((it.kind === 'basedoor' || it.kind === 'container') && it.data.piece && (it.kind === 'basedoor' || it.data.piece.def.lockable)) {
      it.data.piece.locked = !it.data.piece.locked;
      bus.emit('sound', { type: 'click', ui: true });
      bus.emit('notify', { text: `${it.data.piece.def.name} ${it.data.piece.locked ? 'locked' : 'unlocked'}`, kind: 'info' });
    }
  }

  _openContainer(it) {
    const d = it.data;
    const custom = d.custom || !d.profile;
    const open = () => {
      const inv = custom ? this.loot.get(d.containerId) : this.loot.open(d.containerId, d.profile, d.capacity || 10, this.clock.gameMinutes);
      if (!inv) { bus.emit('notify', { text: 'Nothing here', kind: 'info' }); return; }
      if (!custom) this.player.skills.gain('scavenging', 0.3);
      this.ui.open('inventory', { inv, name: d.name || 'Container', id: d.containerId, onClose: () => { if (d.pile) this._refreshPile(d.pile); } });
    };
    if (custom || this.loot.containers.has(d.containerId)) { open(); return; }
    // first search of a world container takes a moment
    const time = 1.1 * (1 - this.player.skills.level('scavenging') * 0.04);
    this.interactionAction = { t: 0, time, label: `Searching ${d.name || ''}`, complete: open, pos: this.player.controller.pos.clone() };
    bus.emit('sound', { type: 'pickup', ui: true });
  }

  /** Sleep in a bed until morning when nobody hostile is close. */
  _sleep(piece) {
    const p = this.player.controller.pos;
    const threat = this.ai.agents.some((a) => a.alive && a.isEnemy(this.player.character) && Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < 90);
    if (threat) { bus.emit('notify', { text: 'You cannot sleep with enemies nearby', kind: 'warn' }); return; }
    const s = this.player.survival;
    if (s.bleeding > 0) { bus.emit('notify', { text: 'Stop the bleeding before you sleep', kind: 'warn' }); return; }
    const h = this.clock.hours;
    const hours = h >= 7 && h < 19 ? 4 : ((31 - h) % 24) || 8; // a nap by day, until 07:00 at night
    const fade = document.createElement('div');
    fade.className = 'lift-fade';
    document.body.appendChild(fade);
    setTimeout(() => {
      this.clock.gameMinutes += hours * 60;
      s.stamina = 100;
      s.health = Math.min(100, s.health + hours * 4);
      s.hunger = Math.max(5, s.hunger - hours * 2.2);
      s.thirst = Math.max(5, s.thirst - hours * 3);
      this.base._produceAll?.();
      setTimeout(() => { fade.classList.add('out'); setTimeout(() => fade.remove(), 600); }, 900);
      bus.emit('notify', { text: `You slept ${hours} hours. It is ${this.clock.label}.`, kind: 'good' });
      this.saveGame('auto', true);
    }, 650);
    void piece;
  }

  /** Write on a sign: a small text box. */
  _editSign(piece) {
    this.input.unlock();
    const box = document.createElement('div');
    box.className = 'sign-edit';
    const input = document.createElement('input');
    input.maxLength = 40;
    input.value = piece.text || '';
    input.placeholder = 'What should the sign say?';
    const hint = document.createElement('div');
    hint.textContent = 'Enter to save · Esc to cancel';
    box.append(input, hint);
    document.body.appendChild(box);
    this.input.uiCapture = true;
    input.focus();
    const done = (save) => {
      if (save) { this.base.setSignText(piece, input.value.trim()); bus.emit('sound', { type: 'build', x: piece.x, y: piece.y, z: piece.z }); }
      box.remove();
      this.input.uiCapture = this.ui.mode !== 'playing';
      if (this.ui.mode === 'playing') this.input.lock();
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.code === 'Enter') done(true); if (e.code === 'Escape') done(false); });
  }

  /** Lift ride: a short fade to black, then you step out at the other end. */
  _ride(to) {
    if (!to || this._riding) return;
    this._riding = true;
    const fade = document.createElement('div');
    fade.className = 'lift-fade';
    document.body.appendChild(fade);
    bus.emit('sound', { type: 'engineStart', x: this.player.controller.pos.x, y: this.player.controller.pos.y, z: this.player.controller.pos.z });
    setTimeout(() => {
      const pc = this.player.controller;
      // destinations on the surface give no height: stand on whatever is there
      const y = Number.isFinite(to.y) ? to.y : this.physics.groundHeight(to.x, to.z, 0.35, this.world.heightAt(to.x, to.z) + 3);
      pc.teleport(to.x, y + 0.05, to.z, to.yaw ?? pc.yaw);
      pc.vel?.set?.(0, 0, 0);
      this.envT = 0;
      setTimeout(() => { fade.classList.add('out'); setTimeout(() => { fade.remove(); this._riding = false; }, 600); }, 700);
    }, 650);
  }

  /** A ladder within reach: at its foot (climb up) or at its top (climb down). */
  _ladderNear() {
    const p = this.player.controller.pos;
    let best = null, bd = Infinity;
    for (const l of this.physics.ladders) {
      const d = Math.hypot(l.x - p.x, l.z - p.z);
      if (d > 1.6) continue;
      const atBottom = p.y < l.y0 + 1.2 && p.y > l.y0 - 0.6;
      const atTop = Math.abs(p.y - l.y1) < 0.8;
      if (!atBottom && !atTop) continue;
      if (d < bd) { bd = d; best = { ladder: l, up: atBottom && !(atTop && p.y > (l.y0 + l.y1) / 2), label: '' }; }
    }
    if (best) best.label = best.up ? 'Climb up the ladder' : 'Climb down the ladder';
    return best;
  }

  /** Press F at a ladder: straight to the other end. */
  _ladderJump() {
    const lp = this.ladderPrompt;
    if (!lp) return;
    const L = lp.ladder, pc = this.player.controller;
    if (lp.up) {
      // the platform is on the side away from the ladder's outward normal
      let x = L.x - L.nx * 0.9, z = L.z - L.nz * 0.9;
      let y = this.physics.groundHeight(x, z, 0.3, L.y1 + 0.6);
      if (Math.abs(y - L.y1) > 0.8) { x = L.x - L.nx * 0.5; z = L.z - L.nz * 0.5; y = L.y1 + 0.05; }
      pc.teleport(x, y + 0.05, z, pc.yaw);
    } else {
      const x = L.x + L.nx * 0.7, z = L.z + L.nz * 0.7;
      const y = this.physics.groundHeight(x, z, 0.3, L.y0 + 0.8);
      pc.teleport(x, y + 0.05, z, pc.yaw);
    }
    pc.onLadder = null;
    bus.emit('footstep', { x: pc.pos.x, y: pc.pos.y, z: pc.pos.z, surface: 'metal', volume: 0.6, player: true });
  }

  _water() {
    const inv = this.player.equipment.inventory;
    const empty = inv.count('empty_bottle');
    if (empty > 0) {
      inv.remove('empty_bottle', empty);
      const left = inv.add({ id: 'water_bottle', qty: empty });
      if (left) this.dropItem({ id: 'water_bottle', qty: left });
      bus.emit('notify', { text: `Filled ${empty} bottle${empty > 1 ? 's' : ''}`, kind: 'good' });
    } else {
      this.player.survival.thirst = Math.min(100, this.player.survival.thirst + 20);
      bus.emit('notify', { text: 'You drink from the water', kind: 'good' });
    }
    bus.emit('sound', { type: 'pickup', ui: true });
  }

  _lookingAtWater() {
    const cam = this.renderer.camera;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const t = this.physics.raycastTerrain(cam.position.x, cam.position.y, cam.position.z, dir.x, dir.y, dir.z, 4);
    // also hit the water surface plane
    const p = this.player.controller.pos;
    const w = this.world.waterAt(p.x + dir.x * 2, p.z + dir.z * 2) ?? this.world.waterAt(p.x, p.z);
    if (w === null) return false;
    if (dir.y > -0.2) return false;
    void t;
    return cam.position.y - w < 3.2;
  }

  // ------------------------------------------------------------ frame
  _frame(now) {
    requestAnimationFrame((t) => this._frame(t));
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    dt = clamp(dt, 0.0001, this.maxDt || 0.05);
    try {
      this.update(dt);
    } catch (e) {
      console.error('[Game] update error', e);
      this._errors = (this._errors || 0) + 1;
    }
    this.input.endFrame();
  }

  update(dt) {
    const playing = this.started && this.ui.mode !== 'menu' && this.ui.mode !== 'loading';
    if (!playing) {
      if (this.ui.mode !== 'menu' && this.ui.mode !== 'loading') this.renderer.render(dt, false);
      this.ui.update(dt);
      return;
    }
    // pause the simulation while the pause menu or settings are open
    const paused = this.ui.mode === 'pause' || this.ui.mode === 'settings';
    if (paused) {
      this.renderer.render(dt, !this.vehicles.current);
      this.ui.update(dt);
      return;
    }
    this.time += dt;
    const input = this.input;
    const gameplay = this.ui.mode === 'playing' && !this.dead;
    const pc = this.player.controller;

    // UI toggles
    if (!this.dead) this._uiKeys();

    // mouse look
    const mouse = input.consumeMouse();
    this._wheel = mouse.wheel;
    const inVeh = this.vehicles.current;
    if (gameplay && input.locked && !inVeh) {
      const ads = this.weapons.adsT > 0.5;
      const zoomMul = this.weapons.scoped ? this.renderer.camera.fov / settings.get('fov') : 1;
      pc.look(mouse.dx, mouse.dy, ads ? settings.get('adsSensitivity') * zoomMul : 1);
    }

    // player movement
    let events = {};
    pc.enabled = gameplay && !inVeh;
    if (!inVeh) {
      const surv = this.player.survival;
      events = pc.update(dt, {
        stamina: surv.stamina, canSprint: surv.canSprint, encumbrance: this.encumbrance(), pain: surv.painEffective, ads: this.weapons.adsT > 0.5,
      }) || {};
      if (events.landed && events.fall > 4) {
        const dmg = (events.fall - 4) * 9;
        if (dmg > 0) surv.damage(dmg, { cause: 'fall' });
        if (events.fall > 6) { surv.pain = Math.min(1, surv.pain + 0.4); bus.emit('notify', { text: 'You hurt your legs in the fall', kind: 'warn', key: 'fall' }); }
      }
    }
    this.vehicles.update(dt, input, gameplay ? mouse : null);
    if (inVeh && gameplay && input.hit('interact')) this.vehicles.exit(this.player);

    this.debug.update(dt);
    this.explosives.update(dt);
    this.turrets.update(dt);
    this.nightVision.update(dt);

    // survival
    const night = this.lighting.nightFactor || 0;
    const sheltered = this.indoor;
    const nearFire = this.fires.some((f) => (!f.active || f.active()) && Math.hypot(f.x - pc.pos.x, f.z - pc.pos.z) < 4);
    const holdBreath = this.weapons.scoped && input.is('sprint') && this.player.survival.stamina > 5;
    this.player.survival.update(dt * (this.player.skills ? 1 : 1), {
      sprinting: pc.sprinting, moving: pc.moving, jumped: events.jumped, swimming: pc.swimming, raining: this.weather.cur.rain > 0.2,
      sheltered, night: night > 0.5, warmthNearby: nearFire, insulation: this.player.equipment.insulation(), rainProtection: this.player.equipment.rainProtection(),
      encumbrance: this.encumbrance(), holdBreath,
    });
    if (pc.sprinting || pc.moving) this.player.skills.gain('survival', dt * 0.002);
    this.player.update(dt);

    // weapons
    const fwd = pc.forward(new THREE.Vector3());
    const eye = this.renderer.camera.position;
    let nearWall = false;
    if (!inVeh) {
      const h = this.physics.raycast(eye.x, eye.y, eye.z, fwd.x, fwd.y, fwd.z, 0.65, (c) => c.blocksMove && c.tag !== 'character' && c.tag !== 'bush', false);
      nearWall = !!h;
    }
    const allowFire = gameplay && !inVeh && !this.base.active && !pc.swimming && !this.player.survival.useAction && !pc.onLadder;
    this.weapons.update(dt, { input, controller: pc, survival: this.player.survival, allowFire, wheel: gameplay && !this.base.active ? mouse.wheel : 0, mouseDelta: mouse, nearWall, holdBreath });

    // interaction target
    this.lookTarget = null;
    this.waterPrompt = null;
    this.ladderPrompt = null;
    if (gameplay && !inVeh) {
      this.lookTarget = this.interactables.pick(eye, fwd, 2.6, (o) => {
        // visible if nothing blocks the view before reaching the object's own volume
        const dx = o.x - eye.x, dy = o.y - eye.y, dz = o.z - eye.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < 1.1) return true;
        const hit = this.physics.raycast(eye.x, eye.y, eye.z, dx / d, dy / d, dz / d, d, (c) => c.blocksMove && c.tag !== 'character' && c.material !== 'glass', true);
        return !hit || hit.t > d - 0.9;
      });
      this.ladderPrompt = this._ladderNear();
      // safety net: fell out of the world (e.g. through a gap underground)
      if (pc.pos.y < -700) { pc.teleport(pc.pos.x, this.world.heightAt(pc.pos.x, pc.pos.z) + 1, pc.pos.z, pc.yaw); this._settleSpawn(); }
      if (!this.lookTarget && this._lookingAtWater()) this.waterPrompt = this.player.equipment.inventory.count('empty_bottle') ? 'Fill bottles' : 'Drink water';
      if (!this.base.active) {
        if (input.hit('interact')) {
          if (this.interactionAction) this.interactionAction = null;
          else if (this.lookTarget) this._interact(this.lookTarget);
        }
        if (input.hit('use')) {
          if (this.lookTarget && this.secondaryLabel(this.lookTarget)) this._secondary(this.lookTarget);
          else if (this.ladderPrompt) this._ladderJump();
          else if (this.lookTarget) this._secondary(this.lookTarget);
          else if (this.waterPrompt) this._water();
        }
      }
    }
    // timed interaction (container search)
    if (this.interactionAction) {
      const a = this.interactionAction;
      a.t += dt;
      if (Math.hypot(pc.pos.x - a.pos.x, pc.pos.z - a.pos.z) > 2.5) this.interactionAction = null;
      else if (a.t >= a.time) { this.interactionAction = null; a.complete(); }
    }
    // cancel item use when sprinting
    if (this.player.survival.useAction && pc.sprinting) { this.player.survival.cancelUse(); bus.emit('notify', { text: 'Interrupted', kind: 'info' }); }

    // quick items
    if (gameplay) for (let i = 0; i < 4; i++) if (input.hit(`quick${i + 1}`)) this.player.quickUse(i);

    // building
    this._buildUpdate(gameplay, eye, fwd);

    // crafting job
    const cr = this.crafting.update(dt, (st) => this.nearStation(st), 1 / this.player.skills.mul('crafting', 'time'));
    if (cr && cr.done) {
      bus.emit('notify', { text: cr.msg, kind: cr.ok ? 'good' : 'warn' });
      if (cr.ok) this.player.skills.gain('crafting', 1);
      if (cr.leftover) this.dropItem(cr.leftover);
    }

    // simulation
    let T = performance.now();
    this.ballistics.update(dt);
    this.factions.update(dt);
    T = this._prof('ballistics', T);
    this.ai.update(dt);
    this.events.update(dt);
    this.events.tick(dt);
    T = this._prof('ai', T);
    this.base.update(dt);
    this.npcs.update(dt);
    this.objectives.update(dt);

    // world streaming
    const focus = inVeh ? inVeh.pos : pc.pos;
    T = performance.now();
    this.terrain.update(dt, focus, this.time, 0.25 + this.weather.cur.wind * 0.9);
    T = this._prof('terrain', T);
    this.infra.update(dt, focus, this.time);
    T = this._prof('infra', T);
    this.pois.update(dt, focus, this.poiBudget);
    T = this._prof('pois', T);

    // time, weather, lighting
    this.clock.update(dt);
    this.envT -= dt;
    if (this.envT <= 0) {
      this.envT = 0.25;
      const under = eye.y < UNDERGROUND_Y;
      this.lighting.underground = under;
      this.indoor = under || this.base.isSheltered(pc.freeCam ? { x: eye.x, y: eye.y - 1.7, z: eye.z } : pc.pos);
      const L = this.lighting.lightDir;
      const shadowed = !!this.physics.raycast(eye.x, eye.y, eye.z, L.x, L.y, L.z, 60, (c) => c.blocksSight && c.tag !== 'character', true);
      this.lighting.setViewShading(this.indoor, shadowed);
      audio.setIndoor(this.indoor);
      this._discovery();
    }
    this.weather.update(dt, eye, this.indoor, this.clock.scale / 24);
    this.terrain.setWet(this.weather.cur.rain * 0.9);
    this.infra.setWet(this.weather.cur.rain * 0.9);
    this.lighting.update(dt, this.clock.hours, this.weather.cur, focus, this.time);
    this.lights.update(dt, focus, night);
    for (const f of this.fires) if ((!f.active || f.active()) && Math.hypot(f.x - focus.x, f.z - focus.z) < 60 && Math.random() < dt * 20) this.effects.fireEmbers(f.x, f.y, f.z);
    this.effects.update(dt, this.renderer.camera);

    // audio
    audio.setListener(this.renderer.camera.position, this.renderer.camera.quaternion);
    const region = this.world.regionBlend(focus.x, focus.z);
    audio.update(dt, {
      wind: this.weather.cur.wind, rain: this.weather.cur.rain, night, forest: region.forest, indoor: this.indoor,
      engine: inVeh ? { on: inVeh.engineOn, rpm: Math.min(1, Math.abs(inVeh.speed) / inVeh.t.maxSpeed) } : null,
      lowHealth: this.player.survival.health < 25 ? 1 - this.player.survival.health / 25 : 0,
    });

    // post-processing grade
    const s = this.player.survival;
    this.renderer.setGrade({ damage: Math.min(1, s.damageFlash + this.player.suppression * 0.25), lowHealth: s.health < 30 ? 1 - s.health / 30 : 0, time: this.time, flash: this.weather.cur.flash * 0.25 });

    // autosave
    this.autosaveT -= dt;
    if (this.autosaveT <= 0) {
      this.autosaveT = 300;
      if (!this.dead && !inVeh) this.saveGame('auto', true);
    }

    T = performance.now();
    this.renderer.render(dt, !inVeh && !this.dead && !this.hideViewmodel);
    T = this._prof('render', T);
    this.ui.update(dt);
    this._prof('ui', T);
  }

  _prof(name, t0) {
    const now = performance.now();
    const p = this.profile || (this.profile = {});
    p[name] = (p[name] || 0) * 0.95 + (now - t0) * 0.05;
    if (now - t0 > (p[name + 'Max'] || 0)) p[name + 'Max'] = now - t0;
    return now;
  }

  _uiKeys() {
    const input = this.input;
    const mode = this.ui.mode;
    if (input.hit('pause')) {
      if (this.base.active) { this.base.exit(); return; }
      if (mode === 'playing') { this.ui.open('pause'); return; }
      if (mode === 'settings') { this.ui.settings.close(); return; }
      this.ui.close();
      return;
    }
    if (mode === 'playing' && input.hit('nvg')) this.nightVision.toggle();
    if (mode === 'playing' && !this.base.active && input.hit('throw')) {
      if (input.down.has('ShiftLeft') || input.down.has('ShiftRight')) this.explosives.cycle(); else this.explosives.throwSelected();
    }
    if (mode === 'playing' && input.hit('marker')) {
      const p = this.player.controller.pos;
      if (this.markers.length >= 30) this.markers.shift();
      this.markers.push({ x: p.x, z: p.z, label: `Marker ${this.markers.length + 1}` });
      bus.emit('notify', { text: 'Map marker placed at your position' });
    }
    const toggle = (action, m) => {
      if (!input.hit(action)) return false;
      if (mode === m) this.ui.close();
      else if (mode === 'playing' || ['inventory', 'map', 'craft', 'build', 'journal'].includes(mode)) {
        if (m === 'build' && this.vehicles.current) return true;
        this.ui.open(m);
      }
      return true;
    };
    // Tab+3 opens the debug menu; Tab alone opens the inventory when released
    if (input.pressed.has('Tab')) this._tabFrom = this._tabChord ? 'chord' : mode;
    // Tab closes an open screen at once, but opens the inventory only on release (so Tab+3 can be told apart)
    const invKey = input.pressed.has('KeyI') || (input.pressed.has('Tab') && mode !== 'playing') || (input.released.has('Tab') && !this._tabChord && this._tabFrom === 'playing' && mode === 'playing');
    if (mode === 'trade' && (input.hit('interact') || invKey)) { this.ui.close(); return; }
    if (this.base.active && invKey) { this.ui.open('build'); return; }
    if (invKey) {
      if (mode === 'inventory') this.ui.close();
      else if (mode === 'playing' || ['map', 'craft', 'build', 'journal'].includes(mode)) this.ui.open('inventory');
      return;
    }
    if (toggle('map', 'map')) return;
    if (toggle('craft', 'craft')) return;
    if (toggle('journal', 'journal')) return;
    if (input.hit('build')) {
      if (this.base.active) this.base.exit();
      else if (mode === 'build') this.ui.close();
      else if (mode === 'playing' && !this.vehicles.current) this.ui.open('build');
    }
  }

  _buildUpdate(gameplay, eye, fwd) {
    const b = this.base;
    this.buildInfo = null;
    this.basePieceTarget = null;
    if (!b.active || !gameplay) {
      if (b.ghost) b.ghost.visible = false;
      return;
    }
    const input = this.input;
    if (input.hit('rotate')) b.rotate();
    if (b.selected) {
      if (this._wheel) b.cycle(this._wheel > 0 ? 1 : -1);
      this.buildInfo = b.updatePreview(eye, fwd);
      if (input.buttonHit(0)) {
        const r = b.place();
        bus.emit('notify', { text: r.ok ? `${r.piece.def.name} placed` : r.msg, kind: r.ok ? 'good' : 'warn', key: 'build' });
      }
    } else {
      if (b.ghost) b.ghost.visible = false;
      this.basePieceTarget = b.pieceAt(eye, fwd);
      const pc = this.basePieceTarget;
      if (pc && input.hit('interact')) { const r = b.repair(pc); bus.emit('notify', { text: r.msg, kind: r.ok ? 'good' : 'info' }); }
      if (pc && input.hit('use')) { const r = b.dismantle(pc); bus.emit('notify', { text: r.msg, kind: r.ok ? 'good' : 'warn' }); }
      if (pc && input.hit('reload')) { const r = b.pickUp(pc); bus.emit('notify', { text: r.msg, kind: r.ok ? 'good' : 'warn' }); }
    }
    if (input.buttonHit(2)) b.exit();
  }

  _discovery() {
    const p = this.player.controller.pos;
    for (const q of this.world.pois) {
      if (this.discovered.has(q.id)) continue;
      if (Math.hypot(q.x - p.x, q.z - p.z) < q.radius + 140) {
        this.discovered.add(q.id);
        bus.emit('poi:discovered', q);
      }
    }
    const N = this.fog.size, cell = 16384 / N;
    const ci = Math.floor((p.x + 8192) / cell), cj = Math.floor((p.z + 8192) / cell);
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      if (di * di + dj * dj <= 5) this.fog.data[j * N + i] = 1;
    }
  }

  // ------------------------------------------------------------ debug / test API
  _debugApi() {
    const game = this;
    return {
      game,
      state() {
        const p = game.player.controller.pos;
        return {
          mode: game.ui.mode, started: game.started, pos: { x: p.x, y: p.y, z: p.z }, health: game.player.survival.health,
          fps: game.renderer.fps, calls: game.renderer.stats.calls, tris: game.renderer.stats.triangles, chunks: game.terrain.near.size,
          farTiles: game.terrain.far.size, pois: [...game.pois.active.keys()], ai: game.ai.alive().length, errors: game._errors || 0,
          weapon: game.weapons.hudInfo(), time: game.clock.label, base: game.base.pieces.size, objective: game.objectives.current?.id,
          profile: Object.fromEntries(Object.entries(game.profile || {}).map(([k, v]) => [k, Math.round(v * 10) / 10])),
        };
      },
      teleport(x, z, yaw = 0) {
        const y = game.physics.groundHeight(x, z, 0.3, game.world.heightAt(x, z) + 50);
        game.player.controller.teleport(x, y + 0.05, z, yaw);
      },
      give(id, qty = 1) { return game.player.equipment.inventory.add(ItemDB.create(id, qty)); },
      equip(id) {
        const inv = game.player.equipment.inventory;
        inv.add(ItemDB.create(id, 1));
        const i = inv.find((s) => s.id === id);
        const r = game.player.equipment.equipFromInventory(i);
        if (r.ok && ['primary', 'shoulder', 'sidearm', 'melee'].includes(r.slot)) game.weapons.select(r.slot);
        return r;
      },
      setTime(h) { game.clock.gameMinutes = Math.floor(game.clock.gameMinutes / 1440) * 1440 + h * 60; },
      weather(s) { game.weather.set(s, true); },
      spawn(profile, dist = 40, role) {
        const p = game.player.controller.pos;
        const yaw = game.player.controller.yaw;
        const x = p.x - Math.sin(yaw) * dist, z = p.z - Math.cos(yaw) * dist;
        return game.ai.spawnSquad([profile], x, z, { role });
      },
      look(yaw, pitch = 0) { game.player.controller.yaw = yaw; game.player.controller.pitch = pitch; },
      key(code, down) { game.input.simulate(code, down); },
      mouse(button, down) { if (down) { game.input.mouse.buttons.add(button); game.input.mouse.pressedButtons.add(button); } else game.input.mouse.buttons.delete(button); },
      frames(n = 2) { return new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }); },
      gameSeconds(sec) { const t = game.time + sec; return new Promise((res) => { const f = () => { if (game.time >= t) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }); },
      heal() { const sv = game.player.survival; if (sv.dead || game.dead) return false; sv.health = 100; sv.bleeding = 0; sv.pain = 0; return true; },
      /** Photo camera: cam(x, y, z, tx, ty, tz) with y values absolute; cam(null) returns control. */
      cam(x, y, z, tx, ty, tz) {
        const pc = game.player.controller;
        if (x === null || x === undefined) { pc.freeCam = null; return; }
        const dx = tx - x, dy = ty - y, dz = tz - z;
        pc.freeCam = { x, y, z, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
      },
      ground(x, z) { return game.world.heightAt(x, z); },
      photo(on = true) {
        game.ui.hud.show(!on);
        game.hideViewmodel = on;
        game.clock.paused = on;
        document.body.classList.toggle('photo', on);
        if (on) { game.player.survival.damage = () => 0; game.poiBudget = 400; } else game.poiBudget = undefined;
      },
      busy() { return game.terrain.backlog + (game.pois.building ? 1 : 0); },
      setMaxDt(v) { game.maxDt = Math.min(0.15, Math.max(0.02, v)); },
      forcePlaying() { game.ui.mode = 'playing'; game.input.uiCapture = false; game.ui.hud.show(true); game.ui._hideAll(); },
    };
  }
}
