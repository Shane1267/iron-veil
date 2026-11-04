// Builds the topographic map image (shaded relief, forests, fields, water, contours).
// Pure function so it can run in a Web Worker.
export function generateMapImage(world, size) {
  const S = world.data.worldSize;
  const half = S / 2;
  const step = S / size;
  const H = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      H[j * size + i] = world.heightRaw(-half + (i + 0.5) * step, -half + (j + 0.5) * step);
    }
  }
  const img = new Uint8ClampedArray(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      const x = -half + (i + 0.5) * step, z = -half + (j + 0.5) * step;
      const h = H[k];
      const hl = H[j * size + Math.max(0, i - 1)], hr = H[j * size + Math.min(size - 1, i + 1)];
      const hu = H[Math.max(0, j - 1) * size + i], hd = H[Math.min(size - 1, j + 1) * size + i];
      const dx = (hr - hl) / (2 * step), dz = (hd - hu) / (2 * step);
      // light from north-west
      const shade = Math.max(0.35, Math.min(1.25, 0.9 + (-dx * 0.7 - dz * 0.7) * 2.2));
      const p = world.regionBlend(x, z);
      let r = 204, g = 198, b = 170; // paper
      // forest density
      const cluster = world.noise.noise2D(x / 420 + 40, z / 420 - 9) * 0.5 + 0.5;
      const forest = p.forest * (cluster + p.forest * 0.35 > 0.55 ? 1 : 0.2);
      r -= forest * 46; g -= forest * 24; b -= forest * 48;
      const fld = world.fieldAt(x, z, p.fields);
      if (fld === 1) { r += 18; g += 10; b -= 18; }
      if (p.dry > 0.4) { r += 10; g += 2; b -= 16; }
      const slope = Math.hypot(dx, dz);
      if (slope > 0.6) { r = r * 0.8 + 120 * 0.2; g = g * 0.8 + 112 * 0.2; b = b * 0.8 + 100 * 0.2; }
      r *= shade; g *= shade; b *= shade;
      // contours every 20 m (index every 100 m)
      const c20 = Math.floor(h / 20), c20r = Math.floor(hr / 20), c20d = Math.floor(hd / 20);
      if (c20 !== c20r || c20 !== c20d) {
        const index = Math.floor(h / 100) !== Math.floor(hr / 100) || Math.floor(h / 100) !== Math.floor(hd / 100);
        const a = index ? 0.45 : 0.22;
        r = r * (1 - a) + 110 * a; g = g * (1 - a) + 80 * a; b = b * (1 - a) + 50 * a;
      }
      // water
      const L = world.lake;
      const ldx = (x - L.center[0]) / L.radius[0], ldz = (z - L.center[1]) / L.radius[1];
      if ((ldx * ldx + ldz * ldz < 3 && h < L.level)) { r = 96; g = 128; b = 140; }
      img[k * 4] = r; img[k * 4 + 1] = g; img[k * 4 + 2] = b; img[k * 4 + 3] = 255;
    }
  }
  return img;
}
