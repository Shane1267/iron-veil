// Browser test for the second suggestion pass: new guns and attachments, night vision,
// grenades / smoke / stun / demolition charges, the airfield key card and the Launch Site
// (gate, lift, underground facility, turrets, vault), base furniture and roleplay pieces.
// Usage: npm run build && node tests/e2e/update2.mjs   (ONLY=name,name to run some)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, 'tests/e2e/screenshots');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4186;
const CHROME = process.env.CHROME_PATH || (fs.existsSync('/opt/google/chrome/chrome') ? '/opt/google/chrome/chrome' : undefined);
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const log = (...a) => console.log('[update2]', ...a);
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe' });
const BASE = `http://localhost:${PORT}/`;
for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(400000);
await page.addInitScript((q) => localStorage.setItem('ironveil.settings.v1', JSON.stringify({ preset: q })), process.env.QUALITY || 'chromebook');
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); log('console.error', m.text().slice(0, 300)); } });
page.on('pageerror', (e) => { errors.push(String(e)); log('pageerror', String(e).slice(0, 300)); });
page.on('dialog', (d) => d.dismiss());
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = async (n) => { await page.screenshot({ path: path.join(OUT, `${n}.png`) }); log('screenshot', n); };
const gs = (s) => ev((s) => window.__IV.gameSeconds(s), s);
const results = [];
async function check(name, fn) {
  if (only.length && !only.includes(name)) return;
  const t0 = Date.now();
  // each stage starts with empty pockets (earlier stages hand out lots of items)
  await page.evaluate(() => { const inv = window.__IV.game.player.equipment.inventory; for (let i = 0; i < inv.slots.length; i++) inv.slots[i] = null; inv.version++; });
  try { const info = await fn(); results.push([name, true]); log('PASS', name, info ? JSON.stringify(info) : '', `${((Date.now() - t0) / 1000).toFixed(1)}s`); }
  catch (e) { results.push([name, false]); log('FAIL', name, e.message.split('\n')[0].slice(0, 400)); }
}
// teleport that waits for the area to stream in (uses the debug menu's helper)
const tp = (x, z, y) => ev(async ({ x, z, y }) => { const g = window.__IV.game; await g.debug.teleport(x, z, null, y ?? null); g.ui.open('playing'); }, { x, z, y });

await page.goto(BASE);
await page.waitForFunction(() => window.__IV && window.__IV.game.ui.mode === 'menu');
await ev(() => window.__IV.game.newGame());
await page.waitForFunction(() => window.__IV.game.started && window.__IV.game.ui.mode === 'playing');
await ev(() => { const g = window.__IV.game; g.debug.flags.god = true; g.debug.flags.hunger = true; });
await gs(1);

await check('guns-and-attachments', async () => {
  const r = await ev(() => {
    const g = window.__IV.game, inv = g.player.equipment.inventory;
    const ItemDBlike = (id) => id.startsWith('wpn_');
    const ids = ['wpn_px17', 'wpn_hornet', 'wpn_wasp', 'wpn_kresta', 'wpn_talon', 'wpn_halberd', 'wpn_frontier', 'wpn_goliath', 'wpn_riot', 'wpn_machete', 'wpn_crowbar'];
    const out = {};
    for (const id of ids) {
      for (let i = 0; i < inv.slots.length; i++) if (inv.slots[i] && ItemDBlike(inv.slots[i].id)) inv.slots[i] = null;
      g.weapons.select(null);
      window.__IV.equip(id);
      const st = g.weapons.stack;
      out[id] = !!(st && st.id === id && g.weapons.model);
    }
    // a fully kitted Kresta
    window.__IV.equip('wpn_kresta');
    const st = g.weapons.stack;
    st.data.attach = { optic: 'opt_holo', muzzle: 'brake_rifle', under: 'grip_angled', light: 'laser_combo', mag: 'mag_ext_762' };
    st.data.ammo = 40;
    g.weapons.select(null); g.weapons.select('primary');
    window.__IV.give('ammo_762', 120);
    return out;
  });
  const bad = Object.entries(r).filter(([, v]) => !v).map(([k]) => k);
  if (bad.length) throw new Error(`could not equip ${bad}`);
  await gs(1.2);
  const w = await ev(() => { const g = window.__IV.game; g.weapons.lightOn = true; const w = g.weapons.w; return { mag: w.magSize, hip: +w.spreadHip.toFixed(2), recoil: +w.recoil.v.toFixed(2), laser: !!g.weapons.model.laser }; });
  if (w.mag !== 40 || !w.laser) throw new Error(JSON.stringify(w));
  await gs(0.5);
  await shot('u01-kresta-kitted');
  return w;
});

