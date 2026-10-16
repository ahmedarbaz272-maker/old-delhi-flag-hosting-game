import * as THREE from 'three'
import type { Assets } from '../engine/assets'

type ModelRole = 'runner' | 'gatherer' | 'guard' | 'bazaar'
type ModelSource = THREE.Group | undefined

// The literal assets/models prefix is required by the project's managed-asset restoration flow.
const MODEL_URLS = import.meta.glob<string>('../../assets/models/*.glb', { eager: true, query: '?url', import: 'default' })
const MODEL_FILES: Record<ModelRole, string> = {
  runner: '../../assets/models/gyanu-runner.glb',
  gatherer: '../../assets/models/gyanu-gatherer.glb',
  guard: '../../assets/models/gyanu-guard.glb',
  bazaar: '../../assets/models/gyanu-bazaar-building.glb',
}
const TARGET_HEIGHT: Record<ModelRole, number> = { runner: 1.82, gatherer: 1.78, guard: 1.88, bazaar: 5.1 }

export class ModelLibrary {
  readonly errors: string[] = []
  private readonly sources: Record<ModelRole, ModelSource> = { runner: undefined, gatherer: undefined, guard: undefined, bazaar: undefined }

  private constructor() {}

  static async load(assets: Assets): Promise<ModelLibrary> {
    const library = new ModelLibrary()
    const roles: ModelRole[] = ['runner', 'gatherer', 'guard', 'bazaar']
    await Promise.all(roles.map(async role => {
      try {
        const path = MODEL_FILES[role]
        const url = MODEL_URLS[path]
        if (!url) throw new Error(`Registered model is missing: ${path}`)
        const gltf = await assets.gltf(url)
        const root = normalizeModel(gltf.scene.clone(true), TARGET_HEIGHT[role])
        root.name = `gyanu-${role}`
        root.traverse(object => {
          const mesh = object as THREE.Mesh
          if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = true }
        })
        library.sources[role] = root
      } catch (error) {
        library.errors.push(`${role}: ${error instanceof Error ? error.message : 'could not load model'}`)
      }
    }))
    return library
  }

  clone(role: ModelRole): THREE.Group | null {
    const source = this.sources[role]
    if (!source) return null
    return source.clone(true)
  }

  has(role: ModelRole): boolean { return !!this.sources[role] }
}

/** Center X/Z, place feet at Y=0, and preserve proportions for the shared meshes/materials. */
function normalizeModel(source: THREE.Group, targetHeight: number): THREE.Group {
  source.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(source)
  const size = bounds.getSize(new THREE.Vector3())
  if (!Number.isFinite(size.y) || size.y < 0.05) throw new Error('Model has no measurable height')
  const factor = targetHeight / size.y
  const center = bounds.getCenter(new THREE.Vector3())
  source.scale.multiplyScalar(factor)
  source.position.set(-center.x * factor, -bounds.min.y * factor, -center.z * factor)
  source.updateMatrixWorld(true)
  const wrapper = new THREE.Group()
  wrapper.name = 'normalized-model-pivot'
  wrapper.add(source)
  return wrapper
}

/** Keep public/ URLs relative to the configured base so GitHub Pages subpaths work. */
export function gyanuFlagUrl(): string {
  return `${import.meta.env.BASE_URL}assets/flags/gyanu.png`
}

export async function loadGyanuFlag(assets: Assets): Promise<THREE.Texture> {
  const texture = await assets.texture(gyanuFlagUrl(), { color: true })
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}
