import { bus } from './EventBus.js';

const STORAGE_KEY = 'ironveil.settings.v1';

export const QUALITY_PRESETS = {
  // integrated graphics (Chromebooks, older laptops): simplest materials, smallest textures, no
  // anti-aliasing, no shadows, short view distance. Texture size and "lite" apply after a reload.
  chromebook: { renderScale: 0.6, shadows: 0, viewDistance: 600, vegetation: 0.35, effects: 0, ao: false, post: false, textures: 128, grass: false, lite: true },
  low: { renderScale: 0.75, shadows: 1, viewDistance: 900, vegetation: 0.55, effects: 0, ao: false, post: false, textures: 256, grass: false, lite: false },
  medium: { renderScale: 1.0, shadows: 2, viewDistance: 1400, vegetation: 0.85, effects: 1, ao: false, post: true, textures: 512, grass: true, lite: false },
  high: { renderScale: 1.0, shadows: 3, viewDistance: 2000, vegetation: 1.0, effects: 2, ao: true, post: true, textures: 1024, grass: true, lite: false },
};

export const DEFAULT_SETTINGS = {
  preset: 'medium',
  ...QUALITY_PRESETS.medium,
  // controls
  sensitivity: 1.0,
  adsSensitivity: 0.75,
  invertY: false,
  fov: 75,
  headBob: true,
  cameraShake: true,
  // audio (0..1)
  volMaster: 0.8,
  volWeapons: 0.9,
  volAmbience: 0.6,
  volVehicles: 0.8,
  volUI: 0.6,
  // gameplay
  lootRespawnMinutes: 45,
  eventFrequency: 1.0,
  survivalRate: 1.0,
  aiDifficulty: 1.0,
  showFPS: false,
  hudScale: 1.0,
  // vehicles
  vehicleAvailability: 'normal', // normal | rare | none
  vehicleDamage: 1.0,
  glassDurability: 1.0,
  vehicleRepair: 'normal', // normal | strict
  // base raids
  raidsEnabled: true,
  raidMinDays: 3,
  raidMaxDays: 6,
  raidWarningMinutes: 180, // in-game minutes between the warning and the attack (1 game day = 60 real minutes)
  raidSize: 1.0,
  raidDifficulty: 1.0,
  raidSpecialChance: 0.06,
  raidBreaching: 'explosives', // none | tools | explosives
  // loot
  bunkerResetHours: 48,
  airfieldResetHours: 24,
  majorResetHours: 24,
  lootResetNotify: true,
  rareLootChance: 1.0,
  // helicopters
  heliCrashChance: 0.12, // chance per in-game day
  airfieldHeliChance: 0.08, // chance per in-game day that a wreck-in-waiting appears at Kessler
  heliRepair: 'normal', // normal | strict
  heliFuelUse: 1.0,
  // stamina
  staminaDrain: 1.0,
  staminaRegen: 1.0,
  staminaWeight: 1.0,
  staminaBonuses: true,
  // sentry guns
  turretCost: 'high', // normal | high | extreme
  turretParts: 'restricted', // restricted (bunker + airfield only) | military (any military site)
  turretDamage: 1.0,
  turretAmmoUse: 1.0,
};

/** Allowed values for string settings (anything else falls back to the default). */
const ENUMS = {
  preset: ['chromebook', 'low', 'medium', 'high', 'custom'],
  vehicleAvailability: ['normal', 'rare', 'none'], vehicleRepair: ['normal', 'strict'], raidBreaching: ['none', 'tools', 'explosives'],
  heliRepair: ['normal', 'strict'], turretCost: ['normal', 'high', 'extreme'], turretParts: ['restricted', 'military'],
};

