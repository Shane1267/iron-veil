// Runs firefight scenarios headlessly and prints a report.
// Usage: npx vite-node tests/sim/run.mjs [--scenarios=a,b] [--seeds=3] [--json=out.json] [--trail]
import fs from 'node:fs';
import { SCENARIOS } from './scenarios.js';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).split('=').slice(1).join('=');
const names = arg('scenarios', Object.keys(SCENARIOS).join(',')).split(',').filter(Boolean);
const seeds = Number(arg('seeds', 3));
const jsonOut = arg('json', '');
const out = {};

for (const name of names) {
  out[name] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const t0 = Date.now();
    const { sim, extra } = SCENARIOS[name](seed);
    const s = sim.metrics.summary();
    const e = extra();
    const row = { seed, ms: Date.now() - t0, ...s, ...e };
    if (process.argv.includes('--trail')) row.trails = [...sim.metrics.perAgent.values()].map((p) => ({ id: p.id, faction: p.faction, trail: p.trail, tactics: p.tactics, shots: p.shots, shotStates: p.shotStates }));
    out[name].push(row);
    if (process.argv.includes('--log')) for (const p of sim.metrics.perAgent.values()) { console.log(`  --- ${p.id} ${p.faction}`); for (const l of p.timeline) console.log('   ', l); }
    sim.dispose();
    const tac = Object.entries(s.tactics).map(([k, v]) => `${k}:${v}`).join(' ');
    console.log(`[${name} #${seed}] ${(row.ms / 1000).toFixed(1)}s sim=${s.t}s shots=${s.shots} hit=${s.hitRate} deaths=${s.deaths.length} reloads=${s.reloads} cover=${s.coverShare} openIdle=${s.openIdleShare} stuck=${s.stuck.length} inside=${s.insideGeometry} badFacing=${s.badFacing} muzzleBlocked=${s.muzzleBlocked} ff=${s.friendlyHits}`);
    console.log(`    extra ${JSON.stringify(e)}`);
    console.log(`    fire ${JSON.stringify(s.shotsByFaction)} hits ${JSON.stringify(s.hitsByFaction)}`);
    console.log(`    states ${JSON.stringify(s.stateTime)}`);
    if (tac) console.log(`    tactics ${tac}`);
    if (Object.keys(s.pathFails).length) console.log(`    pathFails ${JSON.stringify(s.pathFails)}`);
    if (s.stuck.length) console.log(`    stuck ${JSON.stringify(s.stuck.slice(0, 6))}`);
  }
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 1));
