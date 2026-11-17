import * as THREE from 'three';
import { bus } from '../core/EventBus.js';

// Elevator ride. The car is a closed cab built around the player; outside its mesh-grille
// walls the shaft (concrete rings, lamps, guide rails) slides past for six seconds. The
// surface and the facility are 400 m apart in the world, so at the midpoint the cab and
// its passenger are moved to the destination in one frame: inside the closed, self-lit cab
// nothing changes on screen. Movement is locked for the ride; a chime plays on arrival.

const RIDE = 6.5, SPEED = 9;

export class Elevator {
  constructor(game) {
    this.game = game;
    this.active = null;
  }

  get riding() { return !!this.active; }

  _build() {
    const g = new THREE.Group();
    const basic = (c) => new THREE.MeshBasicMaterial({ color: c });
    const cabM = basic(0x2a2d2e), trimM = basic(0x8a7a3a), lampM = basic(0xfff2d0), floorM = basic(0x1c1d1e);
    const box = (m, x, y, z, w, h, d, parent = g) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); parent.add(o); return o; };
    // cab: floor, ceiling with a light panel, corner posts, waist rail, grille bars
    box(floorM, 0, -0.05, 0, 2.6, 0.1, 2.6);
    box(cabM, 0, 2.65, 0, 2.6, 0.1, 2.6);
    box(lampM, 0, 2.59, 0, 1.2, 0.02, 0.6);
    for (const [x, z] of [[-1.25, -1.25], [1.25, -1.25], [-1.25, 1.25], [1.25, 1.25]]) box(cabM, x, 1.3, z, 0.1, 2.6, 0.1);
    for (const [x, z, w, d] of [[0, -1.27, 2.5, 0.05], [0, 1.27, 2.5, 0.05], [-1.27, 0, 0.05, 2.5], [1.27, 0, 0.05, 2.5]]) {
      box(trimM, x, 1.0, z, w, 0.06, d);
      box(cabM, x, 0.5, z, w, 1.0, d * 0.6);
      for (let i = -4; i <= 4; i++) box(cabM, x + (w > d ? i * 0.28 : 0), 1.85, z + (w > d ? 0 : i * 0.28), 0.025, 1.6, 0.025);
    }
    // control panel
    box(basic(0x101112), 1.2, 1.3, 0.6, 0.04, 0.5, 0.3);
    this.dot = box(basic(0x30ff60), 1.17, 1.42, 0.6, 0.02, 0.05, 0.05);
    // shaft: a tall sleeve of concrete with ring beams, lamps and rails that moves past
    const shaft = new THREE.Group();
    const wallM = basic(0x3a3936), ringM = basic(0x24231f), railM = basic(0x55524a);
    const H = 160;
    for (const [x, z, w, d] of [[0, -1.9, 4.2, 0.2], [0, 1.9, 4.2, 0.2], [-1.9, 0, 0.2, 4.2], [1.9, 0, 0.2, 4.2]]) box(wallM, x, 0, z, w, H, d, shaft);
    for (let y = -H / 2; y < H / 2; y += 4) {
      for (const [x, z, w, d] of [[0, -1.75, 3.8, 0.14], [0, 1.75, 3.8, 0.14], [-1.75, 0, 0.14, 3.8], [1.75, 0, 0.14, 3.8]]) box(ringM, x, y, z, w, 0.3, d, shaft);
      if ((y / 4) % 2 === 0) box(lampM, -1.72, y + 1.6, 1.0, 0.06, 0.5, 0.12, shaft);
      box(basic(0xb89a2a), 1.72, y + 2, -0.9, 0.04, 0.3, 0.6, shaft); // depth plates
    }
    for (const x of [-1.5, 1.5]) box(railM, x, 0, -1.7, 0.1, H, 0.1, shaft);
    g.add(shaft);
    this.shaft = shaft;
    return g;
  }

  /** Start a ride to `to` {x, y?, z, yaw?}. */
  ride(to) {
    if (this.active || !to) return;
    const g = this.game, pc = g.player.controller;
    const down = Number.isFinite(to.y) && to.y < pc.pos.y - 50;
    const group = this._build();
    group.position.set(pc.pos.x, pc.pos.y + 0.02, pc.pos.z);
    g.renderer.scene.add(group);
    this.cabLight = new THREE.PointLight(0xfff2d0, 2.2, 6, 1.5);
    this.cabLight.position.set(0, 2.2, 0);
    group.add(this.cabLight);
    this.active = { to, t: 0, group, down, moved: false, home: pc.pos.clone() };
    this.shaft.position.y = 0;
    bus.emit('sound', { type: 'liftStart', x: pc.pos.x, y: pc.pos.y, z: pc.pos.z });
    bus.emit('notify', { text: down ? 'Going down…' : 'Going up…', kind: 'info', key: 'lift' });
  }

  update(dt) {
    const A = this.active;
    if (!A) return;
    const g = this.game, pc = g.player.controller;
    A.t += dt;
    // ease in and out
    const k = Math.min(1, A.t / 1.2) * Math.min(1, Math.max(0, (RIDE - A.t) / 1.2));
    this.shaft.position.y += (A.down ? 1 : -1) * SPEED * k * dt;
    if (Math.abs(this.shaft.position.y) > 60) this.shaft.position.y -= Math.sign(this.shaft.position.y) * 8; // rings repeat every 8 m
    // hold the passenger in the cab
    pc.pos.x = A.home.x; pc.pos.z = A.home.z; pc.pos.y = A.home.y;
    pc.vel?.set?.(0, 0, 0);
    if (pc.velocity) pc.velocity.set(0, 0, 0);
    A.group.position.set(A.home.x, A.home.y + 0.02 + Math.sin(A.t * 31) * 0.004 * k, A.home.z);
    this.dot.material.color.setHex(Math.floor(A.t * 3) % 2 ? 0x30ff60 : 0x104020);
    if (!A.moved && A.t >= RIDE / 2) {
      A.moved = true;
      const to = A.to;
      const y = Number.isFinite(to.y) ? to.y : g.physics.groundHeight(to.x, to.z, 0.35, g.world.heightAt(to.x, to.z) + 3);
      const yawKeep = pc.yaw, pitchKeep = pc.pitch;
      pc.teleport(to.x, y + 0.05, to.z, yawKeep);
      pc.pitch = pitchKeep;
      A.home.set(to.x, y + 0.05, to.z);
      g.envT = 0;
    }
    if (A.t >= RIDE) {
      g.renderer.scene.remove(A.group);
      A.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose?.(); });
      this.active = null;
      if (Number.isFinite(A.to.yaw)) pc.yaw = A.to.yaw;
      bus.emit('sound', { type: 'liftChime', ui: true });
    }
  }

  cancel() {
    if (!this.active) return;
    this.game.renderer.scene.remove(this.active.group);
    this.active = null;
  }
}
