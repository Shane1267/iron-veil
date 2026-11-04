import * as THREE from 'three';
import { BoxBuilder } from './GeometryKit.js';
import { StructureBuilder } from './Structures.js';
import { LAYOUTS, ARCH } from './POILayouts.js';
import { RNG, hashString } from '../core/MathUtil.js';
import { bus } from '../core/EventBus.js';
import { settings } from '../core/SettingsManager.js';
import { Frame } from './BuildingGenerator.js';

// Streams points of interest in and out around the player. A POI's layout is first
// recorded as a list of commands, executed across several frames within a time budget,
// then merged into a handful of draw calls. Doors, breakable windows, containers, signs,
// lights and AI hints are registered with the relevant systems.

const BUILD_BUDGET_MS = 6;

/** Collider for a door's closed leaf (axis aligned because yaw is a multiple of 90°). Shared with the online server. */
export function addDoorCollider(def, physics, owner) {
  const dx = Math.round(Math.cos(def.yaw)), dz = -Math.round(Math.sin(def.yaw));
  const x1 = def.x + dx * def.width, z1 = def.z + dz * def.width;
  const t = 0.08;
  const collider = physics.addBox(Math.min(def.x, x1) - (dx === 0 ? t : 0), def.y, Math.min(def.z, z1) - (dz === 0 ? t : 0),
    Math.max(def.x, x1) + (dx === 0 ? t : 0), def.y + def.height, Math.max(def.z, z1) + (dz === 0 ? t : 0),
    { material: def.metal ? 'metal' : 'wood', owner, tag: 'door' });
  return { collider, center: { x: (def.x + x1) / 2, y: def.y + 1.1, z: (def.z + z1) / 2 } };
}

class DoorRuntime {
  static panelGeo(w, h) {
    const key = `${w.toFixed(3)},${h.toFixed(3)}`;
    DoorRuntime._geo = DoorRuntime._geo || new Map();
    let g = DoorRuntime._geo.get(key);
    if (!g) {
      g = new THREE.BoxGeometry(w, h, 0.012);
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(0.78), 3));
      g.userData.shared = true;
      DoorRuntime._geo.set(key, g);
    }
    return g;
  }
  constructor(def, group, physics, materials, owner) {
    this.def = def;
    this.open = def.open;
    this.physics = physics;
    this.pivot = new THREE.Group();
    this.pivot.position.set(def.x, def.y, def.z);
    this.baseYaw = def.yaw;
    this.angle = this.open ? def.swing : 0;
    this.pivot.rotation.y = this.baseYaw + this.angle;
    const geo = new THREE.BoxGeometry(def.width, def.height, def.thick);
    geo.translate(def.width / 2, def.height / 2, 0);
    const col = new Float32Array(geo.attributes.position.count * 3).fill(0.85);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(geo, materials.get(def.metal ? 'olive' : def.mat));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // handle on both faces
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, def.thick + 0.1), materials.get('metal'));
    h.position.set(def.width - 0.12, 1.0, 0);
    mesh.add(h);
    // raised panels (timber) or kick plate and push bar (metal)
    const panelMat = mesh.material;
    if (!def.metal) {
      const pw = def.width * 0.62, ph1 = def.height * 0.34, ph2 = def.height * 0.3;
      for (const sz of [-1, 1]) {
        for (const [py, ph] of [[def.height * 0.27, ph1], [def.height * 0.71, ph2]]) {
          const p = new THREE.Mesh(DoorRuntime.panelGeo(pw, ph), panelMat);
          p.position.set(def.width / 2, py, sz * (def.thick / 2 + 0.006));
          mesh.add(p);
        }
      }
    } else {
      for (const sz of [-1, 1]) {
        const k = new THREE.Mesh(DoorRuntime.panelGeo(def.width * 0.9, 0.25), materials.get('metal_dark'));
        k.position.set(def.width / 2, 0.15, sz * (def.thick / 2 + 0.006));
        mesh.add(k);
      }
    }
    this.pivot.add(mesh);
    group.add(this.pivot);
    const dc = addDoorCollider(def, physics, owner);
    this.collider = dc.collider;
    this.collider.door = this;
    this.collider.enabled = !this.open;
    this.center = dc.center;
  }
  /** remote: the change came from the online server (do not report it back). */
  toggle(force, remote = false) {
    const was = this.open;
    this.open = force !== undefined ? force : !this.open;
    this.collider.enabled = !this.open;
    if (was !== this.open || !remote) bus.emit('sound', { type: 'door', x: this.center.x, y: this.center.y, z: this.center.z, open: this.open, metal: this.def.metal, remote });
    if (!remote && this.id) bus.emit('door:toggled', { id: this.id, open: this.open });
    return this.open;
  }
  update(dt) {
    const target = this.open ? this.def.swing : 0;
    if (Math.abs(this.angle - target) > 0.001) {
      this.angle += Math.sign(target - this.angle) * Math.min(Math.abs(target - this.angle), dt * 3.5);
      this.pivot.rotation.y = this.baseYaw + this.angle;
    }
  }
}

