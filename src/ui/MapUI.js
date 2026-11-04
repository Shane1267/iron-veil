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
      if (!d) return;
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
      this.game.markers.push({ x: w.x, z: w.z, label: `Marker ${this.game.markers.length + 1}` });
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
    const list = h('div', { class: 'list' });
    const known = g.world.pois.filter((q) => g.discovered.has(q.id));
    list.appendChild(h('h4', { style: { fontSize: '10px', letterSpacing: '0.22em', color: 'var(--amber)', margin: '8px 0', fontWeight: 500 } }, `Known locations ${known.length}/${g.world.pois.length}`));
    known.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    for (const q of known) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      const fac = g.poiFactionLabel(q);
      list.appendChild(h('div', { class: 'poi', onclick: () => { this.center = { x: q.x, z: q.z }; this.zoom = Math.max(this.zoom, 6); this.draw(); } },
        h('span', {}, q.name, fac ? h('span', { style: { color: 'var(--ink-faint)', fontSize: '10px', marginLeft: '6px' } }, fac) : ''), h('i', {}, d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`)));
    }
    side.appendChild(list);
    side.appendChild(h('div', { class: 'sec' }, h('div', { class: 'legend' },
      h('span', { style: { background: '#d9a441', borderRadius: '50%' } }), 'You',
      h('span', { style: { background: '#8fbf6a' } }), 'Your base',
      h('span', { style: { background: '#c9493a' } }), 'Hostile location',
      h('span', { style: { background: '#6f97b3' } }), 'Friendly / neutral',
      h('span', { style: { border: '2px solid #d9a441', transform: 'rotate(45deg) scale(0.7)' } }), 'Waypoint')));
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
    for (const r of g.world.roads.filter((q) => q.type === 'rail')) {
      ctx.strokeStyle = '#3d3a33'; ctx.lineWidth = 2.2; this._path(ctx, r.points);
      ctx.strokeStyle = '#cfc8b4'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.2; this._path(ctx, r.points); ctx.setLineDash([]);
    }
    // roads
    for (const r of g.world.roads.filter((q) => q.type !== 'rail')) {
      const w = r.type === 'highway' ? 3.2 : r.type === 'road' ? 2.4 : 1.4;
      ctx.strokeStyle = r.type === 'dirt' ? '#7a6a4c' : '#3a352c';
      ctx.lineWidth = w + 1.5;
      this._path(ctx, r.points);
      ctx.strokeStyle = r.type === 'highway' ? '#e0b860' : r.type === 'road' ? '#e8dcc0' : '#c8b48a';
      ctx.lineWidth = w;
      this._path(ctx, r.points);
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
      if (!g.discovered.has(q.id)) continue;
      const [sx, sy] = this._toScreen(q.x, q.z);
      const hostile = g.poiHostile(q);
      ctx.fillStyle = hostile ? '#c9493a' : '#6f97b3';
      ctx.strokeStyle = '#151510';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(sx - 4, sy - 4, 8, 8);
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
    // markers & waypoint
    for (const m of g.markers) {
      const [sx, sy] = this._toScreen(m.x, m.z);
      ctx.strokeStyle = '#e8dcc0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx - 5, sy - 5); ctx.lineTo(sx + 5, sy + 5); ctx.moveTo(sx + 5, sy - 5); ctx.lineTo(sx - 5, sy + 5); ctx.stroke();
    }
    if (g.waypoint) {
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
