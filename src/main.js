import { Game } from './core/Game.js';

// Entry point. Verifies WebGL2 support before booting the game.
function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

if (!webglAvailable()) {
  document.getElementById('ui-root').innerHTML = `<div class="screen" style="pointer-events:auto;flex-direction:column;gap:12px;text-align:center;padding:24px">
    <div style="font-size:28px;letter-spacing:.2em">OPERATION IRON VEIL</div>
    <div style="color:#9c978a;max-width:520px;line-height:1.5">This game needs WebGL 2. Please use a current desktop version of Chrome, Edge, Firefox or Safari with hardware acceleration enabled.</div></div>`;
} else {
  try {
    window.game = new Game();
  } catch (e) {
    console.error(e);
    document.getElementById('ui-root').innerHTML = `<div class="screen" style="pointer-events:auto;flex-direction:column;gap:12px;text-align:center;padding:24px">
      <div style="font-size:22px;letter-spacing:.2em">FAILED TO START</div><pre style="color:#c9493a;white-space:pre-wrap;max-width:800px">${String(e && e.stack || e)}</pre></div>`;
  }
}
