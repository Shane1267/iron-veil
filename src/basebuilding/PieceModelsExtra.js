// Compound-building pieces (log perimeter walls, gates, towers, firing platforms, sandbag
// nests, barricades, fencing, blast walls, reinforced doors, sheds, exterior lights, support
// pillars) and the furniture/decor catalogue (civilian, industrial, military, modern,
// abandoned and survivalist styles). Same conventions as PieceModels: piece-local space,
// base at y = 0, +z = outward face; perimeter pieces run along local x.

// fabric/material variants cycled with F on decor pieces
export const VARIANTS = {
  fabric: ['fabric_red', 'fabric_blue', 'fabric_grey', 'canvas_tan', 'olive'],
  wood: ['wood', 'wood_dark', 'wood_red', 'wood_green', 'wood_blue'],
  paint: ['paint_white', 'paint_red', 'paint_yellow', 'olive', 'metal_dark'],
};

const logRow = (B, len, h, z, opts = {}) => {
  // a row of upright logs with sharpened tops, sunk 1.2 m into the ground for slopes
  const n = Math.round(len / 0.36);
  const step = len / n;
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + step * (i + 0.5);
    const hh = h + ((i * 37) % 5) * 0.06;
    B.cylinder('logs', x, (hh - 1.2) / 2, z, 0.17, 0.19, hh + 1.2, 7);
    if (!opts.flat) B.cylinder('wood_dark', x, hh + 0.14, z, 0.0, 0.17, 0.28, 7);
  }
};

