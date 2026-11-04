// Stand-ins for people the online server simulates: AI combatants and other players.
// Each one is drawn with the normal character model, moves by interpolating server
// snapshots, and is registered with the local Characters list so the player's own shots
// hit it (the server decides the actual damage).
import * as THREE from 'three';
import { CharacterModel } from '../ai/CharacterModel.js';
import { bus } from '../core/EventBus.js';
import { angleWrap, clamp } from '../core/MathUtil.js';

export const INTERP_DELAY = 0.13; // seconds behind the newest snapshot

const lerp = (a, b, t) => a + (b - a) * t;

class Remote {
  constructor(net, id) {
    this.net = net;
    this.game = net.game;
    this.id = id;
    this.colliderOwner = id;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.stance = 'stand';
    this.alive = true;
    this.lightOn = false;
    this.samples = [];
    this.anim = { speed: 0, crouch: 0, aiming: 0, aimPitch: 0, reloading: false };
    this.weaponId = null;
    this.model = null;
    this._stepPhase = 0;
  }

  push(T, s) {
    const S = this.samples;
    if (S.length && T <= S[S.length - 1].T) return;
    S.push({ T, ...s });
    if (S.length > 12) S.shift();
  }

  /** Interpolated state at server time T. */
  sample(T) {
    const S = this.samples;
    if (!S.length) return null;
    if (T <= S[0].T) return S[0];
    for (let i = S.length - 1; i > 0; i--) {
      const a = S[i - 1], b = S[i];
      if (T >= a.T && T <= b.T) {
        const k = (T - a.T) / Math.max(1e-3, b.T - a.T);
        return { ...b, x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k), yaw: a.yaw + angleWrap(b.yaw - a.yaw) * k, aimPitch: lerp(a.aimPitch || a.pitch || 0, b.aimPitch || b.pitch || 0, k), aiming: lerp(a.aiming || 0, b.aiming || 0, k), _k: k };
      }
    }
    // newer than the newest sample: extrapolate briefly from the last two, then hold
    const b = S[S.length - 1], a = S[S.length - 2] || b;
    const over = clamp(T - b.T, 0, 0.25);
    const span = Math.max(1e-3, b.T - a.T);
    return { ...b, x: b.x + ((b.x - a.x) / span) * over, z: b.z + ((b.z - a.z) / span) * over };
  }

  apply(dt, T) {
    const s = this.sample(T);
    if (!s || !this.model) return;
    const px = this.pos.x, pz = this.pos.z;
    this.pos.set(s.x, s.y, s.z);
    if (dt > 0) this.vel.set((s.x - px) / dt, 0, (s.z - pz) / dt);
    this.yaw = s.yaw;
    this.lightOn = !!s.light;
    this.stance = s.crouch || s.stance === 'crouch' ? 'crouch' : s.stance === 'prone' ? 'prone' : 'stand';
    if (s.w !== undefined && s.w !== this.weaponId) { this.weaponId = s.w; if (s.w) this.model.setWeapon(s.w, null); }
    const m = this.model;
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw;
    const dist = Math.hypot(this.pos.x - this.game.player.controller.pos.x, this.pos.z - this.game.player.controller.pos.z);
    m.root.visible = dist < 900;
    if (dist < 420 || this.net.frame % 3 === 0) {
      m.animate(dist < 420 ? dt : dt * 3, { speed: s.speed || 0, crouch: this.stance === 'crouch' ? 1 : 0, aiming: s.aiming ?? 0, aimPitch: s.aimPitch ?? s.pitch ?? 0, reloading: !!s.reloading });
    }
    m.mesh.castShadow = dist < 120;
    // footsteps
    if (dist < 60 && (s.speed || 0) > 0.6) {
      const step = Math.floor(m.phase / Math.PI);
      if (step !== this._stepPhase) {
        this._stepPhase = step;
        bus.emit('footstep', { x: this.pos.x, y: this.pos.y, z: this.pos.z, surface: this.game.world.surfaceAt?.(this.pos.x, this.pos.z), volume: s.speed > 3 ? 1.1 : this.stance === 'crouch' ? 0.35 : 0.7, npc: this, remote: true });
      }
    }
  }

  get firedRecently() { return false; }
  onSuppressed() {}

  dispose() {
    if (this.model) this.game.renderer.scene.remove(this.model.root);
    if (this.cone) this.cone.parent?.remove(this.cone);
    this.game.characters.remove(this);
  }
}

