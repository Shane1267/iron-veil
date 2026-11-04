import { settings } from '../core/SettingsManager.js';
import { bus } from '../core/EventBus.js';
import { clamp } from '../core/MathUtil.js';

// Fully synthesised, spatialised audio (Web Audio API). Every sound in the game is
// generated procedurally — no third-party samples. Gunshots model a near crack, body
// thump and environment-dependent tail; distant shots arrive late (speed of sound),
// muffled and with long rolling echoes.

const SPEED_OF_SOUND = 343;

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.listener = { x: 0, y: 0, z: 0 };
    this.voices = 0;
    this.maxVoices = 64;
    this.indoor = 0;
    this.ambience = null;
    this.engine = null;
    bus.on('settings:changed', () => this._applyVolumes());
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.knee.value = 12; this.comp.ratio.value = 6;
    this.master.connect(this.comp).connect(c.destination);
    this.buses = {};
    for (const b of ['weapons', 'ambience', 'vehicles', 'ui', 'world']) {
      const g = c.createGain();
      g.connect(this.master);
      this.buses[b] = g;
    }
    // shared noise buffers
    this.white = this._noiseBuffer('white', 2);
    this.pink = this._noiseBuffer('pink', 4);
    this.brown = this._noiseBuffer('brown', 6);
    // reverbs: outdoor echo (long, sparse) and indoor room (short, dense)
    this.outdoorVerb = c.createConvolver();
    this.outdoorVerb.buffer = this._impulse(2.8, 3.2, true);
    this.indoorVerb = c.createConvolver();
    this.indoorVerb.buffer = this._impulse(0.7, 2.0, false);
    this.verbSend = c.createGain();
    this.verbSend.gain.value = 0.5;
    this.indoorSend = c.createGain();
    this.indoorSend.gain.value = 0;
    this.verbSend.connect(this.outdoorVerb).connect(this.buses.weapons);
    this.indoorSend.connect(this.indoorVerb).connect(this.buses.weapons);
    this._applyVolumes();
    this._startAmbience();
    this.ready = true;
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const s = settings.values;
    this.master.gain.value = s.volMaster;
    this.buses.weapons.gain.value = s.volWeapons;
    this.buses.world.gain.value = s.volWeapons * 0.9;
    this.buses.ambience.gain.value = s.volAmbience;
    this.buses.vehicles.gain.value = s.volVehicles;
    this.buses.ui.gain.value = s.volUI;
  }

  _noiseBuffer(kind, seconds) {
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') {
        b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  _impulse(seconds, decay, echoes) {
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        let v = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        if (echoes) {
          // discrete slap-back echoes from terrain and treelines
          for (const e of [0.12, 0.31, 0.55, 0.9]) {
            const k = Math.abs(t * seconds - e);
            if (k < 0.03) v += (Math.random() * 2 - 1) * (1 - k / 0.03) * 0.6 * (1 - e / seconds);
          }
          v *= 0.6;
        }
        d[i] = v;
      }
    }
    return buf;
  }

  setListener(pos, quat) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    this.listener = { x: pos.x, y: pos.y, z: pos.z };
    const fx = -2 * (quat.x * quat.z + quat.w * quat.y), fy = -2 * (quat.y * quat.z - quat.w * quat.x), fz = -(1 - 2 * (quat.x * quat.x + quat.y * quat.y));
    const ux = 2 * (quat.x * quat.y - quat.w * quat.z), uy = 1 - 2 * (quat.x * quat.x + quat.z * quat.z), uz = 2 * (quat.y * quat.z + quat.w * quat.x);
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setValueAtTime(pos.x, t); L.positionY.setValueAtTime(pos.y, t); L.positionZ.setValueAtTime(pos.z, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(ux, t); L.upY.setValueAtTime(uy, t); L.upZ.setValueAtTime(uz, t);
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  setIndoor(v) {
    this.indoor = v;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.verbSend.gain.setTargetAtTime(v ? 0.12 : 0.5, t, 0.3);
    this.indoorSend.gain.setTargetAtTime(v ? 0.55 : 0, t, 0.3);
  }

  // ------------------------------------------------------------ building blocks
  _panner(x, y, z) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 4;
    p.maxDistance = 2000;
    p.rolloffFactor = 1.1;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
    return p;
  }

  /** Create a routed output chain: [source] -> gain -> (filter) -> (panner) -> bus */
  _out(busName, pos, opts = {}) {
    const c = this.ctx;
    const g = c.createGain();
    let node = g;
    if (opts.lowpass) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.lowpass;
      node.connect(f);
      node = f;
    }
    if (pos) {
      const p = this._panner(pos.x, pos.y, pos.z);
      node.connect(p);
      node = p;
    }
    node.connect(this.buses[busName]);
    if (opts.verb) {
      const s = c.createGain();
      s.gain.value = opts.verb;
      g.connect(s);
      s.connect(this.verbSend);
      s.connect(this.indoorSend);
    }
    return g;
  }

  _noise(buf, dest, t0, dur, { type = 'bandpass', freq = 1000, q = 1, gain = 1, attack = 0.002, decay = null, rate = 1, sweep = null }) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), t0 + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (decay ?? dur));
    src.connect(f).connect(g).connect(dest);
    src.start(t0, Math.random() * 1.0);
    src.stop(t0 + dur + 0.05);
    this._voice(src, dur);
  }

  _tone(dest, t0, dur, { type = 'sine', freq = 100, to = null, gain = 0.5, attack = 0.003 }) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    this._voice(o, dur);
  }

  _voice(node, dur) {
    this.voices++;
    node.onended = () => { this.voices--; };
    void dur;
  }

  _dist(x, y, z) {
    const L = this.listener;
    return Math.hypot(x - L.x, y - L.y, z - L.z);
  }

  // ------------------------------------------------------------ game sounds
  gunshot(e) {
    if (!this.ready || this.voices > this.maxVoices) return;
    const c = this.ctx;
    const w = e.weapon;
    const snd = w.sound || { body: 1, crack: 1, pitch: 1, tail: 1 };
    const suppressed = e.suppressed;
    const player = !!e.player;
    const d = player ? 0 : this._dist(e.x, e.y, e.z);
    if (d > 2200) return;
    const t0 = c.currentTime + (player ? 0 : d / SPEED_OF_SOUND);
    const far = d > 160;
    const lp = player ? 18000 : 400 + 16000 * Math.exp(-d / 180);
    const pos = player ? null : { x: e.x, y: e.y, z: e.z };
    const loud = player ? 1 : 1;
    const out = this._out('weapons', pos, { lowpass: lp, verb: player ? 0.35 : far ? 0.9 : 0.5 });
    const p = snd.pitch;
    if (suppressed) {
      this._noise(this.white, out, t0, 0.12, { type: 'bandpass', freq: 1800 * p, q: 0.8, gain: 0.35 * loud, decay: 0.09 });
      this._noise(this.pink, out, t0, 0.15, { type: 'lowpass', freq: 500 * p, q: 0.7, gain: 0.3 * snd.body, decay: 0.12 });
      if (w.velocity > 340) this._noise(this.white, out, t0, 0.03, { type: 'highpass', freq: 3500, q: 0.7, gain: 0.25 * snd.crack, decay: 0.025 });
      return;
    }
    if (!far) {
      // supersonic crack / mechanical snap
      this._noise(this.white, out, t0, 0.05, { type: 'highpass', freq: 2400 * p, q: 0.7, gain: 0.9 * snd.crack * loud, decay: 0.045 });
      // body
      this._noise(this.pink, out, t0, 0.35, { type: 'bandpass', freq: 380 * p, q: 0.9, gain: 1.4 * snd.body * loud, attack: 0.001, decay: 0.12 + snd.body * 0.12 });
      this._tone(out, t0, 0.16, { type: 'sine', freq: 95 * p, to: 42, gain: 0.9 * snd.body * loud, attack: 0.002 });
    }
    // tail / rolling echo
    const tail = snd.tail * (far ? 1.4 : 1);
    this._noise(this.brown, out, t0 + 0.01, 0.6 + tail * 0.8, { type: 'lowpass', freq: far ? 380 : 900, q: 0.5, gain: (far ? 1.1 : 0.55) * tail, attack: far ? 0.02 : 0.005, decay: 0.5 + tail * 0.7 });
    if (far) this._noise(this.brown, out, t0 + 0.25 + Math.random() * 0.3, 1.4, { type: 'lowpass', freq: 260, q: 0.4, gain: 0.5 * tail, attack: 0.08, decay: 1.3 });
  }

  play(e) {
    if (!this.ready || this.voices > this.maxVoices) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const pos = e.ui || e.x === undefined ? null : { x: e.x, y: e.y, z: e.z };
    if (pos && this._dist(pos.x, pos.y, pos.z) > 120 && !['explosion', 'collapse'].includes(e.type)) return;
    switch (e.type) {
      case 'reload': {
        const out = this._out('weapons', pos, { verb: 0.1 });
        const st = e.stage;
        if (st === 'start') { this._click(out, t0, 2600, 0.25); this._noise(this.white, out, t0 + 0.08, 0.15, { type: 'bandpass', freq: 1400, q: 2, gain: 0.12, decay: 0.12 }); }
        else if (st === 'insert') { this._click(out, t0, 1800, 0.35); this._click(out, t0 + 0.06, 2400, 0.25); }
        else if (st === 'end' || st === 'rack') { this._click(out, t0, 1500, 0.4); this._noise(this.white, out, t0 + 0.02, 0.12, { type: 'bandpass', freq: 900, q: 1.5, gain: 0.25, decay: 0.1 }); this._click(out, t0 + 0.12, 2200, 0.35); }
        else if (st === 'shell') { this._click(out, t0, 1100, 0.3); this._noise(this.white, out, t0, 0.08, { type: 'bandpass', freq: 2000, q: 2, gain: 0.08, decay: 0.07 }); }
        else if (st === 'pump') { this._noise(this.white, out, t0, 0.12, { type: 'bandpass', freq: 700, q: 1.2, gain: 0.35, decay: 0.1 }); this._click(out, t0 + 0.1, 900, 0.4); this._noise(this.white, out, t0 + 0.2, 0.12, { type: 'bandpass', freq: 800, q: 1.2, gain: 0.35, decay: 0.1 }); this._click(out, t0 + 0.32, 1200, 0.45); }
        else if (st === 'bolt') { this._click(out, t0, 1600, 0.3); this._noise(this.white, out, t0 + 0.08, 0.15, { type: 'bandpass', freq: 1300, q: 1.5, gain: 0.2, decay: 0.12 }); this._noise(this.white, out, t0 + 0.3, 0.12, { type: 'bandpass', freq: 1500, q: 1.5, gain: 0.2, decay: 0.1 }); this._click(out, t0 + 0.42, 2000, 0.35); }
        break;
      }
      case 'dryfire': { const out = this._out('weapons', null); this._click(out, t0, 3000, 0.25); break; }
      case 'click': case 'equip': { const out = this._out('ui', null); this._click(out, t0, e.type === 'equip' ? 900 : 2400, 0.18); if (e.type === 'equip') this._noise(this.white, out, t0, 0.2, { type: 'bandpass', freq: 600, q: 1, gain: 0.1, decay: 0.18 }); break; }
      case 'ui': { const out = this._out('ui', null); this._tone(out, t0, 0.06, { freq: e.freq || 880, gain: 0.08 }); break; }
      case 'uiError': { const out = this._out('ui', null); this._tone(out, t0, 0.15, { type: 'square', freq: 140, gain: 0.05 }); break; }
      case 'pickup': { const out = this._out('ui', null); this._noise(this.pink, out, t0, 0.12, { type: 'bandpass', freq: 1200, q: 0.8, gain: 0.15, decay: 0.1 }); break; }
      case 'swing': { const out = this._out('weapons', null); this._noise(this.white, out, t0, 0.25, { type: 'bandpass', freq: 500, q: 1.5, gain: 0.25, sweep: 1600, decay: 0.22 }); break; }
      case 'meleeHit': { const out = this._out('weapons', pos); this._noise(this.pink, out, t0, 0.15, { type: 'lowpass', freq: e.flesh ? 400 : 1500, q: 1, gain: 0.7, decay: 0.12 }); this._tone(out, t0, 0.1, { freq: 120, to: 60, gain: 0.4 }); break; }
      case 'door': {
        const out = this._out('ambience', pos, { verb: 0.2 });
        if (e.open) this._tone(out, t0, 0.5, { type: 'sawtooth', freq: e.metal ? 380 : 220, to: e.metal ? 320 : 160, gain: 0.03, attack: 0.05 });
        this._noise(this.pink, out, t0 + (e.open ? 0.3 : 0), 0.2, { type: 'lowpass', freq: e.metal ? 1600 : 700, q: 1, gain: 0.5, decay: 0.15 });
        break;
      }
      case 'glass': {
        const out = this._out('world', pos, { verb: 0.2 });
        for (let i = 0; i < 9; i++) this._tone(out, t0 + i * 0.012 + Math.random() * 0.03, 0.12, { type: 'sine', freq: 3000 + Math.random() * 4000, gain: 0.06 });
        this._noise(this.white, out, t0, 0.3, { type: 'highpass', freq: 3000, q: 0.7, gain: 0.3, decay: 0.25 });
        break;
      }
      case 'radio': {
        const out = this._out('world', pos);
        this._noise(this.white, out, t0, 0.25, { type: 'bandpass', freq: 2200, q: 3, gain: 0.08, decay: 0.22 });
        this._tone(out, t0 + 0.24, 0.05, { type: 'square', freq: 1400, gain: 0.02 });
        break;
      }
      case 'build': {
        const out = this._out('ambience', pos, { verb: 0.2 });
        for (let i = 0; i < 3; i++) { this._tone(out, t0 + i * 0.22, 0.09, { freq: 220, to: 120, gain: 0.35 }); this._noise(this.pink, out, t0 + i * 0.22, 0.08, { type: 'bandpass', freq: 1800, q: 1, gain: 0.3, decay: 0.06 }); }
        break;
      }
      case 'collapse': case 'explosion': {
        const big = e.type === 'explosion';
        const d = this._dist(e.x, e.y, e.z);
        const out = this._out('world', pos, { lowpass: 300 + 8000 * Math.exp(-d / 200), verb: 0.8 });
        const tt = t0 + d / SPEED_OF_SOUND;
        this._noise(this.brown, out, tt, big ? 2.5 : 1.2, { type: 'lowpass', freq: big ? 500 : 900, q: 0.5, gain: big ? 2 : 0.9, decay: big ? 2.2 : 1.0 });
        this._tone(out, tt, 0.6, { freq: 70, to: 30, gain: big ? 1.2 : 0.5 });
        break;
      }
      case 'crash': { const out = this._out('vehicles', pos, { verb: 0.3 }); this._noise(this.pink, out, t0, 0.5, { type: 'lowpass', freq: 1400, q: 0.6, gain: clamp(e.strength || 0.5, 0.2, 1.5), decay: 0.45 }); this._tone(out, t0, 0.3, { freq: 90, to: 40, gain: 0.5 }); break; }
      case 'engineStart': { const out = this._out('vehicles', pos); for (let i = 0; i < 4; i++) this._tone(out, t0 + i * 0.12, 0.1, { type: 'sawtooth', freq: 60 + i * 10, gain: 0.08 }); break; }
      case 'heartbeat': { const out = this._out('ui', null); this._tone(out, t0, 0.12, { freq: 55, to: 40, gain: 0.35 }); this._tone(out, t0 + 0.22, 0.12, { freq: 50, to: 38, gain: 0.25 }); break; }
      case 'thunder': {
        const out = this._out('ambience', null, { lowpass: 600 });
        const delay = e.delay || 0;
        this._noise(this.brown, out, t0 + delay, 4, { type: 'lowpass', freq: 240, q: 0.4, gain: 1.4 * (e.strength || 1), attack: 0.15, decay: 3.8 });
        this._noise(this.brown, out, t0 + delay + 0.4, 2.5, { type: 'lowpass', freq: 160, q: 0.4, gain: 0.8 * (e.strength || 1), attack: 0.3, decay: 2.4 });
        break;
      }
      default: break;
    }
  }

  _click(out, t0, freq, gain) {
    this._noise(this.white, out, t0, 0.03, { type: 'bandpass', freq, q: 4, gain, attack: 0.001, decay: 0.025 });
    this._tone(out, t0, 0.04, { type: 'triangle', freq: freq * 0.5, gain: gain * 0.3, attack: 0.001 });
  }

  footstep(e) {
    if (!this.ready || this.voices > this.maxVoices - 10) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const pos = e.player ? null : { x: e.x, y: e.y, z: e.z };
    if (pos && this._dist(e.x, e.y, e.z) > 45) return;
    const v = clamp(e.volume ?? 0.6, 0.05, 1.5) * (e.player ? 0.6 : 1);
    const out = this._out('ambience', pos, { verb: e.player ? 0.05 : 0.15 });
    const r = 0.9 + Math.random() * 0.2;
    switch (e.surface) {
      case 'grass': this._noise(this.pink, out, t0, 0.14, { type: 'bandpass', freq: 1400 * r, q: 0.6, gain: 0.22 * v, attack: 0.01, decay: 0.12 }); break;
      case 'dirt': case 'sand': this._noise(this.pink, out, t0, 0.12, { type: 'bandpass', freq: 800 * r, q: 0.7, gain: 0.3 * v, attack: 0.006, decay: 0.1 }); break;
      case 'gravel': for (let i = 0; i < 4; i++) this._noise(this.white, out, t0 + i * 0.015, 0.04, { type: 'bandpass', freq: 2500 * r + i * 300, q: 2, gain: 0.12 * v, decay: 0.03 }); break;
      case 'asphalt': case 'concrete': case 'rock':
        this._noise(this.white, out, t0, 0.06, { type: 'bandpass', freq: 1800 * r, q: 1.2, gain: 0.25 * v, attack: 0.002, decay: 0.05 });
        this._tone(out, t0, 0.05, { freq: 110 * r, to: 70, gain: 0.15 * v }); break;
      case 'wood': this._tone(out, t0, 0.09, { type: 'triangle', freq: 170 * r, to: 110, gain: 0.3 * v }); this._noise(this.pink, out, t0, 0.07, { type: 'bandpass', freq: 900, q: 1, gain: 0.15 * v, decay: 0.06 }); break;
      case 'metal': this._tone(out, t0, 0.2, { type: 'triangle', freq: 640 * r, gain: 0.08 * v }); this._tone(out, t0, 0.15, { type: 'sine', freq: 1520 * r, gain: 0.04 * v }); this._noise(this.white, out, t0, 0.04, { type: 'bandpass', freq: 2000, q: 2, gain: 0.15 * v, decay: 0.03 }); break;
      case 'water': this._noise(this.white, out, t0, 0.25, { type: 'bandpass', freq: 1100 * r, q: 0.8, gain: 0.3 * v, attack: 0.02, decay: 0.22, sweep: 600 }); break;
      default: this._noise(this.pink, out, t0, 0.1, { type: 'bandpass', freq: 1000, q: 0.7, gain: 0.2 * v, decay: 0.09 });
    }
  }

  impact(e) {
    if (!this.ready || this.voices > this.maxVoices - 8) return;
    const d = this._dist(e.x, e.y, e.z);
    if (d > 70) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const out = this._out('world', { x: e.x, y: e.y, z: e.z }, { verb: 0.15 });
    const m = e.material;
    if (m === 'metal' || m === 'sheet') { this._tone(out, t0, 0.35, { freq: 1800 + Math.random() * 2000, gain: 0.12 }); this._noise(this.white, out, t0, 0.05, { type: 'highpass', freq: 3000, q: 1, gain: 0.3, decay: 0.04 }); }
    else if (m === 'wood') { this._tone(out, t0, 0.08, { type: 'triangle', freq: 260, to: 140, gain: 0.3 }); this._noise(this.pink, out, t0, 0.08, { type: 'bandpass', freq: 1200, q: 1, gain: 0.3, decay: 0.07 }); }
    else if (m === 'terrain' || m === 'sand') this._noise(this.pink, out, t0, 0.12, { type: 'lowpass', freq: 700, q: 0.7, gain: 0.35, decay: 0.1 });
    else if (m === 'water') this._noise(this.white, out, t0, 0.2, { type: 'bandpass', freq: 1500, q: 0.8, gain: 0.25, decay: 0.18, sweep: 700 });
    else if (m === 'glass') this.play({ type: 'glass', x: e.x, y: e.y, z: e.z });
    else this._noise(this.white, out, t0, 0.07, { type: 'bandpass', freq: 2200, q: 0.9, gain: 0.35, decay: 0.06 });
  }

  /** Bullet passing close to the listener: supersonic crack + whiz. */
  whiz(e) {
    if (!this.ready) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const out = this._out('weapons', { x: e.x, y: e.y, z: e.z });
    if ((e.weapon?.velocity || 0) > 340) this._noise(this.white, out, t0, 0.04, { type: 'highpass', freq: 3000, q: 0.7, gain: 0.8, decay: 0.03 });
    this._noise(this.white, out, t0, 0.18, { type: 'bandpass', freq: 3200, q: 3, gain: 0.25, sweep: 900, decay: 0.16 });
  }

  // ------------------------------------------------------------ continuous loops
  _startAmbience() {
    const c = this.ctx;
    const mk = (buf, type, freq, q) => {
      const s = c.createBufferSource();
      s.buffer = buf; s.loop = true;
      const f = c.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      s.connect(f).connect(g).connect(this.buses.ambience);
      s.start();
      return { src: s, filter: f, gain: g };
    };
    this.ambience = {
      wind: mk(this.brown, 'lowpass', 500, 0.7),
      windHigh: mk(this.pink, 'bandpass', 1800, 0.4),
      rain: mk(this.pink, 'highpass', 900, 0.5),
      rainLow: mk(this.brown, 'lowpass', 300, 0.5),
    };
    this.birdT = 2;
    this.cricketT = 1;
    // vehicle engine loop
    const o1 = c.createOscillator(), o2 = c.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'square';
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 400;
    const g = c.createGain(); g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g).connect(this.buses.vehicles);
    o1.start(); o2.start();
    this.engine = { o1, o2, f, g };
    this.heartT = 0;
  }

  /**
   * Per-frame ambience: env {wind 0..1, rain 0..1, night 0..1, forest 0..1, indoor bool, engine {rpm, on}|null, lowHealth}
   */
  update(dt, env) {
    if (!this.ready || !this.ambience) return;
    const c = this.ctx;
    const t = c.currentTime;
    const A = this.ambience;
    const indoorMul = env.indoor ? 0.35 : 1;
    const gust = 0.75 + Math.sin(t * 0.21) * 0.15 + Math.sin(t * 0.63 + 1.3) * 0.1;
    A.wind.gain.gain.setTargetAtTime((0.08 + env.wind * 0.35) * gust * indoorMul, t, 0.5);
    A.wind.filter.frequency.setTargetAtTime(300 + env.wind * 500 * gust, t, 0.5);
    A.windHigh.gain.gain.setTargetAtTime(env.wind * 0.05 * gust * indoorMul * (env.forest * 0.7 + 0.3), t, 0.6);
    A.rain.gain.gain.setTargetAtTime(env.rain * 0.22 * (env.indoor ? 0.5 : 1), t, 0.8);
    A.rain.filter.frequency.setTargetAtTime(env.indoor ? 500 : 1200, t, 0.5);
    A.rainLow.gain.gain.setTargetAtTime(env.rain * 0.18 * (env.indoor ? 1.2 : 0.6), t, 0.8);
    // birds by day in vegetation, crickets at night
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = 1.5 + Math.random() * 5;
      if (env.night < 0.4 && env.rain < 0.3 && Math.random() < 0.35 + env.forest * 0.6) this._bird();
    }
    this.cricketT -= dt;
    if (this.cricketT <= 0) {
      this.cricketT = 0.4 + Math.random() * 0.8;
      if (env.night > 0.6 && env.rain < 0.2 && !env.indoor) this._cricket();
    }
    // engine
    const E = this.engine;
    if (env.engine && env.engine.on) {
      const rpm = env.engine.rpm;
      E.o1.frequency.setTargetAtTime(32 + rpm * 70, t, 0.08);
      E.o2.frequency.setTargetAtTime(16 + rpm * 35, t, 0.08);
      E.f.frequency.setTargetAtTime(220 + rpm * 900, t, 0.1);
      E.g.gain.setTargetAtTime(0.05 + rpm * 0.05, t, 0.1);
    } else E.g.gain.setTargetAtTime(0, t, 0.2);
    // heartbeat at low health
    if (env.lowHealth > 0) {
      this.heartT -= dt;
      if (this.heartT <= 0) { this.heartT = 1.2 - env.lowHealth * 0.5; this.play({ type: 'heartbeat', ui: true }); }
    }
  }

  _bird() {
    const c = this.ctx;
    const L = this.listener;
    const a = Math.random() * Math.PI * 2, r = 15 + Math.random() * 40;
    const out = this._out('ambience', { x: L.x + Math.cos(a) * r, y: L.y + 6 + Math.random() * 8, z: L.z + Math.sin(a) * r });
    const t0 = c.currentTime;
    const base = 2200 + Math.random() * 2600;
    const n = 2 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      const st = t0 + i * (0.09 + Math.random() * 0.08);
      this._tone(out, st, 0.07 + Math.random() * 0.05, { freq: base * (0.9 + Math.random() * 0.25), to: base * (1.1 + Math.random() * 0.4), gain: 0.03 });
    }
  }

  _cricket() {
    const c = this.ctx;
    const L = this.listener;
    const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 20;
    const out = this._out('ambience', { x: L.x + Math.cos(a) * r, y: L.y - 1, z: L.z + Math.sin(a) * r });
    const t0 = c.currentTime;
    for (let i = 0; i < 3; i++) this._tone(out, t0 + i * 0.05, 0.03, { freq: 4300 + Math.random() * 200, gain: 0.012 });
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
}

export const audio = new AudioManager();
