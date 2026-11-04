// Combat doctrines: how a faction fights, independent of individual skill.
//
//  disciplined — soldiers and mercenaries. Fireteam movement (one element suppresses while
//                another moves), cover-to-cover, short controlled bursts, reload in cover,
//                systematic searches, hold a leash around what they defend, fall back and
//                regroup in order when the squad is losing.
//  aggressive  — raiders. Push to close range, flank alone, long bursts, chase far, loot the
//                dead, only break when badly hurt or the gang is broken, then scatter.
//  cautious    — survivors and scavengers. Avoid fights they did not start, move away from
//                distant gunfire, engage only at short range or when cornered, break contact
//                early and hide, then go back to scavenging.

export const DOCTRINES = {
  disciplined: {
    id: 'disciplined',
    engageRange: 1.0,        // multiplier on weapon-based engagement range
    rangeBias: 1.0,          // preferred distance multiplier
    coverUse: 1.0,           // how strongly cover is preferred over open ground
    peekTime: [1.0, 2.2],    // seconds exposed per peek
    hideTime: [0.7, 1.6],    // seconds behind cover between peeks
    burst: [2, 4],           // rounds per burst (automatics)
    suppress: 0.85,          // willingness to suppress hidden enemies
    flank: 0.55,             // willingness to flank (needs a suppressor on the squad)
    flankSolo: false,        // may flank without covering fire
    advance: 0.25,           // tendency to push forward when winning
    chase: 70,               // how far past the last known position they follow
    leash: 1.6,              // multiple of the home radius defenders stay within
    investigate: 'bound',    // fireteam bounding overwatch toward noises
    distantGunfire: 'investigate',
    searchTime: 55,
    searchDelay: 9,         // seconds without contact before the squad starts searching
    retreatHealth: 0.3,      // individual fall-back threshold (fraction of max health)
    breakStrength: 0.34,     // squad falls back below this fraction of starting strength
    rallyAfterRetreat: true,
    reloadAt: 0.35,          // tactical reload threshold when not engaged
    shootOnMove: 0.35,       // chance to fire while walking between covers
    lootDead: 0.25,
    callouts: true,
    flashlightInCombat: false,
  },
  aggressive: {
    id: 'aggressive',
    engageRange: 0.85,
    rangeBias: 0.6,
    coverUse: 0.45,
    peekTime: [1.6, 3.0],
    hideTime: [0.4, 1.0],
    burst: [3, 7],
    suppress: 0.45,
    flank: 0.75,
    flankSolo: true,
    advance: 0.7,
    chase: 160,
    leash: 2.4,
    investigate: 'rush',
    distantGunfire: 'investigate',
    searchTime: 70,
    searchDelay: 5,
    retreatHealth: 0.22,
    breakStrength: 0.26,
    rallyAfterRetreat: false,
    reloadAt: 0.25,
    shootOnMove: 0.7,
    lootDead: 0.9,
    callouts: true,
    flashlightInCombat: true,
  },
  cautious: {
    id: 'cautious',
    engageRange: 0.7,
    rangeBias: 1.25,
    coverUse: 0.9,
    peekTime: [0.8, 1.5],
    hideTime: [1.2, 2.6],
    burst: [1, 3],
    suppress: 0.25,
    flank: 0.1,
    flankSolo: false,
    advance: 0.05,
    chase: 15,
    leash: 1.2,
    investigate: 'careful',
    distantGunfire: 'avoid',
    searchTime: 20,
    searchDelay: 7,
    retreatHealth: 0.6,
    breakStrength: 0.75,
    rallyAfterRetreat: false,
    reloadAt: 0.5,
    shootOnMove: 0.1,
    lootDead: 0.6,
    callouts: false,
    flashlightInCombat: false,
  },
};

const FACTION_DOCTRINE = { vsf: 'disciplined', free: 'disciplined', guard: 'disciplined', wolves: 'aggressive', indep: 'cautious' };

export function doctrineFor(faction, profile = null) {
  const id = profile?.doctrine || FACTION_DOCTRINE[faction] || 'disciplined';
  return DOCTRINES[id];
}