export function buildExtra(B, type, opts = {}) {
  const v = opts.variant || 0;
  const fab = VARIANTS.fabric[v % VARIANTS.fabric.length];
  const woodV = VARIANTS.wood[v % VARIANTS.wood.length];
  const paint = VARIANTS.paint[v % VARIANTS.paint.length];
  switch (type) {
    // ------------------------------------------------------------ compound walls
    case 'log_wall': case 'log_wall_reinforced': {
      logRow(B, 4.0, 3.6, 0);
      // horizontal braces and support posts on the inside face (-z)
      for (const y of [0.9, 2.6]) B.box('wood_dark', 0, y, -0.24, 4.0, 0.2, 0.14);
      for (const x of [-1.6, 0, 1.6]) { B.box('logs', x, 1.4, -0.5, 0.2, 3.0, 0.2, { rotX: 0.32 }); B.box('wood_dark', x, 0.05, -0.92, 0.3, 0.12, 0.3); }
      if (type === 'log_wall_reinforced') {
        for (const y of [0.6, 1.8, 3.0]) B.box('metal_dark', 0, y, 0.22, 4.02, 0.16, 0.03);
        for (const x of [-1.5, -0.5, 0.5, 1.5]) B.box('corrugated_rust', x, 1.1, 0.25, 0.95, 1.9, 0.03);
      }
      return true;
    }
    case 'log_corner': {
      for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2], [0, 0]]) { B.cylinder('logs', x, 1.2, z, 0.2, 0.22, 4.6, 7); B.cylinder('wood_dark', x, 3.66, z, 0, 0.2, 0.3, 7); }
      B.box('wood_dark', 0, 2.5, 0, 0.9, 0.18, 0.9);
      return true;
    }
    case 'log_gateway': case 'log_gate': case 'gate_reinforced': {
      for (const x of [-2.15, 2.15]) { B.cylinder('logs', x, 1.4, 0, 0.26, 0.28, 5.2, 8); B.cylinder('wood_dark', x, 4.15, 0, 0, 0.26, 0.3, 8); }
      B.cylinder('logs', 0, 4.3, 0, 0.2, 0.2, 4.7, 8, { rotZ: Math.PI / 2 });
      B.box('wood_dark', 0, 4.65, 0, 1.2, 0.5, 0.1); // name board
      for (const x of [-2.15, 2.15]) B.box('logs', x, 1.4, -0.7, 0.2, 2.8, 0.2, { rotX: 0.4 });
      return true;
    }
    case 'logGateLeaf': case 'steelGateLeaf': {
      // one leaf, hinge at x = 0, extends +x (2.0 m)
      if (type === 'logGateLeaf') {
        for (let i = 0; i < 6; i++) B.cylinder('logs', 0.18 + i * 0.33, 1.55, 0, 0.15, 0.15, 3.1, 6);
        for (const y of [0.6, 2.5]) B.box('wood_dark', 1.0, y, -0.18, 2.0, 0.18, 0.08);
        B.box('wood_dark', 1.0, 1.55, -0.2, 0.14, 2.3, 0.06, { rotZ: 0.75 });
      } else {
        B.box('metal_dark', 1.0, 1.55, 0, 1.98, 3.1, 0.12);
        for (const y of [0.4, 1.55, 2.7]) B.box('metal', 1.0, y, 0.07, 1.98, 0.14, 0.04);
        for (const x of [0.15, 1.85]) B.box('metal', x, 1.55, 0.07, 0.12, 3.1, 0.04);
        B.box('olive', 1.0, 1.0, 0.075, 1.6, 0.6, 0.02);
      }
      return true;
    }
    case 'log_platform': {
      // firing step behind a wall: 4 m walkway at 2.0 m with a rail and a ladder
      for (const x of [-1.8, 1.8]) for (const z of [-0.7, 0.7]) B.cylinder('logs', x, 1.0, z, 0.12, 0.13, 2.0, 6);
      B.box('wood', 0, 2.0, 0, 4.0, 0.12, 1.6);
      for (let x = -1.85; x <= 1.85; x += 0.92) B.box('wood_dark', x, 2.5, -0.75, 0.08, 1.0, 0.08);
      B.box('wood_dark', 0, 2.95, -0.75, 4.0, 0.1, 0.1);
      for (const y of [0.4, 0.85, 1.3, 1.75]) B.box('wood', -1.2, y, -1.05, 0.6, 0.06, 0.08);
      for (const x of [-1.48, -0.92]) B.box('wood_dark', x, 1.0, -1.05, 0.06, 2.0, 0.06);
      return true;
    }
    case 'log_tower': {
      for (const [x, z] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) B.cylinder('logs', x, 3.4, z, 0.18, 0.2, 6.8, 7);
      for (const y of [1.6, 3.8]) for (const [x, z, r] of [[0, -1.3, 0], [0, 1.3, 0], [-1.3, 0, 1], [1.3, 0, 1]]) B.box('wood_dark', x, y, z, r ? 0.14 : 2.6, 0.14, r ? 2.6 : 0.14);
      B.box('wood', 0, 6.4, 0, 3.0, 0.14, 3.0);
      for (const [x, z, r] of [[0, -1.45, 0], [-1.45, 0, 1], [1.45, 0, 1]]) B.box('logs', x, 6.95, z, r ? 0.12 : 3.0, 1.0, r ? 3.0 : 0.12);
      B.box('logs', 0.6, 6.95, 1.45, 1.8, 1.0, 0.12);
      for (const [x, z] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) B.box('wood_dark', x, 8.0, z, 0.12, 1.1, 0.12);
      B.gable('roof_sheet', 0, 8.55, 0, 3.6, 0.9, 3.6);
      for (let y = 0.4; y < 6.4; y += 0.45) B.box('wood', -0.7, y, 1.48, 0.5, 0.06, 0.08);
      return true;
    }
    case 'sandbag_nest': {
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 9; i++) {
          const a = -Math.PI * 0.75 + (i / 8) * Math.PI * 1.5;
          B.box('sand', Math.sin(a) * 1.35, 0.17 + row * 0.3, Math.cos(a) * 1.35, 0.62, 0.3, 0.4, { rotY: a + (row % 2) * 0.2 });
        }
      }
      return true;
    }
    case 'barricade_hedgehog': {
      for (const [rx, rz] of [[0.6, 0], [-0.6, 0], [0, 0.6]]) B.box('rust', 0, 0.75, 0, 0.14, 2.0, 0.14, { rotX: rx, rotZ: rz + (rz ? 0 : 0.4) });
      B.box('rust', 0, 0.75, 0, 0.14, 2.0, 0.14, { rotX: -0.55, rotZ: -0.5 });
      return true;
    }
    case 'barricade_spikes': {
      B.box('logs', 0, 0.35, 0, 3.0, 0.2, 0.2);
      for (let i = 0; i < 7; i++) { const x = -1.35 + i * 0.45; B.cylinder('wood_dark', x, 0.65, 0.25, 0.0, 0.07, 1.4, 5, { rotX: 0.75 }); B.cylinder('wood_dark', x + 0.2, 0.65, -0.25, 0.0, 0.07, 1.4, 5, { rotX: -0.75 }); }
      return true;
    }
    case 'mil_fence': {
      for (const x of [-2, 2]) B.box('metal_dark', x, 1.25, 0, 0.08, 2.5, 0.08);
      B.box('chainlink', 0, 1.2, 0, 4.0, 2.3, 0.02, { ao: false });
      B.box('metal_dark', 0, 2.42, 0, 4.0, 0.05, 0.05);
      for (let i = 0; i < 9; i++) B.cylinder('metal', -2 + i * 0.5, 2.7, 0, 0.2, 0.2, 0.02, 10, { rotZ: Math.PI / 2, open: true }); // razor wire coils
      return true;
    }
    case 'blast_wall': {
      // gabion (HESCO-style) wall: mesh baskets filled with sand, 2 m per segment
      for (const x of [-0.5, 0.5]) { B.box('sand', x, 1.1, 0, 0.98, 2.2, 1.0); B.box('chainlink', x, 1.1, 0.505, 1.0, 2.2, 0.01, { ao: false }); B.box('chainlink', x, 1.1, -0.505, 1.0, 2.2, 0.01, { ao: false }); }
      B.box('sand', 0, 2.55, 0, 1.6, 0.7, 0.8);
      B.box('canvas_tan', 0, 2.92, 0, 1.62, 0.04, 0.82);
      return true;
    }
    case 'doorSteel': {
      B.box('metal_dark', 0.575, 1.08, 0, 1.15, 2.15, 0.1);
      for (const y of [0.35, 1.08, 1.8]) B.box('metal', 0.575, y, 0.055, 1.1, 0.1, 0.02);
      B.box('metal', 1.0, 1.05, 0.08, 0.05, 0.25, 0.06);
      B.box('black', 0.575, 1.6, 0.06, 0.3, 0.08, 0.01); // viewing slot
      return true;
    }
    case 'storage_shed': {
      B.box('wood_dark', 0, 0.05, 0, 2.4, 0.1, 2.0);
      for (const sx of [-1, 1]) B.box(woodV, sx * 1.17, 1.15, 0, 0.06, 2.2, 2.0);
      B.box(woodV, 0, 1.15, -0.97, 2.4, 2.2, 0.06);
      B.box(woodV, -0.65, 1.15, 0.97, 1.1, 2.2, 0.06);
      B.box('wood_dark', 0.55, 1.1, 1.0, 1.1, 2.1, 0.05); // door
      B.box('metal', 0.95, 1.1, 1.04, 0.05, 0.14, 0.04);
      B.box('roof_sheet', 0, 2.35, 0, 2.7, 0.08, 2.4, { rotX: 0.12 });
      for (const y of [0.6, 1.2, 1.8]) B.box('wood', 0, y, -0.8, 2.2, 0.04, 0.32, { indoor: true });
      return true;
    }
    case 'floodlight': {
      B.box('metal_dark', 0, 2.1, 0, 0.12, 4.2, 0.12);
      B.box('metal_dark', 0, 0.04, 0, 0.6, 0.08, 0.6);
      B.box('metal_dark', 0, 4.2, 0, 0.9, 0.08, 0.1);
      for (const x of [-0.35, 0.35]) { B.box('metal_dark', x, 4.05, 0.12, 0.3, 0.24, 0.2, { rotX: 0.4 }); B.box('emissive_lamp', x, 4.0, 0.23, 0.24, 0.18, 0.01, { rotX: 0.4 }); }
      B.box('black', 0, 0.35, 0.12, 0.3, 0.4, 0.2); // battery box
      return true;
    }
    case 'lantern_post': {
      B.box('wood_dark', 0, 1.1, 0, 0.12, 2.2, 0.12);
      B.box('wood_dark', 0.2, 2.15, 0, 0.45, 0.07, 0.07);
      B.box('metal_dark', 0.38, 1.95, 0, 0.16, 0.24, 0.16);
      B.box('emissive_lamp', 0.38, 1.95, 0, 0.11, 0.17, 0.11);
      return true;
    }
    case 'pillar': {
      B.box('logs', 0, 1.5, 0, 0.36, 3.0, 0.36);
      B.box('wood_dark', 0, 2.9, 0, 0.6, 0.2, 0.6);
      B.box('wood_dark', 0, 0.1, 0, 0.55, 0.2, 0.55);
      return true;
    }
    // ------------------------------------------------------------ furniture & decor
    case 'sofa': case 'sofa_worn': {
      const m = type === 'sofa_worn' ? 'canvas_tan' : fab;
      B.box('wood_dark', 0, 0.12, 0, 2.0, 0.2, 0.85);
      B.box(m, 0, 0.36, 0.05, 1.8, 0.24, 0.75);
      B.box(m, 0, 0.65, 0.36, 2.0, 0.6, 0.2);
      for (const x of [-0.93, 0.93]) B.box(m, x, 0.5, 0.0, 0.18, 0.4, 0.85);
      if (type === 'sofa_worn') { B.box('black', -0.4, 0.49, 0.0, 0.4, 0.01, 0.3); B.box('dirt', 0.5, 0.49, -0.1, 0.5, 0.01, 0.3); }
      return true;
    }
    case 'armchair': {
      B.box('wood_dark', 0, 0.12, 0, 0.9, 0.2, 0.85);
      B.box(fab, 0, 0.36, 0.05, 0.7, 0.24, 0.72);
      B.box(fab, 0, 0.7, 0.36, 0.9, 0.7, 0.2);
      for (const x of [-0.4, 0.4]) B.box(fab, x, 0.5, 0, 0.14, 0.4, 0.85);
      return true;
    }
    case 'cabinet': case 'cabinet_broken': case 'med_cabinet': {
      const m = type === 'med_cabinet' ? 'paint_white' : type === 'cabinet_broken' ? 'wood_dark' : woodV;
      B.box(m, 0, 0.9, 0, 1.0, 1.8, 0.45);
      B.box('black', 0, 0.9, 0.23, 0.02, 1.7, 0.01);
      for (const x of [-0.1, 0.1]) B.box('metal', x, 1.0, 0.24, 0.03, 0.12, 0.02);
      if (type === 'med_cabinet') { B.box('paint_red', 0, 1.45, 0.235, 0.24, 0.07, 0.01); B.box('paint_red', 0, 1.45, 0.235, 0.07, 0.24, 0.01); }
      if (type === 'cabinet_broken') B.box('wood_dark', 0.32, 0.9, 0.42, 0.45, 1.6, 0.03, { rotY: 0.9 });
      return true;
    }
    case 'kitchen_counter': {
      B.box(woodV, 0, 0.44, 0, 2.0, 0.88, 0.6);
      B.box('stone', 0, 0.9, 0, 2.04, 0.04, 0.64);
      B.box('metal', 0.5, 0.88, 0, 0.5, 0.06, 0.4); // sink
      B.box('metal', 0.5, 1.05, -0.24, 0.03, 0.3, 0.03);
      for (const x of [-0.6, -0.1]) B.box('metal', x, 0.6, 0.31, 0.12, 0.03, 0.02);
      return true;
    }
    case 'fridge': {
      B.box('paint_white', 0, 0.9, 0, 0.7, 1.8, 0.65);
      B.box('metal_dark', 0, 1.2, 0.33, 0.66, 0.02, 0.01);
      B.box('metal', 0.28, 1.45, 0.34, 0.03, 0.3, 0.03);
      return true;
    }
    case 'shelf_metal': case 'tool_rack': {
      for (const x of [-0.7, 0.7]) for (const z of [-0.2, 0.2]) B.box('metal_dark', x, 1.0, z, 0.04, 2.0, 0.04);
      if (type === 'shelf_metal') for (const y of [0.3, 0.9, 1.5, 1.95]) B.box('metal', 0, y, 0, 1.44, 0.03, 0.44);
      else { B.box('wood', 0, 1.2, 0.18, 1.44, 1.4, 0.03); for (const [x, y, r] of [[-0.4, 1.5, 0.3], [0, 1.2, -0.2], [0.4, 1.4, 0], [-0.2, 0.8, 1.2]]) B.box('metal', x, y, 0.22, 0.05, 0.5, 0.03, { rotZ: r }); }
      return true;
    }
    case 'clock': {
      B.box('wood_dark', 0, 1.0, 0, 0.45, 2.0, 0.3);
      B.cylinder('paint_white', 0, 1.6, 0.16, 0.18, 0.18, 0.02, 16, { rotX: Math.PI / 2 });
      B.box('black', 0, 1.65, 0.175, 0.015, 0.12, 0.01);
      B.box('brass', 0, 0.8, 0.16, 0.12, 0.4, 0.01);
      return true;
    }
    case 'curtains': {
      B.box('metal_dark', 0, 2.3, 0, 2.4, 0.04, 0.04);
      for (let i = 0; i < 8; i++) B.box(fab, -1.05 + i * 0.3, 1.2, (i % 2) * 0.05, 0.3, 2.2, 0.03);
      return true;
    }
    case 'painting': {
      const pal = ['paint_red', 'wood_green', 'fabric_blue', 'paint_yellow', 'canvas_tan'];
      B.box('wood_dark', 0, 1.5, 0, 1.0, 0.75, 0.05);
      B.box(pal[v % pal.length], 0, 1.5, 0.03, 0.85, 0.6, 0.01);
      B.box(pal[(v + 2) % pal.length], -0.12, 1.42, 0.035, 0.4, 0.22, 0.01);
      B.box('wood_dark', 0, 0.75, 0, 0.06, 1.5, 0.06); // easel/stand so it can stand anywhere
      return true;
    }
    case 'tv': {
      B.box('wood_dark', 0, 0.3, 0, 1.1, 0.6, 0.45);
      B.box('black', 0, 0.9, 0, 0.9, 0.55, 0.1);
      B.box('metal_dark', 0, 0.62, 0, 0.2, 0.05, 0.2);
      return true;
    }
    case 'tvScreen': B.box('emissive_lamp', 0, 0.9, 0.055, 0.8, 0.45, 0.01); return true;
    case 'floor_lamp': {
      B.box('metal_dark', 0, 0.03, 0, 0.35, 0.06, 0.35);
      B.box('metal_dark', 0, 0.85, 0, 0.04, 1.6, 0.04);
      B.cylinder(fab === 'olive' ? 'canvas_tan' : 'canvas_tan', 0, 1.7, 0, 0.16, 0.25, 0.3, 12, { open: true });
      B.box('emissive_lamp', 0, 1.62, 0, 0.08, 0.1, 0.08);
      return true;
    }
    case 'desk': {
      B.box(woodV, 0, 0.74, 0, 1.6, 0.05, 0.75);
      B.box(woodV, -0.55, 0.37, 0, 0.45, 0.72, 0.7);
      B.box('wood_dark', 0.75, 0.37, 0, 0.05, 0.72, 0.7);
      B.box('metal', -0.55, 0.55, 0.36, 0.12, 0.02, 0.02);
      return true;
    }
    case 'computer': {
      B.box(woodV, 0, 0.74, 0, 1.4, 0.05, 0.7);
      for (const x of [-0.65, 0.65]) B.box('metal_dark', x, 0.37, 0, 0.05, 0.72, 0.65);
      B.box('paint_white', 0, 1.0, -0.15, 0.5, 0.38, 0.06);
      B.box('metal_dark', 0, 0.82, -0.15, 0.1, 0.1, 0.1);
      B.box('paint_white', 0, 0.78, 0.12, 0.45, 0.02, 0.15);
      B.box('paint_white', 0.5, 0.95, -0.1, 0.18, 0.4, 0.4);
      return true;
    }
    case 'computerScreen': B.box('emissive_lamp', 0, 1.0, -0.115, 0.42, 0.3, 0.01); return true;
    case 'radio_set': {
      B.box(woodV, 0, 0.37, 0, 0.9, 0.74, 0.5);
      B.box('olive', 0, 0.92, 0, 0.6, 0.36, 0.34);
      B.box('black', -0.12, 0.92, 0.175, 0.24, 0.16, 0.01);
      for (const x of [0.1, 0.2]) B.cylinder('metal', x, 0.92, 0.18, 0.025, 0.025, 0.02, 8, { rotX: Math.PI / 2 });
      B.box('metal', 0.25, 1.4, -0.1, 0.01, 0.7, 0.01);
      return true;
    }
    case 'mil_poster': case 'wall_map': case 'noticeboard': {
      B.box('wood_dark', 0, 0.8, 0, 0.08, 1.6, 0.08);
      const w = type === 'wall_map' ? 1.6 : type === 'noticeboard' ? 1.2 : 0.7;
      const hgt = type === 'wall_map' ? 1.1 : type === 'noticeboard' ? 0.9 : 1.0;
      B.box(type === 'noticeboard' ? 'wood' : 'wood_dark', 0, 1.6 + hgt / 2, 0.05, w + 0.06, hgt + 0.06, 0.04);
      if (type === 'mil_poster') { B.box('olive', 0, 1.6 + hgt / 2, 0.075, w, hgt, 0.01); B.box('paint_yellow', 0, 1.6 + hgt * 0.75, 0.08, w * 0.8, 0.12, 0.01); B.box('black', 0, 1.6 + hgt * 0.4, 0.08, w * 0.5, 0.35, 0.01); }
      if (type === 'wall_map') { B.box('canvas_tan', 0, 2.15, 0.075, w, hgt, 0.01); B.box('wood_green', -0.3, 2.2, 0.08, 0.5, 0.4, 0.005); B.box('fabric_blue', 0.35, 2.0, 0.08, 0.3, 0.6, 0.005); B.box('paint_red', 0.1, 2.3, 0.082, 0.05, 0.05, 0.005); }
      if (type === 'noticeboard') for (const [x, y] of [[-0.35, 2.2], [0.1, 2.25], [0.35, 1.9], [-0.2, 1.85]]) B.box('paint_white', x, y, 0.075, 0.24, 0.3, 0.005, { rotZ: (x * 7) % 0.2 });
      return true;
    }
    case 'weapon_display': {
      B.box('olive', 0, 0.9, 0, 1.4, 1.8, 0.4);
      B.box('metal_dark', 0, 0.9, 0.2, 1.3, 1.7, 0.01);
      for (const y of [0.6, 1.2]) B.box('metal', 0, y, 0.15, 1.2, 0.04, 0.12);
      return true;
    }
    case 'ammo_crates': {
      for (const [x, y, z] of [[-0.35, 0.2, 0], [0.35, 0.2, 0], [0, 0.6, 0]]) { B.box('olive', x, y, z, 0.66, 0.38, 0.4); B.box('metal_dark', x, y + 0.1, z + 0.205, 0.5, 0.05, 0.01); }
      return true;
    }
    case 'crate_pile': {
      for (const [x, y, z, r] of [[-0.4, 0.3, 0, 0.1], [0.4, 0.3, 0.1, -0.2], [0, 0.85, 0, 0.5]]) B.box('wood_dark', x, y, z, 0.6, 0.6, 0.6, { rotY: r });
      return true;
    }
    case 'hide_rug': B.box('canvas_tan', 0, 0.01, 0, 1.6, 0.02, 2.0); B.box('wood_dark', 0, 0.015, 0, 1.2, 0.01, 1.4); return true;
    case 'water_barrel': {
      B.cylinder('wood_dark', 0, 0.5, 0, 0.32, 0.35, 1.0, 12);
      for (const y of [0.15, 0.85]) B.cylinder('metal_dark', 0, y, 0, 0.36, 0.36, 0.05, 12);
      B.box('metal', 0, 0.3, 0.36, 0.04, 0.04, 0.08);
      return true;
    }
    case 'drying_rack': {
      for (const x of [-0.8, 0.8]) { B.box('wood_dark', x, 0.8, 0.3, 0.06, 1.7, 0.06, { rotX: -0.3 }); B.box('wood_dark', x, 0.8, -0.3, 0.06, 1.7, 0.06, { rotX: 0.3 }); }
      B.box('wood_dark', 0, 1.6, 0, 1.7, 0.05, 0.05);
      for (const x of [-0.5, -0.1, 0.3, 0.6]) B.box('canvas_tan', x, 1.35, 0, 0.18, 0.45, 0.02);
      return true;
    }
    case 'workbench_mil': {
      B.box('metal_dark', 0, 0.85, 0, 2.0, 0.08, 0.8);
      for (const x of [-0.9, 0.9]) B.box('metal_dark', x, 0.42, 0, 0.08, 0.84, 0.75);
      B.box('metal', 0, 0.25, 0, 1.8, 0.04, 0.7);
      B.box('olive', 0, 1.35, -0.38, 2.0, 0.9, 0.04);
      B.box('metal_dark', -0.6, 0.98, 0, 0.3, 0.2, 0.2); // vice
      B.box('olive', 0.5, 0.95, 0.1, 0.5, 0.14, 0.3); // toolbox
      return true;
    }
    default: return false;
  }
}

