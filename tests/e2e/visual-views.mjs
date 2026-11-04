// Fixed reference views for tests/e2e/visual.mjs. Coordinates are world metres.
// h/th: camera/target height above ground (ignored when y/ty given). poi: wait for that POI to build.
export const VIEWS = {
  // Millbrook: street level along the highway, looking north through the village
  'v01-street': { x: 322, z: 1196, tx: 318, tz: 1080, h: 1.7, th: 2.5, poi: 'millbrook', time: 9.5 },
  // close-up of a two-storey house facing the road
  'v02-house': { x: 318.5, z: 1131, tx: 333, tz: 1141, h: 1.7, th: 3.2, poi: 'millbrook', time: 15 },
  // inside a single-storey house
  'v03-interior': { x: 307.2, z: 1058.4, tx: 302, tz: 1054.5, h: 1.95, th: 1.2, poi: 'millbrook', time: 11 },
  // elevated overview of the village
  'v04-village-aerial': { x: 395, z: 1210, tx: 322, tz: 1090, h: 28, th: 0, poi: 'millbrook', time: 16.5 },
  // open valley from a rise
  'v05-valley': { x: 700, z: 900, tx: 300, tz: 600, h: 1.7, th: 30, time: 10 },
  // forest interior near the cabins
  'v06-forest': { x: -840, z: 160, tx: -900, tz: 100, h: 1.7, th: 3, poi: 'cabins', time: 13 },
  // river bank
  'v07-river': { x: -200, z: 260, tx: -300, tz: 600, h: 1.7, th: 2, time: 17.5 },
  // Northwatch gate approach
  'v08-northwatch-gate': { x: 292, z: -1872, tx: 300, tz: -1960, h: 1.8, th: 3, poi: 'northwatch_base', time: 11 },
  // Northwatch overview
  'v09-northwatch-aerial': { x: 470, z: -1840, tx: 300, tz: -2060, h: 45, th: 0, poi: 'northwatch_base', time: 14 },
  // communications tower landmark
  'v10-commtower': { x: -392, z: -888, tx: -420, tz: -930, h: 1.7, th: 20, poi: 'comm_tower', time: 17.3 },
  // farmstead
  'v11-farmstead': { x: 1250, z: 470, tx: 1305, tz: 375, h: 1.7, th: 4, poi: 'farmstead', time: 8.2 },
  // street at dusk and at night
  'v12-dusk': { x: 322, z: 1196, tx: 318, tz: 1080, h: 1.7, th: 2.5, poi: 'millbrook', time: 19.6 },
  'v13-night': { x: 322, z: 1196, tx: 318, tz: 1080, h: 1.7, th: 2.5, poi: 'millbrook', time: 23 },
  'v14-rain': { x: 318.5, z: 1131, tx: 333, tz: 1141, h: 1.7, th: 3.2, poi: 'millbrook', time: 13, weather: 'rain' },
  // weapon viewmodel at the hip and aimed
  'v15-weapon-hip': {
    x: 1250, z: 470, tx: 1305, tz: 375, h: 1.66, th: 1.6, poi: 'farmstead', time: 10, vm: true,
    before: `(async () => { const IV = window.__IV; IV.equip('wpn_arv7'); IV.game.weapons.adsT = 0; await IV.frames(30); })()`,
  },
  'v16-weapon-pistol': {
    x: 1250, z: 470, tx: 1305, tz: 375, h: 1.66, th: 1.6, poi: 'farmstead', time: 10, vm: true,
    before: `(async () => { const IV = window.__IV; IV.equip('wpn_vk9'); await IV.frames(30); })()`,
  },
  // soldiers close up
  'v17-npcs': {
    x: 1240, z: 470, tx: 1252, tz: 455, h: 1.7, th: 1.2, time: 12,
    before: `(async () => { const IV = window.__IV; const g = IV.game; g.ai.spawnSquad(['vsf_rifleman'], 1249, 458, {}); g.ai.spawnSquad(['wolf_raider'], 1254, 462, {}); g.ai.spawnSquad(['indep_scav'], 1246, 455, {}); await IV.frames(4); for (const a of g.ai.agents) { a.yaw = Math.atan2(a.pos.x - 1240, a.pos.z - 470) + 0.4; a.update = function () { this._animate && this._animate(0.016); }; } await IV.frames(6); })()`,
  },
  // landmarks added in the visual upgrade
  'v18-church': { x: 331, z: 1089, tx: 356, tz: 1103, h: 1.7, th: 9, poi: 'millbrook', time: 10.5 },
  'v19-yards': { x: 286, z: 1080, tx: 300, tz: 1060, h: 2.2, th: 1.0, poi: 'millbrook', time: 14 },
  // paving overlap at Northwatch (spine road across the parade ground) and a grazing look at a ground floor
  'v21-paving': { x: 304, z: -1978, tx: 296, tz: -2070, h: 1.7, th: 0.2, poi: 'northwatch_base', time: 11 },
  'v20-hangar': { x: 245, z: -2085, tx: 205, tz: -2120, h: 1.7, th: 6, poi: 'northwatch_base', time: 9.5 },
};
