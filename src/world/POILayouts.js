// Layout templates per POI type. Each template receives a LayoutAPI (see POIManager)
// and places buildings/structures in POI-local metres. Templates are deterministic
// (seeded by POI id) so the same location always looks the same.

export const ARCH = {
  house: (r) => ({ w: r.pick([8, 9, 10]), d: r.pick([7, 8]), floors: 1, wallMat: r.pick(['plaster', 'plaster_yellow', 'plaster_blue', 'plaster_green', 'brick', 'wood']),
    roof: 'gable', roofMat: r.pick(['roof_tile', 'roof_tile', 'roof', 'roof_sheet', 'corrugated_rust']), doors: [{ side: 'S', at: -1.6 }, ...(r.chance(0.5) ? [{ side: 'N', at: 2.0 }] : [])],
    partitions: [{ axis: 'x', at: -0.6, door: 1.2 }], furniture: 'house', chimney: r.chance(0.6), profile: 'residential', ruin: 0.6, floorMat: 'wood', innerMat: 'plaster' }),
  house2: (r) => ({ w: 10, d: 8, floors: 2, wallMat: r.pick(['plaster', 'plaster_yellow', 'brick', 'plaster_blue', 'plaster_green']), roof: 'gable', roofMat: r.pick(['roof_tile', 'roof_tile', 'roof', 'roof_sheet']),
    doors: [{ side: 'S', at: 1.5 }], partitions: [{ axis: 'x', at: -0.8, door: 2.0, from: -2.6 }], furniture: 'house', chimney: true, profile: 'residential', ruin: 0.6, floorMat: 'wood', innerMat: 'plaster', stairMat: 'wood_dark' }),
  cabin: (r) => ({ w: 6.5, d: 5.5, floors: 1, floorH: 2.8, wallMat: 'logs', roof: 'gable', roofMat: r.pick(['roof', 'corrugated_rust']), gableMat: 'wood_dark', trimMat: 'wood_dark',
    doors: [{ side: 'S', at: 1.2 }], windows: { S: 1, N: 1, E: 1, W: 1 }, furniture: 'cabin', profile: 'hunting', ruin: 0.5, floorMat: 'wood_dark', ceilMat: 'wood_dark', innerMat: 'logs' }),
  ranger: () => ({ w: 11, d: 8, floors: 2, wallMat: 'wood', roof: 'gable', roofMat: 'roof', doors: [{ side: 'S', at: 2.5 }], furniture: 'ranger', profile: 'hunting',
    partitions: [{ axis: 'z', at: 1.0, door: -1.5, floors: [0] }], floorMat: 'wood_dark', innerMat: 'wood', stairMat: 'wood_dark', ruin: 0.4, chimney: true }),
  barn: (r) => ({ w: 12, d: 16, floors: 1, floorH: 5.4, wallMat: r.pick(['wood_red', 'wood_dark']), roof: 'gable', roofMat: 'corrugated_rust', roofPitch: 0.45,
    doors: [{ side: 'S', at: 0, w: 3.8, h: 4.2, gap: true }, { side: 'E', at: 4 }], windows: { S: 0, N: 2, E: 2, W: 2 }, furniture: 'barn', profile: 'farm', floorMat: 'wood_dark', ceilMat: 'wood_dark', ruin: 0.7 }),
  shed: () => ({ w: 4, d: 3.6, floors: 1, floorH: 2.6, wallMat: 'corrugated_rust', roof: 'shed', roofMat: 'corrugated', doors: [{ side: 'S', at: 0.4, w: 1.1 }],
    windows: { S: 0, N: 0, E: 0, W: 0 }, furniture: 'shed', profile: 'farm', floorMat: 'wood_dark', ceilMat: 'wood_dark', ruin: 0.5 }),
  garage: () => ({ w: 6.5, d: 7.5, floors: 1, floorH: 3, wallMat: 'brick', roof: 'flat', doors: [{ side: 'S', at: 0, w: 3.2, h: 2.6, gap: true }], windows: { E: 1, W: 0, N: 0, S: 0 },
    furniture: 'garage', profile: 'industrial', floorMat: 'concrete', ceilMat: 'concrete' }),
  warehouse: (r) => ({ w: 24, d: 16, floors: 1, floorH: 7, wallMat: r.pick(['corrugated', 'corrugated_blue', 'corrugated_rust']), roof: 'shed', roofMat: 'corrugated', thick: 0.3,
    doors: [{ side: 'S', at: -6, w: 4.2, h: 4.6, gap: true }, { side: 'S', at: 6, w: 4.2, h: 4.6, gap: true, }, { side: 'E', at: 3, metal: true }, { side: 'W', at: -3, metal: true }],
    windows: { S: 0, N: 3, E: 2, W: 2 }, winW: 1.6, furniture: 'warehouse', profile: 'industrial', floorMat: 'concrete', ceilMat: 'corrugated', innerMat: 'concrete', ruin: 0.6, glassChance: 0.3 }),
  workshop: () => ({ w: 12, d: 10, floors: 1, floorH: 4.2, wallMat: 'brick', roof: 'flat', doors: [{ side: 'S', at: -3, w: 3.2, h: 3.2, gap: true }, { side: 'S', at: 3 }],
    furniture: 'workshop', profile: 'industrial', floorMat: 'concrete', ceilMat: 'concrete', glassChance: 0.4 }),
  barracks: () => ({ w: 18, d: 8, floors: 1, floorH: 3.2, wallMat: 'concrete', roof: 'gable', roofMat: 'corrugated', roofPitch: 0.25, doors: [{ side: 'S', at: -6, metal: true }, { side: 'S', at: 6, metal: true }],
    partitions: [{ axis: 'z', at: 0, door: 0 }], furniture: 'barracks', profile: 'military', floorMat: 'tiles', innerMat: 'concrete', glassChance: 0.7 }),
  hq: (r, extra) => ({ w: 14, d: 10, floors: 2, wallMat: 'concrete', roof: 'flat', doors: [{ side: 'S', at: 2.5, metal: true }], partitions: [{ axis: 'z', at: 2.0, door: -2 }],
    furniture: 'hq', profile: 'military', floorMat: 'tiles', innerMat: 'plaster', codebook: !!(extra && extra.codebook), glassChance: 0.75 }),
  booth: () => ({ w: 3.2, d: 3.2, floors: 1, floorH: 2.8, wallMat: 'concrete', roof: 'flat', doors: [{ side: 'S', at: 0.6 }], windows: { N: 1, E: 1, W: 1, S: 0 }, winW: 1.3,
    furniture: 'booth', profile: 'military', floorMat: 'concrete', glassChance: 0.5 }),
  hospital: () => ({ w: 24, d: 14, floors: 2, wallMat: 'plaster', roof: 'flat', doors: [{ side: 'S', at: 0, w: 2.2 }, { side: 'N', at: 8 }],
    partitions: [{ axis: 'x', at: -2, door: -6 }, { axis: 'z', at: 4, door: 3, from: -6.7, to: -2.1 }], furniture: 'medical', profile: 'medical', floorMat: 'tiles', innerMat: 'plaster', stairOffset: 0, ruin: 0.8 }),
  police: () => ({ w: 16, d: 12, floors: 2, wallMat: 'brick', roof: 'flat', doors: [{ side: 'S', at: 3, w: 1.6 }, { side: 'E', at: -3, metal: true }],
    partitions: [{ axis: 'x', at: -1, door: 3 }], furniture: 'police', profile: 'police', floorMat: 'tiles', innerMat: 'plaster', ruin: 0.6 }),
  apartment: (r) => ({ w: 14, d: 10, floors: 3, wallMat: r.pick(['plaster', 'plaster_yellow', 'plaster_blue', 'concrete']), roof: 'flat', doors: [{ side: 'S', at: 3 }],
    partitions: [{ axis: 'x', at: 0, door: 3 }], furniture: 'house', profile: 'residential', floorMat: 'wood', innerMat: 'plaster', ruin: 0.7 }),
  shop: (r) => ({ w: 12, d: 9, floors: 1, floorH: 3.6, wallMat: r.pick(['brick', 'plaster', 'plaster_yellow']), roof: 'flat', doors: [{ side: 'S', at: -3.5, w: 1.8 }, { side: 'N', at: 3 }],
    windows: { S: 2, N: 0, E: 1, W: 1 }, winW: 2.4, furniture: 'shop', profile: 'kitchen', floorMat: 'tiles', innerMat: 'plaster', glassChance: 0.25, ruin: 0.8 }),
  kiosk: () => ({ w: 8, d: 6, floors: 1, floorH: 3.2, wallMat: 'plaster', roof: 'flat', doors: [{ side: 'S', at: -2, w: 1.4 }], windows: { S: 1, E: 1, W: 0, N: 0 }, winW: 2.2,
    furniture: 'shop', profile: 'fuel', floorMat: 'tiles', glassChance: 0.3 }),
  lab: () => ({ w: 20, d: 12, floors: 1, floorH: 3.6, wallMat: 'concrete', roof: 'flat', doors: [{ side: 'S', at: 0, metal: true, w: 1.6 }, { side: 'N', at: -6, metal: true }],
    partitions: [{ axis: 'z', at: -3, door: 0 }, { axis: 'z', at: 4, door: -2 }], furniture: 'lab', profile: 'research', floorMat: 'tiles', innerMat: 'plaster', glassChance: 0.6 }),
  control: () => ({ w: 10, d: 8, floors: 2, wallMat: 'concrete', roof: 'flat', doors: [{ side: 'S', at: 2, metal: true }], furniture: 'control', profile: 'industrial', floorMat: 'concrete', innerMat: 'concrete' }),
  cellblock: () => ({ w: 22, d: 10, floors: 1, floorH: 3.4, wallMat: 'concrete', roof: 'flat', doors: [{ side: 'S', at: 0, metal: true }, { side: 'N', at: 0, metal: true }],
    windows: { S: 2, N: 2, E: 0, W: 0 }, winW: 0.8, partitions: [{ axis: 'z', at: -5, door: 0 }, { axis: 'z', at: 5, door: 0 }], furniture: 'cellblock', profile: 'police', floorMat: 'concrete', innerMat: 'concrete' }),
  hall: () => ({ w: 24, d: 16, floors: 1, floorH: 6, wallMat: 'brick', roof: 'gable', roofMat: 'corrugated', roofPitch: 0.25, doors: [{ side: 'S', at: 0, w: 2.2 }, { side: 'E', at: 4 }, { side: 'W', at: -4 }],
    furniture: 'hall', profile: 'medical', floorMat: 'wood', ceilMat: 'wood_dark', innerMat: 'brick', glassChance: 0.5 }),
  shack: (r) => ({ w: 4.6, d: 4, floors: 1, floorH: 2.5, wallMat: r.pick(['corrugated_rust', 'corrugated', 'wood_dark']), roof: 'shed', roofMat: 'corrugated_rust', doors: [{ side: 'S', at: 0.9 }],
    windows: { E: 1, S: 0, N: 0, W: 0 }, furniture: 'shack', profile: 'camp', floorMat: 'wood_dark', ceilMat: 'wood_dark', ruin: 0.7 }),
  office: () => ({ w: 12, d: 9, floors: 2, wallMat: 'plaster', roof: 'flat', doors: [{ side: 'S', at: 2 }], furniture: 'office', profile: 'office', floorMat: 'tiles', innerMat: 'plaster' }),
  boathouse: () => ({ w: 8, d: 12, floors: 1, floorH: 4, wallMat: 'wood', roof: 'gable', roofMat: 'roof', doors: [{ side: 'S', at: 0, w: 3.5, h: 3.2, gap: true }, { side: 'E', at: -3 }],
    furniture: 'garage', profile: 'residential', floorMat: 'wood_dark', ceilMat: 'wood_dark' }),
  church: (r) => ({ w: 9, d: 16, floors: 1, floorH: 7, wallMat: r.pick(['plaster', 'plaster_yellow']), roof: 'gable', roofMat: 'roof_sheet', roofPitch: 0.75,
    doors: [{ side: 'S', at: 0, w: 1.6, h: 2.6, open: true }, { side: 'E', at: -4, w: 1.0 }], windows: { S: 0, N: 0, E: 4, W: 4 }, winW: 1.0, winSill: 2.2, winTop: 5.2,
    furniture: null, profile: 'residential', floorMat: 'tiles', innerMat: 'plaster', ceilMat: 'wood_dark', trimMat: 'paint_trim', church: true, glassChance: 0.35, ruin: 0.3 }),
  station: () => ({ w: 16, d: 8, floors: 1, floorH: 3.6, wallMat: 'brick', roof: 'gable', roofMat: 'roof_tile', doors: [{ side: 'S', at: -3, w: 1.6 }, { side: 'N', at: 3, w: 1.6 }],
    partitions: [{ axis: 'z', at: 3, door: 0 }], furniture: 'office', profile: 'office', floorMat: 'tiles', innerMat: 'plaster', chimney: true }),
};

