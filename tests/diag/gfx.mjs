// Graphics diagnostic: boots the built game at a given preset / GL backend and reports shader errors,
// sampler counts per program and whether the frame is black.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 4191;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe', detached: true });
const BASE = `http://localhost:${PORT}/`;
for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const args = (process.env.GLARGS || '--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist').split(' ');
const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true, args });
const page = await (await browser.newContext({ viewport: { width: 480, height: 270 } })).newPage();
page.setDefaultTimeout(600000);
const Q = process.env.QUALITY || '';
if (Q) await page.addInitScript((q) => localStorage.setItem('ironveil.settings.v1', JSON.stringify(q.startsWith('{') ? JSON.parse(q) : { preset: q })), Q);
if (process.env.INIT) await page.addInitScript(process.env.INIT);
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || /THREE|WebGL|shader/i.test(m.text())) errs.push(m.text().slice(0, 1500)); });
page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 600)));
await page.goto(BASE);
await page.waitForFunction(() => window.__IV && window.__IV.game.ui.mode === 'menu');
await page.evaluate(() => window.__IV.game.newGame());
await page.waitForFunction(() => window.__IV.game.started && window.__IV.game.ui.mode === 'playing');
await page.evaluate(() => { window.__IV.setTime(12); return window.__IV.gameSeconds(Number(2)); });
if (process.env.EVAL) console.log('EVAL', JSON.stringify(await page.evaluate(process.env.EVAL)));
const rep = await page.evaluate(() => {
  const g = window.__IV.game, r = g.renderer.renderer, gl = r.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const progs = (r.info.programs || []).map((p) => { const pr = p.program; let s = 0; const n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(pr, i); if (u && [gl.SAMPLER_2D, gl.SAMPLER_CUBE, 0x8B62, 0x8DC1, 0x8DC4, 0x8B5F].includes(u.type)) s += u.size; } return { name: p.name, key: String(p.cacheKey).slice(0, 0), samplers: s, ok: gl.getProgramParameter(pr, gl.LINK_STATUS) }; });
  progs.sort((a, b) => b.samplers - a.samplers);
  return { gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?', webgl2: r.capabilities.isWebGL2, maxTex: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), maxVary: gl.getParameter(gl.MAX_VARYING_VECTORS), maxFragU: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS), maxVertU: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS), composer: !!g.renderer.composer, settings: JSON.stringify(g.renderer && window.__IV.game.settings ? 0 : 0), nprog: progs.length, bad: progs.filter((p) => !p.ok), top: progs.slice(0, 6), glErr: gl.getError(), report: g.renderer.report ? g.renderer.report() : null };
});
rep.mean = await page.evaluate(() => { const c = document.getElementById('game-canvas'); const t = document.createElement('canvas'); t.width = 64; t.height = 36; const x = t.getContext('2d'); x.drawImage(c, 0, 0, 64, 36); const d = x.getImageData(0, 0, 64, 36).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return +(s / (d.length / 4) / 3).toFixed(1); });
rep.faults = await page.evaluate(() => [...(window.__IV.game.faults || new Map())].map(([k, v]) => [k, v.n, v.msg]));
rep.gfx = await page.evaluate(() => window.__IV.game.renderer.gfx || null);
const out = process.env.SHOT || 'diag';
await page.screenshot({ path: path.join(ROOT, `tests/diag/${out}.png`) });
// mean colour of the canvas area from the screenshot is checked by eye / by the caller
delete rep.top; console.log(JSON.stringify(rep));
console.log('ERRORS', errs.length, errs.slice(0, 6).join('\n---\n'));
await browser.close(); try { process.kill(-server.pid); } catch {}
