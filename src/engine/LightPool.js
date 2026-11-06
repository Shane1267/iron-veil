import * as THREE from 'three';

// A small fixed pool of real point lights assigned each half-second to the nearest
// active light sources (lamps, campfires, street lights). The pool size never changes,
// so shaders are never recompiled when lights come and go.

export class LightPool {
  constructor(scene, size = 6) {
    this.sources = new Set();
    this.lights = [];
    for (let i = 0; i < size; i++) {
      const l = new THREE.PointLight(0xffd8a0, 0, 16, 1.8);
      scene.add(l);
      this.lights.push({ light: l, src: null });
    }
    this.timer = 0;
    this.time = 0;
  }

  add(src) { this.sources.add(src); return src; }
  remove(src) { this.sources.delete(src); }
  clear() { this.sources.clear(); }

  update(dt, pos, night) {
    this.time += dt;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.5;
      const cands = [];
      for (const s of this.sources) {
        if (s.street && night < 0.5) continue;
        if (s.active && !s.active()) continue;
        const d = Math.hypot(s.x - pos.x, (s.y - pos.y) * 1.5, s.z - pos.z); // 3D: facility lights below ground stay below
        if (d < 90) cands.push([d, s]);
      }
      cands.sort((a, b) => a[0] - b[0]);
      this.lights.forEach((L, i) => { L.src = cands[i] ? cands[i][1] : null; });
    }
    for (const L of this.lights) {
      const s = L.src;
      if (!s) { L.light.intensity = 0; continue; }
      L.light.position.set(s.x, s.y, s.z);
      L.light.color.setHex(s.color || 0xffd8a0);
      L.light.distance = s.range || 16;
      const flick = s.flicker ? 0.8 + Math.sin(this.time * 13 + s.x) * 0.1 + Math.sin(this.time * 23.7) * 0.1 : 1;
      L.light.intensity = (s.intensity || 5) * flick * (s.street ? 1 : 1);
    }
  }
}
