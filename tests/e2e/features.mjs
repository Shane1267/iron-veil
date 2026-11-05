// Browser test for the debug menu, Riverside traders, sentries, farms, fuel pump, ladders
// and the reworked lights. Usage: npm run build && node tests/e2e/features.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, 'tests/e2e/screenshots');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4183;
const CHROME = process.env.CHROME_PATH || (fs.existsSync('/opt/google/chrome/chrome') ? '/opt/google/chrome/chrome' : undefined);
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const log = (...a) => console.log('[features]', ...a);
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe' });
const BASE = `http://localhost:${PORT}/`;
for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(300000);
await page.addInitScript((q) => localStorage.setItem('ironveil.settings.v1', JSON.stringify({ preset: q })), process.env.QUALITY || 'chromebook');
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); log('console.error', m.text().slice(0, 300)); } });
page.on('pageerror', (e) => { errors.push(String(e)); log('pageerror', String(e).slice(0, 300)); });
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = async (n) => { await page.screenshot({ path: path.join(OUT, `${n}.png`) }); log('screenshot', n); };
const gs = (s) => Promise.race([ev((s) => window.__IV.gameSeconds(s), s), new Promise((_, rej) => setTimeout(async () => {
  const st = await ev(() => ({ t: window.__IV.game.time, mode: window.__IV.game.ui.mode, pad: window.__IV.game.debug.padOpen, started: window.__IV.game.started, vis: document.visibilityState })).catch((e) => e.message);
  rej(new Error(`game time stalled waiting ${s}s: ${JSON.stringify(st)}`));
}, 240000))]);
const results = [];
async function check(name, fn) {
  if (only.length && !only.includes(name)) return;
  const t0 = Date.now();
  try { const info = await fn(); results.push([name, true]); log('PASS', name, info ? JSON.stringify(info) : '', `${((Date.now() - t0) / 1000).toFixed(1)}s`); }
  catch (e) { results.push([name, false]); log('FAIL', name, e.message.split('\n')[0]); }
}

await page.goto(BASE);
await page.waitForFunction(() => window.__IV && window.__IV.game.ui.mode === 'menu');
await ev(() => window.__IV.game.newGame());
await page.waitForFunction(() => window.__IV.game.started && window.__IV.game.ui.mode === 'playing');
log('new game started');
await gs(1);

await check('debug-keypad', async () => {
  await page.keyboard.down('Tab'); await page.keyboard.press('Digit3'); await page.keyboard.up('Tab');
  await gs(0.3);
  const st = await ev(() => ({ pad: window.__IV.game.debug.padOpen, inv: window.__IV.game.ui.mode }));
  if (!st.pad) throw new Error(`keypad did not open (${JSON.stringify(st)})`);
  if (st.inv === 'inventory') throw new Error('Tab also opened the inventory');
  await page.keyboard.type('1111'); await page.keyboard.press('Enter');
  await gs(0.2);
  await shot('f01-keypad-denied');
  const denied = await ev(() => window.__IV.game.debug.open);
  if (denied) throw new Error('wrong code accepted');
  await page.keyboard.type('3209'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__IV.game.debug.open, null, { timeout: 20000 });
  // Tab alone still opens the inventory
  return { weaponSlot: await ev(() => window.__IV.game.weapons.slot) };
});

await check('debug-menu-teleport', async () => {
  await page.keyboard.press('Enter'); // Teleport
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); // Landmarks
  const idx = await ev(() => { const d = window.__IV.game.debug; return d._items(d.cur.page).findIndex((i) => /Riverside/.test(i.label)); });
  for (let i = 0; i < idx; i++) await page.keyboard.press('ArrowDown');
  await gs(0.3);
  await shot('f02-debug-menu');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => { const g = window.__IV.game; const q = g.world.poiById.get('riverside'); return g.ui.mode === 'playing' && Math.hypot(g.player.controller.pos.x - q.x, g.player.controller.pos.z - q.z) < 220 && g.pois.isBuilt('riverside'); }, null, { timeout: 300000 });
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  return { open: await ev(() => window.__IV.game.debug.open) };
});

