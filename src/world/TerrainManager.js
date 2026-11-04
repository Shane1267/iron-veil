import * as THREE from 'three';
import { settings } from '../core/SettingsManager.js';
import { bus } from '../core/EventBus.js';
import { generateChunk, VEG_TYPES } from './ChunkGenerator.js';
import {
  makePine, makeBroadleaf, makeDeadTree, makeBush, makeRock, makeLog, makeFarTree, makeGrassClump, createVegetationAtlas, createGrassTexture,
  createFernTexture, makeFern, makeHayBale,
} from './VegetationModels.js';

// Streams terrain around the player:
//  * near chunks (128 m) with LOD by ring, vegetation and grass, plus trunk colliders
//  * far tiles (512 m, 16 m resolution) out to the view distance with a hole where near
//    chunks exist, plus impostor trees
// Generation runs in Web Workers; results are turned into meshes on the main thread.

const CHUNK = 128;
const FAR = 512;
const NEAR_R = 3;

const windUniforms = { uTime: { value: 0 }, uWind: { value: 0.4 } };
const _tint = new THREE.Color();
const fract = (v) => v - Math.floor(v);

const grassUniforms = { noiseMap: { value: null } };

function addWind(material, strength = 1, grass = false) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    if (grass) shader.uniforms.noiseMap = grassUniforms.noiseMap;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uWind;
        ${grass ? 'uniform sampler2D noiseMap; varying vec3 vGTint;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 wp = vec4(0.0,0.0,0.0,1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          float ph = wp.x * 0.13 + wp.z * 0.11;
          float k = ${grass ? 'position.y * 1.6' : 'pow(max(position.y, 0.0) / 14.0, 2.0)'} * ${strength.toFixed(2)};
          // slow sway plus faster small flutter
          float gust = 0.75 + 0.25 * sin(uTime * 0.31 + wp.x * 0.011);
          transformed.x += (sin(uTime * 1.7 + ph) + 0.25 * sin(uTime * 4.3 + ph * 3.1)) * k * uWind * gust * ${grass ? '0.25' : '0.55'};
          transformed.z += (cos(uTime * 1.3 + ph * 1.3) + 0.25 * cos(uTime * 3.7 + ph * 2.3)) * k * uWind * gust * ${grass ? '0.2' : '0.42'};
          ${grass ? `
          vec3 camRel = wp.xyz - cameraPosition;
          float fade = 1.0 - smoothstep(34.0, 58.0, length(camRel));
          transformed *= fade;
          // match the terrain's large-scale lush/dry variation
          vec4 mac = texture2D(noiseMap, wp.xz / 340.0);
          vec4 mac2 = texture2D(noiseMap, wp.xz / 57.0 + vec2(0.37, 0.11));
          float dry = clamp(smoothstep(0.3, 0.8, mac.r) * 0.85 + (mac2.g - 0.5) * 0.4, 0.0, 1.0);
          vGTint = mix(vec3(0.88, 1.0, 0.84), vec3(1.28, 1.1, 0.7), dry) * (0.74 + mac2.b * 0.42 + (mac.b - 0.5) * 0.2);` : ''}
        }`);
    // double-sided cards keep their authored (crown/up) normals on both faces; the default
    // back-face flip turned half of every crown and grass clump black
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      normal = normalize( vNormal );`);
    // foliage cards seen edge-on must not mirror the sky (Fresnel); keep diffuse IBL
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      reflectedLight.indirectSpecular *= 0.0;
      reflectedLight.directSpecular *= 0.15;`);
    if (grass) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGTint;')
        .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vGTint;');
    }
  };
  material.customProgramCacheKey = () => `wind-${strength}-${grass}-v4`;
}

export class TerrainManager {
  constructor(scene, world, physics, materials) {
    this.scene = scene;
    this.world = world;
    this.physics = physics;
    this.materials = materials;
    this.near = new Map(); // key -> chunk
    this.far = new Map();
    this.pending = new Map();
    this.queue = [];
    this.center = { cx: 99999, cz: 99999 };
    this.vegDirty = true;
    this.vegTimer = 0;
    this.ready = false;

    this._initMaterial();
    this._initVegetation();
    this._initWorkers();

    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);

    bus.on('settings:changed', (c) => {
      if ('vegetation' in c || 'grass' in c) this.reset(true);
      if ('viewDistance' in c) this.center.cx = 99999;
    });
  }

  _initWorkers() {
    this.workers = [];
    this.workerBusy = [];
    this.reqId = 1;
    const count = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
    try {
      for (let i = 0; i < count; i++) {
        const w = new Worker(new URL('./TerrainWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = (e) => this._onWorkerMessage(i, e.data);
        w.onerror = (e) => {
          console.error('[Terrain] worker error, falling back to main thread', e.message);
          this.workers = [];
        };
        this.workers.push(w);
        this.workerBusy.push(0);
      }
    } catch (e) {
      console.warn('[Terrain] Web Workers unavailable, generating on main thread', e);
      this.workers = [];
    }
  }

  _initMaterial() {
    const f = this.materials.factory;
    const grass = f.get('grass'), dirt = f.get('dirt'), rock = f.get('rock'), sand = f.get('sand');
    const mat = new THREE.MeshStandardMaterial({
      map: grass.map, normalMap: grass.normalMap, roughness: 0.95, metalness: 0, vertexColors: true,
    });
    mat.normalScale.set(1.0, 1.0);
    this.terrainUniforms = {
      dirtMap: { value: dirt.map }, rockMap: { value: rock.map }, sandMap: { value: sand.map },
      dirtN: { value: dirt.normalMap }, rockN: { value: rock.normalMap }, sandN: { value: sand.normalMap },
      noiseMap: { value: f.noise(256) },
      uWet: { value: 0 },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.terrainUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 splat; varying vec4 vSplat; varying vec3 vWNormal; varying vec3 vWPos;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vSplat = splat;
          vWNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          vWPos = (modelMatrix * vec4(position, 1.0)).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D dirtMap, rockMap, sandMap, dirtN, rockN, sandN, noiseMap; uniform float uWet;
          varying vec4 vSplat; varying vec3 vWNormal; varying vec3 vWPos;
          // weights: grass, dirt, sand, rock, wheat, plowed
          float tW[6];
          float tRowAlong; float tFarK;
          vec4 tMac; vec4 tMac2;
          float tHash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
          void terrainWeights(){
            tMac = texture2D(noiseMap, vWPos.xz / 340.0);
            tMac2 = texture2D(noiseMap, vWPos.xz / 57.0 + vec2(0.37, 0.11));
            float rock = smoothstep(0.80 + (tMac2.r - 0.5) * 0.12, 0.64, vWNormal.y);
            // organic edges for dirt and sand instead of linear vertex interpolation
            float dirt = smoothstep(0.22, 0.7, vSplat.x + (tMac2.a - 0.5) * 0.55 * (1.0 - vSplat.x * 0.5));
            float sand = smoothstep(0.2, 0.7, vSplat.y + (tMac2.b - 0.5) * 0.4) * (1.0 - dirt);
            float wheat = vSplat.z * (1.0 - dirt);
            float plowed = vSplat.w * (1.0 - dirt);
            float grass = max(0.0, 1.0 - dirt - sand - wheat - plowed);
            float k = 1.0 - rock;
            tW[0] = grass * k; tW[1] = dirt * k; tW[2] = sand * k; tW[3] = rock; tW[4] = wheat * k; tW[5] = plowed * k;
            // crop rows run along x or z depending on the 140 m parcel
            float dirSel = step(0.5, tHash(floor(vWPos.xz / 140.0)));
            tRowAlong = mix(vWPos.x, vWPos.z, dirSel);
          }`)
        .replace('#include <map_fragment>', `
          terrainWeights();
          float camDist = length(vWPos - cameraPosition);
          tFarK = smoothstep(25.0, 160.0, camDist);
          vec2 tuv = vWPos.xz / 4.0;
          vec3 g1 = texture2D(map, tuv).rgb;
          vec3 g2 = texture2D(map, tuv * 0.21 + vec2(0.31, 0.77)).rgb;
          vec3 cg = mix(mix(g1, g2, 0.4), g2 * 1.05, tFarK * 0.7);
          // meadow variation: lush and dry patches, brightness drift
          float dry = smoothstep(0.3, 0.8, tMac.r) * 0.85 + (tMac2.g - 0.5) * 0.4;
          cg *= mix(vec3(0.88, 1.0, 0.84), vec3(1.28, 1.1, 0.7), clamp(dry, 0.0, 1.0));
          cg *= 0.74 + tMac2.b * 0.42 + (tMac.b - 0.5) * 0.2;
          float cgl = dot(cg, vec3(0.3, 0.59, 0.11));
          cg = mix(vec3(cgl) * vec3(1.06, 1.04, 0.84), cg, 0.72);
          vec3 cd = mix(texture2D(dirtMap, tuv * 0.9).rgb, texture2D(dirtMap, tuv * 0.23 + 0.5).rgb, 0.35 + tFarK * 0.4);
          cd *= 0.86 + tMac2.r * 0.28;
          vec3 cs = mix(texture2D(sandMap, tuv * 0.8).rgb, texture2D(sandMap, tuv * 0.2).rgb, 0.3);
          vec2 ruv = mix(vWPos.xz, vec2(vWPos.x + vWPos.z, vWPos.y), 0.5) / 7.0;
          vec3 cr = mix(texture2D(rockMap, ruv).rgb, texture2D(rockMap, ruv * 0.27).rgb, 0.4);
          cr *= 0.85 + tMac2.g * 0.3;
          // wheat: straw colour with drill rows (anti-aliased by screen-space derivative)
          float rp = tRowAlong * 2.6;
          float raa = clamp(fwidth(rp) * 1.2, 0.0, 1.0);
          float rowW = mix(sin(rp * 6.2832) * 0.5 + 0.5, 0.5, raa);
          float gl = dot(g1, vec3(0.3, 0.5, 0.2));
          vec3 cw = vec3(0.46, 0.36, 0.15) * (0.7 + gl * 2.2) * (0.82 + rowW * 0.3) * (0.88 + tMac2.b * 0.24);
          cw = mix(cw, cw * vec3(0.8, 0.95, 0.7), smoothstep(0.55, 0.9, tMac.g) * 0.6);
          // plowed: dark soil with furrows
          float fp = tRowAlong * 1.45;
          float faa = clamp(fwidth(fp) * 1.2, 0.0, 1.0);
          float fur = mix(sin(fp * 6.2832) * 0.5 + 0.5, 0.5, faa);
          vec3 cp = cd * vec3(0.72, 0.66, 0.6) * (0.65 + fur * 0.5);
          vec3 tcol = cg * tW[0] + cd * tW[1] + cs * tW[2] + cr * tW[3] * 1.12 + cw * tW[4] + cp * tW[5];
          tcol *= 1.0 - uWet * 0.3 * (1.0 - tW[3] * 0.4);
          diffuseColor.rgb *= tcol;`)
        .replace('#include <color_fragment>', `
          #if defined( USE_COLOR )
            diffuseColor.rgb *= mix(vColor, vec3(1.0), tW[3] * 0.8 + tW[4] * 0.6 + tW[5] * 0.5);
          #endif`)
        .replace('#include <roughnessmap_fragment>', `
          float roughnessFactor = roughness * (1.0 - uWet * 0.55 * (1.0 - tW[3] * 0.3));`)
        .replace('#include <normal_fragment_maps>', `
          vec3 nG = texture2D(normalMap, tuv).xyz;
          vec3 nD = texture2D(dirtN, tuv * 0.9).xyz;
          vec3 nS = texture2D(sandN, tuv * 0.8).xyz;
          vec3 nR = texture2D(rockN, ruv).xyz;
          vec3 mapN = (nG * (tW[0] + tW[4]) + nD * (tW[1] + tW[5]) + nS * tW[2] + nR * tW[3]) * 2.0 - 1.0;
          // furrow relief (slope of the furrow profile across the rows)
          float fslope = cos(fp * 6.2832) * (1.0 - faa) * 0.55 * tW[5];
          mapN.xy += (dirSelVec()) * fslope;
          mapN.xy *= normalScale * (0.55 + tW[3] * 0.8) * (1.0 - tFarK * 0.5);
          normal = normalize( tbn * mapN );`);
      // helper defined after terrainWeights so it can see tRowAlong's axis choice
      shader.fragmentShader = shader.fragmentShader.replace('void terrainWeights(){', `vec2 dirSelVec(){ return mix(vec2(1.0, 0.0), vec2(0.0, 1.0), step(0.5, tHash(floor(vWPos.xz / 140.0)))); }
          void terrainWeights(){`);
    };
    mat.customProgramCacheKey = () => 'terrain-splat-v2';
    this.material = mat;
  }

  _initVegetation() {
    const f = this.materials.factory;
    this.atlas = createVegetationAtlas();
    this.vegMaterial = new THREE.MeshStandardMaterial({ map: this.atlas, vertexColors: true, roughness: 0.88, metalness: 0, alphaTest: 0.5, side: THREE.DoubleSide });
    addWind(this.vegMaterial, 1, false);
    // alpha-tested shadow casting for foliage cards
    this.vegDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: this.atlas, alphaTest: 0.5, side: THREE.DoubleSide });
    this.rockMaterial = new THREE.MeshStandardMaterial({ map: f.get('rock').map, normalMap: f.get('rock').normalMap, vertexColors: true, roughness: 0.92 });
    grassUniforms.noiseMap.value = f.noise(256);
    this.grassMaterial = new THREE.MeshStandardMaterial({ map: createGrassTexture(), vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.42 });
    addWind(this.grassMaterial, 1, true);

    this.fernMaterial = new THREE.MeshStandardMaterial({ map: createFernTexture(), vertexColors: true, roughness: 0.9, metalness: 0, alphaTest: 0.45, side: THREE.DoubleSide });
    addWind(this.fernMaterial, 0.6, false);
    this.hayMaterial = this.materials.get('hay');
    const fern = makeFern();
    const build = (detail) => ({
      pineA: makePine(0, detail), pineB: makePine(1, detail), broadleaf: makeBroadleaf(0, detail), birch: makeBroadleaf(1, detail),
      dead: makeDeadTree(detail), bush: makeBush(detail), rockS: makeRock(false, detail), rockL: makeRock(true, detail), log: makeLog(detail),
      fern, hay: makeHayBale(detail),
    });
    this.vegGeos = { full: build('full'), mid: build('mid') };
    this.vegMeshes = { full: {}, mid: {} };
    for (const detail of ['full', 'mid']) {
      for (const t of VEG_TYPES) {
        const isRock = t === 'rockS' || t === 'rockL';
        const mat = isRock ? this.rockMaterial : t === 'fern' ? this.fernMaterial : t === 'hay' ? this.hayMaterial : this.vegMaterial;
        const mesh = new THREE.InstancedMesh(this.vegGeos[detail][t], mat, 16);
        if (!isRock && t !== 'fern' && t !== 'hay') mesh.customDepthMaterial = this.vegDepth;
        mesh.count = 0;
        mesh.castShadow = detail === 'full' && t !== 'fern';
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.name = `veg-${detail}-${t}`;
        this.scene.add(mesh);
        this.vegMeshes[detail][t] = mesh;
      }
    }
    this.farMeshes = [makeFarTree(false), makeFarTree(true)].map((g, i) => {
      const m = new THREE.InstancedMesh(g, this.vegMaterial, 16);
      m.count = 0;
      m.frustumCulled = false;
      m.name = `veg-far-${i}`;
      this.scene.add(m);
      return m;
    });
    this.grassGeo = makeGrassClump();
  }

  key(cx, cz) { return `${cx},${cz}`; }

  lodFor(dist) {
    if (dist <= 1) return 64;
    if (dist <= 2) return 32;
    return 16;
  }

  /** Remove everything (used on new game / quality change). */
  reset(keepWorkers = true) {
    for (const c of this.near.values()) this._disposeNear(c);
    for (const t of this.far.values()) this._disposeFar(t);
    this.near.clear();
    this.far.clear();
    this.queue.length = 0;
    this.pending.clear();
    this.center = { cx: 99999, cz: 99999 };
    this.vegDirty = true;
    void keepWorkers;
  }

  update(dt, pos, elapsed, wind) {
    windUniforms.uTime.value = elapsed;
    windUniforms.uWind.value = wind;
    const cx = Math.floor(pos.x / CHUNK), cz = Math.floor(pos.z / CHUNK);
    if (cx !== this.center.cx || cz !== this.center.cz) {
      this.center = { cx, cz };
      this._plan(pos);
    }
    this._dispatch();
    this.vegTimer -= dt;
    if (this.vegDirty && this.vegTimer <= 0) {
      this._rebuildVegetation();
      this.vegTimer = 0.3;
    }
  }

  /** Chunk ring that gets full-detail vegetation; the Low preset keeps it to the player's own chunk. */
  _fullRing() {
    return settings.get('vegetation') < 0.7 ? 0 : 1;
  }

  _plan(pos) {
    const { cx, cz } = this.center;
    const want = new Map();
    for (let dz = -NEAR_R; dz <= NEAR_R; dz++) {
      for (let dx = -NEAR_R; dx <= NEAR_R; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dz));
        want.set(this.key(cx + dx, cz + dz), { cx: cx + dx, cz: cz + dz, segs: this.lodFor(d), d });
      }
    }
    // unload near chunks out of range (with one ring of hysteresis)
    for (const [k, c] of this.near) {
      if (Math.max(Math.abs(c.cx - cx), Math.abs(c.cz - cz)) > NEAR_R + 1) {
        this._disposeNear(c);
        this.near.delete(k);
        this.vegDirty = true;
        this._markFarHoles(c);
      }
    }
    this.queue = this.queue.filter((q) => q.kind !== 'near');
    for (const [k, w] of want) {
      const c = this.near.get(k);
      if (c) {
        const vegLevel = w.d <= this._fullRing() ? 'full' : 'mid';
        if (c.vegLevel !== vegLevel) { c.vegLevel = vegLevel; this.vegDirty = true; }
        this._updateColliders(c, w.d);
        c.mesh.castShadow = w.d <= 1;
        if (c.segs === w.segs) continue;
      }
      if (this.pending.has('n' + k + ':' + w.segs)) continue;
      this.queue.push({ kind: 'near', key: k, cx: w.cx, cz: w.cz, segs: w.segs, d: w.d, prio: w.d });
    }

    // far tiles
    const vd = settings.get('viewDistance');
    const fr = Math.ceil(vd / FAR);
    const fcx = Math.floor(pos.x / FAR), fcz = Math.floor(pos.z / FAR);
    const wantFar = new Set();
    for (let dz = -fr; dz <= fr; dz++) {
      for (let dx = -fr; dx <= fr; dx++) {
        const tx = fcx + dx, tz = fcz + dz;
        // distance from player to tile rectangle
        const nx = Math.max(tx * FAR, Math.min(pos.x, (tx + 1) * FAR));
        const nz = Math.max(tz * FAR, Math.min(pos.z, (tz + 1) * FAR));
        if (Math.hypot(nx - pos.x, nz - pos.z) > vd + 200) continue;
        const k = this.key(tx, tz);
        wantFar.add(k);
        if (!this.far.has(k) && !this.pending.has('f' + k)) {
          this.queue.push({ kind: 'far', key: k, tx, tz, prio: 4 + Math.max(Math.abs(dx), Math.abs(dz)) });
        }
      }
    }
    for (const [k, t] of this.far) {
      if (!wantFar.has(k)) {
        this._disposeFar(t);
        this.far.delete(k);
        this.vegDirty = true;
      }
    }
    this.queue.sort((a, b) => a.prio - b.prio);
  }

  _dispatch() {
    const veg = settings.get('vegetation');
    const grass = settings.get('grass');
    // main-thread fallback: one job per frame
    if (!this.workers.length) {
      const job = this.queue.shift();
      if (job) this._complete(job, generateChunk(this.world, this._params(job, veg, grass)));
      return;
    }
    for (let i = 0, guard = 0; i < this.workers.length && this.queue.length && guard < 12; guard++) {
      if (this.workerBusy[i] > 2) { i++; continue; }
      const job = this.queue.shift();
      const id = this.reqId++;
      job.id = id;
      this.pending.set(job.kind === 'near' ? 'n' + job.key + ':' + job.segs : 'f' + job.key, job);
      this.pending.set(id, job);
      this.workerBusy[i]++;
      job.worker = i;
      this.workers[i].postMessage({ id, params: this._params(job, veg, grass) });
    }
  }

  _params(job, veg, grass) {
    if (job.kind === 'near') {
      return {
        x0: job.cx * CHUNK, z0: job.cz * CHUNK, size: CHUNK, segs: job.segs,
        veg: true, grass: grass && job.segs === 64, vegDensity: veg,
      };
    }
    return { x0: job.tx * FAR, z0: job.tz * FAR, size: FAR, segs: 32, far: true, farVeg: true, vegDensity: veg };
  }

  /** Ask a worker to render the topographic map image. cb(Uint8ClampedArray, size) */
  requestMap(size, cb) {
    const id = this.reqId++;
    this.mapCallbacks = this.mapCallbacks || new Map();
    this.mapCallbacks.set(id, cb);
    if (this.workers.length) this.workers[this.workers.length - 1].postMessage({ id, map: size });
    else import('./MapGenerator.js').then((m) => cb(m.generateMapImage(this.world, size), size));
  }

  _onWorkerMessage(i, msg) {
    if (msg.ready) return;
    if (msg.map) {
      const cb = this.mapCallbacks?.get(msg.id);
      this.mapCallbacks?.delete(msg.id);
      cb?.(msg.map, msg.size);
      return;
    }
    const job = this.pending.get(msg.id);
    this.workerBusy[i] = Math.max(0, this.workerBusy[i] - 1);
    if (!job) return;
    this.pending.delete(msg.id);
    this.pending.delete(job.kind === 'near' ? 'n' + job.key + ':' + job.segs : 'f' + job.key);
    if (msg.error) {
      console.error('[Terrain] chunk failed', msg.error);
      return;
    }
    this._complete(job, msg.out);
    // keep workers fed without waiting for the next rendered frame
    this._dispatch();
  }

  _geometry(out, x0, z0) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(out.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(out.nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(out.col, 3));
    g.setAttribute('splat', new THREE.BufferAttribute(out.spl, 4));
    g.setAttribute('uv', new THREE.BufferAttribute(out.uv, 2));
    g.setIndex(new THREE.BufferAttribute(out.index, 1));
    g.computeBoundingSphere();
    void x0; void z0;
    return g;
  }

  _complete(job, out) {
    if (job.kind === 'near') {
      const { cx, cz } = this.center;
      const d = Math.max(Math.abs(job.cx - cx), Math.abs(job.cz - cz));
      if (d > NEAR_R + 1) return; // stale
      const x0 = job.cx * CHUNK, z0 = job.cz * CHUNK;
      const mesh = new THREE.Mesh(this._geometry(out, x0, z0), this.material);
      mesh.position.set(x0, 0, z0);
      mesh.receiveShadow = true;
      mesh.castShadow = d <= 1;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.name = `chunk ${job.key}`;
      this.group.add(mesh);
      const old = this.near.get(job.key);
      const chunk = {
        key: job.key, cx: job.cx, cz: job.cz, segs: job.segs, mesh, veg: out.veg || old?.veg,
        vegLevel: d <= this._fullRing() ? 'full' : 'mid', colliders: old?.colliders || null, grassMesh: null,
      };
      if (old) {
        this.group.remove(old.mesh);
        old.mesh.geometry.dispose();
        if (old.grassMesh && !out.grass) { chunk.grassMesh = old.grassMesh; old.grassMesh = null; }
        if (old.grassMesh) { this.scene.remove(old.grassMesh); old.grassMesh.dispose(); }
      }
      if (out.grass && out.grass.length) chunk.grassMesh = this._buildGrass(out.grass);
      if (!this.near.has(job.key) || !old) this._markFarHoles(chunk);
      this.near.set(job.key, chunk);
      this._updateColliders(chunk, d);
      this.vegDirty = true;
      if (!this.ready && this.near.size >= 9) {
        this.ready = true;
        bus.emit('terrain:ready');
      }
    } else {
      const x0 = job.tx * FAR, z0 = job.tz * FAR;
      const mesh = new THREE.Mesh(this._geometry(out, x0, z0), this.material);
      mesh.position.set(x0, 0, z0);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.receiveShadow = false;
      mesh.name = `far ${job.key}`;
      this.group.add(mesh);
      const tile = { key: job.key, tx: job.tx, tz: job.tz, mesh, fullIndex: out.index, farVeg: out.farVeg };
      this.far.set(job.key, tile);
      this._applyHoles(tile);
      this.vegDirty = true;
    }
  }

  _buildGrass(data) {
    const count = data.length / 6;
    const mesh = new THREE.InstancedMesh(this.grassGeo, this.grassMaterial, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const tints = [new THREE.Color(1.0, 1.0, 0.95), new THREE.Color(1.35, 1.2, 0.85), new THREE.Color(2.0, 1.6, 0.8)];
    for (let i = 0; i < count; i++) {
      const o = i * 6;
      p.set(data[o], data[o + 1], data[o + 2]);
      q.setFromAxisAngle(up, data[o + 3]);
      const sc = data[o + 4];
      s.set(sc, sc * (0.75 + (i % 7) * 0.08) * (data[o + 5] === 2 ? 1.6 : 1), sc);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, tints[data[o + 5]] || tints[0]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    mesh.name = 'grass';
    this.scene.add(mesh);
    return mesh;
  }

  _disposeNear(c) {
    this.group.remove(c.mesh);
    c.mesh.geometry.dispose();
    if (c.grassMesh) { this.scene.remove(c.grassMesh); c.grassMesh.dispose(); }
    if (c.colliders) for (const col of c.colliders) this.physics.remove(col);
    c.colliders = null;
  }

  _disposeFar(t) {
    this.group.remove(t.mesh);
    t.mesh.geometry.dispose();
  }

  /** Colliders for trunks/rocks/bushes exist only for chunks within 2 rings. */
  _updateColliders(c, d) {
    if (d <= 2 && !c.colliders && c.veg) {
      c.colliders = [];
      const v = c.veg;
      for (let i = 0; i < v.length; i += 6) {
        const t = VEG_TYPES[v[i]];
        const x = v[i + 1], y = v[i + 2], z = v[i + 3], s = v[i + 5];
        if (t === 'pineA' || t === 'pineB' || t === 'broadleaf' || t === 'birch' || t === 'dead') {
          c.colliders.push(this.physics.addCylinder(x, z, 0.28 * s + 0.08, y - 1, y + 9 * s, { material: 'wood', tag: 'tree' }));
        } else if (t === 'rockL') {
          c.colliders.push(this.physics.addCylinder(x, z, 2.3 * s, y - 1, y + 1.6 * s, { material: 'rock', tag: 'rock' }));
        } else if (t === 'rockS') {
          c.colliders.push(this.physics.addCylinder(x, z, 0.7 * s, y - 1, y + 0.45 * s, { material: 'rock', tag: 'rock' }));
        } else if (t === 'bush') {
          c.colliders.push(this.physics.addCylinder(x, z, 1.0 * s, y, y + 1.3 * s, { material: 'fabric', tag: 'bush', blocksMove: false, blocksShots: false, blocksSight: true }));
        } else if (t === 'hay') {
          c.colliders.push(this.physics.addCylinder(x, z, 0.85 * s, y, y + 1.45 * s, { material: 'fabric', tag: 'hay' }));
        } else if (t === 'log') {
          c.colliders.push(this.physics.addCylinder(x, z, 0.5, y, y + 0.65, { material: 'wood', tag: 'log' }));
        }
      }
    } else if (d > 2 && c.colliders) {
      for (const col of c.colliders) this.physics.remove(col);
      c.colliders = null;
    }
  }

  _markFarHoles(chunk) {
    const x0 = chunk.cx * CHUNK, z0 = chunk.cz * CHUNK;
    const tx = Math.floor(x0 / FAR), tz = Math.floor(z0 / FAR);
    const t = this.far.get(this.key(tx, tz));
    if (t) this._applyHoles(t);
  }

  _applyHoles(tile) {
    const segs = 32, n = segs + 1, step = FAR / segs;
    const x0 = tile.tx * FAR, z0 = tile.tz * FAR;
    const src = tile.fullIndex;
    // Rebuild the main grid part skipping cells covered by built near chunks;
    // keep skirt indices (everything after the grid triangles) intact.
    const gridTris = segs * segs * 6;
    const idx = [];
    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < segs; i++) {
        const cx = Math.floor((x0 + (i + 0.5) * step) / CHUNK), cz = Math.floor((z0 + (j + 0.5) * step) / CHUNK);
        if (this.near.has(this.key(cx, cz))) continue;
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, c, b, c, d, b);
      }
    }
    for (let k = gridTris; k < src.length; k++) idx.push(src[k]);
    tile.mesh.geometry.setIndex(idx);
  }

  _rebuildVegetation() {
    this.vegDirty = false;
    const counts = { full: {}, mid: {} };
    const lists = { full: {}, mid: {} };
    for (const d of ['full', 'mid']) for (const t of VEG_TYPES) { counts[d][t] = 0; lists[d][t] = []; }
    for (const c of this.near.values()) {
      if (!c.veg) continue;
      const lv = c.vegLevel;
      const v = c.veg;
      for (let i = 0; i < v.length; i += 6) {
        const t = VEG_TYPES[v[i]];
        if (t === 'fern' && lv !== 'full') continue;
        lists[lv][t].push(i, c);
      }
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const d of ['full', 'mid']) {
      for (const t of VEG_TYPES) {
        const list = lists[d][t];
        const count = list.length / 2;
        let mesh = this.vegMeshes[d][t];
        if (mesh.instanceMatrix.count < count) {
          const cap = Math.ceil(count * 1.4) + 16;
          const nm = new THREE.InstancedMesh(mesh.geometry, mesh.material, cap);
          nm.castShadow = mesh.castShadow; nm.receiveShadow = true; nm.frustumCulled = false; nm.name = mesh.name;
          nm.customDepthMaterial = mesh.customDepthMaterial;
          this.scene.remove(mesh);
          mesh.dispose();
          this.scene.add(nm);
          this.vegMeshes[d][t] = mesh = nm;
        }
        const isTree = t !== 'rockS' && t !== 'rockL' && t !== 'log' && t !== 'hay';
        for (let k = 0; k < count; k++) {
          const i = list[k * 2], v = list[k * 2 + 1].veg;
          const x = v[i + 1], z = v[i + 3];
          p.set(x, v[i + 2] - 0.15, z);
          q.setFromAxisAngle(up, v[i + 4]);
          const sc = v[i + 5];
          // per-instance proportions and tint so neighbouring copies don't read as clones
          const h1 = fract(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453);
          const h2 = fract(Math.sin(x * 39.346 + z * 11.135) * 24634.6345);
          const h3 = fract(Math.sin(x * 73.156 + z * 52.235) * 13758.5453);
          const wx = 0.86 + h1 * 0.28, wy = 0.84 + h2 * 0.32;
          s.set(sc * wx, sc * wy, sc * (0.86 + h3 * 0.28));
          m.compose(p, q, s);
          mesh.setMatrixAt(k, m);
          if (isTree) _tint.setRGB(0.88 + h3 * 0.2 + h1 * 0.08, 0.9 + h3 * 0.14, 0.86 + h2 * 0.12).multiplyScalar(0.86 + h2 * 0.2);
          else _tint.setRGB(0.85 + h1 * 0.25, 0.85 + h1 * 0.22, 0.85 + h1 * 0.2);
          mesh.setColorAt(k, _tint);
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    // far impostors outside the near region
    const farLists = [[], []];
    for (const t of this.far.values()) {
      const v = t.farVeg;
      if (!v) continue;
      for (let i = 0; i < v.length; i += 6) {
        const cx = Math.floor(v[i + 1] / CHUNK), cz = Math.floor(v[i + 3] / CHUNK);
        if (this.near.has(this.key(cx, cz))) continue;
        farLists[v[i]].push(i, v);
      }
    }
    for (let f = 0; f < 2; f++) {
      const list = farLists[f];
      const count = list.length / 2;
      let mesh = this.farMeshes[f];
      if (mesh.instanceMatrix.count < count) {
        const nm = new THREE.InstancedMesh(mesh.geometry, mesh.material, Math.ceil(count * 1.3) + 16);
        nm.frustumCulled = false; nm.name = mesh.name;
        this.scene.remove(mesh); mesh.dispose(); this.scene.add(nm);
        this.farMeshes[f] = mesh = nm;
      }
      for (let k = 0; k < count; k++) {
        const i = list[k * 2], v = list[k * 2 + 1];
        p.set(v[i + 1], v[i + 2] - 0.3, v[i + 3]);
        q.identity();
        const sc = v[i + 5];
        s.set(sc, sc, sc);
        m.compose(p, q, s);
        mesh.setMatrixAt(k, m);
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Remaining jobs (for loading screens). */
  get backlog() {
    return this.queue.length + this.pending.size / 2;
  }

  setWet(w) {
    this.terrainUniforms.uWet.value = w;
  }
}