export const LAYOUTS = {
  village(L) {
    L.sign(-L.poi.radius * 0.8, L.poi.radius * 0.55, 0, L.poi.name);
    L.alongRoads({ count: 9, arch: ['house', 'house', 'house2', 'house', 'shed', 'house2'], offset: 13, spacing: 22 });
    // the church and its small square are the village landmark (spire visible from afar)
    const church = L.b('church', 44, 22, 3);
    if (church) {
      L.s('memorial', 26, 16, 1);
      L.s('bench', 26, 26.5, 2);
      L.s('bench', 26, 5.5, 0);
      L.s('well', 30, 33);
      L.tree(34, 8, 'broadleaf', 1.05);
      L.tree(35, 37, 'broadleaf', 0.95);
      L.tree(56, 34, 'birch', 0.9);
      L.tree(57, 10, 'broadleaf', 1.1);
    }
    L.b('barn', 40, -48, 1);
    L.yards(['house', 'house2']);
    L.roadside('busStop', 12, -20, 2.2);
    L.s('streetLight', 0, 16, 0);
    L.s('streetLight', -30, 18, 2);
    L.s('dumpster', 18, 22, 0, 'residential');
    L.s('woodPile', 46, -32, 0);
    L.s('campfire', -12, -30);
    for (const [x, z, t, sc] of [[-48, -20, 'broadleaf', 1.0], [-56, 40, 'birch', 0.9], [62, -12, 'broadleaf', 1.15], [-40, 64, 'broadleaf', 0.9], [10, -70, 'birch', 1.0], [-62, -52, 'broadleaf', 1.05]]) L.tree(x, z, t, sc);
    L.scatterRubble(4);
  },
  farmstead(L) {
    L.sign(-50, 46, 1, L.poi.name);
    L.b('house2', -18, 6, 0);
    L.b('barn', 18, -14, 3);
    L.b('shed', -12, -22, 2);
    L.b('shed', 34, 18, 3);
    L.s('silo', 36, -6, 3.2, 15);
    L.s('silo', 36, 3, 3.2, 15);
    L.s('woodPile', -30, -4, 1);
    for (let i = 0; i < 4; i++) L.s('hayBale', 4 + i * 2.2, -36, 0);
    L.perimeter(-60, -55, 60, 55, 'wood', [{ side: 'S', at: 0, w: 10 }, { side: 'W', at: 10, w: 8 }, { side: 'N', at: -20, w: 6 }]);
    L.s('dumpster', -6, 18, 0, 'farm');
    L.yards(['house2']);
    L.s('tractor', 6, 8, 1);
    L.s('hayStack', 22, 30, 0);
    L.s('trough', 30, -36, 0); // kept clear of the pickup parked at the west yard
    L.s('well', -34, 22);
    // small orchard and shelter trees
    for (let i = 0; i < 6; i++) L.tree(-50 + (i % 3) * 7, 34 + Math.floor(i / 3) * 8, 'broadleaf', 0.55 + (i % 2) * 0.12);
    for (const [x, z, t, sc] of [[50, -45, 'broadleaf', 1.1], [-55, -48, 'birch', 0.95], [52, 46, 'broadleaf', 1.0]]) L.tree(x, z, t, sc);
  },
  cabins(L) {
    L.sign(-30, 36, 0, L.poi.name);
    L.b('cabin', -14, -6, 0);
    L.b('cabin', 12, -12, 3);
    L.b('cabin', 2, 18, 2);
    L.b('shed', -24, 16, 1);
    L.s('campfire', 0, 2);
    L.s('woodPile', -6, -16, 0);
    L.s('woodPile', 20, 4, 1);
    L.s('guardTower', 28, 22, 2, { profile: 'hunting', height: 4.5 });
  },
  ranger_station(L) {
    L.sign(-36, 30, 0, L.poi.name);
    L.b('ranger', 0, 0, 0);
    L.b('garage', 18, -2, 3);
    L.b('shed', -16, 12, 0);
    L.s('guardTower', -20, -18, 0, { profile: 'hunting', height: 6.5, roofMat: 'roof' });
    L.s('flagpole', 6, 12);
    L.s('woodPile', 10, -12, 0);
    L.perimeter(-32, -30, 32, 26, 'wood', [{ side: 'S', at: 6, w: 8 }, { side: 'E', at: 0, w: 6 }]);
  },
  comm_tower(L) {
    L.sign(-24, 24, 0, L.poi.name);
    L.s('commMast', 0, 0, 38);
    L.b('booth', 10, 6, 0, { furniture: null });
    L.b('office', -12, 8, 0, { w: 9, d: 7, floors: 1, floorH: 3, furniture: 'control', profile: 'office', radio: true });
    L.radio(-12, 8);
    L.perimeter(-26, -22, 24, 22, 'chain', [{ side: 'S', at: -4, w: 6 }]);
    L.s('hTank', 14, -12, 0, 6, 1.1, 'paint_white');
    L.s('sandbags', -4, 18, 0, 4);
  },
  logging_camp(L) {
    L.sign(-60, 60, 0, L.poi.name);
    L.s('openShed', 0, 0, 0, 16, 8, 4.5);
    L.s('sawTable', 0, 0, 0);
    L.s('logPile', 22, -14, 0, 7);
    L.s('logPile', 22, -4, 0, 7);
    L.s('logPile', -26, -22, 1, 8);
    L.s('logPile', 30, 16, 1, 6);
    L.b('shack', -24, 10, 0);
    L.b('shack', -24, 22, 0);
    L.b('cabin', 8, 28, 2, { furniture: 'cabin', profile: 'lumber' });
    L.b('workshop', -2, -30, 0, { w: 10, d: 8, profile: 'lumber' });
    L.s('container', 34, 34, 1, 'corrugated_rust', 'lumber');
    L.s('campfire', -12, 16);
    L.s('guardTower', -40, -10, 1, { profile: 'camp', height: 5.5, sandbags: true });
    L.s('fuelBarrels', 14, -30);
    L.perimeter(-50, -48, 48, 48, 'scrap', [{ side: 'S', at: 10, w: 8 }, { side: 'E', at: 0, w: 6 }, { side: 'N', at: -10, w: 6 }]);
  },
  checkpoint(L) {
    L.sign(-30, -32, 0, L.poi.name);
    L.b('booth', -8, -2, 0);
    L.b('booth', 9, 4, 2);
    L.s('boomGate', 0, -6, 0, 9);
    L.s('boomGate', 0, 8, 0, 9);
    for (const [x, z, r] of [[-14, -14, 0], [14, -14, 0], [-14, 16, 0], [14, 16, 0], [-18, 0, 1], [18, 0, 1]]) L.s('jersey', x, z, r);
    L.s('sandbags', -12, -9, 0, 5);
    L.s('sandbags', 12, 12, 0, 5);
    L.s('tent', -24, 18, 1, { mat: 'canvas' });
    L.s('tent', 24, -18, 3, { mat: 'canvas' });
    L.s('container', 28, 14, 0, 'corrugated', 'military');
    L.s('guardTower', -26, -12, 0, { profile: 'military', sandbags: true });
    L.s('hesco', -36, -26, -36, 26);
    L.s('hesco', 36, -26, 36, 26);
  },
  military_base(L) {
    L.sign(-30, 150, 0, L.poi.name);
    // paved spine road, parade ground and motor pool apron (drawn first, under everything)
    L.pave(-5, -95, 5, 145);
    L.pave(-45, 20, 15, 70, 'concrete_dark');
    L.pave(-25, -85, 85, -40, 'concrete_dark');
    // perimeter with main gate on the south
    L.perimeter(-140, -120, 140, 145, 'chain', [{ side: 'S', at: 0, w: 38 }, { side: 'N', at: 60, w: 8 }]);
    L.s('gateHouse', 0, 145, 0, 12);
    L.s('boomGate', 0, 141, 0, 10);
    L.b('booth', 10, 136, 0);
    L.s('sandbags', -12, 130, 0, 6);
    for (const [x, z, r] of [[-5, 124, 0], [5, 118, 0], [-5, 112, 0]]) L.s('jersey', x, z, r);
    L.s('guardTower', -134, -114, 0, { profile: 'military', sandbags: true, height: 6 });
    L.s('guardTower', 134, -114, 1, { profile: 'military', sandbags: true, height: 6 });
    L.s('guardTower', -134, 138, 3, { profile: 'military', sandbags: true, height: 6 });
    L.s('guardTower', 134, 138, 2, { profile: 'military', sandbags: true, height: 6 });
    // barracks row
    L.b('barracks', -70, 60, 0);
    L.b('barracks', -70, 30, 0);
    L.b('barracks', -70, 0, 0);
    // headquarters with the codebook
    L.b('hq', 30, 40, 0, { codebook: L.poi.id === 'northwatch_base' });
    L.s('flagpole', 30, 54);
    L.s('commMast', 50, 52, 22);
    // landmarks: arched hangar and water tower
    L.s('hangar', -95, -60, 0, 22, 30, 11);
    L.s('waterTower', 105, -90, 18);
    // motor pool
    L.b('warehouse', 60, -60, 2, { profile: 'military', furniture: 'warehouse' });
    L.b('garage', 10, -60, 2, { profile: 'military' });
    L.b('garage', -2, -60, 2, { profile: 'military' });
    L.s('militaryTruck', 20, -36, 1);
    L.s('militaryTruck', 34, -38, 1);
    L.s('militaryTruck', 75, -20, 0);
    L.s('helipad', -60, -100);
    for (let i = 0; i < 4; i++) L.s('tent', 80 + (i % 2) * 14, 20 + Math.floor(i / 2) * 16, 0, { mat: 'canvas', profile: 'military' });
    L.s('container', 100, 90, 0, 'olive', 'military_high');
    L.s('container', 104, 90, 0, 'corrugated', 'military');
    L.s('container', -110, 90, 1, 'olive', 'military');
    L.s('hesco', -30, 100, 30, 100);
    L.s('sandbags', 0, 20, 0, 6);
    L.s('sandbags', -30, -20, 1, 6);
    L.s('jersey', 18, 110, 0);
    L.s('jersey', -18, 110, 0);
    L.s('hTank', -110, -10, 0, 10, 1.6, 'olive');
    for (const [x, z, r] of [[-12, 90, 0], [12, 30, 1], [-50, -30, 0], [70, 60, 2], [-110, 60, 1], [110, 20, 3]]) L.s('floodlight', x, z, r, 10);
  },
  evac_centre(L) {
    L.sign(-60, 80, 0, L.poi.name);
    L.b('hall', 0, -10, 0);
    for (let i = 0; i < 6; i++) L.s('tent', -50 + (i % 3) * 14, 30 + Math.floor(i / 3) * 18, 0, { mat: i % 2 ? 'canvas_tan' : 'canvas', profile: i < 2 ? 'medical' : 'camp' });
    L.s('tent', 40, 34, 0, { mat: 'canvas_tan', profile: 'medical', w: 6, d: 9 });
    L.s('container', 44, -36, 1, 'corrugated_blue', 'medical');
    L.perimeter(-70, -50, 70, 70, 'chain', [{ side: 'S', at: 0, w: 10 }, { side: 'W', at: 20, w: 6 }]);
    L.s('sandbags', -6, 64, 0, 5);
    L.s('sandbags', 6, 64, 0, 5);
    L.s('guardTower', 60, 60, 2, { profile: 'camp' });
    L.s('campfire', 20, 20);
    L.s('marketStall', 30, 10, 0);
  },
  hospital(L) {
    L.sign(-40, 60, 0, L.poi.name);
    L.b('hospital', 0, 0, 0);
    L.b('hospital', 34, 6, 3, { floors: 1, w: 16, d: 12 });
    L.b('garage', -30, -20, 1, { profile: 'medical' });
    L.s('tent', -24, 30, 0, { mat: 'canvas_tan', profile: 'medical' });
    L.s('tent', -10, 34, 0, { mat: 'canvas_tan', profile: 'medical' });
    L.s('dumpster', 20, 30, 0, 'medical');
    L.s('streetLight', -12, 24, 0);
    L.s('streetLight', 14, 24, 0);
    L.alongRoads({ count: 3, arch: ['apartment', 'shop'], offset: 15, spacing: 30 });
  },
  police(L) {
    L.sign(-30, 40, 0, L.poi.name);
    L.b('police', 0, 0, 0);
    L.b('garage', 22, 2, 3, { profile: 'police' });
    L.s('jersey', -8, 22, 0);
    L.s('jersey', 8, 22, 0);
    L.perimeter(-34, -28, 34, 30, 'wall', [{ side: 'S', at: 0, w: 10 }]);
    L.s('streetLight', 0, 26, 0);
  },
  town(L) {
    L.alongRoads({ count: 14, arch: ['apartment', 'house2', 'shop', 'house', 'apartment', 'office'], offset: 16, spacing: 26 });
    L.s('dumpster', 20, 10, 0);
    L.s('dumpster', -30, -20, 1);
    L.scatterRubble(10);
  },
  shopping(L) {
    L.sign(-50, 70, 0, L.poi.name);
    L.b('warehouse', 0, -10, 0, { wallMat: 'plaster_yellow', furniture: 'shop', profile: 'kitchen', w: 30, d: 20, floorH: 6, doors: [{ side: 'S', at: -5, w: 2.4 }, { side: 'S', at: 5, w: 2.4 }, { side: 'N', at: 0, w: 4, h: 4, gap: true }], windows: { S: 4, N: 0, E: 2, W: 2 }, winW: 2.6 });
    L.b('shop', -30, 30, 0);
    L.b('shop', 28, 30, 0, { profile: 'residential' });
    for (let i = 0; i < 6; i++) L.s('wreckCar', -20 + i * 8, 34, i % 2);
    L.s('streetLight', -10, 46, 0);
    L.s('streetLight', 14, 46, 0);
    L.s('dumpster', 24, -28, 0, 'kitchen');
  },
  industrial(L) {
    L.sign(-120, 130, 0, L.poi.name);
    L.b('warehouse', -60, -40, 0);
    L.b('warehouse', -60, 10, 0);
    L.b('warehouse', 20, -70, 1, { w: 30, d: 18 });
    L.b('workshop', 40, 10, 0);
    L.b('office', 70, 60, 2);
    L.s('chimney', 70, -20, 34);
    L.s('chimney', 80, -20, 28);
    L.s('tank', 100, 30, 5, 8, 'paint_white');
    L.s('tank', 100, 50, 5, 8, 'rust');
    L.s('pipe', 75, -12, 100, -12, 0.4, 3.5);
    L.s('pipe', 100, -12, 100, 22, 0.4, 3.5);
    for (let i = 0; i < 6; i++) L.s('container', -100 + (i % 3) * 3.2, 70 + Math.floor(i / 3) * 7, 0, ['corrugated', 'corrugated_blue', 'corrugated_rust', 'olive'][i % 4], 'industrial');
    L.perimeter(-130, -110, 130, 120, 'wall', [{ side: 'S', at: 0, w: 14 }, { side: 'E', at: 0, w: 10 }, { side: 'W', at: 30, w: 8 }]);
    L.s('guardTower', -120, 110, 3, { profile: 'industrial', sandbags: true });
    L.s('guardTower', 120, -100, 1, { profile: 'industrial', sandbags: true });
  },
  warehouse_district(L) {
    L.alongRoads({ count: 6, arch: ['warehouse', 'warehouse', 'workshop', 'office'], offset: 22, spacing: 40 });
    for (let i = 0; i < 5; i++) L.s('container', -40 + i * 3.1, -60, 0, ['corrugated', 'corrugated_blue', 'corrugated_rust'][i % 3], 'industrial');
    L.s('dumpster', 0, 40, 0, 'industrial');
  },
  railyard(L) {
    L.sign(-80, 60, 0, L.poi.name);
    L.b('station', 0, 30, 2);
    L.b('warehouse', -60, 40, 2);
    L.b('workshop', 60, 40, 2, { profile: 'industrial' });
    L.trains(8);
    L.s('tank', -90, -40, 4, 10, 'rust');
  },
  treatment_plant(L) {
    L.sign(-60, 80, 0, L.poi.name);
    L.s('pool', -40, -30, 12);
    L.s('pool', 0, -30, 12);
    L.s('pool', 40, -30, 12);
    L.b('control', -30, 40, 0);
    L.b('warehouse', 40, 40, 0, { w: 20, d: 14 });
    L.s('tank', 80, -10, 5, 9, 'paint_white');
    L.s('pipe', -40, -10, 40, -10, 0.35, 2.5);
    L.perimeter(-100, -60, 100, 80, 'chain', [{ side: 'S', at: 0, w: 10 }, { side: 'W', at: 0, w: 6 }]);
    L.s('guardTower', 90, 70, 2, { profile: 'industrial' });
  },
  settlement(L) {
    L.sign(-70, 70, 0, L.poi.name);
    L.b('cabin', -30, -20, 0, { profile: 'camp' });
    L.b('cabin', -10, -26, 0, { profile: 'camp' });
    L.b('cabin', 14, -24, 0, { profile: 'camp' });
    L.b('shack', 30, -10, 3);
    L.b('shack', 30, 6, 3);
    L.b('house', -30, 16, 1, { profile: 'kitchen' });
    for (let i = 0; i < 4; i++) L.s('marketStall', -8 + i * 6, 10, 2);
    L.s('campfire', 2, -4);
    L.s('campfire', -16, 2);
    L.s('guardTower', -54, -50, 0, { profile: 'camp', roofMat: 'roof' });
    L.s('guardTower', 54, 50, 2, { profile: 'camp', roofMat: 'roof' });
    L.perimeter(-60, -56, 60, 56, 'palisade', [{ side: 'S', at: 0, w: 8 }, { side: 'N', at: 10, w: 6 }]);
  },
  dam(L) {
    L.sign(-60, 70, 0, L.poi.name);
    L.s('damWall', 0, -40, 0, 80, 14);
    L.b('control', -20, 20, 0);
    L.b('workshop', 26, 26, 0);
    L.s('hTank', -50, 30, 1, 8, 1.4, 'olive');
    L.perimeter(-80, -10, 80, 80, 'chain', [{ side: 'S', at: 0, w: 10 }]);
  },
  fuel_depot(L) {
    L.sign(-70, 80, 0, L.poi.name);
    for (let i = 0; i < 4; i++) L.s('tank', -50 + i * 26, -30, 8, 10, i % 2 ? 'paint_white' : 'rust');
    L.s('canopy', 30, 40, 18, 10, 5);
    L.s('fuelPump', 24, 40, 0);
    L.s('fuelPump', 36, 40, 0);
    L.b('kiosk', 30, 60, 0);
    L.b('control', -40, 40, 0, { floors: 1, profile: 'fuel' });
    L.s('pipe', -60, -10, 40, -10, 0.45, 2.0);
    L.perimeter(-90, -55, 90, 80, 'chain', [{ side: 'S', at: 30, w: 14 }]);
    L.s('guardTower', -80, 70, 3, { profile: 'military', sandbags: true });
    L.s('guardTower', 80, -48, 1, { profile: 'military', sandbags: true });
  },
  marina(L) {
    L.sign(-50, 50, 0, L.poi.name);
    L.b('boathouse', -20, -10, 2);
    L.b('house', 20, 10, 0, { profile: 'residential' });
    L.b('shop', -30, 30, 0, { profile: 'fuel' });
    L.docks();
    L.s('fuelPump', 6, -30, 0);
  },
  underground(L) {
    L.sign(-50, 60, 0, L.poi.name);
    L.s('bunkerMound', 0, -10, 0, 18, 22);
    L.b('hq', 0, -10, 0, { floors: 1, w: 16, d: 20, floorH: 4, wallMat: 'concrete_dark', furniture: 'warehouse', profile: 'military_high', doors: [{ side: 'S', at: 0, w: 2.6, h: 3, metal: true }], windows: { S: 0, N: 0, E: 0, W: 0 } });
    L.b('booth', 14, 22, 0);
    L.s('jersey', -6, 24, 0);
    L.s('jersey', 6, 24, 0);
    L.perimeter(-60, -50, 60, 55, 'chain', [{ side: 'S', at: 0, w: 10 }]);
    L.s('guardTower', -54, 48, 3, { profile: 'military', sandbags: true });
    L.s('tent', 30, 20, 0, { profile: 'military' });
  },
  quarry(L) {
    L.sign(-90, 90, 0, L.poi.name);
    L.s('mineEntrance', -40, -60, 0);
    for (let i = 0; i < 6; i++) L.s('rockPile', -60 + i * 22, 20 + (i % 2) * 18, 6 + (i % 3) * 2);
    L.s('conveyor', 30, -20, 1, 24, 7);
    L.b('office', 60, 50, 0, { floors: 1, profile: 'industrial', furniture: 'control' });
    L.b('workshop', 20, 60, 0);
    L.s('container', 70, 10, 0, 'corrugated_rust', 'industrial');
    L.s('hTank', 80, -20, 0, 8, 1.3, 'paint_yellow');
  },
  radar(L) {
    L.sign(-40, 50, 0, L.poi.name);
    L.s('radarDome', 0, -10);
    L.b('barracks', 24, 24, 0, { w: 14 });
    L.b('booth', -18, 30, 0);
    L.s('guardTower', -36, -30, 0, { profile: 'military', sandbags: true });
    L.perimeter(-46, -44, 46, 44, 'chain', [{ side: 'S', at: -10, w: 8 }]);
    L.s('commMast', 30, -26, 26);
  },
  research(L) {
    L.sign(-70, 80, 0, L.poi.name);
    L.b('lab', -20, -10, 0);
    L.b('lab', 30, -20, 1, { w: 16 });
    L.b('office', -10, 40, 0, { profile: 'research', furniture: 'lab' });
    L.s('tank', 60, 30, 3, 6, 'paint_white');
    L.s('hTank', 50, 50, 1, 7, 1.2, 'paint_white');
    L.perimeter(-90, -60, 90, 70, 'wall', [{ side: 'S', at: 0, w: 10 }]);
    L.s('guardTower', 82, 62, 2, { profile: 'military' });
  },
  prison(L) {
    L.sign(-60, 130, 0, L.poi.name);
    L.perimeter(-110, -100, 110, 110, 'wall', [{ side: 'S', at: 0, w: 8 }]);
    L.b('cellblock', -40, -40, 0);
    L.b('cellblock', 40, -40, 0);
    L.b('cellblock', -40, 20, 0);
    L.b('police', 40, 30, 2, { profile: 'police' });
    L.b('workshop', 0, 70, 0, { profile: 'industrial' });
    for (const [x, z, r] of [[-104, -94, 0], [104, -94, 1], [-104, 104, 3], [104, 104, 2]]) L.s('guardTower', x, z, r, { profile: 'police', height: 7, sandbags: true });
  },
  compound(L) {
    L.sign(-60, 64, 0, L.poi.name);
    L.perimeter(-55, -50, 55, 55, 'scrap', [{ side: 'S', at: 0, w: 7 }]);
    for (let i = 0; i < 6; i++) L.b('shack', -36 + (i % 3) * 18, -26 + Math.floor(i / 3) * 22, (i % 2) * 2);
    L.b('workshop', 26, 30, 2, { profile: 'camp' });
    L.s('guardTower', -48, 46, 3, { profile: 'camp', sandbags: true });
    L.s('guardTower', 48, -44, 1, { profile: 'camp', sandbags: true });
    L.s('campfire', 0, 10);
    L.s('container', 40, -10, 1, 'corrugated_rust', 'camp');
    L.s('fuelBarrels', -30, 30);
  },
};
