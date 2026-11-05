import * as THREE from 'three';
import { ItemDB } from '../items/ItemDatabase.js';
import { Inventory } from '../items/Inventory.js';
import { effectiveWeapon, fireInterval } from '../weapons/WeaponData.js';
import { computeDamage } from '../combat/DamageSystem.js';
import { CharacterModel } from './CharacterModel.js';
import { HeadlessModel } from './HeadlessModel.js';
import { doctrineFor } from './Doctrine.js';
import { clamp, angleWrap, RNG } from '../core/MathUtil.js';
import { bus } from '../core/EventBus.js';
import { randomCone } from '../weapons/WeaponController.js';

// A human AI combatant.
//
// Layers, from slow to fast:
//  * Doctrine (Doctrine.js) — how the faction fights: disciplined / aggressive / cautious.
//  * Squad (Squad.js) — shared contacts, fire-and-movement orders, morale, search plans.
//  * State machine (_think) — idle, patrol, scav, investigate, combat, search, retreat,
//    hide, loot, return, raid, travel.
//  * Combat decisions (_combatThink, ~3 Hz) — cover, peeking, flanking, suppression,
//    advancing, reloading, holding a defended area, breaking contact.
//  * Combat tick (every frame) — turning, aiming and firing, which only happens when the
//    agent faces the target, has a clear line of fire and is not sprinting.
//  * Movement — A* paths on a local grid around real colliders, door opening, separation,
//    and stuck recovery (side-step, re-path, give up and blacklist the goal).
// AI uses the same weapons, ammunition, ballistics and damage model as the player.

const RADIUS = 0.33;
const EYE = 1.62;
const _v = new THREE.Vector3();
const hyp = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

let _id = 0;

export class AIAgent {
  constructor(mgr, opts) {
    this.mgr = mgr;
    this.game = mgr.game;
    this.id = `npc${++_id}`;
    this.colliderOwner = this.id;
    this.isAI = true;
    this.profile = opts.profile;
    this.faction = opts.profile.faction;
    this.doctrine = doctrineFor(this.faction, opts.profile);
    this.role = opts.role || opts.profile.role;
    this.squad = opts.squad || null;
    this.poiId = opts.poiId || null;
    this.home = opts.home || { x: opts.x, z: opts.z, radius: 40 };
    this.post = opts.post || { x: opts.x, z: opts.z, yaw: opts.yaw || 0 };
    this.route = opts.route || null;
    this.routeIdx = 0;
    this.rng = new RNG(opts.seed || Math.floor(Math.random() * 1e9));
    const diff = this.game.settings.get('aiDifficulty');
    const sk = opts.profile.skill;
    this.skill = {
      accuracy: clamp(sk.accuracy * (0.85 + diff * 0.15), 0.05, 0.98),
      reaction: sk.reaction / Math.max(0.5, diff),
      courage: sk.courage, cover: sk.cover, flank: sk.flank, suppress: sk.suppress,
    };
    this.maxHealth = opts.profile.health;
    this.health = this.maxHealth;
    this.alive = true;
    this.morale = 1;
    this.pos = new THREE.Vector3(opts.x, opts.y, opts.z);
    this.vel = new THREE.Vector3();
    this.yaw = opts.yaw || 0;
    this.desiredYaw = this.yaw;
    this.stance = 'stand';
    this.state = opts.state || this._defaultStateFor(this.role);
    this.stateT = 0;
    this.tactic = null;
    this.tacticT = 0;
    this.order = null;
    this.thinkT = this.rng.next() * 0.3;
    this.perceiveT = this.rng.next() * 0.25;
    this.combatThinkT = 0;
    this.awareness = new Map(); // character -> 0..1.2
    this.contacts = new Map(); // character -> {x,y,z,vx,vz,seen,heard,conf}
    this.target = null;
    this.lastKnown = null;
    this.lastSeen = -999;
    this.targetVisible = false;
    this.suppression = 0;
    this.path = null;
    this.pathIdx = 0;
    this.pathReq = null;
    this.moveMode = 'walk';
    this.dest = null;
    this._moveOpts = {};
    this.cover = null;
    this.peekT = 0;
    this.exposed = false;
    this.peeks = 0;
    this.fruitlessPeeks = 0;
    this.burstLeft = 0;
    this.nextShot = 0;
    this.aimSettle = 1;
    this.reloading = 0;
    this.cycle = 0;
    this.lastShotT = -99;
    this.progress = { t: 0, x: opts.x, z: opts.z, level: 0 };
    this.badGoals = [];
    this.bleeding = 0;
    this.time = 0;
    this.attackers = new Map();
    this.lod = 0;
    this.carried = 0;
    this.lightOn = false;
    this.removed = false;
    this.invTarget = null;
    this.overwatch = false;
    this.seenBodies = new Set();
    this.shootOnMove = false;

    // equipment from profile
    const P = opts.profile;
    this.inventory = new Inventory(24, 'Body');
    const wid = opts.weapon || this.rng.pick(P.weapons);
    this.primary = ItemDB.create(wid, 1);
    const pw = ItemDB.weapon(wid);
    this.primary.data.cond = 0.5 + this.rng.next() * 0.45;
    if (pw.defaultAttach) this.primary.data.attach = { ...pw.defaultAttach };
    if (pw.magSize) {
      this.primary.data.ammo = pw.magSize;
      const mags = this.rng.int(P.mags[0], P.mags[1]);
      this.inventory.add({ id: pw.ammo, qty: Math.min(ItemDB.stackMax(pw.ammo) * 2, pw.magSize * mags) });
    }
    if (P.sidearm && ItemDB.weapon(P.sidearm)) {
      this.sidearm = ItemDB.create(P.sidearm, 1);
      const sw = ItemDB.weapon(P.sidearm);
      this.sidearm.data.ammo = sw.magSize;
      this.inventory.add({ id: sw.ammo, qty: sw.magSize * 2 });
    }
    this.weapon = this.primary;
    this.w = effectiveWeapon(this.weapon);
    this.armor = { head: 0, torso: 0 };
    this.armorItems = [];
    for (const [item, chance] of Object.entries(P.armor || {})) {
      if (this.rng.next() < chance) {
        const e = ItemDB.get(item)?.equip;
        if (!e) continue;
        for (const z of e.zones || []) this.armor[z] = Math.max(this.armor[z], e.armor);
        this.armorItems.push(item);
      }
    }
    for (const d of P.drops || []) if (this.rng.next() < 0.45) this.inventory.add(ItemDB.create(d, 1));
    this.hasFlashlight = this.rng.next() < (this.faction === 'vsf' ? 0.8 : 0.45);

    // visuals
    const F = this.game.factions.get(this.faction);
    const skins = ['#c9a080', '#a87c5c', '#8a6040', '#d8b49a', '#6e4a32'];
    const look = {
      uniform: F.uniform, accent: F.accent, skin: this.rng.pick(skins),
      helmet: this.armorItems.includes('helmet_mil'), helmetColor: '#4a5236',
      vest: this.armorItems.some((i) => i.startsWith('vest')), pack: this.rng.next() < 0.5,
      cap: !this.armorItems.includes('helmet_mil') && this.rng.next() < 0.5 ? this.rng.pick(['#3a3a30', '#2a2a2a', '#5a4a3a']) : null,
      mask: this.faction === 'wolves' && this.rng.next() < 0.6, gloves: '#2a2622',
    };
    this.model = this.game.headless ? new HeadlessModel() : new CharacterModel(look, this.game.materials);
    this.model.setWeapon(this.weapon.id, this.weapon.data.attach);
    this.model.root.position.copy(this.pos);
    this.game.renderer.scene.add(this.model.root);
    this.flashlightCone = null;

    this.game.characters.add(this);
  }

  // ------------------------------------------------------------ character interface
  get eye() { return _v.set(this.pos.x, this.pos.y + (this.stance === 'crouch' ? 1.1 : EYE), this.pos.z); }
  get firedRecently() { return this.time - this.lastShotT < 1.5; }
  get D() { return this.doctrine; }

  _tactic(type, extra = {}) {
    this.tactic = type;
    this.tacticT = 0;
    bus.emit('ai:tactic', { type, agent: this, ...extra });
  }

  onHit(info) {
    if (!this.alive) return;
    const zoneArmor = info.zone === 'head' ? this.armor.head : info.zone === 'torso' ? this.armor.torso : 0;
    const dmg = computeDamage({ ...info, armor: zoneArmor });
    this.health -= dmg;
    this.model.flinch = 1;
    this.suppression = clamp(this.suppression + 0.5, 0, 1);
    this.morale = Math.max(0, this.morale - dmg / 320);
    if (dmg > 12 && this.rng.next() < 0.35) this.bleeding = Math.min(3, this.bleeding + 1);
    this._lastHitT = this.time;
    const shooter = info.shooter;
    if (shooter && shooter !== this) {
      this.attackers.set(shooter, this.time);
      if (shooter.isPlayer && shooter.faction === 'player') this.game.factions.onPlayerAttack(this.faction, this.health <= 0);
      // the shot came from somewhere: rough idea of where
      const d = hyp(shooter.pos.x, shooter.pos.z, this.pos.x, this.pos.z);
      const acc = clamp(1 - d / 220, 0.3, 0.8);
      this._learn(shooter, this._fuzz(shooter.pos, (1 - acc) * 14), acc);
      this.squad?.report(this, shooter, shooter.pos, acc * 0.8);
      this._callout('hit');
    }
    bus.emit('npc:hurt', { agent: this, zone: info.zone, dmg });
    if (this.health <= 0) this.die(info);
  }

  onSuppressed(info) {
    if (!this.alive) return;
    this.suppression = clamp(this.suppression + (info.distance < 1.5 ? 0.3 : 0.18), 0, 1);
    // being shot at wears people down, but only so fast
    if (this.time - (this._supMoraleT || -99) > 0.5) { this._supMoraleT = this.time; this.morale = Math.max(0, this.morale - 0.012); }
    const s = info.shooter;
    if (s && s !== this && (this.isEnemy(s) || this.attackers.has(s))) {
      // the crack of a passing bullet gives the direction, the thump the distance — roughly
      const d = hyp(s.pos.x, s.pos.z, this.pos.x, this.pos.z);
      this._learn(s, this._fuzz(s.pos, clamp(d * 0.12, 3, 25)), 0.35);
    }
  }

  /** Compatibility entry point (events, tests): become aware of a character. */
  _reveal(ch, accuracy = 1) {
    if (!ch || ch === this) return;
    const err = (1 - accuracy) * 12;
    this._learn(ch, this._fuzz(ch.pos, err), accuracy >= 1 ? 1 : Math.min(0.9, accuracy));
    this.awareness.set(ch, Math.max(this.awareness.get(ch) || 0, accuracy >= 1 ? 1 : 0.6));
  }

  _fuzz(p, err) {
    return { x: p.x + (this.rng.next() - 0.5) * 2 * err, y: p.y, z: p.z + (this.rng.next() - 0.5) * 2 * err };
  }

