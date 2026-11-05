// Two-browser online test: starts the real server (dist-server/) on a local port, opens the
// game twice in headless Chrome, joins both, brings them together near a hostile location
// and checks that they see each other, share AI, hear each other's shots, share doors,
// bodies and chat — with no console errors.
//
// Usage: npm run build:all && node tests/e2e/online.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, 'tests/e2e/screenshots');
fs.mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT || 4190);
const CHROME = process.env.CHROME_PATH || (fs.existsSync('/opt/google/chrome/chrome') ? '/opt/google/chrome/chrome' : undefined);
const log = (...a) => console.log('[online]', ...a);

const srv = spawn('node', ['dist-server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
let srvLog = '';
srv.stdout.on('data', (d) => { srvLog += d; });
srv.stderr.on('data', (d) => { srvLog += d; });
const BASE = `http://localhost:${PORT}/`;
// plain http (no keep-alive reuse between long gaps)
const health = () => new Promise((res, rej) => http.get(`${BASE}health?detail`, { agent: false }, (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej));
for (let i = 0; i < 60; i++) { try { await health(); break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
async function open(name) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.setDefaultTimeout(300000);
  await page.addInitScript(() => localStorage.setItem('ironveil.settings.v1', JSON.stringify({ preset: 'chromebook' })));
  page.on('console', (m) => { if (/\[net\]|\[online\]|Load|reload/i.test(m.text())) log(name, 'console', m.text().slice(0, 200)); if (m.type() === 'error') { errors.push(`${name}: ${m.text()}`); log(name, 'console.error', m.text().slice(0, 300)); } });
  page.on('pageerror', (e) => { errors.push(`${name}: ${e}`); log(name, 'pageerror', String(e).slice(0, 300)); });
  page.on('dialog', (d) => { errors.push(`${name}: dialog ${d.message()}`); d.dismiss(); });
  await page.goto(BASE);
  await page.waitForFunction(() => window.__IV && window.__IV.game.ui.mode === 'menu');
  return page;
}
const results = [];
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
async function check(name, fn) {
  if (ONLY.length && !ONLY.some((o) => name.startsWith(o))) return;
  const t0 = Date.now();
  try { const info = await fn(); results.push({ name, ok: true, info }); log('PASS', name, info ? JSON.stringify(info) : '', `${((Date.now() - t0) / 1000).toFixed(1)}s`); }
  catch (e) { results.push({ name, ok: false, info: e.message }); log('FAIL', name, e.message); }
}
const ev = (p, fn, arg) => p.evaluate(fn, arg);
const gameSec = (p, s) => ev(p, (s) => window.__IV.gameSeconds(s), s);

const A = await open('A');
const B = await open('B');
let target;

await check('join', async () => {
  const ra = ev(A, () => window.__IV.game.joinOnline('', 'Alice'));
  const rb = ev(B, () => window.__IV.game.joinOnline('', 'Bob'));
  const [a, b] = await Promise.all([ra, rb]);
  if (!a || !b) throw new Error(`join returned ${a} ${b}`);
  // both players take hits (counted and applied) but never drop below half health, so the test can go on
  for (const p of [A, B]) await ev(p, () => { const s = window.__IV.game.player.survival; window.__hits = 0; const hit = s.hit.bind(s), dmg = s.damage.bind(s); s.hit = (info, eq) => { window.__hits++; return hit(info, eq); }; s.damage = (amount, o) => { dmg(Math.min(amount, Math.max(0, s.health - 50)), o); s.bleeding = 0; }; });
  return { a, b };
});

await check('meet near a hostile location', async () => {
  target = await ev(A, () => {
    const g = window.__IV.game;
    const hostile = g.world.pois.filter((p) => p.garrison?.length && g.poiHostile(p));
    const q = hostile.find((p) => p.type === 'farmstead') || hostile.sort((x, y) => x.radius - y.radius)[0];
    return { id: q.id, x: q.x, z: q.z + q.radius + 45 };
  });
  for (const [p, dx] of [[A, 0], [B, 4]]) await ev(p, ({ x, z }) => { window.__IV.teleport(x, z, Math.PI); window.__IV.game.net.spawned(); }, { x: target.x + dx, z: target.z });
  await Promise.all([gameSec(A, 3), gameSec(B, 3)]);
  return target;
});

await check('see each other', async () => {
  await A.waitForFunction(() => window.__IV.game.net.players.size > 0, null, { timeout: 120000 });
  await B.waitForFunction(() => window.__IV.game.net.players.size > 0, null, { timeout: 120000 });
  const d = await ev(B, () => { const g = window.__IV.game; const p = [...g.net.players.values()][0]; return { name: p.name, d: Math.hypot(p.pos.x - g.player.controller.pos.x, p.pos.z - g.player.controller.pos.z) }; });
  if (d.d > 10) throw new Error(`Alice drawn ${d.d.toFixed(1)} m away from where she is`);
  return d;
});

await check('shared AI', async () => {
  await A.waitForFunction(() => window.__IV.game.net.agents.size > 0, null, { timeout: 200000 });
  await B.waitForFunction(() => window.__IV.game.net.agents.size > 0, null, { timeout: 200000 });
  const ia = await ev(A, () => [...window.__IV.game.net.agents.keys()].sort());
  const ib = await ev(B, () => [...window.__IV.game.net.agents.keys()].sort());
  const common = ia.filter((x) => ib.includes(x));
  if (!common.length) throw new Error(`no shared agents: ${ia} / ${ib}`);
  const localAI = await ev(A, () => window.__IV.game.ai.agents.length);
  if (localAI) throw new Error(`client is running its own AI (${localAI})`);
  return { A: ia.length, B: ib.length, common: common.length };
});

await check('shots replayed to the other player', async () => {
  await ev(A, () => { window.__IV.equip('wpn_arv7'); window.__IV.give('ammo_556', 120); });
  await gameSec(A, 1.5);
  await ev(A, () => {
    const g = window.__IV.game;
    const a = [...g.net.agents.values()].filter((x) => x.alive).sort((p, q) => p.pos.distanceTo(g.player.controller.pos) - q.pos.distanceTo(g.player.controller.pos))[0];
    const pc = g.player.controller;
    pc.yaw = Math.atan2(-(a.pos.x - pc.pos.x), -(a.pos.z - pc.pos.z));
    g.weapons.stack.data.ammo = 30;
  });
  const aliceId = await ev(A, () => window.__IV.game.net.id);
  const before = await ev(B, (id) => window.__IV.game.net.shotsFrom[id] || 0, aliceId);
  for (let i = 0; i < 6; i++) { await ev(A, () => window.__IV.mouse(0, true)); await ev(A, () => window.__IV.frames(2)); await ev(A, () => window.__IV.mouse(0, false)); await ev(A, () => window.__IV.frames(4)); }
  await gameSec(B, 2);
  const after = await ev(B, (id) => window.__IV.game.net.shotsFrom[id] || 0, aliceId);
  if (after <= before) throw new Error('Bob received none of Alice\'s shots');
  return { shotsSeenByBob: after - before };
});

await check('doors shared', async () => {
  // Alice walks up to a closed door and opens it
  const id = await ev(A, () => {
    const g = window.__IV.game, n = g.net, pc = g.player.controller;
    let best = null, bd = Infinity;
    for (const [id, d] of n.doorIndex) { const dd = Math.hypot(d.center.x - pc.pos.x, d.center.z - pc.pos.z); if (!d.open && dd < bd) { bd = dd; best = [id, d]; } }
    if (!best) return null;
    const [id, d] = best;
    pc.teleport(d.center.x + 1.2, d.center.y - 1.05, d.center.z + 1.2, 0);
    window.__doorTry = { id, d };
    return id;
  });
  if (id) { await ev(A, () => window.__IV.game.net.spawned()); await gameSec(A, 1); await ev(A, () => window.__doorTry.d.toggle(true)); }
  if (!id) throw new Error('no closed door near');
  await gameSec(B, 2);
  const open = await ev(B, (id) => { const d = window.__IV.game.net.doorIndex.get(id); return d ? d.open : 'not built'; }, id);
  if (open !== true) throw new Error(`door ${id} on Bob: ${open}`);
  return { id };
});

await check('chat', async () => {
  await ev(A, () => window.__IV.game.net.send({ t: 'chat', text: 'contact north' }));
  await B.waitForFunction(() => /contact north/.test(document.querySelector('.net-chat-log')?.textContent || ''), null, { timeout: 30000 });
  return null;
});

await check('fight: AI engage, bodies shared', async () => {
  // back out in the open where the fight is; keep Alice shooting at the nearest agent
  await ev(A, () => { if (!window.__IV.game.weapons.stack) { window.__IV.equip('wpn_arv7'); window.__IV.give('ammo_556', 120); } });
  await ev(A, ({ x, z }) => { window.__IV.teleport(x, z, Math.PI); window.__IV.game.net.spawned(); }, target);
  await gameSec(A, 1);
  const t0 = Date.now();
  let dead = 0, shown = false;
  while (Date.now() - t0 < 420000) {
    await ev(A, () => {
      const g = window.__IV.game; window.__IV.heal();
      const a = [...g.net.agents.values()].filter((x) => x.alive).sort((p, q) => p.pos.distanceTo(g.player.controller.pos) - q.pos.distanceTo(g.player.controller.pos))[0];
      if (!a) return;
      const pc = g.player.controller, e = g.renderer.camera.position;
      // AI that hide far away are hard to hit: walk Alice up to about 12 m
      const d = Math.hypot(a.pos.x - pc.pos.x, a.pos.z - pc.pos.z);
      if (d > 25) { const k = 12 / d; window.__IV.teleport(a.pos.x + (pc.pos.x - a.pos.x) * k, a.pos.z + (pc.pos.z - a.pos.z) * k, 0); g.net.spawned(); }
      pc.yaw = Math.atan2(-(a.pos.x - pc.pos.x), -(a.pos.z - pc.pos.z));
      pc.pitch = Math.atan2(a.pos.y + 1.2 - e.y, Math.hypot(a.pos.x - pc.pos.x, a.pos.z - pc.pos.z));
      if ((g.weapons.stack?.data.ammo || 0) < 2) g.weapons.stack.data.ammo = 30;
    });
    await ev(B, () => window.__IV.heal());
    await ev(A, () => window.__IV.mouse(0, true)); await ev(A, () => window.__IV.frames(2)); await ev(A, () => window.__IV.mouse(0, false));
    await ev(A, () => window.__IV.frames(6));
    dead = await ev(B, () => [...window.__IV.game.net.agents.values()].filter((x) => !x.alive).length);
    if (Date.now() - t0 > 20000 && !shown) { shown = true; log('fight', JSON.stringify(await ev(A, () => { const g = window.__IV.game; return { shots: g.ballistics.stats.shots, hits: g.ballistics.stats.hits, mode: g.ui.mode, ammo: g.weapons.stack?.data.ammo, wpn: g.weapons.w?.id, state: g.weapons.state, alive: [...g.net.agents.values()].filter((x) => x.alive).map((a) => Math.round(a.pos.distanceTo(g.player.controller.pos))) }; }))); }
    if (dead > 0) break;
  }
  const c = await ev(A, () => window.__IV.game.net.counts);
  const cb = await ev(B, () => window.__IV.game.net.counts);
  if (!dead) throw new Error(`no body seen by Bob after the fight (A got ${JSON.stringify(c)})`);
  // Bob searches the body through the server
  const body = await ev(B, () => { const g = window.__IV.game; const a = [...g.net.agents.values()].find((x) => !x.alive); g.player.controller.teleport(a.pos.x + 1, a.pos.y + 0.05, a.pos.z, 0); g.net.spawned(); return a.id; });
  await gameSec(B, 1);
  await ev(B, (id) => window.__IV.game.net.openCorpse(id), body);
  await B.waitForFunction((id) => window.__IV.game.net.corpses.has(id) || window.__IV.game.net.lastFar === id, body, { timeout: 30000 }).catch(async (e) => { log('corpse wait', JSON.stringify(await ev(B, (id) => { const g = window.__IV.game; const a = g.net.agents.get(id); return { body: a && [a.pos.x, a.pos.z], me: [g.player.controller.pos.x, g.player.controller.pos.z], counts: g.net.counts }; }, body))); { const hh = await health(); log('server', JSON.stringify({ list: hh.list, corpses: hh.corpses })); } throw e; });
  if (await ev(B, (id) => window.__IV.game.net.lastFar === id, body)) throw new Error('server says Bob is too far from the body');
  const items = await ev(B, (id) => window.__IV.game.net.corpses.get(id).inv.usedSlots(), body);
  // Bob takes the first stack; Alice then sees it gone
  await ev(B, (id) => { const g = window.__IV.game; const inv = g.net.corpses.get(id).inv; const i = inv.slots.findIndex(Boolean); inv.transfer(i, g.player.equipment.inventory); g.ui.close?.(); }, body);
  await gameSec(B, 1.5);
  await ev(A, (id) => { const g = window.__IV.game; const a = g.net.agents.get(id); g.player.controller.teleport(a.pos.x - 1, a.pos.y + 0.05, a.pos.z, 0); g.net.spawned(); }, body);
  await gameSec(A, 1);
  await ev(A, (id) => window.__IV.game.net.openCorpse(id), body);
  await A.waitForFunction((id) => window.__IV.game.net.corpses.has(id), body, { timeout: 30000 });
  const itemsA = await ev(A, (id) => window.__IV.game.net.corpses.get(id).inv.usedSlots(), body);
  if (itemsA !== items - 1) throw new Error(`body had ${items} stacks for Bob, Alice sees ${itemsA} after Bob took one`);
  const aliceHits = await ev(A, () => window.__hits);
  return { aliceMsgs: c, aliceHits, bobHits: cb.hit || 0, bobWhiz: cb.whiz || 0, bodyStacks: items };
});

await check('screenshot', async () => {
  await ev(B, () => { const g = window.__IV.game; g.ui.open('playing'); const p = [...g.net.players.values()][0]; const pc = g.player.controller; pc.teleport(p.pos.x + 3, p.pos.y + 0.05, p.pos.z + 3, Math.atan2(3, 3)); pc.pitch = -0.05; g.net.spawned(); });
  await gameSec(B, 1.5);
  await B.screenshot({ path: path.join(OUT, 'online-bob-sees-alice.png') });
  return null;
});

await check('leave', async () => {
  log('B before leave', JSON.stringify(await ev(B, () => ({ mode: window.__IV.game.ui.mode, net: typeof window.__IV.game.net, online: window.__IV.game.online, t: window.__IV.game.time }))));
  await ev(A, () => window.__IV.game.quitToMenu());
  await B.waitForFunction(() => window.__IV.game.net.players.size === 0, null, { timeout: 30000 });
  const h = await health();
  if (h.players !== 1) throw new Error(`server reports ${h.players} players`);
  return h;
});

await browser.close();
srv.kill();
const fails = results.filter((r) => !r.ok);
log(`${results.length - fails.length}/${results.length} passed, ${errors.length} console errors`);
if (errors.length) log(errors.slice(0, 10).join('\n'));
if (fails.length || errors.length) { log('server log:\n' + srvLog.slice(-3000)); process.exit(1); }
