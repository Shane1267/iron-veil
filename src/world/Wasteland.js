import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { wasteUniforms } from './TerrainManager.js';
import { h } from '../ui/dom.js';

// The Launch Site rocket is fuelled. A rocket-launcher hit sets it off: a fireball and
// shockwave that kill the shooter and everything within 1.2 km, wreck vehicles and bases
// near the site, and leave the southern half of the map (z > 0, the "bottom" of the map)
// a wasteland for five in-game days: ground and plants burnt to ash, a dirty haze, falling
// ash, and fallout that hurts anyone outdoors (badly near ground zero). Buildings, vehicles
// with a roof, the underground and iodine tablets protect. After five days the land
// recovers and a new rocket stands on the pad.

export const WASTE_DAYS = 5;
const GZ_RADIUS = 700;

export class Wasteland {
  constructor(game) {
    this.game = game;
    this.until = null; // game minute the wasteland ends
    this.gz = null; // ground zero {x, y, z}
    this.k = 0; // tint strength 0..1
    this.blast = null; // running detonation effect
    this.dose = 0;
    this.overlay = h('div', { class: 'mega-flash hidden' });
    document.body.appendChild(this.overlay);
    this.chip = h('div', { class: 'fallout-chip hidden' });
    document.body.appendChild(this.chip);
    bus.on('rocket:impact', (e) => this._impact(e));
    bus.on('poi:built', (rt) => { if (rt.poi.id === 'launch_site') this._applySite(rt); });
  }

  get active() { return this.until !== null; }
  inZone(x, z) { return this.active && z > 0; }
  daysLeft() { return this.active ? Math.max(0, (this.until - this.game.clock.gameMinutes) / 1440) : 0; }

  _site() { return this.game.pois.active?.get('launch_site') || null; }

  _impact(e) {
    if (this.active || this.blast) return;
    const rt = this._site();
    const r = rt?.rocket;
    if (!r || !r.mesh.visible) return;
    if (Math.hypot(e.x - r.x, e.z - r.z) > 9 || e.y < r.y - 2 || e.y > r.y + 42) return;
    this.detonate({ x: r.x, y: r.y, z: r.z });
  }

