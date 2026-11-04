import * as THREE from 'three';
import { RNG, clamp, damp } from '../core/MathUtil.js';
import { bus } from '../core/EventBus.js';

// Weather state machine (clear, cloudy, overcast, fog, rain, storm) with smooth
// transitions, rain particles around the camera, lightning and AI visibility effects.

const STATES = {
  clear: { cloud: 0.32, overcast: 0.0, fog: 0.0, rain: 0, wind: 0.25 },
  cloudy: { cloud: 0.58, overcast: 0.25, fog: 0.05, rain: 0, wind: 0.4 },
  overcast: { cloud: 0.85, overcast: 0.65, fog: 0.15, rain: 0, wind: 0.5 },
  fog: { cloud: 0.6, overcast: 0.5, fog: 0.85, rain: 0, wind: 0.1 },
  rain: { cloud: 0.95, overcast: 0.8, fog: 0.3, rain: 0.7, wind: 0.6 },
  storm: { cloud: 1.0, overcast: 0.95, fog: 0.35, rain: 1.0, wind: 1.0 },
};
const NEXT = {
  clear: [['clear', 3], ['cloudy', 3], ['fog', 1]],
  cloudy: [['clear', 2], ['overcast', 3], ['cloudy', 2]],
  overcast: [['cloudy', 2], ['rain', 3], ['fog', 1]],
  fog: [['clear', 2], ['cloudy', 2], ['overcast', 1]],
  rain: [['overcast', 3], ['storm', 1], ['rain', 1]],
  storm: [['rain', 3]],
};

export class WeatherSystem {
  constructor(scene) {
    this.rng = new RNG((Date.now() >>> 3) & 0xffff);
    this.state = 'clear';
    this.target = { ...STATES.clear };
    this.cur = { ...STATES.clear, flash: 0 };
    this.timer = 600;
    this.flashT = 0;
    this.nextLightning = 10;
    // rain streaks: line segments that wrap around the camera
    const N = 4000;
    this.rainCount = N;
    const pos = new Float32Array(N * 6);
    this.drops = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.drops[i * 3] = (Math.random() - 0.5) * 40;
      this.drops[i * 3 + 1] = Math.random() * 24;
      this.drops[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainMesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xa8b4c0, transparent: true, opacity: 0.35, depthWrite: false }));
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    scene.add(this.rainMesh);
  }

  get visibility() {
    return clamp(1 - this.cur.fog * 0.65 - this.cur.rain * 0.3, 0.2, 1);
  }

  set(state, instant = false) {
    if (!STATES[state]) return;
    this.state = state;
    this.target = { ...STATES[state] };
    if (instant) Object.assign(this.cur, this.target);
  }

  update(dt, camPos, sheltered, timeScale = 1) {
    this.timer -= dt * timeScale;
    if (this.timer <= 0) {
      this.timer = 300 + this.rng.next() * 500;
      const next = this.rng.weighted(NEXT[this.state].map(([s, w]) => ({ s, weight: w }))).s;
      this.set(next);
    }
    for (const k of ['cloud', 'overcast', 'fog', 'rain', 'wind']) this.cur[k] = damp(this.cur[k], this.target[k], 0.05, dt);
    // lightning in storms
    if (this.state === 'storm' && this.cur.rain > 0.6) {
      this.nextLightning -= dt;
      if (this.nextLightning <= 0) {
        this.nextLightning = 6 + this.rng.next() * 18;
        this.flashT = 0.35;
        const dist = 400 + this.rng.next() * 2500;
        bus.emit('sound', { type: 'thunder', ui: true, delay: dist / 343, strength: clamp(1.6 - dist / 2500, 0.3, 1.4) });
      }
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.cur.flash = this.flashT > 0.25 ? 1 : this.flashT > 0.15 ? 0.2 : this.flashT > 0.08 ? 0.7 : 0;
    } else this.cur.flash = 0;

    // rain particles
    const r = this.cur.rain;
    this.rainMesh.visible = r > 0.03;
    if (this.rainMesh.visible) {
      const pos = this.rainMesh.geometry.attributes.position.array;
      const n = Math.floor(this.rainCount * Math.min(1, r * 1.1));
      const fall = 14 * dt;
      const wx = this.cur.wind * 2.5;
      for (let i = 0; i < this.rainCount; i++) {
        const o = i * 6;
        if (i >= n) { pos[o] = pos[o + 3] = 0; pos[o + 1] = pos[o + 4] = -9999; pos[o + 2] = pos[o + 5] = 0; continue; }
        this.drops[i * 3 + 1] -= fall;
        if (this.drops[i * 3 + 1] < 0) {
          this.drops[i * 3 + 1] += 24;
          this.drops[i * 3] = (Math.random() - 0.5) * 40;
          this.drops[i * 3 + 2] = (Math.random() - 0.5) * 40;
        }
        const x = camPos.x + this.drops[i * 3], y = camPos.y - 8 + this.drops[i * 3 + 1], z = camPos.z + this.drops[i * 3 + 2];
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
        pos[o + 3] = x - wx * 0.05; pos[o + 4] = y - 0.55; pos[o + 5] = z;
      }
      this.rainMesh.geometry.attributes.position.needsUpdate = true;
      this.rainMesh.material.opacity = (sheltered ? 0.18 : 0.35) * Math.min(1, r * 1.5);
    }
  }

  serialize() {
    return { state: this.state, timer: this.timer };
  }

  deserialize(o) {
    if (o && STATES[o.state]) { this.set(o.state, true); this.timer = Number.isFinite(o.timer) ? o.timer : 400; }
  }
}
