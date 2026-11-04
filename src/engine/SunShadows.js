import * as THREE from 'three';

// Stable cascaded shadow maps for the sun. Two or three shadowed directional lights
// cover successive slices of the view frustum; the lighting chunk is patched so the
// shadowed directional lights are treated as one sun whose shadow term comes from the
// cascade covering each fragment (blended across cascade borders). Bounding spheres and
// texel snapping keep the shadow maps from shimmering when the camera turns or moves.
// A single following shadow map is used on the lowest shadow setting.

// x,y,z: far edge (view depth, metres) of cascades 0..2; w: blend band as a fraction.
export const CSM_SPLITS = { x: 22, y: 75, z: 260, w: 0.18 };

let installed = false;
export function installSunShadows() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  const original = C.lights_fragment_begin;
  const start = original.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
  const end = original.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )');
  if (start < 0 || end < 0) {
    console.warn('[SunShadows] lights chunk layout not recognised; cascades disabled');
    return;
  }
  const dirBlock = original.slice(start, end);
  const cascaded = /* glsl */ `
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 1 )

	DirectionalLight directionalLight;
	DirectionalLightShadow directionalLightShadow;
	float csmDepth = vViewPosition.z;
	float csmShadow = 0.0;
	float csmRemain = 1.0;
	float csmT;
	float csmW;
	float csmHi;

	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		csmHi = csmSplits[ UNROLLED_LOOP_INDEX ];
		csmT = ( UNROLLED_LOOP_INDEX == NUM_DIR_LIGHT_SHADOWS - 1 ) ? smoothstep( csmHi * 0.8, csmHi, csmDepth ) : smoothstep( csmHi * ( 1.0 - csmSplits.w ), csmHi, csmDepth );
		csmW = csmRemain * ( 1.0 - csmT );
		if ( csmW > 0.002 && receiveShadow ) {
			directionalLightShadow = directionalLightShadows[ i ];
			csmShadow += csmW * getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] );
		} else {
			csmShadow += csmW;
		}
		csmRemain *= csmT;
	}
	#pragma unroll_loop_end
	csmShadow += csmRemain;

	directionalLight = directionalLights[ 0 ];
	getDirectionalLightInfo( directionalLight, directLight );
	directLight.color *= csmShadow;
	RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

	#if ( NUM_DIR_LIGHTS > NUM_DIR_LIGHT_SHADOWS )
	#pragma unroll_loop_start
	for ( int i = NUM_DIR_LIGHT_SHADOWS; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
	#endif

#else
${dirBlock}
#endif

`;
  C.lights_fragment_begin = original.slice(0, start) + cascaded + original.slice(end);
  C.lights_pars_begin = /* glsl */ `
#if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 1 )
uniform vec4 csmSplits;
#endif
` + C.lights_pars_begin;
  for (const lib of Object.values(THREE.ShaderLib)) {
    if (lib.uniforms && lib.uniforms.directionalLights) lib.uniforms.csmSplits = { value: CSM_SPLITS };
  }
}

const _corner = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _center = new THREE.Vector3();
const _ls = new THREE.Matrix4();
const _lsInv = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _origin = new THREE.Vector3();
const _target = new THREE.Vector3();
const _altUp = new THREE.Vector3(1, 0, 0);

export class SunShadows {
  constructor(scene) {
    this.scene = scene;
    this.lights = [];
    this.mode = 'single';
    this.mapSize = 1024;
    this.singleExtent = 70;
    this.splits = [];
  }