  detonate(gz) {
    const g = this.game;
    this.gz = gz;
    this.until = g.clock.gameMinutes + WASTE_DAYS * 1440;
    // fireball and shockwave ring
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 1 }));
    ball.position.set(gz.x, gz.y + 10, gz.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(gz.x, gz.y + 1.5, gz.z);
    g.renderer.scene.add(ball, ring);
    this.blast = { t: 0, ball, ring, killed: false };
    this.overlay.classList.remove('hidden');
    this.overlay.style.opacity = '1';
    bus.emit('sound', { type: 'megaBlast', ui: true });
    g.player.controller.shake += 6;
    this._applySite(this._site());
    bus.emit('notify', { text: 'THE ROCKET DETONATES.', kind: 'warn', key: 'megablast' });
    bus.emit('wasteland:started', { until: this.until });
  }

  _kill() {
    const g = this.game, gz = this.gz;
    // everything near ground zero
    for (const a of [...g.ai.alive()]) if (Math.hypot(a.pos.x - gz.x, a.pos.z - gz.z) < 1200) a.onHit({ zone: 'torso', base: 99999, weapon: null, distance: 0, mul: 1, shooter: null, dir: { x: 0, y: 1, z: 0 }, cause: 'explosion' });
    for (const v of g.vehicles.vehicles.values()) { const d = Math.hypot(v.pos.x - gz.x, v.pos.z - gz.z); if (d < 350 && v !== g.vehicles.current) v.damage(99999); }
    for (const p of [...g.base.pieces.values()]) { const d = Math.hypot(p.x - gz.x, p.z - gz.z); if (d < 450) g.base.damagePiece(p, p.maxHealth * (1.2 - d / 450)); }
    for (let i = 0; i < 40; i++) { const a = Math.random() * 6.283, d = Math.random() * 60; g.effects.emit(gz.x + Math.cos(a) * d, gz.y + 2 + Math.random() * 30, gz.z + Math.sin(a) * d, { color: [0.2, 0.18, 0.16], count: 4, speed: 6, size: 5, life: 9, gravity: -1.5, grow: 1.6, alpha: 0.7 }); }
    // the shooter does not walk away from this (underground excepted: the facility is 400 m down)
    const pc = g.player.controller;
    if (pc.pos.y > -200) {
      if (g.vehicles.current) g.vehicles.exit(g.player, true);
      g.player.survival.health = 0;
      g.player.survival.damage(99999, { cause: 'explosion', force: true });
      bus.emit('notify', { text: 'You were caught in the blast. The south of Vesper is now a wasteland for five days.', kind: 'warn' });
    }
  }

  /** Rocket and crater on the pad follow the state. */
  _applySite(rt) {
    if (!rt?.rocket) return;
    const r = rt.rocket;
    r.mesh.visible = !this.active;
    r.collider.enabled = !this.active;
    if (this.active && !r.crater) {
      const grp = new THREE.Group();
      const scorch = new THREE.Mesh(new THREE.CircleGeometry(46, 32), new THREE.MeshStandardMaterial({ color: 0x0e0c0a, roughness: 1, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
      scorch.rotation.x = -Math.PI / 2;
      scorch.position.set(r.x, r.y + 0.72, r.z);
      grp.add(scorch);
      const mat = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.9, metalness: 0.4 });
      let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < 26; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.6 + rnd() * 3, 0.3 + rnd() * 1.2, 0.5 + rnd() * 2.4), mat);
        const a = rnd() * 6.283, d = 3 + rnd() * 34;
        m.position.set(r.x + Math.cos(a) * d, r.y + 0.8 + rnd() * 0.5, r.z + Math.sin(a) * d);
        m.rotation.set(rnd() * 3, rnd() * 6, rnd() * 3);
        grp.add(m);
      }
      // the toppled lower stage
      const stage = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 9, 16), mat);
      stage.rotation.z = Math.PI / 2 - 0.12; stage.position.set(r.x + 9, r.y + 2.2, r.z + 6); stage.rotation.y = 0.7;
      grp.add(stage);
      rt.group.add(grp);
      r.crater = grp;
    }
    if (r.crater) r.crater.visible = this.active;
  }

  update(dt) {
    const g = this.game;
    // detonation animation (runs on real frames even at dt 0)
    if (this.blast) {
      const B = this.blast;
      B.t += Math.max(dt, 1 / 60);
      const s = 1 + B.t * 70;
      B.ball.scale.setScalar(Math.min(160, s));
      B.ball.material.opacity = Math.max(0, 1 - B.t / 5);
      B.ring.scale.setScalar(1 + B.t * 340);
      B.ring.material.opacity = Math.max(0, 0.8 - B.t / 6);
      this.overlay.style.opacity = Math.max(0, 1 - Math.max(0, B.t - 0.8) / 3.5).toFixed(3);
      g.player.controller.shake += dt * 3 * Math.max(0, 1 - B.t / 4);
      if (!B.killed && B.t > 0.5) { B.killed = true; this._kill(); }
      if (B.t > 7) { g.renderer.scene.remove(B.ball, B.ring); this.overlay.classList.add('hidden'); this.blast = null; }
    }
    // end of the wasteland
    if (this.active && g.clock.gameMinutes >= this.until) {
      this.until = null;
      this.gz = null;
      this.dose = 0;
      this._applySite(this._site());
      bus.emit('notify', { text: 'The fallout over southern Vesper has cleared. The land is recovering — and there is a new rocket on the pad.', kind: 'good' });
      bus.emit('wasteland:ended', {});
    }
    this.k += ((this.active ? 1 : 0) - this.k) * Math.min(1, Math.max(dt, 0.016) * 0.5);
    if (Math.abs(this.k - (this.active ? 1 : 0)) < 0.002) this.k = this.active ? 1 : 0;
    wasteUniforms.uWaste.value = this.k;
    const pc = g.player.controller;
    const eye = g.renderer.camera.position;
    const inside = this.active && eye.y > -200 ? Math.min(1, Math.max(0, (eye.z + 60) / 120)) : 0;
    if (g.lighting) g.lighting.wasteK = inside * this.k;
    const surv = g.player.survival;
    let show = false;
    if (inside > 0.5 && dt > 0 && g.started) {
      // falling ash
      this._ashT = (this._ashT || 0) - dt;
      if (this._ashT <= 0) {
        this._ashT = 0.12;
        for (let i = 0; i < 3; i++) g.effects.emit(eye.x + (Math.random() - 0.5) * 30, eye.y + 4 + Math.random() * 6, eye.z + (Math.random() - 0.5) * 30, { color: [0.62, 0.6, 0.57], count: 1, speed: 0.4, size: 0.07, life: 6, gravity: 0.6, alpha: 0.8 });
      }
      // fallout: outdoors only; a roofed vehicle, a building or iodine protects from the zone
      // dose, nothing but distance protects near ground zero
      const sheltered = g.indoor || (g.vehicles.current && !g.vehicles.current.t.flying);
      const d = this.gz ? Math.hypot(pc.pos.x - this.gz.x, pc.pos.z - this.gz.z) : 1e9;
      const hot = d < GZ_RADIUS ? 1 - d / GZ_RADIUS : 0;
      let rate = 0;
      if (!sheltered && !(surv.radT > 0)) rate += 0.12;
      rate += hot * (sheltered ? 0.6 : 2.2);
      if (rate > 0 && !g.debug?.flags?.god) g.player.survival.damage(rate * dt, { cause: 'radiation', silent: true });
      this.dose = rate;
      this._clickT = (this._clickT || 0) - dt;
      if (rate > 0 && this._clickT <= 0) { this._clickT = Math.max(0.04, 0.5 / (1 + rate * 6)) * (0.5 + Math.random()); bus.emit('sound', { type: 'geiger', ui: true }); }
      show = true;
      this.chip.textContent = hot > 0 ? `RADIATION — ground zero ${Math.round(d)} m` : sheltered ? 'FALLOUT ZONE — sheltered' : surv.radT > 0 ? `FALLOUT ZONE — iodine ${Math.ceil(surv.radT / 60)} min` : 'FALLOUT — get indoors or take iodine';
      this.chip.classList.toggle('hot', rate > 0);
    }
    this.chip.classList.toggle('hidden', !show || g.ui.mode !== 'playing');
  }

  serialize() { return { until: this.until, gz: this.gz }; }

  deserialize(o) {
    this.until = Number.isFinite(o?.until) ? o.until : null;
    this.gz = this.until !== null && o?.gz && Number.isFinite(o.gz.x) ? o.gz : null;
    if (this.until !== null && !this.gz) this.until = null;
    this.k = this.active ? 1 : 0;
    if (this.blast) { this.game.renderer.scene.remove(this.blast.ball, this.blast.ring); this.blast = null; }
    this.overlay.classList.add('hidden');
    this._applySite(this._site());
  }
}
