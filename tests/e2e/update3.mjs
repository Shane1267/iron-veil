// Browser tests for the third update (vehicles, roads and bridges, raids, building, gear,
// SUNSHINE, helicopters, stamina, loot resets, sentries, new locations).
// Usage: npm run build && node tests/e2e/update3.mjs   (ONLY=name,name to run some)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, 'tests/e2e/screenshots');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4187;
const CHROME = process.env.CHROME_PATH || (fs.existsSync('/opt/google/chrome/chrome') ? '/opt/google/chrome/chrome' : undefined);
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const log = (...a) => console.log('[update3]', ...a);
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe' });
const BASE = `http://localhost:${PORT}/`;
for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(600000);
await page.addInitScript((q) => localStorage.setItem('ironveil.settings.v1', JSON.stringify({ preset: q })), process.env.QUALITY || 'chromebook');
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); log('console.error', m.text().slice(0, 300)); } });
page.on('pageerror', (e) => { errors.push(String(e)); log('pageerror', String(e).slice(0, 400)); });
page.on('dialog', (d) => d.dismiss());
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = async (n) => { await page.screenshot({ path: path.join(OUT, `${n}.png`) }); log('screenshot', n); };
const gs = (s) => ev((s) => window.__IV.gameSeconds(s), s);
const results = [];
async function check(name, fn) {
  if (only.length && !only.includes(name)) return;
  const t0 = Date.now();
  await page.evaluate(() => { const g = window.__IV.game; const inv = g.player.equipment.inventory; for (let i = 0; i < inv.slots.length; i++) inv.slots[i] = null; inv.version++; if (g.vehicles.current) g.vehicles.exit(g.player, true); g.player.survival.bleeding = 0; g.player.survival.health = 100; });
  try { const info = await fn(); results.push([name, true]); log('PASS', name, info ? JSON.stringify(info) : '', `${((Date.now() - t0) / 1000).toFixed(1)}s`); }
  catch (e) { results.push([name, false]); log('FAIL', name, e.message.split('\n')[0].slice(0, 600)); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const tp = (x, z, y) => ev(async ({ x, z, y }) => { const g = window.__IV.game; await g.debug.teleport(x, z, null, y ?? null); g.ui.open('playing'); }, { x, z, y });

await page.goto(BASE);
await page.waitForFunction(() => window.__IV && window.__IV.game.ui.mode === 'menu');
await ev(() => window.__IV.game.newGame());
await page.waitForFunction(() => window.__IV.game.started && window.__IV.game.ui.mode === 'playing');
await ev(() => { const g = window.__IV.game; g.debug.flags.god = true; g.debug.flags.hunger = true; });
await gs(1);

// ---------------------------------------------------------------- vehicles
await check('vehicles-drive-all', async () => {
  const ids = await ev(() => [...window.__IV.game.vehicles.vehicles.keys()]);
  const out = {};
  for (const id of ids) {
    const p = await ev((id) => { const v = window.__IV.game.vehicles.vehicles.get(id); return { x: v.pos.x, z: v.pos.z }; }, id);
    await tp(p.x + 6, p.z + 6);
    await gs(0.5);
    const r = await ev(async (id) => {
      const g = window.__IV.game, v = g.vehicles.vehicles.get(id);
      // give it what it needs, as a player would
      v.needs = []; v.fuel = Math.max(v.fuel, 20);
      const pc = g.player.controller;
      // stand at the driver's door
      const d = v.doors[0];
      const THREE = v.mesh.root.position.constructor;
      const pt = new THREE(d.side * (v.mesh.spec.W / 2 + 0.6), 0, (d.z0 + d.z1) / 2).applyMatrix4(v.mesh.root.matrixWorld);
      pc.teleport(pt.x, g.world.heightAt(pt.x, pt.z) + 0.05, pt.z, v.yaw);
      const res = g.vehicles.enter(v);
      const seat = g.vehicles.seatIndex;
      const start = { x: v.pos.x, z: v.pos.z };
      const eye = v.seatWorld(seat, 'eye');
      const hip = v.seatWorld(seat, 'hip');
      const roofY = v.pos.y + v.mesh.spec.roofY;
      return { ok: res.ok, msg: res.msg, seat, driver: !!v.seats[seat].driver, engine: v.engineOn, start, eyeAboveHip: +(eye.y - hip.y).toFixed(2), eyeBelowRoof: +(roofY - eye.y).toFixed(2), doorOpen: d.target };
    }, id);
    // drive: hold W for a few game seconds through the real input path
    await page.keyboard.down('KeyW');
    await gs(3);
    await page.keyboard.up('KeyW');
    const r2 = await ev((id) => { const g = window.__IV.game, v = g.vehicles.vehicles.get(id); return { speed: +v.speed.toFixed(2), x: v.pos.x, z: v.pos.z, steerWheel: +v.mesh.steeringSpin.rotation.z.toFixed(2), door: +v.doors[0].open.toFixed(2), camY: +g.renderer.camera.position.y.toFixed(2) }; }, id);
    const moved = Math.hypot(r2.x - r.start.x, r2.z - r.start.z);
    out[id] = { ...r, moved: +moved.toFixed(1), speed: r2.speed, doorAfter: r2.door };
    if (id === 'veh_farm_pickup' || id === 'veh_storage_apc' || id === 'veh_vesper_sedan' || id === 'veh_northwatch_truck') await shot(`v-${id}`);
    await ev(() => { const g = window.__IV.game; const v = g.vehicles.current; if (v) { v.speed = 0; g.vehicles.exit(g.player, true); } });
  }
  log('vehicles', JSON.stringify(out));
  const bad = Object.entries(out).filter(([, r]) => !r.ok || !r.driver || !r.engine || r.moved < 2 || r.eyeBelowRoof < 0.08 || r.eyeAboveHip < 0.5);
  assert(!bad.length, `vehicles failing: ${JSON.stringify(bad)}`);
  return { count: ids.length };
});

await check('vehicle-interior-glass-doors', async () => {
  await tp(420, 420);
  const r = await ev(() => {
    const g = window.__IV.game, pc = g.player.controller;
    const x = pc.pos.x + 8, z = pc.pos.z;
    const v = g.vehicles.add({ id: 'tglass', type: 'sedan', x, z, rot: 0, fuel: 30 });
    v._sync();
    // shoot the windscreen from the front with a rifle-sized round, three times then more
    const ws = v.windows.find((w) => w.key === 'ws');
    const front = { x: v.pos.x, y: v.pos.y + 1.15, z: v.pos.z - 6 };
    const shotAt = (dmg) => {
      const hits = g.physics.raycastAll(front.x, front.y, front.z, 0, 0, 1, 12, (c) => c.blocksShots);
      const h = hits.find((x) => x.collider && x.collider.vehicle === v);
      if (h) h.collider.onBulletHit(dmg, {});
      return h ? h.material : null;
    };
    const first = shotAt(40);
    const stage1 = ws.stage;
    shotAt(40);
    const stage2 = ws.stage;
    for (let i = 0; i < 4 && !ws.broken; i++) shotAt(40);
    const broken = ws.broken;
    const after = g.physics.raycastAll(front.x, front.y, front.z, 0, 0, 1, 12, (c) => c.blocksShots).filter((x) => x.collider?.vehicle === v).map((x) => x.material);
    // other windows untouched
    const others = v.windows.filter((w) => w !== ws).every((w) => !w.broken && w.stage === 0);
    // body panels block sight, glass does not
    const sightThroughSide = g.physics.lineOfSight(v.pos.x - 4, v.pos.y + 1.2, v.pos.z + 0.4, v.pos.x + 4, v.pos.y + 1.2, v.pos.z + 0.4);
    const sightThroughDoor = g.physics.lineOfSight(v.pos.x - 4, v.pos.y + 0.6, v.pos.z + 0.4, v.pos.x + 4, v.pos.y + 0.6, v.pos.z + 0.4);
    return { first, stage1, stage2, broken, after, others, sightThroughSide, sightThroughDoor, windows: v.windows.length, doors: v.doors.length, seats: v.seats.length };
  });
  assert(r.first === 'glass' && r.stage1 >= 1 && r.stage2 > r.stage1 && r.broken && r.after.filter((m) => m === 'glass').length === 1 && r.others, `glass: ${JSON.stringify(r)}`);
  assert(r.sightThroughSide && !r.sightThroughDoor, `sight: ${JSON.stringify(r)}`);
  // first-person view from the driver's seat
  await ev(() => { const g = window.__IV.game, v = g.vehicles.vehicles.get('tglass'); const pc = g.player.controller; pc.teleport(v.pos.x - 2, v.pos.y, v.pos.z - 0.6, 0); g.vehicles.enter(v); g.lighting && (g.lighting.debugHour = null); });
  await gs(1.2);
  await shot('v-sedan-cockpit');
  const d = await ev(() => { const g = window.__IV.game, v = g.vehicles.current; return { door: v.doors[0].open, target: v.doors[0].target, seat: g.vehicles.seatIndex, hands: v.mesh.driverRig.visible }; });
  await ev(() => { const g = window.__IV.game; g.vehicles.camYaw = 1.3; });
  await gs(0.3);
  await shot('v-sedan-cockpit-side');
  // switch seats with C
  await page.keyboard.press('KeyC');
  await gs(0.3);
  const s2 = await ev(() => ({ seat: window.__IV.game.vehicles.seatIndex, driver: !!window.__IV.game.vehicles.current.seats[window.__IV.game.vehicles.seatIndex].driver }));
  await ev(() => { const g = window.__IV.game; g.vehicles.exit(g.player, true); });
  await gs(0.3);
  const ex = await ev(() => { const v = window.__IV.game.vehicles.vehicles.get('tglass'); return { doorTarget: v.doors[1]?.target ?? v.doors[0].target }; });
  await shot('v-sedan-outside');
  return { ...r, d, s2, ex };
});

// ---------------------------------------------------------------- bridges
await check('bridges-traversable', async () => {
  const bridges = await ev(() => window.__IV.game.world.bridges.filter((b) => b.type !== 'rail').map((b) => ({ road: b.road.id, design: b.design, start: b.start, end: b.end, deck: b.deck })));
  const out = [];
  for (const b of bridges) {
    const a = await ev((b) => { const r = window.__IV.game.world.roads.find((x) => x.id === b.road); const i0 = Math.max(0, b.start - 3), i1 = Math.min(r.points.length - 1, b.end + 3); return { a: r.points[i0], b: r.points[i1], c: r.points[i0 + 1] }; }, b);
    await tp(a.a[0], a.a[1]);
    a.rid = b.road;
    const res = await ev(async ({ a, b, c, rid }) => {
      const g = window.__IV.game;
      const yaw = Math.atan2(-(c[0] - a[0]), -(c[1] - a[1]));
      const v = g.vehicles.add({ id: 'tbridge', type: 'pickup', x: a[0], z: a[1], rot: yaw, fuel: 50 });
      const dk = g.world.bridgeAt(a[0], a[1]); if (dk !== null) { v.pos.y = dk; v.bodyY = dk; }
      // drive along the road points with the AI route driver (real physics and collisions)
      const road = g.world.roads.find((x) => x.id === rid);
      let i0 = 0, best = 1e9; road.points.forEach((p, i) => { const d = Math.hypot(p[0] - a[0], p[1] - a[1]); if (d < best) { best = d; i0 = i; } });
      let i1 = 0; best = 1e9; road.points.forEach((p, i) => { const d = Math.hypot(p[0] - b[0], p[1] - b[1]); if (d < best) { best = d; i1 = i; } });
      const pts = []; for (let i = i0; i1 >= i0 ? i <= i1 : i >= i1; i += i1 >= i0 ? 1 : -1) pts.push({ x: road.points[i][0], z: road.points[i][1] });
      v.aiRoute = { points: pts, idx: 1, speed: 9 };
      let maxStep = 0, prevY = v.pos.y, t = 0;
      const trace = []; let nextTr = 0;
      while (t < 90 && !v.aiStopped) { g.vehicles._aiDrive(v, 1 / 30); const dy = Math.abs(v.pos.y - prevY); maxStep = Math.max(maxStep, dy); if (t >= nextTr) { nextTr += 1; trace.push([Math.round(v.pos.x), Math.round(v.pos.z), +v.pos.y.toFixed(1), g.world.bridgeAt(v.pos.x, v.pos.z) === null ? 0 : 1, +v.speed.toFixed(1), Math.round(v.health)]); } prevY = v.pos.y; t += 1 / 30; if (Math.abs(v.speed) < 0.1 && t > 5 && v.stuckT === undefined) v.stuckT = t; }
      const end = { x: v.pos.x, z: v.pos.z };
      const reached = Math.hypot(end.x - b[0], end.z - b[1]);
      g.vehicles.remove(v);
      return { reached: +reached.toFixed(1), maxStep: +maxStep.toFixed(2), t: +t.toFixed(1), trace: reached > 14 || maxStep > 0.6 ? trace : undefined, pts: reached > 14 ? pts.slice(0, 8).map((p) => [Math.round(p.x), Math.round(p.z)]) : undefined };
    }, a);
    out.push({ ...b, ...res });
  }
  log('bridges', JSON.stringify(out));
  const bad = out.filter((r) => r.reached > 14 || r.maxStep > 0.6);
  assert(!bad.length, `bridges failing: ${JSON.stringify(bad)}`);
  return { bridges: out.length };
});


// ---------------------------------------------------------------- stamina
await check('stamina', async () => {
  const r = await ev(() => {
    const g = window.__IV.game, S = g.player.survival;
    const run = (env, secs = 200) => { S.stamina = 100; S.exhausted = false; S.buffT = 0; S.hunger = 60; S.thirst = 60; let t = 0; while (S.stamina > 0.5 && t < secs) { S.update(0.05, { sprinting: true, moving: true, encumbrance: 0.3, ...env }); t += 0.05; } return +t.toFixed(1); };
    const base = run({});
    const heavy = run({ encumbrance: 0.95 });
    const boots = run({ gearStamina: 0.88 });
    const fit = run({ fitness: 10 });
    S.stamina = 100; S.buffT = 300; let t = 0; while (S.stamina > 0.5 && t < 200) { S.update(0.05, { sprinting: true, moving: true, encumbrance: 0.3 }); t += 0.05; }
    const buffed = +t.toFixed(1);
    // best case still runs out (no unlimited sprint)
    S.stamina = 100; S.buffT = 9999; t = 0; while (S.stamina > 0.5 && t < 300) { S.update(0.05, { sprinting: true, moving: true, encumbrance: 0, fitness: 10, gearStamina: 0.8 }); t += 0.05; }
    const best = +t.toFixed(1);
    S.buffT = 0; S.stamina = 0; S.staminaDelay = 0; t = 0; while (S.stamina < 99.5 && t < 60) { S.update(0.05, { encumbrance: 0.3 }); t += 0.05; }
    const regen = +t.toFixed(1);
    S.stamina = 100; S.exhausted = false; S.hunger = 100; S.thirst = 100;
    return { base, heavy, boots, fit, buffed, best, regen, feetSlot: 'feet' in g.player.equipment.slots || g.player.equipment.slots.feet === null };
  });
  assert(r.base > 11 && r.base < 16 && r.heavy < r.base && r.boots > r.base && r.fit > r.base && r.buffed > r.base && r.best < 60 && r.regen < 8, JSON.stringify(r));
  return r;
});

// ---------------------------------------------------------------- turret economy and loot rules
await check('turret-economy', async () => {
  const r = await ev(async () => {
    const g = window.__IV.game;
    const PARTS = ['mil_electronics', 'targeting_unit', 'control_board', 'servo_assembly', 'power_unit', 'turret_mount'];
    const count = (profile) => { let n = 0; for (let i = 0; i < 300; i++) { const id = `t:${profile}:${i}`; const inv = g.loot.open(id, profile, 12, 0); for (const st of inv.slots) if (st && PARTS.includes(st.id)) n++; g.loot.containers.delete(id); } return n; };
    const out = {};
    for (const p of ['residential', 'industrial', 'military', 'military_high', 'airfield', 'bunker_parts', 'bunker_armory']) out[p] = count(p);
    const def = [...g.base.pieces.values()][0]?.def;
    void def;
    return { out };
  });
  assert(r.out.residential === 0 && r.out.industrial === 0 && r.out.military === 0 && r.out.military_high === 0 && r.out.airfield > 0 && r.out.bunker_parts > 0, JSON.stringify(r));
  return r.out;
});

// ---------------------------------------------------------------- building
await check('building-compound', async () => {
  await tp(520, 380);
  const r = await ev(() => {
    const g = window.__IV.game, b = g.base;
    const X = 520, Z = 360, y = g.world.heightAt(X, Z);
    const mk = (id, type, dx, dz, rot = 0) => b._create({ id, type, x: X + dx, y: g.world.heightAt(X + dx, Z + dz), z: Z + dz, rot });
    const types = ['log_wall', 'log_wall_reinforced', 'log_corner', 'log_gateway', 'log_gate', 'gate_reinforced', 'mil_fence', 'blast_wall', 'log_platform', 'log_tower', 'sandbag_nest', 'barricade_hedgehog', 'barricade_spikes', 'storage_shed', 'floodlight', 'lantern_post',
      'sofa', 'armchair', 'cabinet', 'kitchen_counter', 'fridge', 'clock', 'curtains', 'painting', 'tv', 'floor_lamp', 'desk', 'computer', 'radio_set', 'mil_poster', 'wall_map', 'noticeboard', 'tool_rack', 'shelf_metal', 'weapon_display', 'med_cabinet', 'ammo_crates', 'workbench_mil', 'sofa_worn', 'cabinet_broken', 'crate_pile', 'hide_rug', 'water_barrel', 'drying_rack'];
    const made = [];
    types.forEach((t, i) => { const p = mk(`t_${t}`, t, (i % 8) * 6 - 21, -Math.floor(i / 8) * 6 - 10); if (p && p.mesh !== undefined) made.push(t); });
    // perimeter snapping: a wall, then one in line and one at a right angle
    const w0 = mk('snap0', 'log_wall', 0, 30, 0);
    const def = b.pieces.get('snap0').def;
    b.rot = 0;
    const inline = b._snapPerimeter({ x: X + 3.7, z: Z + 30.2 }, {}, def);
    b.rot = 1;
    const corner = b._snapPerimeter({ x: X + 2.1, z: Z + 28.2 }, {}, def);
    // gate: opens and closes, lockable; restyle; interactions
    const gate = b.pieces.get('t_log_gate');
    g._interact({ kind: 'basedoor', data: { piece: gate } });
    const gateOpen = gate.open;
    const sofa = b.pieces.get('t_sofa'); const v0 = sofa.variant; b.restyle(sofa);
    g._interact({ kind: 'piece_computer', data: { piece: b.pieces.get('t_computer') } });
    g._interact({ kind: 'piece_clock', data: { piece: b.pieces.get('t_clock') } });
    const lamp = b.pieces.get('t_floodlight'); const lit0 = lamp.lit; g._interact({ kind: 'toggleLight', data: { piece: lamp } });
    const station = g.nearStation ? g.nearStation('workbench_mil') : null;
    return { made: made.length, want: types.length, inline: inline && { x: inline.x, z: inline.z, snapped: inline.snapped, reason: inline.reason }, corner: corner && { x: corner.x, z: corner.z, snapped: corner.snapped, reason: corner.reason }, X, Z, gateOpen, restyled: sofa.variant !== v0, lampToggled: lamp.lit !== lit0, shedSlots: b.pieces.get('t_storage_shed').inventory?.slots.length, station, recipes: ['r_c4', 'r_breach', 'r_detonator'].map((id) => !!g.crafting?.recipes?.find?.((x) => x.id === id)) };
  });
  assert(r.made === r.want, `pieces ${JSON.stringify(r)}`);
  assert(r.inline?.snapped && Math.abs(r.inline.x - (r.X + 4)) < 0.01 && Math.abs(r.inline.z - (r.Z + 30)) < 0.01 && !r.inline.reason, `inline snap ${JSON.stringify(r)}`);
  assert(r.corner?.snapped && Math.abs(r.corner.x - (r.X + 2)) < 0.01 && Math.abs(Math.abs(r.corner.z - (r.Z + 30)) - 2) < 0.01, `corner snap ${JSON.stringify(r)}`);
  assert(r.gateOpen && r.restyled && r.lampToggled && r.shedSlots === 30, `interact ${JSON.stringify(r)}`);
  await ev(() => { const g = window.__IV.game, pc = g.player.controller; pc.teleport(520, g.world.heightAt(520, 372) + 0.05, 372, 0); pc.pitch = -0.05; window.__IV.setTime(13); });
  await gs(1.5);
  await shot('b-compound-pieces');
  return r;
});

// ---------------------------------------------------------------- explosives
await check('explosives', async () => {
  await tp(300, 520);
  const r = await ev(async () => {
    const g = window.__IV.game, b = g.base, ex = g.explosives;
    const THREE = g.player.controller.pos.constructor;
    const X = 300, Z = 500, y = g.world.heightAt(X, Z);
    const mk = (id, type, dx) => b._create({ id, type, x: X + dx, y: g.world.heightAt(X + dx, Z), z: Z, rot: 0 });
    const wall = mk('ex_wall', 'log_wall', 0), gate = mk('ex_gate', 'gate_reinforced', 20), blast = mk('ex_blast', 'blast_wall', 40);
    // C4 must be armed
    const c = ex.plantAt(new THREE(X, y + 1, Z + 0.4), { x: 0, y: 0, z: 1 }, { kind: 'c4', owner: g.player.character, player: true });
    const unarmed = ex.detonate();
    const arm = ex.interactCharge(c);
    const det = ex.detonate();
    await window.__IV.gameSeconds(0.6);
    const wallGone = !b.pieces.has('ex_wall');
    // breaching charge: timed, strong against gates
    const hp0 = gate.health;
    const bc = ex.plantAt(new THREE(X + 20, y + 1, Z + 0.4), { x: 0, y: 0, z: 1 }, { kind: 'breach', owner: g.player.character, armed: true, fuse: 10, player: true });
    await window.__IV.gameSeconds(5);
    const still = ex.charges.includes(bc);
    await window.__IV.gameSeconds(5.5);
    const gateDmg = hp0 - (b.pieces.get('ex_gate')?.health ?? 0);
    // defusing a raider-style charge
    const rc = ex.plantAt(new THREE(X + 40, y + 1, Z + 0.6), { x: 0, y: 0, z: 1 }, { kind: 'breach', owner: null, armed: true, fuse: 8 });
    const def = ex.interactCharge(rc);
    // rocket against a vehicle
    const v = g.vehicles.add({ id: 'ex_car', type: 'pickup', x: X + 60, z: Z + 30, rot: 0, fuel: 10 });
    const from = new THREE(X + 60, v.pos.y + 1.2, Z);
    ex.launch(from, new THREE(0, 0, 1), { speed: 80, gravity: 2.5, radius: 6, damage: 320, structure: 1500, vehicle: 1800 }, g.player.character);
    await window.__IV.gameSeconds(1.5);
    const carHp = v.health, glass = v.windows.filter((w) => w.broken).length;
    g.vehicles.remove(v);
    return { unarmed: unarmed.ok, arm: arm.msg, det: det.ok, wallGone, still, gateDmg, gateLeft: b.pieces.get('ex_gate')?.health ?? 0, def: def.msg, defused: !ex.charges.includes(rc), carHp, glass, rpg: !!g.weapons && true };
  });
  assert(!r.unarmed && r.det && r.wallGone, `c4 ${JSON.stringify(r)}`);
  assert(r.still && r.gateDmg > 800 && r.gateLeft > 0, `breach ${JSON.stringify(r)}`);
  assert(r.defused && r.carHp <= 0 && r.glass > 0, `defuse/rocket ${JSON.stringify(r)}`);
  // the launcher as a held weapon
  const w = await ev(async () => {
    const g = window.__IV.game;
    window.__IV.give('rocket_he', 2);
    window.__IV.equip('wpn_rpg');
    await window.__IV.gameSeconds(1.5);
    const info = g.weapons.hudInfo();
    return { held: info?.name || null };
  });
  await gs(0.5);
  await shot('x-rpg-held');
  await ev(() => window.__IV.game.weapons.select(null));
  return { ...r, ...w };
});

// ---------------------------------------------------------------- raid
await check('raid', async () => {
  await tp(450, 458);
  const setup = await ev(() => {
    const g = window.__IV.game, b = g.base;
    for (const p of [...b.pieces.values()]) if (!p.id.startsWith('t_sofa')) b.destroy(p);
    const X = 450, Z = 450;
    const mk = (id, type, dx, dz, rot = 0) => b._create({ id, type, x: X + dx, y: g.world.heightAt(X, Z), z: Z + dz, rot });
    // 16 x 16 m log compound with a gate, a crate inside
    for (let i = 0; i < 4; i++) { mk(`rw_n${i}`, 'log_wall', -6 + i * 4, -8, 0); if (i !== 1) mk(`rw_s${i}`, 'log_wall', -6 + i * 4, 8, 0); mk(`rw_w${i}`, 'log_wall', -8, -6 + i * 4, 1); mk(`rw_e${i}`, 'log_wall', 8, -6 + i * 4, 1); }
    mk('rw_gate', 'log_gate', -2, 8, 0).locked = true; // an unlocked gate is simply opened
    const crate = mk('rw_crate', 'crate', 0, 0);
    crate.inventory?.add({ id: 'bandage', qty: 3 });
    g.settings.apply({ raidWarningMinutes: 60 });
    const eligible = g.raids.eligible();
    const ok = g.raids.warn('military');
    const dup = g.raids.warn('small');
    g.raids.update(1.1);
    return { eligible, ok, dup, phase: g.raids.raid?.phase, left: g.raids.raid.attackAt - g.clock.gameMinutes, panel: g.raids.panel.textContent, enemies: g.ai.alive().filter((a) => a.role === 'raider').length };
  });
  assert(setup.eligible && setup.ok && !setup.dup && setup.phase === 'warning' && setup.enemies === 0 && /RAID WARNING/.test(setup.panel) && setup.left > 55, `warning ${JSON.stringify(setup)}`);
  await gs(0.5);
  await shot('r-raid-warning');
  // countdown ends
  await ev(() => { const g = window.__IV.game; g.debug.flags.invisible = false; g.raids.raid.attackAt = g.clock.gameMinutes; g.raids.t = 0; });
  await gs(1.5);
  const start = await ev(() => {
    const g = window.__IV.game, R = g.raids.raid;
    const rs = g.ai.alive().filter((a) => a.role === 'raider');
    return { phase: R.phase, n: rs.length, dists: rs.map((a) => Math.round(Math.hypot(a.pos.x - 450, a.pos.z - 450))), inside: rs.filter((a) => Math.abs(a.pos.x - 450) < 8 && Math.abs(a.pos.z - 450) < 8).length, charges: rs.reduce((n, a) => n + (a.charges || 0), 0), panel: g.raids.panel.textContent };
  });
  assert(start.phase === 'active' && start.n >= 3 && start.n <= 14 && start.inside === 0 && Math.min(...start.dists) >= 120, `spawn ${JSON.stringify(start)}`);
  // let them come: hide the player inside so they must breach
  await ev(() => { const g = window.__IV.game; window.__ivTac = []; window.__IV.bus.on('ai:tactic', (e) => window.__ivTac.push(e.type)); g.debug.flags.invisible = true; });
  let prog = null;
  for (let i = 0; i < 16; i++) {
    await gs(8);
    prog = await ev(() => {
      const g = window.__IV.game, R = g.raids.raid;
      const rs = g.ai.alive().filter((a) => a.role === 'raider');
      const walls = [...g.base.pieces.values()].filter((p) => p.id.startsWith('rw_'));
      return { status: R.status, phase: R.phase, n: rs.length, near: rs.length ? Math.round(Math.min(...rs.map((a) => Math.hypot(a.pos.x - 450, a.pos.z - 450)))) : -1, breaching: rs.filter((a) => a._breach).length, planted: g.explosives.charges.filter((c) => !c.player).length, pieces: walls.length, damaged: walls.filter((p) => p.health < p.maxHealth).length, breached: rs.some((a) => a.raidBreached) };
    });
    log('raid progress', JSON.stringify(prog));
    if (prog.pieces < 17 || prog.phase !== 'active') break;
  }
  await shot('r-raid-attack');
  assert(prog.near < 30 && (prog.pieces < 17 || prog.damaged > 0), `raiders did not attack the base: ${JSON.stringify(prog)}`);
  // defenders win: the raid ends, and it is not repeated straight away
  const end = await ev(async () => {
    const g = window.__IV.game;
    for (const a of g.ai.alive().filter((x) => x.role === 'raider')) a.onHit({ zone: 'head', base: 9999, weapon: null, distance: 5, mul: 1, shooter: g.player.character, dir: { x: 0, y: 0, z: 1 } });
    await window.__IV.gameSeconds(2.5);
    const R = g.raids.raid;
    return { phase: R?.phase, status: R?.status, next: g.raids.nextAt - g.clock.gameMinutes, history: g.raids.history.length };
  });
  assert(end.phase === 'over' && /repelled/i.test(end.status) && end.next > 1440 * 2.9 && end.history === 1, `end ${JSON.stringify(end)}`);
  return { setup: { left: Math.round(setup.left) }, start, prog, end };
});

// ---------------------------------------------------------------- loot resets
await check('loot-reset', async () => {
  const q = await ev(() => { const p = window.__IV.game.world.poiById.get('airfield'); return { x: p.x, z: p.z }; });
  await tp(q.x, q.z + 40);
  await page.waitForFunction(() => window.__IV.game.pois.isBuilt('airfield'), null, { timeout: 300000 });
  const r = await ev(() => {
    const g = window.__IV.game, LR = g.lootResets;
    const notes = []; const off = window.__IV.bus.on('notify', (e) => notes.push(e.text));
    const rt = g.pois.active.get('airfield');
    const its = rt.interactables.filter((x) => x.kind === 'container');
    const it = its[0];
    const inv = g.loot.open(it.data.containerId, it.data.profile, it.data.capacity, g.clock.gameMinutes);
    const before = inv.usedSlots();
    for (let i = 0; i < inv.slots.length; i++) inv.slots[i] = null;
    LR.update(6); // registers the clocks
    const logged0 = LR.log.length;
    LR.t = 0; LR.update(6); // not due yet
    const early = LR.log.length - logged0;
    LR.last.airfield = g.clock.gameMinutes - 24 * 60 - 1; LR.last.storage = g.clock.gameMinutes - 1;
    LR.t = 0; LR.update(6);
    const after = g.loot.get(it.data.containerId).usedSlots();
    const first = LR.log.length - logged0;
    LR.t = 0; LR.update(6); LR.t = 0; LR.update(6);
    const dup = LR.log.length - logged0;
    return { containers: its.length, before, after, early, first, dup, notes: notes.filter((n) => /LOOT RESET/.test(n)), major: Object.keys(LR.last) };
  });
  assert(r.containers > 6 && r.after > 0 && r.early === 0 && r.first === 1 && r.dup === 1, JSON.stringify(r));
  await gs(1);
  await shot('l-airfield-expanded');
  return r;
});

// ---------------------------------------------------------------- helicopters
await check('helicopter', async () => {
  const q = await ev(() => { const p = window.__IV.game.world.poiById.get('airfield'); return { x: p.x, z: p.z }; });
  const r = await ev(async () => {
    const g = window.__IV.game, inv = g.player.equipment.inventory;
    const v = g.helis.spawnAirfieldHeli(true);
    const again = g.helis.spawnAirfieldHeli(true);
    const pc = g.player.controller;
    pc.teleport(v.pos.x - 3, v.pos.y + 0.05, v.pos.z, 0);
    const needs0 = [...v.needs];
    const cant = v.canStart();
    // parts need a wrench
    window.__IV.give('rotor_assembly', 1);
    const noTool = g.vehicles.service(v, inv);
    for (const id of ['tool_wrench', 'turbine_parts', 'avionics', 'fuel_system_kit', 'car_battery', 'repair_kit', 'repair_kit']) window.__IV.give(id, 1);
    const msgs = [];
    for (let i = 0; i < 8 && (v.needs.length || v.health < v.t.health * 0.9); i++) msgs.push(g.vehicles.service(v, inv).msg);
    v.fuel = 60;
    const res = g.vehicles.enter(v);
    return { id: v.id, again: !!again, needs0, cant, noTool: noTool.msg, msgs, entered: res.ok, driver: g.vehicles.current?.seats[g.vehicles.seatIndex].driver, seats: v.seats.length, engine: v.engineOn, y0: v.pos.y, health: Math.round(v.health) };
  });
  assert(!r.again && r.needs0.length >= 5 && r.cant && /needs a/i.test(r.noTool) && r.entered && r.driver && r.engine && r.seats === 4, `repair ${JSON.stringify(r)}`);
  await gs(1);
  await shot('h-heli-cockpit');
  // spool up, take off
  await page.keyboard.down('Space');
  await gs(4);
  const early = await ev(() => { const v = window.__IV.game.vehicles.current; return { rpm: +v.rpm.toFixed(2), alt: +(v.pos.y - window.__IV.game.world.heightAt(v.pos.x, v.pos.z)).toFixed(1) }; });
  await gs(10);
  await page.keyboard.up('Space');
  const up = await ev(() => { const g = window.__IV.game, v = g.vehicles.current; return { rpm: +v.rpm.toFixed(2), alt: +(v.pos.y - g.world.heightAt(v.pos.x, v.pos.z)).toFixed(1), x: v.pos.x, z: v.pos.z, yaw: v.yaw, fuel: v.fuel }; });
  assert(early.alt < 1 && up.rpm >= 0.99 && up.alt > 8, `take-off ${JSON.stringify({ early, up })}`);
  // forward flight and a turn
  await page.keyboard.down('KeyW');
  await gs(5);
  await page.keyboard.down('KeyD');
  await gs(2);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');
  const fwd = await ev(() => { const g = window.__IV.game, v = g.vehicles.current; return { x: v.pos.x, z: v.pos.z, yaw: v.yaw, speed: +v.speed.toFixed(1), alt: +(v.pos.y - g.world.heightAt(v.pos.x, v.pos.z)).toFixed(1), exitBlocked: !g.vehicles.exit(g.player) }; });
  const moved = Math.hypot(fwd.x - up.x, fwd.z - up.z);
  assert(moved > 40 && Math.abs(fwd.yaw - up.yaw) > 0.5 && fwd.exitBlocked, `flight ${JSON.stringify({ fwd, moved })}`);
  await shot('h-heli-flying');
  // stop, descend and land
  await gs(5);
  await page.keyboard.down('ShiftLeft');
  let land = null;
  for (let i = 0; i < 12; i++) { await gs(3); land = await ev(() => { const g = window.__IV.game, v = g.vehicles.current; return { airborne: v.airborne, alt: +(v.pos.y - g.world.heightAt(v.pos.x, v.pos.z)).toFixed(1), health: Math.round(v.health), vy: +v.vy.toFixed(1), speed: +v.speed.toFixed(1), fuel: v.fuel }; }); if (!land.airborne) break; }
  await page.keyboard.up('ShiftLeft');
  assert(!land.airborne && land.health > 0 && land.fuel < up.fuel, `landing ${JSON.stringify(land)}`);
  // crash behaviour: a spare helicopter dropped from 60 m
  const crash = await ev(async () => {
    const g = window.__IV.game; const cur = g.vehicles.current; cur.speed = 0; g.vehicles.exit(g.player, true);
    const out = { exitOk: !g.vehicles.current };
    const v = g.vehicles.add({ id: 'heli_drop', type: 'heli', x: cur.pos.x + 40, z: cur.pos.z, rot: 0, fuel: 10 });
    v.pos.y += 60; v.bodyY = v.pos.y; v.airborne = true;
    await window.__IV.gameSeconds(6);
    out.dropDestroyed = v.destroyed; out.dropHealth = Math.round(v.health);
    g.vehicles.remove(v);
    // crash site event
    const s = g.helis.spawnCrash(g.player.controller.pos);
    g.helis.t = 0; g.helis.update(0.1);
    out.site = s && { d: Math.round(Math.hypot(s.x - g.player.controller.pos.x, s.z - g.player.controller.pos.z)), built: !!s.built, containers: s.inter?.length };
    if (s) { window.__IV.teleport(s.x + 9, s.z + 9, Math.atan2(9, 9)); out.loot = s.inter.map((it) => g.loot.open(it.data.containerId, it.data.profile, it.data.capacity, 0).slots.filter(Boolean).map((x) => x.id)); }
    return out;
  });
  await gs(2);
  await shot('h-crash-site');
  assert(crash.exitOk && crash.dropDestroyed && crash.site?.built && crash.site.containers === 3 && crash.loot.flat().length > 3, `crash ${JSON.stringify(crash)}`);
  return { repair: r.msgs, up, moved: Math.round(moved), land, crash };
});

// ---------------------------------------------------------------- bunker and SUNSHINE
await check('bunker-sunshine', async () => {
  const q = await ev(() => { const p = window.__IV.game.world.poiById.get('storage'); return { x: p.x, z: p.z }; });
  await tp(q.x - 30, q.z + 30);
  await page.waitForFunction(() => window.__IV.game.pois.isBuilt('storage'), null, { timeout: 300000 });
  await ev(() => { window.__IV.game.debug.flags.invisible = true; });
  const lift = await ev(() => { const g = window.__IV.game; const rt = g.pois.active.get('storage'); const it = rt.interactables.find((x) => x.kind === 'lift' && x.data.lift.to.y < -100); if (it) g._interact(it); return !!it; });
  assert(lift, 'no lift down');
  await page.waitForFunction(() => window.__IV.game.player.controller.pos.y < -300 && !window.__IV.game._riding, null, { timeout: 60000 });
  await gs(2);
  await shot('s-bunker-lift-room');
  const a = await ev(() => {
    const g = window.__IV.game, rt = g.pois.active.get('storage'), pc = g.player.controller;
    const gates = rt.gates.map((x) => ({ name: x.def.name, breach: x.def.breach, card: x.def.card }));
    const arm = rt.gates.find((x) => x.def.card === 'keycard_bunker'), blast = rt.gates.find((x) => x.def.breach);
    g._interact({ kind: 'keygate', data: { gate: arm } });
    const armDenied = !arm.open;
    window.__IV.give('keycard_launch', 1);
    g._interact({ kind: 'keygate', data: { gate: arm } });
    const wrongCard = !arm.open;
    window.__IV.give('keycard_bunker', 1);
    g._interact({ kind: 'keygate', data: { gate: arm } });
    g._interact({ kind: 'keygate', data: { gate: blast } });
    const blastCard = blast.open;
    // a grenade does not open it; C4 does
    const bd = blast.def;
    g.explosives.explode(bd.x, bd.y + 1.2, bd.z - 0.6, { radius: 9, damage: 160, owner: g.player.character });
    const afterFrag = blast.open;
    const containers = rt.interactables.filter((x) => x.kind === 'container');
    return { y: +pc.pos.y.toFixed(1), gates, armDenied, wrongCard, armOpen: arm.open, blastCard, afterFrag, containers: containers.length, turrets: g.turrets.list.filter((t) => t.y < -300).length, blast: { x: bd.x, y: bd.y, z: bd.z } };
  });
  assert(a.y < -390 && a.armDenied && a.wrongCard && a.armOpen && !a.blastCard && !a.afterFrag && a.containers >= 30, `bunker ${JSON.stringify(a)}`);
  await ev((b) => { const g = window.__IV.game; g.player.controller.teleport(b.x, b.y + 0.05, b.z - 7, 0); g.player.controller.pitch = 0; }, a.blast);
  await gs(1.5);
  await shot('s-containment-door');
  const b = await ev(async (bl) => {
    const g = window.__IV.game, rt = g.pois.active.get('storage'), ex = g.explosives;
    const THREE = g.player.controller.pos.constructor;
    const blast = rt.gates.find((x) => x.def.breach);
    const c = ex.plantAt(new THREE(bl.x, bl.y + 1.2, bl.z - 0.35), { x: 0, y: 0, z: -1 }, { kind: 'c4', owner: g.player.character, player: true });
    ex.interactCharge(c);
    g.player.controller.teleport(bl.x, bl.y + 0.05, bl.z - 30, 0);
    const det = ex.detonate();
    await window.__IV.gameSeconds(0.8);
    const it = rt.interactables.find((x) => x.kind === 'container' && x.data.profile === 'sunshine_vault');
    const inv = g.loot.open(it.data.containerId, it.data.profile, it.data.capacity, g.clock.gameMinutes);
    const has = inv.count('sunshine');
    const note = rt.interactables.find((x) => x.kind === 'container' && x.data.profile === 'bunker_note');
    return { det: det.ok, open: blast.open, has, items: inv.slots.filter(Boolean).map((s) => s.id), note: !!note, saved: g.openGates.has(blast.id), recipe: !!g.crafting?.recipes?.find?.((r) => r.out === 'sunshine') };
  }, a.blast);
  assert(b.det && b.open && b.has === 1 && b.saved && !b.recipe, `sunshine room ${JSON.stringify(b)}`);
  await ev((bl) => { const g = window.__IV.game; g.player.controller.teleport(bl.x, bl.y + 0.05, bl.z + 2, 0); g.player.controller.pitch = -0.1; }, a.blast);
  await gs(1.5);
  await shot('s-sunshine-room');
  // take it to the surface at night and set it off
  await tp(q.x + 200, q.z + 260);
  await ev(() => { window.__IV.setTime(1); });
  await gs(1.5);
  await shot('s-night-before');
  const act = await ev(async () => {
    const g = window.__IV.game, inv = g.player.equipment.inventory, S = g.sunshine;
    window.__IV.give('sunshine', 1);
    const stack = inv.slots.find((s) => s && s.id === 'sunshine');
    const two = window.__IV.give('sunshine', 1); // a second one must not merge into a stack
    const stacks = inv.slots.filter((s) => s && s.id === 'sunshine').map((s) => s.qty);
    inv.remove('sunshine', 1);
    const fps0 = g.renderer.fps;
    void stack; void two;
    S.activate(inv);
    const left = inv.count('sunshine');
    await window.__IV.gameSeconds(3.3);
    return { stacks, left, state: S.state, light: Math.round(S.light.intensity), range: S.light.distance, k: +g.lighting.sunshineK.toFixed(2), hemi: +g.lighting.hemi.intensity.toFixed(1), fps0 };
  });
  assert(act.left === 0 && act.state === 'burning' && act.light > 5000 && act.range === 100 && act.k > 0.8 && Math.max(...act.stacks) === 1, `activate ${JSON.stringify(act)}`);
  await gs(1);
  await shot('s-sunshine-burning');
  // at 60 m it still lights the ground; beyond 100 m it does not
  const far = await ev(async () => {
    const g = window.__IV.game, S = g.sunshine, pc = g.player.controller;
    const at = async (d) => { window.__IV.teleport(S.pos.x + d, S.pos.z, Math.PI / 2); await window.__IV.gameSeconds(0.4); return +g.lighting.sunshineK.toFixed(2); };
    const k60 = await at(60), k120 = await at(120);
    window.__IV.teleport(S.pos.x + 12, S.pos.z, Math.PI / 2);
    return { k60, k120, fps: g.renderer.fps, tBurn: +S.t.toFixed(1) };
  });
  assert(far.k60 > 0.2 && far.k120 === 0, `radius ${JSON.stringify(far)}`);
  // burn to the end: exactly one minute of light, then dead for good
  const mid = await ev(async () => { const S = window.__IV.game.sunshine; const left = 59.0 - S.t; await window.__IV.gameSeconds(left); return { t: +S.t.toFixed(2), state: S.state }; });
  assert(mid.state === 'burning', `should still burn just before 60 s: ${JSON.stringify(mid)}`);
  const done = await ev(async () => {
    const g = window.__IV.game, S = g.sunshine, inv = g.player.equipment.inventory;
    await window.__IV.gameSeconds(1.6);
    const again = S.activate(inv);
    return { state: S.state, burned: S.burned, light: S.light.intensity, k: g.lighting.sunshineK, again: again.ok, inv: inv.count('sunshine') };
  });
  assert(done.state === 'spent' && done.burned === 60 && done.light === 0 && done.k === 0 && !done.again && done.inv === 0, `burn-out ${JSON.stringify(done)}`);
  await gs(1);
  await shot('s-sunshine-spent');
  // it returns only with the bunker loot reset
  const reset = await ev(() => {
    const g = window.__IV.game, LR = g.lootResets;
    const rtId = [...g.loot.containers.keys()].find((id) => g.loot.containers.get(id).profile === 'sunshine_vault');
    const c = g.loot.containers.get(rtId);
    for (let i = 0; i < c.inv.slots.length; i++) c.inv.slots[i] = null;
    const reopened = g.loot.open(rtId, 'sunshine_vault', 6, g.clock.gameMinutes + 5000).count('sunshine');
    LR.last.storage = g.clock.gameMinutes - 48 * 60 - 1; LR.t = 0; LR.update(6);
    return { reopened, afterReset: g.loot.get(rtId).count('sunshine') };
  });
  assert(reset.reopened === 0 && reset.afterReset === 1, `reset ${JSON.stringify(reset)}`);
  return { bunker: { containers: a.containers, turrets: a.turrets, gates: a.gates.length }, room: b.items, act, far, done, reset };
});

// ---------------------------------------------------------------- new locations
await check('new-locations', async () => {
  const ids = ['crossway', 'ashby', 'kettle_farm', 'gw_outpost', 'depot12', 'harlow', 'rail_yard_maint', 'road_post', 'motor_pool', 'container_yard', 'lowmere', 'redstone_fuel', 'hunters_rest', 'relay_tower', 'ih_lookout', 'holdout'];
  const out = {};
  await ev(() => { window.__IV.game.debug.flags.invisible = true; window.__IV.setTime(12); });
  for (const id of ids) {
    const q = await ev((id) => { const p = window.__IV.game.world.poiById.get(id); return p ? { x: p.x, z: p.z, r: p.radius } : null; }, id);
    assert(q, `no POI ${id}`);
    await tp(q.x, q.z + q.r * 0.9);
    await page.waitForFunction((id) => window.__IV.game.pois.isBuilt(id), id, { timeout: 300000 });
    out[id] = await ev((id) => {
      const g = window.__IV.game, rt = g.pois.active.get(id), p = g.world.poiById.get(id);
      const pc = g.player.controller; pc.yaw = 0; pc.pitch = 0.02;
      // buildings must sit on the ground: the pad may not slope more than a step under any building
      let worst = 0;
      for (const b of rt.buildings || []) { const hs = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => g.world.heightAt(b.x + sx * b.w / 2, b.z + sz * b.d / 2)); worst = Math.max(worst, Math.max(...hs) - Math.min(...hs)); }
      return { buildings: (rt.buildings || []).length, containers: rt.interactables.filter((x) => x.kind === 'container').length, slope: +worst.toFixed(2), water: g.world.hasWaterIn(p.x - 20, p.z - 20, p.x + 20, p.z + 20) };
    }, id);
    await gs(1);
    if (['crossway', 'depot12', 'harlow', 'lowmere', 'holdout', 'kettle_farm'].includes(id)) await shot(`p-${id}`);
  }
  log('locations', JSON.stringify(out));
  const bad = Object.entries(out).filter(([id, r]) => r.containers < 1 || r.water || r.slope > 0.6 || (r.buildings < 1 && !['relay_tower'].includes(id)));
  assert(!bad.length, `bad locations ${JSON.stringify(bad)}`);
  return { count: ids.length };
});

// ---------------------------------------------------------------- save / load
await check('save-load', async () => {
  const r = await ev(async () => {
    const g = window.__IV.game;
    const v = [...g.vehicles.vehicles.values()].find((x) => !x.t.flying && !x.destroyed);
    v._shatter(v.windows[0], true);
    g.raids.schedule();
    const before = { next: g.raids.nextAt, heli: g.vehicles.vehicles.has('veh_airfield_heli'), sites: g.helis.sites.length, resets: { ...g.lootResets.epoch }, vid: v.id };
    await g.saveGame('slot3', true);
    await g.loadGame('slot3');
    const v2 = g.vehicles.vehicles.get(before.vid);
    return { before, next: g.raids.nextAt, heli: g.vehicles.vehicles.has('veh_airfield_heli'), sites: g.helis.sites.length, resets: g.lootResets.epoch, glass: v2?.windows[0].broken, pieces: g.base.pieces.size, variantKept: [...g.base.pieces.values()].find((p) => p.id === 't_sofa')?.variant };
  });
  assert(r.next === r.before.next && r.heli === r.before.heli && r.sites === r.before.sites && r.glass && JSON.stringify(r.resets) === JSON.stringify(r.before.resets), JSON.stringify(r));
  return r;
});

log(`${results.filter((r) => r[1]).length}/${results.length} passed, ${errors.length} console errors`);
await browser.close();
server.kill();
process.exit(results.every((r) => r[1]) && !errors.length ? 0 : 1);