await check('night-vision', async () => {
  await ev(() => {
    const g = window.__IV.game, eq = g.player.equipment;
    eq.slots.head = { id: 'helmet_mil', qty: 1, data: { nvg: 'nvg_gen3', nvgCharge: 1 } };
    window.__IV.setTime(0.5); window.__IV.weather('clear');
    g.weapons.lightOn = false;
  });
  await gs(1.5);
  await shot('u02-night-without-nv');
  await page.keyboard.press('KeyV');
  await gs(1.5);
  const r = await ev(() => ({ on: window.__IV.game.nightVision.on, gain: +window.__IV.game.lighting.nvGain.toFixed(2), status: window.__IV.game.nightVision.status }));
  if (!r.on || r.gain < 2) throw new Error(JSON.stringify(r));
  await shot('u03-night-with-nv');
  await page.keyboard.press('KeyV');
  await ev(() => window.__IV.setTime(13));
  return r;
});

await check('grenades', async () => {
  const r = await ev(() => {
    const g = window.__IV.game, pc = g.player.controller;
    g.debug.flags.invisible = true;
    const x = pc.pos.x - Math.sin(pc.yaw) * 22, z = pc.pos.z - Math.cos(pc.yaw) * 22;
    g.ai.spawnSquad(['wolf_raider', 'wolf_raider', 'wolf_raider'], x, z, {});
    const ag = g.ai.agents.slice(-3);
    window.__frag = ag.map((a) => a.id);
    // drop a frag at the middle of the group, already armed
    const c = ag.reduce((s, a) => ({ x: s.x + a.pos.x / 3, z: s.z + a.pos.z / 3 }), { x: 0, z: 0 });
    g.explosives.spawn('grenade_frag', new (pc.pos.constructor)(c.x, g.world.heightAt(c.x, c.z) + 1.5, c.z), new (pc.pos.constructor)(0, -1, 0), g.player.character);
    return { hp: ag.map((a) => Math.round(a.health)) };
  });
  await gs(4.5);
  const after = await ev(() => { const g = window.__IV.game; return g.ai.agents.filter((a) => window.__frag.includes(a.id)).map((a) => ({ alive: a.alive, hp: Math.round(a.health) })); });
  const hurt = after.filter((a) => !a.alive || a.hp < 90).length;
  if (hurt < 2) throw new Error(`frag hurt ${hurt}: ${JSON.stringify(after)}`);
  // smoke between the player and a point 20 m away blocks sight
  const sm = await ev(() => {
    const g = window.__IV.game, pc = g.player.controller;
    const x = pc.pos.x - Math.sin(pc.yaw) * 10, z = pc.pos.z - Math.cos(pc.yaw) * 10;
    const tx = pc.pos.x - Math.sin(pc.yaw) * 20, tz = pc.pos.z - Math.cos(pc.yaw) * 20;
    const y = g.world.heightAt(x, z);
    const before = g.physics.lineOfSight(pc.pos.x, pc.pos.y + 1.6, pc.pos.z, tx, g.world.heightAt(tx, tz) + 1.5, tz, null);
    g.explosives.spawn('grenade_smoke', new (pc.pos.constructor)(x, y + 0.5, z), new (pc.pos.constructor)(0, -1, 0), g.player.character);
    window.__smokeT = { tx, tz };
    return { before };
  });
  await gs(6);
  const sm2 = await ev(() => { const g = window.__IV.game, pc = g.player.controller, t = window.__smokeT; return { clouds: g.explosives.smokes.length, blocked: !g.physics.lineOfSight(pc.pos.x, pc.pos.y + 1.6, pc.pos.z, t.tx, g.world.heightAt(t.tx, t.tz) + 1.5, t.tz, null) }; });
  await shot('u04-smoke');
  if (!sm2.clouds || !sm2.blocked) throw new Error(`smoke ${JSON.stringify({ ...sm, ...sm2 })}`);
  // stun grenade blinds the survivors
  const st = await ev(() => {
    const g = window.__IV.game;
    const a = g.ai.agents.find((x) => x.alive);
    if (!a) return { skipped: true };
    g.explosives.spawn('grenade_flash', a.pos.clone().setY(a.pos.y + 1), new (a.pos.constructor)(0, -1, 0), g.player.character);
    window.__stunned = a.id;
    return { id: a.id };
  });
  await gs(2.2);
  const blind = st.skipped ? 'none left' : await ev(() => window.__IV.game.ai.agents.find((a) => a.id === window.__stunned)?.blindT || 0);
  await ev(() => { const g = window.__IV.game; for (const a of [...g.ai.agents]) g.ai._despawn(a); g.debug.flags.invisible = false; });
  return { frag: after, smoke: sm2, blind };
});