/** An AI combatant simulated by the server. */
export class RemoteAgent extends Remote {
  constructor(net, info) {
    super(net, info.id);
    this.isAI = true;
    this.remote = true;
    this.faction = info.f;
    this.look = info.look || {};
    this.model = new CharacterModel(this.look, this.game.materials);
    this.weaponId = info.w;
    if (info.w) this.model.setWeapon(info.w, info.at || null);
    this.pos.set(info.x, info.y, info.z);
    this.yaw = info.yaw || 0;
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
    this.game.renderer.scene.add(this.model.root);
    this.corpse = null;
    if (info.dead) {
      this.alive = false;
      this.model.die(info.dir ?? 1, info.side ?? 0);
      for (let i = 0; i < 60; i++) this.model.animate(1 / 30, {});
      this._corpse();
    } else this.game.characters.add(this);
  }

  /** The local player hit this person. Gunshots are re-simulated by the server; melee is sent. */
  onHit(info) {
    if (info.cause === 'melee' && info.shooter === this.game.player.character) {
      this.net.send({ t: 'melee', id: this.id, zone: info.zone, w: this.game.weapons?.w?.id || null, dir: info.dir ? [info.dir.x, info.dir.y, info.dir.z] : null });
    }
    this.model.flinch = 1;
  }

  die(dir, side) {
    if (!this.alive) return;
    this.alive = false;
    this.model.die(dir, side);
    this.game.characters.remove(this);
    if (this.cone) this.cone.visible = false;
    this._corpse();
  }

  _corpse() {
    const F = this.game.factions.get(this.faction);
    this.corpse = this.game.interactables.add({
      id: `net:${this.id}`, kind: 'container', x: this.pos.x, y: this.pos.y + 0.4, z: this.pos.z, radius: 1.6,
      label: `Search body (${F?.short || 'Unknown'})`, data: { containerId: `net:${this.id}`, name: 'Body', custom: true, net: this.id },
    });
  }

  apply(dt, T) {
    if (!this.alive) { this.model.animate(dt, {}); return; }
    super.apply(dt, T);
    // flashlight cone (visual only)
    if (this.lightOn && this.model.root.visible && !this.game.headless) {
      if (!this.cone) this.cone = this.game.ai.makeLightCone();
      this.cone.visible = true;
      this.cone.position.set(this.pos.x, this.pos.y + (this.stance === 'crouch' ? 1.0 : 1.35), this.pos.z);
      this.cone.rotation.set(0, this.yaw, 0);
    } else if (this.cone) this.cone.visible = false;
  }

  dispose() {
    super.dispose();
    if (this.corpse) { this.game.interactables.remove(this.corpse); this.game.loot.remove(`net:${this.id}`); }
  }
}

const PLAYER_COLORS = ['#3f4a3a', '#4a3f36', '#36414a', '#4a4a3a', '#3a3a46', '#4b3b3b'];

function nameTag(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 48;
  const x = c.getContext('2d');
  x.font = '600 26px system-ui, -apple-system, "Segoe UI", sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.lineWidth = 5;
  x.strokeStyle = 'rgba(0,0,0,0.75)';
  x.strokeText(text, 128, 24);
  x.fillStyle = '#e8f0d8';
  x.fillText(text, 128, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, sizeAttenuation: true }));
  s.scale.set(1.6, 0.3, 1);
  s.position.y = 2.15;
  s.renderOrder = 10;
  return s;
}

/** Another player, moving as their browser reports. */
export class RemotePlayer extends Remote {
  constructor(net, info) {
    super(net, info.id);
    this.isPlayer = true;
    this.remote = true;
    this.faction = 'player';
    this.name = info.name;
    let hsh = 0;
    for (const ch of info.id + info.name) hsh = (hsh * 31 + ch.charCodeAt(0)) | 0;
    const look = { uniform: PLAYER_COLORS[Math.abs(hsh) % PLAYER_COLORS.length], accent: '#2a2622', skin: ['#c9a080', '#a87c5c', '#d8b49a', '#8a6040'][Math.abs(hsh >> 3) % 4], pack: true, gloves: '#2a2622' };
    this.look = look;
    this.model = new CharacterModel(look, this.game.materials);
    this.tag = nameTag(info.name);
    this.model.root.add(this.tag);
    this.game.renderer.scene.add(this.model.root);
    this.game.characters.add(this);
  }

  onHit() { this.model.flinch = 1; }

  apply(dt, T) {
    const s = this.sample(T);
    if (s) {
      if (s.alive !== this.alive) {
        this.alive = s.alive;
        if (!s.alive) { this.model.die(1, 0); this.game.characters.remove(this); } else {
          this.game.renderer.scene.remove(this.model.root);
          const tag = this.tag;
          this.model = new CharacterModel(this.look, this.game.materials);
          this.model.root.add(tag);
          this.weaponId = null;
          this.game.renderer.scene.add(this.model.root);
          this.game.characters.add(this);
        }
      }
    }
    if (!this.alive) { this.model.animate(dt, {}); return; }
    super.apply(dt, T);
  }
}
