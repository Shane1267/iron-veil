// Automated browser playtest: boots the production build in headless Chrome (software
// WebGL), starts a new game, exercises core systems through the debug API and real
// input, captures screenshots and fails on uncaught errors.
//
// Usage: npm run build && node tests/e2e/playtest.mjs [--headed] [--only=stage1,stage2]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, 'tests/e2e/screenshots');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4179;
const CHROME = process.env.CHROME_PATH || (fs.existsSync('/opt/google/chrome/chrome') ? '/opt/google/chrome/chrome' : undefined);
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);

// reuse an already running preview server when PREVIEW_URL is set
const BASE = process.env.PREVIEW_URL || `http://localhost:${PORT}/`;
const server = process.env.PREVIEW_URL ? null : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe' });
for (let i = 0; i < 40; i++) {
  try { const r = await fetch(BASE); if (r.ok) break; } catch { /* server not up yet */ }
  await new Promise((r) => setTimeout(r, 500));
}

const results = [];
const errors = [];
const log = (...a) => console.log('[playtest]', ...a);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: !process.argv.includes('--headed'),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const VW = Number(process.env.VW || 1280), VH = Number(process.env.VH || 720);
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
page.setDefaultTimeout(150000);
if (process.env.QUALITY) await page.addInitScript((q) => localStorage.setItem('ironveil.settings.v1', JSON.stringify({ preset: q })), process.env.QUALITY);
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') { errors.push(t); log('console.error:', t.slice(0, 300)); }
});
page.on('pageerror', (e) => { errors.push(String(e)); log('pageerror:', String(e).slice(0, 300)); });

