// Wire format shared by the online server (server/) and the browser client (src/net/).
// Messages are JSON objects with a type field `t`. Positions are rounded to centimetres.

export const PROTOCOL_VERSION = 1;
export const SNAPSHOT_HZ = 12;
export const CLIENT_STATE_HZ = 15;
export const INTEREST_RADIUS = 650; // metres: people further away are not sent
export const SHOT_RADIUS = 1100; // metres: gunfire further away is not sent

export const r2 = (v) => Math.round(v * 100) / 100;
export const r3 = (v) => Math.round(v * 1000) / 1000;

/** Agent snapshot entry. */
export function packAgent(a) {
  const s = a.anim || {};
  return [a.id, r2(a.pos.x), r2(a.pos.y), r2(a.pos.z), r3(a.yaw), r2(s.speed || 0), s.crouch ? 1 : 0, r2(s.aiming || 0), r3(s.aimPitch || 0), s.reloading ? 1 : 0, a.lightOn ? 1 : 0, a.weapon?.id || null];
}

export function unpackAgent(e) {
  return { id: e[0], x: e[1], y: e[2], z: e[3], yaw: e[4], speed: e[5], crouch: e[6], aiming: e[7], aimPitch: e[8], reloading: !!e[9], light: !!e[10], w: e[11] };
}

/** Remote player snapshot entry. */
export function packPlayer(p) {
  return [p.id, r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r3(p.yaw), r3(p.pitch), p.stance, r2(Math.hypot(p.vel.x, p.vel.z)), p.alive ? 1 : 0, p.lightOn ? 1 : 0, p.weaponId, p.inVehicle ? 1 : 0];
}

export function unpackPlayer(e) {
  return { id: e[0], x: e[1], y: e[2], z: e[3], yaw: e[4], pitch: e[5], stance: e[6], speed: e[7], alive: !!e[8], light: !!e[9], w: e[10], veh: !!e[11] };
}