await check('demolition', async () => {
  const r = await ev(() => {
    const g = window.__IV.game, pc = g.player.controller;
    g.debug.flags.freeBuild = true;
    const x = pc.pos.x - Math.sin(pc.yaw) * 6, z = pc.pos.z - Math.cos(pc.yaw) * 6;
    const y = g.world.heightAt(x, z);
    const wall = g.base._create({ id: 'tw', type: 'wall_reinforced', x, y, z, rot: 0 });
    window.__IV.give('c4', 2); window.__IV.give('detonator', 1);
    // plant against the wall from 2 m away
    pc.teleport(x, y + 0.05, z + 2.2, 0); pc.pitch = -0.2;
    return { hp: wall.health };
  });
  await gs(0.4);
  const p = await ev(() => { const g = window.__IV.game; const r = g.explosives.plant(); if (r.ok) g.player.equipment.inventory.remove('c4', 1); return r; });
  if (!p.ok) throw new Error(p.msg);
  await ev(() => { const g = window.__IV.game, pc = g.player.controller; pc.teleport(pc.pos.x, pc.pos.y, pc.pos.z + 25, 0); });
  await gs(0.3);
  await ev(() => window.__IV.game.explosives.detonate());
  await gs(1.5);
  const after = await ev(() => ({ wall: !!window.__IV.game.base.pieces.get('tw') }));
  if (after.wall) throw new Error('reinforced wall survived a demolition charge');
  return { planted: p.msg, ...r, destroyed: true };
});

await check('airfield-keycard', async () => {
  const q = await ev(() => { const p = window.__IV.game.world.poiById.get('airfield'); return { x: p.x, z: p.z }; });
  await tp(q.x + 30, q.z - 32);
  await page.waitForFunction(() => window.__IV.game.pois.isBuilt('airfield'), null, { timeout: 300000 });
  const r = await ev(() => {
    const g = window.__IV.game;
    const it = g.interactables.byId.get('airfield:c0');
    const inv = g.loot.open('airfield:c0', it?.data?.profile, it?.data?.capacity, g.clock.gameMinutes);
    return { name: it?.data?.name, profile: it?.data?.profile, items: inv ? inv.slots.filter(Boolean).map((s) => s.id) : null };
  });
  if (r.profile !== 'keycard' || !r.items?.includes('keycard_launch')) throw new Error(JSON.stringify(r));
  await gs(1);
  await ev(() => { const g = window.__IV.game, pc = g.player.controller; pc.pitch = 0.02; pc.yaw = Math.PI * 0.25; });
  await gs(1);
  await shot('u05-airfield');
  return r;
});

