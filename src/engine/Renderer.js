import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { settings, BOOT } from '../core/SettingsManager.js';
import { bus } from '../core/EventBus.js';
import { installAtmosphere } from './Atmosphere.js';
import { installSunShadows } from './SunShadows.js';

// Final colour grade: vignette, subtle film grain, damage/low-health tint,
// saturation and contrast. Kept cheap (single full-screen pass).
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uDamage: { value: 0 },
    uLowHealth: { value: 0 },
    uSaturation: { value: 0.9 },
    uContrast: { value: 1.04 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uVignette: { value: 0.3 },
    uGrain: { value: 0.025 },
    uFlash: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uDamage, uLowHealth, uSaturation, uContrast, uVignette, uGrain, uFlash;
    uniform vec3 uTint; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime*0.37) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uTint;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation * (1.0 - uLowHealth * 0.6));
      col = (col - 0.5 * l) * uContrast + 0.5 * l;
      // split toning: slightly cool shadows, warm highlights (scene-referred, before tone mapping)
      float lt = smoothstep(0.02, 0.9, l);
      col *= mix(vec3(0.95, 0.99, 1.06), vec3(1.04, 1.01, 0.95), lt);
      vec2 d = vUv - 0.5;
      float r = dot(d, d);
      col *= 1.0 - uVignette * smoothstep(0.08, 0.55, r);
      float edge = smoothstep(0.05, 0.45, r);
      col = mix(col, vec3(0.45, 0.02, 0.0), edge * (uDamage * 0.75 + uLowHealth * 0.35 * (0.8 + 0.2*sin(uTime*4.0))));
      col += (hash(vUv * 900.0) - 0.5) * uGrain;
      col += uFlash;
      gl_FragColor = vec4(max(col, 0.0), c.a);
    }
  `,
};

export class Renderer {
  constructor(container) {
    installAtmosphere();
    installSunShadows();
    this.container = container;
    // Chromebook mode skips multisampling: on integrated GPUs it costs more than it is worth
    this.renderer = new THREE.WebGLRenderer({ antialias: !BOOT.lite, powerPreference: 'high-performance', stencil: false });
    this._gfxInit();
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.id = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // near plane 0.15 m (the player is 0.33 m wide, so walls never get closer): 2x the depth precision of 0.08,
    // which keeps distant paving, floors and road decals from flickering on 24-bit depth buffers
    this.camera = new THREE.PerspectiveCamera(settings.get('fov'), 1, 0.15, 4600);
    this.scene.add(this.camera);

    // Separate scene for the first-person viewmodel: rendered after the world with a
    // cleared depth buffer so weapons never clip into nearby walls.
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.viewScene.add(this.viewCamera);
    this.viewAmbient = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    this.viewSun = new THREE.DirectionalLight(0xffffff, 1.2);
    this.viewScene.add(this.viewAmbient, this.viewSun, this.viewSun.target);
    // soft camera-relative key/fill so the weapon reads in any sun direction
    this.viewFill = new THREE.DirectionalLight(0xfff4e8, 0.6);
    this.viewFill.position.set(-0.6, 0.8, 0.4);
    this.viewFill.target.position.set(0.2, -0.3, -1);
    this.viewCamera.add(this.viewFill, this.viewFill.target);

    this.composer = null;
    this.gradePass = null;
    this.aoPass = null;
    this.fps = 0;
    this._frames = 0;
    this._fpsTime = 0;
    this.stats = { calls: 0, triangles: 0 };

    this.applySettings();
    window.addEventListener('resize', () => this.resize());
    bus.on('settings:changed', (changed) => {
      const keys = Object.keys(changed);
      if (keys.some((k) => ['renderScale', 'shadows', 'ao', 'post', 'fov', 'viewDistance'].includes(k))) this.applySettings();
    });
    this.resize();
  }

  applySettings() {
    const s = settings.values;
    // high-DPI screens multiply the pixel count; Chromebook mode renders at 1 CSS pixel per pixel at most
    this.renderer.setPixelRatio(Math.min(BOOT.lite ? 1 : 2, window.devicePixelRatio || 1) * s.renderScale);
    this.renderer.shadowMap.enabled = s.shadows > 0;
    this.camera.fov = s.fov;
    this.baseFov = s.fov;
    this.camera.far = Math.max(2600, s.viewDistance + 1800);
    this.camera.updateProjectionMatrix();
    this._buildComposer();
    bus.emit('renderer:quality', s);
    this.resize();
  }

  _buildComposer() {
    const s = settings.values;
    if (this.composer) {
      this.composer.dispose?.();
      this.composer = null;
    }
    if (this.gfx) { this.gfx.seenLit = false; this.gfx.blackChecks = 0; }
    if (!s.post && !s.ao) {
      this.gradePass = null;
      this.aoPass = null;
      return;
    }
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    // Half-float targets need EXT_color_buffer_(half_)float; many Chromebook, older Intel and mobile GPUs
    // lack it, and an unsupported target renders the whole world black. Fall back to 8-bit, and cap MSAA.
    const g = this.gfx;
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: g.halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: g.samples });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (s.ao && this.gfx.halfFloat) {
      try {
        this.aoPass = new GTAOPass(this.scene, this.camera, size.x, size.y);
        this.aoPass.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: 12 });
        this.aoPass.blendIntensity = 0.85;
        // The AO pre-pass renders normals with an override material that ignores alpha
        // testing, so foliage/grass cards would occlude as solid quads (dark halos around
        // every tree). Leave alpha-tested, transparent and sky geometry out of it.
        const ao = this.aoPass;
        // composite: clamp AO to [0,1] (half-float buffers can hold stale/overshooting
        // values that brightened the sky) and never apply it to sky pixels
        ao.blendMaterial.uniforms.tDepth = { value: ao.depthTexture };
        ao.blendMaterial.fragmentShader = `
          uniform float intensity; uniform sampler2D tDiffuse; uniform sampler2D tDepth; varying vec2 vUv;
          void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            vec3 occ = clamp(texel.rgb, 0.0, 1.0);
            if (texture2D(tDepth, vUv).x >= 0.99999) occ = vec3(1.0);
            gl_FragColor = vec4(mix(vec3(1.0), occ, intensity), texel.a);
          }`;
        ao.blendMaterial.needsUpdate = true;
        ao.overrideVisibility = function () {
          const cache = this._visibilityCache;
          this.scene.traverse((o) => {
            cache.set(o, o.visible);
            if (o.isPoints || o.isLine || o.isSprite) { o.visible = false; return; }
            const m = o.material;
            if (m && !Array.isArray(m) && (m.alphaTest > 0 || m.transparent || m.depthWrite === false)) o.visible = false;
          });
        };
        this.composer.addPass(this.aoPass);
      } catch (e) {
        console.warn('[Renderer] GTAO unavailable, continuing without AO', e);
        this.aoPass = null;
      }
    } else {
      this.aoPass = null;
    }
    this.gradePass = new ShaderPass(GradeShader);
    if (!s.post) {
      this.gradePass.uniforms.uVignette.value = 0;
      this.gradePass.uniforms.uGrain.value = 0;
    }
    this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass());
  }

  _gfxInit() {
    const r = this.renderer, gl = r.getContext();
    const ext = r.extensions;
    const has = (n) => { try { return !!ext.has(n); } catch { return false; } };
    const gl2 = r.capabilities.isWebGL2;
    const halfFloat = gl2 ? has('EXT_color_buffer_float') || has('EXT_color_buffer_half_float') : false;
    let maxSamples = 0;
    try { maxSamples = gl2 ? gl.getParameter(gl.MAX_SAMPLES) | 0 : 0; } catch { maxSamples = 0; }
    let gpu = '';
    try { const d = gl.getExtension('WEBGL_debug_renderer_info'); gpu = d ? String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)) : ''; } catch { gpu = ''; }
    this.gfx = {
      gpu, webgl2: gl2, halfFloat, samples: BOOT.lite ? 0 : Math.min(4, maxSamples), maxSamples,
      shaderErrors: 0, blackChecks: 0, fallback: 0, notes: [],
    };
    // a shader that fails to compile on this GPU is counted; the black-frame check below then steps quality down
    r.debug.onShaderError = (glc, program, vs, fs) => {
      this.gfx.shaderErrors++;
      try {
        const log = `${glc.getProgramInfoLog(program) || ''} ${glc.getShaderInfoLog(fs) || ''} ${glc.getShaderInfoLog(vs) || ''}`.trim().slice(0, 300);
        if (this.gfx.shaderErrors <= 3) console.error('[Renderer] shader failed on this GPU:', log);
      } catch { /* ignore */ }
    };
    const cv = r.domElement;
    cv.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.gfx.contextLost = (this.gfx.contextLost || 0) + 1;
      bus.emit('notify', { text: 'The graphics driver reset. Recovering...', kind: 'warn', key: 'gl-lost' });
    });
    cv.addEventListener('webglcontextrestored', () => {
      bus.emit('notify', { text: 'Graphics recovered. If the world stays black, lower the preset in Settings.', kind: 'info', key: 'gl-lost' });
      this._buildComposer();
    });
  }

  // Black-frame check. Reads a 5x3 grid of pixels straight after drawing (valid without
  // preserveDrawingBuffer). A correctly drawn frame is never pure black — the sky, fog, grain and
  // the night ambient all lift it — so several pure-black checks in a row mean this GPU cannot draw
  // the current setup. Quality then steps down: post-processing off, then shadows off, then the
  // Chromebook preset (takes effect on reload).
  _blackCheck(dt) {
    const g = this.gfx;
    // only until this setup has drawn one lit frame: a working GPU in a pitch-dark room must not trip it
    if (!g || g.fallback >= 3 || g.seenLit || this.blackCheckOff) return;
    // real time, not game time: a GPU drawing two frames a second must still be caught quickly
    const now = performance.now();
    if (now - (g._t || 0) < 1500) return;
    g._t = now;
    const gl = this.renderer.getContext();
    if (gl.isContextLost && gl.isContextLost()) return;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    if (w < 8 || h < 8) return;
    const px = new Uint8Array(4);
    let lit = false;
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      for (let j = 1; j <= 3 && !lit; j++) for (let i = 1; i <= 5; i++) {
        gl.readPixels(Math.floor((w * i) / 6), Math.floor((h * j) / 4), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        if (px[0] + px[1] + px[2] > 0) { lit = true; break; }
      }
    } catch { return; }
    g.blackChecks = lit ? 0 : g.blackChecks + 1;
    if (lit) { g.seenLit = true; return; }
    if (g.blackChecks < 3) return;
    g.blackChecks = 0;
    g.fallback++;
    const steps = [
      ['post-processing', { post: false, ao: false }],
      ['shadows', { shadows: 0 }],
      ['Chromebook preset', { preset: 'chromebook' }],
    ];
    const [what, patch] = steps[g.fallback - 1];
    g.notes.push(what);
    console.warn(`[Renderer] black frames on this GPU (${g.gpu || 'unknown'}): turning off ${what}`);
    if (patch.preset) {
      settings.applyPreset('chromebook');
      bus.emit('notify', { text: 'Your graphics card could not draw the world. Switched to the Chromebook preset: open Settings and reload to apply it fully.', kind: 'warn', key: 'gfx-fallback' });
    } else {
      settings.apply({ ...patch, preset: 'custom' });
      bus.emit('notify', { text: `Your graphics card could not draw the world, so ${what} was turned off. You can change this in Settings.`, kind: 'warn', key: 'gfx-fallback' });
    }
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = w / h;
    this.viewCamera.updateProjectionMatrix();
    if (this.composer) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.composer.setSize(w, h);
      this.aoPass?.setSize(size.x, size.y);
    }
  }

  setGrade({ damage = 0, lowHealth = 0, tint = null, flash = 0, time = 0 }) {
    this.damageOverlay = damage;
    if (!this.gradePass) return;
    const u = this.gradePass.uniforms;
    u.uDamage.value = damage;
    u.uLowHealth.value = lowHealth;
    u.uTime.value = time;
    u.uFlash.value = flash;
    if (tint) u.uTint.value.copy(tint);
  }

  render(dt, drawViewmodel = true) {
    const r = this.renderer;
    r.info.autoReset = false;
    r.info.reset();
    if (this.composer) {
      this.composer.render(dt);
    } else {
      r.autoClear = true;
      r.render(this.scene, this.camera);
    }
    if (drawViewmodel) {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.viewScene, this.viewCamera);
      r.autoClear = true;
    }
    this._blackCheck(dt);
    // shaders that fail to compile usually exceed this GPU's texture-unit limit; shadow maps add the most
    if (this.gfx && this.gfx.shaderErrors && !this.gfx.shaderFallback) {
      this.gfx.shaderFallback = true;
      if (settings.get('shadows') > 0) {
        settings.apply({ shadows: 0, preset: 'custom' });
        bus.emit('notify', { text: 'Some objects could not be drawn on your graphics card, so shadows were turned off. You can change this in Settings.', kind: 'warn', key: 'gfx-fallback' });
      }
    }
    this.stats.calls = r.info.render.calls;
    this.stats.triangles = r.info.render.triangles;
    this._frames++;
    this._fpsTime += dt;
    if (this._fpsTime >= 0.5) {
      this.fps = Math.round(this._frames / this._fpsTime);
      this._frames = 0;
      this._fpsTime = 0;
    }
  }
}