await check('riverside-people', async () => {
  await page.waitForFunction(() => window.__IV.game.npcs.npcs.length >= 10, null, { timeout: 120000 });
  const n = await ev(() => { const g = window.__IV.game; return { traders: g.npcs.npcs.filter((x) => x.kind === 'trader').map((x) => x.role), civ: g.npcs.npcs.filter((x) => x.kind === 'civilian').length, guards: g.ai.agents.filter((a) => a.faction === 'guard').length }; });
  if (n.traders.length !== 6) throw new Error(`traders: ${n.traders}`);
  // stand in the market facing the general trader
  await ev(() => { const g = window.__IV.game; const t = g.npcs.npcs.find((x) => x.role === 'general'); g.player.controller.teleport(t.front.x, t.pos.y + 0.1, t.front.z, Math.atan2(-(t.pos.x - t.front.x), -(t.pos.z - t.front.z))); g.player.controller.pitch = -0.05; window.__IV.setTime(11); });
  await gs(4);
  await shot('f03-riverside-market');
  return n;
});

await check('trade', async () => {
  const r = await ev(() => {
    const g = window.__IV.game;
    window.__IV.give('watch', 3); window.__IV.give('cigarettes', 10);
    const t = g.npcs.npcs.find((x) => x.role === 'general');
    g.npcs.interact(t);
    const ui = g.ui.trade;
    const inv = g.player.equipment.inventory;
    const wi = inv.slots.findIndex((s) => s?.id === 'watch');
    ui.give.set(wi, 3);
    const mi = ui.t.state.stock.findIndex((s) => s.id === 'can_meat');
    ui.take.set(mi, 3);
    ui.render();
    return { mode: g.ui.mode, give: ui._giveValue(), take: ui._takeValue(), meatBefore: inv.count('can_meat') };
  });
  await gs(0.5);
  await shot('f04-trade-screen');
  const after = await ev(() => { const g = window.__IV.game; g.ui.trade._execute(); return { meat: g.player.equipment.inventory.count('can_meat'), watch: g.player.equipment.inventory.count('watch') }; });
  if (after.meat !== r.meatBefore + 3 || after.watch !== 0) throw new Error(`trade result ${JSON.stringify(after)} from ${JSON.stringify(r)}`);
  // services and jobs pages render
  await ev(() => { const g = window.__IV.game; g.ui.close(); const t = g.npcs.npcs.find((x) => x.role === 'quartermaster'); g.npcs.interact(t); g.ui.trade.tab = 'jobs'; g.ui.trade.render(); });
  await gs(0.3);
  await shot('f05-job-board');
  await ev(() => window.__IV.game.ui.close());
  return { ...r, ...after };
});

await check('farms-and-pump', async () => {
  const r = await ev(() => {
    const g = window.__IV.game, p = g.player.controller.pos;
    const mk = (type, dx) => g.base._create({ id: `t_${type}`, type, x: p.x + dx, y: g.world.heightAt(p.x + dx, p.z + 60), z: p.z + 60, rot: 0 });
    const ly = mk('lumber_yard', 0), sy = mk('scrap_yard', 5), fp = mk('fuel_pump', 9);
    g.base.debugProduce(1440);
    window.__IV.give('fuel_can_empty', 1);
    const before = g.player.equipment.inventory.count('fuel_can');
    const res = g.base.usePump(fp);
    return { planks: ly.inventory.count('wood_plank'), scrap: sy.inventory.count('scrap_metal'), pump: res.msg, cans: g.player.equipment.inventory.count('fuel_can') - before };
  });
  if (r.planks !== 20 || r.scrap !== 5 || r.cans !== 1) throw new Error(JSON.stringify(r));
  return r;
});

await check('ladder-f', async () => {
  const r = await ev(() => {
    const g = window.__IV.game, p = g.player.controller.pos;
    const x = p.x + 20, z = p.z + 80, y = g.world.heightAt(x, z);
    const t = g.base._create({ id: 't_tower', type: 'watchtower', x, y, z, rot: 0 });
    const L = t.ladder;
    g.player.controller.teleport(L.x + L.nx * 0.6, y + 0.05, L.z + L.nz * 0.6, 0);
    const near = g._ladderNear();
    g.ladderPrompt = near;
    g._ladderJump();
    const top = g.player.controller.pos.y - y;
    g.ladderPrompt = g._ladderNear();
    const down = g.ladderPrompt?.label;
    g._ladderJump();
    return { prompt: near?.label, top: +top.toFixed(2), downPrompt: down, back: +(g.player.controller.pos.y - y).toFixed(2) };
  });
  if (!(r.top > 4) || !(r.back < 1)) throw new Error(JSON.stringify(r));
  return r;
});

