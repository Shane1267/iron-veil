import { h, clear } from './dom.js';
import { settings, QUALITY_PRESETS, BOOT } from '../core/SettingsManager.js';

// Settings screen. Every option maps to a real effect in the renderer, controls,
// audio mix or gameplay systems.

const GROUPS = [
  ['Graphics', [
    { k: 'renderScale', name: 'Render resolution', min: 0.5, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { k: 'shadows', name: 'Shadow quality', min: 0, max: 3, step: 1, fmt: (v) => ['Off', 'Low', 'Medium', 'High'][v] },
    { k: 'viewDistance', name: 'View distance', min: 600, max: 2600, step: 100, fmt: (v) => `${v} m` },
    { k: 'vegetation', name: 'Vegetation density', min: 0.3, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { k: 'grass', name: 'Grass', type: 'bool' },
    { k: 'effects', name: 'Effects quality', min: 0, max: 2, step: 1, fmt: (v) => ['Low', 'Medium', 'High'][v] },
    { k: 'ao', name: 'Ambient occlusion (GTAO)', type: 'bool' },
    { k: 'post', name: 'Post-processing (grade, vignette, grain)', type: 'bool' },
    { k: 'textures', name: 'Texture resolution', type: 'select', options: [[128, 'Very low (128)'], [256, 'Low (256)'], [512, 'Medium (512)'], [1024, 'High (1024)']], hint: 'Applied after reloading the page' },
    { k: 'lite', name: 'Simple materials, no anti-aliasing (Chromebook mode)', type: 'bool', hint: 'Applied after reloading the page' },
    { k: 'showFPS', name: 'Show performance stats', type: 'bool' },
  ]],
  ['Controls', [
    { k: 'sensitivity', name: 'Mouse sensitivity', min: 0.1, max: 4, step: 0.05, fmt: (v) => v.toFixed(2) },
    { k: 'adsSensitivity', name: 'Aim-down-sights sensitivity', min: 0.2, max: 1.5, step: 0.05, fmt: (v) => v.toFixed(2) },
    { k: 'invertY', name: 'Invert Y axis', type: 'bool' },
    { k: 'fov', name: 'Field of view', min: 60, max: 100, step: 1, fmt: (v) => `${v}°` },
    { k: 'headBob', name: 'Head bob', type: 'bool' },
    { k: 'cameraShake', name: 'Camera shake', type: 'bool' },
    { k: 'hudScale', name: 'HUD scale', min: 0.75, max: 1.4, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  ]],
  ['Audio', [
    { k: 'volMaster', name: 'Master', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}` },
    { k: 'volWeapons', name: 'Weapons & impacts', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}` },
    { k: 'volAmbience', name: 'Ambience & footsteps', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}` },
    { k: 'volVehicles', name: 'Vehicles', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}` },
    { k: 'volUI', name: 'Interface', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}` },
  ]],
  ['Gameplay', [
    { k: 'aiDifficulty', name: 'AI difficulty', min: 0.5, max: 1.5, step: 0.05, fmt: (v) => (v < 0.8 ? 'Easy' : v < 1.15 ? 'Normal' : 'Hard') + ` (${v.toFixed(2)})` },
    { k: 'survivalRate', name: 'Hunger & thirst rate', min: 0.25, max: 2, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { k: 'eventFrequency', name: 'World event frequency', min: 0, max: 2, step: 0.1, fmt: (v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`) },
    { k: 'lootRespawnMinutes', name: 'Loot restock interval', min: 0, max: 240, step: 5, fmt: (v) => (v === 0 ? 'Never' : `${v} game min`), hint: 'Containers restock only after being emptied' },
  ]],
];

export const CONTROLS = [
  ['Move', 'W A S D'], ['Look', 'Mouse'], ['Sprint', 'Shift'], ['Crouch / Prone', 'C / Z'], ['Jump', 'Space'], ['Fire / Aim', 'LMB / RMB'],
  ['Hold breath (scoped)', 'Shift'], ['Reload / clear jam', 'R'], ['Fire mode', 'B'], ['Weapon slots', '1 2 3 4'], ['Holster', 'X'], ['Quick items', '5 6 7 8'],
  ['Interact / loot / drive', 'E'], ['Secondary action (lock, refuel, fill)', 'F'], ['Light', 'T'], ['Inspect weapon', 'Y'],
  ['Inventory', 'Tab / I'], ['Map', 'M'], ['Build menu', 'G'], ['Crafting', 'H'], ['Journal & skills', 'J'], ['Rotate piece', 'Q'], ['Vehicle lights', 'L'], ['Pause', 'Esc'],
];

