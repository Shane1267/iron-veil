import { ItemDB } from '../items/ItemDatabase.js';

// Resolves a weapon item stack (with attachments) into effective gameplay stats.

export function attachmentFits(weaponId, attachId) {
  const w = ItemDB.weapon(weaponId);
  const a = ItemDB.get(attachId)?.attach;
  if (!w || !a) return false;
  return (w.attach?.[a.slot] || []).includes(attachId);
}

export function effectiveWeapon(stack) {
  const base = ItemDB.weapon(stack.id);
  if (!base) return null;
  const e = { ...base, recoil: { ...(base.recoil || {}) } };
  e.noiseMul = 1;
  e.flash = true;
  e.light = false;
  e.recoilMul = 1;
  e.swayMul = 1;
  e.reloadMul = 1;
  e.damageMul = 1;
  e.adsTimeMul = 1;
  const attach = stack.data?.attach || {};
  for (const [slot, id] of Object.entries(attach)) {
    if (!id) continue;
    const a = ItemDB.get(id)?.attach;
    if (!a || a.slot !== slot || !(base.attach?.[slot] || []).includes(id)) continue;
    if (a.sight) {
      e.sight = a.sight;
      e.scopeZoom = a.scopeZoom || 1;
      e.adsFov = a.adsFov;
    }
    if (a.noiseMul) e.noiseMul *= a.noiseMul;
    if (a.flash === false) e.flash = false;
    if (a.recoilMul) e.recoilMul *= a.recoilMul;
    if (a.swayMul) e.swayMul *= a.swayMul;
    if (a.magSize) e.magSize = a.magSize;
    if (a.reloadMul) e.reloadMul *= a.reloadMul;
    if (a.damageMul) e.damageMul *= a.damageMul;
    if (a.adsTimeMul) e.adsTimeMul *= a.adsTimeMul;
    if (a.light) e.light = true;
  }
  // without an optic, weapons whose default sight is a scope fall back to iron sights
  if (!attach.optic && base.sight === 'scope') {
    e.sight = 'iron';
    e.adsFov = 0.8;
    e.scopeZoom = 1;
  }
  e.recoil.v *= e.recoilMul;
  e.recoil.h *= e.recoilMul;
  e.adsTime = (base.adsTime || 0.25) * e.adsTimeMul;
  e.reloadTime = (base.reloadTime || 2) * e.reloadMul;
  e.noise = (base.noise || 300) * e.noiseMul;
  // condition affects accuracy
  const cond = stack.data?.cond ?? 1;
  e.condSpread = 1 + Math.max(0, 0.6 - cond) * 1.5;
  return e;
}

export function fireInterval(w) {
  return 60 / (w.rpm || 600);
}