await check('sentry', async () => {
  const r = await ev(() => {
    const g = window.__IV.game, pc = g.player.controller;
    // out in the open south of the settlement
    const q = g.world.poiById.get('riverside');
    const x = q.x, z = q.z + q.radius + 60;
    window.__IV.teleport(x, z, Math.PI);
    const y = g.world.heightAt(x + 3, z);
    const s = g.base._create({ id: 't_sentry', type: 'sentry', x: x + 3, y, z, rot: 2 });
    s.inventory.add({ ...window.__IV.game.player.equipment.inventory.slots[0], id: 'wpn_arv7', qty: 1, data: { ammo: 0, cond: 1, attach: {} } });
    s.inventory.add({ id: 'ammo_556', qty: 90 });
    g.debug.flags.god = true;
    g.debug.flags.invisible = true;
    g.ai.spawnSquad(['wolf_raider', 'wolf_raider'], x, z + 45, {});
    pc.yaw = Math.PI; pc.pitch = -0.08;
    return { status: s.sentry.status };
  });
  const t0 = Date.now();
  let st;
  while (Date.now() - t0 < 300000) {
    await gs(2);
    st = await ev(() => { const g = window.__IV.game, s = g.base.pieces.get('t_sentry'); return { status: s.sentry.status, loaded: s.sentry.loaded, left: s.inventory.count('ammo_556'), wolvesAlive: g.ai.agents.filter((a) => a.faction === 'wolves' && a.alive).length, dead: g.ai.agents.filter((a) => a.faction === 'wolves' && !a.alive).length }; });
    if (st.status === 'Engaging' && !this?.shotTaken) { await shot('f06-sentry-engaging'); }
    if (st.dead > 0) break;
  }
  await shot('f07-sentry-after');
  await ev(() => { const g = window.__IV.game; g.debug.flags.invisible = false; });
  if (!st.dead) throw new Error(`no kills: ${JSON.stringify(st)}`);
  return { ...r, ...st };
});

await check('lights-night', async () => {
  await ev(() => {
    const g = window.__IV.game, pc = g.player.controller;
    window.__IV.setTime(23.5); window.__IV.weather('clear');
    g.debug.flags.god = true;
    for (const a of [...g.ai.agents]) g.ai._despawn(a);
    const x = pc.pos.x + 8, z = pc.pos.z;
    const v = g.vehicles.add({ id: 'tcar', type: 'pickup', x, z, rot: Math.PI / 2, fuel: 50 });
    v.lightsOn = true; v._sync();
    pc.teleport(x + 4, g.world.heightAt(x + 4, z + 14) + 0.05, z + 14, Math.atan2(-(x - (x + 4)) - 6, -(z - (z + 14))));
    pc.pitch = -0.12;
  });
  await gs(2);
  await shot('f08-headlights-low');
  await ev(() => { const v = window.__IV.game.vehicles.vehicles.get('tcar'); v.highBeam = true; v._sync(); });
  await gs(1);
  await shot('f09-headlights-high');
  await ev(() => { const g = window.__IV.game, pc = g.player.controller; g.vehicles.vehicles.get('tcar').lightsOn = false; g.vehicles.vehicles.get('tcar')._sync(); const q = g.world.poiById.get('riverside'); const b = g.pois.active.get('riverside').buildings[0]; const half = Math.max(b.w, b.d) / 2 + 7; pc.teleport(b.x + half, g.world.heightAt(b.x + half, b.z) + 0.05, b.z, Math.PI / 2); pc.pitch = -0.12; window.__IV.equip('flashlight'); void q; });
  await ev(() => { const g = window.__IV.game; const eq = g.player.equipment; if (eq.slots.util?.id !== 'flashlight') { eq.slots.util = { id: 'flashlight', qty: 1, data: { charge: 1 } }; } g.weapons.lightOn = true; });
  await gs(1.5);
  await shot('f10-flashlight');
  const s = await ev(() => ({ spot: window.__IV.game.weapons.spot.intensity, heads: window.__IV.game.vehicles.heads.map((h) => h.intensity) }));
  if (!(s.spot > 0)) throw new Error(JSON.stringify(s));
  return s;
});

await check('save-load', async () => {
  const r = await ev(async () => {
    const g = window.__IV.game;
    g.debug.flags.god = false;
    await g.saveGame('slot3', true);
    await g.loadGame('slot3');
    const s = g.base.pieces.get('t_sentry');
    return { sentry: !!s?.sentry, pieces: g.base.pieces.size, traders: Object.keys(g.npcs.state).length, prod: g.base.pieces.get('t_lumber_yard')?.inventory?.count('wood_plank') };
  });
  if (!r.sentry || !r.traders) throw new Error(JSON.stringify(r));
  return r;
});

await browser.close();
server.kill();
const fails = results.filter((r) => !r[1]);
log(`${results.length - fails.length}/${results.length} passed, ${errors.length} console errors`);
if (errors.length) log(errors.slice(0, 8).join('\n'));
process.exit(fails.length || errors.length ? 1 : 0);