export class SettingsUI {
  constructor(ui) {
    this.ui = ui;
    this.el = h('div', { class: 'screen dim hidden' });
    ui.root.appendChild(this.el);
    this.tab = 'Graphics';
    this.onClose = null;
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }
  open(onClose) { this.onClose = onClose; this.el.classList.remove('hidden'); this.render(); }
  close() { this.el.classList.add('hidden'); const f = this.onClose; this.onClose = null; f?.(); }

  render() {
    clear(this.el);
    const wrap = h('div', { class: 'panel settings-wrap interactive' });
    const tabs = h('div', { class: 'tabs' }, ...[...GROUPS.map((g) => g[0]), 'Controls Help'].map((t) => h('button', { class: t === this.tab ? 'on' : '', onclick: () => { this.tab = t; this.render(); } }, t)));
    wrap.appendChild(h('div', { class: 'panel-head' }, h('h2', {}, 'Settings'), tabs));
    const body = h('div', { class: 'settings-body' });
    if (this.tab === 'Controls Help') {
      body.appendChild(h('h4', {}, 'Keyboard & mouse'));
      const l = h('div', { class: 'controls-list' });
      for (const [a, k] of CONTROLS) l.append(h('span', {}, a), h('span', { class: 'key' }, k));
      body.appendChild(l);
    } else {
      const grp = GROUPS.find((g) => g[0] === this.tab);
      if (this.tab === 'Graphics') {
        body.appendChild(h('h4', {}, 'Preset'));
        const label = { chromebook: 'Chromebook', low: 'Low', medium: 'Medium', high: 'High' };
        body.appendChild(h('div', { class: 'presets' }, ...Object.keys(QUALITY_PRESETS).map((p) => h('button', { class: `btn small ${settings.get('preset') === p ? 'primary' : ''}`, onclick: () => { settings.applyPreset(p); this.render(); } }, label[p] || p))));
        if (settings.get('textures') !== BOOT.textures || settings.get('lite') !== BOOT.lite) {
          // texture size and simple materials are built when the page loads
          body.appendChild(h('div', { class: 'reload-note' },
            h('span', {}, 'Texture and material changes need a reload. Your game is saved first.'),
            h('button', { class: 'btn small primary', onclick: async () => { const g = window.__IV?.game; try { if (g?.started && !g.dead) await g.saveGame('auto', true); } catch { /* reload anyway */ } location.reload(); } }, 'Reload now')));
        }
        body.appendChild(h('h4', {}, 'Details'));
      }
      for (const s of grp[1]) body.appendChild(this._row(s));
    }
    wrap.appendChild(body);
    wrap.appendChild(h('div', { class: 'inv-foot' }, h('span', {}, 'Settings save automatically'), h('button', { class: 'btn small', onclick: () => this.close() }, 'Back')));
    this.el.appendChild(wrap);
  }

  _row(s) {
    const v = settings.get(s.k);
    let ctrl, valEl = h('span', { class: 'v' });
    if (s.type === 'bool') {
      ctrl = h('div', { class: `toggle ${v ? 'on' : ''}`, onclick: () => { settings.apply({ [s.k]: !settings.get(s.k), ...(this.tab === 'Graphics' ? { preset: 'custom' } : {}) }); this.render(); } });
    } else if (s.type === 'select') {
      ctrl = h('select', { onchange: (e) => { settings.apply({ [s.k]: Number(e.target.value), preset: 'custom' }); this.render(); } },
        ...s.options.map(([val, label]) => h('option', { value: val, selected: Number(v) === val }, label)));
    } else {
      ctrl = h('input', { type: 'range', min: s.min, max: s.max, step: s.step, value: v });
      ctrl.addEventListener('input', (e) => { valEl.textContent = s.fmt(Number(e.target.value)); });
      ctrl.addEventListener('change', (e) => { settings.apply({ [s.k]: Number(e.target.value), ...(this.tab === 'Graphics' ? { preset: 'custom' } : {}) }); });
      valEl.textContent = s.fmt(v);
    }
    return h('div', { class: 'setting' }, h('span', {}, s.name, s.hint ? h('span', { class: 'hint' }, s.hint) : ''), ctrl, valEl);
  }
}
