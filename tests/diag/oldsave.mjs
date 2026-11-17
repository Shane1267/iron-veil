// Old-save compatibility: make a save in an older build, load it in the current build, and check the
// frame loop runs without errors. usage: node tests/diag/oldsave.mjs <old dist dir>
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OLD = path.resolve(process.argv[2]);
const PORT = 4193, BASE = `http://localhost:${PORT}/`;
const serve = async (dir) => { const s = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--outDir', path.join(dir, 'dist')], { cwd: ROOT, stdio: 'pipe', detached: true }); for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); } return s; };
const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
const page = await ctx.newPage();
page.setDefaultTimeout(600000);
await page.addInitScript(() => { if (!localStorage.getItem('ironveil.settings.v1')) localStorage.setItem('ironveil.settings.v1', JSON.stringify({ preset: 'chromebook' })); });
let errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 700)); });
page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 600)));
page.on('dialog', (d) => d.dismiss());
let srv = await serve(OLD); console.log('served old');
await page.goto(BASE);
await page.waitForFunction(() => window.__IV && window.__IV.game.ui.mode === 'menu');
console.log('menu'); await page.evaluate(() => window.__IV.game.newGame());
await page.waitForFunction(() => window.__IV.game.started && window.__IV.game.ui.mode === 'playing');
const made = await page.evaluate(async () => {
  const IV = window.__IV, g = IV.game; const out = {};
  await IV.gameSeconds(1);
  const tryDo = (n, f) => { try { out[n] = f() ?? true; } catch (e) { out[n] = 'ERR ' + e.message; } };
  for (const id of ['helmet_mil', 'nvg_gen3', 'nvg_gen1', 'flashlight', 'battery', 'wpn_ar', 'vest_plate', 'wall_wood', 'c4']) tryDo('give_' + id, () => IV.give(id, 1));
  tryDo('helmet', () => { g.player.equipment.slots.head = { id: 'helmet_mil', qty: 1, data: { nvg: 'nvg_gen3' } }; });
  await IV.gameSeconds(1);
  tryDo('marker', () => { g.markers.push({ x: 10, z: 10 }); });
  await g.saveGame('auto', true);
  return out;
});
console.log('OLD made', JSON.stringify(made), 'errors in old:', errs.length);
try { process.kill(-srv.pid); } catch {} await new Promise((r) => setTimeout(r, 2500));
errs = [];
srv = await serve(ROOT);
await page.goto(BASE);
await page.waitForFunction(() => window.__IV && window.__IV.game.ui.mode === 'menu');
const res = await page.evaluate(async () => {
  const IV = window.__IV, g = IV.game;
  let loadErr = null;
  try { await g.loadGame('auto'); } catch (e) { loadErr = e.message; }
  const t0 = performance.now(); while (!(g.started && g.ui.mode === 'playing') && performance.now() - t0 < 120000) await new Promise((r) => setTimeout(r, 300));
  const f0 = g.renderer.renderer.info.render.frame;
  await IV.gameSeconds(2);
  // exercise the UI screens a returning player opens
  const ui = {};
  for (const m of ['map', 'inventory', 'craft', 'playing']) { try { g.ui.open(m); await new Promise((r) => setTimeout(r, 1500)); ui[m] = 'ok'; } catch (e) { ui[m] = 'ERR ' + e.message; } }
  try { g.nightVision.toggle?.(); } catch (e) { ui.nv = 'ERR ' + e.message; }
  await IV.gameSeconds(1);
  return { loadErr, mode: g.ui.mode, started: g.started, frames: g.renderer.renderer.info.render.frame - f0, loopErrors: g._errors || 0, ui };
});
console.log('NEW build', await page.evaluate(() => [...document.scripts].map((x) => x.src).join(',')));
console.log('NEW result', JSON.stringify(res));
console.log('NEW errors', errs.length, JSON.stringify(await page.evaluate(() => [...(window.__IV.game.faults || new Map())].map(([k, v]) => [k, v.n, v.msg, v.stack]))), [...new Set(errs)].slice(0, 3).join('\n---\n'));
await browser.close(); try { process.kill(-srv.pid); } catch {}
