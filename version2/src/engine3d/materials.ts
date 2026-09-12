import { CULLFACE_FRONT, CULLFACE_NONE, Color, FRESNEL_NONE, FRESNEL_SCHLICK, SHADERLANGUAGE_GLSL, StandardMaterial, type Texture } from 'playcanvas'

export const col = (hex: number, a = 1): Color => new Color(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, a)

/** Two-band cel lighting plus a hard specular dot and a rim band. Shadows and ambient stay as the engine computes them. */
const TOON_LAMBERT = `
float getLightDiffuse(vec3 worldNormal, vec3 viewDir, vec3 lightDirNorm) {
    float ndl = max(dot(worldNormal, -lightDirNorm), 0.0);
    return smoothstep(0.30, 0.36, ndl) * 0.72 + 0.28;
}
`
const TOON_COMBINE = `
vec3 combineColor(vec3 albedo, vec3 sheenSpecularity, float clearcoatSpecularity) {
    vec3 ret = albedo * dDiffuseLight;
#ifdef LIT_SPECULAR
    float spec = max(max(dSpecularLight.r, dSpecularLight.g), dSpecularLight.b);
    ret += vec3(smoothstep(0.35, 0.45, spec) * 0.32);
#endif
#ifdef LIT_REFLECTIONS
    ret += dReflection.rgb * dReflection.a * 0.6;
#endif
    float rim = 1.0 - max(dot(normalize(dViewDirW), litArgs_worldNormal), 0.0);
    ret += smoothstep(0.66, 0.74, rim) * vec3(0.16, 0.15, 0.13);
    return ret;
}
`
export function applyToon(m: StandardMaterial): StandardMaterial {
  const g = m.getShaderChunks(SHADERLANGUAGE_GLSL)
  g.set('lightDiffuseLambertPS', TOON_LAMBERT)
  g.set('combinePS', TOON_COMBINE)
  return m
}

export interface MatOpts { gloss?: number; metalness?: number; specular?: number; diffuseMap?: Texture; tiling?: number; normalMap?: Texture; bumpiness?: number; toon?: boolean }

/** Comic material: coloured diffuse, schlick fresnel so environment light reads, optional toon banding (default on). */
const flatCache = new Map<string, StandardMaterial>()
export function flatMat(hex: number, o: MatOpts = {}): StandardMaterial {
  // untextured materials are shared by (colour, options) so the batcher can merge every part that uses the same look
  const key = o.diffuseMap || o.normalMap ? null : `${hex}|${o.gloss ?? ''}|${o.metalness ?? ''}|${o.specular ?? ''}|${o.toon !== false}`
  if (key) { const c = flatCache.get(key); if (c) return c }
  const m = new StandardMaterial()
  m.diffuse = col(hex)
  m.useMetalness = true; m.metalness = o.metalness ?? 0.05
  m.gloss = o.gloss ?? 0.45
  const s = o.specular ?? 0.35; m.specular = new Color(s, s, s)
  m.fresnelModel = FRESNEL_SCHLICK; m.useSkybox = false // no environment sampling: ambient is flat and cheap
  if (o.diffuseMap) { m.diffuseMap = o.diffuseMap; m.diffuseMapTiling.set(o.tiling ?? 4, o.tiling ?? 4) }
  if (o.normalMap) { m.normalMap = o.normalMap; m.bumpiness = o.bumpiness ?? 0.6; m.normalMapTiling.set(o.tiling ?? 4, o.tiling ?? 4) }
  if (o.toon !== false) applyToon(m)
  m.update()
  if (key) flatCache.set(key, m)
  return m
}
/** Toon character/prop material: stronger gloss so gloves and balls catch a hard highlight and env reflections. */
export function toonMat(hex: number, o: MatOpts = {}): StandardMaterial { return flatMat(hex, { gloss: 0.6, specular: 0.55, metalness: 0.1, ...o }) }
/** Shiny metal or lacquer (turnbuckle caps, ball returns, trophies). */
export function shinyMat(hex: number): StandardMaterial { return flatMat(hex, { gloss: 0.85, specular: 0.9, metalness: 0.6, toon: false }) }
/** Matte, non-toon (floors, walls) with schlick so bounce light still reads. */
export function matteMat(hex: number, o: MatOpts = {}): StandardMaterial { return flatMat(hex, { gloss: 0.3, specular: 0.2, toon: false, ...o }) }
/** Unlit material (sky, crowd, glow): no tone mapping or fog so inks and neon stay pure. */
const unlitCache = new Map<string, StandardMaterial>()
export function unlitMat(hex: number, twoSided = false): StandardMaterial {
  const key = `${hex}|${twoSided}`
  const c = unlitCache.get(key); if (c) return c
  const m = new StandardMaterial()
  m.useLighting = false; m.diffuse = col(0); m.emissive = col(hex); m.useTonemap = false; m.useFog = false; m.useSkybox = false; m.fresnelModel = FRESNEL_NONE
  if (twoSided) m.cull = CULLFACE_NONE
  m.update(); unlitCache.set(key, m); return m
}
/** Emissive surfaces that bloom (neon, screens, bulbs). Strength above 1 pushes them into bloom. */
export function emissiveMat(hex: number, strength = 2.5, twoSided = false): StandardMaterial {
  const m = new StandardMaterial()
  m.useLighting = false; m.diffuse = col(0); m.emissive = col(hex); m.emissiveIntensity = strength; m.useFog = false; m.useSkybox = false
  if (twoSided) m.cull = CULLFACE_NONE
  m.update(); return m
}
let ink: StandardMaterial | null = null
/** Shared ink outline material: unlit black, front faces culled (inverted hull). */
export function inkMat(): StandardMaterial {
  if (ink) return ink
  ink = new StandardMaterial()
  ink.useLighting = false; ink.diffuse = col(0x141414); ink.emissive = col(0x141414); ink.cull = CULLFACE_FRONT; ink.useTonemap = false; ink.useFog = false; ink.useSkybox = false
  ink.update(); return ink
}
