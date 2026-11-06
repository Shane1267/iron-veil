import { h, ICONS } from './dom.js';
import { bus } from '../core/EventBus.js';
import { ItemDB } from '../items/ItemDatabase.js';
import { PIECE } from '../basebuilding/BaseSystem.js';
import { settings } from '../core/SettingsManager.js';

// Heads-up display: vitals, statuses, weapon/ammo, compass with waypoint, objective,
// interaction prompts, progress, hit markers, damage direction, scope, vehicle and
// build-mode panels, notifications.

export class HUD {
  constructor(game, root) {
    this.game = game;
    this.el = h('div', { class: 'hud hidden' });
    root.appendChild(this.el);
    this.crosshair = h('div', { class: 'crosshair' }, h('i', { class: 'dot' }), h('i', { class: 'l' }), h('i', { class: 'r' }), h('i', { class: 't' }), h('i', { class: 'b' }));
    this.hit = h('div', { class: 'hitmarker' });
    this.prompt = h('div', { class: 'prompt' });
    this.progress = h('div', { class: 'progress hidden' }, h('span'), h('div', { class: 'bar' }, h('i')));
    this.vitals = h('div', { class: 'vitals' });
    this.bars = {};
    for (const k of ['health', 'hunger', 'thirst', 'stamina']) {
      const fill = h('div', { class: 'fill' });
      const num = h('div', { class: 'num' });
      const row = h('div', { class: `vital ${k}` }, h('span', { html: ICONS[k] }), h('div', { class: 'track' }, fill), num);
      this.vitals.appendChild(row);
      this.bars[k] = { row, fill, num };
    }
    this.statusRow = h('div', { class: 'status-row' });
    this.vitals.appendChild(this.statusRow);
    this.weapon = h('div', { class: 'weapon-hud' });
    this.quick = h('div', { class: 'quick' });
    this.compass = h('div', { class: 'compass' });
    this.compassStrip = h('div', { class: 'strip' });
    this.compass.append(this.compassStrip, h('div', { class: 'center' }));
    this._buildCompass();
    this.compassReadout = h('div', { class: 'compass-readout' });
    this.objective = h('div', { class: 'objective' });
    this.clock = h('div', { class: 'clock' });
    this.fps = h('div', { class: 'fps' });
    this.notes = h('div', { class: 'notifications' });
    this.damageDir = h('div', { class: 'damage-dir' });
    this.scope = h('div', { class: 'scope-overlay hidden' });
    this._buildScope();
    this.vehicle = h('div', { class: 'vehicle-hud hidden' });
    this.build = h('div', { class: 'build-hud hidden' });
    this.toast = h('div', { class: 'toast-center' });
    this.flash = h('div', { class: 'flash' });
    this.el.append(this.scope, this.crosshair, this.hit, this.prompt, this.progress, this.vitals, this.weapon, this.quick, this.compass, this.compassReadout,
      this.objective, this.clock, this.fps, this.notes, this.damageDir, this.vehicle, this.build, this.toast, this.flash);

    this.noteKeys = new Map();
    this.hitT = 0;
    bus.on('notify', (n) => this.notify(n));
    bus.on('hit', (e) => {
      if (e.shooter === game.player.character) this.hitMarker(!e.target.alive);
    });
    bus.on('npc:died', (e) => { if (e.killer === game.player.character) { this.hitMarker(true); game.player.stats.kills++; } });
    bus.on('poi:discovered', (p) => this.showToast(p.name, game.world.regionById.get(p.region)?.name || ''));
    this.slow = 0;
    this.applyScale();
    bus.on('settings:changed', (c) => { if ('hudScale' in c) this.applyScale(); });
  }

  applyScale() {
    this.el.style.setProperty('--hud-scale', settings.get('hudScale'));
    for (const e of [this.vitals, this.weapon, this.quick, this.objective, this.clock]) e.style.zoom = settings.get('hudScale');
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  _buildCompass() {
    // 3 copies of 360° so the strip can wrap
    const px = 2.2; // pixels per degree
    this.compassPx = px;
    const cards = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = -360; d < 720; d += 5) {
      const deg = ((d % 360) + 360) % 360;
      const x = d * px;
      this.compassStrip.appendChild(h('div', { class: `tick${deg % 15 === 0 ? ' major' : ''}`, style: { left: `${x}px` } }));
      if (cards[deg] !== undefined) this.compassStrip.appendChild(h('div', { class: 'lbl card', style: { left: `${x}px` } }, cards[deg]));
      else if (deg % 15 === 0) this.compassStrip.appendChild(h('div', { class: 'lbl', style: { left: `${x}px` } }, String(deg)));
    }
    this.wpMarker = h('div', { class: 'wp hidden' });
    this.compass.appendChild(this.wpMarker);
  }

