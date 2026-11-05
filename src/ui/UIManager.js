import { h, clear } from './dom.js';
import { HUD } from './HUD.js';
import { InventoryUI } from './InventoryUI.js';
import { MapUI } from './MapUI.js';
import { CraftUI, BuildMenuUI } from './CraftBuildUI.js';
import { SettingsUI } from './SettingsUI.js';
import { TradeUI } from './TradeUI.js';
import { STEPS } from '../core/Objectives.js';
import { SKILLS } from '../player/Player.js';
import { saves, SLOTS } from '../core/SaveManager.js';
import { bus } from '../core/EventBus.js';

// Owns every screen and the current UI mode. Game input is suspended (and the pointer
// released) whenever a menu is open.

const TIPS = [
  'Gunfire carries for hundreds of metres. Every shot tells the region where you are.',
  'Bandages stop bleeding. Medical kits restore health. Neither works instantly.',
  'Crouching and moving slowly makes you far harder to spot, especially at night.',
  'A lit flashlight can be seen from very far away in the dark.',
  'Walls block bullets. Wood and thin metal do not stop everything.',
  'Raiders who spot your base may come back for it. Lock your storage.',
  'Rifles use real projectiles: aim higher at long range.',
  'Hunting cabins and ranger stations often keep rifles. Military bases keep better ones — and better guards.',
];