await check('launch-site', async () => {
  const q = await ev(() => { const p = window.__IV.game.world.poiById.get('launch_site'); return { x: p.x, z: p.z }; });
  await tp(q.x + 6, q.z + 150);
  await page.waitForFunction(() => window.__IV.game.pois.isBuilt('launch_site'), null, { timeout: 300000 });
  await ev(() => { const g = window.__IV.game; g.debug.flags.invisible = true; g.player.controller.yaw = 0; g.player.controller.pitch = 0.05; });
  await gs(1.5);
  await shot('u06-launch-gate');
  const denied = await ev(() => { const g = window.__IV.game; const gt = g.pois.active.get('launch_site').gates[0]; g._interact({ kind: 'keygate', data: { gate: gt } }); return gt.open; });
  if (denied) throw new Error('gate opened without a card');
  await ev(() => { const g = window.__IV.game; window.__IV.give('keycard_launch', 1); const gt = g.pois.active.get('launch_site').gates[0]; g._interact({ kind: 'keygate', data: { gate: gt } }); });
  await gs(3);
  const open = await ev(() => { const gt = window.__IV.game.pois.active.get('launch_site').gates[0]; return { open: gt.open, collider: gt.collider.enabled }; });
  if (!open.open || open.collider) throw new Error(JSON.stringify(open));
  await shot('u07-launch-gate-open');
  // inside: look at the rocket
  await ev(() => { const g = window.__IV.game, p = g.world.poiById.get('launch_site'); g.player.controller.teleport(p.x + 20, g.physics.groundHeight(p.x + 20, p.z + 10, 0.4, 999) + 0.05, p.z + 10, Math.atan2(-(40), -(-65))); g.player.controller.pitch = 0.35; });
  await gs(1.5);
  await shot('u08-launch-rocket');
  // ride the lift down
  const lift = await ev(() => { const g = window.__IV.game; const rt = g.pois.active.get('launch_site'); const it = rt.interactables.find((x) => x.kind === 'lift' && x.data.lift.needsCard); g._interact(it); return !!it; });
  if (!lift) throw new Error('no lift');
  await page.waitForFunction(() => window.__IV.game.player.controller.pos.y < -300 && !window.__IV.game._riding, null, { timeout: 60000 });
  await gs(2);
  const under = await ev(() => { const g = window.__IV.game, pc = g.player.controller; return { y: +pc.pos.y.toFixed(2), turrets: g.turrets.list.length, underground: g.lighting.underground, grounded: pc.grounded }; });
  if (under.turrets < 4 || !under.underground) throw new Error(JSON.stringify(under));
  await gs(2);
  const yStable = await ev(() => window.__IV.game.player.controller.pos.y);
  if (Math.abs(yStable - under.y) > 0.3) throw new Error(`fell from ${under.y} to ${yStable}`);
  await shot('u09-underground-lift');
  // walk the main tunnel north: the turret there opens fire (god mode on)
  await ev(() => { const g = window.__IV.game, p = g.world.poiById.get('launch_site'); g.debug.flags.invisible = false; g.player.controller.teleport(p.x, -400 + 0.05, p.z + 45, 0); g.player.controller.pitch = 0.1; });
  const hitsBefore = await ev(() => window.__IV.game.player.stats?.hitsTaken || 0);
  await gs(4);
  await shot('u10-tunnel-turret');
  const fired = await ev(() => window.__IV.game.ballistics.stats.shots);
  // shoot the turret down
  const kill = await ev(() => { const g = window.__IV.game; const t = g.turrets.list.find((x) => x.alive && Math.abs(x.def.z - (g.world.poiById.get('launch_site').z + 30)) < 1); if (!t) return 'none'; g.turrets.damage(t, 999); return t.alive; });
  // vault: open the vault door with the card and search a crate
  const vault = await ev(() => {
    const g = window.__IV.game, p = g.world.poiById.get('launch_site');
    g.debug.flags.invisible = true;
    g.player.controller.teleport(p.x, -400 + 0.05, p.z - 78, 0);
    const gt = g.pois.active.get('launch_site').gates.find((x) => x.def.sink);
    g._interact({ kind: 'keygate', data: { gate: gt } });
    return { name: gt.def.name, open: gt.open };
  });
  await gs(3);
  await ev(() => { const g = window.__IV.game, p = g.world.poiById.get('launch_site'); g.player.controller.teleport(p.x, -400 + 0.05, p.z - 86, 0); g.player.controller.pitch = -0.15; });
  await gs(1);
  await shot('u11-vault');
  const loot = await ev(() => {
    const g = window.__IV.game;
    const rt = g.pois.active.get('launch_site');
    const c = rt.containers.find((x) => x.profile === 'launch_vault');
    const inv = g.loot.open(c.id, c.profile, c.capacity, g.clock.gameMinutes);
    const items = inv ? inv.slots.filter(Boolean).map((s) => s.id) : null;
    return { crate: c.name, items };
  });
  // lift back up
  await ev(() => { const g = window.__IV.game; const rt = g.pois.active.get('launch_site'); const it = rt.interactables.find((x) => x.kind === 'lift' && !x.data.lift.needsCard); g.player.controller.teleport(it.x, it.y - 1.15, it.z, 0); g._interact(it); });
  await page.waitForFunction(() => window.__IV.game.player.controller.pos.y > -100 && !window.__IV.game._riding, null, { timeout: 60000 });
  await ev(() => { window.__IV.game.debug.flags.invisible = false; });
  return { under, turretShots: fired, turretKilled: kill === false, vault, loot };
});