  die(info) {
    this.alive = false;
    this.health = 0;
    this.state = 'dead';
    this.path = null;
    this.game.characters.remove(this);
    const d = info?.dir;
    let dir = 1, side = 0;
    if (d) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      dir = d.x * fx + d.z * fz > 0 ? -1 : 1; // shot from behind -> fall forward
      side = (this.rng.next() - 0.5) * 2;
    }
    this.model.die(dir, side);
    this._dropLoot();
    if (this.flashlightCone) this.flashlightCone.visible = false;
    if (this.squad?.suppressor === this) this.squad.suppressor = null;
    bus.emit('npc:died', { agent: this, killer: info?.shooter, zone: info?.zone });
    this.squad?.onMemberDied(this, info?.shooter);
    // a scream and a falling body are heard nearby
    this.mgr.emitSound({ x: this.pos.x, y: this.pos.y, z: this.pos.z, radius: 40, source: this, type: 'death' });
  }

  _dropLoot() {
    const inv = new Inventory(24, 'Body');
    const cond = (s) => { s.data.cond = Math.max(0.2, (s.data.cond ?? 0.6) * (0.8 + this.rng.next() * 0.2)); return s; };
    inv.add(cond(this.primary));
    if (this.sidearm) inv.add(cond(this.sidearm));
    for (const s of this.inventory.slots) if (s) inv.add(s);
    for (const a of this.armorItems) if (this.rng.next() < 0.6) inv.add(ItemDB.create(a, 1));
    this.corpseInventory = inv;
    this.mgr.registerCorpse(this, inv);
  }

  /** Is the given character an enemy to this agent? */
  isEnemy(ch) {
    if (!ch || !ch.alive || ch === this) return false;
    if (ch === this.game.player?.character && this.game.debug?.flags.invisible) return false;
    if (this.attackers.has(ch) && this.time - this.attackers.get(ch) < 120) return true;
    const f = ch.faction;
    if (f === this.faction) return false;
    if (f === 'player') return this.game.factions.hostile(this.faction, 'player');
    return this.game.factions.hostile(this.faction, f);
  }

  // ------------------------------------------------------------ states
  _defaultStateFor(role) {
    return role === 'patrol' ? 'patrol' : role === 'scav' ? 'scav' : 'idle';
  }

  _defaultState() {
    if (this.role === 'patrol' && this.route) return 'patrol';
    if (this.role === 'scav') return 'scav';
    if (this.role === 'raider' && this.raidTarget) return 'raid';
    return 'idle';
  }

  _enter(state) {
    if (this.state === state) return;
    const prev = this.state;
    this.state = state;
    this.stateT = 0;
    this.path = null;
    this.pathReq = null;
    this.dest = null;
    this._moveOpts = {};
    this._lookAround = null;
    this.overwatch = false;
    this._resumeSearch = false;
    this._resumeDest = null;
    if (state !== 'combat') {
      this.cover = null;
      this.exposed = false;
      this.tactic = null;
      if (this.order?.type !== 'retreat') this.order = null;
      if (this.squad) { this.squad.flankers.delete(this); if (this.squad.suppressor === this) this.squad.suppressor = null; }
    }
    if (state === 'combat' && prev !== 'combat') {
      this.aimSettle = 0.35 + this.skill.reaction * 1.2;
      this.peeks = 0;
      this.fruitlessPeeks = 0;
      this.tactic = null;
    }
    if (state !== 'search') this.searchPoint = null;
  }

  /** Defended area (guards, garrisons) beyond which the agent will not chase. */
  _leash() {
    if (!this.garrisonOf && this.role !== 'guard' && this.role !== 'sniper' && this.role !== 'defender') return null;
    if (this.state === 'retreat') return null;
    return { x: this.home.x, z: this.home.z, r: Math.max(25, this.home.radius * this.D.leash) };
  }

  _inLeash(p, extra = 0) {
    const L = this._leash();
    return !L || hyp(p.x, p.z, L.x, L.z) <= L.r + extra;
  }

  // ------------------------------------------------------------ update
  update(dt, distToPlayer) {
    if (this.mountedOn) {
      this.model.root.position.copy(this.pos);
      return;
    }
    if (!this.alive) {
      this.model.animate(dt, {});
      return;
    }
    this.time += dt;
    this.stateT += dt;
    this.tacticT += dt;
    this.suppression = Math.max(0, this.suppression - dt * 0.35);
    // morale recovers when nobody is shooting at us, faster in cover or out of the fight
    if (this.suppression < 0.2) this.morale = Math.min(1, this.morale + dt * (this.state !== 'combat' || this._atCover() ? 0.025 : 0.01));
    if (this.aimSettle > 0) this.aimSettle = Math.max(0, this.aimSettle - dt);
    if (this.cycle > 0) this.cycle -= dt;
    const prevLod = this.lod;
    this.lod = distToPlayer < 160 ? 0 : distToPlayer < 420 ? 1 : 2;
    if (prevLod === 2 && this.lod < 2) this._unembed();

    if (this.bleeding) {
      this.health -= dt * 0.35 * this.bleeding;
      if (this.health <= 0) { this.die({}); return; }
      // bandage when safe
      if (this.state !== 'combat' || (this.cover && !this.exposed && !this.targetVisible)) {
        this._bandageT = (this._bandageT || 0) + dt;
        if (this._bandageT > 4) { this.bleeding = 0; this._bandageT = 0; }
      }
    }

    this.perceiveT -= dt;
    if (this.perceiveT <= 0) {
      const iv = this.lod === 0 ? 0.2 : this.lod === 1 ? 0.5 : 1.4;
      this.perceiveT = iv;
      this._perceive(iv);
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = this.lod === 0 ? 0.18 : this.lod === 1 ? 0.45 : 1.2;
      this._think();
    }
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) this._finishReload();
    }
    if (this.state === 'combat') {
      this.combatThinkT -= dt;
      if (this.combatThinkT <= 0) {
        this.combatThinkT = (this.lod === 0 ? 0.3 : 0.7) + this.rng.next() * 0.15;
        this._combatThink();
      }
      if (this.state === 'combat') this._combatTick(dt);
    }
    this._move(dt);
    this._animate(dt);
  }

  // ------------------------------------------------------------ perception
  _visionRange() {
    const L = this.game.lighting;
    const ambient = L ? L.ambientLevel : 1;
    const weather = this.game.weather ? this.game.weather.visibility : 1;
    const base = (this.role === 'sniper' ? 260 : 150) * (0.7 + this.skill.accuracy * 0.4);
    return base * clamp(0.18 + ambient * 0.95, 0.18, 1) * weather;
  }

  _perceive(dt) {
    const range = this._visionRange();
    const eye = this.eye.clone();
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const alertState = this.state === 'combat' || this.state === 'search' || this.state === 'investigate';
    const halfFov = alertState ? 1.65 : 1.15;
    const night = (this.game.lighting?.nightFactor || 0) > 0.5;
    let best = null, bestScore = 0;
    let sawTarget = false;
    for (const ch of this.game.characters.list) {
      if (ch === this || !ch.alive) continue;
      const dx = ch.pos.x - this.pos.x, dz = ch.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > Math.max(range * 2.5, 30)) continue;
      if (!this.isEnemy(ch)) continue;
      let r = range;
      // a lit flashlight is visible from very far at night; muzzle flashes give shooters away
      if (night && ch.lightOn) r = Math.max(r, 320);
      if (night && ch.firedRecently) r = Math.max(r, 220);
      if (night && this.lightOn && d < 45) r = Math.max(r, 45);
      if (d > r && d > 3) { this._decayAwareness(ch, dt); continue; }
      const ang = Math.acos(clamp((dx * fx + dz * fz) / Math.max(0.001, d), -1, 1));
      if (ang > halfFov && d > 4) { this._decayAwareness(ch, dt); continue; }
      // line of sight to chest or head
      const ty = ch.pos.y + (ch.stance === 'prone' ? 0.3 : ch.stance === 'crouch' ? 1.0 : 1.4);
      if (!this.game.physics.lineOfSight(eye.x, eye.y, eye.z, ch.pos.x, ty, ch.pos.z, this.id)) {
        this._decayAwareness(ch, dt);
        continue;
      }
      let rate = (1 - d / (r + 1)) * 4.5 + (d < 8 ? 3 : 0);
      rate *= ch.stance === 'prone' ? 0.3 : ch.stance === 'crouch' ? 0.6 : 1;
      const moving = ch.vel ? Math.hypot(ch.vel.x, ch.vel.z) > 0.5 : false;
      rate *= moving ? 1.35 : 0.7;
      if (ch.firedRecently) rate *= 3;
      if (alertState) rate *= 1.6;
      rate *= 1 - ang / 3.2;
      rate /= Math.max(0.3, this.skill.reaction * 1.4);
      const known = this.contacts.get(ch);
      if (known && this.time - known.seen < 6) rate *= 4; // re-acquiring someone we just saw is quick
      const a = Math.min(1.2, (this.awareness.get(ch) || 0) + rate * dt);
      this.awareness.set(ch, a);
      if (a >= 1) {
        const score = 1 / (d + 1) + (ch === this.target ? 0.5 : 0) + (this.attackers.has(ch) ? 0.2 : 0);
        if (score > bestScore) { bestScore = score; best = ch; }
        // every fully seen enemy updates our picture
        this._learn(ch, ch.pos, 1, ch.vel);
        if (ch === this.target) sawTarget = true;
      } else if (a > 0.35 && this.state !== 'combat' && this.state !== 'retreat' && this.state !== 'hide') {
        // suspicious: turn and investigate
        this.investigate({ x: ch.pos.x, z: ch.pos.z }, 'suspicious');
      }
    }
    if (best && (!sawTarget || best !== this.target)) {
      // switch to a clearly better target only
      if (!sawTarget || !this.target || bestScore > 0.6) this._setTarget(best);
      sawTarget = best === this.target;
    }
    const was = this.targetVisible;
    this.targetVisible = sawTarget;
    if (sawTarget) {
      if (!was && this.time - this.lastSeen > 3) this.aimSettle = Math.max(this.aimSettle, 0.25 + this.skill.reaction * 0.7);
      this.lastSeen = this.time;
      const t = this.target;
      if (!this._lastReport || this.time - this._lastReport > 0.6) {
        this._lastReport = this.time;
        this.squad?.report(this, t, t.pos, 1, t.vel);
      }
    }
    if (this.lod === 0 && this.state !== 'combat' && this.state !== 'retreat') this._seeBodies(eye);
  }

  _decayAwareness(ch, dt) {
    const a = this.awareness.get(ch);
    if (a) this.awareness.set(ch, Math.max(0, a - dt * 0.15));
  }

  /** Spotting a dead teammate puts the squad on alert. */
  _seeBodies(eye) {
    for (const c of this.mgr.corpses) {
      const a = c.agent;
      if (this.seenBodies.has(a) || a.faction !== this.faction) continue;
      const d = hyp(a.pos.x, a.pos.z, this.pos.x, this.pos.z);
      if (d > 30) continue;
      if (!this.game.physics.lineOfSight(eye.x, eye.y, eye.z, a.pos.x, a.pos.y + 0.3, a.pos.z, this.id)) continue;
      this.seenBodies.add(a);
      this.morale = Math.max(0, this.morale - 0.06);
      this._tactic('body-found');
      this._callout('body');
      this.squad?.alert(this, { x: a.pos.x, z: a.pos.z }, 'body');
      this.investigate({ x: a.pos.x, z: a.pos.z }, 'body');
      return;
    }
  }

  /** Update knowledge of an enemy. accuracy 1 = seen now. */
  _learn(enemy, pos, accuracy, vel = null) {
    if (!enemy || !enemy.alive || enemy === this) return;
    let c = this.contacts.get(enemy);
    if (!c) { c = { x: pos.x, y: pos.y ?? enemy.pos.y, z: pos.z, vx: 0, vz: 0, seen: -999, heard: -999, conf: 0 }; this.contacts.set(enemy, c); }
    const fresh = accuracy >= 1;
    // don't overwrite a recent sighting with a worse guess
    if (fresh || this.time - c.seen > 2.5 || accuracy > c.conf) {
      c.x = pos.x; c.z = pos.z; c.y = pos.y ?? c.y;
      c.conf = accuracy;
      if (vel) { c.vx = vel.x; c.vz = vel.z; }
    }
    if (fresh) c.seen = this.time; else c.heard = this.time;
    if (!this.target || !this.target.alive || (fresh && !this.targetVisible) || (enemy === this.target)) {
      if (!this.target || !this.target.alive || this.target !== enemy) this._setTarget(enemy);
    }
    if (enemy === this.target) {
      this.lastKnown = { x: c.x, y: c.y, z: c.z };
      if (fresh) this.lastSeen = this.time;
    }
    this._onContact(enemy, accuracy);
  }

  _setTarget(enemy) {
    this.target = enemy;
    const c = this.contacts.get(enemy);
    if (c) this.lastKnown = { x: c.x, y: c.y, z: c.z };
    this.lastSeen = c ? c.seen : -999;
  }

  /** Contact reported by a teammate. */
  receiveContact(enemy, pos, accuracy, from) {
    if (!enemy?.alive || !this.isEnemy(enemy) && !(from && from.attackers?.has(enemy))) return;
    if (this.contacts.get(enemy)?.seen > this.time - 1) return; // we can see it ourselves
    this._learn(enemy, this._fuzz(pos, (1 - accuracy) * 6), Math.min(0.9, accuracy));
  }

  /** Decide how to react to a (new) contact. */
  _onContact(enemy, accuracy) {
    const s = this.state;
    if (s === 'combat' || s === 'retreat' || s === 'loot' && this._lootUrgent) return;
    if (!this._usable()) {
      // nothing to fight with: get away from it
      if (s !== 'hide') this.orderRetreat(null, enemy.pos);
      return;
    }
    if (this.D.id === 'cautious' && s !== 'combat') {
      const d = hyp(enemy.pos.x, enemy.pos.z, this.pos.x, this.pos.z);
      const attacked = this.attackers.has(enemy) && this.time - this.attackers.get(enemy) < 20;
      // survivors avoid fights they didn't start unless the enemy is on top of them
      if (!attacked && d > 28) {
        if (s !== 'hide') this._avoid(enemy.pos, 'contact');
        return;
      }
    }
    if (s === 'raid' && hyp(enemy.pos.x, enemy.pos.z, this.pos.x, this.pos.z) > 60 && accuracy < 1) return;
    this._enter('combat');
    this._tactic('contact', { accuracy });
    this._callout('contact');
    if (accuracy >= 1) bus.emit('npc:spotted', { agent: this, target: enemy });
  }

  /** Called by the manager for audible events. info: {occluded, intensity}. */
  hear(ev, dist, info = {}) {
    if (!this.alive || ev.source === this) return;
    const src = ev.source;
    const occluded = !!info.occluded;
    const errBase = clamp(dist * (occluded ? 0.22 : 0.12), 2, 45);
    const hostile = src && this.isEnemy(src);
    const friendly = src && !hostile && src.faction === this.faction;
    if (ev.type === 'gunshot') {
      if (friendly) {
        // a teammate is shooting: support if idle
        if (this.state !== 'combat' && src.target && this.state !== 'retreat' && this.state !== 'hide') {
          this.investigate({ x: src.pos.x, z: src.pos.z }, 'support');
        }
        return;
      }
      const p = this._fuzz({ x: ev.x, y: ev.y, z: ev.z }, errBase);
      if (this.state === 'combat') {
        // hearing where a hidden enemy fires from keeps our picture current
        if (src && hostile && this.contacts.has(src) && this.time - this.contacts.get(src).seen > 1) this._learn(src, p, clamp(0.7 - dist / 300, 0.25, 0.6));
        return;
      }
      if (this.state === 'retreat') return;
      // an enemy firing nearby is a contact, not a curiosity: take cover first, then close in
      if (hostile && dist < 50 && !occluded) { this._learn(src, p, 0.45); return; }
      if (hostile && dist < 150 && this.D.id !== 'cautious') { this._learn(src, p, clamp(0.45 - dist / 400, 0.12, 0.4)); this.squad?.report(this, src, p, 0.3); return; }
      const style = this.D.distantGunfire;
      if (style === 'avoid' && !(hostile && dist < 30)) { this._avoid(p, 'gunfire'); return; }
      this.squad?.alert(this, p, 'gunfire');
      this.investigate(p, 'gunfire');
      return;
    }
    if (friendly) return;
    // footsteps, doors and voices of people we're not hostile to are not suspicious
    if (src && !hostile && ev.type !== 'death') return;
    const p = this._fuzz({ x: ev.x, y: ev.y, z: ev.z }, errBase * 0.5);
    if (this.state === 'combat') {
      // footsteps of a hidden target give its position away
      if (hostile && src === this.target && !this.targetVisible) this._learn(src, p, clamp(0.75 - dist / 60, 0.3, 0.65));
      return;
    }
    if (this.state === 'retreat') return;
    if (ev.type === 'footstep' || ev.type === 'melee' || ev.type === 'door' || ev.type === 'glass' || ev.type === 'voice' || ev.type === 'death' || ev.type === 'impact') {
      if (this.D.id === 'cautious' && ev.type !== 'footstep' && ev.type !== 'door' && dist > 20) { this._avoid(p, ev.type); return; }
      this.investigate(p, ev.type === 'death' ? 'casualty' : 'noise');
    }
  }

  /** Squad told us to check something. */
  onSquadAlert(point, reason) {
    if (this.state === 'combat' || this.state === 'retreat') return;
    if (this.D.id === 'cautious' && (reason === 'gunfire' || reason === 'casualty')) { this._avoid(point, reason); return; }
    this.investigate(point, reason === 'gunfire' || reason === 'body' || reason === 'casualty' ? reason : 'support');
  }

  investigate(p, reason) {
    const s = this.state;
    if (s === 'combat' || s === 'retreat' || s === 'raid' || s === 'hide' || s === 'loot') return;
    if (s === 'investigate' && this.investigatePoint && hyp(this.investigatePoint.x, this.investigatePoint.z, p.x, p.z) < 6) return;
    if (s === 'search' && reason === 'noise' && this.searchPoint && hyp(this.searchPoint.x, this.searchPoint.z, p.x, p.z) < 10) return;
    if (!this._usable() && reason !== 'suspicious') return;
    // defenders hold their area: they watch from a defensive position instead of walking out
    const L = this._leash();
    let target = { x: p.x, z: p.z };
    let defend = false;
    if (L && hyp(p.x, p.z, L.x, L.z) > L.r) {
      defend = true;
      const dx = p.x - L.x, dz = p.z - L.z, d = Math.hypot(dx, dz) || 1;
      target = { x: L.x + (dx / d) * L.r * 0.7, z: L.z + (dz / d) * L.r * 0.7 };
    }
    this._enter('investigate');
    this.investigateReason = reason;
    this.investigatePoint = { x: p.x, z: p.z };
    this.investigateDefend = defend;
    this._lookAt(p);
    this._tactic('investigate', { reason });
    const style = this.D.investigate;
    const mode = reason === 'suspicious' ? 'walk' : style === 'rush' || reason === 'support' ? 'run' : style === 'careful' ? 'walk' : 'run';
    if (defend) {
      const c = this._findCover([{ x: p.x, y: this.pos.y, z: p.z }], { from: target, searchRadius: 18, preferred: hyp(p.x, p.z, target.x, target.z) });
      this.moveTo(c || target, 'run', { cover: c });
      if (c) this.cover = c;
    } else this.moveTo(target, mode);
  }

  /** Cautious behaviour: put distance and cover between us and a threat. */
  _avoid(p, reason) {
    if (this.state === 'combat' || this.state === 'retreat') return;
    if (this.state === 'hide' && this.hideFrom) {
      // already hiding: just stay down longer unless the danger is now much closer
      const dOld = hyp(this.hideFrom.x, this.hideFrom.z, this.pos.x, this.pos.z), dNew = hyp(p.x, p.z, this.pos.x, this.pos.z);
      if (dNew > dOld * 0.6 || this.stateT < 6) { this.hideUntil = Math.max(this.hideUntil, this.time + 15); return; }
    }
    this._enter('hide');
    this.hideFrom = { x: p.x, y: this.pos.y, z: p.z };
    this.hideUntil = this.time + 25 + this.rng.next() * 20;
    this._tactic('avoid', { reason });
    const dx = this.pos.x - p.x, dz = this.pos.z - p.z, d = Math.hypot(dx, dz) || 1;
    const away = { x: this.pos.x + (dx / d) * 25, z: this.pos.z + (dz / d) * 25 };
    const c = this._findCover([this.hideFrom], { from: away, searchRadius: 22, minFromThreat: d + 5, preferred: d + 30, needPeek: false });
    this.cover = c;
    this.moveTo(c || away, d < 60 ? 'run' : 'walk', { threat: this.hideFrom });
  }

  _lookAt(p) {
    this.desiredYaw = Math.atan2(-(p.x - this.pos.x), -(p.z - this.pos.z));
  }

  _callout(kind) {
    if (!this.D.callouts || this.lod > 0) return;
    if (this._lastCallout && this.time - this._lastCallout < 3) return;
    this._lastCallout = this.time;
    // shouting carries: allies hear it, and so does anyone else nearby
    this.mgr.emitSound({ x: this.pos.x, y: this.pos.y + 1.6, z: this.pos.z, radius: 35, source: this, type: 'voice', kind });
    bus.emit('npc:callout', { agent: this, kind });
  }

  // ------------------------------------------------------------ think (non-combat states)
  _think() {
    const s = this.state;
    // flashlights at night; disciplined units kill lights in a fight
    const night = (this.game.lighting?.nightFactor || 0) > 0.6;
    this.lightOn = this.hasFlashlight && night && s !== 'retreat' && s !== 'hide' && (s !== 'combat' || this.D.flashlightInCombat);
    if (s === 'combat') return;
    if (s === 'idle') {
      this.stance = 'stand';
      const dp = hyp(this.pos.x, this.pos.z, this.post.x, this.post.z);
      if (dp > 2.5 && !this.path && !this.pathReq) {
        this.moveTo(this.post, 'walk', { onFail: () => { this.post = { x: this.pos.x, z: this.pos.z, yaw: this.yaw }; } });
      } else if (dp <= 2.5 && this.rng.next() < 0.08) this.desiredYaw = (this.post.yaw ?? this.yaw) + (this.rng.next() - 0.5) * 2.4;
      // guards occasionally shift within their area
      if (this.role === 'guard' && this.rng.next() < 0.01) {
        const a = this.rng.next() * Math.PI * 2, r = this.rng.next() * this.home.radius * 0.5;
        const p = this.mgr.freeSpot(this.home.x + Math.cos(a) * r, this.home.z + Math.sin(a) * r);
        if (p) this.post = { x: p.x, z: p.z, yaw: this.rng.next() * Math.PI * 2 };
      }
    } else if (s === 'patrol') {
      this.stance = 'stand';
      if (!this.route || !this.route.length) { this._enter('idle'); return; }
      const wp = this.route[this.routeIdx % this.route.length];
      if (hyp(this.pos.x, this.pos.z, wp.x, wp.z) < 3) {
        this.routeIdx++;
        this._pauseUntil = this.rng.next() < 0.3 ? this.time + 3 + this.rng.next() * 4 : 0;
        this.path = null;
      }
      if (this._pauseUntil > this.time) { this.desiredYaw = this.yaw + Math.sin(this.time) * 0.6; return; }
      if (!this.path && !this.pathReq) {
        this.moveTo(this.route[this.routeIdx % this.route.length], 'walk', { onFail: () => { this.routeIdx++; } });
      }
    } else if (s === 'scav') {
      this._scavThink();
    } else if (s === 'investigate') {
      this._investigateThink();
    } else if (s === 'search') {
      this._searchThink();
    } else if (s === 'return') {
      this.stance = 'stand';
      const back = this._defaultState();
      const tgt = back === 'patrol' && this.route ? this.route[this.routeIdx % this.route.length] : this.post;
      if (hyp(this.pos.x, this.pos.z, tgt.x, tgt.z) < 4 || this.stateT > 90) { this._enter(back); return; }
      if (!this.path && !this.pathReq) this.moveTo(tgt, 'walk', { onFail: () => { this.post = { x: this.pos.x, z: this.pos.z, yaw: this.yaw }; this._enter(back); } });
    } else if (s === 'retreat') {
      this._retreatThink();
    } else if (s === 'hide') {
      this._hideThink();
    } else if (s === 'loot') {
      this._lootThink();
    } else if (s === 'raid') {
      this._raidThink();
    } else if (s === 'travel') {
      this.stance = 'stand';
      const t = this.travelTarget;
      if (!t || hyp(this.pos.x, this.pos.z, t.x, t.z) < 8) {
        if (this.onArrive) { const f = this.onArrive; this.onArrive = null; f(this); }
        else this._enter('idle');
        return;
      }
      if (!this.path && !this.pathReq) {
        // long legs are split into ~60 m path segments
        const dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz);
        const step = Math.min(d, 60);
        this.moveTo({ x: this.pos.x + (dx / d) * step, z: this.pos.z + (dz / d) * step }, this.travelMode || 'walk');
      }
    }
  }

  _investigateThink() {
    const p = this.investigatePoint;
    if (!p) { this._enter(this._defaultState()); return; }
    const style = this.D.investigate;
    const careful = style === 'careful' || this.investigateReason === 'suspicious';
    this.stance = careful || this.overwatch ? 'crouch' : 'stand';
    // fireteam bounding: the overwatch element stops and watches while the mover advances
    if (this.overwatch && this.stateT > 1) {
      if (this.path) { this._resumeDest = this.dest; this.path = null; this.pathReq = null; }
      this._lookAt(p);
      return;
    }
    if (!this.overwatch && this._resumeDest && !this.path && !this.pathReq) { this.moveTo(this._resumeDest, 'run'); this._resumeDest = null; }
    const d = hyp(this.pos.x, this.pos.z, p.x, p.z);
    const arrived = this.investigateDefend ? !this.path && !this.pathReq && this.stateT > 1 : d < 5;
    if (arrived || this.stateT > 50 || (!this.path && !this.pathReq && this.stateT > 2 && !this._resumeDest)) {
      if (!this._lookAround) { this._lookAround = this.time + (this.investigateDefend ? 25 : 6); this.path = null; }
      this.desiredYaw = Math.atan2(-(p.x - this.pos.x), -(p.z - this.pos.z)) + Math.sin(this.time * 0.8) * (this.investigateDefend ? 0.5 : 1.4);
      if (this.investigateDefend) this.stance = 'crouch';
      if (this.time > this._lookAround) {
        this._lookAround = null;
        const r = this.investigateReason;
        // signs of a fight: search the area properly (not for guards holding their ground)
        if ((r === 'gunfire' || r === 'body' || r === 'casualty') && !this.investigateDefend && this.D.id !== 'cautious') this._beginSearch(p, null);
        else this._enter('return');
      }
    } else if (careful && !this.path && !this.pathReq) {
      this.moveTo(p, 'walk');
    }
  }

  // ------------------------------------------------------------ searching
  _beginSearch(lkp, vel) {
    this._enter('search');
    this._tactic('search');
    this.searchCenter = { x: lkp.x, z: lkp.z };
    if (this.squad) this.squad.planSearch(lkp, vel);
    else this._selfPlan = { points: this._ownSearchPoints(lkp, vel), i: 0 };
    this.searchPoint = null;
  }

  _ownSearchPoints(lkp, vel) {
    const pts = [{ x: lkp.x, z: lkp.z, look: 4 }];
    if (vel && Math.hypot(vel.x, vel.z) > 0.5) { const s = Math.hypot(vel.x, vel.z); pts.push({ x: lkp.x + vel.x / s * 12, z: lkp.z + vel.z / s * 12, look: 3 }); }
    for (const p of this.mgr.hidingSpots(lkp, 20, 3)) pts.push({ ...p, look: 3 });
    return pts;
  }

  _searchThink() {
    this.stance = 'stand';
    if (this.stateT > this.D.searchTime) { this._enter('return'); return; }
    // fireteam search: the overwatch element stops and covers the area while the other moves
    if (this.overwatch && this.searchCenter && this.stateT > 1) {
      if (this.path) { this._resumeSearch = true; this.path = null; this.pathReq = null; }
      this.stance = 'crouch';
      this.desiredYaw = Math.atan2(-(this.searchCenter.x - this.pos.x), -(this.searchCenter.z - this.pos.z)) + Math.sin(this.time * 0.7) * 0.5;
      return;
    }
    if (this._resumeSearch && this.searchPoint && !this.path && !this.pathReq) {
      this._resumeSearch = false;
      this.moveTo(this.searchPoint, 'walk', { threat: this._searchThreat() });
    }
    let p = this.searchPoint;
    if (!p) {
      p = this.squad ? this.squad.claimSearchPoint(this) : this._selfPlan?.points[this._selfPlan.i++];
      while (p && !this._inLeash(p, 5)) { this.squad?.releaseSearchPoint(p); p = this.squad ? this.squad.claimSearchPoint(this) : this._selfPlan?.points[this._selfPlan.i++]; }
      if (!p) {
        // plan exhausted: one last sweep around the centre, then give up
        if (this.stateT > 12 || !this.searchCenter) { this._enter('return'); return; }
        const a = this.rng.next() * Math.PI * 2, r = 6 + this.rng.next() * 10;
        p = { x: this.searchCenter.x + Math.cos(a) * r, z: this.searchCenter.z + Math.sin(a) * r, look: 2 };
      }
      this.searchPoint = p;
      this._searchLookUntil = null;
      const d = hyp(p.x, p.z, this.pos.x, this.pos.z);
      // approach out of the sightlines of the last known position
      this.moveTo(p, d > 25 ? 'run' : 'walk', { threat: this._searchThreat(), onFail: () => { this.squad?.releaseSearchPoint(p); this.searchPoint = null; } });
      return;
    }
    const d = hyp(p.x, p.z, this.pos.x, this.pos.z);
    if (d < 2.5 || (!this.path && !this.pathReq)) {
      if (!this._searchLookUntil) { this._searchLookUntil = this.time + (p.look || 3); this.path = null; this._lookBase = this.yaw; }
      // sweep the weapon across the area
      this.desiredYaw = this._lookBase + Math.sin((this.time - this._searchLookUntil) * 1.3) * 1.6;
      if (this.time > this._searchLookUntil) {
        this.squad?.releaseSearchPoint(p);
        this.searchPoint = null;
      }
    } else if (this.searchCenter && hyp(this.pos.x, this.pos.z, this.searchCenter.x, this.searchCenter.z) < 25) {
      // close to where the enemy was: weapon up, crouched, slow
      this.stance = 'crouch';
      this.moveMode = 'walk';
      this.desiredYaw = Math.atan2(-(this.searchCenter.x - this.pos.x), -(this.searchCenter.z - this.pos.z));
    }
  }

  _searchThreat() {
    const c = this.searchCenter;
    return c ? { x: c.x, y: this.game.world.heightAt(c.x, c.z), z: c.z } : null;
  }

  // ------------------------------------------------------------ retreat, hide, loot
  /** Fall back toward a rally point (or away from the threat). */
  orderRetreat(rally, threat) {
    if (!this.alive || this.state === 'dead') return;
    // a squad-wide fall-back doesn't make someone turn their back on an enemy a few metres away
    if (this.state === 'combat' && this.targetVisible && this.target && this._usable()
      && hyp(this.target.pos.x, this.target.pos.z, this.pos.x, this.pos.z) < 14) {
      bus.emit('ai:tactic', { type: 'cornered-fight', agent: this });
      return;
    }
    this._lastRetreat = this.time;
    this._enter('retreat');
    this.order = { type: 'retreat', rally, threat: threat ? { x: threat.x, y: threat.y ?? this.pos.y, z: threat.z } : null, t: this.time };
    this._tactic('retreat', { rally: !!rally });
    this._callout('retreat');
    this._retreatGoal = null;
    this._regroupUntil = null;
  }

  _retreatThink() {
    const o = this.order || { threat: this.lastKnown };
    const threat = o.threat || this.lastKnown || this.pos;
    this.stance = 'stand';
    if (this._regroupUntil) {
      // regroup: crouch in cover, bandage, top up the magazine
      this.stance = 'crouch';
      this._lookAt(threat);
      if (this.reloading <= 0 && this.w.magSize && this.weapon.data.ammo < this.w.magSize && this._reserve() > 0) this._startReload();
      if (this.time < this._regroupUntil) return;
      this._regroupUntil = null;
      this.order = null;
      this.morale = Math.min(1, this.morale + 0.3);
      this._lastRetreat = this.time;
      const known = this.target?.alive ? this.contacts.get(this.target) : null;
      const strong = this.health > this.maxHealth * 0.45 && this.morale > 0.35 && this._usable();
      if (this.D.id === 'cautious' || !this._usable()) { this.hideFrom = threat; this._enter('hide'); this.hideUntil = this.time + 30 + this.rng.next() * 30; return; }
      if (known && strong && (this.D.rallyAfterRetreat || this.D.id === 'aggressive') && this.time - Math.max(known.seen, known.heard) < 40) {
        this._enter('combat');
        this._tactic('re-engage');
        return;
      }
      this._enter(this.D.id === 'disciplined' && known ? 'search' : 'return');
      if (this.state === 'search') this._beginSearch(known, null);
      return;
    }
    if (!this._retreatGoal) {
      let goal = o.rally;
      const dx = this.pos.x - threat.x, dz = this.pos.z - threat.z, d = Math.hypot(dx, dz) || 1;
      if (!goal) goal = { x: this.pos.x + (dx / d) * 40, z: this.pos.z + (dz / d) * 40 };
      const c = this._findCover([threat], { from: goal, searchRadius: 20, minFromThreat: Math.min(d + 12, 80), needPeek: false });
      this._retreatGoal = c || goal;
      this.cover = c;
      this.moveTo(this._retreatGoal, 'sprint', {
        threat,
        onFail: () => { this._retreatGoal = { x: this.pos.x + (dx / d) * 15, z: this.pos.z + (dz / d) * 15 }; this.moveTo(this._retreatGoal, 'sprint'); },
      });
      return;
    }
    const arrived = hyp(this.pos.x, this.pos.z, this._retreatGoal.x, this._retreatGoal.z) < 2.5 || (!this.path && !this.pathReq && this.stateT > 1.5);
    if (arrived || this.stateT > 20) this._regroupUntil = this.time + 4 + this.rng.next() * 3;
  }

  _hideThink() {
    this.stance = this.path ? 'stand' : 'crouch';
    if (this.hideFrom) this.desiredYaw = Math.atan2(-(this.hideFrom.x - this.pos.x), -(this.hideFrom.z - this.pos.z));
    if (this.time > (this.hideUntil || 0)) {
      this.hideFrom = null;
      // out of ammunition: look for some on the dead before anything else
      if (!this._usable() && this._seekAmmo()) return;
      this._enter(this.role === 'scav' ? 'scav' : 'return');
    }
  }

  /** Find a body with ammunition we can use. Returns true if we are going for it. */
  _seekAmmo(urgent = false) {
    const c = this.mgr.lootableCorpse(this, 70);
    if (!c) return false;
    this._enter('loot');
    this.lootTarget = c;
    this._lootUrgent = urgent;
    this._tactic('loot-body', { urgent });
    this.moveTo(c.agent.pos, urgent ? 'run' : 'walk', { onFail: () => { c.blocked = this.time; this.lootTarget = null; } });
    return true;
  }

  _lootThink() {
    const c = this.lootTarget;
    if (!c || !c.inv) { this.lootTarget = null; this._enter(this._usable() ? 'return' : 'hide'); this.hideUntil = this.time + 20; return; }
    const d = hyp(this.pos.x, this.pos.z, c.agent.pos.x, c.agent.pos.z);
    if (d > 1.8) {
      if (!this.path && !this.pathReq) this.moveTo(c.agent.pos, 'run', { onFail: () => { c.blocked = this.time; this.lootTarget = null; } });
      return;
    }
    this.stance = 'crouch';
    this.path = null;
    if (!this._lootUntil) { this._lootUntil = this.time + 2.5 + this.rng.next() * 1.5; return; }
    if (this.time < this._lootUntil) return;
    this._lootUntil = null;
    this._takeFrom(c.inv);
    c.looted = (c.looted || 0) + 1;
    this.lootTarget = null;
    if (this.target?.alive && this._usable()) { this._enter('combat'); return; }
    this._enter(this.role === 'scav' ? 'scav' : 'return');
  }

  /** Take ammunition, medical supplies and, if ours is useless, a working gun. */
  _takeFrom(inv) {
    const ammoIds = new Set([this.w.ammo, this.sidearm ? ItemDB.weapon(this.sidearm.id).ammo : null].filter(Boolean));
    let took = 0;
    // swap to a gun from the body that has ammunition if ours has none
    if (!this._usable()) {
      for (let i = 0; i < inv.slots.length; i++) {
        const s = inv.slots[i];
        if (!s) continue;
        const def = ItemDB.weapon(s.id);
        if (!def || !def.magSize) continue;
        const reserve = inv.count(def.ammo) + (s.data?.ammo || 0);
        if (reserve <= 0) continue;
        inv.slots[i] = null;
        inv.add(this.primary);
        this.equipWeapon(s, true);
        ammoIds.add(def.ammo);
        took++;
        break;
      }
    }
    for (let i = 0; i < inv.slots.length; i++) {
      const s = inv.slots[i];
      if (!s) continue;
      const def = ItemDB.get(s.id);
      const want = ammoIds.has(s.id) || (def.cat === 'medical' && this.carried < 8) || (this.D.lootDead > 0.8 && this.carried < 8 && (def.cat === 'food' || def.cat === 'misc'));
      if (!want) continue;
      if (inv.transfer(i, this.inventory)) { took++; this.carried++; }
    }
    bus.emit('npc:looted', { agent: this, container: 'body', taken: took });
    return took;
  }

  // ------------------------------------------------------------ scavenging
  _scavThink() {
    this.stance = 'stand';
    if (this._searching) {
      this.desiredYaw = this.yaw;
      if (this.time < this._searching) return;
      this._searching = 0;
      const c = this.invTarget;
      if (c) {
        const inv = this.game.loot.open(c.id, c.profile, c.capacity || 10, this.game.clock.gameMinutes);
        let taken = 0;
        for (let i = 0; i < inv.slots.length && taken < 2 && this.carried < 6; i++) {
          const s = inv.slots[i];
          if (!s) continue;
          const def = ItemDB.get(s.id);
          const useful = (def.cat === 'ammo' && s.id === this.w.ammo) || ['medical', 'food', 'drink', 'misc'].includes(def.cat) || (def.cat === 'weapon' && this.rng.next() < 0.4);
          if (!useful) continue;
          if (inv.transfer(i, this.inventory)) { taken++; this.carried++; }
        }
        this.visited.add(c.id);
        bus.emit('npc:looted', { agent: this, container: c.id, taken });
      }
      this.invTarget = null;
      return;
    }
    if (!this.visited) this.visited = new Set();
    // the dead are worth checking first
    if (this.D.lootDead > 0.5 && this.rng.next() < 0.1 && this._seekAmmo(false)) return;
    if (this.invTarget) {
      const c = this.invTarget;
      if (hyp(this.pos.x, this.pos.z, c.x, c.z) < 1.8) {
        this._searching = this.time + 3 + this.rng.next() * 2;
        this.path = null;
        this.desiredYaw = Math.atan2(-(c.x - this.pos.x), -(c.z - this.pos.z));
        return;
      }
      if (!this.path && !this.pathReq) {
        if ((this._scavFails = (this._scavFails || 0) + 1) > 3) { this.visited.add(c.id); this.invTarget = null; this._scavFails = 0; return; }
        this.moveTo(c, 'walk', { onFail: () => { this.visited.add(c.id); this.invTarget = null; } });
      }
      return;
    }
    // choose next container in our POI
    const rt = this.poiId ? this.game.pois.active.get(this.poiId) : null;
    const options = rt ? rt.containers.filter((c) => c.id && !this.visited.has(c.id) && hyp(c.x, c.z, this.home.x, this.home.z) < this.home.radius * 1.4) : [];
    if (options.length && this.carried < 6) {
      // nearest few, so scavengers work through a building instead of zig-zagging the town
      options.sort((a, b) => hyp(a.x, a.z, this.pos.x, this.pos.z) - hyp(b.x, b.z, this.pos.x, this.pos.z));
      this.invTarget = options[Math.min(options.length - 1, this.rng.int(0, 2))];
      this._scavFails = 0;
      this.moveTo(this.invTarget, 'walk', { onFail: () => { this.visited.add(this.invTarget?.id); this.invTarget = null; } });
    } else if (!this.path && !this.pathReq) {
      // done here: wander, sometimes leave for another location
      if (this.rng.next() < 0.03 && this.mgr.relocate(this)) return;
      const a = this.rng.next() * Math.PI * 2, r = this.rng.next() * this.home.radius;
      const p = this.mgr.freeSpot(this.home.x + Math.cos(a) * r, this.home.z + Math.sin(a) * r);
      if (p) this.moveTo(p, 'walk');
      if (this.visited.size && this.rng.next() < 0.1) this.visited.clear();
    }
  }

  // ------------------------------------------------------------ raiding a player base
  _raidThink() {
    const base = this.raidTarget;
    if (!base) { this._enter('return'); return; }
    this.stance = 'stand';
    const d = hyp(this.pos.x, this.pos.z, base.x, base.z);
    if (this._breach && this._breach.alive) {
      const p = this._breach;
      const dp = hyp(this.pos.x, this.pos.z, p.x, p.z);
      if (dp > 3) { if (!this.path && !this.pathReq) this.moveTo({ x: p.x + p.nx * 2, z: p.z + p.nz * 2 }, 'run'); return; }
      this.path = null;
      this.desiredYaw = Math.atan2(-(p.x - this.pos.x), -(p.z - this.pos.z));
      this._attackStructure = p;
      return;
    }
    this._attackStructure = null;
    if (d < 6) {
      const crate = this.game.base?.nearestStorage(this.pos, 30, true);
      if (crate) {
        if (hyp(this.pos.x, this.pos.z, crate.x, crate.z) < 2) {
          const inv = crate.inventory;
          for (let i = 0; i < inv.slots.length && this.carried < 8; i++) if (inv.slots[i] && inv.transfer(i, this.inventory)) this.carried++;
          bus.emit('notify', { text: 'Your base storage is being looted!', kind: 'warn', key: 'raidloot' });
        } else if (!this.path && !this.pathReq) this.moveTo(crate, 'run');
      } else if (this.stateT > 30) { this.raidTarget = null; this._enter('return'); }
      return;
    }
    if (!this.path && !this.pathReq) {
      this.moveTo(base, 'run', { onFail: () => {
        this._breach = this.game.base?.breachPoint(this.pos, base) || null;
        if (!this._breach) { this.raidTarget = null; this._enter('return'); }
      } });
    }
  }

  // ------------------------------------------------------------ ammunition
  _reserve(w = this.w) { return w.ammo ? this.inventory.count(w.ammo) : 0; }
  _ammoTotal() { return (this.weapon.data.ammo || 0) + this._reserve(); }

  /** Can this agent fight at all (any weapon with any ammunition)? */
  _usable() {
    if (!this.w.magSize) return true;
    if (this._ammoTotal() > 0) return true;
    if (this.sidearm && this.sidearm !== this.weapon) {
      const sw = ItemDB.weapon(this.sidearm.id);
      if ((this.sidearm.data.ammo || 0) + this.inventory.count(sw.ammo) > 0) return true;
    }
    return false;
  }

  equipWeapon(stack, fromLoot = false) {
    if (!fromLoot && stack.id === this.primary?.id) return;
    const def = ItemDB.weapon(stack.id);
    if (stack.data.ammo === undefined) stack.data.ammo = def.magSize || 0;
    this.primary = stack;
    this.weapon = stack;
    this.w = effectiveWeapon(stack);
    this.model.setWeapon(stack.id, stack.data.attach);
    this.reloading = 0;
  }

  _switchToSidearm() {
    if (!this.sidearm || this.weapon === this.sidearm) return false;
    const sw = ItemDB.weapon(this.sidearm.id);
    if ((this.sidearm.data.ammo || 0) + this.inventory.count(sw.ammo) <= 0) return false;
    this.weapon = this.sidearm;
    this.w = effectiveWeapon(this.weapon);
    this.model.setWeapon(this.weapon.id, this.weapon.data.attach);
    this.reloading = 0;
    this.cycle = 0.6; // drawing takes a moment
    this._tactic('sidearm');
    return true;
  }

  _startReload() {
    if (!this.w.magSize || this.reloading > 0) return false;
    const reserve = this._reserve();
    if (reserve <= 0) return false;
    if (this.weapon.data.ammo >= this.w.magSize) return false;
    this.reloading = (this.w.reloadType === 'single' ? (this.w.reloadStart || 0.4) + this.w.reloadTime * Math.min(reserve, this.w.magSize - this.weapon.data.ammo) : this.w.reloadTime) * (1.1 - this.skill.accuracy * 0.2);
    this.exposed = false;
    this.burstLeft = 0;
    bus.emit('npc:reload', { agent: this });
    if (this.state === 'combat') { this.squad?.onReload(this); this._callout('reload'); }
    return true;
  }

  _finishReload() {
    const need = this.w.magSize - this.weapon.data.ammo;
    const got = this.inventory.remove(this.w.ammo, need);
    this.weapon.data.ammo += got;
    this.reloading = 0;
  }

  // ------------------------------------------------------------ squad orders
  canSuppress() {
    if (!this.alive || this.state !== 'combat' || !this.w.magSize) return false;
    if (this.tactic === 'flank' || this.tactic === 'retreat' || this.tactic === 'break-los') return false;
    // only with enough ammunition to spare
    if (this._ammoTotal() <= this.w.magSize * (this.w.class === 'lmg' ? 0.3 : 1.2)) return false;
    // and only from somewhere that can put rounds near the enemy (standing or crouched)
    const c = this.target && this.contacts.get(this.target);
    if (!c) return false;
    const p = { x: c.x, y: (c.y ?? this.pos.y) + 1.0, z: c.z };
    return this._canHit(p, 0.75);
  }

  suppressScore() {
    let s = this._ammoTotal() / Math.max(1, this.w.magSize);
    if (this.w.class === 'lmg') s += 6;
    if (this.w.fireModes?.includes('auto')) s += 2;
    if (this._atCover()) s += 1.5;
    if (this.reloading > 0) s -= 3;
    return s;
  }

  orderSuppress(enemy, pos, duration) {
    this.order = { type: 'suppress', enemy, pos: { ...pos }, until: this.time + duration };
    this._tactic('suppress');
  }

  canFlank() {
    if (this.tactic === 'flank' || this.reloading > 0 || !this._usable()) return false;
    if (this.health < this.maxHealth * 0.5) return false;
    return this.skill.flank > 0.05 && this.role !== 'sniper' && this.w.class !== 'lmg';
  }

  /** Move around the enemy's side, along a route the enemy cannot see. */
  orderFlank(enemy, pos, side = null) {
    const p = this._flankPoint(pos, this._preferredRange(), side);
    if (!p) return false;
    this.flankSide = p.side;
    this.order = { type: 'flank', enemy, pos: { ...pos }, until: this.time + 30 };
    this.cover = p.cover || null;
    this._tactic('flank', { side: p.side });
    this.moveTo(p, 'sprint', {
      threat: { x: pos.x, y: pos.y ?? this.pos.y, z: pos.z },
      maxExposure: this.D.id === 'aggressive' ? 0.6 : 0.4,
      onArrive: () => { if (this.tactic === 'flank') { this.tactic = 'engage'; this.order = null; } },
      onFail: () => { if (this.tactic === 'flank') { this.tactic = null; this.order = null; this.squad?.flankers.delete(this); } },
    });
    return true;
  }

  // ------------------------------------------------------------ combat decisions (~3 Hz)
  _threats() {
    const out = [];
    for (const [e, c] of this.contacts) {
      if (!e.alive) { this.contacts.delete(e); continue; }
      if (this.time - Math.max(c.seen, c.heard) > 30) continue;
      out.push({ x: c.x, y: (c.y ?? this.pos.y), z: c.z, e, t: Math.max(c.seen, c.heard) });
    }
    out.sort((a, b) => (a.e === this.target ? -1 : b.e === this.target ? 1 : b.t - a.t));
    return out.slice(0, 3);
  }

  _combatThink() {
    let t = this.target;
    if (!t || !t.alive) {
      // pick the freshest other contact
      let best = null, bt = -Infinity;
      for (const [e, c] of this.contacts) { if (!e.alive) continue; const tt = Math.max(c.seen, c.heard); if (tt > bt) { bt = tt; best = e; } }
      if (best && this.time - bt < 25) { this._setTarget(best); t = best; }
      else { this._afterCombat(); return; }
    }
    const D = this.D;
    const c = this.contacts.get(t);
    const visible = this.targetVisible;
    // time since we last had any information (sight, sound, a teammate's report)
    const since = this.time - Math.max(c?.seen ?? -999, c?.heard ?? -999, visible ? this.time : -999);
    const tp = visible ? t.pos : (c || this.lastKnown || t.pos);
    const dist = hyp(tp.x, tp.z, this.pos.x, this.pos.z);
    const threats = this._threats();
    const preferred = this._preferredRange();
    const atCover = this._atCover();

    // --- ammunition
    if (!this._usable()) {
      this._tactic('out-of-ammo');
      if (!(visible && dist < 40) && this._seekAmmo(true)) return;
      this.orderRetreat(this.squad?.rally || null, tp);
      return;
    }
    if (this.w.magSize && this.weapon.data.ammo <= 0 && this._reserve() <= 0) {
      if (this._switchToSidearm()) return;
    }

    // --- self-preservation. Turning your back on an enemy a few metres away gets you shot:
    // when cornered, fight.
    const cornered = visible && dist < 14;
    const recentlyRetreated = this.time - (this._lastRetreat ?? -99) < 25;
    if (!cornered && !recentlyRetreated) {
      if (this.health < this.maxHealth * D.retreatHealth && !this._woundCheck) {
        this._woundCheck = true;
        if (this.rng.next() > this.skill.courage * 0.8) { this.orderRetreat(this.squad?.rally || null, tp); return; }
      }
      if (this.morale < 0.15 && this.suppression > 0.4 && this.rng.next() < 0.35) { this.orderRetreat(this.squad?.rally || null, tp); return; }
    }
    if (D.id === 'cautious' && !visible && since > 6) {
      // survivors use any pause in the shooting to slip away
      this._avoid(tp, 'disengage');
      return;
    }

    // --- orders from the squad
    if (this.order && this.order.until && this.time > this.order.until) {
      if (this.order.type === 'suppress' && this.squad?.suppressor === this) this.squad.suppressor = null;
      this.order = null;
      if (this.tactic === 'suppress' || this.tactic === 'flank') this.tactic = null;
    }
    if (this.order?.type === 'flank' && (this.path || this.pathReq)) {
      // keep running the flank unless we bump into the enemy up close
      if (!(visible && dist < 18)) return;
      this.path = null; this.order = null; this.tactic = 'engage';
    }

    // --- reloading
    if (this.reloading > 0) {
      // get into cover for it if there is some close by
      if (!atCover && !this.path && !this.pathReq && visible && this.time - (this._reloadMoveT ?? -99) > 5) { this._reloadMoveT = this.time; this._takeCover(threats, preferred, 10, 'reload-move'); }
      return;
    }
    const mag = this.weapon.data.ammo || 0;
    if (this.w.magSize && mag <= 0) {
      // duck into cover first if it is a step away, otherwise reload right here
      if (!atCover && visible && !this.path && !this.pathReq && this.time - (this._reloadMoveT ?? -99) > 5) {
        this._reloadMoveT = this.time;
        this._startReload();
        this._takeCover(threats, preferred, 6, 'reload-move');
        return;
      }
      if (!this.path && !this.pathReq) this._startReload();
      else if (this.time - (this._reloadMoveT ?? -99) > 3) this._startReload();
      return;
    }
    if (this.w.magSize && !visible && mag < this.w.magSize * D.reloadAt && since > 1.5) { this._startReload(); return; }

    // --- moving somewhere already: let it finish unless the situation changed
    if (this.path || this.pathReq) {
      if (this.tactic === 'cover-move' || this.tactic === 'advance' || this.tactic === 'reload-move' || this.tactic === 'reposition') {
        if (this.tacticT < 12) return;
      }
      if (this.tacticT < 6) return;
      this.path = null;
    }

    // --- lost contact
    const searchDelay = D.searchDelay;
    if (!visible && since > searchDelay && this.order?.type !== 'suppress') {
      if (!this._inLeash(tp, 5)) {
        // defenders don't leave their area to chase: hold a defensive position facing the threat
        if (this.tactic !== 'hold') {
          this._tactic('hold');
          if (!atCover) this._takeCover(threats, preferred, 20, 'hold');
        }
        if (since > searchDelay + 30) this._afterCombat();
        return;
      }
      // search, if the enemy isn't long gone
      if (since > searchDelay + D.chase) { this._afterCombat(); return; }
      this._beginSearch(tp, c ? { x: c.vx, z: c.vz } : null);
      return;
    }

    // --- positioning
    const coverBad = atCover && (this._coverCompromised(threats) || this.fruitlessPeeks > 3);
    // taking fire from someone we can't see, out in the open: anything beats staying put
    const underFire = this.time - (this._lastHitT ?? -99) < 3 || this.suppression > 0.55;
    if (!visible && underFire && (!atCover || coverBad) && !this.path && !this.pathReq) {
      if (this._takeCover(threats, preferred, 35, 'break-los')) return;
      if (this._breakLos(tp)) return;
    }
    if (visible) {
      if (atCover && !coverBad) {
        // peek-and-shoot from cover; advance if we are winning (aggressive)
        if (dist > preferred * 1.5 && this.rng.next() < D.advance * 0.4 && this._winning() && this._advance(tp, threats, preferred)) return;
        return;
      }
      // exposed: get to cover (doctrine and skill decide how strongly)
      const wantCover = coverBad || this.suppression > 0.35 || this.rng.next() < D.coverUse * (0.4 + this.skill.cover * 0.6);
      if (wantCover && this._takeCover(threats, preferred, Math.min(20, Math.max(8, dist * 0.6)), coverBad ? 'reposition' : 'cover-move')) return;
      if (dist > preferred * 1.4 && this.rng.next() < D.advance && this._winning() && this._advance(tp, threats, preferred)) return;
      if (this.tactic !== 'engage') this._tactic('engage');
      this.stance = dist > 14 ? 'crouch' : 'stand';
      return;
    }
    // not visible right now
    if (this.order?.type === 'suppress') {
      // need a spot that can actually put rounds on the enemy's position
      if (!this._canHit(this._suppressPoint(this.order.pos), 0.7) && !this.path) {
        const cv = this._findCover(threats, { searchRadius: 12, preferred, fireAt: this.order.pos });
        if (cv) { this.cover = cv; this.moveTo(cv, 'run'); this._tactic('reposition'); }
      }
      return;
    }
    if (!atCover || coverBad) {
      if (this._takeCover(threats, preferred, 16, coverBad ? 'reposition' : 'cover-move')) return;
    }
    if (since > 2.5 && D.id === 'aggressive' && this.rng.next() < D.advance * 0.5) {
      // raiders push on to where the enemy was, or swing around alone
      if (this.rng.next() < D.flank * 0.5 && this.canFlank() && this.orderFlank(t, tp)) { this.squad?.flankers.add(this); return; }
      if (this._advance(tp, threats, preferred * 0.6)) return;
    }
    if (this.tactic !== 'hold' && this.tactic !== 'peek') this._tactic(atCover ? 'peek' : 'hold');
  }

  /** Move to cover. Returns true if a move started. */
  _takeCover(threats, preferred, radius, tag) {
    if (!threats.length) return false;
    const L = this._leash();
    const c = this._findCover(threats, { searchRadius: radius, preferred, leash: L });
    if (!c) return false;
    if (this.cover && hyp(c.x, c.z, this.cover.x, this.cover.z) < 1 && (this._atCover() || this.path || this.pathReq)) return false;
    this.cover = c;
    this.peekT = 0.4;
    this.peeks = 0;
    this.fruitlessPeeks = 0;
    const d = hyp(c.x, c.z, this.pos.x, this.pos.z);
    // shoot on the move only at walking pace
    this.shootOnMove = d > 4 && this.rng.next() < this.D.shootOnMove && this.targetVisible;
    this.moveTo(c, this.shootOnMove ? 'run' : d < 6 ? 'run' : 'sprint', { threat: threats[0], cover: c });
    this._tactic(tag);
    return true;
  }

  /** No cover anywhere near: get out of the shooter's line of sight (sideways and back). */
  _breakLos(tp) {
    const dx = this.pos.x - tp.x, dz = this.pos.z - tp.z, d = Math.hypot(dx, dz) || 1;
    const side = this.rng.next() < 0.5 ? -1 : 1;
    const phys = this.game.physics, world = this.game.world;
    const ty = (tp.y ?? this.pos.y) + 1.4;
    for (const [back, lat] of [[8, 12], [14, 6], [4, 16], [18, -8]]) {
      const x = this.pos.x + (dx / d) * back - (dz / d) * lat * side, z = this.pos.z + (dz / d) * back + (dx / d) * lat * side;
      if (world.waterAt(x, z) !== null || !this._inLeash({ x, z }, 10)) continue;
      const gy = world.heightAt(x, z);
      if (phys.overlapsCylinder(x, gy + 0.3, z, RADIUS, 1.3, this.id)) continue;
      if (phys.lineOfSight(tp.x, ty, tp.z, x, gy + 1.0, z, this.id)) continue; // still exposed there
      this.cover = null;
      this.moveTo({ x, z }, 'sprint', { threat: { x: tp.x, y: tp.y ?? this.pos.y, z: tp.z } });
      this._tactic('break-los');
      return true;
    }
    return false;
  }

  _advance(tp, threats, preferred) {
    const dx = tp.x - this.pos.x, dz = tp.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const step = Math.min(d - preferred * 0.7, 22);
    if (step < 5) return false;
    const from = { x: this.pos.x + (dx / d) * step, z: this.pos.z + (dz / d) * step };
    if (!this._inLeash(from)) return false;
    const c = this._findCover(threats, { from, searchRadius: 10, preferred, leash: this._leash(), allowCloser: true });
    if (!c && this.D.coverUse > 0.6) return false;
    this.cover = c;
    this.shootOnMove = this.rng.next() < this.D.shootOnMove;
    this.moveTo(c || from, 'run', { threat: threats[0], cover: c });
    this._tactic('advance');
    return true;
  }

  /** Advancing only makes sense with fire superiority (aggressive gangs push regardless). */
  _winning() {
    if (this.D.id === 'aggressive') return true;
    const t = this.target;
    if (this.squad?.suppressor && this.squad.suppressor !== this) return true;
    if (t?.isAI && (t.suppression > 0.5 || t.reloading > 0 || t.state === 'retreat')) return true;
    if (this.squad) {
      let enemies = 0;
      for (const [e, c] of this.squad.contacts) if (e.alive && this.squad.time - c.t < 20) enemies++;
      return this.squad.aliveCount() >= Math.max(2, enemies * 2);
    }
    return false;
  }

  _afterCombat() {
    this.target = null;
    this.targetVisible = false;
    this.order = null;
    // pick up ammunition and medical supplies from nearby dead
    if (this.rng.next() < this.D.lootDead && this._seekAmmo(false)) return;
    this._enter('return');
  }

  _preferredRange() {
    const c = this.w.class;
    let r = 35;
    if (c === 'shotgun') r = 12;
    else if (c === 'pistol' || c === 'smg') r = 20;
    else if (c === 'sniper' || c === 'dmr') r = 90;
    else if (c === 'lmg') r = 45;
    return r * this.D.rangeBias;
  }

  /** At our cover position, or leaning out of it at its peek spot. */
  _atCover() {
    const c = this.cover;
    if (!c) return false;
    if (hyp(this.pos.x, this.pos.z, c.x, c.z) < 1.3) return true;
    return !!c.peek && hyp(this.pos.x, this.pos.z, c.peek.x, c.peek.z) < 0.9;
  }

  /** Can any recently seen threat see our crouched head where we are? */
  _coverCompromised(threats) {
    if (!this.cover || !this._atCover()) return false;
    for (const t of threats) {
      if (this.time - t.t > 8) continue;
      if (this.game.physics.lineOfSight(t.x, t.y + 1.5, t.z, this.pos.x, this.pos.y + 1.0, this.pos.z, this.id)) return true;
    }
    return false;
  }

  /**
   * Find a cover position that hides a crouched body from the threats.
   * opts: from, searchRadius, preferred, minFromThreat, leash {x,z,r}, needPeek (default true),
   *       fireAt (point the peek must be able to hit), allowCloser.
   * Returns {x, y, z, peek: {x, z, stance} | null}.
   */
  _findCover(threats, opts = {}) {
    if (!threats.length) return null;
    const T = threats[0];
    const from = opts.from || this.pos;
    const R = opts.searchRadius || 20;
    const phys = this.game.physics;
    const world = this.game.world;
    const needPeek = opts.needPeek !== false;
    const cols = phys.query(from.x - R, from.z - R, from.x + R, from.z + R, this._cl || (this._cl = []));
    const ty = (T.y ?? this.pos.y) + 1.5;
    const pref = opts.preferred || 35;
    const myD = hyp(this.pos.x, this.pos.z, T.x, T.z);
    const cands = [];
    for (const c of cols) {
      // hard cover stops bullets; hay bales do too; bushes only hide (concealment, used as a last resort)
      const concealOnly = !c.blocksShots && c.blocksSight && c.tag === 'bush';
      if ((!c.blocksShots && !concealOnly) || c.tag === 'character' || c.tag === 'door' || c.material === 'glass' || c.owner === this.id) continue;
      if (c.material === 'fabric' && c.tag !== 'hay' && !concealOnly) continue;
      const h = c.maxY - c.minY;
      if (h < 0.8) continue;
      if (c.type === 'cyl') {
        if (c.r < 0.25) continue;
        let dx = c.x - T.x, dz = c.z - T.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        cands.push({ x: c.x + dx * (c.r + (concealOnly ? 0.1 : 0.55)), z: c.z + dz * (c.r + (concealOnly ? 0.1 : 0.55)), h: c.maxY, sx: -dz, sz: dx, ext: c.r, conceal: concealOnly });
        continue;
      }
      // box: hug the face opposite the threat, at the middle and near both corners
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      const hx = (c.maxX - c.minX) / 2, hz = (c.maxZ - c.minZ) / 2;
      if (hx > 30 || hz > 30) continue;
      const dx = cx - T.x, dz = cz - T.z;
      const faces = Math.abs(dx) * hz > Math.abs(dz) * hx
        ? [{ nx: Math.sign(dx), nz: 0 }, { nx: 0, nz: Math.sign(dz) || 1 }]
        : [{ nx: 0, nz: Math.sign(dz) }, { nx: Math.sign(dx) || 1, nz: 0 }];
      for (const f of faces.slice(0, hx > 1.2 && hz > 1.2 ? 2 : 1)) {
        const off = 0.6;
        const along = f.nx ? hz : hx;
        const base = { x: f.nx ? cx + f.nx * (hx + off) : cx, z: f.nz ? cz + f.nz * (hz + off) : cz };
        const sx = f.nx ? 0 : 1, sz = f.nx ? 1 : 0;
        const offs = along > 1.4 ? [-(along - 0.5), 0, along - 0.5] : [0];
        for (const o of offs) cands.push({ x: base.x + sx * o, z: base.z + sz * o, h: c.maxY, sx, sz, ext: along });
      }
    }
    // shuffle-free deterministic order: nearest to `from` first, cap the expensive checks
    for (const k of cands) k.dFrom = hyp(k.x, k.z, from.x, from.z);
    cands.sort((a, b) => a.dFrom - b.dFrom);
    let best = null, bestScore = -Infinity, tested = 0;
    for (const k of cands) {
      if (k.dFrom > R) break;
      if (tested >= 36) break;
      const gy = world.heightAt(k.x, k.z);
      if (Math.abs(gy - this.pos.y) > 2.2) continue;
      if (k.h - gy < 0.85) continue; // too low to hide a crouched body
      const dThreat = hyp(k.x, k.z, T.x, T.z);
      if (opts.minFromThreat && dThreat < opts.minFromThreat) continue;
      if (!opts.allowCloser && dThreat < Math.min(myD * 0.55, 8)) continue;
      if (opts.leash && hyp(k.x, k.z, opts.leash.x, opts.leash.z) > opts.leash.r) continue;
      if (this._isBadGoal(k)) continue;
      if (world.waterAt(k.x, k.z) !== null) continue;
      tested++;
      if (phys.overlapsCylinder(k.x, gy + 0.3, k.z, RADIUS, 1.3, this.id) && !k.conceal) continue;
      // hidden from the main threat when crouched
      if (phys.lineOfSight(T.x, ty, T.z, k.x, gy + 1.05, k.z, this.id)) continue;
      // peek: stand up over it, or lean out sideways
      let peek = null;
      const aim = opts.fireAt ? { x: opts.fireAt.x, y: (opts.fireAt.y ?? T.y) + 1.1, z: opts.fireAt.z } : { x: T.x, y: ty - 0.3, z: T.z };
      if (phys.lineOfSight(k.x, gy + 1.6, k.z, aim.x, aim.y, aim.z, this.id)) peek = { x: k.x, z: k.z, stance: 'stand' };
      else {
        for (const s of [1.1, -1.1, 1.7, -1.7]) {
          const px = k.x + k.sx * s, pz = k.z + k.sz * s;
          const pg = world.heightAt(px, pz);
          if (phys.overlapsCylinder(px, pg + 0.3, pz, RADIUS, 1.2, this.id)) continue;
          if (phys.lineOfSight(px, pg + 1.1, pz, aim.x, aim.y, aim.z, this.id)) { peek = { x: px, z: pz, stance: 'crouch' }; break; }
          if (phys.lineOfSight(px, pg + 1.6, pz, aim.x, aim.y, aim.z, this.id)) { peek = { x: px, z: pz, stance: 'stand' }; break; }
        }
      }
      if (needPeek && !peek) continue;
      const dMe = hyp(k.x, k.z, this.pos.x, this.pos.z);
      let score = -dMe * 0.55 - Math.abs(dThreat - pref) * 0.2 + (peek ? 4 : 0) + (k.h - gy > 1.7 ? 1 : 0) - (k.conceal ? 10 : 0);
      if (this.D.id === 'cautious') score += Math.min(dThreat, 80) * 0.08;
      // other known threats that can see this spot make it worse
      for (let i = 1; i < threats.length; i++) {
        const o = threats[i];
        if (phys.lineOfSight(o.x, (o.y ?? gy) + 1.5, o.z, k.x, gy + 1.05, k.z, this.id)) score -= 6;
      }
      // running across the enemy's field of fire to get there is bad
      if (dMe > 6) {
        const mx = (k.x + this.pos.x) / 2, mz = (k.z + this.pos.z) / 2;
        if (phys.lineOfSight(T.x, ty, T.z, mx, world.heightAt(mx, mz) + 1.2, mz, this.id)) score -= 2 + dMe * 0.1;
      }
      // don't bunch up with teammates
      if (this.squad) {
        for (const m of this.squad.members) {
          if (m === this || !m.alive) continue;
          const mc = m.cover || m.pos;
          if (hyp(mc.x, mc.z, k.x, k.z) < 3) score -= 8;
        }
      }
      if (score > bestScore) { bestScore = score; best = { x: k.x, y: gy, z: k.z, peek }; }
    }
    return best;
  }

  _flankPoint(threat, preferred, side = null) {
    const dx = this.pos.x - threat.x, dz = this.pos.z - threat.z;
    const a0 = Math.atan2(dz, dx);
    const sides = side ? [side] : this.rng.next() < 0.5 ? [-1, 1] : [1, -1];
    const L = this._leash();
    const threats = [{ x: threat.x, y: threat.y ?? this.pos.y, z: threat.z }];
    for (const sd of sides) {
      for (const off of [1.35, 1.05, 1.65]) {
        const a = a0 + sd * off;
        const r = Math.max(16, preferred * (0.75 + this.rng.next() * 0.35));
        const p = { x: threat.x + Math.cos(a) * r, z: threat.z + Math.sin(a) * r };
        if (L && hyp(p.x, p.z, L.x, L.z) > L.r) continue;
        if (this.game.world.waterAt(p.x, p.z) !== null) continue;
        if (this._isBadGoal(p)) continue;
        // end the flank in cover near that point if there is some
        const c = this._findCover(threats, { from: p, searchRadius: 9, preferred: r });
        if (c) return { x: c.x, z: c.z, side: sd, cover: c };
        const gy = this.game.world.heightAt(p.x, p.z);
        if (this.game.physics.overlapsCylinder(p.x, gy + 0.3, p.z, RADIUS, 1.2)) continue;
        return { x: p.x, z: p.z, side: sd };
      }
    }
    return null;
  }

  _suppressPoint(p) {
    return { x: p.x + (this.rng.next() - 0.5) * 2.4, y: (p.y ?? this.pos.y) + 0.7 + this.rng.next() * 0.8, z: p.z + (this.rng.next() - 0.5) * 2.4 };
  }

  /** Would a shot at p fly at least `frac` of the way before hitting something? */
  _canHit(p, frac = 0.98) {
    const e = this.eye;
    const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.1) return true;
    const hit = this.game.physics.raycast(e.x, e.y, e.z, dx / d, dy / d, dz / d, d * frac, (c) => c.blocksShots && c.material !== 'glass' && c.owner !== this.id && c.tag !== 'character', true);
    return !hit;
  }

  // ------------------------------------------------------------ combat tick (every frame)
  _combatTick(dt) {
    const t = this.target;
    if (!t || !t.alive) return;
    const D = this.D;
    const c = this.contacts.get(t);
    const visible = this.targetVisible;
    const since = this.time - (c?.seen ?? this.lastSeen);
    const tp = visible ? t.pos : (c || this.lastKnown || t.pos);
    const dx = tp.x - this.pos.x, dz = tp.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const moving = !!(this.path && this.path.length);

    // --- peek cycle while in cover
    const atCover = this._atCover();
    const suppressing = this.order?.type === 'suppress' && this.time < this.order.until;
    if (atCover && !moving) {
      this.peekT -= dt;
      if (this.peekT <= 0) {
        const coverFire = this.squad && this.squad.coverFireUntil > this.time;
        if (this.exposed) {
          this.exposed = false;
          this.peekT = this._range(D.hideTime) + this.suppression * 2.5 * (D.id === 'disciplined' && coverFire ? 0.3 : 1);
          this.peeks++;
          if (!this._peekSawTarget) this.fruitlessPeeks++; else this.fruitlessPeeks = 0;
        } else if (this.reloading <= 0) {
          this.exposed = true;
          this._peekSawTarget = false;
          this.peekT = this._range(D.peekTime) * (coverFire || suppressing ? 1.6 : 1);
        } else this.peekT = 0.3;
      }
      if (this.reloading > 0) this.exposed = false;
      if (this.exposed && visible) this._peekSawTarget = true;
      // lean out to the peek spot, and back behind cover
      const pk = this.cover.peek;
      if (this.exposed && pk) this._nudge(pk, dt);
      else if (!this.exposed) this._nudge(this.cover, dt);
      this.stance = this.exposed ? (pk?.stance || 'crouch') : 'crouch';
    } else if (moving) {
      this.stance = 'stand';
      this.exposed = true;
    } else {
      this.exposed = true;
      if (this.tactic === 'engage' || this.tactic === 'hold') this.stance = dist > 14 && this.skill.cover > 0.3 ? 'crouch' : 'stand';
    }

    // --- aim
    let aimPoint = null;
    let kind = null;
    if (visible) {
      const ty = t.pos.y + (t.stance === 'prone' ? 0.25 : t.stance === 'crouch' ? 0.95 : 1.3);
      aimPoint = { x: t.pos.x, y: ty, z: t.pos.z };
      // lead moving targets for bullets with travel time
      if (this.w.projectile && t.vel) {
        const tof = dist / (this.w.velocity || 800);
        aimPoint.x += t.vel.x * tof * this.skill.accuracy;
        aimPoint.z += t.vel.z * tof * this.skill.accuracy;
      }
      if (this.role === 'sniper' && this.rng.next() < 0.3) aimPoint.y = t.pos.y + (t.stance === 'crouch' ? 1.12 : 1.6);
      kind = 'aimed';
    } else if (suppressing || (since < 5 && since > 0.6 && this._suppressBudget())) {
      const sp = suppressing ? this.order.pos : tp;
      if (!this._supAim || this.time > this._supAimUntil) { this._supAim = this._suppressPoint(sp); this._supAimUntil = this.time + 1.2; }
      aimPoint = this._supAim;
      kind = 'suppress';
    }
    const look = aimPoint || tp;
    this.desiredYaw = Math.atan2(-(look.x - this.pos.x), -(look.z - this.pos.z));
    if (!aimPoint) return;

    // --- fire control
    if (!this.exposed || this.reloading > 0 || this.cycle > 0 || this.time < this.nextShot) return;
    if (!this.w.magSize && this.w.class === 'melee') return;
    if ((this.weapon.data.ammo || 0) <= 0) return;
    if (moving && (this.moveMode === 'sprint' || !this.shootOnMove)) return;
    if (Math.abs(angleWrap(this.desiredYaw - this.yaw)) > 0.2) return; // still turning
    if (this.aimSettle > 0.05 && kind === 'aimed') return; // still reacting
    const maxRange = this._maxRange();
    if (dist > maxRange) return;
    if (kind === 'suppress') {
      // only spend ammunition on suppression when the squad asked for it or doctrine says so
      if (!suppressing && this.rng.next() > D.suppress * this.skill.suppress) { this.nextShot = this.time + 0.8; return; }
      if (!this._canHit(aimPoint, 0.7)) { this.nextShot = this.time + 0.5; return; }
    }
    const eye = this.eye.clone();
    if (kind === 'aimed' && !this.game.physics.lineOfFire(eye.x, eye.y, eye.z, aimPoint.x, aimPoint.y, aimPoint.z, this.id)) {
      this.nextShot = this.time + 0.25;
      return;
    }
    // shooting over low cover from a crouch: make sure the lip isn't right in front of the muzzle
    if (this.stance === 'crouch' && this._atCover() && this._lipBlocked(eye, aimPoint)) {
      if (this.cover.peek) this.cover.peek.stance = 'stand';
      this.nextShot = this.time + 0.3;
      return;
    }
    // avoid shooting allies in the line of fire
    if (this._allyInLine(eye, aimPoint, dist)) { this.nextShot = this.time + 0.3; return; }
    this._shoot(eye, aimPoint, dist, kind === 'aimed', kind);
  }

  /** Distance beyond which this weapon is not worth firing. */
  _maxRange() {
    if (this.role === 'sniper' || this.w.class === 'sniper' || this.w.class === 'dmr') return 450 * this.D.engageRange;
    const f = this.w.falloffEnd || 150;
    const k = this.w.class === 'shotgun' ? 1.25 : 1.6;
    return clamp(f * k, 25, 300) * this.D.engageRange;
  }

  _lipBlocked(eye, aim) {
    const dx = aim.x - eye.x, dy = aim.y - eye.y - 0.35, dz = aim.z - eye.z; // a little low: the spread cone
    const d = Math.hypot(dx, dy, dz) || 1;
    return !!this.game.physics.raycast(eye.x, eye.y, eye.z, dx / d, dy / d, dz / d, 2.0, (c) => c.blocksShots && c.material !== 'glass' && c.owner !== this.id && c.tag !== 'character', false);
  }

  _suppressBudget() {
    if (!this.w.magSize) return false;
    return this._ammoTotal() > this.w.magSize * 1.5 && (this.weapon.data.ammo || 0) > Math.min(6, this.w.magSize * 0.3);
  }

  _allyInLine(eye, aim, dist) {
    for (const ally of this.game.characters.list) {
      if (ally === this || !ally.alive || ally.faction !== this.faction) continue;
      const ax = ally.pos.x - eye.x, az = ally.pos.z - eye.z;
      const along = (ax * (aim.x - eye.x) + az * (aim.z - eye.z)) / Math.max(1, dist);
      // misses fly on past the target: friends behind it count too
      if (along < 0 || along > dist + 40) continue;
      const perp = Math.abs(ax * (aim.z - eye.z) - az * (aim.x - eye.x)) / Math.max(1, dist);
      if (perp < 1.1 + Math.max(0, along - dist) * 0.04) return true;
    }
    return false;
  }

  _range(r) { return r[0] + this.rng.next() * (r[1] - r[0]); }

  /** Small direct step (peeking), without pathfinding. */
  _nudge(p, dt) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const s = Math.min(d, 2.2 * dt);
    const r = this.game.physics.moveCylinder(this.pos, (dx / d) * s, (dz / d) * s, RADIUS, 1.75, 0.45, this.id);
    this.pos.x = r.x; this.pos.z = r.z;
  }

  _shoot(eye, aim, dist, visible, kind = 'aimed') {
    const w = this.w;
    const d = this.weapon.data;
    if ((d.ammo || 0) <= 0) return;
    const dir = { x: aim.x - eye.x, y: aim.y - eye.y, z: aim.z - eye.z };
    const L = Math.hypot(dir.x, dir.y, dir.z);
    dir.x /= L; dir.y /= L; dir.z /= L;
    const t = this.target;
    const targetMoving = t?.vel ? Math.hypot(t.vel.x, t.vel.z) > 1 : false;
    const selfMoving = Math.hypot(this.vel.x, this.vel.z) > 0.6;
    let errDeg = (0.3 + (1 - this.skill.accuracy) * 3.4) * (1 + this.suppression * 1.3) * (selfMoving ? 2.2 : 1) * (targetMoving ? 1.35 : 1)
      * (this.stance === 'crouch' ? 0.85 : 1) * (1 + this.aimSettle * 0.8) * (visible ? 1 : 2.5) / this.game.settings.get('aiDifficulty');
    errDeg += w.spreadAds || 0.3;
    if (this.game.lighting && this.game.lighting.nightFactor > 0.5 && !(t && (t.lightOn || t.firedRecently))) errDeg *= 1.6;
    const pellets = w.pellets || 1;
    const muzzle = this.lod === 0 && this.model.weapon ? this.model.muzzleWorld(new THREE.Vector3()) : null;
    for (let p = 0; p < pellets; p++) {
      const err = (errDeg + (pellets > 1 ? w.pelletSpread : 0)) * Math.PI / 180 * Math.sqrt(this.rng.next());
      const sd = randomCone(new THREE.Vector3(dir.x, dir.y, dir.z), err);
      this.game.ballistics.fire({ ox: eye.x, oy: eye.y, oz: eye.z, dx: sd.x, dy: sd.y, dz: sd.z, weapon: w, shooter: this, damageMul: w.damageMul, muzzle, tracer: muzzle && (w.class === 'lmg' || this.rng.next() < 0.12) });
    }
    d.ammo--;
    this.lastShotT = this.time;
    this.lastShotKind = kind;
    if (muzzle && w.flash && this.game.effects.worldFlash) this.game.effects.worldFlash(muzzle.x, muzzle.y, muzzle.z, w.class === 'pistol' ? 0.7 : 1, this.lod === 0);
    bus.emit('weapon:fired', { weapon: w, x: eye.x, y: eye.y, z: eye.z, npc: this, noise: (w.noise || 300) * (w.noiseMul || 1), suppressed: !w.flash || (w.noiseMul || 1) < 1 });
    this.model.flinch = Math.max(this.model.flinch, 0.15);
    // fire control: bursts for automatics, cadence for semis; suppression is slower and steadier
    const mode = w.fireModes[0];
    const auto = w.fireModes.includes('auto');
    if (w.action) { this.cycle = w.cycleTime + 0.2; this.nextShot = this.time + w.cycleTime + 0.3 + this.rng.next() * 0.6; return; }
    if (auto && (mode === 'auto' || dist < 30 || kind === 'suppress')) {
      if (this.burstLeft <= 0) {
        const [a, b] = this.D.burst;
        this.burstLeft = w.class === 'lmg' ? 5 + this.rng.int(0, 6) : this.rng.int(a, b);
      }
      this.burstLeft--;
      this.nextShot = this.time + (this.burstLeft > 0 ? fireInterval(w) : 0.35 + this.rng.next() * 0.6 + dist / 120 + (kind === 'suppress' ? 0.5 : 0));
    } else {
      this.nextShot = this.time + Math.max(fireInterval(w), 0.22 + this.rng.next() * 0.35 + dist / 150 + (w.class === 'dmr' ? 0.6 : 0) + (kind === 'suppress' ? 0.6 : 0));
    }
  }

  // ------------------------------------------------------------ movement
  _isBadGoal(p) {
    for (let i = this.badGoals.length - 1; i >= 0; i--) {
      const b = this.badGoals[i];
      if (b.until < this.time) { this.badGoals.splice(i, 1); continue; }
      if (hyp(b.x, b.z, p.x, p.z) < 2.5) return true;
    }
    return false;
  }

  moveTo(p, mode = 'walk', opts = {}) {
    this.dest = { x: p.x, z: p.z };
    this.moveMode = mode;
    this._moveOpts = opts;
    this.progress.level = 0;
    this.progress.t = 0;
    this.progress.x = this.pos.x; this.progress.z = this.pos.z;
    const d = hyp(p.x, p.z, this.pos.x, this.pos.z);
    // short direct moves skip pathfinding when clear
    if (d < 6 && this.mgr.nav.walkable(this.pos, p)) {
      this.path = [{ x: p.x, z: p.z }];
      this.pathIdx = 0;
      this.pathReq = null;
      return;
    }
    if (this.lod === 2) {
      this.path = [{ x: p.x, z: p.z }];
      this.pathIdx = 0;
      this.pathReq = null;
      return;
    }
    this.path = null;
    this.pathReq = this.mgr.nav.request(this, this.pos, p, { ignoreOwner: this.id, threat: opts.threat || null });
  }

  onPath(req) {
    if (req !== this.pathReq) return;
    this.pathReq = null;
    // a flank route that runs mostly across the enemy's field of view is no flank
    if (req.path && this._moveOpts?.maxExposure !== undefined && req.exposure > this._moveOpts.maxExposure && req.pathLength > 15) {
      bus.emit('ai:tactic', { type: 'flank-rejected', agent: this, exposure: +req.exposure.toFixed(2) });
      req.path = null;
    }
    if (req.path && req.path.length) {
      this.path = req.path;
      this.pathIdx = req.path.length > 1 ? 1 : 0;
      this.progress.t = 0; this.progress.x = this.pos.x; this.progress.z = this.pos.z;
    } else {
      this.path = null;
      this._moveFailed();
    }
  }

  /** The current goal cannot be reached: remember it and let the state choose another. */
  _moveFailed() {
    if (this.dest) this.badGoals.push({ x: this.dest.x, z: this.dest.z, until: this.time + 20 });
    if (this.badGoals.length > 12) this.badGoals.shift();
    bus.emit('ai:tactic', { type: 'path-failed', agent: this, state: this.state, tactic: this.tactic });
    const f = this._moveOpts?.onFail;
    this.dest = null;
    if (f) { this._moveOpts.onFail = null; f(); return; }
    if (this.state === 'combat') {
      if (this.cover && !this._atCover()) this.cover = null;
      if (this.order?.type === 'flank') { this.order = null; this.squad?.flankers.delete(this); }
      this.tactic = null;
    }
  }

  _move(dt) {
    let target = this.path ? this.path[this.pathIdx] : null;
    let speed = 0;
    if (target) {
      // skip a waypoint we have effectively passed
      if (this.pathIdx + 1 < this.path.length) {
        const nx = this.path[this.pathIdx + 1];
        if (hyp(this.pos.x, this.pos.z, nx.x, nx.z) < hyp(target.x, target.z, nx.x, nx.z) - 0.3 && this.mgr.nav.walkable(this.pos, nx)) { this.pathIdx++; target = nx; }
      }
      const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.55) {
        this.pathIdx++;
        if (this.pathIdx >= this.path.length) {
          this.path = null;
          this.progress.level = 0;
          if (this.dest && hyp(this.pos.x, this.pos.z, this.dest.x, this.dest.z) > 1.6) {
            // the path ended short of where we wanted to be: that goal is not reachable
            this._moveFailed();
          } else {
            const f = this._moveOpts?.onArrive;
            if (f) { this._moveOpts.onArrive = null; f(); }
          }
        }
      } else {
        const base = { walk: 1.55, run: 3.9, sprint: 5.0 }[this.moveMode] || 1.6;
        speed = base * (this.stance === 'crouch' ? 0.6 : 1) * (this.health < this.maxHealth * 0.4 ? 0.75 : 1);
        if (this.state === 'combat' && this.shootOnMove && this.targetVisible) speed = Math.min(speed, 2.2);
        const vx = (dx / d) * speed, vz = (dz / d) * speed;
        this.vel.x += (vx - this.vel.x) * Math.min(1, dt * 8);
        this.vel.z += (vz - this.vel.z) * Math.min(1, dt * 8);
        const watching = this.state === 'search' && this.searchCenter && hyp(this.pos.x, this.pos.z, this.searchCenter.x, this.searchCenter.z) < 25;
        if (!watching && (this.state !== 'combat' || !this.target || (!this.targetVisible && this.moveMode === 'sprint'))) this.desiredYaw = Math.atan2(-dx, -dz);
        this._doorCheck(dx / d, dz / d);
      }
    }
    if (!target || speed === 0) {
      this.vel.x *= Math.exp(-dt * 10);
      this.vel.z *= Math.exp(-dt * 10);
    }
    // separation from nearby characters
    for (const o of this.mgr.agents) {
      if (o === this || !o.alive) continue;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
      const d2 = ox * ox + oz * oz;
      if (d2 < 0.81 && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        this.vel.x += (ox / d) * (0.9 - d) * 4;
        this.vel.z += (oz / d) * (0.9 - d) * 4;
      }
    }
    const mx = this.vel.x * dt, mz = this.vel.z * dt;
    if (Math.abs(mx) + Math.abs(mz) > 1e-5) {
      if (this.lod === 2) {
        this.pos.x += mx; this.pos.z += mz;
        this.pos.y = this.game.world.heightAt(this.pos.x, this.pos.z);
      } else {
        const r = this.game.physics.moveCylinder(this.pos, mx, mz, RADIUS, 1.75, 0.45, this.id);
        this.pos.x = r.x; this.pos.z = r.z;
      }
    }
    if (this.lod < 2) {
      const g = this.game.physics.groundHeight(this.pos.x, this.pos.z, RADIUS, this.pos.y + 0.5);
      this.pos.y += (g - this.pos.y) * Math.min(1, dt * 15);
    }
    this._progressCheck(dt);
    // turn toward desired yaw
    if (this.desiredYaw !== undefined) {
      const dy = angleWrap(this.desiredYaw - this.yaw);
      const turn = (this.state === 'combat' ? 6 : 3.2) * dt;
      this.yaw += clamp(dy, -turn, turn);
    }
    // structure attack during raids
    if (this._attackStructure && this.time >= this.nextShot && this.reloading <= 0) {
      const s = this._attackStructure;
      if (!s.alive) { this._attackStructure = null; this._breach = null; this.path = null; }
      else {
        const eye = this.eye.clone();
        if (this.weapon.data.ammo > 0) this._shoot(eye, { x: s.x, y: s.y + 1.2, z: s.z }, 3, true);
        else if (this._reserve() > 0) this._startReload();
        else { this.game.base?.damagePiece(s, 25); this.nextShot = this.time + 1.0; }
      }
    }
  }

  /** Stuck recovery: side-step, then re-path, then give up on the goal. */
  _progressCheck(dt) {
    const P = this.progress;
    if (!this.path || !this.path.length) { P.t = 0; P.x = this.pos.x; P.z = this.pos.z; P.level = 0; return; }
    P.t += dt;
    if (P.t < 1.2) return;
    const moved = hyp(this.pos.x, this.pos.z, P.x, P.z);
    P.t = 0; P.x = this.pos.x; P.z = this.pos.z;
    const expected = this.moveMode === 'walk' ? 0.5 : 0.9;
    if (moved > expected) { P.level = 0; return; }
    P.level++;
    bus.emit('ai:tactic', { type: 'unstick', agent: this, level: P.level });
    if (P.level === 1) {
      // side-step: insert a waypoint to the side that is free
      const wp = this.path[this.pathIdx];
      const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
      for (const s of this.rng.next() < 0.5 ? [1, -1] : [-1, 1]) {
        const p = { x: this.pos.x - (dz / d) * s * 1.4 - (dx / d) * 0.4, z: this.pos.z + (dx / d) * s * 1.4 - (dz / d) * 0.4 };
        const gy = this.game.world.heightAt(p.x, p.z);
        if (!this.game.physics.overlapsCylinder(p.x, gy + 0.35, p.z, RADIUS, 1.3, this.id)) { this.path.splice(this.pathIdx, 0, p); return; }
      }
    } else if (P.level === 2 && this.dest) {
      const dest = this.dest, opts = this._moveOpts;
      this.path = null;
      this.pathReq = this.mgr.nav.request(this, this.pos, dest, { ignoreOwner: this.id, threat: opts?.threat || null, cell: 0.5 });
      this.dest = dest;
    } else if (P.level >= 3) {
      this.path = null;
      this.pathReq = null;
      P.level = 0;
      this._moveFailed();
    }
  }

  /** After moving without collision far from the player, make sure we are not inside geometry. */
  _unembed() {
    if (!this.game.physics.overlapsCylinder(this.pos.x, this.pos.y + 0.35, this.pos.z, RADIUS, 1.3, this.id)) return;
    const p = this.mgr.freeSpot(this.pos.x, this.pos.z);
    if (p) { this.pos.set(p.x, p.y, p.z); this.path = null; }
  }

  _doorCheck(dx, dz) {
    const px = this.pos.x + dx * 1.0, pz = this.pos.z + dz * 1.0;
    const list = this.game.physics.query(px - 0.6, pz - 0.6, px + 0.6, pz + 0.6, this._dl || (this._dl = []));
    for (const c of list) {
      if (c.tag === 'door' && c.door && !c.door.open && c.enabled) {
        c.door.toggle(true);
        this.mgr.emitSound({ x: px, y: this.pos.y, z: pz, radius: 14, source: this, type: 'door' });
      } else if (c.tag === 'basedoor' && c.piece && !c.piece.open && !c.piece.locked && this.faction !== 'player') {
        this.game.base?.toggleDoor(c.piece, true);
      }
    }
  }

  _animate(dt) {
    const m = this.model;
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    let aimPitch = 0;
    if (this.state === 'combat' && this.lastKnown) {
      const dx = this.lastKnown.x - this.pos.x, dz = this.lastKnown.z - this.pos.z;
      aimPitch = Math.atan2((this.lastKnown.y || this.pos.y) - this.pos.y, Math.hypot(dx, dz));
    }
    const aiming = this.state === 'combat' && this.exposed && !this.path ? 1 : this.state === 'combat' || this.state === 'search' || this.state === 'investigate' ? 0.55 : 0;
    this.anim = { speed, crouch: this.stance === 'crouch' ? 1 : 0, aiming, aimPitch, reloading: this.reloading > 0 };
    if (this.lod < 2 || this.mgr.frame % 3 === 0) {
      m.animate(this.lod < 2 ? dt : dt * 3, { speed, crouch: this.stance === 'crouch' ? 1 : 0, aiming, aimPitch, reloading: this.reloading > 0 });
    }
    m.mesh.castShadow = this.lod === 0;
    // audible footsteps
    if (this.lod === 0 && speed > 0.6) {
      const step = Math.floor(m.phase / Math.PI);
      if (step !== this._stepPhase) {
        this._stepPhase = step;
        const volume = speed > 3 ? 1.1 : this.stance === 'crouch' ? 0.35 : 0.7;
        bus.emit('footstep', { x: this.pos.x, y: this.pos.y, z: this.pos.z, surface: this.game.world.surfaceAt?.(this.pos.x, this.pos.z), volume, npc: this });
      }
    }
    // flashlight cone visual
    if (this.lightOn && this.lod < 2 && !this.game.headless) {
      if (!this.flashlightCone) this.flashlightCone = this.mgr.makeLightCone();
      const c = this.flashlightCone;
      c.visible = true;
      c.position.set(this.pos.x, this.pos.y + (this.stance === 'crouch' ? 1.0 : 1.35), this.pos.z);
      c.rotation.set(0, this.yaw, 0);
    } else if (this.flashlightCone) this.flashlightCone.visible = false;
  }

  dispose() {
    this.removed = true;
    this.game.renderer.scene.remove(this.model.root);
    if (this.flashlightCone) { this.flashlightCone.parent?.remove(this.flashlightCone); this.flashlightCone = null; }
    this.game.characters.remove(this);
  }
}