export class POIManager {
  constructor(scene, world, physics, materials, interactables, extras = {}) {
    this.scene = scene;
    this.world = world;
    this.physics = physics;
    this.materials = materials;
    this.interactables = interactables;
    this.extras = extras;
    this.active = new Map();
    this.building = null; // POI currently under construction
    this.glassMat = materials.get('glass');
    this.signCache = new Map();
    this.waterMat = extras.waterMat || null;
    this.checkTimer = 0;
  }

  get radiusIn() { return Math.min(1100, settings.get('viewDistance') * 0.8); }
  get radiusOut() { return this.radiusIn + 250; }

  update(dt, pos, timeBudget = BUILD_BUDGET_MS) {
    for (const rt of this.active.values()) for (const d of rt.doors) d.update(dt);
    this.checkTimer -= dt;
    if (this.checkTimer <= 0 && !this.building) {
      this.checkTimer = 0.5;
      let best = null, bd = Infinity;
      for (const p of this.world.pois) {
        const d = Math.hypot(p.x - pos.x, p.z - pos.z) - p.radius;
        if (this.active.has(p.id)) {
          if (d > this.radiusOut) this.unload(p.id);
          continue;
        }
        if (d < this.radiusIn && d < bd) { bd = d; best = p; }
      }
      if (best) this._begin(best);
    }
    if (this.building) this._continue(timeBudget);
  }

  /** Build every POI within radius immediately (loading screen). */
  buildAllNear(pos, radius) {
    for (const p of this.world.pois) {
      if (this.active.has(p.id)) continue;
      if (Math.hypot(p.x - pos.x, p.z - pos.z) - p.radius < radius) {
        this._begin(p);
        while (this.building) this._continue(1e9);
      }
    }
  }

  isBuilt(id) {
    return this.active.has(id);
  }

  // ------------------------------------------------------------ construction
  _begin(poi) {
    const rng = new RNG(hashString(poi.id));
    const B = new BoxBuilder(this.materials);
    const ctx = {
      physics: this.physics, owner: `poi:${poi.id}`, colliders: [], doors: [], glass: [], containers: [], spots: [], ladders: [], clearZones: [],
      lights: [], fires: [], pumps: [], signs: [], waterDiscs: [], radios: [], buildings: [], trees: [],
    };
    const S = new StructureBuilder(B, ctx, rng);
    const commands = [];
    const L = this._layoutAPI(poi, S, rng, commands, ctx);
    const fn = LAYOUTS[poi.type];
    if (fn) fn(L); else console.warn('[POI] no layout for type', poi.type);
    this.building = { poi, B, S, ctx, commands, i: 0, rng };
  }

  _continue(budget) {
    const job = this.building;
    const t0 = performance.now();
    while (job.i < job.commands.length) {
      try {
        job.commands[job.i]();
      } catch (e) {
        console.error(`[POI] command ${job.i} failed in ${job.poi.id}`, e);
      }
      job.i++;
      if (performance.now() - t0 > budget) return;
    }
    this._finish(job);
    this.building = null;
  }

