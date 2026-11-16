import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { h } from '../ui/dom.js';

// SUNSHINE: a one-off experimental illumination device (Bunker 7 containment room).
// Use it from the inventory: it is set down in front of you, spins up for 3 seconds, then
// burns for exactly 60 seconds and turns to slag. While it burns, everything within 100 m is
// lit as if by a noon sun many times over: one real point light (100 m range), the scene's
// ambient light and exposure raised by how close the camera is, a glare overlay when you
// look towards it, and anyone (AI) within 100 m who faces it is blinded. The item is consumed
// on activation, has no recipe and stacks to one; it only comes back when the bunker's loot
// resets.

export const SUNSHINE = { radius: 100, spinUp: 3, duration: 60 };

export class Sunshine {
  constructor(game) {
    this.game = game;
    this.state = 'idle'; // idle | spinup | burning | spent
    this.t = 0;
    this.pos = null;
    this.mesh = null;
    this.light = new THREE.PointLight(0xfff8e8, 0, SUNSHINE.radius, 1.1);
    // always in the scene (intensity 0 when idle): toggling a light's visibility would make
    // every material recompile its shaders
    game.renderer.scene.add(this.light);
    this.glare = h('div', { class: 'sunshine-glare hidden' });
    document.body.appendChild(this.glare);
    this.burned = 0; // seconds actually burned (tests)
  }

  get active() { return this.state === 'spinup' || this.state === 'burning'; }

  activate(inv) {
    if (this.active) return { ok: false, msg: 'Another device is already running' };
    if (!inv.remove('sunshine', 1)) return { ok: false, msg: 'You do not have it any more' };
    const g = this.game, pc = g.player.controller;
    const fx = -Math.sin(pc.yaw), fz = -Math.cos(pc.yaw);
    const x = pc.pos.x + fx * 1.6, z = pc.pos.z + fz * 1.6;
    const y = g.physics.groundHeight ? g.physics.groundHeight(x, z, 0.2, pc.pos.y + 1.5) : g.world.heightAt(x, z);
    this.pos = new THREE.Vector3(x, Number.isFinite(y) ? y : pc.pos.y, z);
    this._buildMesh();
    this.state = 'spinup';
    this.t = 0;
    this.burned = 0;
    bus.emit('sound', { type: 'sunshineSpin', x: this.pos.x, y: this.pos.y, z: this.pos.z });
    bus.emit('sunshine:activated', { x, z });
    return { ok: true, msg: 'SUNSHINE armed — spinning up. Look away!' };
  }