  _buildScope() {
    this.scope.append(h('div', { class: 'mask' }), h('div', { class: 'h' }), h('div', { class: 'v' }));
    for (let i = 1; i <= 4; i++) this.scope.appendChild(h('div', { class: 'mil', style: { top: `calc(50% + ${i * 3.2}vh)` } }));
    this.scope.appendChild(h('div', { class: 'post', style: { left: 'calc(50% - 1.5px)', top: 'calc(50% + 14vh)', width: '3px', height: '21vh' } }));
    this.scope.appendChild(h('div', { class: 'post', style: { left: 'calc(50% - 35vh)', top: 'calc(50% - 1.5px)', width: '20vh', height: '3px' } }));
    this.scope.appendChild(h('div', { class: 'post', style: { left: 'calc(50% + 15vh)', top: 'calc(50% - 1.5px)', width: '20vh', height: '3px' } }));
    this.breath = h('div', { class: 'breath' }, 'Hold Shift to steady');
    this.scope.appendChild(this.breath);
  }

  notify({ text, kind = 'info', key }) {
    if (key && this.noteKeys.has(key)) {
      const old = this.noteKeys.get(key);
      if (old.isConnected) { old.textContent = text; old.dataset.t = String(performance.now()); return; }
    }
    const n = h('div', { class: `note ${kind}` }, text);
    n.dataset.t = String(performance.now());
    this.notes.prepend(n);
    if (key) this.noteKeys.set(key, n);
    while (this.notes.children.length > 6) this.notes.lastChild.remove();
    if (kind === 'warn') bus.emit('sound', { type: 'uiError', ui: true });
    else if (kind === 'objective') bus.emit('sound', { type: 'ui', ui: true, freq: 660 });
  }