/** Colliders [cx, cy, cz, w, h, d, opts] (local), or null if not an extra piece. */
export function extraColliders(type) {
  switch (type) {
    case 'log_wall': case 'log_wall_reinforced': return [[0, 1.8, 0, 4.0, 3.6, 0.4], [0, 1.3, -0.55, 4.0, 2.4, 0.3, { blocksShots: false, blocksSight: false }]];
    case 'log_corner': return [[0, 1.9, 0, 0.8, 3.8, 0.8]];
    case 'log_gateway': return [[-2.15, 2, 0, 0.5, 4, 0.5], [2.15, 2, 0, 0.5, 4, 0.5], [0, 4.3, 0, 4.7, 0.4, 0.4]];
    case 'log_gate': case 'gate_reinforced': return [[-2.15, 2, 0, 0.5, 4, 0.5], [2.15, 2, 0, 0.5, 4, 0.5], [0, 4.3, 0, 4.7, 0.4, 0.4]];
    case 'log_platform': return [[0, 1.97, 0, 4.0, 0.12, 1.6], [0, 2.5, -0.75, 4.0, 1.0, 0.1, { blocksShots: false, blocksSight: false }]];
    case 'log_tower': return [[-1.3, 3.4, -1.3, 0.4, 6.8, 0.4], [1.3, 3.4, -1.3, 0.4, 6.8, 0.4], [-1.3, 3.4, 1.3, 0.4, 6.8, 0.4], [1.3, 3.4, 1.3, 0.4, 6.8, 0.4], [0, 6.4, 0, 3.0, 0.14, 3.0], [0, 6.95, -1.45, 3.0, 1.0, 0.12], [-1.45, 6.95, 0, 0.12, 1.0, 3.0], [1.45, 6.95, 0, 0.12, 1.0, 3.0], [0.6, 6.95, 1.45, 1.8, 1.0, 0.12]];
    case 'sandbag_nest': return [[0, 0.45, 1.25, 2.2, 0.9, 0.5], [-1.25, 0.45, 0.3, 0.5, 0.9, 1.8], [1.25, 0.45, 0.3, 0.5, 0.9, 1.8]];
    case 'barricade_hedgehog': return [[0, 0.75, 0, 1.4, 1.5, 1.4, { blocksShots: false, blocksSight: false }]];
    case 'barricade_spikes': return [[0, 0.5, 0, 3.0, 1.0, 1.0, { blocksShots: false, blocksSight: false }]];
    case 'mil_fence': return [[0, 1.4, 0, 4.0, 2.8, 0.12, { blocksShots: false, blocksSight: false }]];
    case 'blast_wall': return [[0, 1.45, 0, 2.0, 2.9, 1.0]];
    case 'storage_shed': return [[0, 1.2, -0.97, 2.4, 2.4, 0.1], [-1.17, 1.2, 0, 0.1, 2.4, 2.0], [1.17, 1.2, 0, 0.1, 2.4, 2.0], [0, 1.2, 0.97, 2.4, 2.4, 0.1], [0, 2.35, 0, 2.5, 0.1, 2.2]];
    case 'floodlight': return [[0, 2.1, 0, 0.2, 4.2, 0.2]];
    case 'lantern_post': return [[0, 1.1, 0, 0.16, 2.2, 0.16]];
    case 'pillar': return [[0, 1.5, 0, 0.36, 3.0, 0.36]];
    case 'sofa': case 'sofa_worn': return [[0, 0.4, 0, 2.0, 0.8, 0.85]];
    case 'armchair': return [[0, 0.4, 0, 0.9, 0.8, 0.85]];
    case 'cabinet': case 'cabinet_broken': case 'med_cabinet': return [[0, 0.9, 0, 1.0, 1.8, 0.45]];
    case 'kitchen_counter': return [[0, 0.46, 0, 2.0, 0.92, 0.6]];
    case 'fridge': return [[0, 0.9, 0, 0.7, 1.8, 0.65]];
    case 'shelf_metal': case 'tool_rack': return [[0, 1.0, 0, 1.5, 2.0, 0.45]];
    case 'clock': return [[0, 1.0, 0, 0.45, 2.0, 0.3]];
    case 'curtains': return [];
    case 'painting': return [[0, 1.2, 0, 1.0, 1.0, 0.1]];
    case 'tv': return [[0, 0.6, 0, 1.1, 1.2, 0.45]];
    case 'floor_lamp': return [[0, 0.9, 0, 0.3, 1.8, 0.3]];
    case 'desk': case 'computer': return [[0, 0.38, 0, 1.6, 0.76, 0.75]];
    case 'radio_set': return [[0, 0.55, 0, 0.9, 1.1, 0.5]];
    case 'mil_poster': case 'wall_map': case 'noticeboard': return [[0, 1.3, 0, 0.15, 2.6, 0.15]];
    case 'weapon_display': return [[0, 0.9, 0, 1.4, 1.8, 0.4]];
    case 'ammo_crates': return [[0, 0.4, 0, 1.4, 0.8, 0.45]];
    case 'crate_pile': return [[0, 0.55, 0, 1.4, 1.1, 0.8]];
    case 'hide_rug': return [];
    case 'water_barrel': return [[0, 0.5, 0, 0.7, 1.0, 0.7]];
    case 'drying_rack': return [[0, 0.8, 0, 1.8, 1.6, 0.4, { blocksShots: false, blocksSight: false }]];
    case 'workbench_mil': return [[0, 0.45, 0, 2.0, 0.9, 0.8], [0, 1.35, -0.38, 2.0, 0.9, 0.06]];
    default: return null;
  }
}