  _buildMesh() {
    const g = this.game;
    if (this.mesh) g.renderer.scene.remove(this.mesh);
    const root = new THREE.Group();
    const brass = new THREE.MeshStandardMaterial({ color: 0xb8973a, metalness: 0.8, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a28, metalness: 0.6, roughness: 0.5 });
    this.coreMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c8, emissiveIntensity: 0.2, roughness: 0.2 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.18, 16), dark);
    base.position.y = 0.09;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.5, 16), brass);
    body.position.y = 0.43;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), this.coreMat);
    core.position.y = 0.78;
    for (let i = 0; i < 3; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.22), dark);
      const a = (i / 3) * Math.PI * 2;
      fin.position.set(Math.cos(a) * 0.24, 0.42, Math.sin(a) * 0.24);
      fin.rotation.y = -a;
      root.add(fin);
    }
    root.add(base, body, core);
    root.position.copy(this.pos);
    g.renderer.scene.add(root);
    this.mesh = root;
    this.core = core;
  }

  update(dt) {
    const g = this.game;
    const L = g.lighting;
    if (!this.active) { if (L) L.sunshineK = 0; this.glare.classList.add('hidden'); this.light.intensity = 0; return; }
    this.t += dt;
    const cam = g.renderer.camera;
    if (this.state === 'spinup') {
      const k = Math.min(1, this.t / SUNSHINE.spinUp);
      this.coreMat.emissiveIntensity = 0.2 + k * k * 6 * (0.6 + 0.4 * Math.sin(this.t * 30));
      this.mesh.children.forEach((c, i) => { if (i < 3) c.rotation.y += dt * k * 20; });
      this.light.position.set(this.pos.x, this.pos.y + 1.2, this.pos.z);
      this.light.intensity = k * k * 300;
      if (this.t >= SUNSHINE.spinUp) {
        this.state = 'burning';
        this.t = 0;
        bus.emit('sound', { type: 'sunshineBurst', x: this.pos.x, y: this.pos.y, z: this.pos.z });
        bus.emit('noise', { x: this.pos.x, y: this.pos.y, z: this.pos.z, radius: 400, source: g.player.character, type: 'gunshot' });
        if (g.nightVision?.on) { g.nightVision.on = false; bus.emit('notify', { text: 'Night vision overloaded and shut down', kind: 'warn' }); }
      }
      if (L) L.sunshineK = 0;
      return;
    }
    // burning: exactly SUNSHINE.duration seconds
    this.burned = Math.min(SUNSHINE.duration, this.t);
    const fade = this.t > SUNSHINE.duration - 1.5 ? Math.max(0, (SUNSHINE.duration - this.t) / 1.5) : 1;
    const flick = 0.92 + Math.random() * 0.08;
    this.light.position.set(this.pos.x, this.pos.y + 1.2, this.pos.z);
    this.light.intensity = 9000 * fade * flick;
    this.coreMat.emissiveIntensity = 40 * fade;
    const d = cam.position.distanceTo(this.pos);
    const near = Math.max(0, 1 - d / SUNSHINE.radius);
    if (L) L.sunshineK = near * fade;
    // glare when looking towards it (blocked by walls)
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const to = this.pos.clone().setY(this.pos.y + 0.8).sub(cam.position).normalize();
    const facing = Math.max(0, fwd.dot(to));
    const seen = g.physics.lineOfSight(cam.position.x, cam.position.y, cam.position.z, this.pos.x, this.pos.y + 0.8, this.pos.z);
    const glare = seen ? Math.min(0.97, (Math.pow(facing, 6) * 0.9 + near * 0.25) * fade) : near * 0.12 * fade;
    this.glare.classList.toggle('hidden', glare < 0.02);
    this.glare.style.opacity = glare.toFixed(3);
    // blind the AI that look at it
    this._aiT = (this._aiT || 0) - dt;
    if (this._aiT <= 0) {
      this._aiT = 0.5;
      for (const a of g.ai.agents) {
        if (!a.alive) continue;
        const dx = this.pos.x - a.pos.x, dz = this.pos.z - a.pos.z, dist = Math.hypot(dx, dz);
        if (dist > SUNSHINE.radius) continue;
        const ay = -Math.sin(a.yaw) * dx / (dist || 1) - Math.cos(a.yaw) * dz / (dist || 1);
        if (ay < 0.3 && dist > 12) continue;
        if (!g.physics.lineOfSight(a.pos.x, a.pos.y + 1.6, a.pos.z, this.pos.x, this.pos.y + 0.8, this.pos.z)) continue;
        a.blindT = Math.max(a.blindT || 0, 1.5);
        a.suppression = Math.min(1, (a.suppression || 0) + 0.3);
      }
    }
    if (this.t >= SUNSHINE.duration) this._burnOut();
  }

  _burnOut() {
    const g = this.game;
    this.state = 'spent';
    this.light.intensity = 0;
    if (g.lighting) g.lighting.sunshineK = 0;
    this.glare.classList.add('hidden');
    this.coreMat.emissiveIntensity = 0;
    this.coreMat.color.set(0x1a1612);
    this.mesh.traverse((o) => { if (o.material && o.material !== this.coreMat) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.25); } });
    g.effects.emit(this.pos.x, this.pos.y + 0.8, this.pos.z, { color: [0.25, 0.24, 0.22], count: 30, speed: 1.2, size: 0.5, life: 4, gravity: -0.6, grow: 1.4, alpha: 0.6 });
    bus.emit('sound', { type: 'sunshineDie', x: this.pos.x, y: this.pos.y, z: this.pos.z });
    bus.emit('notify', { text: 'SUNSHINE burns out with a crack. Nothing left but a fused, blackened shell.', kind: 'info' });
    bus.emit('sunshine:spent', {});
  }

  clear() {
    if (this.mesh) this.game.renderer.scene.remove(this.mesh);
    this.mesh = null;
    this.state = 'idle';
    this.light.intensity = 0;
    this.glare.classList.add('hidden');
    if (this.game.lighting) this.game.lighting.sunshineK = 0;
  }
}
