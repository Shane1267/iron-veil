import * as THREE from 'three';

// Atmospheric fog for every built-in material: exponential-squared distance fog that is
// denser near the valley floor (height falloff) and picks up sun colour when looking
// toward the sun (in-scattering). Installed once at startup by patching the fog shader
// chunks and adding shared uniforms to the built-in shader libraries, so terrain,
// buildings, vegetation and props all fade into the same atmosphere as the sky.

// Plain objects (not Vector3) so UniformsUtils.clone keeps them shared by reference:
// one update per frame reaches every material.
export const ATMO = {
  // x: height falloff (1/m), y: fog base height (m), z: sun scatter strength, w: enabled
  params: { x: 1 / 90, y: 20, z: 0.6, w: 1 },
  sunDir: { x: 0, y: 1, z: 0 },
  sunColor: { x: 1, y: 0.9, z: 0.7 },
};

let installed = false;

export function installAtmosphere() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogOffset;
#endif`;
  C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // camera-relative world offset: inverse view rotation applied to the view-space point
  vFogOffset = mvPosition.xyz * mat3( viewMatrix );
#endif`;
  C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogOffset;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  uniform vec4 fogAtmo;
  uniform vec3 fogSunDir;
  uniform vec3 fogSunColor;
#endif`;
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor;
    vec3 fogCol = fogColor;
    if ( fogAtmo.w > 0.5 ) {
      float fogDist = length( vFogOffset );
      // average density along the ray for an exponential height profile
      float k = fogAtmo.x;
      float camH = clamp( cameraPosition.y - fogAtmo.y, -30.0, 600.0 );
      float t = k * vFogOffset.y;
      float integ = abs( t ) > 1e-3 ? ( 1.0 - exp( - t ) ) / t : 1.0 - 0.5 * t;
      float heightTerm = exp( - k * camH ) * max( integ, 0.0 );
      float od = fogDensity * fogDist;
      fogFactor = 1.0 - exp( - od * od * clamp( heightTerm, 0.05, 3.0 ) );
      // sun in-scattering: haze toward the sun takes the sun's colour
      vec3 vdir = vFogOffset / max( fogDist, 1e-3 );
      float sunAmt = pow( max( dot( vdir, fogSunDir ), 0.0 ), 6.0 ) * fogAtmo.z;
      fogCol = mix( fogColor, fogSunColor, clamp( sunAmt, 0.0, 1.0 ) );
    } else {
      fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    }
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    vec3 fogCol = fogColor;
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
#endif`;
  // shared uniforms on every built-in material that supports fog
  for (const lib of Object.values(THREE.ShaderLib)) {
    if (!lib.uniforms || !lib.uniforms.fogColor) continue;
    lib.uniforms.fogAtmo = { value: ATMO.params };
    lib.uniforms.fogSunDir = { value: ATMO.sunDir };
    lib.uniforms.fogSunColor = { value: ATMO.sunColor };
  }
}
