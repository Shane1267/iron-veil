import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash2, hashString } from '../core/MathUtil.js';
import { settings } from '../core/SettingsManager.js';
import { BoxBuilder } from './GeometryKit.js';

// Roads, railways, bridges, power lines, roadside wrecks and water surfaces. Built per
// 512 m tile when the tile comes within view distance and released afterwards.

const TILE = 512;

export class Infrastructure {
  constructor(scene, world, physics, materials, interactables, loot) {
    this.scene = scene;
    this.world = world;
    this.physics = physics;
    this.materials = materials;
    this.interactables = interactables;
    this.loot = loot;
    this.tiles = new Map();
    this.lastTile = null;

    const f = materials.factory;
    const road = f.get('road'), dirt = f.get('dirtroad'), asphalt = f.get('asphalt'), water = f.get('water');
    const off = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
    this.roadMat = new THREE.MeshStandardMaterial({ map: road.map, normalMap: road.normalMap, roughnessMap: road.roughnessMap, roughness: 0.9, ...off });
    this.dirtMat = new THREE.MeshStandardMaterial({ map: dirt.map, normalMap: dirt.normalMap, roughness: 0.95, transparent: true, depthWrite: false, ...off });
    this.roadUniforms = { noiseMap: { value: f.noise(256) }, uWet: { value: 0 } };
    this._roadShader(this.roadMat, false);
    this._roadShader(this.dirtMat, true);
    this.ballastMat = new THREE.MeshStandardMaterial({ map: asphalt.map, normalMap: asphalt.normalMap, color: 0xa89884, roughness: 0.95, ...off });
    this.railMat = new THREE.MeshStandardMaterial({ color: 0x6a5e54, roughness: 0.45, metalness: 0.8 });
    this.sleeperMat = materials.get('wood_dark');
    this.poleMat = materials.get('wood_dark');
    this.wireMat = new THREE.LineBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.8 });

    water.normalMap.repeat.set(1, 1);
    this.waterUniforms = { uTime: { value: 0 } };
    this.waterMat = new THREE.MeshStandardMaterial({
      color: 0x2c4440, roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.86,
      normalMap: water.normalMap, envMapIntensity: 1.4,
    });
    this.waterMat.normalScale.set(0.35, 0.35);
    this.waterMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.waterUniforms.uTime;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <normal_fragment_maps>', `
          vec3 n1 = texture2D(normalMap, vNormalMapUv + vec2(uTime*0.012, uTime*0.007)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(normalMap, vNormalMapUv * 0.47 - vec2(uTime*0.009, -uTime*0.011)).xyz * 2.0 - 1.0;
          vec3 mapN = normalize(vec3((n1.xy + n2.xy) * normalScale, n1.z * n2.z));
          normal = normalize( tbn * mapN );`);
    };
    this.waterMat.customProgramCacheKey = () => 'water-v1';

    this._buildPoleGeo();
    this._buildWreckGeos();
    this._buildLake();
    this._indexFeatures();
  }

  /**
   * Road surface detail: paved roads get crumbling, irregular edges (alpha-tested),
   * darker tyre tracks, patch repairs and puddle sheen when wet; dirt tracks fade
   * into the surrounding grass with a noisy edge.
   */
  _roadShader(mat, dirt) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.noiseMap = this.roadUniforms.noiseMap;
      shader.uniforms.uWet = this.roadUniforms.uWet;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRWPos; varying vec2 vRUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vRUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D noiseMap; uniform float uWet; varying vec3 vRWPos; varying vec2 vRUv;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec4 rn = texture2D(noiseMap, vRWPos.xz / 23.0);
          vec4 rn2 = texture2D(noiseMap, vRWPos.xz / 5.3 + 0.21);
          float edge = min(vRUv.x, 1.0 - vRUv.x);
          ${dirt ? `
          float a = smoothstep(0.02, 0.22 + rn.r * 0.12, edge + (rn2.g - 0.5) * 0.12);
          diffuseColor.a *= a;
          diffuseColor.rgb *= 0.88 + rn.b * 0.24;` : `
          // ragged asphalt edge
          if (edge < 0.012 + rn2.r * 0.05 * smoothstep(0.35, 0.8, rn.g)) discard;
          // wheel tracks, patches and grime
          float track = exp(-pow((vRUv.x - 0.28) / 0.06, 2.0)) + exp(-pow((vRUv.x - 0.72) / 0.06, 2.0));
          diffuseColor.rgb *= 1.0 - track * 0.12;
          float patchM = smoothstep(0.7, 0.72, rn.a) * (1.0 - step(0.44, abs(vRUv.x - 0.5)));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.045, 0.047), patchM * 0.85);
          diffuseColor.rgb *= 0.86 + rn.b * 0.22;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.95, 0.93, 0.85), smoothstep(0.38, 0.5, abs(vRUv.x - 0.5)) * 0.6);`}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          // puddles collect in the tracks when it rains
          roughnessFactor = mix(roughnessFactor, 0.08, uWet * ${dirt ? 'smoothstep(0.55, 0.7, rn2.b)' : 'clamp(track * 0.8 + smoothstep(0.6, 0.75, rn2.b), 0.0, 1.0)'});`);
    };
    mat.customProgramCacheKey = () => `road-${dirt ? 'dirt' : 'paved'}-v1`;
  }

  setWet(w) { this.roadUniforms.uWet.value = w; }

  // ---------------------------------------------------------- feature indexing
  _indexFeatures() {
    // Split every road / rail / river into pieces and assign them to tiles by midpoint.
    this.pieces = new Map();
    const addPiece = (kind, ref, i0, i1) => {
      const pts = ref.points;
      const mid = pts[Math.floor((i0 + i1) / 2)];
      const k = `${Math.floor(mid[0] / TILE)},${Math.floor(mid[1] / TILE)}`;
      if (!this.pieces.has(k)) this.pieces.set(k, []);
      this.pieces.get(k).push({ kind, ref, i0, i1 });
    };
    for (const r of this.world.roads) {
      for (let i = 0; i < r.points.length - 1; i += 30) addPiece(r.type === 'rail' ? 'rail' : 'road', r, i, Math.min(r.points.length - 1, i + 30));
    }
    for (const r of this.world.rivers) {
      for (let i = 0; i < r.points.length - 1; i += 16) addPiece('river', r, i, Math.min(r.points.length - 1, i + 16));
    }
    this.bridgeTiles = new Map();
    for (const b of this.world.bridges) {
      const k = `${Math.floor((b.ax + b.bx) / 2 / TILE)},${Math.floor((b.az + b.bz) / 2 / TILE)}`;
      if (!this.bridgeTiles.has(k)) this.bridgeTiles.set(k, []);
      this.bridgeTiles.get(k).push(b);
    }
  }

  update(dt, pos, elapsed) {
    this.waterUniforms.uTime.value = elapsed;
    const tx = Math.floor(pos.x / TILE), tz = Math.floor(pos.z / TILE);
    const key = `${tx},${tz}`;
    if (key === this.lastTile) return;
    this.lastTile = key;
    const vd = settings.get('viewDistance');
    const r = Math.ceil(vd / TILE);
    const want = new Set();
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const k = `${tx + dx},${tz + dz}`;
        want.add(k);
        const near = Math.max(Math.abs(dx), Math.abs(dz)) <= 1;
        const t = this.tiles.get(k);
        if (!t) this.tiles.set(k, this._buildTile(tx + dx, tz + dz, near));
        else if (near && !t.near) { this._disposeTile(t); this.tiles.set(k, this._buildTile(tx + dx, tz + dz, true)); }
      }
    }
    for (const [k, t] of this.tiles) {
      if (!want.has(k)) { this._disposeTile(t); this.tiles.delete(k); }
    }
  }

  // ---------------------------------------------------------- tile construction
  _buildTile(tx, tz, near) {
    const k = `${tx},${tz}`;
    const group = new THREE.Group();
    group.name = `infra ${k}`;
    const tile = { key: k, group, near, colliders: [], interactables: [] };
    const pieces = this.pieces.get(k) || [];
    for (const p of pieces) {
      if (p.kind === 'road') this._roadPiece(p, group, tile, near);
      else if (p.kind === 'rail') this._railPiece(p, group, near);
      else if (p.kind === 'river') this._riverPiece(p, group);
    }
    for (const b of this.bridgeTiles.get(k) || []) this._bridge(b, group, tile);
    this.scene.add(group);
    return tile;
  }

  _disposeTile(t) {
    this.scene.remove(t.group);
    t.group.traverse((o) => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); });
    for (const c of t.colliders) this.physics.remove(c);
    for (const i of t.interactables) this.interactables.remove(i);
  }

  _ribbon(points, i0, i1, width, heightFn, vScale, lift) {
    const verts = [], uvs = [], norms = [], idx = [];
    let dist = 0;
    for (let i = i0; i <= i1; i++) {
      const [x, z] = points[i];
      const prev = points[Math.max(i0, i - 1)], next = points[Math.min(i1, i + 1)];
      let dx = next[0] - prev[0], dz = next[1] - prev[1];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const nx = -dz, nz = dx;
      if (i > i0) dist += Math.hypot(x - points[i - 1][0], z - points[i - 1][1]);
      for (let s = 0; s < 2; s++) {
        const side = s === 0 ? -0.5 : 0.5;
        const px = x + nx * width * side, pz = z + nz * width * side;
        const h = heightFn(i, px, pz) + lift;
        verts.push(px, h, pz);
        norms.push(0, 1, 0);
        uvs.push(s, dist / vScale);
      }
      if (i > i0) {
        const a = (i - i0 - 1) * 2;
        // counter-clockwise seen from above so the ribbon faces up (front side)
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  _roadHeight(road) {
    return (i, x, z) => {
      const deck = this.world.bridgeAt(x, z);
      const h = road.heights[i];
      return deck !== null ? Math.max(deck, h) : h;
    };
  }

  _roadPiece(p, group, tile, near) {
    const road = p.ref;
    const g = this._ribbon(road.points, p.i0, p.i1, road.width + (road.type === 'dirt' ? 2.2 : 0.4), this._roadHeight(road), road.type === 'dirt' ? 8 : 14, 0.07);
    const mesh = new THREE.Mesh(g, road.type === 'dirt' ? this.dirtMat : this.roadMat);
    mesh.receiveShadow = true;
    if (road.type === 'dirt') mesh.renderOrder = 1;
    group.add(mesh);

    if (road.type !== 'dirt') this._powerLine(road, p, group, near);
    if (road.type !== 'dirt' && near) this._roadSigns(road, p, group);
    // roadside wrecks (also lootable)
    const seed = hashString(road.id);
    const wrecks = [];
    for (let i = p.i0 + 1; i < p.i1; i++) {
      if (hash2(i, seed, 5) > 0.022) continue;
      const [x, z] = road.points[i];
      if (this.world.nearestPOI(x, z).d < 140) continue;
      const [nx2, nz2] = road.points[i + 1];
      const ang = Math.atan2(nx2 - x, nz2 - z) + (hash2(i, seed, 6) - 0.5) * 0.8;
      const side = hash2(i, seed, 7) < 0.5 ? -1 : 1;
      const off = road.width * 0.5 + 1.4;
      const px = x + Math.cos(ang) * off * side, pz = z - Math.sin(ang) * off * side;
      const py = this.world.heightAt(px, pz);
      wrecks.push({ x: px, y: py, z: pz, rot: ang, variant: Math.floor(hash2(i, seed, 8) * this.wreckGeos.length), id: `wreck:${road.id}:${i}` });
    }
    for (const w of wrecks) {
      const geo = this.wreckGeos[w.variant];
      const m = new THREE.Mesh(geo.geo, geo.mat);
      m.userData.shared = true;
      m.position.set(w.x, w.y, w.z);
      m.rotation.set(geo.tilt || 0, w.rot, (geo.tilt || 0) * 0.5, 'YXZ');
      m.castShadow = near; m.receiveShadow = true;
      group.add(m);
      // three circular colliders along the car's length
      const fx = Math.sin(w.rot), fz = Math.cos(w.rot);
      for (const o of [-1.5, 0, 1.5]) {
        tile.colliders.push(this.physics.addCylinder(w.x + fx * o, w.z + fz * o, 0.95, w.y - 0.5, w.y + 1.4, { material: 'metal', tag: 'wreck' }));
      }
      if (this.loot) {
        tile.interactables.push(this.interactables.add({
          id: w.id, kind: 'container', x: w.x - fx * 2.2, y: w.y + 0.9, z: w.z - fz * 2.2, radius: 1.6,
          label: 'Search car trunk', data: { containerId: w.id, profile: hash2(w.x | 0, w.z | 0, 3) < 0.5 ? 'fuel' : 'residential', capacity: 12, name: 'Car Trunk' },
        }));
      }
    }
  }

  _railPiece(p, group, near) {
    const r = p.ref;
    const hf = (i, x, z) => {
      const deck = this.world.bridgeAt(x, z);
      return deck !== null ? Math.max(deck, r.heights[i]) : r.heights[i];
    };
    group.add(new THREE.Mesh(this._ribbon(r.points, p.i0, p.i1, 3.6, hf, 6, 0.1), this.ballastMat));
    for (const off of [-0.72, 0.72]) {
      const pts = [];
      for (let i = p.i0; i <= p.i1; i++) {
        const [x, z] = r.points[i];
        const next = r.points[Math.min(p.i1, i + 1)], prev = r.points[Math.max(p.i0, i - 1)];
        let dx = next[0] - prev[0], dz = next[1] - prev[1];
        const l = Math.hypot(dx, dz) || 1;
        pts.push([x - (dz / l) * off, z + (dx / l) * off]);
      }
      const g = this._ribbon(pts, 0, pts.length - 1, 0.09, (i, x, z) => hf(i + p.i0, x, z), 4, 0.32);
      const m = new THREE.Mesh(g, this.railMat);
      group.add(m);
    }
    if (!near) return;
    // sleepers
    const count = Math.floor(((p.i1 - p.i0) * 12) / 0.75);
    const sl = new THREE.InstancedMesh(this._sleeperGeo || (this._sleeperGeo = new THREE.BoxGeometry(2.4, 0.16, 0.24)), this.sleeperMat, count);
    sl.userData.shared = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    let n = 0;
    for (let i = p.i0; i < p.i1 && n < count; i++) {
      const [ax, az] = r.points[i], [bx, bz] = r.points[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const ang = Math.atan2(bx - ax, bz - az);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang + Math.PI / 2);
      for (let d = 0; d < len && n < count; d += 0.75) {
        const t = d / len;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        v.set(x, hf(i, x, z) + (r.heights[i + 1] - r.heights[i]) * t * 0 + 0.2, z);
        m.compose(v, q, s);
        sl.setMatrixAt(n++, m);
      }
    }
    sl.count = n;
    sl.instanceMatrix.needsUpdate = true;
    sl.computeBoundingSphere();
    sl.receiveShadow = true;
    group.add(sl);
  }

  _riverPiece(p, group) {
    const r = p.ref;
    const g = this._ribbon(r.points, p.i0, p.i1, r.width + 9, (i) => r.water[i], 10, 0);
    // scale UVs into world space for the normal map
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 9, pos.getZ(i) / 9);
    const m = new THREE.Mesh(g, this.waterMat);
    m.renderOrder = 2;
    group.add(m);
  }

  _buildLake() {
    const L = this.world.lake;
    const g = new THREE.CircleGeometry(1, 96);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) * L.radius[0] * 1.75 + L.center[0];
      const z = pos.getZ(i) * L.radius[1] * 1.75 + L.center[1];
      pos.setXYZ(i, x, L.level, z);
      uv.setXY(i, x / 9, z / 9);
    }
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.waterMat);
    m.renderOrder = 2;
    m.name = 'lake';
    this.scene.add(m);
  }

  _bridge(b, group, tile) {
    const len = Math.hypot(b.bx - b.ax, b.bz - b.az) + 6;
    const ang = Math.atan2(b.bx - b.ax, b.bz - b.az);
    const cx = (b.ax + b.bx) / 2, cz = (b.az + b.bz) / 2;
    const kit = new BoxBuilder(this.materials);
    const w = b.width + 1.2;
    kit.box('concrete', 0, -0.45, 0, w, 0.8, len);
    kit.box('concrete', -w / 2 + 0.15, 0.45, 0, 0.3, 0.9, len);
    kit.box('concrete', w / 2 - 0.15, 0.45, 0, 0.3, 0.9, len);
    const riverBed = this.world.heightRaw(cx, cz);
    const pierH = b.deck - riverBed + 2;
    for (const o of [-len * 0.28, len * 0.28]) {
      kit.box('concrete_dark', 0, -pierH / 2 - 0.8, o, w * 0.7, pierH, 1.4);
      kit.box('concrete', 0, -0.95, o, w * 0.85, 0.3, 1.8); // pier cap
    }
    // edge beams, steel railings on posts, drainage spouts
    for (const sx of [-1, 1]) {
      kit.box('concrete_dark', sx * (w / 2 + 0.05), -0.35, 0, 0.12, 0.9, len);
      for (let d = -len / 2 + 0.6; d <= len / 2 - 0.5; d += 2.0) kit.box('metal_dark', sx * (w / 2 - 0.15), 1.15, d, 0.08, 0.6, 0.08);
      kit.box('metal', sx * (w / 2 - 0.15), 1.45, 0, 0.1, 0.08, len - 0.6);
      kit.box('metal', sx * (w / 2 - 0.15), 1.15, 0, 0.05, 0.05, len - 0.6);
      for (let d = -len / 2 + 3; d < len / 2 - 2; d += 7) kit.cylinder('metal_dark', sx * (w / 2 + 0.2), -0.55, d, 0.05, 0.05, 0.4, 6, { rotZ: Math.PI / 2 });
    }
    const mesh = kit.build();
    mesh.position.set(cx, b.deck, cz);
    mesh.rotation.y = ang;
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    // railings stop the player falling off: rows of small cylinders along both sides
    const fx = Math.sin(ang), fz = Math.cos(ang), rx = Math.cos(ang), rz = -Math.sin(ang);
    for (let d = -len / 2; d <= len / 2; d += 0.8) {
      for (const side of [-1, 1]) {
        const x = cx + fx * d + rx * side * (w / 2 - 0.15), z = cz + fz * d + rz * side * (w / 2 - 0.15);
        tile.colliders.push(this.physics.addCylinder(x, z, 0.25, b.deck, b.deck + 1.0, { material: 'concrete', tag: 'rail', blocksSight: false }));
      }
    }
  }

  // ---------------------------------------------------------- power lines
  _buildPoleGeo() {
    const pole = new THREE.CylinderGeometry(0.11, 0.15, 9, 6);
    pole.translate(0, 4.5, 0);
    const bar = new THREE.BoxGeometry(2.0, 0.12, 0.12);
    bar.translate(0, 8.4, 0);
    const insul = new THREE.CylinderGeometry(0.05, 0.05, 0.2, 5);
    const parts = [pole, bar];
    for (const x of [-0.85, 0, 0.85]) parts.push(insul.clone().translate(x, 8.56, 0));
    for (const p of parts) { if (p.index) continue; }
    const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()));
    const col = new Float32Array(merged.attributes.position.count * 3).fill(1);
    merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.poleGeo = merged;
  }

  _powerLine(road, p, group, near) {
    const spacing = 4; // every 4 samples = 48 m
    const poles = [];
    for (let i = p.i0 - (p.i0 % spacing); i <= p.i1; i += spacing) {
      if (i < p.i0) continue;
      const [x, z] = road.points[i];
      const next = road.points[Math.min(road.points.length - 1, i + 1)], prev = road.points[Math.max(0, i - 1)];
      let dx = next[0] - prev[0], dz = next[1] - prev[1];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const off = road.width * 0.5 + 4.5;
      const px = x - dz * off, pz = z + dx * off;
      if (this.world.waterAt(px, pz) !== null) continue;
      const tilt = (hash2(i, hashString(road.id), 9) - 0.5) * 0.08;
      poles.push({ x: px, z: pz, y: this.world.heightAt(px, pz), ang: Math.atan2(dx, dz), tilt });
    }
    if (!poles.length) return;
    const inst = new THREE.InstancedMesh(this.poleGeo, this.poleMat, poles.length);
    inst.userData.shared = true;
    const m = new THREE.Matrix4(), e = new THREE.Euler();
    poles.forEach((pl, k) => {
      e.set(pl.tilt, pl.ang + Math.PI / 2, pl.tilt * 0.5);
      m.makeRotationFromEuler(e);
      m.setPosition(pl.x, pl.y - 0.3, pl.z);
      inst.setMatrixAt(k, m);
    });
    inst.castShadow = near;
    inst.computeBoundingSphere();
    group.add(inst);
    // sagging wires between consecutive poles
    const segs = [];
    for (let k = 0; k < poles.length - 1; k++) {
      const a = poles[k], b = poles[k + 1];
      for (const lat of [-0.85, 0, 0.85]) {
        const ax = a.x + Math.cos(a.ang) * lat, az = a.z - Math.sin(a.ang) * lat;
        const bx = b.x + Math.cos(b.ang) * lat, bz = b.z - Math.sin(b.ang) * lat;
        const ay = a.y + 8.35, by = b.y + 8.35;
        const N = near ? 8 : 3;
        for (let s = 0; s < N; s++) {
          const t0 = s / N, t1 = (s + 1) / N;
          const sag = (t) => -Math.sin(t * Math.PI) * 1.1;
          segs.push(ax + (bx - ax) * t0, ay + (by - ay) * t0 + sag(t0), az + (bz - az) * t0);
          segs.push(ax + (bx - ax) * t1, ay + (by - ay) * t1 + sag(t1), az + (bz - az) * t1);
        }
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    group.add(new THREE.LineSegments(lg, this.wireMat));
  }

  /** Kilometre posts and the occasional warning/regulatory sign along paved roads. */
  _roadSigns(road, p, group) {
    const kit = new BoxBuilder(this.materials);
    const seed = hashString(road.id) + 17;
    let any = false;
    for (let i = p.i0 + 1; i < p.i1; i++) {
      const r = hash2(i, seed, 1);
      const isKm = i % 42 === 0;
      if (!isKm && r > 0.035) continue;
      const [x, z] = road.points[i];
      if (this.world.nearestPOI(x, z).d < 60 && !isKm) continue;
      const [nx2, nz2] = road.points[Math.min(road.points.length - 1, i + 1)];
      let dx = nx2 - x, dz = nz2 - z;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const side = hash2(i, seed, 2) < 0.5 ? -1 : 1;
      const off = road.width / 2 + 1.3;
      const px = x - dz * off * side, pz = z + dx * off * side;
      if (this.world.waterAt(px, pz) !== null) continue;
      const py = this.world.heightAt(px, pz);
      const yaw = Math.atan2(dx, dz) + (side > 0 ? Math.PI : 0);
      any = true;
      if (isKm) {
        kit.box('paint_white', px, py + 0.45, pz, 0.18, 0.9, 0.12, { rotY: yaw });
        kit.box('paint_red', px, py + 0.82, pz, 0.19, 0.12, 0.13, { rotY: yaw });
        continue;
      }
      kit.cylinder('metal', px, py + 1.2, pz, 0.035, 0.035, 2.4, 6);
      const kind = Math.floor(hash2(i, seed, 3) * 3);
      const fx = Math.sin(yaw) * 0.05, fz = Math.cos(yaw) * 0.05;
      if (kind === 0) {
        // warning triangle: red border, white face
        kit.cylinder('paint_red', px, py + 2.3, pz, 0.48, 0.48, 0.03, 3, { rotX: -Math.PI / 2, rotY: yaw });
        kit.cylinder('paint_white', px + fx * 0.3, py + 2.3, pz + fz * 0.3, 0.36, 0.36, 0.032, 3, { rotX: -Math.PI / 2, rotY: yaw });
      } else if (kind === 1) {
        kit.cylinder('paint_red', px, py + 2.25, pz, 0.32, 0.32, 0.03, 16, { rotX: Math.PI / 2, rotY: yaw });
        kit.cylinder('paint_white', px + fx * 0.3, py + 2.25, pz + fz * 0.3, 0.25, 0.25, 0.032, 16, { rotX: Math.PI / 2, rotY: yaw });
      } else {
        kit.box('corrugated_blue', px, py + 2.25, pz, 0.6, 0.6, 0.03, { rotY: yaw, uvOffset: 0 });
        kit.box('paint_white', px + fx * 0.3, py + 2.25, pz + fz * 0.3, 0.3, 0.06, 0.032, { rotY: yaw });
      }
    }
    if (!any) return;
    const mesh = kit.build();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---------------------------------------------------------- wrecks
  _buildWreckGeos() {
    // body styles x paint, each with its own damage: missing wheels, sagging, open
    // doors and bonnet, smashed glass, rust
    const styles = ['sedan', 'hatch', 'van', 'pickup', 'sedan', 'hatch'];
    const paints = ['wood_red', 'corrugated_blue', 'paint_white', 'olive', 'rust', 'paint_yellow'];
    this.wreckGeos = styles.map((style, v) => {
      const kit = new BoxBuilder(this.materials);
      const paint = paints[v];
      const L = style === 'van' ? 4.8 : style === 'pickup' ? 5.0 : style === 'hatch' ? 3.8 : 4.4, W = style === 'van' ? 1.9 : 1.75;
      const rideH = v % 3 === 2 ? 0.28 : 0.38; // some sit on their rims
      // chassis, sills and bumpers
      kit.box('rust', 0, rideH + 0.12, 0, W - 0.1, 0.22, L - 0.3);
      kit.box('metal_dark', 0, rideH + 0.2, L / 2 - 0.05, W, 0.18, 0.12);
      kit.box('metal_dark', 0, rideH + 0.2, -L / 2 + 0.05, W, 0.18, 0.12);
      // lower body
      const bodyY = rideH + 0.5;
      kit.box(paint, 0, bodyY, 0, W, 0.5, L - 0.1);
      // wheel arches (dark) and wheels
      for (const [x, z] of [[-W / 2, L * 0.32], [W / 2, L * 0.32], [-W / 2, -L * 0.32], [W / 2, -L * 0.32]]) {
        kit.box('black', x * 1.001, rideH + 0.28, z, 0.04, 0.5, 0.78, { shade: 0.4 });
        if ((v + (x > 0 ? 1 : 0) + (z > 0 ? 2 : 0)) % 5 === 0) {
          kit.cylinder('metal_dark', x * 0.86, rideH - 0.02, z, 0.2, 0.2, 0.12, 10, { rotZ: Math.PI / 2 }); // bare hub
        } else {
          kit.cylinder('black', x * 0.88, 0.32, z, 0.32, 0.32, 0.2, 14, { rotZ: Math.PI / 2 });
          kit.cylinder('metal_dark', x * 0.95, 0.32, z, 0.17, 0.17, 0.04, 10, { rotZ: Math.PI / 2 });
        }
      }
      if (style === 'van') {
        kit.box(paint, 0, bodyY + 0.75, -0.25, W - 0.02, 1.05, L - 0.7);
        kit.box(paint, 0, bodyY + 0.55, L / 2 - 0.45, W - 0.04, 0.55, 0.6, { rotX: -0.35 });
        kit.box('glass_dirty', 0, bodyY + 0.85, L / 2 - 0.66, W - 0.25, 0.55, 0.04, { rotX: -0.35 });
      } else {
        const cabL = style === 'pickup' ? 1.5 : style === 'hatch' ? 1.9 : 1.9;
        const cabZ = style === 'pickup' ? 0.55 : style === 'hatch' ? -0.35 : -0.1;
        kit.box(paint, 0, bodyY + 0.48, cabZ, W - 0.16, 0.08, cabL - 0.3); // roof
        for (const sx of [-1, 1]) kit.box(paint, sx * (W / 2 - 0.1), bodyY + 0.36, cabZ, 0.04, 0.32, cabL - 0.6); // pillars/doors top
        // windscreen and rear glass (raked)
        if (v % 2 === 0) kit.box('glass_dirty', 0, bodyY + 0.36, cabZ + cabL / 2 - 0.08, W - 0.3, 0.4, 0.04, { rotX: -0.55 });
        else kit.box('black', 0, bodyY + 0.36, cabZ + cabL / 2 - 0.08, W - 0.3, 0.38, 0.02, { rotX: -0.55, shade: 0.3 });
        kit.box('glass_dirty', 0, bodyY + 0.36, cabZ - cabL / 2 + 0.1, W - 0.3, 0.38, 0.04, { rotX: 0.6 });
        // bonnet (sometimes propped open) and boot / bed
        if (v === 1) kit.box(paint, 0, bodyY + 0.55, L / 2 - 0.75, W - 0.1, 0.05, 1.1, { rotX: -0.9 });
        else kit.box(paint, 0, bodyY + 0.27, L / 2 - 0.65, W - 0.08, 0.06, 1.2);
        if (style === 'pickup') {
          kit.box(paint, -W / 2 + 0.05, bodyY + 0.4, -L / 2 + 0.95, 0.06, 0.32, 1.8);
          kit.box(paint, W / 2 - 0.05, bodyY + 0.4, -L / 2 + 0.95, 0.06, 0.32, 1.8);
          kit.box('rust', 0, bodyY + 0.26, -L / 2 + 0.95, W - 0.1, 0.04, 1.8);
          kit.box('wood_dark', 0.2, bodyY + 0.36, -L / 2 + 1.2, 0.8, 0.12, 0.5, { rotY: 0.4 });
        } else if (style === 'sedan') kit.box(paint, 0, bodyY + 0.27, -L / 2 + 0.55, W - 0.08, 0.06, 0.9);
        // one door hanging open
        if (v % 3 === 0) kit.box(paint, W / 2 + 0.45, bodyY + 0.1, cabZ + 0.35, 0.05, 0.75, 0.95, { rotY: -0.9 });
      }
      // head/tail lights
      for (const sx of [-1, 1]) {
        kit.box(v % 2 ? 'black' : 'glass_dirty', sx * (W / 2 - 0.25), bodyY + 0.1, L / 2 - 0.04, 0.3, 0.12, 0.04);
        kit.box('paint_red', sx * (W / 2 - 0.2), bodyY + 0.12, -L / 2 + 0.04, 0.22, 0.1, 0.04);
      }
      const mesh = kit.build();
      return { geo: mesh.geometry, mat: mesh.material, tilt: v % 3 === 2 ? 0.06 : (v % 4 === 1 ? -0.03 : 0) };
    });
  }
}
