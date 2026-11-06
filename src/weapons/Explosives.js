// Grenades, smoke, stun grenades, fire bottles and demolition charges.
//   Q throws the selected throwable (Shift+Q picks the next type you carry).
//   Demolition charges are planted with Use and set off with a Remote Detonator.
// Explosions hurt everyone in the blast with a clear line to it (armour applies), wreck
// base pieces and vehicles, break glass and are heard far away. Smoke clouds block sight
// for everyone, AI included. Stun grenades blind AI and white out the player's screen.
import * as THREE from 'three';
import { ItemDB } from '../items/ItemDatabase.js';
import { bus } from '../core/EventBus.js';
import { h } from '../ui/dom.js';

const GRAV = 9.8;
const THROW_TYPES = ['grenade_frag', 'grenade_smoke', 'grenade_flash', 'molotov'];
const _v = new THREE.Vector3();

export class Explosives {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
    this.smokes = [];
    this.fires = [];
    this.charges = [];
    this.selected = 'grenade_frag';
    this.cooldown = 0;
    this.flashEl = h('div', { class: 'stun-flash hidden' });
    document.body.appendChild(this.flashEl);
    this.stunT = 0;
    game.physics.smokes = this.smokes;
    const gm = (c, r, e) => new THREE.MeshStandardMaterial({ color: c, roughness: r, emissive: e || 0x000000 });
    this.mats = { grenade_frag: gm(0x3e4a30, 0.7), grenade_smoke: gm(0x7a7a74, 0.6), grenade_flash: gm(0x4a4a48, 0.6), molotov: gm(0x7a5a2a, 0.2), c4: gm(0xc8c0a0, 0.9), led: gm(0x300000, 0.5, 0xff2010) };
    this.geo = { sphere: new THREE.SphereGeometry(0.045, 10, 8), can: new THREE.CylinderGeometry(0.032, 0.032, 0.12, 10), bottle: new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10), c4: new THREE.BoxGeometry(0.16, 0.05, 0.1), led: new THREE.BoxGeometry(0.02, 0.012, 0.02) };
  }

  // ------------------------------------------------------------ player input
  /** Throwables you carry, in a fixed order. */
  carried() {
    const inv = this.game.player.equipment.inventory;
    return THROW_TYPES.filter((id) => inv.count(id) > 0);
  }

  cycle() {
    const list = this.carried();
    if (!list.length) { bus.emit('notify', { text: 'No grenades', kind: 'info' }); return; }
    const i = list.indexOf(this.selected);
    this.selected = list[(i + 1) % list.length];
    bus.emit('notify', { text: `Throwing: ${ItemDB.get(this.selected).name}`, kind: 'info', key: 'throwsel' });
    bus.emit('sound', { type: 'click', ui: true });
  }

  throwSelected() {
    const g = this.game;
    if (this.cooldown > 0 || g.vehicles.current) return;
    const list = this.carried();
    if (!list.length) { bus.emit('notify', { text: 'No grenades to throw', kind: 'info' }); return; }
    if (!list.includes(this.selected)) this.selected = list[0];
    const id = this.selected;
    if (g.player.equipment.inventory.remove(id, 1) !== 1) return;
    const cam = g.renderer.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const pos = cam.position.clone().addScaledVector(fwd, 0.4).add(new THREE.Vector3(0, -0.1, 0));
    const pc = g.player.controller;
    const speed = pc.stance === 'prone' ? 9 : 15;
    const vel = fwd.multiplyScalar(speed).add(new THREE.Vector3(0, 3.2, 0)).add(new THREE.Vector3(pc.vel?.x || 0, 0, pc.vel?.z || 0));
    this.spawn(id, pos, vel, g.player.character);
    this.cooldown = 0.9;
    bus.emit('sound', { type: 'swing', x: pos.x, y: pos.y, z: pos.z });
    if (!this.carried().includes(id)) { const next = this.carried()[0]; if (next) this.selected = next; }
  }

  /** Launch a throwable (players and AI alike). */
  spawn(id, pos, vel, owner) {
    const def = ItemDB.get(id).throw;
    const mesh = new THREE.Mesh(id === 'molotov' ? this.geo.bottle : id === 'grenade_frag' ? this.geo.sphere : this.geo.can, this.mats[id]);
    mesh.castShadow = true;
    mesh.position.copy(pos);
    this.game.renderer.scene.add(mesh);
    this.projectiles.push({ id, def, pos: pos.clone(), vel: vel.clone(), fuse: def.fuse, mesh, owner, rest: false, spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8) });
  }

  // ------------------------------------------------------------ demolition charges
  plant() {
    const g = this.game, cam = g.renderer.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const o = cam.position;
    const hit = g.physics.raycast(o.x, o.y, o.z, fwd.x, fwd.y, fwd.z, 3.2, (c) => c.blocksMove || c.blocksShots);
    if (!hit) return { ok: false, msg: 'Look at a wall, door or the ground within reach' };
    const p = o.clone().addScaledVector(fwd, hit.t - 0.03);
    const n = hit.collider ? this._boxNormal(hit.collider, p) : g.world.normalAt(p.x, p.z, new THREE.Vector3());
    const mesh = new THREE.Group();
    const block = new THREE.Mesh(this.geo.c4, this.mats.c4);
    block.position.y = 0.025;
    const led = new THREE.Mesh(this.geo.led, this.mats.led);
    led.position.set(0.05, 0.055, 0);
    mesh.add(block, led);
    mesh.position.copy(p);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(n.x, n.y, n.z));
    g.renderer.scene.add(mesh);
    this.charges.push({ pos: p.clone(), mesh, led, t: 0 });
    bus.emit('sound', { type: 'click', x: p.x, y: p.y, z: p.z });
    return { ok: true, msg: `Charge planted (${this.charges.length} armed) — use the Remote Detonator to set it off` };
  }

  detonate() {
    const g = this.game, pp = g.player.controller.pos;
    const list = this.charges.filter((c) => c.pos.distanceTo(pp) < 600);
    if (!list.length) return { ok: false, msg: 'No charges in range' };
    list.forEach((c, i) => setTimeout(() => {
      g.renderer.scene.remove(c.mesh);
      this.charges.splice(this.charges.indexOf(c), 1);
      this.explode(c.pos.x, c.pos.y, c.pos.z, { radius: 7, damage: 260, structure: 1700, owner: g.player.character });
    }, i * 120));
    return { ok: true, msg: `Detonating ${list.length} charge${list.length > 1 ? 's' : ''}` };
  }

  _boxNormal(c, p) {
    if (c.type !== 'box') return { x: Math.sign(p.x - c.x) || 1, y: 0, z: 0 };
    const d = [[p.x - c.minX, -1, 0, 0], [c.maxX - p.x, 1, 0, 0], [p.y - c.minY, 0, -1, 0], [c.maxY - p.y, 0, 1, 0], [p.z - c.minZ, 0, 0, -1], [c.maxZ - p.z, 0, 0, 1]];
    d.sort((a, b) => Math.abs(a[0]) - Math.abs(b[0]));
    return { x: d[0][1], y: d[0][2], z: d[0][3] };
  }

  // ------------------------------------------------------------ effects
  /** Blast at (x, y, z). opts: radius, damage, structure (damage to base pieces), owner. */
  explode(x, y, z, opts = {}) {
    const g = this.game;
    const R = opts.radius || 8, D = opts.damage || 150;
    const fx = g.effects;
    fx.worldFlash?.(x, y + 0.4, z, 5, true);
    fx.flashLight?.(x, y + 1, z, 12);
    fx.emit(x, y + 0.3, z, { color: [1.4, 0.75, 0.25], count: 40, speed: 9, size: 0.35, dir: { x: 0, y: 1.2, z: 0 }, spread: 2.2, life: 0.45, gravity: 2, alpha: 1 });
    fx.emit(x, y + 0.5, z, { color: [0.18, 0.17, 0.16], count: 30, speed: 3.5, size: 1.4, dir: { x: 0, y: 1.6, z: 0 }, spread: 1.6, life: 4.5, gravity: -0.3, grow: 1.4, alpha: 0.55 });
    fx.emit(x, y + 0.2, z, { color: [0.35, 0.3, 0.24], count: 28, speed: 11, size: 0.08, dir: { x: 0, y: 1.6, z: 0 }, spread: 2.5, life: 1.6, gravity: 9.8, alpha: 1 });
    fx.decal?.({ x, y: g.world.heightAt(x, z) + 0.02, z }, { x: 0, y: 1, z: 0 }, [0.05, 0.045, 0.04], R * 0.35);
    bus.emit('sound', { type: 'explosion', x, y, z });
    bus.emit('noise', { x, y, z, radius: 650, source: opts.owner || null, type: 'gunshot' });
    // people
    for (const c of [...g.characters.list]) {
      if (!c.alive) continue;
      const cy = c.pos.y + (c.stance === 'prone' ? 0.3 : 0.9);
      const d = Math.hypot(c.pos.x - x, cy - y, c.pos.z - z);
      if (d > R * 1.8) continue;
      if (d < R && g.physics.lineOfFire(x, y + 0.3, z, c.pos.x, cy, c.pos.z, c.colliderOwner)) {
        const k = Math.pow(1 - d / R, 1.3);
        const dir = _v.set(c.pos.x - x, 0.3, c.pos.z - z).normalize();
        c.onHit({ zone: 'torso', base: D * k, weapon: null, distance: d, mul: 1, shooter: opts.owner || null, dir: { x: dir.x, y: dir.y, z: dir.z }, point: { x: c.pos.x, y: cy, z: c.pos.z }, cause: 'explosion' });
      }
      c.onSuppressed?.({ distance: d, x, y, z, explosion: true });
    }
    g.turrets?.blast(x, y, z, R, (opts.structure ?? D * 2));
    // camera shake for the player by distance
    const pp = g.player.controller.pos;
    const dp = Math.hypot(pp.x - x, pp.y - y, pp.z - z);
    if (dp < R * 6) g.player.controller.shake += Math.max(0, 2.5 * (1 - dp / (R * 6)));
    // base pieces, vehicles, glass
    for (const p of [...g.base.pieces.values()]) {
      const d = Math.hypot(p.x - x, p.y + 1 - y, p.z - z);
      if (d < R) g.base.damagePiece(p, (opts.structure ?? D * 2) * (1 - d / R));
    }
    for (const v of g.vehicles.vehicles.values()) {
      const d = Math.hypot(v.pos.x - x, v.pos.z - z);
      if (d < R && !v.destroyed) v.damage(D * 2 * (1 - d / R));
    }
    const near = g.physics.query(x - R, z - R, x + R, z + R, []);
    for (const c of near) if (c.glass && !c.glass.broken && Math.hypot(c.x ?? (c.minX + c.maxX) / 2 - x, (c.z ?? (c.minZ + c.maxZ) / 2) - z) < R) g.ballistics.onGlass?.(c.glass);
  }

  _smoke(x, y, z, def) {
    this.smokes.push({ x, y: y + 1.2, z, r: 0.5, maxR: def.radius || 9, t: 0, dur: def.duration || 38 });
    bus.emit('sound', { type: 'smoke', x, y, z });
  }

  _stun(x, y, z, def) {
    const g = this.game, R = def.radius || 12;
    g.effects.worldFlash?.(x, y + 0.5, z, 6, true);
    g.effects.flashLight?.(x, y + 1, z, 20);
    bus.emit('sound', { type: 'explosion', x, y, z, small: true });
    for (const a of g.ai.agents) {
      if (!a.alive) continue;
      const d = Math.hypot(a.pos.x - x, a.pos.z - z);
      if (d > R || !g.physics.lineOfSight(x, y + 0.4, z, a.pos.x, a.pos.y + 1.5, a.pos.z, a.id)) continue;
      a.blindT = 6 * (1 - d / R) + 1.5;
      a.suppression = 1;
      a.morale = Math.max(0, a.morale - 0.2);
    }
    const pp = g.player.controller.pos, cam = g.renderer.camera;
    const d = Math.hypot(pp.x - x, pp.z - z);
    if (d < R && g.physics.lineOfSight(x, y + 0.4, z, cam.position.x, cam.position.y, cam.position.z, null)) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const to = new THREE.Vector3(x - cam.position.x, y - cam.position.y, z - cam.position.z).normalize();
      const facing = fwd.dot(to) > 0.2 ? 1 : 0.4;
      this.stunT = Math.max(this.stunT, (5 * (1 - d / R) + 0.8) * facing);
    }
    bus.emit('noise', { x, y, z, radius: 450, source: null, type: 'gunshot' });
  }

  _fire(x, y, z, def) {
    this.fires.push({ x, y: this.game.world.heightAt(x, z) > y - 2 ? Math.max(y, this.game.world.heightAt(x, z)) : y, z, r: def.radius || 4, t: 0, dur: def.duration || 12, tick: 0 });
    bus.emit('sound', { type: 'glass', x, y, z });
  }

  _go(p) {
    const { x, y, z } = p.pos;
    this.game.renderer.scene.remove(p.mesh);
    const t = p.def.type;
    if (t === 'frag') this.explode(x, y + 0.1, z, { radius: p.def.radius, damage: p.def.damage, structure: 260, owner: p.owner });
    else if (t === 'smoke') this._smoke(x, y, z, p.def);
    else if (t === 'flash') this._stun(x, y, z, p.def);
    else if (t === 'fire') this._fire(x, y, z, p.def);
  }

  // ------------------------------------------------------------ per frame
  update(dt) {
    const g = this.game, phys = g.physics;
    this.cooldown = Math.max(0, this.cooldown - dt);
    for (const p of [...this.projectiles]) {
      p.fuse -= dt;
      if (!p.rest) {
        p.vel.y -= GRAV * dt;
        const step = p.vel.length() * dt;
        if (step > 1e-4) {
          const dir = _v.copy(p.vel).normalize();
          const hit = phys.raycast(p.pos.x, p.pos.y, p.pos.z, dir.x, dir.y, dir.z, step + 0.05, (c) => (c.blocksMove || c.blocksShots) && c.owner !== p.owner?.colliderOwner && c.tag !== 'character');
          if (hit) {
            p.pos.addScaledVector(dir, Math.max(0, hit.t - 0.06));
            if (p.def.type === 'fire') { p.fuse = 0; }
            else {
              const n = hit.collider ? this._boxNormal(hit.collider, p.pos) : g.world.normalAt(p.pos.x, p.pos.z, {});
              const vn = p.vel.x * n.x + p.vel.y * n.y + p.vel.z * n.z;
              p.vel.set(p.vel.x - 2 * vn * n.x, p.vel.y - 2 * vn * n.y, p.vel.z - 2 * vn * n.z).multiplyScalar(0.38);
              if (n.y > 0.6 && p.vel.length() < 1.2) { p.rest = true; p.vel.set(0, 0, 0); }
              if (Math.abs(vn) > 3) bus.emit('footstep', { x: p.pos.x, y: p.pos.y, z: p.pos.z, surface: hit.material === 'terrain' ? 'dirt' : hit.material, volume: 0.4 });
            }
          } else p.pos.addScaledVector(dir, step);
        }
        p.mesh.rotation.x += p.spin.x * dt; p.mesh.rotation.z += p.spin.z * dt;
      }
      p.mesh.position.copy(p.pos);
      // the smoke canister pours out smoke from where it lies
      if (p.fuse <= 0) { this.projectiles.splice(this.projectiles.indexOf(p), 1); this._go(p); }
    }
    // smoke clouds: grow, hold, thin out
    for (const s of [...this.smokes]) {
      s.t += dt;
      const life = s.t / s.dur;
      s.r = Math.min(s.maxR, 0.8 + s.t * 2.2) * (life > 0.8 ? Math.max(0.05, (1 - life) / 0.2) : 1);
      if (Math.random() < dt * (life < 0.8 ? 22 : 8)) {
        const a = Math.random() * Math.PI * 2, rr = Math.random() * s.r * 0.7;
        g.effects.emit(s.x + Math.cos(a) * rr, s.y - 0.9 + Math.random() * 1.5, s.z + Math.sin(a) * rr, { color: [0.78, 0.78, 0.76], count: 1, speed: 0.4, size: 2.4, dir: { x: 0, y: 0.25, z: 0 }, spread: 0.6, life: 7, gravity: -0.05, grow: 0.9, alpha: 0.55 });
      }
      if (s.t >= s.dur) this.smokes.splice(this.smokes.indexOf(s), 1);
    }
    // fires: flames, light, burning
    for (const f of [...this.fires]) {
      f.t += dt;
      f.tick -= dt;
      for (let i = 0; i < 3; i++) g.effects.fireEmbers(f.x + (Math.random() - 0.5) * f.r * 1.4, f.y + 0.1, f.z + (Math.random() - 0.5) * f.r * 1.4);
      if (Math.random() < dt * 6) g.effects.flashLight?.(f.x, f.y + 1, f.z, 3);
      if (f.tick <= 0) {
        f.tick = 0.5;
        for (const c of g.characters.list) {
          if (!c.alive || Math.hypot(c.pos.x - f.x, c.pos.z - f.z) > f.r || Math.abs(c.pos.y - f.y) > 2) continue;
          c.onHit({ zone: 'leg', base: 9, weapon: null, distance: 0, mul: 1, shooter: null, dir: { x: 0, y: 1, z: 0 }, cause: 'fire' });
        }
        for (const p of g.base.pieces.values()) if (p.def.material === 'wood' && Math.hypot(p.x - f.x, p.z - f.z) < f.r) g.base.damagePiece(p, 12);
      }
      if (f.t >= f.dur) this.fires.splice(this.fires.indexOf(f), 1);
    }
    // charges blink
    for (const c of this.charges) { c.t += dt; c.led.visible = (c.t % 1) < 0.15; }
    // stun on the player
    this.stunT = Math.max(0, this.stunT - dt);
    this.flashEl.classList.toggle('hidden', this.stunT <= 0);
    if (this.stunT > 0) this.flashEl.style.opacity = Math.min(1, this.stunT / 2).toFixed(3);
  }

  clear() {
    for (const p of this.projectiles) this.game.renderer.scene.remove(p.mesh);
    for (const c of this.charges) this.game.renderer.scene.remove(c.mesh);
    this.projectiles.length = 0;
    this.smokes.length = 0;
    this.fires.length = 0;
    this.charges.length = 0;
    this.stunT = 0;
  }
}