/** Footprint (w, d, h) for overlap validation, or null. */
export function extraBounds(type) {
  switch (type) {
    case 'log_wall': case 'log_wall_reinforced': return [4.0, 0.5, 3.6];
    case 'log_corner': return [0.9, 0.9, 3.8];
    case 'log_gateway': case 'log_gate': case 'gate_reinforced': return [4.8, 0.6, 4.5];
    case 'log_platform': return [4.0, 1.6, 3.0];
    case 'log_tower': return [3.0, 3.0, 8.0];
    case 'sandbag_nest': return [3.2, 3.2, 0.9];
    case 'barricade_hedgehog': return [1.4, 1.4, 1.5];
    case 'barricade_spikes': return [3.0, 1.0, 1.0];
    case 'mil_fence': return [4.0, 0.15, 2.8];
    case 'blast_wall': return [2.0, 1.0, 2.9];
    case 'storage_shed': return [2.4, 2.0, 2.4];
    case 'floodlight': return [0.6, 0.6, 4.3];
    case 'lantern_post': return [0.4, 0.4, 2.2];
    case 'pillar': return [0.36, 0.36, 3.0];
    case 'sofa': case 'sofa_worn': return [2.0, 0.85, 0.9];
    case 'armchair': return [0.9, 0.85, 1.0];
    case 'cabinet': case 'cabinet_broken': case 'med_cabinet': return [1.0, 0.45, 1.8];
    case 'kitchen_counter': return [2.0, 0.6, 1.0];
    case 'fridge': return [0.7, 0.65, 1.8];
    case 'shelf_metal': case 'tool_rack': return [1.5, 0.45, 2.0];
    case 'clock': return [0.45, 0.3, 2.0];
    case 'curtains': return [2.4, 0.1, 2.4];
    case 'painting': return [1.0, 0.2, 1.9];
    case 'tv': return [1.1, 0.45, 1.2];
    case 'floor_lamp': return [0.35, 0.35, 1.9];
    case 'desk': case 'computer': return [1.6, 0.75, 1.2];
    case 'radio_set': return [0.9, 0.5, 1.4];
    case 'mil_poster': case 'wall_map': case 'noticeboard': return [1.6, 0.2, 2.7];
    case 'weapon_display': return [1.4, 0.4, 1.8];
    case 'ammo_crates': return [1.4, 0.45, 0.8];
    case 'crate_pile': return [1.4, 0.8, 1.2];
    case 'hide_rug': return [1.6, 2.0, 0.05];
    case 'water_barrel': return [0.7, 0.7, 1.0];
    case 'drying_rack': return [1.8, 0.6, 1.7];
    case 'workbench_mil': return [2.0, 0.8, 1.8];
    default: return null;
  }
}
