// Measures frames per second at the start position for each graphics preset (same view, same build).
// Usage: npm run build && node tests/e2e/fps.mjs [--presets=chromebook,low,medium]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const presets = ((process.argv.find((a) => a.startsWith('--presets=')) || '--presets=chromebook,low,medium').split('=')[1]).split(',');
const PORT = 4191;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe' });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
const CHROME = process.env.CHROME_PATH || '/opt/google/chrome/chrome';
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const out = {};
for (const preset of presets) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(300000);
  await page.addInitScript((q) => { localStorage.setItem('ironveil.settings.v1', JSON.stringify({ preset: q, eventFrequency: 0 })); Math.random = (() => { let s = 42; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })(); }, preset);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__IV);
  await page.click('text=New Game');
  await page.waitForFunction(() => window.__IV.state().started);
  const r = await page.evaluate(async () => {
    const IV = window.__IV;
    IV.forcePlaying();
    IV.teleport(320, 1150, 0); // Millbrook street, looking north into the village
    IV.look(0, -0.05);
    await IV.frames(60); // settle: shaders compiled, chunks streamed
    const t0 = performance.now();
    await IV.frames(40);
    const ms = (performance.now() - t0) / 40;
    const s = IV.state();
    const g = IV.game.renderer.renderer;
    return { msPerFrame: +ms.toFixed(1), fps: +(1000 / ms).toFixed(2), tris: s.tris, calls: s.calls, pixels: g.domElement.width * g.domElement.height, antialias: g.getContextAttributes().antialias };
  });
  out[preset] = r;
  console.log(preset, JSON.stringify(r));
  await page.screenshot({ path: path.join(ROOT, `tests/e2e/screenshots/fps-${preset}.png`) });
  await page.close();
}
await browser.close();
server.kill();
