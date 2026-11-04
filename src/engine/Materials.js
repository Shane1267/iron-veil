import * as THREE from 'three';
import { TextureFactory } from './TextureFactory.js';

// Central material library. Geometry builders write UVs in metres divided by each
// material's "tile" size, so one shared texture serves every surface of that type.

export const MATERIAL_DEFS = {
  concrete: { tex: 'concrete', tile: 3.0, color: 0xc8c6c0, rough: 0.92, phys: 'concrete' },
  concrete_dark: { tex: 'concrete', tile: 3.0, color: 0x8e8c86, rough: 0.92, phys: 'concrete' },
  plaster: { tex: 'plaster', tile: 3.0, color: 0xe6dfcf, rough: 0.95, phys: 'plaster' },
  plaster_yellow: { tex: 'plaster', tile: 3.0, color: 0xe8d6a6, rough: 0.95, phys: 'plaster' },
  plaster_blue: { tex: 'plaster', tile: 3.0, color: 0xb8c4c8, rough: 0.95, phys: 'plaster' },
  plaster_green: { tex: 'plaster', tile: 3.0, color: 0xbcc6a8, rough: 0.95, phys: 'plaster' },
  brick: { tex: 'brick', tile: 2.4, color: 0xffffff, rough: 0.92, phys: 'brick' },
  wood: { tex: 'planks', tile: 2.0, color: 0xe0d0b8, rough: 0.88, phys: 'wood' },
  wood_dark: { tex: 'planks', tile: 2.0, color: 0x8a7a68, rough: 0.9, phys: 'wood' },
  wood_red: { tex: 'planks', tile: 2.0, color: 0xb05040, rough: 0.9, phys: 'wood' },
  logs: { tex: 'logs', tile: 1.6, color: 0xffffff, rough: 0.9, phys: 'wood' },
  corrugated: { tex: 'corrugated', tile: 3.0, color: 0xffffff, rough: 0.6, metal: 0.35, phys: 'sheet' },
  corrugated_blue: { tex: 'corrugated', tile: 3.0, color: 0x9ab0c8, rough: 0.6, metal: 0.35, phys: 'sheet' },
  corrugated_rust: { tex: 'corrugated', tile: 3.0, color: 0xc89070, rough: 0.75, metal: 0.25, phys: 'sheet' },
  metal: { tex: 'metal', tile: 2.0, color: 0xb0b4b8, rough: 0.5, metal: 0.7, phys: 'metal' },
  metal_dark: { tex: 'metal', tile: 2.0, color: 0x5a5e62, rough: 0.55, metal: 0.6, phys: 'metal' },
  olive: { tex: 'olive', tile: 2.0, color: 0xffffff, rough: 0.7, metal: 0.2, phys: 'metal' },
  rust: { tex: 'corrugated', tile: 2.0, color: 0xa86040, rough: 0.85, metal: 0.2, phys: 'metal' },
  roof: { tex: 'roof', tile: 3.0, color: 0xffffff, rough: 0.85, phys: 'wood' },
  roof_red: { tex: 'roof', tile: 3.0, color: 0xc07058, rough: 0.85, phys: 'wood' },
  canvas: { tex: 'canvas', tile: 2.5, color: 0xffffff, rough: 0.95, phys: 'fabric' },
  canvas_tan: { tex: 'canvas', tile: 2.5, color: 0xd8c8a0, rough: 0.95, phys: 'fabric' },
  tiles: { tex: 'tiles', tile: 2.4, color: 0xffffff, rough: 0.6, phys: 'concrete' },
  asphalt: { tex: 'asphalt', tile: 6.0, color: 0xffffff, rough: 0.9, phys: 'concrete' },
  rock: { tex: 'rock', tile: 6.0, color: 0xffffff, rough: 0.9, phys: 'rock' },
  sand: { tex: 'sand', tile: 4.0, color: 0xffffff, rough: 0.95, phys: 'sand' },
  dirt: { tex: 'dirt', tile: 4.0, color: 0xffffff, rough: 0.95, phys: 'sand' },
  fabric_red: { tex: 'canvas', tile: 1.0, color: 0x8a3a30, rough: 0.95, phys: 'fabric' },
  fabric_blue: { tex: 'canvas', tile: 1.0, color: 0x4a5a78, rough: 0.95, phys: 'fabric' },
  fabric_grey: { tex: 'canvas', tile: 1.0, color: 0x8a8880, rough: 0.95, phys: 'fabric' },
  mattress: { tex: 'canvas', tile: 1.0, color: 0xc8c0b0, rough: 0.95, phys: 'fabric' },
  paint_red: { tex: 'metal', tile: 2.0, color: 0x9a3a2a, rough: 0.6, metal: 0.3, phys: 'metal' },
  paint_white: { tex: 'metal', tile: 2.0, color: 0xdcdcd4, rough: 0.6, metal: 0.2, phys: 'metal' },
  paint_yellow: { tex: 'metal', tile: 2.0, color: 0xc8a030, rough: 0.6, metal: 0.25, phys: 'metal' },
  hazard: { tex: 'metal', tile: 2.0, color: 0xd0b040, rough: 0.6, metal: 0.2, phys: 'metal' },
  black: { tex: 'metal', tile: 2.0, color: 0x222222, rough: 0.6, metal: 0.3, phys: 'metal' },
  hay: { tex: 'grass', tile: 1.5, color: 0xd8c070, rough: 1.0, phys: 'fabric' },
  brass: { tex: 'metal', tile: 1.0, color: 0xc09a50, rough: 0.35, metal: 0.85, phys: 'metal' },
  paint_trim: { tex: 'planks', tile: 1.2, color: 0xf0ece0, rough: 0.7, phys: 'wood', streaks: 0.6 },
  wood_green: { tex: 'planks', tile: 1.2, color: 0x8aa088, rough: 0.8, phys: 'wood' },
  wood_blue: { tex: 'planks', tile: 1.2, color: 0x8a9cb0, rough: 0.8, phys: 'wood' },
  stone: { tex: 'stone', tile: 2.2, color: 0xffffff, rough: 0.92, phys: 'rock' },
  plaster_grey: { tex: 'plaster', tile: 2.0, color: 0x9a968e, rough: 0.97, phys: 'plaster' },
  roof_tile: { tex: 'rooftile', tile: 2.4, color: 0xffffff, rough: 0.8, phys: 'wood' },
  roof_sheet: { tex: 'corrugated', tile: 3.0, color: 0xb8b6ae, rough: 0.85, metal: 0.0, phys: 'sheet' },
};