await check('base-roleplay', async () => {
  const r = await ev(() => {
    const g = window.__IV.game, pc = g.player.controller;
    // a quiet spot away from any garrison (earlier stages may leave the player at the Launch Site)
    g.player.survival.bleeding = 0; g.player.survival.health = 100;
    const x = 450, z = 450, y = g.world.heightAt(x, z);
    pc.teleport(x, y + 0.05, z + 6, 0);
    const mk = (id, type, dx, dz, rot = 0) => g.base._create({ id, type, x: x + dx, y: g.world.heightAt(x + dx, z + dz), z: z + dz, rot });
    mk('r_rug', 'rug', 0, 0); mk('r_table', 'table', 0, 0); const ch = mk('r_chair', 'chair', 0, 1.1, 2); mk('r_bed', 'bed', 3, -1);
    mk('r_shelf', 'bookshelf', -3, -1.5); mk('r_rack', 'weapon_rack', -3, 1.5, 1); const sg = mk('r_sign', 'sign_post', 0, 4, 0); mk('r_flag', 'flag', 4, 4, 1);
    mk('r_plant', 'plant_pot', 2, 1.5); mk('r_stove', 'stove', 3, 2.5); mk('r_planter', 'planter', -5, 4); mk('r_rain', 'rain_collector', 6, 0);
    g.base.setSignText(sg, 'IRON VEIL OUTPOST');
    g._interact({ kind: 'sit', data: { piece: ch } });
    return { seated: !!pc.seat, pieces: g.base.pieces.size };
  });
  await gs(1);
  const still = await ev(() => { const pc = window.__IV.game.player.controller; return { seated: !!pc.seat, y: +pc.pos.y.toFixed(2) }; });
  await ev(() => { const g = window.__IV.game, pc = g.player.controller; pc.seat = null; const ch = g.base.pieces.get('r_chair'); pc.teleport(ch.x + 1.5, ch.y + 0.05, ch.z + 6.5, 0); pc.pitch = -0.25; window.__IV.setTime(17.5); });
  await gs(1.5);
  await shot('u12-base-furniture');
  const sleep = await ev(() => { const g = window.__IV.game; window.__IV.setTime(22); const before = g.clock.gameMinutes; g._sleep(g.base.pieces.get('r_bed')); return before; });
  await gs(2.5);
  const slept = await ev((b) => { const g = window.__IV.game; return { hours: Math.round((g.clock.gameMinutes - b) / 60), time: g.clock.label }; }, sleep);
  const pick = await ev(() => { const g = window.__IV.game; g.debug.flags.freeBuild = false; const before = g.player.equipment.inventory.count('wood_plank'); const r = g.base.pickUp(g.base.pieces.get('r_table')); return { ok: r.ok, refund: g.player.equipment.inventory.count('wood_plank') - before, selected: g.base.selected }; });
  await ev(() => { const g = window.__IV.game; g.base.exit?.(); });
  if (!still.seated || slept.hours < 8 || !pick.ok || pick.refund !== 4) throw new Error(JSON.stringify({ r, still, slept, pick }));
  return { ...r, slept, pick };
});

await check('save-load', async () => {
  const r = await ev(async () => {
    const g = window.__IV.game;
    await g.saveGame('slot3', true);
    await g.loadGame('slot3');
    return { gates: [...g.openGates], turretsDown: g.turrets.destroyed.size, sign: [...g.base.pieces.values()].find((p) => p.type === 'sign_post')?.text, nvg: g.player.equipment.slots.head?.data?.nvg };
  });
  if (!r.gates.length || !r.sign) throw new Error(JSON.stringify(r));
  return r;
});

await browser.close();
server.kill();
const fails = results.filter((r) => !r[1]);
log(`${results.length - fails.length}/${results.length} passed, ${errors.length} console errors`);
if (errors.length) log(errors.slice(0, 8).join('\n'));
process.exit(fails.length || errors.length ? 1 : 0);
