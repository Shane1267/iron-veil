import * as THREE from 'three';

// Stand-in for CharacterModel when the game runs without a renderer (simulation tests).
// Keeps the same surface the AI uses: root transform, gait phase, weapon, death.
export class HeadlessModel {
  constructor() {
    this.root = new THREE.Object3D();
    this.mesh = { castShadow: false };
    this.phase = Math.random() * 10;
    this.flinch = 0;
    this.weapon = null;
    this.dead = false;
  }
  setWeapon(id) { this.weapon = { id }; }
  muzzleWorld(out = new THREE.Vector3()) { return out.copy(this.root.position).setY(this.root.position.y + 1.4); }
  headWorld(out = new THREE.Vector3()) { return out.copy(this.root.position).setY(this.root.position.y + 1.6); }
  animate(dt, s = {}) {
    this.phase += dt * (s.speed || 0) * 2.2;
    this.flinch = Math.max(0, this.flinch - dt * 3);
  }
  die(dir = 1, side = 0) { this.dead = true; this.deathDir = dir; this.deathSide = side; }
}