// shared by every weathered material: large-scale noise for grime, streaks and tone drift
export const weatherUniforms = { noiseMap: { value: null } };

/**
 * Adds world-space weathering to a standard material: rain streaks running down
 * vertical surfaces, soiling that builds up toward the bottom of walls (vertex AO
 * carries the "bottom" information), and low-frequency tone drift that hides texture
 * repetition across large facades.
 */
function addWeathering(material, strength = 1, streaks = 1) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.noiseMap = weatherUniforms.noiseMap;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWxPos; varying vec3 vWxNrm; attribute float indoor; varying float vIndoor;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vIndoor = indoor;
        {
          vec4 wxp = vec4(transformed, 1.0);
          vec3 wxn = objectNormal;
          #ifdef USE_INSTANCING
            wxp = instanceMatrix * wxp;
            wxn = mat3(instanceMatrix) * wxn;
          #endif
          vWxPos = (modelMatrix * wxp).xyz;
          vWxNrm = normalize(mat3(modelMatrix) * wxn);
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D noiseMap; varying vec3 vWxPos; varying vec3 vWxNrm; varying float vIndoor;')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        {
          // inside buildings the sky is mostly hidden: weaker, warmer bounce light and
          // almost no sky reflections
          float ind = clamp(vIndoor, 0.0, 1.0);
          float lumI = dot(reflectedLight.indirectDiffuse, vec3(0.299, 0.587, 0.114));
          reflectedLight.indirectDiffuse = mix(reflectedLight.indirectDiffuse, vec3(lumI) * vec3(1.08, 0.98, 0.86), ind * 0.75) * (1.0 - ind * 0.15);
          reflectedLight.indirectSpecular *= 1.0 - ind * 0.9;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float vert = 1.0 - abs(vWxNrm.y);
          // horizontal coordinate along the surface for streak lookup
          float hc = dot(vWxPos.xz, normalize(vec2(-vWxNrm.z, vWxNrm.x) + 1e-4));
          float streak = texture2D(noiseMap, vec2(hc * 0.21, vWxPos.y * 0.018)).r;
          float streak2 = texture2D(noiseMap, vec2(hc * 0.53 + 0.4, vWxPos.y * 0.03)).g;
          float st = smoothstep(0.52, 0.9, streak * 0.65 + streak2 * 0.45) * vert;
          vec4 mac = texture2D(noiseMap, vWxPos.xz * 0.011 + vWxPos.y * 0.004);
          float drift = 0.9 + mac.b * 0.2;
          float grime = smoothstep(0.55, 0.95, mac.a) * 0.18;
          diffuseColor.rgb *= drift * (1.0 - (st * ${(0.28 * streaks).toFixed(3)} + grime) * ${strength.toFixed(3)});
          // indoor faces carry a baked darkening in their vertex colour; the lighting
          // already handles the reduced sky light, so give some of it back
          diffuseColor.rgb *= 1.0 + vIndoor * 0.4;
          // greenish-brown discolouration in the darkest grime
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.9, 0.92, 0.78), st * 0.4 * ${strength.toFixed(3)});
        }`);
  };
  material.customProgramCacheKey = () => `weather4-${strength}-${streaks}`;
}

/**
 * Chromebook mode: only the indoor lighting correction (no texture lookups), so interiors
 * don't fill with blue sky light when the full weathering shader is off.
 */
function addIndoorOnly(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float indoor; varying float vIndoor;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n        vIndoor = indoor;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vIndoor;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n        diffuseColor.rgb *= 1.0 + vIndoor * 0.4;')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        {
          float ind = clamp(vIndoor, 0.0, 1.0);
          float lumI = dot(reflectedLight.indirectDiffuse, vec3(0.299, 0.587, 0.114));
          reflectedLight.indirectDiffuse = mix(reflectedLight.indirectDiffuse, vec3(lumI) * vec3(1.08, 0.98, 0.86), ind * 0.75) * (1.0 - ind * 0.15);
          reflectedLight.indirectSpecular *= 1.0 - ind * 0.9;
        }`);
  };
  material.customProgramCacheKey = () => 'indoor-lite';
}

