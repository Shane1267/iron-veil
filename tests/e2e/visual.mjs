// Visual reference capture: renders a fixed set of camera views of the playable region
// with the HUD hidden, waiting for terrain and POI streaming to finish before each shot.
//
// Usage: npm run build && node tests/e2e/visual.mjs [--out=dir] [--quality=high] [--views=a,b] [--survey=poiId]
// Env: PREVIEW_URL to reuse a running preview server, VW/VH for viewport size.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).split('=').slice(1).join('=');
const OUT = path.resolve(ROOT, arg('out', 'tests/e2e/visual'));
const QUALITY = arg('quality', 'high');
const VIEWS = arg('views', '').split(',').filter(Boolean);
const SURVEY = arg('survey', '');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4181;
const CHROME = process.env.CHROME_PATH || (fs.existsSync('/opt/google/chrome/chrome') ? '/opt/google/chrome/chrome' : undefined);
const BASE = process.env.PREVIEW_URL || `http://localhost:${PORT}/`;
const server = process.env.PREVIEW_URL ? null : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe' });
for (let i = 0; i < 40; i++) {
  try { const r = await fetch(BASE); if (r.ok) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 500));
}
const log = (...a) => console.log('[visual]', ...a);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const VW = Number(process.env.VW || 1280), VH = Number(process.env.VH || 720);
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
page.setDefaultTimeout(600000);
await page.addInitScript((q) => localStorage.setItem('ironveil.settings.v1', JSON.stringify({ preset: q, eventFrequency: 0 })), QUALITY);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); log('console.error', m.text().slice(0, 300)); } });
page.on('pageerror', (e) => { if (!String(e).includes('Pointer Lock')) { errors.push(String(e)); log('pageerror', String(e).slice(0, 300)); } });

await page.goto(BASE);
await page.click('text=New Game');
await page.waitForFunction(() => window.__IV && window.__IV.state().started, null, { timeout: 300000 });
await page.evaluate(() => {
  window.__IV.forcePlaying();
  window.__IV.setMaxDt(0.1);
  window.__IV.photo(true);
  // remove ambient NPCs so they don't wander into shots (views can spawn their own)
  const ai = window.__IV.game.ai;
  ai._spawnGarrison = () => {};
  ai.clear();
});

/** Place the camera, wait for streaming + a few frames, take the screenshot. */
async function capture(name, v) {
  const t0 = Date.now();
  await page.evaluate((v) => {
    const IV = window.__IV;
    if (v.time !== undefined) IV.setTime(v.time);
    IV.weather(v.weather || 'clear');
    const y = v.y ?? IV.ground(v.x, v.z) + (v.h ?? 1.7);
    const ty = v.ty ?? IV.ground(v.tx, v.tz) + (v.th ?? 1.5);
    IV.cam(v.x, y, v.z, v.tx, ty, v.tz);
    if (v.vm) { IV.game.hideViewmodel = false; }
    else IV.game.hideViewmodel = true;
  }, v);
  await page.evaluate(() => window.__IV.frames(3));
  await page.waitForFunction(() => window.__IV.busy() === 0, null, { timeout: 600000, polling: 500 });
  if (v.poi) await page.waitForFunction((id) => window.__IV.game.pois.active.has(id) && !window.__IV.game.pois.building, v.poi, { timeout: 600000, polling: 500 });
  await page.waitForFunction(() => window.__IV.busy() === 0, null, { timeout: 600000, polling: 500 });
  if (v.before) await page.evaluate(v.before);
  await page.evaluate(() => window.__IV.frames(6));
  await page.screenshot({ path: path.join(OUT, `${name}.png`), timeout: 300000 });
  log(name, `${Math.round((Date.now() - t0) / 1000)} s`);
}

if (SURVEY) {
  const poi = await page.evaluate((id) => window.__IV.game.world.pois.find((p) => p.id === id), SURVEY);
  await capture(`survey-${SURVEY}`, { x: poi.x, z: poi.z + poi.radius + 40, tx: poi.x, tz: poi.z, h: 60, th: 0, poi: SURVEY, time: 12 });
  const info = await page.evaluate((id) => {
    const rt = window.__IV.game.pois.active.get(id);
    const g = window.__IV.game.world;
    const roads = g.roads.filter((r) => r.type !== 'rail').map((r) => ({ id: r.id, type: r.type, pts: r.points.filter(([x, z]) => Math.hypot(x - rt.poi.x, z - rt.poi.z) < rt.poi.radius * 1.3).map(([x, z]) => [Math.round(x), Math.round(z)]) })).filter((r) => r.pts.length);
    return { buildings: rt.buildings, roads };
  }, SURVEY);
  fs.writeFileSync(path.join(OUT, `survey-${SURVEY}.json`), JSON.stringify(info)); console.log(JSON.stringify(info.buildings)); console.log(JSON.stringify(info.roads.map((r) => [r.id, r.type, r.pts[0], r.pts[r.pts.length - 1], r.pts.length])));
} else {
  const views = (await import('./visual-views.mjs')).VIEWS;
  for (const [name, v] of Object.entries(views)) {
    if (VIEWS.length && !VIEWS.includes(name)) continue;
    try { await capture(name, v); } catch (e) { log('FAILED', name, String(e).slice(0, 300)); }
  }
}
log(`done, ${errors.length} errors`);
await browser.close();
server?.kill();
