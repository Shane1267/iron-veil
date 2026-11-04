import * as THREE from 'three';
import { settings } from '../core/SettingsManager.js';
import { bus } from '../core/EventBus.js';
import { clamp, lerp, smoothstep, damp } from '../core/MathUtil.js';
import { ATMO } from './Atmosphere.js';
import { SunShadows } from './SunShadows.js';

// Sky dome, sun/moon, ambient light, atmospheric fog and environment reflections, all
// driven by the day/night cycle and the current weather. The palette is deliberately
// restrained: cool, slightly desaturated daylight, warm low sun, hazy horizons.

const SkyShader = {
  uniforms: {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uFog: { value: new THREE.Color() },
    uSunColor: { value: new THREE.Color() },
    uScatter: { value: new THREE.Color() },
    uCloudCover: { value: 0.35 },
    uCloudColor: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uStars: { value: 0 },
    uTime: { value: 0 },
    uHaze: { value: 0.3 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main(){
      vDir = normalize(position);
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position = p.xyww;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uSunDir, uMoonDir, uZenith, uHorizon, uFog, uSunColor, uScatter, uCloudColor, uCloudShade;
    uniform float uCloudCover, uStars, uTime, uHaze;
    varying vec3 vDir;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float noise(vec2 p){
      vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
    }
    float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<6;i++){ s+=a*noise(p); p = p*2.03 + vec2(1.7, 9.2); a*=0.5; } return s; }
    void main(){
      vec3 d = normalize(vDir);
      float h = d.y;
      float hp = max(h, 0.0);
      // sky gradient: zenith to a pale horizon band
      vec3 col = mix(uHorizon, uZenith, pow(hp, 0.5));
      float sd = max(dot(d, uSunDir), 0.0);
      // broad forward scattering around the sun, strongest near the horizon
      col += uScatter * pow(sd, 4.0) * (0.35 + 0.65 * (1.0 - hp));
      col += uSunColor * (pow(sd, 64.0) * 0.35 + pow(sd, 900.0) * 1.2);
      // sun disc
      col += uSunColor * smoothstep(0.99988, 0.99994, sd) * 22.0 * step(-0.04, uSunDir.y);
      // moon
      float md = max(dot(d, uMoonDir), 0.0);
      col += vec3(0.75, 0.8, 0.9) * smoothstep(0.99955, 0.9998, md) * 1.6 * step(0.0, uMoonDir.y);
      col += vec3(0.2, 0.25, 0.35) * pow(md, 40.0) * 0.4 * step(0.0, uMoonDir.y);
      // stars
      if (uStars > 0.01 && h > 0.0) {
        vec2 sp = d.xz / (d.y + 0.3) * 220.0;
        float s = hash(floor(sp));
        float tw = 0.7 + 0.3*sin(uTime*3.0 + s*50.0);
        col += vec3(0.9, 0.92, 1.0) * step(0.9975, s) * uStars * tw * smoothstep(0.0, 0.25, h);
      }
      // clouds: domain-warped fbm, lit from the sun side with darker bases
      if (h > 0.0) {
        vec2 cp = d.xz / (h + 0.1) * 1.4 + vec2(uTime * 0.004, uTime * 0.0016);
        vec2 warp = vec2(fbm(cp * 0.6 + 3.1), fbm(cp * 0.6 - 7.4)) - 0.5;
        float n = fbm(cp + warp * 0.9);
        float dens = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.3, n);
        // self-shadowing toward the sun
        float ns = fbm(cp + warp * 0.9 + normalize(uSunDir.xz + 1e-4) * 0.12);
        float lit = clamp(0.55 + (n - ns) * 3.0, 0.0, 1.0);
        vec3 cc = mix(uCloudShade, uCloudColor, lit);
        cc += uSunColor * pow(sd, 5.0) * 0.45 * (1.0 - dens * 0.6);
        col = mix(col, cc, dens * smoothstep(0.0, 0.1, h) * 0.96);
      }
      // horizon haze: blend into the same fog colour the terrain fades to
      float haze = pow(1.0 - hp, 6.0) * (0.55 + uHaze * 0.45);
      vec3 fogC = uFog + uScatter * pow(sd, 6.0) * 0.6;
      col = mix(col, fogC, clamp(haze, 0.0, 1.0));
      // below the horizon the "ground" is fully fogged
      col = mix(col, fogC, smoothstep(0.0, -0.08, h));
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

// Key-frames by sun elevation (sin of altitude). Colours in sRGB hex.
const KEYS = [
  { e: -0.35, zenith: 0x03050b, horizon: 0x0b111c, sun: 0x000000, sunI: 0.0, moonI: 0.3, hemiSky: 0x283450, hemiGround: 0x0a0c10, hemiI: 0.38, fog: 0x0b1019, exposure: 1.5, cloud: 0x171b25, shade: 0x06080d, scatter: 0x000000 },
  { e: -0.08, zenith: 0x0d1630, horizon: 0x343848, sun: 0x000000, sunI: 0.0, moonI: 0.2, hemiSky: 0x384464, hemiGround: 0x121318, hemiI: 0.42, fog: 0x272a36, exposure: 1.32, cloud: 0x363a46, shade: 0x13151c, scatter: 0x1a1410 },
  { e: 0.02, zenith: 0x2a4570, horizon: 0xc98a62, sun: 0xff8a48, sunI: 0.85, moonI: 0.0, hemiSky: 0x6e7c9c, hemiGround: 0x332a22, hemiI: 0.5, fog: 0x9c8070, exposure: 1.12, cloud: 0xd89878, shade: 0x54465a, scatter: 0xb0602a },
  { e: 0.16, zenith: 0x34609e, horizon: 0xc8b8a0, sun: 0xffc68c, sunI: 2.5, moonI: 0.0, hemiSky: 0x93a7c4, hemiGround: 0x62584a, hemiI: 1.05, fog: 0xb3ada0, exposure: 1.04, cloud: 0xf2dcc8, shade: 0x868494, scatter: 0x8a6a40 },
  { e: 0.5, zenith: 0x3c6aa8, horizon: 0xb4c2cc, sun: 0xfff0da, sunI: 3.2, moonI: 0.0, hemiSky: 0x98aec8, hemiGround: 0x787058, hemiI: 1.2, fog: 0xa8b4bd, exposure: 1.0, cloud: 0xfafafa, shade: 0x98a0ac, scatter: 0x5a5040 },
  { e: 1.0, zenith: 0x3866a4, horizon: 0xb0c0cc, sun: 0xfff4e6, sunI: 3.4, moonI: 0.0, hemiSky: 0x9ab0ca, hemiGround: 0x7c745a, hemiI: 1.25, fog: 0xa6b2bc, exposure: 0.98, cloud: 0xffffff, shade: 0xa0a8b4, scatter: 0x4a4438 },
];
const COLOR_KEYS = ['zenith', 'horizon', 'sun', 'hemiSky', 'hemiGround', 'fog', 'cloud', 'shade', 'scatter'];

const _c1 = new THREE.Color(), _c2 = new THREE.Color();
const _q = new THREE.Quaternion();
function sampleKeys(e, out) {
  let i = 0;
  while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = clamp((e - a.e) / (b.e - a.e), 0, 1);
  for (const k of COLOR_KEYS) {
    _c1.setHex(a[k]); _c2.setHex(b[k]);
    out[k].copy(_c1).lerp(_c2, t);
  }
  out.sunI = lerp(a.sunI, b.sunI, t);
  out.moonI = lerp(a.moonI, b.moonI, t);
  out.hemiI = lerp(a.hemiI, b.hemiI, t);
  out.exposure = lerp(a.exposure, b.exposure, t);
  return out;
}

export class Lighting {
  constructor(renderer, scene, viewRenderer) {
    this.r = renderer;
    this.scene = scene;
    this.view = viewRenderer;

    this.params = { sunI: 0, moonI: 0, hemiI: 0, exposure: 1 };
    for (const k of COLOR_KEYS) this.params[k] = new THREE.Color();

    this.skyMat = new THREE.ShaderMaterial({ ...SkyShader, uniforms: THREE.UniformsUtils.clone(SkyShader.uniforms), side: THREE.BackSide, depthWrite: false, fog: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
    scene.add(this.hemi);

    this.shadows = new SunShadows(scene);
    this.sun = null;

    scene.fog = new THREE.FogExp2(0xa0b0c0, 0.0012);

    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3();
    this.fogBase = 30;
    this.applyShadowQuality();
    bus.on('settings:changed', (c) => { if ('shadows' in c) this.applyShadowQuality(); });

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.skyMat);
    this.envScene.add(this.envSky);
    // a dark "ground" disc so reflections and ambient from below are not sky-bright
    this.envGround = new THREE.Mesh(new THREE.CircleGeometry(90, 24), new THREE.MeshBasicMaterial({ color: 0x3a3a30, side: THREE.DoubleSide, fog: false }));
    this.envGround.rotation.x = -Math.PI / 2;
    this.envGround.position.y = -6;
    this.envScene.add(this.envGround);
    this.envTimer = 0;
    this.envRT = null;
    this.ambientLevel = 1; // 0..1 brightness used by AI perception
  }

  applyShadowQuality() {
    const q = settings.get('shadows');
    this.sun = this.shadows.configure(q);
    this.r.shadowMap.needsUpdate = true;
  }

  /**
   * timeOfDay in hours, weather = {cloud, fog, rain, overcast(0..1), flash}
   */
  update(dt, timeOfDay, weather, focus, elapsed) {
    const angle = ((timeOfDay - 6) / 24) * Math.PI * 2; // 6:00 sunrise, 18:00 sunset
    const elev = Math.sin(angle);
    this.sunDir.set(Math.cos(angle) * 0.82, elev, -0.45 + Math.cos(angle) * 0.1).normalize();
    this.moonDir.set(-this.sunDir.x, -this.sunDir.y * 0.9 + 0.1, -this.sunDir.z).normalize();
    const p = sampleKeys(this.sunDir.y, this.params);

    // weather modifies everything
    const oc = weather.overcast;
    const night = smoothstep(0.1, -0.1, this.sunDir.y);
    const lum = lerp(1, 0.16, night);
    const weatherGrey = _c2.setRGB(0.5, 0.52, 0.55).multiplyScalar(lum);
    p.zenith.lerp(weatherGrey, oc * 0.75);
    p.horizon.lerp(weatherGrey, oc * 0.7);
    p.fog.lerp(weatherGrey, oc * 0.65);
    p.cloud.lerp(weatherGrey, oc * 0.5);
    p.scatter.multiplyScalar(1 - oc * 0.85);
    p.sunI *= 1 - oc * 0.8;
    p.hemiI *= 1 + oc * 0.2;

    const u = this.skyMat.uniforms;
    u.uSunDir.value.copy(this.sunDir);
    u.uMoonDir.value.copy(this.moonDir);
    u.uZenith.value.copy(p.zenith);
    u.uHorizon.value.copy(p.horizon);
    u.uFog.value.copy(p.fog);
    u.uSunColor.value.copy(p.sun).multiplyScalar(1 - oc * 0.85);
    u.uScatter.value.copy(p.scatter);
    u.uCloudCover.value = weather.cloud;
    u.uCloudColor.value.copy(p.cloud);
    u.uCloudShade.value.copy(p.shade).lerp(weatherGrey, oc * 0.5);
    u.uStars.value = smoothstep(-0.02, -0.2, this.sunDir.y) * (1 - weather.cloud * 0.9);
    u.uTime.value = elapsed;
    u.uHaze.value = clamp(weather.fog + weather.rain * 0.5 + oc * 0.4, 0, 1);

    // directional light = sun by day, moon by night
    const useMoon = this.sunDir.y < 0.02;
    this.lightDir.copy(useMoon ? this.moonDir : this.sunDir);
    if (this.lightDir.y < 0.08) this.lightDir.y = 0.08;
    this.lightDir.normalize();
    if (useMoon) {
      _c1.setRGB(0.55, 0.65, 0.9);
      this.shadows.setLight(_c1, p.moonI * (1 - weather.cloud * 0.6) + weather.flash * 6);
    } else {
      this.shadows.setLight(p.sun, p.sunI + weather.flash * 6);
    }
    this.hemi.color.copy(p.hemiSky);
    this.hemi.groundColor.copy(p.hemiGround);
    this.hemi.intensity = p.hemiI + weather.flash * 2;

    // shadows follow the camera (cascades) or the player (single map)
    this.shadows.update(this.view.camera, this.lightDir, focus);

    // atmosphere: density tuned so terrain fades out before the streaming edge,
    // heavier near the valley floor, warmer toward the sun
    const vd = settings.get('viewDistance');
    const baseDensity = 2.0 / vd;
    const fogMul = 1 + weather.fog * 6 + weather.rain * 1.5 + oc * 0.35;
    this.scene.fog.color.copy(p.fog);
    this.scene.fog.density = baseDensity * fogMul;
    this.fogBase = damp(this.fogBase, focus.y - 6, 0.5, dt);
    ATMO.params.x = 1 / lerp(110, 45, clamp(weather.fog, 0, 1));
    ATMO.params.y = this.fogBase;
    ATMO.params.z = (useMoon ? 0.15 : 0.85) * (1 - oc * 0.8);
    ATMO.params.w = 1;
    ATMO.sunDir.x = this.sunDir.x; ATMO.sunDir.y = this.sunDir.y; ATMO.sunDir.z = this.sunDir.z;
    _c1.copy(p.fog).add(_c2.copy(p.scatter).multiplyScalar(1.4));
    ATMO.sunColor.x = _c1.r; ATMO.sunColor.y = _c1.g; ATMO.sunColor.z = _c1.b;

    // simple eye adaptation: exposure opens up under a roof and closes again outside
    this.adapt = damp(this.adapt ?? 1, this.viewIndoor ? 1.6 : 1, this.viewIndoor ? 1.2 : 2.0, dt);
    this.r.toneMappingExposure = p.exposure * this.adapt;
    this.sky.position.copy(this.view.camera.position);

    // viewmodel lights mirror the world lighting
    if (this.view) {
      this.view.viewSun.color.copy(this.primaryColor());
      this.view.viewSun.intensity = this.sun.intensity * 0.55 * (this.viewShadowed ? 0.25 : 1);
      // the viewmodel camera never rotates, so express the sun direction in camera space
      _q.copy(this.view.camera.quaternion).invert();
      this.view.viewSun.position.copy(this.lightDir).applyQuaternion(_q);
      this.view.viewAmbient.color.copy(this.hemi.color);
      this.view.viewAmbient.groundColor.copy(this.hemi.groundColor);
      this.view.viewAmbient.intensity = this.hemi.intensity * (this.viewIndoor ? 0.55 : 0.9);
      if (this.view.viewFill) this.view.viewFill.intensity = Math.min(0.6, 0.12 + this.hemi.intensity * 0.45) * (this.viewIndoor ? 0.6 : 1);
    }

    this.ambientLevel = clamp((p.sunI + p.moonI * 1.2 + p.hemiI * 0.6) / 3.2, 0.03, 1);
    this.nightFactor = night;

    // refresh image-based lighting periodically
    this.envTimer -= dt;
    if (this.envTimer <= 0) {
      this.envTimer = 12;
      this.envSky.position.set(0, 0, 0);
      this.envGround.material.color.copy(p.hemiGround).multiplyScalar(0.8);
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = clamp(0.2 + p.hemiI * 0.45, 0.1, 0.78);
      if (this.view) {
        this.view.viewScene.environment = rt.texture;
        this.view.viewScene.environmentIntensity = this.scene.environmentIntensity * 0.85;
      }
    }
  }

  primaryColor() { return this.sun ? this.sun.color : _c1.setRGB(1, 1, 1); }

  /** Viewmodel shading hints computed by the game (camera under a roof / in shade). */
  setViewShading(indoor, shadowed) {
    this.viewIndoor = indoor;
    this.viewShadowed = shadowed;
  }
}