export class Materials {
  constructor(renderer, texSize, lite = false) {
    this.factory = new TextureFactory(renderer, texSize);
    this.cache = new Map();
    // Chromebook mode: colour texture only (no normal/roughness maps), no weathering shader,
    // no anisotropic filtering. Roughly halves texture fetches and shader cost per pixel.
    this.lite = lite;
    if (lite) this.factory.maxAniso = 1;
  }

  get(name) {
    if (this.cache.has(name)) return this.cache.get(name);
    if (name === 'glass') {
      const m = new THREE.MeshStandardMaterial({ color: 0x9fb4bc, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false, envMapIntensity: 1.5 });
      this.cache.set(name, m);
      return m;
    }
    if (name === 'glass_dirty') {
      const m = new THREE.MeshStandardMaterial({ color: 0x7a8a80, roughness: 0.3, metalness: 0.05, transparent: true, opacity: 0.55, depthWrite: false });
      this.cache.set(name, m);
      return m;
    }
    if (name === 'chainlink') {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      g.clearRect(0, 0, 64, 64);
      g.strokeStyle = '#fff';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(64, 64); g.moveTo(64, 0); g.lineTo(0, 64);
      g.moveTo(32, -32); g.lineTo(96, 32); g.moveTo(-32, 32); g.lineTo(32, 96);
      g.moveTo(32, 96); g.lineTo(96, 32); g.moveTo(-32, 32); g.lineTo(32, -32);
      g.stroke();
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1, 1);
      const m = new THREE.MeshStandardMaterial({ color: 0x8a8e90, metalness: 0.6, roughness: 0.5, alphaMap: tex, alphaTest: 0.4, transparent: false, side: THREE.DoubleSide, vertexColors: true });
      this.cache.set(name, m);
      return m;
    }
    if (name === 'emissive_red') {
      const m = new THREE.MeshStandardMaterial({ color: 0x601010, emissive: 0xff2a10, emissiveIntensity: 3 });
      this.cache.set(name, m);
      return m;
    }
    if (name === 'emissive_lamp') {
      const m = new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffc070, emissiveIntensity: 2.5 });
      this.cache.set(name, m);
      return m;
    }
    const def = MATERIAL_DEFS[name] || MATERIAL_DEFS.concrete;
    const t = this.factory.get(def.tex);
    if (!weatherUniforms.noiseMap.value) weatherUniforms.noiseMap.value = this.factory.noise(256);
    const m = new THREE.MeshStandardMaterial({
      map: t.map,
      normalMap: this.lite ? null : t.normalMap,
      roughnessMap: this.lite ? null : t.roughnessMap,
      color: def.color,
      roughness: def.rough ?? 0.9,
      metalness: def.metal ?? 0,
      vertexColors: true,
    });
    m.normalScale.set(0.9, 0.9);
    m.name = name;
    if (this.lite) addIndoorOnly(m);
    else if (def.weather !== false) addWeathering(m, def.weatherStrength ?? 1, def.streaks ?? (def.phys === 'metal' || def.phys === 'sheet' ? 1.3 : 1));
    this.cache.set(name, m);
    return m;
  }

  static tile(name) {
    if (name === 'chainlink') return 0.4;
    return (MATERIAL_DEFS[name] || MATERIAL_DEFS.concrete).tile;
  }

  static phys(name) {
    if (name === 'glass' || name === 'glass_dirty') return 'glass';
    if (name === 'chainlink') return 'fabric';
    return (MATERIAL_DEFS[name] || MATERIAL_DEFS.concrete).phys;
  }
}