  /** quality 0..3: 0 off, 1 single following map, 2 two cascades, 3 three cascades */
  configure(quality) {
    for (const l of this.lights) {
      this.scene.remove(l, l.target);
      l.shadow.map?.dispose();
      l.dispose();
    }
    this.lights = [];
    const cascades = quality >= 3 ? 3 : quality === 2 ? 2 : 1;
    this.mode = cascades > 1 ? 'cascades' : 'single';
    this.mapSize = quality >= 3 ? 2048 : quality === 2 ? 2048 : 1024;
    this.splits = cascades === 3 ? [22, 75, 260] : cascades === 2 ? [32, 150] : [];
    CSM_SPLITS.x = this.splits[0] || 0;
    CSM_SPLITS.y = this.splits[1] || 0;
    CSM_SPLITS.z = this.splits[2] || 0;
    for (let i = 0; i < cascades; i++) {
      const l = new THREE.DirectionalLight(0xffffff, i === 0 ? 3 : 0);
      l.castShadow = quality > 0;
      l.shadow.mapSize.set(this.mapSize, this.mapSize);
      l.shadow.bias = -0.0002;
      l.shadow.normalBias = 0.03;
      l.shadow.camera.near = 0.5;
      l.shadow.camera.far = 900;
      this.scene.add(l, l.target);
      this.lights.push(l);
    }
    if (this.mode === 'single') {
      const cam = this.lights[0].shadow.camera;
      const e = this.singleExtent;
      cam.left = -e; cam.right = e; cam.top = e; cam.bottom = -e;
      cam.updateProjectionMatrix();
    }
    this._radii = [];
    return this.lights[0];
  }

  /** Copy sun colour/intensity to the primary light (the others only provide shadow maps). */
  setLight(color, intensity) {
    for (let i = 0; i < this.lights.length; i++) {
      this.lights[i].color.copy(color);
      // cascade lights 1..n contribute no light of their own in the patched shader, but
      // keep them identical so a non-patched fallback would still look right
      this.lights[i].intensity = this.mode === 'cascades' ? intensity : (i === 0 ? intensity : 0);
    }
  }

  /**
   * camera: main camera, toSun: unit vector pointing at the sun, focus: player position
   */
  update(camera, toSun, focus) {
    if (!this.lights.length) return;
    if (this.mode === 'single') {
      const l = this.lights[0];
      const ext = this.singleExtent;
      const snap = (ext * 2) / this.mapSize;
      const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
      l.target.position.set(fx, focus.y, fz);
      l.position.set(fx + toSun.x * 400, focus.y + toSun.y * 400, fz + toSun.z * 400);
      l.target.updateMatrixWorld();
      return;
    }
    camera.updateMatrixWorld();
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(Math.max(camera.fov, 60)) / 2);
    const k = tanHalf * tanHalf * (1 + camera.aspect * camera.aspect);
    camera.getWorldDirection(_fwd);
    const camPos = camera.position;
    // light-space basis (rotation only) for texel snapping
    _ls.lookAt(_origin, _target.copy(toSun).negate(), Math.abs(toSun.y) > 0.99 ? _altUp : _up);
    _lsInv.copy(_ls).invert();
    let near = camera.near;
    for (let i = 0; i < this.lights.length; i++) {
      const far = this.splits[i];
      // bounding sphere of the frustum slice [near, far]
      let c = ((far + near) * (1 + k)) / 2;
      if (c > far) c = far;
      let r = Math.sqrt((far - c) * (far - c) + far * far * k);
      r = Math.ceil(r + 1);
      _center.copy(camPos).addScaledVector(_fwd, c);
      // snap the centre to whole shadow texels in light space
      const texel = (2 * r) / this.mapSize;
      _center.applyMatrix4(_lsInv);
      _center.x = Math.round(_center.x / texel) * texel;
      _center.y = Math.round(_center.y / texel) * texel;
      _center.applyMatrix4(_ls);
      const l = this.lights[i];
      const margin = 220;
      l.target.position.copy(_center);
      l.position.copy(_center).addScaledVector(toSun, r + margin);
      l.target.updateMatrixWorld();
      const sc = l.shadow.camera;
      if (this._radii[i] !== r) {
        this._radii[i] = r;
        sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r;
        sc.near = 1; sc.far = 2 * r + margin + 60;
        sc.updateProjectionMatrix();
        l.shadow.normalBias = texel * 1.4;
        l.shadow.bias = -0.00015 * (1 + i);
      }
      near = far * (1 - CSM_SPLITS.w);
    }
  }

  get primary() { return this.lights[0]; }
}
