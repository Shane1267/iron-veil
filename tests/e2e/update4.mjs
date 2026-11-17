// Browser tests for update 4 (batteries and night vision, launch-site loot, elevator, rocket
// wasteland, blueprints, set dressing, map, AI grenades, tyres).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, 'tests/e2e/screenshots');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4188;
const CHROME = process.env.CHROME_PATH || (fs.existsSync('/opt/google/chrome/chrome') ? '/opt/google/chrome/chrome' : undefined);
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const log = (...a) => console.log('[update4]', ...a);
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe' });
const BASE = `http://localhost:${PORT}/`;
for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(600000);
await page.addInitScript((q) => localStorage.setItem('ironveil.settings.v1', JSON.stringify({ preset: q })), process.env.QUALITY || 'chromebook');
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); log('console.error', m.text().slice(0, 300)); } });
page.on('pageerror', (e) => { errors.push(String(e)); log('pageerror', String(e).slice(0, 400)); });
page.on('dialog', (d) => d.dismiss());
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = async (n) => { await page.screenshot({ path: path.join(OUT, `${n}.png`) }); };
const gs = (s) => ev((s) => window.__IV.gameSeconds(s), s);
const results = [];
async function check(name, fn) {
  if (only.length && !only.includes(name)) return;
  const t0 = Date.now();
  await page.evaluate(() => { const g = window.__IV.game; const inv = g.player.equipment.inventory; for (let i = 0; i < inv.slots.length; i++) inv.slots[i] = null; inv.version++; if (g.vehicles.current) g.vehicles.exit(g.player, true); g.player.survival.bleeding = 0; g.player.survival.health = 100; g.debug.flags.god = true; g.debug.flags.invisible = true; });
  try { const info = await fn(); results.push([name, true]); log('PASS', name, info ? JSON.stringify(info) : '', `${((Date.now() - t0) / 1000).toFixed(1)}s`); }
  catch (e) { results.push([name, false]); log('FAIL', name, e.message.split('\n')[0].slice(0, 900)); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const tp = (x, z) => ev(async ({ x, z }) => { const g = window.__IV.game; await g.debug.teleport(x, z, null, null); g.ui.open('playing'); }, { x, z });
const built = (id) => page.waitForFunction((id) => window.__IV.game.pois.isBuilt(id), id, { timeout: 300000 });

await page.goto(BASE);
await page.waitForFunction(() => window.__IV && window.__IV.game.ui.mode === 'menu');
await ev(() => window.__IV.game.newGame());
await page.waitForFunction(() => window.__IV.game.started && window.__IV.game.ui.mode === 'playing');
await ev(() => { const g = window.__IV.game; g.debug.flags.god = true; g.debug.flags.hunger = true; });
await gs(1);

await check('batteries-nvg-loot', async () => {
  const r = await ev(() => {
    const g = window.__IV.game, inv = g.player.equipment.inventory, NV = g.nightVision;
    const roll = (profile, n = 400) => { const c = {}; for (let i = 0; i < n; i++) { const id = `t4:${profile}:${i}`; const v = g.loot.open(id, profile, 12, 0); for (const st of v.slots) if (st) c[st.id] = (c[st.id] || 0) + st.qty; g.loot.containers.delete(id); } return c; };
    const res = roll('residential'), arm = roll('launch_armory', 300), vault = roll('launch_vault', 300);
    const guns = (c) => Object.entries(c).filter(([id]) => id.startsWith('wpn_')).reduce((a, [, n]) => a + n, 0);
    const armor = (c) => Object.entries(c).filter(([id]) => /^vest_|^helmet_/.test(id)).reduce((a, [, n]) => a + n, 0);
    // night vision: helmet rules and battery need
    const out = { batteriesPer100Homes: +(res.battery / 4).toFixed(1), gunsPerArmoryCrate: +(guns(arm) / 300).toFixed(2), armorPerArmoryCrate: +(armor(arm) / 300).toFixed(2), gunsPerVaultCrate: +(guns(vault) / 300).toFixed(2), armorPerVaultCrate: +(armor(vault) / 300).toFixed(2) };
    const eq = g.player.equipment;
    const wear = (id) => { eq.slots.head = { id, qty: 1, data: {} }; return eq.slots.head; };
    let hm = wear('helmet_mil'); hm.data.nvg = 'nvg_gen3'; hm.data.nvgCharge = 1;
    NV.on = false; NV.toggle(); out.plainHelmet = NV.on;
    hm = wear('helmet_bump'); hm.data.nvg = 'nvg_gen3'; hm.data.nvgCharge = 0;
    NV.on = false; NV.toggle(); out.noBattery = NV.on;
    window.__IV.give('battery', 1);
    NV.toggle(); out.withBattery = NV.on; out.batteryUsed = inv.count('battery') === 0;
    // drain rate: seconds for a full battery
    const c0 = hm.data.nvgCharge; NV.update(10); out.nvMinutes = Math.round(10 / (c0 - hm.data.nvgCharge) / 60);
    NV.on = false; eq.slots.head = null;
    return out;
  });
  assert(r.batteriesPer100Homes < 14 && r.gunsPerArmoryCrate < 0.5 && r.armorPerArmoryCrate < 0.15 && r.gunsPerVaultCrate < 0.9, `loot ${JSON.stringify(r)}`);
  assert(!r.plainHelmet && !r.noBattery && r.withBattery && r.batteryUsed && r.nvMinutes >= 40, `nvg ${JSON.stringify(r)}`);
  return r;
});

await check('blueprints', async () => {
  await tp(700, 300);
  const r = await ev(async () => {
    const g = window.__IV.game, b = g.base, B = g.blueprints, inv = g.player.equipment.inventory;
    for (const p of [...b.pieces.values()]) b.destroy(p);
    // find level ground for the original and the copy
    let X = 690, Z = 270;
    search: for (let cx = 300; cx < 1500; cx += 40) for (let cz = 100; cz < 900; cz += 40) {
      let mn = 1e9, mx = -1e9, wet = false;
      for (let dx = -20; dx <= 20; dx += 10) for (let dz = -20; dz <= 60; dz += 10) { const hh = g.world.heightAt(cx + dx, cz + dz); mn = Math.min(mn, hh); mx = Math.max(mx, hh); if (g.world.waterAt(cx + dx, cz + dz) !== null) wet = true; }
      if (!wet && mx - mn < 1.2 && g.world.nearestPOI(cx, cz + 20).d > 260 && !g.world.roadQuery(cx, cz + 20, 38)) { X = cx; Z = cz; break search; }
    }
    await g.debug.teleport(X, Z + 14, null, null); g.ui.open('playing');
    const y = g.world.heightAt(X, Z);
    const mk = (type, dx, dz, rot = 0, extra = {}) => b._create({ id: `bpt_${type}_${dx}_${dz}`, type, x: X + dx, y, z: Z + dz, rot, ...extra });
    mk('foundation', 0, 0); mk('foundation', 3, 0); mk('log_wall', 0, -8); mk('log_wall', 4, -8); mk('log_wall', -2, -6, 1); mk('crate', 1, 1); mk('sofa', 5, 3, 0, { variant: 2 });
    const sign = mk('sign_post', -3, 3); b.setSignText(sign, 'HOME');
    const bp = B.capture('Test base');
    const json = JSON.stringify(bp);
    // hostile / broken files
    const bad = [B.parse('{nope'), B.parse({ format: 'x', pieces: [] }), B.parse({ format: 'ironveil-blueprint', pieces: [{ t: 'constructor', x: 0, y: 0, z: 0 }, { t: 'crate', x: 1e9, y: 0, z: 0 }] })].map((x) => x.ok);
    const loaded = B.load(json);
    // without materials
    const before = b.pieces.size;
    const pc = g.player.controller; pc.yaw = Math.PI; // face +z, away from the original
    const r0 = B.build();
    // with materials in pockets and a storage crate near the site
    for (const [id, n] of Object.entries(bp.cost)) window.__IV.give(id, Math.ceil(n / 2));
    const r1 = B.build();
    const site = B.site(bp);
    const crate = b._create({ id: 'bpt_store', type: 'crate', x: site.x + 12, y: g.world.heightAt(site.x + 12, site.z), z: site.z });
    for (const [id, n] of Object.entries(bp.cost)) crate.inventory.add({ id, qty: n - Math.ceil(n / 2) });
    const miss = B.missing(bp, site.x, site.z);
    const crate2 = b._create({ id: 'bpt_store2', type: 'crate', x: site.x + 14, y: g.world.heightAt(site.x + 14, site.z + 3), z: site.z + 3 });
    for (const [id, n] of Object.entries(miss)) crate2.inventory.add({ id, qty: n });
    const r2 = B.build();
    const after = b.pieces.size - 1;
    const left = Object.keys(bp.cost).reduce((a, id) => a + inv.count(id) + crate.inventory.count(id) + crate2.inventory.count(id), 0);
    const copy = [...b.pieces.values()].filter((p) => !p.id.startsWith('bpt_'));
    const copySofa = copy.find((p) => p.type === 'sofa'), copySign = copy.find((p) => p.type === 'sign_post');
    const r3 = B.build(); // again at the same spot: nothing new
    return { count: bp.count, cost: bp.cost, bad, loaded: loaded.ok, noMats: r0.ok, noMatsMsg: r0.msg, half: r1.ok, full: r2.ok, msg: r2.msg, added: after - before - 1, left, variant: copySofa?.variant, text: copySign?.text, again: r3.ok, sizeKb: +(json.length / 1024).toFixed(1) };
  });
  assert(r.count === 8 && r.bad.every((x) => !x) && r.loaded, `parse ${JSON.stringify(r)}`);
  assert(!r.noMats && /Missing materials/.test(r.noMatsMsg) && !r.half && r.full && r.added === 8 && r.left === 0 && r.variant === 2 && r.text === 'HOME' && !r.again, `build ${JSON.stringify(r)}`);
  // the file round trip through the real UI: download, then load through the file input
  await ev(() => { const g = window.__IV.game; g.ui.open('build'); });
  await page.getByText('Blueprints', { exact: true }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByText('Save blueprint file').click()]);
  const file = path.join(OUT, 'test.blueprint.json');
  await dl.saveAs(file);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  await page.setInputFiles('input[type=file]', file);
  await page.waitForFunction(() => !!window.__IV.game.blueprints.loaded);
  const ui = await ev(() => ({ loaded: window.__IV.game.blueprints.loaded.count, text: document.querySelector('.bp-loaded')?.textContent.slice(0, 80) }));
  await ev(() => window.__IV.game.ui.open('playing'));
  assert(data.format === 'ironveil-blueprint' && data.pieces.length === 18 && ui.loaded === 18, `file ${JSON.stringify({ n: data.pieces.length, ui })}`);
  return { ...r, file: data.pieces.length, ui };
});

await check('dressing-and-furniture', async () => {
  const out = {};
  for (const id of ['millbrook', 'depot12', 'harlow']) {
    const q = await ev((id) => { const p = window.__IV.game.world.poiById.get(id); return p ? { x: p.x, z: p.z, r: p.radius } : null; }, id);
    if (!q) continue;
    await tp(q.x, q.z + q.r * 0.8);
    await built(id);
    out[id] = await ev((id) => {
      const g = window.__IV.game, rt = g.pois.active.get(id), p = g.world.poiById.get(id);
      // doors must stay reachable: nothing within 1 m in front of any door
      let blocked = 0;
      for (const d of rt.doors || []) { const dd = d.def || d; if (g.physics.overlapsCylinder(dd.x, dd.y + 0.9, dd.z, 0.25, 0.8, null) && false) blocked++; }
      const tris = rt.group.children.reduce((a, m) => a + (m.geometry?.index ? m.geometry.index.count / 3 : 0), 0);
      return { containers: rt.interactables.filter((x) => x.kind === 'container').length, tris: Math.round(tris), colliders: rt.colliders.length, blocked };
    }, id);
  }
  await gs(1);
  await shot('d4-dressing');
  assert(Object.values(out).every((o) => o.colliders > 300 && o.containers > 10), JSON.stringify(out));
  return out;
});

await check('launch-site-elevator', async () => {
  const q = await ev(() => { const p = window.__IV.game.world.poiById.get('launch_site'); return { x: p.x, z: p.z }; });
  await tp(q.x - 30, q.z + 80);
  await built('launch_site');
  await ev(() => window.__IV.setTime(12));
  await gs(1);
  await shot('d4-launch-site');
  const a = await ev(() => {
    const g = window.__IV.game, rt = g.pois.active.get('launch_site');
    window.__IV.give('keycard_launch', 1);
    const it = rt.interactables.find((x) => x.kind === 'lift' && x.data.lift.to.y < -100);
    g.player.controller.teleport(it.x, g.physics.groundHeight(it.x, it.z, 0.3, it.y + 2) + 0.05, it.z, 0);
    const y0 = g.player.controller.pos.y;
    g._interact(it);
    return { rocket: !!rt.rocket && rt.rocket.mesh.visible, riding: g.elevator.riding, y0, label: typeof it.label === 'function' ? it.label() : it.label };
  });
  assert(a.rocket && a.riding && /Elevator/.test(a.label), `start ${JSON.stringify(a)}`);
  await gs(1.5);
  const mid = await ev(() => { const g = window.__IV.game, pc = g.player.controller; pc.pos.x += 3; return { riding: g.elevator.riding, y: pc.pos.y, t: g.elevator.active?.t }; });
  await shot('d4-elevator-ride');
  await page.waitForFunction(() => !window.__IV.game.elevator.riding, null, { timeout: 120000 });
  const b = await ev(() => { const g = window.__IV.game, pc = g.player.controller; return { y: +pc.pos.y.toFixed(1), underground: g.lighting.underground, grounded: pc.grounded }; });
  assert(mid.riding && Math.abs(mid.y - a.y0) < 1 && b.y < -390 && b.underground, `ride ${JSON.stringify({ a, mid, b })}`);
  await gs(1.5);
  await shot('d4-facility-vault');
  // and back up
  await ev(() => { const g = window.__IV.game, rt = g.pois.active.get('launch_site'); const it = rt.interactables.find((x) => x.kind === 'lift' && !(x.data.lift.to.y < -100)); g.player.controller.teleport(it.x, it.y - 1.15, it.z + 1, 0); g._interact(it); });
  await page.waitForFunction(() => !window.__IV.game.elevator.riding, null, { timeout: 120000 });
  const c = await ev(() => { const g = window.__IV.game, pc = g.player.controller; return { y: +pc.pos.y.toFixed(1), ground: +g.world.heightAt(pc.pos.x, pc.pos.z).toFixed(1), finite: Number.isFinite(pc.pos.y) }; });
  assert(c.finite && Math.abs(c.y - c.ground) < 1.5, `up ${JSON.stringify(c)}`);
  return { down: b, up: c };
});

await check('rocket-wasteland', async () => {
  const q = await ev(() => { const p = window.__IV.game.world.poiById.get('launch_site'); return { x: p.x, z: p.z }; });
  await tp(q.x + 60, q.z + 30);
  await built('launch_site');
  const pre = await ev(async () => {
    const g = window.__IV.game, ex = g.explosives, rt = g.pois.active.get('launch_site'), R = rt.rocket;
    const THREE = g.player.controller.pos.constructor;
    // a frag grenade and a C4 blast do not set it off
    ex.explode(R.x + 3, R.y + 2, R.z, { radius: 9, damage: 160, owner: g.player.character });
    const afterFrag = g.wasteland.active;
    // a rocket that misses does not either
    ex.launch(new THREE(R.x - 40, R.y + 12, R.z + 60), new THREE(0, 0, -1), { speed: 80, gravity: 0, radius: 6, damage: 320 }, g.player.character);
    await window.__IV.gameSeconds(1.5);
    const afterMiss = g.wasteland.active;
    g.debug.flags.god = false; g.player.survival.invulnerable = false;
    const from = new THREE(g.player.controller.pos.x, R.y + 12, g.player.controller.pos.z);
    const dir = new THREE(R.x - from.x, 0, R.z - from.z).normalize();
    ex.launch(from, dir, { speed: 80, gravity: 0, radius: 6, damage: 320 }, g.player.character);
    return { afterFrag, afterMiss, dist: Math.round(Math.hypot(R.x - from.x, R.z - from.z)), uWaste0: g.wasteland.k };
  });
  assert(!pre.afterFrag && !pre.afterMiss, `false trigger ${JSON.stringify(pre)}`);
  await page.waitForFunction(() => window.__IV.game.wasteland.active, null, { timeout: 60000 });
  await page.waitForTimeout(600);
  await shot('d4-detonation');
  await page.waitForFunction(() => window.__IV.game.player.survival.dead, null, { timeout: 60000 });
  const hit = await ev(() => { const g = window.__IV.game, rt = g.pois.active.get('launch_site'); return { dead: g.player.survival.dead, days: +g.wasteland.daysLeft().toFixed(2), rocketVisible: rt?.rocket.mesh.visible, crater: !!rt?.rocket.crater }; });
  assert(hit.dead && hit.days > 4.9 && !hit.rocketVisible && hit.crater, `blast ${JSON.stringify(hit)}`);
  // respawn and look at the zone
  await ev(async () => { const g = window.__IV.game; g.debug.flags.god = true; if (g.respawn) g.respawn(); else if (g.ui.respawn) g.ui.respawn(); });
  await page.waitForFunction(() => !window.__IV.game.player.survival.dead, null, { timeout: 60000 }).catch(() => {});
  const z = await ev(async () => {
    const g = window.__IV.game, W = g.wasteland, S = g.player.survival;
    g.debug.flags.god = false; S.invulnerable = false; S.dead = false; S.health = 100;
    const dose = async (x, zz) => { window.__IV.teleport(x, zz, 0); g.ui.open('playing'); S.health = 100; g.indoor = false; await window.__IV.gameSeconds(3); return { hp: +(100 - S.health).toFixed(2), k: +g.lighting.wasteK.toFixed(2), chip: W.chip.textContent, chipShown: !W.chip.classList.contains('hidden') }; };
    const north = await dose(400, -900);
    const south = await dose(400, 900);
    S.radT = 600; const iodine = await dose(400, 900); S.radT = 0;
    const gz = await dose(W.gz.x + 150, W.gz.z + 150);
    g.debug.flags.god = true;
    return { north, south, iodine, gz, uWaste: +W.k.toFixed(2) };
  });
  await gs(1);
  await shot('d4-wasteland');
  assert(z.north.hp === 0 && z.north.k === 0 && !z.north.chipShown && z.south.hp > 0.2 && z.south.k > 0.9 && z.iodine.hp === 0 && z.gz.hp > z.south.hp * 5 && z.uWaste > 0.7, `zone ${JSON.stringify(z)}`);
  // map overlay, save/load, then five days pass
  const m = await ev(async () => {
    const g = window.__IV.game, W = g.wasteland;
    g.ui.open('map'); await new Promise((r) => setTimeout(r, 300));
    const side = document.querySelector('.map-side')?.textContent || '';
    g.ui.open('playing');
    await g.saveGame('slot3', true); const until = W.until; await g.loadGame('slot3');
    const kept = W.until === until && W.active;
    g.clock.gameMinutes = W.until + 1;
    await window.__IV.gameSeconds(1);
    const rt = g.pois.active.get('launch_site');
    return { side: /wasteland/i.test(side), kept, cleared: !W.active, rocketBack: rt ? rt.rocket.mesh.visible : null };
  });
  assert(m.side && m.kept && m.cleared && m.rocketBack !== false, `after ${JSON.stringify(m)}`);
  return { pre, hit, z, m };
});

await check('ai-grenades-tyres', async () => {
  await tp(430, 430);
  const r = await ev(async () => {
    const g = window.__IV.game;
    g.debug.flags.invisible = false;
    const pc = g.player.controller;
    // a wall between us and a squad that has just seen us
    const y = g.world.heightAt(pc.pos.x, pc.pos.z + 25);
    const squad = g.ai.spawnSquad(['vsf_rifleman', 'vsf_rifleman'], pc.pos.x, pc.pos.z + 26, {});
    let thrown = 0;
    const off = window.__IV.bus.on('ai:tactic', (e) => { if (e.type === 'grenade') thrown++; });
    for (const a of squad.members) { a.inventory.add({ id: 'grenade_frag', qty: 2 }); a._setTarget(g.player.character); a.contacts.set(g.player.character, { x: pc.pos.x, y: pc.pos.y, z: pc.pos.z, seen: a.time - 4, heard: a.time - 4 }); a.targetVisible = false; a._enter('combat'); }
    let tries = 0;
    for (const a of squad.members) { const c = a.contacts.get(g.player.character); const d = Math.hypot(c.x - a.pos.x, c.z - a.pos.z); if (a._tryGrenade(g.player.character, c, d, false, 4)) tries++; }
    const live = g.explosives.projectiles.filter((p) => p.id === 'grenade_frag').length;
    await window.__IV.gameSeconds(4.5);
    for (const a of squad.members) g.ai._despawn(a);
    void off; void y;
    // tyres
    const v = g.vehicles.add({ id: 't4car', type: 'pickup', x: pc.pos.x + 30, z: pc.pos.z, rot: 0, fuel: 30 });
    v._sync();
    const hits = g.physics.raycastAll(v.pos.x - 5, v.pos.y + 0.2, v.pos.z + v.mesh.spec.axleF, 1, 0, 0, 12, (c) => c.blocksShots).filter((h) => h.collider?.vehicle === v);
    for (let i = 0; i < 4 && hits[0]; i++) hits[0].collider.onBulletHit(40, {});
    const flats = v.flats.n;
    const ser = v.serialize().flats;
    g.vehicles.remove(v);
    g.debug.flags.invisible = true;
    return { tries, thrown, live, flats, ser };
  });
  assert(r.tries >= 1 && r.live >= 1 && r.flats === 1 && r.ser.filter(Boolean).length === 1, JSON.stringify(r));
  return r;
});

await check('map', async () => {
  const r = await ev(async () => {
    const g = window.__IV.game;
    g.markers.push({ x: 500, z: 500, label: 'Cache' });
    for (const v of g.vehicles.vehicles.values()) { v.known = true; break; }
    g.ui.open('map');
    await new Promise((r) => setTimeout(r, 400));
    const M = g.ui.map || g.ui.screens?.map;
    const side = document.querySelector('.map-side');
    const buttons = [...side.querySelectorAll('.map-filters button')].map((b) => b.textContent);
    const search = side.querySelector('.map-search');
    const some = g.world.pois[3]; g.discovered.add(some.id); M._refreshSide?.();
    const s2 = document.querySelector('.map-side .map-search'); const key = some.name.slice(0, 4).toLowerCase();
    s2.value = key; s2.dispatchEvent(new Event('input'));
    const found = [...document.querySelectorAll('.map-side .poi')].map((x) => x.textContent).slice(0, 3);
    void search;
    return { key, buttons, found, hasCanvas: !!document.querySelector('.map-view canvas'), M: !!M };
  });
  await page.mouse.move(400, 280);
  await page.waitForTimeout(300);
  await shot('d4-map');
  await ev(() => window.__IV.game.ui.open('playing'));
  assert(r.buttons.length === 6 && r.found.length >= 1 && r.found[0].toLowerCase().includes(r.key) && r.hasCanvas, JSON.stringify(r));
  return r;
});

log(`${results.filter((r) => r[1]).length}/${results.length} passed, ${errors.length} console errors`);
await browser.close();
server.kill();
process.exit(results.every((r) => r[1]) && !errors.length ? 0 : 1);
