import * as THREE from 'three';
import { ItemDB } from '../items/ItemDatabase.js';
import { WEAPON_SLOTS } from '../items/Equipment.js';
import { buildWeaponModel, buildArms } from './WeaponModels.js';
import { effectiveWeapon, fireInterval } from './WeaponData.js';
import { bus } from '../core/EventBus.js';
import { clamp, damp, lerp } from '../core/MathUtil.js';
import { settings } from '../core/SettingsManager.js';

// Player weapon handling: viewmodel, firing modes, ADS, recoil and sway, magazine and
// single-round reloads that draw real ammunition from the inventory, bolt/pump cycling,
// jams, melee and the weapon light.

const POSE = {
  pistol: { hip: [0.13, -0.135, -0.3], ads: [0, 0, -0.27], sprint: [0.05, -0.2, -0.24, -0.6, 0.5] },
  smg: { hip: [0.14, -0.15, -0.3], ads: [0, 0, -0.2], sprint: [0.12, -0.18, -0.24, -0.5, 0.7] },
  rifle: { hip: [0.15, -0.16, -0.34], ads: [0, 0, -0.22], sprint: [0.12, -0.2, -0.26, -0.45, 0.8] },
  shotgun: { hip: [0.15, -0.16, -0.32], ads: [0, 0, -0.2], sprint: [0.12, -0.2, -0.26, -0.45, 0.8] },
  melee: { hip: [0.18, -0.2, -0.32], ads: [0.18, -0.2, -0.32], sprint: [0.2, -0.25, -0.25, -0.3, 0.3] },
};

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export class WeaponController {
  constructor(game) {
    this.game = game;
    this.renderer = game.renderer;
    this.viewCam = game.renderer.viewCamera;
    this.vm = new THREE.Group();
    this.vm.name = 'viewmodel';
    this.viewCam.add(this.vm);
    this.arms = buildArms(game.materials);
    this.vm.add(this.arms.group);
    this.weaponGroup = new THREE.Group();
    this.vm.add(this.weaponGroup);

    this.slot = null; // current equipment slot
    this.stack = null;
    this.w = null; // effective stats
    this.model = null;
    this.state = 'none'; // none, equip, idle, reload, cycle, melee, holster, jammed, inspect
    this.stateT = 0;
    this.stateDur = 0;
    this.nextFire = 0;
    this.triggerHeld = false;
    this.dryClicked = false;
    this.adsT = 0;
    this.adsWanted = false;
    this.recoil = { pitch: 0, yaw: 0, kick: 0, rot: 0, side: 0 };
    this.sway = { x: 0, y: 0, lx: 0, ly: 0 };
    this.time = 0;
    this.burst = 0;
    this.reloadPhase = null;
    this.pendingSlot = null;
    this.sprintT = 0;
    this.lowered = 0;
    this.lightOn = false;
    this.breath = 0;
    this.holdingBreath = false;

    // weapon / flashlight spot light in the world scene (always present, intensity toggled)
    this.spot = new THREE.SpotLight(0xfff2dc, 0, 55, 0.38, 0.45, 1.6);
    this.spot.castShadow = false;
    game.renderer.scene.add(this.spot, this.spot.target);
  }

  get ammoId() { return this.w?.ammo || null; }
  get isMelee() { return this.w?.class === 'melee'; }
  get ads() { return this.adsT > 0.5; }
  get scoped() { return this.w && this.w.sight === 'scope' && this.adsT > 0.92; }
  get busy() { return ['reload', 'equip', 'melee', 'jammed'].includes(this.state); }

  equipment() { return this.game.player.equipment; }

  /** Switch to a weapon slot (or null to holster). */
  select(slot) {
    if (slot === this.slot && this.state !== 'none') return;
    const eq = this.equipment();
    if (slot && !eq.slots[slot]) { bus.emit('notify', { text: `No weapon in ${slot} slot`, kind: 'info' }); return; }
    this.cancelReload();
    this.slot = slot;
    this.stack = slot ? eq.slots[slot] : null;
    this._rebuild();
    if (this.stack) {
      this.state = 'equip';
      this.stateT = 0;
      this.stateDur = this.w.equipTime || 0.5;
      bus.emit('sound', { type: 'equip', ui: true });
    } else {
      this.state = 'none';
    }
    bus.emit('weapon:changed', this.hudInfo());
  }

  /** Called when equipment changed externally (inventory UI). */
  refresh() {
    const eq = this.equipment();
    if (this.slot && eq.slots[this.slot] !== this.stack) {
      this.stack = eq.slots[this.slot];
      if (!this.stack) { this.slot = null; this.state = 'none'; }
      this._rebuild();
    } else if (this.stack) {
      // attachments may have changed
      const sig = JSON.stringify(this.stack.data?.attach || {});
      if (sig !== this._attachSig) this._rebuild();
    }
    bus.emit('weapon:changed', this.hudInfo());
  }

  _rebuild() {
    if (this.model) {
      this.weaponGroup.remove(this.model.root);
      this.model.root.traverse((o) => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
      this.model = null;
    }
    this.w = this.stack ? effectiveWeapon(this.stack) : null;
    this._attachSig = JSON.stringify(this.stack?.data?.attach || {});
    if (!this.stack) { this.arms.group.visible = false; return; }
    this.arms.group.visible = true;
    const parts = buildWeaponModel(this.stack.id, this.stack.data?.attach || {}, this.game.materials);
    parts.root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
    this.model = parts;
    this.weaponGroup.add(parts.root);
    const d = this.stack.data;
    if (d) {
      if (d.mode === undefined || d.mode >= this.w.fireModes.length) d.mode = 0;
      if (d.ammo > this.w.magSize) {
        // magazine attachment removed: return surplus rounds to the inventory
        const extra = d.ammo - this.w.magSize;
        d.ammo = this.w.magSize;
        const left = this.equipment().inventory.add({ id: this.w.ammo, qty: extra });
        if (left) this.game.dropItem({ id: this.w.ammo, qty: left });
      }
    }
  }

  hudInfo() {
    if (!this.stack || !this.w) return { name: 'Unarmed', ammo: null, reserve: null, mode: '' };
    if (this.isMelee) return { name: this.w.name, ammo: null, reserve: null, mode: 'MELEE', cond: this.stack.data?.cond };
    const reserve = this.equipment().inventory.count(this.w.ammo);
    const mode = this.w.fireModes[this.stack.data.mode] || 'semi';
    return { name: this.w.name, ammo: this.stack.data.ammo, magSize: this.w.magSize, reserve, mode: mode.toUpperCase(), cond: this.stack.data.cond, jammed: this.state === 'jammed', ammoName: ItemDB.get(this.w.ammo)?.name, action: this.w.action };
  }

  cancelReload() {
    if (this.state === 'reload') {
      this.state = 'idle';
      this.reloadPhase = null;
      if (this.model?.mag) { this.model.mag.visible = true; this.model.mag.position.copy(this.model.magHome || this.model.mag.position); }
    }
  }

  startReload() {
    if (!this.stack || this.isMelee || this.busy) return;
    if (this.state === 'cycle') return;
    if (this.stack.data.ammo >= this.w.magSize) return;
    const inv = this.equipment().inventory;
    if (inv.count(this.w.ammo) <= 0) {
      bus.emit('notify', { text: `No ${ItemDB.get(this.w.ammo).name}`, kind: 'warn' });
      return;
    }
    this.state = 'reload';
    this.stateT = 0;
    if (this.w.reloadType === 'single') {
      this.reloadPhase = { type: 'single', step: 'start', t: 0 };
      this.stateDur = Infinity;
    } else {
      this.reloadPhase = { type: 'mag', t: 0, swapped: false, empty: this.stack.data.ammo === 0 };
      this.stateDur = this.w.reloadTime * (this.game.player.skills?.mul('weapon_handling', 'reload') || 1);
      if (this.reloadPhase.empty) this.stateDur *= 1.12; // chambering a round takes a moment longer
    }
    bus.emit('sound', { type: 'reload', stage: 'start', weapon: this.w, ui: true });
  }

  clearJam() {
    this.state = 'jammed';
    this.stateT = 0;
    this.stateDur = 1.2;
    this._jamClearing = true;
    bus.emit('sound', { type: 'reload', stage: 'rack', weapon: this.w, ui: true });
  }

  /**
   * ctx: {input, player(controller), survival, allowFire, dt, nearWall}
   */
  update(dt, ctx) {
    this.time += dt;
    const input = ctx.input;
    const pc = ctx.controller;
    const canControl = ctx.allowFire;

    // weapon selection
    if (canControl) {
      for (let i = 0; i < 4; i++) if (input.hit(`slot${i + 1}`)) this.select(WEAPON_SLOTS[i]);
      if (input.hit('holster')) this.select(null);
      if (ctx.wheel) {
        const eq = this.equipment();
        const avail = WEAPON_SLOTS.filter((s) => eq.slots[s]);
        if (avail.length) {
          let i = avail.indexOf(this.slot);
          i = (i + (ctx.wheel > 0 ? 1 : -1) + avail.length) % avail.length;
          this.select(avail[i]);
        }
      }
    }

    // state timers
    this.stateT += dt;
    if (this.state === 'equip' && this.stateT >= this.stateDur) this.state = 'idle';
    if (this.state === 'jammed' && this._jamClearing && this.stateT >= this.stateDur) { this.state = 'idle'; this._jamClearing = false; }
    if (this.state === 'cycle' && this.stateT >= this.stateDur) this.state = 'idle';
    if (this.state === 'melee' && this.stateT >= this.stateDur) this.state = 'idle';
    if (this.state === 'inspect' && this.stateT >= this.stateDur) this.state = 'idle';

    // ADS
    const sprinting = pc.sprinting;
    this.adsWanted = canControl && input.button(2) && this.stack && !this.isMelee && !sprinting && !pc.swimming && this.state !== 'reload' || (this.adsWanted && this.state === 'cycle' && input.button(2));
    const adsRate = this.w ? 1 / Math.max(0.08, this.w.adsTime) : 5;
    this.adsT = clamp(this.adsT + (this.adsWanted ? adsRate : -adsRate * 1.3) * dt, 0, 1);
    this.sprintT = damp(this.sprintT, sprinting && this.state !== 'reload' ? 1 : 0, 9, dt);

    if (!this.stack) { this._pose(dt, ctx); return; }

    // fire mode
    if (canControl && input.hit('firemode') && !this.isMelee && this.w.fireModes.length > 1) {
      this.stack.data.mode = (this.stack.data.mode + 1) % this.w.fireModes.length;
      bus.emit('sound', { type: 'click', ui: true });
      bus.emit('weapon:changed', this.hudInfo());
    }
    if (canControl && input.hit('reload')) {
      if (this.state === 'jammed' && !this._jamClearing) this.clearJam();
      else this.startReload();
    }
    if (canControl && input.hit('inspect') && this.state === 'idle') { this.state = 'inspect'; this.stateT = 0; this.stateDur = 2.4; }
    if (canControl && input.hit('light')) this.toggleLight();

    // reloading progress
    if (this.state === 'reload') this._updateReload(dt, ctx);

    // sprinting interrupts magazine reloads (single-round reloads pause)
    if (sprinting && this.state === 'reload' && this.reloadPhase?.type === 'mag' && this.stateT < this.stateDur * 0.7) this.cancelReload();

    // trigger
    const trigger = canControl && input.button(0) && !sprinting;
    const pressed = canControl && input.buttonHit(0);
    if (!trigger) { this.dryClicked = false; this.burst = 0; }
    if (this.isMelee) {
      if (pressed && this.state === 'idle') this._melee(ctx);
    } else if (trigger) {
      this._tryFire(dt, ctx, pressed);
    }
    this._updateRecoil(dt, ctx);
    this._pose(dt, ctx);
    this._updateLight(dt, ctx);
  }

  _tryFire(dt, ctx, pressed) {
    const d = this.stack.data;
    // interrupt single-round reload with the trigger if a round is loaded
    if (this.state === 'reload' && this.reloadPhase?.type === 'single' && d.ammo > 0 && pressed) {
      this.reloadPhase.step = 'end'; this.reloadPhase.t = 0; this.reloadPhase.interrupt = true;
      return;
    }
    if (this.state !== 'idle') return;
    if (this.time < this.nextFire) return;
    const mode = this.w.fireModes[d.mode] || 'semi';
    if (mode === 'semi' && !pressed) return;
    if (d.ammo <= 0) {
      if (!this.dryClicked) {
        this.dryClicked = true;
        bus.emit('sound', { type: 'dryfire', ui: true });
        if (this.equipment().inventory.count(this.w.ammo) > 0) bus.emit('notify', { text: 'Empty — press R to reload', kind: 'info', key: 'empty' });
      }
      return;
    }
    // jam check (worn weapons)
    const cond = d.cond ?? 1;
    if (cond < 0.5 && Math.random() < (0.5 - cond) * 0.06) {
      this.state = 'jammed';
      this._jamClearing = false;
      bus.emit('sound', { type: 'dryfire', ui: true });
      bus.emit('notify', { text: 'Weapon jammed — press R to clear', kind: 'warn' });
      bus.emit('weapon:changed', this.hudInfo());
      return;
    }
    this._fire(ctx);
  }

  _fire(ctx) {
    const d = this.stack.data;
    const w = this.w;
    d.ammo--;
    d.cond = Math.max(0.05, (d.cond ?? 1) - (w.class === 'lmg' ? 0.0003 : 0.0006));
    this.nextFire = this.time + fireInterval(w);
    const cam = this.game.renderer.camera;
    const pc = ctx.controller;
    // spread (degrees)
    const moveSpeed = Math.hypot(pc.vel.x, pc.vel.z);
    let spread = lerp(w.spreadHip, w.spreadAds, this.adsT);
    spread *= 1 + Math.min(1.5, moveSpeed / 4) * (w.moveSpread - 1) * (1 - this.adsT * 0.5) + (pc.grounded ? 0 : 1.5);
    spread *= pc.stance === 'crouch' ? 0.8 : pc.stance === 'prone' ? 0.6 : 1;
    spread *= w.condSpread;
    spread *= 1 + (ctx.survival.painEffective || 0) * 0.8;
    spread *= this.game.player.skills?.mul('marksmanship', 'spread') || 1;
    const origin = cam.position;
    const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const muzzleWorld = this._muzzleWorld();
    const pellets = w.pellets || 1;
    for (let p = 0; p < pellets; p++) {
      const s = (spread + (pellets > 1 ? w.pelletSpread : 0)) * Math.PI / 180;
      const dir = randomCone(fwd, s * Math.sqrt(Math.random()));
      this.game.ballistics.fire({
        ox: origin.x, oy: origin.y, oz: origin.z, dx: dir.x, dy: dir.y, dz: dir.z, weapon: w,
        shooter: this.game.player.character, damageMul: w.damageMul, muzzle: muzzleWorld,
        tracer: (w.class === 'lmg' && d.ammo % 3 === 0) || (w.class === 'rifle' && d.ammo % 5 === 0 && pellets === 1),
      });
    }
    // recoil
    const r = w.recoil;
    const skill = this.game.player.skills?.mul('weapon_handling', 'recoil') || 1;
    const adsRed = lerp(1, 0.75, this.adsT) * (pc.stance === 'prone' ? 0.6 : pc.stance === 'crouch' ? 0.85 : 1) * skill;
    const v = r.v * (0.85 + Math.random() * 0.3) * adsRed * Math.PI / 180;
    const h = (Math.random() - 0.45) * 2 * r.h * adsRed * Math.PI / 180;
    // a third of the climb is permanent (the shooter must pull down), the rest recovers
    pc.pitch = clamp(pc.pitch + v * 0.35, -1.52, 1.52);
    this.recoil.pitch += v * 0.65;
    this.recoil.yaw += h;
    this.recoil.kick += r.kick;
    this.recoil.rot += r.rot * 0.25;
    this.recoil.side += (Math.random() - 0.5) * 0.02;
    pc.shake += r.v * 0.25;
    // effects
    if (w.flash && this.model?.muzzle) {
      this.game.effects.muzzleFlashView(this.model.muzzle, w.class === 'pistol' ? 0.8 : w.class === 'shotgun' ? 1.3 : 1);
      this.game.effects.flashLight(muzzleWorld.x, muzzleWorld.y, muzzleWorld.z, 3);
    }
    this.game.effects.smoke(muzzleWorld.x, muzzleWorld.y, muzzleWorld.z, w.flash ? 1 : 0.5);
    if (!w.action && w.class !== 'shotgun' && this.model) this._ejectShell(cam);
    bus.emit('weapon:fired', { weapon: w, x: origin.x, y: origin.y, z: origin.z, player: true, noise: w.noise * (w.noiseMul || 1), suppressed: !w.flash || w.noiseMul < 1 });
    if (w.action) {
      this.state = 'cycle';
      this.stateT = 0;
      this.stateDur = w.cycleTime;
      setTimeout(() => {
        bus.emit('sound', { type: 'reload', stage: w.action, weapon: w, ui: true });
        if (w.class === 'shotgun' || w.action === 'bolt') this._ejectShell(cam, w.class === 'shotgun');
      }, w.cycleTime * 400);
    }
    bus.emit('weapon:changed', this.hudInfo());
    this.game.player.skills?.gain('marksmanship', 0.2);
  }

  _muzzleWorld() {
    const cam = this.game.renderer.camera;
    if (!this.model?.muzzle) return cam.position.clone();
    // muzzle position in view-camera space mapped into the world camera
    this.vm.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    this.model.muzzle.getWorldPosition(p);
    this.viewCam.worldToLocal(p);
    return cam.localToWorld(p);
  }

  _ejectShell(cam, shotgun = false) {
    const p = new THREE.Vector3(0.12, -0.08, -0.35);
    cam.localToWorld(p);
    const v = new THREE.Vector3(1.6 + Math.random(), 1.6 + Math.random(), 0.3).applyQuaternion(cam.quaternion);
    v.x += this.game.player.controller.vel.x;
    v.z += this.game.player.controller.vel.z;
    this.game.effects.shell(p, v);
    void shotgun;
  }

  _melee(ctx) {
    const w = this.w;
    this.state = 'melee';
    this.stateT = 0;
    this.stateDur = w.swingTime + 0.25;
    bus.emit('sound', { type: 'swing', ui: true });
    setTimeout(() => {
      const cam = this.game.renderer.camera;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const o = cam.position;
      const hitC = this.game.characters.raycast(o.x, o.y, o.z, fwd.x, fwd.y, fwd.z, w.range, this.game.player.character);
      const hitW = this.game.physics.raycast(o.x, o.y, o.z, fwd.x, fwd.y, fwd.z, w.range, (c) => c.blocksMove && c.tag !== 'character');
      if (hitC && (!hitW || hitC.t < hitW.t)) {
        hitC.character.onHit({ zone: hitC.zone, base: w.damage, weapon: null, distance: 1, mul: 1, shooter: this.game.player.character, dir: { x: fwd.x, y: fwd.y, z: fwd.z }, point: { x: o.x + fwd.x * hitC.t, y: o.y + fwd.y * hitC.t, z: o.z + fwd.z * hitC.t }, cause: 'melee' });
        this.game.effects.blood({ x: o.x + fwd.x * hitC.t, y: o.y + fwd.y * hitC.t, z: o.z + fwd.z * hitC.t }, fwd);
        bus.emit('sound', { type: 'meleeHit', x: o.x, y: o.y, z: o.z, flesh: true });
        bus.emit('hit', { target: hitC.character, shooter: this.game.player.character, zone: hitC.zone });
        bus.emit('noise', { x: o.x, y: o.y, z: o.z, radius: 15, source: this.game.player.character, type: 'melee' });
      } else if (hitW) {
        const p = { x: o.x + fwd.x * hitW.t, y: o.y + fwd.y * hitW.t, z: o.z + fwd.z * hitW.t };
        this.game.effects.impact(p, { x: -fwd.x, y: -fwd.y, z: -fwd.z }, hitW.material, fwd);
        bus.emit('sound', { type: 'meleeHit', x: p.x, y: p.y, z: p.z, material: hitW.material });
        if (hitW.collider?.onBulletHit) hitW.collider.onBulletHit(w.damage * 0.8, { weapon: w, melee: true });
      }
    }, w.swingTime * 450);
  }

  _updateReload(dt, ctx) {
    const ph = this.reloadPhase;
    const d = this.stack.data;
    const inv = this.equipment().inventory;
    ph.t += dt;
    if (ph.type === 'mag') {
      if (!ph.swapped && this.stateT >= this.stateDur * 0.62) {
        ph.swapped = true;
        bus.emit('sound', { type: 'reload', stage: 'insert', weapon: this.w, ui: true });
      }
      if (this.stateT >= this.stateDur) {
        const need = this.w.magSize - d.ammo;
        const got = inv.remove(this.w.ammo, need);
        d.ammo += got;
        this.state = 'idle';
        this.reloadPhase = null;
        bus.emit('sound', { type: 'reload', stage: 'end', weapon: this.w, ui: true });
        bus.emit('weapon:changed', this.hudInfo());
        this.game.player.skills?.gain('weapon_handling', 0.5);
      }
      return;
    }
    // single-round loading
    const startT = this.w.reloadStart || 0.4, perT = this.w.reloadTime, endT = this.w.reloadEnd || 0.4;
    if (ph.step === 'start' && ph.t >= startT) { ph.step = 'load'; ph.t = 0; }
    else if (ph.step === 'load' && ph.t >= perT) {
      ph.t = 0;
      if (d.ammo < this.w.magSize && inv.remove(this.w.ammo, 1) === 1) {
        d.ammo++;
        bus.emit('sound', { type: 'reload', stage: 'shell', weapon: this.w, ui: true });
        bus.emit('weapon:changed', this.hudInfo());
      }
      if (d.ammo >= this.w.magSize || inv.count(this.w.ammo) <= 0) { ph.step = 'end'; ph.t = 0; }
    } else if (ph.step === 'end' && ph.t >= endT) {
      this.state = 'idle';
      this.reloadPhase = null;
      if (this.w.action === 'pump') bus.emit('sound', { type: 'reload', stage: 'pump', weapon: this.w, ui: true });
    }
    void ctx;
  }

  _updateRecoil(dt, ctx) {
    const w = this.w;
    const rec = w?.recoil?.recover || 8;
    const firing = this.time - this.nextFire < 0.1 && this.time < this.nextFire + 0.15;
    const k = firing ? rec * 0.25 : rec;
    // camera recoil recovers toward zero (partially compensated, like a real shooter)
    const pc = ctx.controller;
    const pRecovered = this.recoil.pitch * (1 - Math.exp(-k * dt));
    this.recoil.pitch -= pRecovered;
    this.recoil.yaw = damp(this.recoil.yaw, 0, k * 0.8, dt);
    this.recoil.kick = damp(this.recoil.kick, 0, 18, dt);
    this.recoil.rot = damp(this.recoil.rot, 0, 12, dt);
    this.recoil.side = damp(this.recoil.side, 0, 10, dt);
    // part of the climb is permanent; the rest springs back
    pc.pitch += pRecovered * 0.0;
    pc.recoilPitch = this.recoil.pitch;
    pc.recoilYaw = this.recoil.yaw;
    // scoped breathing sway moves the actual aim
    if (this.scoped) {
      const steady = ctx.holdBreath ? 0.15 : 1;
      const amp = 0.0022 * (this.w.sway || 1) * steady * (1 + (ctx.survival.painEffective || 0) * 2 + (ctx.survival.stamina < 30 ? 1.2 : 0));
      pc.recoilPitch += Math.sin(this.time * 1.1) * amp;
      pc.recoilYaw += Math.sin(this.time * 0.7 + 1.3) * amp * 1.2;
      this.holdingBreath = ctx.holdBreath;
    } else this.holdingBreath = false;
  }

  _pose(dt, ctx) {
    const pc = ctx.controller;
    const cls = !this.w ? 'rifle' : this.w.class === 'pistol' ? 'pistol' : this.w.class === 'smg' ? 'smg' : this.w.class === 'shotgun' ? 'shotgun' : this.w.class === 'melee' ? 'melee' : 'rifle';
    const P = POSE[cls];
    const sightY = this.model ? this.model.sightY : 0.1;
    const adsZ = P.ads[2] + (this.w?.sight === 'scope' ? 0.06 : this.w?.sight === 'reflex' ? 0.02 : 0);
    const a = easeInOut(this.adsT);
    // mouse sway lag
    const md = ctx.mouseDelta || { dx: 0, dy: 0 };
    const swayK = (this.w?.sway || 1) * (this.w?.swayMul || 1) * lerp(1, 0.25, a);
    this.sway.lx = damp(this.sway.lx, clamp(-md.dx * 0.0006, -0.04, 0.04) * swayK, 10, dt);
    this.sway.ly = damp(this.sway.ly, clamp(md.dy * 0.0006, -0.04, 0.04) * swayK, 10, dt);
    // idle breathing
    const breathAmp = lerp(0.004, 0.0008, a) * (1 + (ctx.survival?.stamina < 30 ? 1.5 : 0));
    const bx = Math.sin(this.time * 1.3) * breathAmp, by = Math.sin(this.time * 2.1) * breathAmp;
    // bob
    const bobK = pc.bobAmount * lerp(1, 0.15, a);
    const bobX = Math.cos(pc.bobPhase) * 0.012 * bobK;
    const bobY = -Math.abs(Math.sin(pc.bobPhase)) * 0.014 * bobK;

    let px = lerp(P.hip[0], 0, a), py = lerp(P.hip[1], -sightY, a), pz = lerp(P.hip[2], adsZ, a);
    if (cls === 'melee') { px = P.hip[0]; py = P.hip[1]; pz = P.hip[2]; }
    let rx = 0, ry = 0, rz = 0;
    // sprint pose
    const s = this.sprintT;
    px = lerp(px, P.sprint[0], s); py = lerp(py, P.sprint[1], s); pz = lerp(pz, P.sprint[2], s);
    rx += P.sprint[3] * s * 0.6; ry += P.sprint[4] * s; rz += 0.3 * s;
    // equip / holster
    if (this.state === 'equip') {
      const t = 1 - clamp(this.stateT / this.stateDur, 0, 1);
      py -= t * t * 0.35; rx -= t * 0.8;
    }
    // reload animation
    this._reloadHand = null;
    if (this.state === 'reload' && this.reloadPhase) {
      const ph = this.reloadPhase;
      if (ph.type === 'mag') {
        const t = clamp(this.stateT / this.stateDur, 0, 1);
        const k = reloadCurve(t, ph.empty);
        rz += k.tilt * 0.38; rx += k.tilt * 0.12 + k.seat * 0.05; py -= k.tilt * 0.035 - k.seat * 0.01; px -= k.tilt * 0.03;
        if (k.charge > 0) { rz -= k.charge * 0.15; ry -= k.charge * 0.12; }
        const m = this.model;
        if (m?.mag && m.magHome) {
          // magazine follows the support hand once it leaves the weapon
          m.mag.position.copy(m.magHome);
          m.mag.position.y -= k.magOut * 0.32;
          m.mag.position.z += k.magOut * 0.06;
          m.mag.position.x -= k.magOut * 0.05;
          m.mag.rotation.z = k.magOut * 0.5;
          m.mag.visible = k.magOut < 0.98;
        }
        if (m?.charging && m.chargingZ !== undefined) m.charging.position.z = m.chargingZ + k.charge * 0.07;
        if (m?.slide && ph.empty) m.slide.position.z = 0.025 * (1 - k.charge);
        this._reloadHand = k;
      } else {
        rz += 0.35; rx += 0.1; py -= 0.03;
        if (ph.step === 'load') {
          const kk = Math.sin((ph.t / this.w.reloadTime) * Math.PI);
          px -= kk * 0.01; rz += kk * 0.05;
        }
        if (this.model?.cylinder) this.model.cylinder.position.x = 0.025;
      }
    } else {
      if (this.model?.cylinder) this.model.cylinder.position.x = 0;
      if (this.model?.mag && this.model.magHome) { this.model.mag.position.copy(this.model.magHome); this.model.mag.rotation.z = 0; this.model.mag.visible = true; }
      if (this.model?.charging && this.model.chargingZ !== undefined) this.model.charging.position.z = this.model.chargingZ;
    }
    // landing dip and strafe lean
    py -= (pc.landDip || 0) * 0.35;
    const latV = pc.vel ? pc.vel.x * Math.cos(pc.yaw) - pc.vel.z * Math.sin(pc.yaw) : 0;
    this.strafe = damp(this.strafe || 0, clamp(latV / 4.5, -1, 1), 6, dt);
    rz -= this.strafe * 0.045 * lerp(1, 0.3, a);
    if (this.state === 'jammed' && this._jamClearing) {
      const t = Math.sin(clamp(this.stateT / this.stateDur, 0, 1) * Math.PI);
      rz += t * 0.6; ry += t * 0.2;
    }
    // bolt / pump cycling
    if (this.model?.bolt) {
      const t = this.state === 'cycle' ? clamp(this.stateT / this.stateDur, 0, 1) : 0;
      const k = Math.sin(t * Math.PI);
      this.model.bolt.rotation.z = -Math.min(1, k * 2) * 1.2;
      this.model.bolt.position.z = this.model.boltZ + Math.max(0, k * 2 - 1) * 0.07;
      rz += k * 0.12; ry -= k * 0.05;
    }
    if (this.model?.pump) {
      const t = this.state === 'cycle' ? clamp(this.stateT / this.stateDur, 0, 1) : 0;
      this.model.pump.position.z = this.model.pumpZ + Math.sin(t * Math.PI) * 0.08;
      rx += Math.sin(t * Math.PI) * 0.06;
    }
    if (this.model?.slide) {
      const since = this.time - (this.nextFire - fireInterval(this.w));
      this.model.slide.position.z = since < 0.06 ? 0.025 * (1 - since / 0.06) : 0;
      if (this.stack?.data?.ammo === 0) this.model.slide.position.z = 0.025;
    }
    // inspect
    if (this.state === 'inspect') {
      const t = this.stateT / this.stateDur;
      const k = Math.sin(t * Math.PI);
      ry += k * 0.9; rz += Math.sin(t * Math.PI * 2) * 0.25 * k; px -= k * 0.08; pz += k * 0.05;
    }
    // melee swing
    if (this.state === 'melee') {
      const t = clamp(this.stateT / this.stateDur, 0, 1);
      const k = t < 0.35 ? -t / 0.35 : (t - 0.35) / 0.65;
      const swing = t < 0.35 ? -Math.sin(t / 0.35 * Math.PI / 2) : Math.cos((t - 0.35) / 0.65 * Math.PI / 2) * 1.0 - 0.0;
      ry += swing * 0.9; rx += swing * 0.5; px -= swing * 0.15;
      void k;
    }
    // near-wall lowering (intentional low-ready instead of clipping)
    this.lowered = damp(this.lowered, ctx.nearWall ? 1 : 0, 10, dt);
    rx -= this.lowered * 0.6; py -= this.lowered * 0.06;

    // recoil kick on the model
    pz += this.recoil.kick;
    rx += this.recoil.rot;
    px += this.recoil.side;

    this.vm.position.set(px + this.sway.lx + bx + bobX, py + this.sway.ly + by + bobY, pz);
    _e.set(rx + this.sway.ly * 2, ry + this.sway.lx * 3, rz);
    this.vm.quaternion.setFromEuler(_e);
    // hide the viewmodel when looking through a scope
    this.vm.visible = !this.scoped && !pc.swimming;
    this._arms();
    // FOV
    const cam = this.game.renderer.camera;
    const base = settings.get('fov');
    let target = base;
    if (this.w && !this.isMelee) {
      if (this.w.sight === 'scope') target = this.adsT > 0.92 ? (base / (this.w.scopeZoom || 4)) : lerp(base, base * 0.8, a);
      else target = lerp(base, base * (this.w.adsFov || 0.85), a);
    }
    if (pc.sprinting) target += 4;
    if (Math.abs(cam.fov - target) > 0.01) {
      cam.fov = this.scoped ? target : damp(cam.fov, target, 16, dt);
      cam.updateProjectionMatrix();
    }
  }

  _arms() {
    const A = this.arms;
    if (!this.model) return;
    this.vm.updateMatrix();
    const m = this.model;
    const right = m.gripPos ? m.gripPos.clone() : new THREE.Vector3(0, -0.04, 0.05);
    const shoulderR = new THREE.Vector3(0.22, -0.32, 0.28);
    const shoulderL = new THREE.Vector3(-0.22, -0.33, 0.25);
    // convert shoulders (camera space) into vm-local space
    const inv = this.vm.matrix.clone().invert();
    const sR = shoulderR.applyMatrix4(inv), sL = shoulderL.applyMatrix4(inv);
    A.rHand.position.copy(right);
    A.rHand.lookAt(right.x, right.y, right.z - 1);
    const elbowR = right.clone().lerp(sR, 0.55);
    elbowR.y -= 0.04;
    A.rFore.set(right, elbowR);
    let left = m.supportHand ? m.supportHand.clone() : null;
    const k = this._reloadHand;
    if (k && left && m.magWell) {
      // support hand: to the magazine, down out of view (pouch), back, then to the charging handle
      const atMag = new THREE.Vector3(m.magWell.x - 0.01, m.magWell.y - 0.05, m.magWell.z + 0.01);
      const pouch = new THREE.Vector3(m.magWell.x - 0.12, m.magWell.y - 0.42, m.magWell.z + 0.12);
      const charge = m.charging ? new THREE.Vector3(m.charging.position.x - 0.03, (m.ironSightY || 0.08) - 0.01, m.charging.position.z + 0.02) : atMag;
      let target = left.clone().lerp(atMag, k.toMag);
      target.lerp(pouch, k.away);
      if (k.toCharge > 0) target.lerp(charge, k.toCharge);
      left = target;
    }
    if (m.pump && left) left.z = m.pump.position.z;
    if (left && !(this.sprintT > 0.7 && this.w.class === 'pistol')) {
      A.lHand.visible = true; A.lFore.mesh.visible = true;
      A.lHand.position.copy(left);
      A.lHand.lookAt(left.x + 0.3, left.y, left.z - 1);
      const elbowL = left.clone().lerp(sL, 0.55);
      elbowL.y -= 0.05;
      A.lFore.set(left, elbowL);
    } else {
      A.lHand.visible = false; A.lFore.mesh.visible = false;
    }
  }

  toggleLight() {
    const eq = this.equipment();
    const has = (this.w?.light) || eq.slots.util?.id === 'flashlight';
    if (!has) { bus.emit('notify', { text: 'No light equipped', kind: 'info' }); return; }
    this.lightOn = !this.lightOn;
    bus.emit('sound', { type: 'click', ui: true });
  }

  _lightSource() {
    const eq = this.equipment();
    if (this.w?.light && this.stack?.data) return { stack: this.stack, key: 'charge' };
    if (eq.slots.util?.id === 'flashlight') return { stack: eq.slots.util, key: 'charge' };
    return null;
  }

  _updateLight(dt, ctx) {
    const cam = this.game.renderer.camera;
    const src = this.lightOn ? this._lightSource() : null;
    if (src) {
      const d = src.stack.data || (src.stack.data = { charge: 1 });
      if (d.charge === undefined) d.charge = 1;
      d.charge -= dt / 900; // ~15 minutes per battery
      if (d.charge <= 0) {
        const inv = this.equipment().inventory;
        if (inv.remove('battery', 1)) { d.charge = 1; bus.emit('notify', { text: 'Battery replaced', kind: 'info' }); }
        else { d.charge = 0; this.lightOn = false; bus.emit('notify', { text: 'Battery dead', kind: 'warn' }); }
      }
    }
    const on = !!src && this.lightOn;
    this.spot.intensity = on ? 9 : 0;
    this.spot.position.copy(cam.position);
    const p = new THREE.Vector3(0.2, -0.15, 0);
    this.spot.position.add(p.applyQuaternion(cam.quaternion));
    const fwd = new THREE.Vector3(0, 0, -10).applyQuaternion(cam.quaternion);
    this.spot.target.position.copy(cam.position).add(fwd);
    this.spot.target.updateMatrixWorld();
    void ctx;
  }

  get lightActive() {
    return this.spot.intensity > 0;
  }
}

function easeInOut(t) {
  return t * t * (3 - 2 * t);
}

const seg = (t, a, b) => easeInOut(clamp((t - a) / (b - a), 0, 1));
/**
 * Magazine reload choreography (all values 0..1 over normalised time t):
 * tilt the weapon, hand to the mag, pull it, hand drops away to the pouch and returns
 * with a fresh mag, seats it, then (empty reload) works the charging handle/slide.
 */
function reloadCurve(t, empty) {
  const e = empty ? 0.8 : 1; // empty reloads leave room for the charging handle
  const tilt = seg(t, 0, 0.12) * (1 - seg(t, 0.82 * e + (1 - e) * 0.9, 1));
  const toMag = seg(t, 0.02, 0.16) * (1 - seg(t, 0.68 * e, 0.8 * e));
  const magOut = seg(t, 0.16, 0.3) * (1 - seg(t, 0.46, 0.6 * e));
  const away = seg(t, 0.26, 0.38) * (1 - seg(t, 0.44, 0.56 * e));
  const seat = Math.sin(clamp((t - 0.6 * e) / 0.06, 0, 1) * Math.PI);
  const toCharge = empty ? seg(t, 0.74, 0.8) * (1 - seg(t, 0.92, 1)) : 0;
  const charge = empty ? seg(t, 0.8, 0.86) * (1 - seg(t, 0.86, 0.9)) : 0;
  return { tilt, toMag, magOut, away, seat, toCharge, charge };
}

function randomCone(dir, angle) {
  if (angle <= 0) return { x: dir.x, y: dir.y, z: dir.z };
  // pick a perpendicular basis
  const up = Math.abs(dir.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(dir, up).normalize();
  const v = new THREE.Vector3().crossVectors(dir, u).normalize();
  const phi = Math.random() * Math.PI * 2;
  const s = Math.sin(angle), c = Math.cos(angle);
  const out = new THREE.Vector3().copy(dir).multiplyScalar(c).addScaledVector(u, s * Math.cos(phi)).addScaledVector(v, s * Math.sin(phi)).normalize();
  return { x: out.x, y: out.y, z: out.z };
}

export { randomCone };
void _q;