export class UIManager {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui-root');
    this.mode = 'menu';
    this.hud = new HUD(game, this.root);
    this.inventory = new InventoryUI(this);
    this.map = new MapUI(this);
    this.craft = new CraftUI(this);
    this.buildMenu = new BuildMenuUI(this);
    this.settings = new SettingsUI(this);
    this.trade = new TradeUI(this);
    this.screen = h('div', { class: 'screen hidden' });
    this.root.appendChild(this.screen);
    this.clickToPlay = h('div', { class: 'click-to-play hidden', onclick: () => this.game.input.lock() }, 'Click to continue');
    this.root.appendChild(this.clickToPlay);
    game.renderer.renderer.domElement.addEventListener('click', () => {
      if (this.mode === 'playing' && !game.input.locked) game.input.lock();
    });
    game.input.onLockChange = (locked, isError, wasLocked) => {
      if (!locked && !isError && wasLocked && this.mode === 'playing' && !this.game.dead && !this.game.net?.chatting) {
        // pointer released by the player (Esc): open the pause menu
        this.open('pause');
      }
      this._updateClickPrompt();
    };
  }

  get isGameplay() {
    return this.mode === 'playing';
  }

  _updateClickPrompt() {
    this.clickToPlay.classList.toggle('hidden', !(this.mode === 'playing' && !this.game.input.locked));
  }

  /** Switch modes. */
  open(mode, opts) {
    this._hideAll();
    this.mode = mode;
    const g = this.game;
    const inGame = !['menu', 'loading'].includes(mode);
    this.hud.show(inGame && mode !== 'dead');
    g.input.uiCapture = mode !== 'playing';
    if (mode === 'playing') {
      g.input.lock();
    } else {
      g.input.unlock();
    }
    switch (mode) {
      case 'inventory': this.inventory.open(opts); break;
      case 'map': this.map.open(); break;
      case 'craft': this.craft.open(); break;
      case 'build': this.buildMenu.open(); break;
      case 'pause': this._pause(); break;
      case 'menu': this._mainMenu(); break;
      case 'loading': this._loading(); break;
      case 'dead': this._death(opts); break;
      case 'journal': this._journal(); break;
      case 'trade': this.trade.open(opts); break;
      case 'settings': this.settings.open(() => this.open(opts?.back || (g.started ? 'pause' : 'menu'))); break;
      default: break;
    }
    this._updateClickPrompt();
  }

  close() {
    if (this.mode === 'settings') { this.settings.close(); return; }
    if (this.game.started && !this.game.dead) this.open('playing');
  }

  _hideAll() {
    if (this.inventory.isOpen) this.inventory.close();
    this.map.close();
    this.craft.close();
    this.buildMenu.close();
    if (this.trade.isOpen) this.trade.close();
    if (this.settings.isOpen) { this.settings.onClose = null; this.settings.el.classList.add('hidden'); }
    this.screen.classList.add('hidden');
    this.screen.className = 'screen hidden';
    clear(this.screen);
  }

  update(dt) {
    if (this.mode !== 'menu' && this.mode !== 'loading') this.hud.update(dt);
    if (this.craft.isOpen && this.game.crafting.job) this.craft.render();
    if (this.map.isOpen) { this._mapT = (this._mapT || 0) - dt; if (this._mapT <= 0) { this._mapT = 0.5; this.map.draw(); } }
  }

  // ------------------------------------------------------------ screens
  _show(cls) {
    this.screen.className = `screen ${cls}`;
    this.screen.classList.remove('hidden');
    return this.screen;
  }

  async _mainMenu() {
    const s = this._show('menu-screen');
    const canvas = h('canvas', { class: 'backdrop' });
    s.appendChild(canvas);
    this._drawBackdrop(canvas);
    const latest = await saves.latest().catch(() => null);
    const left = h('div', { class: 'menu-left interactive' },
      h('div', { class: 'title' }, h('span', {}, 'Operation'), 'Iron Veil'),
      h('div', { class: 'tagline' }, 'Vesper has no government, no front line and no rescue. Scavenge, fight the people who would take what you have, build somewhere defensible — and decide who answers when you call.'),
      h('div', { class: 'menu-list' },
        h('button', { class: 'btn primary', disabled: !latest, onclick: () => latest && this.game.loadGame(latest.slot) }, latest ? `Continue — ${latest.summary?.label || latest.slot}` : 'Continue'),
        h('button', { class: 'btn', onclick: () => this.game.newGame() }, 'New Game'),
        h('button', { class: 'btn', onclick: () => this._onlinePanel(s) }, 'Play Online'),
        h('button', { class: 'btn', onclick: () => this._slotsPanel(s, 'load') }, 'Load Game'),
        h('button', { class: 'btn', onclick: () => this.open('settings', { back: 'menu' }) }, 'Settings'),
        h('button', { class: 'btn', onclick: () => this._aboutPanel(s) }, 'About & Controls'),
      ),
    );
    s.append(left, h('div', { class: 'menu-foot' }, 'Saves are stored in this browser (IndexedDB). Clearing site data or private browsing will erase them.'));
  }

  _drawBackdrop(canvas) {
    const w = (canvas.width = window.innerWidth), hgt = (canvas.height = window.innerHeight);
    const c = canvas.getContext('2d');
    const sky = c.createLinearGradient(0, 0, 0, hgt);
    sky.addColorStop(0, '#1c2430'); sky.addColorStop(0.55, '#5a4e46'); sky.addColorStop(0.72, '#b07a4e'); sky.addColorStop(1, '#151612');
    c.fillStyle = sky; c.fillRect(0, 0, w, hgt);
    // sun haze
    const sun = c.createRadialGradient(w * 0.72, hgt * 0.62, 0, w * 0.72, hgt * 0.62, hgt * 0.5);
    sun.addColorStop(0, 'rgba(255, 200, 140, 0.55)'); sun.addColorStop(1, 'rgba(255, 200, 140, 0)');
    c.fillStyle = sun; c.fillRect(0, 0, w, hgt);
    // ridgelines
    const ridge = (y, amp, color, seed) => {
      c.fillStyle = color;
      c.beginPath(); c.moveTo(0, hgt);
      for (let x = 0; x <= w; x += 6) {
        const n = Math.sin(x * 0.004 + seed) * 0.5 + Math.sin(x * 0.011 + seed * 2) * 0.3 + Math.sin(x * 0.031 + seed * 3) * 0.12;
        c.lineTo(x, y - n * amp);
      }
      c.lineTo(w, hgt); c.fill();
    };
    ridge(hgt * 0.66, 70, '#3a3632', 1);
    ridge(hgt * 0.72, 55, '#2a2a26', 4);
    // treeline
    c.fillStyle = '#181a16';
    c.beginPath(); c.moveTo(0, hgt);
    for (let x = 0; x <= w; x += 4) {
      const base = hgt * 0.8 + Math.sin(x * 0.006) * 14;
      const tree = (Math.sin(x * 0.9) * 0.5 + 0.5) * 26 + (Math.sin(x * 0.37) * 0.5 + 0.5) * 18;
      c.lineTo(x, base - tree);
    }
    c.lineTo(w, hgt); c.fill();
    // comm tower silhouette
    c.strokeStyle = '#121310'; c.lineWidth = 2;
    const tx = w * 0.58, ty = hgt * 0.78;
    c.beginPath(); c.moveTo(tx - 14, ty); c.lineTo(tx, ty - 180); c.lineTo(tx + 14, ty);
    for (let k = 0; k < 9; k++) { const y = ty - k * 20, s = 14 * (1 - (k * 20) / 180); c.moveTo(tx - s, y); c.lineTo(tx + s * 0.8, y - 20); }
    c.stroke();
    c.fillStyle = '#c9493a'; c.fillRect(tx - 2, ty - 186, 4, 4);
    c.fillStyle = 'rgba(10, 11, 9, 0.35)'; c.fillRect(0, 0, w, hgt);
  }

  async _slotsPanel(screen, mode) {
    screen.querySelector('.menu-side')?.remove();
    const list = await saves.list().catch(() => []);
    const side = h('div', { class: 'panel menu-side interactive' });
    side.appendChild(h('div', { class: 'panel-head' }, h('h2', {}, mode === 'load' ? 'Load Game' : 'Save Game'), h('span', { class: 'sub' }, saves.mode === 'local' ? 'localStorage fallback' : 'IndexedDB')));
    const box = h('div', { class: 'slots' });
    for (const slot of SLOTS) {
      if (mode === 'save' && slot === 'auto') continue;
      const rec = list.find((r) => r.slot === slot);
      const name = slot === 'auto' ? 'Autosave' : `Slot ${slot.slice(-1)}`;
      const meta = rec ? `${rec.summary?.label || ''} · ${new Date(rec.timestamp).toLocaleString()}${rec.valid ? '' : ' · CORRUPT (backup will be tried)'}` : 'Empty';
      const actions = h('div', { class: 'a' });
      if (mode === 'load') {
        actions.appendChild(h('button', { class: 'btn small', disabled: !rec, onclick: () => this.game.loadGame(slot) }, 'Load'));
      } else {
        actions.appendChild(h('button', { class: 'btn small primary', onclick: async () => { await this.game.saveGame(slot); this._slotsPanel(screen, mode); } }, rec ? 'Overwrite' : 'Save'));
      }
      if (rec) actions.appendChild(h('button', { class: 'btn small danger', onclick: async () => { if (confirm(`Delete ${name}?`)) { await saves.remove(slot); this._slotsPanel(screen, mode); } } }, 'Delete'));
      box.appendChild(h('div', { class: 'slot' }, h('div', {}, h('div', { class: 'n' }, name), h('div', { class: 'm' }, meta)), actions));
    }
    side.appendChild(box);
    side.appendChild(h('div', { class: 'inv-foot' }, h('span', {}, 'Saves stay in this browser only and do not sync between devices.'), h('button', { class: 'btn small', onclick: () => side.remove() }, 'Close')));
    screen.appendChild(side);
  }

  _onlinePanel(screen) {
    screen.querySelector('.menu-side')?.remove();
    const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* storage blocked */ } return null; };
    const params = new URLSearchParams(location.search);
    // ?server=… in the page address pre-fills (and with ?join=1 starts) the connection
    const sameOrigin = /^https?:$/.test(location.protocol) && !/claudeusercontent|localhost:5173/.test(location.host);
    const addr = h('input', { class: 'text-input', type: 'text', placeholder: sameOrigin ? 'Leave empty for this website' : 'e.g. iron-veil.onrender.com', value: params.get('server') || store('ironveil.server') || '' });
    const name = h('input', { class: 'text-input', type: 'text', maxlength: '20', placeholder: 'Survivor', value: store('ironveil.name') || '' });
    const status = h('div', { class: 'online-status' });
    const go = async () => {
      store('ironveil.server', addr.value.trim());
      store('ironveil.name', name.value.trim());
      status.textContent = 'Connecting…';
      await this.game.joinOnline(addr.value.trim(), name.value.trim() || 'Survivor');
    };
    const side = h('div', { class: 'panel menu-side interactive' });
    side.appendChild(h('div', { class: 'panel-head' }, h('h2', {}, 'Play Online'), h('span', { class: 'sub' }, 'co-op')));
    side.appendChild(h('div', { class: 'journal' }, h('div', { class: 'body' },
      h('p', {}, 'Everyone on a server shares one world: the same soldiers, raiders and survivors, the same gunfights, bodies, doors, time of day and weather.'),
      h('label', { class: 'field' }, h('span', {}, 'Server address'), addr),
      h('label', { class: 'field' }, h('span', {}, 'Your name'), name),
      h('p', { class: 'small' }, 'Your online character — gear, skills, map and base — is saved in this browser, separately from single-player saves. Containers and bases are your own; the people in the world are shared. Press Enter in game to chat.'),
      status,
    )));
    side.appendChild(h('div', { class: 'inv-foot' }, h('button', { class: 'btn small', onclick: () => side.remove() }, 'Close'), h('button', { class: 'btn primary', onclick: go }, 'Join')));
    screen.appendChild(side);
    name.addEventListener('keydown', (e) => { if (e.code === 'Enter') go(); });
    addr.addEventListener('keydown', (e) => { if (e.code === 'Enter') go(); });
    if (params.get('join') === '1' && !this._autoJoined) { this._autoJoined = true; go(); }
  }

  _aboutPanel(screen) {
    screen.querySelector('.menu-side')?.remove();
    const side = h('div', { class: 'panel menu-side interactive' });
    side.appendChild(h('div', { class: 'panel-head' }, h('h2', {}, 'About'), h('span', { class: 'sub' }, 'v0.1 vertical slice')));
    side.appendChild(h('div', { class: 'journal' },
      h('div', { class: 'body' },
        h('p', {}, 'Vesper is a 16 km region abandoned by its government. Five factions — the Vesper Security Forces, the Iron Wolves, the Settlement Guard, the Free Companies and independent survivors — fight over what is left. There are no monsters here. Only people.'),
        h('p', {}, 'Everything you see and hear is generated at runtime: terrain, buildings, weapons, characters, textures and sound. No third-party art or audio assets are used.'),
        h('h4', {}, 'Controls'),
        h('div', { class: 'controls-list' }, ...['Move:WASD', 'Sprint:Shift', 'Crouch / Prone:C / Z', 'Fire / Aim:LMB / RMB', 'Reload:R', 'Interact:E', 'Secondary:F', 'Inventory:Tab', 'Map:M', 'Build:G', 'Craft:H', 'Journal:J', 'Light:T', 'Pause:Esc'].map((x) => { const [a, b] = x.split(':'); return [h('span', {}, a), h('span', { class: 'key' }, b)]; }).flat()),
      )));
    side.appendChild(h('div', { class: 'inv-foot' }, h('span', {}), h('button', { class: 'btn small', onclick: () => side.remove() }, 'Close')));
    screen.appendChild(side);
  }

  _loading() {
    const s = this._show('loading');
    this.loadBar = h('i');
    this.loadStage = h('div', { class: 'stage' }, 'Preparing');
    s.append(h('div', { class: 'ttl' }, 'Entering Vesper'), h('div', { class: 'bar' }, this.loadBar), this.loadStage, h('div', { class: 'tip' }, TIPS[Math.floor(Math.random() * TIPS.length)]));
  }

  setLoading(frac, stage) {
    if (this.loadBar) this.loadBar.style.width = `${Math.round(frac * 100)}%`;
    if (this.loadStage && stage) this.loadStage.textContent = stage;
  }

  _pause() {
    const s = this._show('dim');
    const g = this.game;
    const box = h('div', { class: 'panel pause-box interactive' },
      h('div', { class: 'panel-head' }, h('h2', {}, g.online ? 'Menu' : 'Paused'), h('span', { class: 'sub' }, g.online ? 'Online — the world keeps going' : `Day ${g.clock.day} · ${g.clock.label}`)),
      h('div', { class: 'menu-list' },
        h('button', { class: 'btn primary', onclick: () => this.open('playing') }, 'Resume'),
        g.online ? h('button', { class: 'btn', onclick: () => g.saveGame('online') }, 'Save Character') : h('button', { class: 'btn', onclick: () => this._slotsPanel(s, 'save') }, 'Save Game'),
        g.online ? null : h('button', { class: 'btn', onclick: () => this._slotsPanel(s, 'load') }, 'Load Game'),
        h('button', { class: 'btn', onclick: () => this.open('journal') }, 'Journal & Skills'),
        h('button', { class: 'btn', onclick: () => this.open('settings', { back: 'pause' }) }, 'Settings'),
        h('button', { class: 'btn danger', onclick: () => g.quitToMenu() }, g.online ? 'Leave Server' : 'Quit to Main Menu'),
      ));
    s.appendChild(box);
  }

  _journal() {
    const s = this._show('dim');
    const g = this.game;
    const obj = g.objectives;
    const steps = STEPS.map((st, i) => h('div', { class: `step ${obj.completed.has(st.id) ? 'done' : i === obj.index ? 'cur' : ''}` }, h('b', {}, `${i + 1}. ${st.title}`), h('div', {}, st.hint)));
    const sk = g.player.skills;
    const skills = h('div', { class: 'skills' }, ...Object.entries(SKILLS).map(([k, d]) => [h('span', {}, `${d.name} — ${d.desc}`), h('span', { class: 'key' }, `Lv ${sk.level(k)}`)]).flat());
    const fac = h('div', { class: 'skills' }, ...g.factionList().map((f) => [h('span', {}, `${f.name}`), h('span', { style: { color: f.rel <= -30 ? '#e79a8c' : f.rel >= 30 ? '#b8d49a' : 'var(--ink-dim)' } }, f.rel <= -30 ? 'Hostile' : f.rel >= 30 ? 'Friendly' : 'Neutral')]).flat());
    const lore = g.journalPages.map((p) => h('p', { style: { borderLeft: '2px solid var(--line)', paddingLeft: '10px' } }, p));
    s.appendChild(h('div', { class: 'panel journal interactive' },
      h('div', { class: 'panel-head' }, h('h2', {}, 'Journal'), h('span', { class: 'sub' }, `Survived ${Math.floor(g.player.stats.timeAlive / 60)} min · ${g.player.stats.kills} kills`)),
      h('div', { class: 'body' }, h('h4', {}, 'Signal from Northwatch'), ...steps, h('h4', {}, 'Skills'), skills, h('h4', {}, 'Factions'), fac, lore.length ? h('h4', {}, 'Recovered notes') : '', ...lore),
      h('div', { class: 'inv-foot' }, h('span', {}), h('button', { class: 'btn small', onclick: () => this.close() }, 'Close'))));
  }

  _death(info) {
    const s = this._show('death');
    const g = this.game;
    const st = g.player.stats;
    const mins = Math.floor(st.timeAlive / 60);
    s.append(
      h('h1', {}, 'You Died'),
      h('div', { class: 'cause' }, info?.cause ? `Cause: ${info.cause}` : ''),
      h('div', { class: 'stats' }, h('div', {}, h('b', {}, `${mins} min`), 'Survived'), h('div', {}, h('b', {}, String(st.kills)), 'Kills'), h('div', {}, h('b', {}, `Day ${g.clock.day}`), 'World day')),
      h('div', { class: 'cause', style: { marginBottom: '22px' } }, 'Your gear stays with your body. Respawning starts a new life in the same world.'),
      h('div', { class: 'row interactive' },
        h('button', { class: 'btn primary', onclick: () => g.respawn() }, g.base.respawnPoint() ? 'Respawn at bedroll' : 'Respawn'),
        h('button', { class: 'btn', onclick: () => this._slotsPanel(s, 'load') }, 'Load save'),
        h('button', { class: 'btn danger', onclick: () => g.quitToMenu() }, 'Main menu')),
    );
  }
}

void bus;