const LIMITS = {
  renderScale: [0.5, 1.5], shadows: [0, 3], viewDistance: [600, 2600], vegetation: [0.3, 1.5], effects: [0, 2],
  textures: [128, 1024], sensitivity: [0.1, 4], adsSensitivity: [0.2, 1.5], fov: [60, 100],
  volMaster: [0, 1], volWeapons: [0, 1], volAmbience: [0, 1], volVehicles: [0, 1], volUI: [0, 1],
  lootRespawnMinutes: [0, 240], eventFrequency: [0, 2], survivalRate: [0.25, 2], aiDifficulty: [0.5, 1.5], hudScale: [0.75, 1.4],
  vehicleDamage: [0.25, 3], glassDurability: [0.25, 4], raidMinDays: [1, 30], raidMaxDays: [1, 30], raidWarningMinutes: [30, 720],
  raidSize: [0.5, 2], raidDifficulty: [0.5, 2], raidSpecialChance: [0, 0.5], bunkerResetHours: [2, 240], airfieldResetHours: [2, 240],
  majorResetHours: [2, 240], rareLootChance: [0, 3], heliCrashChance: [0, 1], airfieldHeliChance: [0, 1], heliFuelUse: [0.25, 3],
  staminaDrain: [0.25, 2], staminaRegen: [0.25, 3], staminaWeight: [0, 2], turretDamage: [0.25, 2], turretAmmoUse: [0.5, 3],
};
const INTEGER = new Set(['raidMinDays', 'raidMaxDays', 'raidWarningMinutes', 'bunkerResetHours', 'airfieldResetHours', 'majorResetHours']);

export class SettingsManager {
  constructor() {
    this.values = { ...DEFAULT_SETTINGS };
    this.load();
  }

  load() {
    if (typeof localStorage === 'undefined') return; // server / tests: defaults
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // first launch on a Chromebook: start on the Chromebook preset (can be changed in Settings)
      if (!raw && typeof navigator !== 'undefined' && /\bCrOS\b/.test(navigator.userAgent || '')) {
        this.values = { ...this.values, preset: 'chromebook', ...QUALITY_PRESETS.chromebook };
      }
      if (raw) {
        let parsed = JSON.parse(raw);
        if (parsed && QUALITY_PRESETS[parsed.preset]) parsed = { ...QUALITY_PRESETS[parsed.preset], ...parsed };
        this.apply(parsed, false);
      }
    } catch (e) {
      console.warn('[Settings] could not load settings, using defaults', e);
    }
  }

  save() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch (e) {
      console.warn('[Settings] could not persist settings', e);
    }
  }

  /** Validate and merge settings. Unknown keys are ignored; numbers are clamped. */
  apply(patch, persist = true) {
    if (!patch || typeof patch !== 'object') return;
    const changed = {};
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in DEFAULT_SETTINGS)) continue;
      const def = DEFAULT_SETTINGS[k];
      let val = v;
      if (typeof def === 'number') {
        val = Number(v);
        if (!Number.isFinite(val)) continue;
        if (LIMITS[k]) val = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], val));
        if (INTEGER.has(k)) val = Math.round(val);
      } else if (typeof def === 'boolean') {
        val = !!v;
      } else if (typeof def === 'string') {
        val = String(v);
        if (ENUMS[k] && !ENUMS[k].includes(val)) continue;
      }
      if (this.values[k] !== val) {
        this.values[k] = val;
        changed[k] = val;
      }
    }
    // impossible combinations: the raid window must not be inverted
    if (this.values.raidMaxDays < this.values.raidMinDays) {
      if ('raidMinDays' in changed && !('raidMaxDays' in changed)) this.values.raidMaxDays = changed.raidMaxDays = this.values.raidMinDays;
      else this.values.raidMinDays = changed.raidMinDays = this.values.raidMaxDays;
    }
    if (Object.keys(changed).length) {
      if (persist) this.save();
      bus.emit('settings:changed', changed);
    }
  }

  applyPreset(name) {
    const p = QUALITY_PRESETS[name];
    if (!p) return;
    this.apply({ preset: name, ...p });
  }

  get(k) {
    return this.values[k];
  }
}

export const settings = new SettingsManager();

/** Values that only take effect when the page loads (texture size, Chromebook mode). */
export const BOOT = { textures: settings.get('textures'), lite: settings.get('lite') };