  _finish(job) {
    const { poi, B, ctx } = job;
    const group = new THREE.Group();
    group.name = `poi ${poi.id}`;
    if (!B.empty) {
      const mesh = B.build();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    // glass panes
    let glassMesh = null;
    if (ctx.glass.length) {
      glassMesh = new THREE.InstancedMesh(this._unitBox || (this._unitBox = new THREE.BoxGeometry(1, 1, 1)), this.glassMat, ctx.glass.length);
      const m = new THREE.Matrix4();
      ctx.glass.forEach((g, i) => {
        m.makeScale(g.w, g.h, g.d);
        m.setPosition(g.x, g.y, g.z);
        glassMesh.setMatrixAt(i, m);
        g.index = i;
        g.mesh = glassMesh;
      });
      glassMesh.instanceMatrix.needsUpdate = true;
      glassMesh.computeBoundingSphere();
      glassMesh.renderOrder = 3;
      group.add(glassMesh);
    }
    const doors = ctx.doors.map((d, i) => { const r = new DoorRuntime(d, group, this.physics, this.materials, ctx.owner); r.id = `${poi.id}:d${i}`; return r; });
    const inter = [];
    for (const d of doors) {
      inter.push(this.interactables.add({ id: `${ctx.owner}:door:${inter.length}`, kind: 'door', x: d.center.x, y: d.center.y, z: d.center.z, radius: 1.3, label: () => (d.open ? 'Close door' : 'Open door'), data: { door: d } }));
    }
    for (const gu of poi.guaranteed || []) if (ctx.containers[gu.container]) ctx.containers[gu.container].profile = gu.profile;
    ctx.containers.forEach((c, i) => {
      const id = `${poi.id}:c${i}`;
      inter.push(this.interactables.add({ id, kind: 'container', x: c.x, y: c.y, z: c.z, radius: 1.4, label: `Search ${c.name}`, data: { containerId: id, profile: c.profile, capacity: c.capacity, name: c.name, poi: poi.id } }));
      c.id = id;
    });
    ctx.pumps.forEach((p, i) => inter.push(this.interactables.add({ id: `${poi.id}:pump${i}`, kind: 'pump', x: p.x, y: p.y, z: p.z, radius: 1.5, label: 'Fill jerrycan', data: {} })));
    ctx.radios.forEach((r, i) => inter.push(this.interactables.add({ id: `${poi.id}:radio${i}`, kind: 'radio', x: r.x, y: r.y, z: r.z, radius: 1.6, label: 'Use radio', data: { poi: poi.id } })));
    // signs
    for (const s of ctx.signs) group.add(this._signMesh(s));
    // water discs (treatment basins)
    for (const w of ctx.waterDiscs) {
      if (!this.waterMat) break;
      const g = new THREE.CircleGeometry(w.r, 24);
      g.rotateX(-Math.PI / 2);
      const uv = g.attributes.uv, p = g.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + w.x) / 9, (p.getZ(i) + w.z) / 9);
      const m = new THREE.Mesh(g, this.waterMat);
      m.position.set(w.x, w.y, w.z);
      group.add(m);
      inter.push(this.interactables.add({ id: `${poi.id}:water${w.x | 0}`, kind: 'water', x: w.x + w.r - 0.5, y: w.y + 0.5, z: w.z, radius: 2.5, label: 'Fill bottle', data: {} }));
    }
    // trees planted by the layout (yards, greens) share the terrain's vegetation meshes
    const V = this.extras.vegetation;
    if (ctx.trees.length && V) {
      const byType = new Map();
      for (const t of ctx.trees) { if (!byType.has(t.type)) byType.set(t.type, []); byType.get(t.type).push(t); }
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
      for (const [type, list] of byType) {
        const geo = V.geos[type];
        if (!geo) continue;
        geo.userData.shared = true;
        const inst = new THREE.InstancedMesh(geo, V.material, list.length);
        inst.customDepthMaterial = V.depth;
        list.forEach((t, i) => {
          p.set(t.x, t.y - 0.1, t.z);
          q.setFromAxisAngle(up, t.rot);
          sc.set(t.s * (0.9 + (i % 3) * 0.08), t.s, t.s * (0.92 + (i % 2) * 0.1));
          m4.compose(p, q, sc);
          inst.setMatrixAt(i, m4);
          inst.setColorAt(i, col.setRGB(0.92 + (i % 4) * 0.04, 0.95 + (i % 3) * 0.03, 0.88 + (i % 2) * 0.06));
        });
        inst.castShadow = true;
        inst.receiveShadow = true;
        inst.computeBoundingSphere();
        group.add(inst);
      }
    }
    this.scene.add(group);
    const rt = {
      poi, group, doors, glassMesh, glass: ctx.glass, colliders: ctx.colliders, interactables: inter, spots: ctx.spots, containers: ctx.containers,
      lights: ctx.lights, fires: ctx.fires, ladders: ctx.ladders, buildings: ctx.buildings,
    };
    this.active.set(poi.id, rt);
    bus.emit('poi:built', rt);
  }

  unload(id) {
    const rt = this.active.get(id);
    if (!rt) return;
    bus.emit('poi:unloading', rt);
    this.scene.remove(rt.group);
    rt.group.traverse((o) => { if (o.geometry && o.geometry !== this._unitBox && !o.geometry.userData.shared) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
    this.physics.removeOwner(`poi:${id}`);
    for (const i of rt.interactables) this.interactables.remove(i);
    this.active.delete(id);
  }

  unloadAll() {
    for (const id of [...this.active.keys()]) this.unload(id);
    this.building = null;
  }

  breakGlass(pane) {
    if (pane.broken) return;
    pane.broken = true;
    pane.collider.blocksShots = false;
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    pane.mesh.setMatrixAt(pane.index, m);
    pane.mesh.instanceMatrix.needsUpdate = true;
    bus.emit('glass:break', pane);
    bus.emit('sound', { type: 'glass', x: pane.x, y: pane.y, z: pane.z });
  }

  _signMesh(s) {
    let mat = this.signCache.get(s.text);
    if (!mat) {
      const c = document.createElement('canvas');
      c.width = 512; c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#d8d2c0';
      g.fillRect(0, 0, 512, 128);
      g.fillStyle = 'rgba(80,60,40,0.25)';
      for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 512, Math.random() * 128, Math.random() * 60, 2);
      g.strokeStyle = '#3a3a34';
      g.lineWidth = 8;
      g.strokeRect(6, 6, 500, 116);
      g.fillStyle = '#2a2a26';
      g.font = 'bold 44px "Arial Narrow", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      let size = 44;
      while (g.measureText(s.text.toUpperCase()).width > 470 && size > 20) { size -= 2; g.font = `bold ${size}px "Arial Narrow", Arial, sans-serif`; }
      g.fillText(s.text.toUpperCase(), 256, 66);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
      this.signCache.set(s.text, mat);
    }
    const m = new THREE.Mesh(this._signGeo || (this._signGeo = new THREE.BoxGeometry(2.6, 0.65, 0.06)), [this.materials.get('wood_dark'), this.materials.get('wood_dark'), this.materials.get('wood_dark'), this.materials.get('wood_dark'), mat, mat]);
    m.position.set(s.x, s.y, s.z);
    m.rotation.y = s.yaw;
    m.castShadow = true;
    return m;
  }

  // ------------------------------------------------------------ layout API
  _layoutAPI(poi, S, rng, commands, ctx) {
    const world = this.world;
    const px = poi.x, pz = poi.z;
    const gy = (x, z) => world.heightAt(x, z);
    const placed = []; // footprints [minX,minZ,maxX,maxZ]
    const overlapsRoad = (x0, z0, x1, z1) => {
      for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) {
        const x = x0 + ((x1 - x0) * i) / 2, z = z0 + ((z1 - z0) * j) / 2;
        const r = world.roadQuery(x, z);
        if (r && r.d < r.width * 0.5 + 1.5) return true;
        if (world.waterAt(x, z) !== null) return true;
      }
      return false;
    };
    const overlapsPlaced = (x0, z0, x1, z1) => placed.some((p) => !(x1 < p[0] || x0 > p[2] || z1 < p[1] || z0 > p[3]));
    const footprint = (x, z, w, d, rot) => {
      const [W, D] = rot % 2 ? [d, w] : [w, d];
      return [x - W / 2 - 0.6, z - D / 2 - 0.6, x + W / 2 + 0.6, z + D / 2 + 0.6];
    };
    const groundFor = (x, z, w, d, rot) => {
      const [W, D] = rot % 2 ? [d, w] : [w, d];
      let h = -Infinity;
      for (const [ox, oz] of [[0, 0], [-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) h = Math.max(h, gy(x + ox, z + oz));
      return h;
    };

    const L = {
      poi, rng, world,
      b(arch, lx, lz, rot = 0, extra = {}) {
        const spec = { ...ARCH[arch](rng, extra), ...extra, x: px + lx, z: pz + lz, rot };
        const fp = footprint(spec.x, spec.z, spec.w, spec.d, rot);
        if (!extra.codebook && (overlapsRoad(...fp) || overlapsPlaced(...fp))) return false;
        placed.push(fp);
        ctx.buildings.push({ arch, x: spec.x, z: spec.z, w: spec.w, d: spec.d, rot, floors: spec.floors, doorAt: (spec.doors || []).find((dd) => dd.side === 'S')?.at ?? 0 });
        // keep the ground in front of every door clear: fences laid out later leave a gap here
        const bf = new Frame(spec.x, 0, spec.z, rot);
        for (const dd of spec.doors || []) {
          const out = 1.4;
          const [lx, lz] = dd.side === 'S' ? [dd.at, spec.d / 2 + out] : dd.side === 'N' ? [dd.at, -spec.d / 2 - out] : dd.side === 'E' ? [spec.w / 2 + out, dd.at] : [-spec.w / 2 - out, dd.at];
          ctx.clearZones.push({ x: bf.wx(lx, lz), z: bf.wz(lx, lz), r: 1.9 });
        }
        commands.push(() => S.building(spec, groundFor(spec.x, spec.z, spec.w, spec.d, rot)));
        return true;
      },
      s(name, lx, lz, ...args) {
        const x = px + lx, z = pz + lz;
        commands.push(() => {
          const y = gy(x, z);
          switch (name) {
            case 'hesco': { const [x1, z1] = args; S.fence(x, z, px + x1, pz + z1, 'hesco', gy); break; }
            case 'pipe': { const [x1, z1, r, h] = args; S.pipe(x, y, z, px + x1, pz + z1, r, h); break; }
            case 'sandbags': { const [rot, len] = args; S.sandbagRow(new Frame(x, y, z, rot || 0), 0, 0, len || 4); break; }
            case 'container': { const [rot, color, profile] = args; S.shippingContainer(x, y, z, rot || 0, color, profile); break; }
            case 'hayBale': S.cyl(new Frame(x, y, z, 0), 'hay', 0, 0.65, 0, 0.65, 1.3, 12, { rotX: Math.PI / 2 }); break;
            case 'fuelBarrels': {
              const n = 3 + rng.int(0, 4);
              for (let i = 0; i < n; i++) {
                const bx = x + (i % 3) * 0.72 + (rng.next() - 0.5) * 0.12, bz = z + Math.floor(i / 3) * 0.72 + (rng.next() - 0.5) * 0.12;
                const mat = rng.pick(['paint_red', 'olive', 'olive', 'rust', 'corrugated_blue', 'black']);
                if (i === n - 1 && rng.chance(0.5)) S.cyl(new Frame(bx + 0.6, y, bz + 0.4, 0), mat, 0, 0.3, 0, 0.3, 1.0, 12, { rotZ: Math.PI / 2, rotY: rng.next() * 3, collide: false }); // toppled
                else S.cyl(new Frame(bx, y, bz, 0), mat, 0, 0.5, 0, 0.3, 1.0, 12, { rotX: (rng.next() - 0.5) * 0.05 });
              }
              break;
            }
            case 'wreckCar': {
              const rot = args[0] || 0; const f = new Frame(x, y, z, rot);
              S.box(f, 'rust', 0, 0.55, 0, 1.75, 0.55, 4.3); S.box(f, rng.pick(['wood_red', 'corrugated_blue', 'paint_white']), 0, 1.0, -0.1, 1.7, 0.45, 4.1, { collide: false });
              S.box(f, 'paint_white', 0, 1.42, 0.25, 1.55, 0.5, 2.0, { collide: false }); break;
            }
            default:
              if (typeof S[name] === 'function') S[name](x, y, z, ...args);
              else console.warn('[POI] unknown structure', name);
          }
        });
      },
      sign(lx, lz, rot, text) { const x = px + lx, z = pz + lz; commands.push(() => S.sign(x, gy(x, z), z, rot, text)); },
      radio(lx, lz) { commands.push(() => { const x = px + lx, z = pz + lz; ctx.radios.push({ x, y: gy(x, z) + 1.1, z }); }); },
      perimeter(x0, z0, x1, z1, type, gates = []) {
        const sides = {
          N: [x0, z0, x1, z0], S: [x0, z1, x1, z1], W: [x0, z0, x0, z1], E: [x1, z0, x1, z1],
        };
        for (const [side, [ax, az, bx, bz]] of Object.entries(sides)) {
          const len = side === 'N' || side === 'S' ? x1 - x0 : z1 - z0;
          const gaps = gates.filter((g) => g.side === side).map((g) => ({ at: len / 2 + g.at, w: g.w }));
          // automatic gaps where roads cross the fence line
          const steps = Math.ceil(len / 3);
          for (let i = 0; i < steps; i++) {
            const t = (i + 0.5) / steps;
            const x = px + ax + (bx - ax) * t, z = pz + az + (bz - az) * t;
            const r = world.roadQuery(x, z);
            if ((r && r.d < r.width * 0.5 + 2) || world.waterAt(x, z) !== null) gaps.push({ at: t * len, w: 3.2 });
          }
          commands.push(() => S.fence(px + ax, pz + az, px + bx, pz + bz, type, gy, gaps));
        }
      },
      alongRoads({ count, arch, offset, spacing }) {
        const cands = [];
        for (const road of world.roads) {
          if (road.type === 'rail') continue;
          for (let i = 0; i < road.points.length; i++) {
            const [x, z] = road.points[i];
            if (Math.hypot(x - px, z - pz) > poi.radius * 0.95) continue;
            const nxt = road.points[Math.min(road.points.length - 1, i + 1)], prv = road.points[Math.max(0, i - 1)];
            let dx = nxt[0] - prv[0], dz = nxt[1] - prv[1];
            const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
            cands.push({ x, z, nx: -dz, nz: dx, road });
          }
        }
        let n = 0, last = [];
        for (let k = 0; k < cands.length * 2 && n < count; k++) {
          const c = cands[(k * 7) % cands.length];
          if (!c) break;
          const side = k % 2 ? 1 : -1;
          const bx = c.x + c.nx * offset * side, bz = c.z + c.nz * offset * side;
          if (last.some(([lx, lz]) => Math.hypot(lx - bx, lz - bz) < spacing * 0.6)) continue;
          // face the road: choose quarter rotation whose front (+z local) points at the road
          const tx = -c.nx * side, tz = -c.nz * side;
          let rot = 0, bestDot = -2;
          for (let r = 0; r < 4; r++) {
            const fx = Math.round(Math.sin((r * Math.PI) / 2)), fz = Math.round(Math.cos((r * Math.PI) / 2));
            const dot = fx * tx + fz * tz;
            if (dot > bestDot) { bestDot = dot; rot = r; }
          }
          const a = arch[n % arch.length];
          if (L.b(a, bx - px, bz - pz, rot)) { n++; last.push([bx, bz]); }
        }
      },
      /** Fenced back gardens (and low front fences) around houses already placed. */
      yards(arches) {
        for (const b of ctx.buildings) {
          if (!arches.includes(b.arch)) continue;
          const f = new Frame(b.x, 0, b.z, b.rot);
          const P = (lx, lz) => [f.wx(lx, lz), f.wz(lx, lz)];
          const aabb = (pts) => { const xs = pts.map((q) => q[0]), zs = pts.map((q) => q[1]); return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; };
          const G = 8 + rng.next() * 5;
          const xA = -b.w / 2 - 1.6, xB = b.w / 2 + 1.6, zA = -b.d / 2 - 0.3, zB = -b.d / 2 - G;
          const garden = aabb([P(xA, zA), P(xB, zB)]);
          const gardenCheck = aabb([P(xA, zA - 0.9), P(xB, zB)]); // beyond the house's own footprint margin
          const type = rng.pick(['picket', 'picket', 'wire']);
          const gateAt = 1.2 + rng.next() * (xB - xA - 2.4);
          if (!overlapsRoad(...gardenCheck) && !overlapsPlaced(...gardenCheck)) {
            placed.push(garden);
            const bed = rng.chance(0.7), shed = rng.chance(0.45), wood = rng.chance(0.5), line = rng.chance(0.4), trees = 1 + rng.int(0, 2);
            // the shed is laid out now (not inside the command) so its door is kept clear of the fences
            let shedSpec = null;
            if (shed) {
              const [sx, sz] = P(xA + 2.6, zB + 2.4);
              shedSpec = { ...ARCH.shed(rng), x: sx, z: sz, rot: (b.rot + 2) % 4, profile: 'farm' };
              const sf = new Frame(sx, 0, sz, shedSpec.rot);
              for (const dd of shedSpec.doors || []) {
                const out = 1.4;
                const [lx, lz] = dd.side === 'S' ? [dd.at, shedSpec.d / 2 + out] : dd.side === 'N' ? [dd.at, -shedSpec.d / 2 - out] : dd.side === 'E' ? [shedSpec.w / 2 + out, dd.at] : [-shedSpec.w / 2 - out, dd.at];
                ctx.clearZones.push({ x: sf.wx(lx, lz), z: sf.wz(lx, lz), r: 1.9 });
              }
            }
            commands.push(() => {
              S.fence(...P(xA, zB), ...P(xB, zB), type, gy, [{ at: gateAt, w: 1.4 }]);
              S.fence(...P(xA, zA), ...P(xA, zB), type, gy, []);
              S.fence(...P(xB, zA), ...P(xB, zB), type, gy, []);
              const at = (lx, lz) => { const [x, z] = P(lx, lz); return [x, gy(x, z), z]; };
              if (bed) S.gardenBed(...at(xA + 2.4, (zA + zB) / 2 + 0.5), b.rot, 3.2, Math.min(6, G * 0.55));
              for (let i = 0; i < trees; i++) {
                const t = at(xB - 1.8 - i * 3.2, zB + 2.2 + rng.next() * 2);
                if (shedSpec && Math.hypot(t[0] - shedSpec.x, t[2] - shedSpec.z) < Math.max(shedSpec.w, shedSpec.d) * 0.5 + 1.5) continue; // not through the shed roof
                S.tree(...t, 'broadleaf', 0.5 + rng.next() * 0.25);
              }
              if (wood) S.woodPile(...at(xA + 1.2, zA - 0.9), b.rot);
              if (line) S.laundryLine(...at(0.5, zB + 3.2), b.rot);
              if (shedSpec) S.building(shedSpec, gy(shedSpec.x, shedSpec.z));
            });
          }
          // low front fence with a gate on the path to the door
          const zF = b.d / 2 + 2.8;
          const front = aabb([P(xA, b.d / 2 + 0.5), P(xB, zF)]);
          if (!overlapsRoad(...front) && rng.chance(0.75)) {
            const doorAt = b.doorAt - xA;
            commands.push(() => {
              S.fence(...P(xA, zF), ...P(xB, zF), 'picket', gy, [{ at: doorAt, w: 1.5 }]);
              S.fence(...P(xA, b.d / 2 + 0.4), ...P(xA, zF), 'picket', gy, []);
              S.fence(...P(xB, b.d / 2 + 0.4), ...P(xB, zF), 'picket', gy, []);
            });
          }
        }
      },
      /** Prop placed beside the nearest road to a local point, facing the road. */
      roadside(name, lx, lz, offset, ...args) {
        const x0 = px + lx, z0 = pz + lz;
        const r = world.roadQuery(x0, z0);
        if (!r || r.type === 'rail') return false;
        const sgm = r.seg;
        let dx = sgm.bx - sgm.ax, dz = sgm.bz - sgm.az;
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const cx = sgm.ax + dx * r.t * l, cz = sgm.az + dz * r.t * l;
        let nx = -dz, nz = dx;
        if ((x0 - cx) * nx + (z0 - cz) * nz < 0) { nx = -nx; nz = -nz; }
        const x = cx + nx * (r.width / 2 + offset), z = cz + nz * (r.width / 2 + offset);
        // quarter rotation whose front (+z local) points back at the road
        let rot = 0, best = -2;
        for (let q = 0; q < 4; q++) {
          const fx = Math.round(Math.sin((q * Math.PI) / 2)), fz = Math.round(Math.cos((q * Math.PI) / 2));
          const dot = -(fx * nx + fz * nz);
          if (dot > best) { best = dot; rot = q; }
        }
        if (overlapsPlaced(x - 2.5, z - 2.5, x + 2.5, z + 2.5)) return false;
        placed.push([x - 2.2, z - 2.2, x + 2.2, z + 2.2]);
        commands.push(() => S[name](x, gy(x, z), z, rot, ...args));
        return true;
      },
      pave(x0, z0, x1, z1, mat = 'asphalt') {
        commands.push(() => S.pavement(px + x0, pz + z0, px + x1, pz + z1, gy, mat));
      },
      tree(lx, lz, type = 'broadleaf', s = 1) {
        const x = px + lx, z = pz + lz;
        if (overlapsRoad(x - 1, z - 1, x + 1, z + 1) || overlapsPlaced(x - 1.5, z - 1.5, x + 1.5, z + 1.5)) return;
        commands.push(() => S.tree(x, gy(x, z), z, type, s));
      },
      scatterRubble(n) {
        for (let i = 0; i < n; i++) {
          const a = rng.next() * Math.PI * 2, r = rng.next() * poi.radius * 0.7;
          const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
          if (overlapsPlaced(x - 2, z - 2, x + 2, z + 2) || overlapsRoad(x - 1, z - 1, x + 1, z + 1)) continue;
          commands.push(() => {
            const y = gy(x, z);
            if (rng.chance(0.5)) S.rockPile(x, y, z, 1.6);
            else { S.B.box('concrete_dark', x, y + 0.2, z, 1.8, 0.5, 1.2, { rotY: rng.next() * 3, rotZ: 0.2 }); S.B.box('wood_dark', x + 0.6, y + 0.4, z, 2.2, 0.08, 0.2, { rotY: rng.next() * 3, rotZ: 0.4 }); }
          });
        }
      },
      trains(n) {
        const rail = world.roads.find((r) => r.type === 'rail');
        if (!rail) return;
        const pts = rail.points.filter(([x, z]) => Math.hypot(x - px, z - pz) < poi.radius * 0.8);
        for (let k = 0; k < Math.min(n, pts.length); k += 1) {
          const [x, z] = pts[Math.floor((k / n) * pts.length)];
          const idx = rail.points.findIndex((p) => p[0] === x && p[1] === z);
          const nx = rail.points[Math.min(rail.points.length - 1, idx + 1)];
          const ang = Math.atan2(nx[0] - x, nx[1] - z);
          const rot = Math.round(ang / (Math.PI / 2)) & 3;
          const type = ['box', 'tank', 'box', 'flat'][k % 4];
          const color = ['corrugated_rust', 'paint_white', 'corrugated_blue', 'olive'][k % 4];
          commands.push(() => S.trainCar(x, rail.heights[idx] + 0.25, z, rot, type, color));
        }
      },
      docks() {
        const lake = world.lake;
        const dx = lake.center[0] - px, dz = lake.center[1] - pz;
        const horizontal = Math.abs(dx) > Math.abs(dz);
        for (let k = -1; k <= 1; k++) {
          const ox = horizontal ? Math.sign(dx) * 70 : k * 26, oz = horizontal ? k * 26 : Math.sign(dz) * 70;
          const x = px + ox, z = pz + oz;
          commands.push(() => {
            S.dock(x, 0, z, horizontal ? 1 : 0, 34, 3, lake.level);
            const ctxFrame = new Frame(x, 0, z, horizontal ? 1 : 0);
            S.ctx.colliders.push(S._colliderLocal(ctxFrame, 0, lake.level + 0.6, 0, 3, 0.15, 34, 'wood'));
            S.boat(x + (horizontal ? 0 : 3.5), lake.level - 0.2, z + (horizontal ? 3.5 : 0), horizontal ? 1 : 0, 6);
          });
        }
      },
    };
    return L;
  }
}