  showToast(title, sub = '') {
    this.toast.innerHTML = '';
    this.toast.append(title, h('small', {}, sub));
    this.toast.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toast.classList.remove('show'), 3200);
  }

  hitMarker(kill) {
    this.hit.classList.toggle('kill', !!kill);
    this.hit.classList.add('show');
    this.hitT = kill ? 0.35 : 0.15;
    bus.emit('sound', { type: 'ui', ui: true, freq: kill ? 520 : 1400 });
  }

  update(dt) {
    const g = this.game;
    const s = g.player.survival;
    const now = performance.now();
    // notifications fade
    for (const n of [...this.notes.children]) {
      const age = now - Number(n.dataset.t);
      if (age > 5500) n.classList.add('fade');
      if (age > 6200) n.remove();
    }
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) this.hit.classList.remove('show'); }

    // vitals
    const set = (k, v, warn) => {
      const b = this.bars[k];
      b.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, v / 100))})`;
      b.num.textContent = Math.round(v);
      b.row.classList.toggle('warn', warn);
    };
    set('health', s.health, s.health < 30);
    set('hunger', s.hunger, s.hunger < 20);
    set('thirst', s.thirst, s.thirst < 20);
    set('stamina', s.stamina, s.exhausted);

    this.slow -= dt;
    if (this.slow <= 0) {
      this.slow = 0.12;
      this._slowUpdate();
    }

    // crosshair / scope
    const w = g.weapons;
    const inVeh = !!g.vehicles.current;
    const scoped = w.scoped && !inVeh;
    this.scope.classList.toggle('hidden', !scoped);
    this.breath.textContent = w.holdingBreath ? 'Holding breath' : 'Hold Shift to steady';
    const ads = w.adsT > 0.6 && !w.isMelee;
    this.crosshair.style.opacity = ads || scoped || inVeh || g.base.active ? '0' : '1';
    // dynamic crosshair spread
    const pc = g.player.controller;
    const moving = Math.hypot(pc.vel.x, pc.vel.z);
    const spread = 4 + Math.min(16, moving * 2.2) + (pc.grounded ? 0 : 8) + w.recoil.pitch * 300;
    const [, l, r, t, b] = this.crosshair.children;
    l.style.left = `${-spread - 7}px`; r.style.left = `${spread}px`; t.style.top = `${-spread - 7}px`; b.style.top = `${spread}px`;

    // compass
    const yaw = inVeh ? g.player.controller.yaw : pc.yaw;
    let bearing = ((-yaw * 180) / Math.PI) % 360;
    if (bearing < 0) bearing += 360;
    this.compassStrip.style.transform = `translateX(${-bearing * this.compassPx}px)`;
    const wp = g.waypoint;
    if (wp) {
      const dx = wp.x - pc.pos.x, dz = wp.z - pc.pos.z;
      let wb = (Math.atan2(dx, -dz) * 180) / Math.PI;
      let rel = wb - bearing;
      while (rel > 180) rel -= 360;
      while (rel < -180) rel += 360;
      this.wpMarker.classList.toggle('hidden', Math.abs(rel) > 95);
      this.wpMarker.style.left = `${210 + rel * this.compassPx}px`;
      this._wpDist = Math.round(Math.hypot(dx, dz));
    } else this.wpMarker.classList.add('hidden');
    this.compassReadout.textContent = `${String(Math.round(bearing) % 360).padStart(3, '0')}°${wp ? `  ·  WP ${this._wpDist} m` : ''}`;

    // damage direction
    if (g.player.damageDirs.length || this.damageDir.firstChild) this.damageDir.innerHTML = '';
    for (const d of g.player.damageDirs) {
      const ang = Math.atan2(d.x, -d.z) + yaw;
      const el = h('i', { style: { transform: `rotate(${(-ang * 180) / Math.PI}deg)`, opacity: Math.min(1, d.t) } });
      this.damageDir.appendChild(el);
    }

    // timed actions
    const ua = s.useAction || g.interactionAction || (g.crafting.job ? { t: g.crafting.job.t, time: g.crafting.job.recipe.time, label: 'Crafting' } : null);
    if (ua) {
      this.progress.classList.remove('hidden');
      this.progress.firstChild.textContent = ua.label || ItemDB.get(ua.itemId)?.name || 'Working';
      this.progress.querySelector('i').style.width = `${Math.min(100, (ua.t / ua.time) * 100)}%`;
    } else this.progress.classList.add('hidden');

  }

  _panels() {
    const g = this.game;
    // vehicle panel
    const v = g.vehicles.current;
    this.vehicle.classList.toggle('hidden', !v);
    if (v) {
      this.vehicle.innerHTML = '';
      this.vehicle.append(
        h('div', { class: 'spd' }, String(Math.round(Math.abs(v.speed) * 3.6)), h('small', {}, ' km/h')),
        h('div', { class: 'row' }, h('span', {}, `FUEL ${Math.round(v.fuel)}/${v.t.fuelCap} L`), h('span', {}, `COND ${Math.round((v.health / v.t.health) * 100)}%`), h('span', {}, v.engineOn ? 'ENGINE ON' : 'ENGINE OFF'), h('span', {}, v.lightsOn ? (v.highBeam ? 'HIGH BEAM' : 'LOW BEAM') : 'LIGHTS OFF (L)')),
        h('div', { class: 'row' }, h('span', {}, 'W/S throttle · A/D steer · Space brake · L lights · E exit')),
      );
    }
    // build panel
    this.build.classList.toggle('hidden', !g.base.active);
    if (g.base.active && g.buildInfo) {
      const bi = g.buildInfo;
      const def = PIECE[g.base.selected];
      const inv = g.player.equipment.inventory;
      const cost = Object.entries(def.cost).map(([id, n]) => {
        const have = inv.count(id);
        return h('span', { style: { color: have >= n ? 'inherit' : '#e79a8c' } }, `${ItemDB.get(id).name} ${have}/${n}  `);
      });
      this.build.innerHTML = '';
      this.build.append(
        h('div', { class: 't' }, def.name),
        h('div', { class: 'c' }, ...cost, def.tool ? h('span', { style: { color: inv.count(def.tool) ? 'inherit' : '#e79a8c' } }, `· ${ItemDB.get(def.tool).name}`) : ''),
        h('div', { class: `r ${bi.ok ? '' : 'bad'}` }, bi.ok ? 'Ready to place' : bi.reason || ''),
        h('div', { class: 'k' }, h('span', {}, 'LMB place'), h('span', {}, 'Q rotate'), h('span', {}, 'RMB / G cancel'), h('span', {}, 'Tab pieces'), h('span', {}, 'E repair · F dismantle (aim at piece, empty hands)')),
      );
    }
  }

  _slowUpdate() {
    this._panels();
    const g = this.game;
    const s = g.player.survival;
    // statuses
    const st = [];
    if (s.bleeding) st.push(['Bleeding', 'bad']);
    if (s.painEffective > 0.2) st.push(['Pain', 'bad']);
    if (s.painkiller > 0) st.push(['Painkillers', 'good']);
    if (s.temperature < -0.35) st.push([s.temperature < -0.6 ? 'Freezing' : 'Cold', 'bad']);
    if (s.temperature > 0.6) st.push(['Warm', 'good']);
    if (s.wet > 0.4) st.push(['Wet', '']);
    if (s.hunger < 20) st.push(['Hungry', 'bad']);
    if (s.thirst < 20) st.push(['Thirsty', 'bad']);
    if (s.exhausted) st.push(['Exhausted', 'bad']);
    const enc = g.encumbrance();
    if (enc > 1) st.push(['Overloaded', 'bad']);
    if (g.player.suppression > 0.3) st.push(['Suppressed', 'bad']);
    const key = st.map((x) => x[0]).join('|');
    if (key !== this._stKey) {
      this._stKey = key;
      this.statusRow.innerHTML = '';
      for (const [t, k] of st) this.statusRow.appendChild(h('span', { class: `status ${k}` }, t));
    }
    // weapon
    const info = g.weapons.hudInfo();
    this.weapon.innerHTML = '';
    if (info.ammo !== null && info.ammo !== undefined) {
      const low = info.ammo <= Math.ceil(info.magSize * 0.25);
      this.weapon.append(
        h('div', { class: 'name' }, info.name),
        h('div', { class: `ammo ${info.ammo === 0 ? 'empty' : low ? 'low' : ''}` }, String(info.ammo), h('small', {}, ` / ${info.reserve}`)),
        h('div', { class: 'meta' }, h('span', { class: 'mode' }, info.jammed ? 'JAMMED' : info.mode), h('span', {}, info.ammoName || ''), h('span', {}, `COND ${Math.round((info.cond ?? 1) * 100)}%`)),
      );
    } else {
      this.weapon.append(h('div', { class: 'name' }, info.name), h('div', { class: 'meta' }, h('span', { class: 'mode' }, info.mode || '')));
    }
    // throwables and night vision
    const ex = g.explosives, thr = ex.carried();
    const gear = [];
    if (thr.length) { const id = thr.includes(ex.selected) ? ex.selected : thr[0]; gear.push(`${ItemDB.get(id).name} ×${g.player.equipment.inventory.count(id)} [Q]`); }
    if (ex.charges.length) gear.push(`${ex.charges.length} charge${ex.charges.length > 1 ? 's' : ''} armed`);
    const nv = g.nightVision.status;
    if (nv) gear.push(nv);
    if (gear.length) this.weapon.append(h('div', { class: 'meta gear' }, ...gear.map((t) => h('span', {}, t))));
    // quick slots
    this.quick.innerHTML = '';
    g.player.equipment.quick.forEach((id, i) => {
      const q = h('div', { class: 'q' }, h('b', {}, String(i + 5)));
      if (id) {
        q.style.backgroundImage = `url(${g.icons.icon(id)})`;
        q.appendChild(h('span', {}, String(g.player.equipment.inventory.count(id))));
      }
      this.quick.appendChild(q);
    });
    // objective
    const obj = g.objectives.current;
    this.objective.innerHTML = '';
    if (obj) this.objective.append(h('div', { class: 'h' }, 'Signal from Northwatch'), h('div', { class: 't' }, obj.title), h('div', { class: 'd' }, obj.hint));
    // clock
    this.clock.innerHTML = '';
    const region = g.world.regionAt(g.player.controller.pos.x, g.player.controller.pos.z);
    this.clock.append(h('b', {}, g.clock.label), h('div', {}, `Day ${g.clock.day} · ${region?.name || ''}`));
    this.fps.textContent = settings.get('showFPS') ? `${g.renderer.fps} FPS · ${g.renderer.stats.calls} calls · ${(g.renderer.stats.triangles / 1000).toFixed(0)}k tris · AI ${g.ai.alive().length}` : '';
    // interaction prompt
    const it = g.lookTarget;
    this.prompt.innerHTML = '';
    if (it && !g.vehicles.current && !g.base.active) {
      const label = typeof it.label === 'function' ? it.label() : it.label;
      this.prompt.append(h('span', { class: 'key' }, 'E'), h('span', {}, label));
      const sec = g.secondaryLabel(it);
      if (sec) this.prompt.append(h('span', { class: 'key' }, 'F'), h('span', {}, sec));
      else if (g.ladderPrompt) this.prompt.append(h('span', { class: 'key' }, 'F'), h('span', {}, g.ladderPrompt.label));
    } else if (g.ladderPrompt && !g.vehicles.current && !g.base.active) {
      this.prompt.append(h('span', { class: 'key' }, 'F'), h('span', {}, g.ladderPrompt.label));
    } else if (g.waterPrompt) {
      this.prompt.append(h('span', { class: 'key' }, 'F'), h('span', {}, g.waterPrompt));
    } else if (g.base.active && g.basePieceTarget && !g.base.selected) {
      this.prompt.append(h('span', {}, g.basePieceTarget.def.name));
    }
  }
}
