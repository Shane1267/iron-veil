// Helmet-mounted night vision. Goggles are mounted on a helmet that has a mount (inspect
// the helmet in the inventory), worn on the head and switched with V. They amplify the
// little light there is (exposure gain plus a weak infrared illuminator), tint the view
// green with grain and a tube vignette, and run on batteries.
import { ItemDB } from '../items/ItemDatabase.js';
import { bus } from '../core/EventBus.js';
import { h } from '../ui/dom.js';

function noiseTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const img = x.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c.toDataURL();
}

export class NightVision {
  constructor(game) {
    this.game = game;
    this.on = false;
    this.k = 0; // 0..1 blend while the goggles flip down
    // separate top-level layers: a blend mode only mixes with what is behind it inside its
    // own stacking context, so the tint must not sit in a shared (isolated) container
    this.tint = h('div', { class: 'nv-layer nv-tint hidden' });
    this.grain = h('div', { class: 'nv-layer nv-grain hidden' });
    this.tube = h('div', { class: 'nv-layer nv-tube hidden' });
    this.layers = [this.tint, this.grain, this.tube];
    try { this.grain.style.backgroundImage = `url(${noiseTexture()})`; } catch { /* no canvas */ }
    // directly above the 3D view and below the HUD
    const cv = document.getElementById('game-canvas');
    for (const l of [...this.layers].reverse()) {
      if (cv?.parentNode) cv.parentNode.insertBefore(l, cv.nextSibling);
      else document.body.appendChild(l);
    }
  }

  helmet() {
    const s = this.game.player.equipment.slots.head;
    return s && ItemDB.get(s.id)?.equip?.nvgMount ? s : null;
  }

  /** The mounted goggles' definition, or null. */
  goggles() {
    const hm = this.helmet();
    const id = hm?.data?.nvg;
    return id ? ItemDB.get(id) : null;
  }

  toggle() {
    const gog = this.goggles();
    if (!gog) {
      bus.emit('notify', { text: this.helmet() ? 'No night vision mounted on your helmet (inspect the helmet in your inventory)' : 'Wear a helmet with night vision mounted', kind: 'info' });
      this.on = false;
      return;
    }
    const d = this.helmet().data;
    if ((d.nvgCharge ?? 1) <= 0 && !this._newBattery(d)) { bus.emit('notify', { text: 'Night vision: no batteries', kind: 'warn' }); return; }
    this.on = !this.on;
    bus.emit('sound', { type: 'click', ui: true });
  }

  _newBattery(d) {
    if (this.game.player.equipment.inventory.remove('battery', 1)) { d.nvgCharge = 1; bus.emit('notify', { text: 'Night vision battery replaced', kind: 'info' }); return true; }
    return false;
  }

  update(dt) {
    const g = this.game;
    const gog = this.goggles();
    if (this.on && (!gog || g.player.survival.dead)) this.on = false;
    if (this.on) {
      const d = this.helmet().data;
      if (d.nvgCharge === undefined) d.nvgCharge = 1;
      d.nvgCharge -= (dt * (gog.nvg.drain || 0.01)) / 10;
      if (d.nvgCharge <= 0 && !this._newBattery(d)) { d.nvgCharge = 0; this.on = false; bus.emit('notify', { text: 'Night vision: battery dead', kind: 'warn' }); }
    }
    this.k += ((this.on ? 1 : 0) - this.k) * Math.min(1, dt * 9);
    const k = this.k;
    const L = g.lighting;
    const gain = gog?.nvg?.gain || 6;
    // more gain the darker it is: daytime use just washes out a little
    const dark = Math.max(L.nightFactor || 0, L.underground ? 1 : 0, L.viewIndoor ? 0.6 : 0);
    L.nvGain = 1 + k * (gain - 1) * (0.25 + 0.75 * dark);
    L.nvAmbient = k * (0.12 + 0.5 * dark) * (gain / 9);
    const visible = k > 0.02;
    for (const l of this.layers) l.classList.toggle('hidden', !visible);
    if (visible) {
      this.tint.style.opacity = k.toFixed(3);
      this.tube.style.opacity = k.toFixed(3);
      const noise = gog?.nvg?.noise ?? 0.4;
      this.grain.style.opacity = (k * (0.12 + noise * 0.35)).toFixed(3);
      this.grain.style.backgroundPosition = `${(Math.random() * 256) | 0}px ${(Math.random() * 256) | 0}px`;
    }
  }

  get status() {
    const hm = this.helmet();
    if (!this.on || !hm) return null;
    return `NV ${Math.round((hm.data.nvgCharge ?? 1) * 100)}%`;
  }
}
