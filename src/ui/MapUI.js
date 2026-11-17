import { h, clear } from './dom.js';
import { bus } from '../core/EventBus.js';

// Topographic map with fog of war, discovered locations, roads, rivers, rails,
// player position/heading, base marker, custom markers and a waypoint (shown on the
// compass, never as a marker through walls).

const MAP_SIZE = 640;

export class MapUI {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.el = h('div', { class: 'screen dim hidden' });
    ui.root.appendChild(this.el);
    this.zoom = 3;
    this.center = null;
    this.image = null;
    this.imageReady = false;
    this.dragging = null;
    this.filters = { locations: true, roads: true, vehicles: true, markers: true, grid: false, zones: true };
    this.search = '';
    this.hover = null;
  }

  requestImage() {
    if (this.image || this._requested) return;
    this._requested = true;
    this.game.terrain.requestMap(MAP_SIZE, (data, size) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      ctx.putImageData(new ImageData(new Uint8ClampedArray(data), size, size), 0, 0);
      this.image = c;
      this.imageReady = true;
      if (this.isOpen) this.draw();
    });
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }

  open() {
    this.requestImage();
    const p = this.game.player.controller.pos;
    this.center = { x: p.x, z: p.z };
    this.el.classList.remove('hidden');
    this.render();
  }

  close() { this.el.classList.add('hidden'); }

  render() {
    clear(this.el);
    const wrap = h('div', { class: 'panel map-wrap interactive' });
    this.view = h('div', { class: 'map-view' });
    this.canvas = h('canvas');
    this.view.appendChild(this.canvas);
    wrap.append(this.view, this._side());
    this.el.appendChild(wrap);
    this.view.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this._toWorld(e.offsetX, e.offsetY);
      this.zoom = Math.max(1, Math.min(24, this.zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
      const after = this._toWorld(e.offsetX, e.offsetY);
      this.center.x += before.x - after.x;
      this.center.z += before.z - after.z;
      this.draw();
    }, { passive: false });
    this.view.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.dragging = { x: e.clientX, y: e.clientY, cx: this.center.x, cz: this.center.z, moved: false };
    });
    this.view.addEventListener('mousemove', (e) => {
      const d = this.dragging;
      if (!d) { this.cursor = { px: e.offsetX, py: e.offsetY }; this._hoverAt(e.offsetX, e.offsetY); this.draw(); return; }
      const s = this._scale();
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) d.moved = true;
      this.center.x = d.cx - (e.clientX - d.x) / s;
      this.center.z = d.cz - (e.clientY - d.y) / s;
      this.draw();
    });
    this.view.addEventListener('mouseup', (e) => {
      const d = this.dragging;
      this.dragging = null;
      if (d && !d.moved && e.button === 0) {
        const w = this._toWorld(e.offsetX, e.offsetY);
        // click near an existing marker removes it, otherwise sets the waypoint
        const g = this.game;
        const near = g.markers.findIndex((m) => Math.hypot(m.x - w.x, m.z - w.z) * this._scale() < 10);
        if (near >= 0) g.markers.splice(near, 1);
        else g.waypoint = { x: w.x, z: w.z };
        this.draw();
        this._refreshSide();
      }
    });
    this.view.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const w = this._toWorld(e.offsetX, e.offsetY);
      // right-click an existing marker to rename it, empty ground to add one
      const g = this.game;
      const near = g.markers.findIndex((m) => Math.hypot(m.x - w.x, m.z - w.z) * this._scale() < 10);
      if (near >= 0) this._rename(g.markers[near]);
      else g.markers.push({ x: w.x, z: w.z, label: `Marker ${g.markers.length + 1}` });
      this.draw();
    });
    requestAnimationFrame(() => this.draw());
  }

  _side() {
    const side = h('div', { class: 'map-side' });
    this.sideEl = side;
    this._fillSide(side);
    return side;
  }

  _refreshSide() {
    if (!this.sideEl) return;
    clear(this.sideEl);
    this._fillSide(this.sideEl);
  }

  _fillSide(side) {
    const g = this.game;
    const p = g.player.controller.pos;
    const region = g.world.regionAt(p.x, p.z);
    const grid = `${Math.round((p.x + 8192) / 10)}`.padStart(4, '0') + ' ' + `${Math.round((p.z + 8192) / 10)}`.padStart(4, '0');
    side.append(
      h('div', { class: 'sec' }, h('h4', {}, 'Position'), h('div', {}, region?.name || ''), h('div', { style: { fontFamily: 'var(--mono)', marginTop: '3px' } }, `GRID ${grid} · ELEV ${Math.round(p.y)} m`)),
      h('div', { class: 'sec' }, h('h4', {}, 'Controls'), h('div', {}, 'Drag to pan · wheel to zoom'), h('div', {}, 'Click: set waypoint (shown on compass)'), h('div', {}, 'Right-click: add marker · click marker: remove'),
        h('div', { style: { marginTop: '6px', display: 'flex', gap: '6px' } },
          h('button', { class: 'btn small', onclick: () => { this.center = { x: p.x, z: p.z }; this.draw(); } }, 'Centre'),
          h('button', { class: 'btn small', onclick: () => { g.waypoint = null; this.draw(); } }, 'Clear waypoint'))),
    );
    // layer toggles
    side.appendChild(h('div', { class: 'sec' }, h('h4', {}, 'Show'), h('div', { class: 'map-filters' },
      ...Object.keys(this.filters).map((k) => h('button', { class: `btn small${this.filters[k] ? ' primary' : ''}`, onclick: () => { this.filters[k] = !this.filters[k]; this._refreshSide(); this.draw(); } }, k[0].toUpperCase() + k.slice(1))))));
    // situation: raid, wasteland, loot resets
    const sit = [];
    const R = g.raids?.raid;
    if (R && R.phase !== 'over') sit.push(h('div', { class: 'map-alert' }, R.phase === 'warning' ? `Raid expected in ${Math.max(0, Math.round(R.attackAt - g.clock.gameMinutes))} game min` : 'Your base is under attack'));
    if (g.wasteland?.active) sit.push(h('div', { class: 'map-alert' }, `Southern wasteland: ${g.wasteland.daysLeft().toFixed(1)} days until it clears`));
    if (sit.length) side.appendChild(h('div', { class: 'sec' }, h('h4', {}, 'Situation'), ...sit));
    const list = h('div', { class: 'list' });
    const searchBox = h('input', { type: 'text', class: 'map-search', placeholder: 'Search known locations…', value: this.search, oninput: (e) => { this.search = e.target.value; this._fillList(list); } });
    side.appendChild(searchBox);
    this._fillList(list);
    side.appendChild(list);
    side.appendChild(h('div', { class: 'sec' }, h('div', { class: 'legend' },
      h('span', { style: { background: '#d9a441', borderRadius: '50%' } }), 'You',
      h('span', { style: { background: '#8fbf6a' } }), 'Your base',
      h('span', { style: { background: '#c9493a' } }), 'Hostile',
      h('span', { style: { background: '#6f97b3' } }), 'Friendly / neutral',
      h('span', { style: { background: '#e8dcc0', borderRadius: '50%' } }), 'Vehicle you have used',
      h('span', { style: { border: '2px solid #d9a441', transform: 'rotate(45deg) scale(0.7)' } }), 'Waypoint'),
      h('div', { style: { marginTop: '6px', color: 'var(--ink-faint)', fontSize: '11px' } }, '■ town · ▲ military · ◆ industry · ● remote. Right-click a marker to rename it.')));
  }

  _rename(m) {
    const inp = h('input', { type: 'text', class: 'map-search', maxlength: 30, value: m.label || '' });
    const box = h('div', { class: 'map-rename' }, h('span', {}, 'Marker name'), inp, h('button', { class: 'btn small primary', onclick: () => { m.label = inp.value.slice(0, 30) || 'Marker'; box.remove(); this.draw(); } }, 'OK'));
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { m.label = inp.value.slice(0, 30) || 'Marker'; box.remove(); this.draw(); } });
    this.view.appendChild(box);
    inp.focus(); inp.select();
  }

  _fillList(list) {
    const g = this.game;
    const p = g.player.controller.pos;
    clear(list);
    const q0 = this.search.trim().toLowerCase();
    const known = g.world.pois.filter((q) => g.discovered.has(q.id) && (!q0 || q.name.toLowerCase().includes(q0) || q.type.includes(q0)));
    list.appendChild(h('h4', { style: { fontSize: '10px', letterSpacing: '0.22em', color: 'var(--amber)', margin: '8px 0', fontWeight: 500 } }, `Known locations ${known.length}/${g.world.pois.length}`));
    known.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    for (const q of known) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      const fac = g.poiFactionLabel(q);
      list.appendChild(h('div', { class: 'poi', onclick: () => { this.center = { x: q.x, z: q.z }; this.zoom = Math.max(this.zoom, 6); this.draw(); } },
        h('span', {}, q.name, fac ? h('span', { style: { color: 'var(--ink-faint)', fontSize: '10px', marginLeft: '6px' } }, fac) : ''), h('i', {}, d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`)));
    }
  }

  _kind(q) {
    const t = `${q.type} ${q.id}`.toLowerCase();
    if (/mil|base|outpost|depot|guard|launch|airfield|bunker|underground|checkpoint|motor|evac/.test(t)) return 'mil';
    if (/indust|factory|yard|mine|quarry|dam|fuel|rail|storage|mainten|garage|port|dock|saw|lumber|power|treatment|scrap|warehouse|research/.test(t)) return 'ind';
    if (/camp|cabin|hunt|ranger|radio|holdout|tower|lookout|farm|granary/.test(t)) return 'wild';
    return 'town';
  }

  _hoverAt(px, py) {
    const g = this.game;
    let best = null, bd = 14;
    if (this.filters.locations) for (const q of g.world.pois) {
      if (!g.discovered.has(q.id)) continue;
      const [sx, sy] = this._toScreen(q.x, q.z);
      const d = Math.hypot(sx - px, sy - py);
      if (d < bd) { bd = d; best = { kind: 'poi', q }; }
    }
    if (this.filters.vehicles) for (const v of g.vehicles.vehicles.values()) {
      if (!v.known) continue;
      const [sx, sy] = this._toScreen(v.pos.x, v.pos.z);
      const d = Math.hypot(sx - px, sy - py);
      if (d < bd) { bd = d; best = { kind: 'veh', v }; }
    }
    this.hover = best;
  }

  _tooltip(ctx, W, H) {
    const g = this.game, hv = this.hover, c = this.cursor;
    if (!c) return;
    const p = g.player.controller.pos;
    const lines = [];
    const w = this._toWorld(c.px, c.py);
    if (hv?.kind === 'poi') {
      const q = hv.q, d = Math.hypot(q.x - p.x, q.z - p.z);
      lines.push(q.name, `${{ mil: 'Military site', ind: 'Industrial site', wild: 'Remote site', town: 'Settlement' }[this._kind(q)]} · ${d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m'} away`);
      const fac = g.poiFactionLabel(q); if (fac) lines.push(fac);
      const LR = g.lootResets, maj = LR?.major?.find((m) => m.poi === q.id);
      if (maj && LR.last[q.id] !== undefined) lines.push(`Loot resets in ${Math.max(0, Math.round((LR.interval(maj) - (g.clock.gameMinutes - LR.last[q.id])) / 60))} game h`);
      if (g.wasteland?.active && q.z > 0) lines.push('Inside the fallout zone');
    } else if (hv?.kind === 'veh') {
      const v = hv.v; lines.push(v.t.name, `Fuel ${Math.round(v.fuel)} L · ${Math.round((v.health / v.t.health) * 100)}%${v.destroyed ? ' · wrecked' : ''}`);
    }
    lines.push(`${Math.round(w.x)}, ${Math.round(w.z)} · ${g.world.regionAt(w.x, w.z)?.name || ''}`);
    ctx.font = '12px Bahnschrift, Arial Narrow, sans-serif';
    ctx.textAlign = 'left';
    const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16, th = lines.length * 16 + 10;
    const x = Math.min(W - tw - 6, c.px + 14), y = Math.min(H - th - 6, c.py + 14);
    ctx.fillStyle = 'rgba(16,18,15,0.9)'; ctx.fillRect(x, y, tw, th);
    ctx.strokeStyle = 'rgba(217,164,65,0.6)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, tw, th);
    lines.forEach((l, i) => { ctx.fillStyle = i === 0 && hv ? '#efe6cf' : '#b9b29c'; ctx.fillText(l, x + 8, y + 18 + i * 16); });
  }

  _scale() {
    const W = this.view.clientWidth || 800;
    return (W / 16384) * this.zoom;
  }

  _toWorld(px, py) {
    const s = this._scale();
    const W = this.view.clientWidth, H = this.view.clientHeight;
    return { x: this.center.x + (px - W / 2) / s, z: this.center.z + (py - H / 2) / s };
  }

  _toScreen(x, z) {
    const s = this._scale();
    const W = this.view.clientWidth, H = this.view.clientHeight;
    return [W / 2 + (x - this.center.x) * s, H / 2 + (z - this.center.z) * s];
  }

  draw() {
    if (!this.isOpen || !this.canvas) return;
    const W = this.view.clientWidth, H = this.view.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = W * dpr; this.canvas.height = H * dpr;
    this.canvas.style.width = `${W}px`; this.canvas.style.height = `${H}px`;
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = this.game;
    const s = this._scale();
    ctx.fillStyle = '#23241f';
    ctx.fillRect(0, 0, W, H);
    // terrain image
    const [x0, y0] = this._toScreen(-8192, -8192);
    if (this.image) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.image, x0, y0, 16384 * s, 16384 * s);
    } else {
      ctx.fillStyle = '#8a8670';
      ctx.font = '13px sans-serif';
      ctx.fillText('Surveying terrain…', 20, 30);
    }
    // water
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const r of g.world.rivers) {
      ctx.strokeStyle = '#5f8796';
      ctx.lineWidth = Math.max(1.5, r.width * s);
      this._path(ctx, r.points);
    }
    // rails
    for (const r of g.world.roads.filter((q) => q.type === 'rail' && this.filters.roads)) {
      ctx.strokeStyle = '#3d3a33'; ctx.lineWidth = 2.2; this._path(ctx, r.points);
      ctx.strokeStyle = '#cfc8b4'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.2; this._path(ctx, r.points); ctx.setLineDash([]);
    }
    // roads
    for (const r of g.world.roads.filter((q) => q.type !== 'rail' && this.filters.roads)) {
      const w = r.type === 'highway' ? 3.2 : r.type === 'road' ? 2.4 : 1.4;
      ctx.strokeStyle = r.type === 'dirt' ? '#7a6a4c' : '#3a352c';
      ctx.lineWidth = w + 1.5;
      this._path(ctx, r.points);
      ctx.strokeStyle = r.type === 'highway' ? '#e0b860' : r.type === 'road' ? '#e8dcc0' : '#c8b48a';
      ctx.lineWidth = w;
      this._path(ctx, r.points);
    }
    // bridges
    if (this.filters.roads && this.zoom > 2) for (const b of g.world.bridges) {
      ctx.strokeStyle = '#1c1a16'; ctx.lineWidth = 5; this._path(ctx, b.segs.map((q) => [q[0], q[1]]).concat([[b.bx, b.bz]]));
      ctx.strokeStyle = '#f2ead6'; ctx.lineWidth = 2.4; this._path(ctx, b.segs.map((q) => [q[0], q[1]]).concat([[b.bx, b.bz]]));
    }
    // wasteland: hatched band over the southern half
    if (this.filters.zones && g.wasteland?.active) {
      const [zx0, zy0] = this._toScreen(-8192, 0), [zx1, zy1] = this._toScreen(8192, 8192);
      ctx.save();
      ctx.beginPath(); ctx.rect(zx0, zy0, zx1 - zx0, zy1 - zy0); ctx.clip();
      ctx.fillStyle = 'rgba(120, 60, 20, 0.28)'; ctx.fillRect(zx0, zy0, zx1 - zx0, zy1 - zy0);
      ctx.strokeStyle = 'rgba(200, 90, 40, 0.35)'; ctx.lineWidth = 1.5;
      for (let k = -H; k < W + H; k += 18) { ctx.beginPath(); ctx.moveTo(k, Math.max(0, zy0)); ctx.lineTo(k + H, Math.max(0, zy0) + H); ctx.stroke(); }
      ctx.restore();
      ctx.strokeStyle = '#e0602a'; ctx.setLineDash([8, 6]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, zy0); ctx.lineTo(W, zy0); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#ffb080'; ctx.font = '600 12px Bahnschrift, Arial Narrow, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(`FALLOUT ZONE — ${g.wasteland.daysLeft().toFixed(1)} days left`, 12, Math.max(16, zy0 + 16));
      if (g.wasteland.gz) { const [gx, gy2] = this._toScreen(g.wasteland.gz.x, g.wasteland.gz.z); ctx.strokeStyle = '#ff5030'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(gx, gy2, 700 * s, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#ff7050'; ctx.fillText('GROUND ZERO', gx + 8, gy2 - 6); }
    }
    // grid: 1 km squares with labels
    if (this.filters.grid) {
      const step = this.zoom > 10 ? 250 : this.zoom > 4 ? 500 : 1000;
      const a = this._toWorld(0, 0), b2 = this._toWorld(W, H);
      ctx.strokeStyle = 'rgba(20,20,16,0.35)'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(20,20,16,0.75)'; ctx.font = '10px Consolas, monospace'; ctx.textAlign = 'left';
      for (let x = Math.ceil(a.x / step) * step; x < b2.x; x += step) { const [sx] = this._toScreen(x, 0); ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke(); ctx.fillText(String(x), sx + 3, 11); }
      for (let z = Math.ceil(a.z / step) * step; z < b2.z; z += step) { const [, sy] = this._toScreen(0, z); ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke(); ctx.fillText(String(z), 3, sy - 3); }
    }
    // fog of war
    this._fog(ctx, W, H);
    // region names
    ctx.textAlign = 'center';
    ctx.font = `600 ${Math.max(11, Math.min(18, 12 * Math.sqrt(this.zoom)))}px Bahnschrift, Arial Narrow, sans-serif`;
    for (const r of g.world.regions) {
      const [sx, sy] = this._toScreen(r.center[0], r.center[1]);
      ctx.fillStyle = 'rgba(40, 36, 28, 0.55)';
      ctx.fillText(r.name.toUpperCase(), sx, sy);
    }
    // POIs
    ctx.font = '12px Bahnschrift, Arial Narrow, sans-serif';
    for (const q of g.world.pois) {
      if (!g.discovered.has(q.id) || !this.filters.locations) continue;
      const [sx, sy] = this._toScreen(q.x, q.z);
      const hostile = g.poiHostile(q);
      ctx.fillStyle = hostile ? '#c9493a' : '#6f97b3';
      ctx.strokeStyle = '#151510';
      ctx.lineWidth = 1.5;
      const kind = this._kind(q);
      const hot = this.hover?.q === q;
      const r = hot ? 6.5 : 4.5;
      ctx.beginPath();
      if (kind === 'mil') { ctx.moveTo(sx, sy - r - 1); ctx.lineTo(sx + r + 1, sy + r); ctx.lineTo(sx - r - 1, sy + r); ctx.closePath(); }
      else if (kind === 'ind') { ctx.moveTo(sx, sy - r - 1); ctx.lineTo(sx + r + 1, sy); ctx.lineTo(sx, sy + r + 1); ctx.lineTo(sx - r - 1, sy); ctx.closePath(); }
      else if (kind === 'wild') ctx.arc(sx, sy, r, 0, Math.PI * 2);
      else ctx.rect(sx - r, sy - r, r * 2, r * 2);
      ctx.fill(); ctx.stroke();
      if (this.zoom > 2) {
        ctx.fillStyle = '#1a1912';
        ctx.fillText(q.name, sx + 1, sy - 9);
        ctx.fillStyle = '#efe6cf';
        ctx.fillText(q.name, sx, sy - 10);
      }
    }
    // base
    const bc = g.base.center();
    if (bc) {
      const [sx, sy] = this._toScreen(bc.x, bc.z);
      ctx.fillStyle = '#8fbf6a'; ctx.strokeStyle = '#151510'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx, sy - 8); ctx.lineTo(sx + 7, sy); ctx.lineTo(sx + 5, sy + 7); ctx.lineTo(sx - 5, sy + 7); ctx.lineTo(sx - 7, sy); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    const RD = g.raids?.raid;
    if (RD && RD.phase !== 'over' && RD.base) {
      const [sx, sy] = this._toScreen(RD.base.x, RD.base.z);
      ctx.strokeStyle = '#ff5030'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.arc(sx, sy, 16 + (Date.now() / 120) % 6, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#ff9070'; ctx.font = '600 11px Bahnschrift, Arial Narrow, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(RD.phase === 'warning' ? 'RAID INCOMING' : 'UNDER ATTACK', sx + 14, sy - 12);
    }
    if (this.filters.vehicles) {
      for (const v of g.vehicles.vehicles.values()) {
        if (!v.known || v === g.vehicles.current) continue;
        const [sx, sy] = this._toScreen(v.pos.x, v.pos.z);
        ctx.fillStyle = v.destroyed ? '#6a6458' : '#e8dcc0'; ctx.strokeStyle = '#151510'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx, sy, v.t.flying ? 5 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (v.t.flying) { ctx.beginPath(); ctx.moveTo(sx - 7, sy); ctx.lineTo(sx + 7, sy); ctx.moveTo(sx, sy - 7); ctx.lineTo(sx, sy + 7); ctx.stroke(); }
      }
      for (const cs of g.helis?.sites || []) {
        if (!cs.found) continue;
        const [sx, sy] = this._toScreen(cs.x, cs.z);
        ctx.strokeStyle = '#ffb060'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx - 6, sy - 6); ctx.lineTo(sx + 6, sy + 6); ctx.moveTo(sx + 6, sy - 6); ctx.lineTo(sx - 6, sy + 6); ctx.stroke();
        ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // markers & waypoint
    for (const m of this.filters.markers ? g.markers : []) {
      const [sx, sy] = this._toScreen(m.x, m.z);
      ctx.strokeStyle = '#e8dcc0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx - 5, sy - 5); ctx.lineTo(sx + 5, sy + 5); ctx.moveTo(sx + 5, sy - 5); ctx.lineTo(sx - 5, sy + 5); ctx.stroke();
      if (m.label && this.zoom > 2) { ctx.font = '11px Bahnschrift, Arial Narrow, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#151510'; ctx.fillText(m.label, sx + 9, sy + 5); ctx.fillStyle = '#e8dcc0'; ctx.fillText(m.label, sx + 8, sy + 4); ctx.textAlign = 'center'; ctx.font = '12px Bahnschrift, Arial Narrow, sans-serif'; }
    }
    if (g.waypoint) {
      // line and distance from you to the waypoint
      { const pp = g.player.controller.pos; const [ax, ay] = this._toScreen(pp.x, pp.z), [bx, by] = this._toScreen(g.waypoint.x, g.waypoint.z); ctx.strokeStyle = 'rgba(217,164,65,0.55)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]); const dd = Math.hypot(g.waypoint.x - pp.x, g.waypoint.z - pp.z); ctx.fillStyle = '#d9a441'; ctx.font = '11px Consolas, monospace'; ctx.textAlign = 'left'; ctx.fillText(dd > 1000 ? `${(dd / 1000).toFixed(1)} km` : `${Math.round(dd)} m`, bx + 12, by + 4); }
      const [sx, sy] = this._toScreen(g.waypoint.x, g.waypoint.z);
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 2.5; ctx.strokeRect(-6, -6, 12, 12);
      ctx.restore();
    }
    // player
    const p = g.player.controller.pos;
    const [px, py] = this._toScreen(p.x, p.z);
    const yaw = g.player.controller.yaw;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-yaw);
    ctx.fillStyle = '#d9a441'; ctx.strokeStyle = '#151510'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    // scale bar
    const meters = this.zoom > 8 ? 100 : this.zoom > 3 ? 500 : 1000;
    ctx.fillStyle = 'rgba(16,18,15,0.8)';
    ctx.fillRect(14, H - 34, meters * s + 20, 22);
    ctx.fillStyle = '#e8dcc0'; ctx.fillRect(24, H - 22, meters * s, 3);
    ctx.font = '11px Consolas, monospace'; ctx.textAlign = 'left';
    ctx.fillText(meters >= 1000 ? `${meters / 1000} km` : `${meters} m`, 24, H - 26);
    this._tooltip(ctx, W, H);
  }

  _path(ctx, pts) {
    ctx.beginPath();
    pts.forEach(([x, z], i) => {
      const [sx, sy] = this._toScreen(x, z);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    });
    ctx.stroke();
  }

  _fog(ctx, W, H) {
    const g = this.game;
    const F = g.fog;
    const N = F.size, cell = 16384 / N;
    const s = this._scale();
    ctx.fillStyle = 'rgba(30, 30, 26, 0.72)';
    // only iterate visible cells
    const a = this._toWorld(0, 0), b = this._toWorld(W, H);
    const i0 = Math.max(0, Math.floor((a.x + 8192) / cell)), i1 = Math.min(N - 1, Math.floor((b.x + 8192) / cell));
    const j0 = Math.max(0, Math.floor((a.z + 8192) / cell)), j1 = Math.min(N - 1, Math.floor((b.z + 8192) / cell));
    // one path so overlapping cell edges are not darkened twice
    ctx.beginPath();
    for (let j = j0; j <= j1; j++) {
      let run = -1;
      for (let i = i0; i <= i1 + 1; i++) {
        const hidden = i <= i1 && !F.data[j * N + i];
        if (hidden && run < 0) run = i;
        if (!hidden && run >= 0) {
          const [sx, sy] = this._toScreen(-8192 + run * cell, -8192 + j * cell);
          const [ex, ey] = this._toScreen(-8192 + i * cell, -8192 + (j + 1) * cell);
          ctx.rect(Math.floor(sx), Math.floor(sy), Math.ceil(ex) - Math.floor(sx), Math.ceil(ey) - Math.floor(sy));
          run = -1;
        }
      }
    }
    ctx.fill('nonzero');
  }
}

void bus;