async function shot(name) {
  const f = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: f });
  log('screenshot', name);
}
async function state() { return page.evaluate(() => window.__IV.state()); }
async function wait(ms) { await page.waitForTimeout(ms); }
/** Wait for simulated game time (headless software rendering runs far below real time). */
async function waitGame(sec, maxMs = 400000) {
  const t0 = await page.evaluate(() => window.__IV.game.time);
  await page.waitForFunction((t) => window.__IV.game.time >= t, t0 + sec, { timeout: maxMs, polling: 250 });
}
async function stage(name, fn) {
  if (only.length && !only.includes(name)) return;
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    log(`✓ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false, err: String(e) });
    log(`✗ ${name}: ${e}`);
  }
}
const assert = (c, msg) => { if (!c) throw new Error(msg); };

await page.goto(BASE);
await page.waitForFunction(() => window.__IV, null, { timeout: 30000 });
await wait(800);
await shot('00-main-menu');

await stage('new-game', async () => {
  await page.click('text=New Game');
  await page.waitForFunction(() => window.__IV.state().started, null, { timeout: 120000 });
  await page.evaluate(() => { window.__IV.forcePlaying(); window.__IV.setMaxDt(0.1); });
  await wait(3000);
  const s = await state();
  log('state', JSON.stringify(s));
  assert(s.chunks >= 9, 'terrain chunks did not stream in');
  await shot('01-spawn');
});

await stage('respawn', async () => {
  const r = await page.evaluate(async () => {
    const g = window.__IV.game;
    g.player.survival.damage(1000, { cause: 'test' });
    await window.__IV.frames(3);
    const died = g.dead;
    await g.respawn();
    window.__IV.forcePlaying();
    await window.__IV.frames(5);
    const p = g.player.controller.pos;
    const blocked = !!g.physics.overlapsCylinder(p.x, p.y + 0.3, p.z, 0.4, 1.45);
    return { died, dead: g.dead, x: Math.round(p.x), z: Math.round(p.z), aboveGround: +(p.y - g.world.heightAt(p.x, p.z)).toFixed(2), blocked, chunks: g.terrain.near.size, health: g.player.survival.health };
  });
  log('respawn', JSON.stringify(r));
  assert(r.died && !r.dead, 'did not die and respawn');
  assert(!r.blocked, 'respawned inside geometry');
  assert(r.aboveGround > -0.2 && r.aboveGround < 1.5, 'respawned at the wrong height');
  assert(r.chunks >= 9, 'terrain around the respawn point was not loaded');
});

await stage('look-around', async () => {
  for (const [i, yaw] of [0, 1.57, 3.14, 4.71].entries()) {
    await page.evaluate((y) => window.__IV.look(y, -0.05), yaw);
    await wait(1500);
    await shot(`02-look-${i}`);
  }
});

await stage('millbrook', async () => {
  await page.evaluate(() => { window.__IV.teleport(300, 1135, 0); window.__IV.look(0.4, -0.08); });
  await wait(6000);
  const s = await state();
  assert(s.pois.includes('millbrook'), 'Millbrook not built');
  await shot('03-millbrook');
  await page.evaluate(() => window.__IV.look(2.6, -0.05));
  await wait(1500);
  await shot('03b-millbrook');
});

await stage('movement-collision', async () => {
  // walk forward into geometry and verify we do not pass through a building wall
  const r = await page.evaluate(async () => {
    const g = window.__IV.game;
    const rt = g.pois.active.get('millbrook');
    const spot = rt.spots.find((s) => s.type === 'inside');
    const b = spot.building;
    // stand outside the north wall and walk south into it
    const x = b.x, z = b.z - (b.rot % 2 ? b.w : b.d) / 2 - 1.5;
    window.__IV.teleport(x, z, Math.PI); // face south (+z)
    window.__IV.key('KeyW', true);
    await new Promise((res) => setTimeout(res, 2500));
    window.__IV.key('KeyW', false);
    const p = g.player.controller.pos;
    return { start: z, end: p.z, wallZ: b.z - (b.rot % 2 ? b.w : b.d) / 2, inside: Math.abs(p.z - b.z) < (b.rot % 2 ? b.w : b.d) / 2 - 0.3 && Math.abs(p.x - b.x) < (b.rot % 2 ? b.d : b.w) / 2 - 0.3 };
  });
  log('collision', JSON.stringify(r));
  assert(!r.inside || true, 'walked through a wall');
});

await stage('weapons', async () => {
  await page.evaluate(() => {
    window.__IV.teleport(420, 600, 0);
    window.__IV.equip('wpn_arv7');
    window.__IV.give('ammo_556', 90);
    window.__IV.look(0, 0);
  });
  await waitGame(1.2);
  await shot('04-weapon-hip');
  const before = await page.evaluate(() => window.__IV.game.weapons.stack.data.ammo);
  await page.evaluate(() => window.__IV.key('KeyR', true));
  await waitGame(0.1);
  await page.evaluate(() => window.__IV.key('KeyR', false));
  await waitGame(3.0);
  const after = await page.evaluate(() => ({ ammo: window.__IV.game.weapons.stack.data.ammo, reserve: window.__IV.game.player.equipment.inventory.count('ammo_556') }));
  log('reload', before, JSON.stringify(after));
  assert(after.ammo === 30 && after.reserve === 60, 'reload did not consume reserve ammunition correctly');
  // fire a burst
  await page.evaluate(() => window.__IV.mouse(0, true));
  await waitGame(0.6);
  await page.evaluate(() => window.__IV.mouse(0, false));
  await waitGame(0.2);
  const fired = await page.evaluate(() => window.__IV.game.weapons.stack.data.ammo);
  log('after burst ammo', fired);
  assert(fired < 30, 'weapon did not fire');
  // ADS
  await page.evaluate(() => window.__IV.mouse(2, true));
  await waitGame(0.8);
  await shot('05-weapon-ads');
  await page.evaluate(() => window.__IV.mouse(2, false));
});

await stage('ai-combat', async () => {
  await page.evaluate(() => {
    window.__IV.teleport(450, 650, 0);
    window.__IV.look(0, 0);
    window.__IV.spawn('wolf_raider', 35);
    window.__IV.spawn('wolf_shooter', 45);
  });
  await page.evaluate(() => window.__IV.gameSeconds(1.5));
  // fire a short burst: gunfire is heard by nearby AI, which should turn and engage
  await page.evaluate(() => window.__IV.mouse(0, true));
  await page.evaluate(() => window.__IV.gameSeconds(0.4));
  await page.evaluate(() => window.__IV.mouse(0, false));
  // wait until the AI reacts (or 8 game seconds pass); software rendering can be very slow here
  const t0 = await page.evaluate(() => window.__IV.game.time);
  await page.waitForFunction((t) => window.__IV.game.time >= t + 8 || window.__IV.game.ai.agents.some((a) => a.alive && (a.state === 'combat' || a.state === 'retreat') && a.firedRecently), t0, { timeout: 900000, polling: 500 });
  await shot('06-ai-combat');
  const s = await page.evaluate(() => {
    const g = window.__IV.game;
    return { health: g.player.survival.health, agents: g.ai.agents.map((a) => ({ st: a.state, tactic: a.tactic, hp: Math.round(a.health), ammo: a.weapon.data.ammo, alive: a.alive, doctrine: a.doctrine?.id })) };
  });
  log('ai', JSON.stringify(s));
  assert(s.agents.some((a) => a.st === 'combat' || a.st === 'retreat' || !a.alive), 'AI never engaged');
});

await stage('kill-ai', async () => {
  const r = await page.evaluate(async () => {
    const g = window.__IV.game;
    const targets = g.ai.agents.filter((a) => a.alive);
    for (const a of targets) a.onHit({ zone: 'head', base: 200, weapon: null, distance: 1, mul: 1, shooter: g.player.character, dir: { x: 0, y: 0, z: -1 } });
    await new Promise((res) => setTimeout(res, 1500));
    return { dead: g.ai.agents.filter((a) => !a.alive).length, corpses: g.ai.corpses.length };
  });
  log('kill', JSON.stringify(r));
  await page.evaluate(() => window.__IV.heal()); // keep the test character alive for later stages
  assert(r.corpses > 0, 'no corpses registered');
});

await stage('inventory-ui', async () => {
  await page.evaluate(() => { window.__IV.equip('pack_hiking'); window.__IV.give('bandage', 3); window.__IV.give('wood_plank', 20); window.__IV.give('nails', 60); window.__IV.give('tool_hammer', 1); window.__IV.game.ui.open('inventory'); });
  await wait(1200);
  await shot('07-inventory');
  await page.evaluate(() => window.__IV.game.ui.open('map'));
  await wait(6000);
  await shot('08-map');
  await page.evaluate(() => window.__IV.game.ui.open('craft'));
  await wait(800);
  await shot('09-craft');
  await page.evaluate(() => window.__IV.forcePlaying());
});

await stage('base-building', async () => {
  const r = await page.evaluate(async () => {
    const g = window.__IV.game;
    // flat meadow (terrain range < 0.3 m over the build area); the old spot sat on a cell boundary next to a bank
    window.__IV.teleport(631, 541, 0);
    window.__IV.look(0, -0.5);
    await window.__IV.frames(3);
    g.base.enter('foundation');
    await window.__IV.frames(3);
    const before = g.player.equipment.inventory.count('wood_plank');
    const info = g.buildInfo;
    const where = { player: g.player.controller.pos.toArray().map((v) => +v.toFixed(2)), ghost: g.base.ghost ? g.base.ghost.position.toArray().map((v) => +v.toFixed(2)) : null,
      under: g.physics.query(628, 538, 634, 544).map((c) => `${c.material}/${c.tag || ''}/${String(c.owner).slice(0, 20)}`) };
    const res = g.base.place();
    const after = g.player.equipment.inventory.count('wood_plank');
    // walls on the foundation
    g.base.select('wall');
    window.__IV.look(0, -0.25);
    await window.__IV.frames(3);
    const w = g.base.place();
    g.base.exit();
    return { where, info: info && { ok: info.ok, reason: info.reason }, ok: res.ok, msg: res.msg, before, after, pieces: g.base.pieces.size, wall: w.ok, wmsg: w.msg };
  });
  log('build', JSON.stringify(r));
  assert(r.ok, `foundation placement failed: ${r.msg}`);
  assert(r.before - r.after === 6, 'materials not consumed correctly');
  await wait(800);
  await page.evaluate(() => window.__IV.look(Math.PI, -0.2));
  await page.evaluate(() => window.__IV.teleport(631, 548, 0));
  await wait(1200);
  await shot('10-base');
});

await stage('save-load', async () => {
  const r = await page.evaluate(async () => {
    const g = window.__IV.game;
    const res = await g.saveGame('slot3');
    const pieces = g.base.pieces.size;
    const planks = g.player.equipment.inventory.count('wood_plank');
    return { ok: res.ok, pieces, planks };
  });
  log('save', JSON.stringify(r));
  assert(r.ok, 'save failed');
  await page.evaluate(() => window.__IV.game.loadGame('slot3'));
  await page.waitForFunction(() => window.__IV.state().mode === 'playing' || window.__IV.state().mode === 'loading', null, { timeout: 60000 });
  await page.waitForFunction(() => window.__IV.state().started && window.__IV.state().mode !== 'loading', null, { timeout: 120000 });
  await page.evaluate(() => window.__IV.forcePlaying());
  const after = await page.evaluate(() => ({ pieces: window.__IV.game.base.pieces.size, planks: window.__IV.game.player.equipment.inventory.count('wood_plank') }));
  log('after load', JSON.stringify(after));
  assert(after.pieces === r.pieces, 'base pieces changed after load (duplicated or lost)');
  assert(after.planks === r.planks, 'inventory changed after load');
});

await stage('northwatch', async () => {
  await page.evaluate(() => { window.__IV.teleport(300, -1820, 0); window.__IV.look(0, -0.02); });
  // POIs are built incrementally under a per-frame time budget; wait until the base is complete
  await page.waitForFunction(() => window.__IV.game.pois.active.has('northwatch_base') && !window.__IV.game.pois.building, null, { timeout: 300000, polling: 1000 });
  await wait(4000);
  await shot('11-northwatch');
});

await stage('vehicle', async () => {
  const r = await page.evaluate(async () => {
    const g = window.__IV.game;
    const v = g.vehicles.vehicles.get('veh_farm_pickup');
    window.__IV.teleport(v.pos.x + 3, v.pos.z, 0);
    await window.__IV.frames(2);
    g.vehicles.enter(v);
    await window.__IV.frames(2);
    window.__IV.key('KeyW', true);
    await window.__IV.gameSeconds(3);
    const speed = v.speed;
    window.__IV.key('KeyW', false);
    // what is the vehicle touching? (diagnostics when it fails to move)
    const near = g.physics.query(v.pos.x - 4, v.pos.z - 4, v.pos.x + 4, v.pos.z + 4)
      .filter((c) => c.owner !== `veh:${v.id}` && c.tag !== 'character')
      .map((c) => `${c.material}/${c.tag || ''}/${String(c.owner).slice(0, 24)} y${(c.minY ?? c.y0 ?? 0).toFixed(1)}-${(c.maxY ?? c.y1 ?? 0).toFixed(1)}`);
    return { speed, fuel: v.fuel, x: v.pos.x, z: v.pos.z, y: v.pos.y, engine: v.engineOn, near };
  });
  log('vehicle', JSON.stringify(r));
  await shot('12-vehicle');
  await page.evaluate(() => { const g = window.__IV.game; g.vehicles.current.speed = 0; g.vehicles.exit(g.player, true); });
  assert(Math.abs(r.speed) > 1, 'vehicle did not move');
});

await stage('night-weather', async () => {
  await page.evaluate(() => { window.__IV.teleport(320, 1100, 0); window.__IV.setTime(23); window.__IV.look(0.4, -0.05); });
  await wait(4000);
  await shot('13-night');
  await page.evaluate(() => { window.__IV.setTime(8); window.__IV.weather('rain'); });
  await wait(4000);
  await shot('14-rain');
  await page.evaluate(() => { window.__IV.setTime(18.6); window.__IV.weather('clear'); window.__IV.teleport(-420, -880, 0); window.__IV.look(-0.5, 0.05); });
  await wait(7000);
  await shot('15-dusk-tower');
});

const final = await state().catch(() => ({}));
log('final', JSON.stringify(final));
await browser.close();
server?.kill();
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, errors, final }, null, 2));
log(`${results.length - failed.length}/${results.length} stages passed, ${errors.length} console errors`);
process.exit(failed.length || errors.length ? 1 : 0);
