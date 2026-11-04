import { clamp, smoothstep } from '../core/MathUtil.js';

// Unified damage maths shared by the player and every AI combatant.

export const ZONE_MULT = { head: 3.0, torso: 1.0, arm: 0.6, leg: 0.7 };

/** Distance falloff multiplier for a weapon definition. */
export function falloff(weapon, distance) {
  if (!weapon.falloffStart) return 1;
  const t = smoothstep(weapon.falloffStart, weapon.falloffEnd, distance);
  return 1 - t * (1 - weapon.minDamage);
}

/**
 * Compute final damage.
 * base: weapon damage per projectile; zone: head|torso|arm|leg; armor: 0..1 reduction
 * penetrationLoss: 0..1 fraction of energy lost passing through cover.
 */
export function computeDamage({ base, weapon, distance = 0, zone = 'torso', armor = 0, penetrationLoss = 0, mul = 1 }) {
  let d = base * (weapon ? falloff(weapon, distance) : 1);
  d *= ZONE_MULT[zone] ?? 1;
  // armour is less effective against high-power rifle rounds
  const power = weapon?.penetration ?? 1;
  const effArmor = clamp(armor * (1.15 - power * 0.25), 0, 0.85);
  d *= 1 - effArmor;
  d *= 1 - clamp(penetrationLoss, 0, 1);
  d *= mul;
  return Math.max(0, d);
}

/** Probability that a hit causes bleeding. */
export function bleedChance(zone, damage, armor) {
  if (zone === 'head') return 0.25;
  const base = zone === 'torso' ? 0.4 : 0.3;
  return clamp(base * (damage / 30) * (1 - armor * 0.8), 0, 0.85);
}

/** Classify a hit point on a standing humanoid by height above its feet. */
export function zoneFromHeight(h, height = 1.8, lateral = 0) {
  const r = h / height;
  if (r > 0.86) return 'head';
  if (r < 0.48) return 'leg';
  if (Math.abs(lateral) > 0.21) return 'arm';
  return 'torso';
}
