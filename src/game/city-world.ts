import * as THREE from 'three'
import { FINAL_DESTINATION, LOCATIONS } from './mission'
import { Physics } from '../engine/physics'

type LocationRecord = { id: string; x: number; z: number; name?: string; title?: string; label?: string }
export type MarkerState = 'undiscovered' | 'discovered' | 'completed'

type MarkerMaterials = {
  ring: THREE.MeshStandardMaterial
  lantern: THREE.MeshStandardMaterial
  trim: THREE.MeshStandardMaterial
}

export type ObjectiveMarker = {
  id: string
  root: THREE.Group
  position: THREE.Vector3
  state: MarkerState
  setState: (state: MarkerState) => void
}

export type GuardSpawn = {
  id: string
  displayName: string
  designation: string
  position: THREE.Vector3
  district: string
  role: 'patrol' | 'gate' | 'tower' | 'detention'
}

export type GuardRoute = {
  id: string
  waypoints: THREE.Vector3[]
  loop: boolean
  speed: number
}

type Collider = ReturnType<Physics['addStaticBox']>

export type TowerData = {
  root: THREE.Group
  center: THREE.Vector3
  height: number
  platformCenter: THREE.Vector3
  platformRadius: number
  stairFlights: number
  platformCollider: ReturnType<Physics['addStaticCylinder']>
}

export type FlagData = {
  root: THREE.Group
  cloth: THREE.Mesh
  clothWidth: number
  clothHeight: number
  flagpolePosition: THREE.Vector3
  poleHeight: number
  clothAnchor: THREE.Vector3
}

export type GateData = {
  root: THREE.Group
  center: THREE.Vector3
  width: number
  collider: Collider
  open: boolean
  openGate: () => void
  closeGate: () => void
}

export type CityEnvironment = {
  scene: THREE.Scene
  spawn: THREE.Vector3
  objectiveMarkers: Map<string, ObjectiveMarker>
  markerMap: Map<string, ObjectiveMarker>
  guardSpawns: GuardSpawn[]
  guardRoutes: GuardRoute[]
  tower: TowerData
  flag: FlagData
  gate: GateData
  /** Keep this reference separate so gameplay can remove it from physics when the gate opens. */
  finalGateCollider: Collider
  setMarkerState: (id: string, state: MarkerState) => boolean
  updateMarkerDiscovered: (id: string, discovered?: boolean) => boolean
  updateMarkerCompleted: (id: string, completed?: boolean) => boolean
  openGate: () => void
  closeGate: () => void
}

const LOCATIONS_TYPED = LOCATIONS as readonly LocationRecord[]

const palette = {
  sky: new THREE.Color('#f3b77f'),
  haze: new THREE.Color('#d98766'),
  ground: new THREE.Color('#c8a176'),
  cobble: new THREE.Color('#30383c'),
  cobbleEdge: new THREE.Color('#566063'),
  terracotta: [new THREE.Color('#a8503f'), new THREE.Color('#b96449'), new THREE.Color('#c67a54')],
  sandstone: [new THREE.Color('#d9b27b'), new THREE.Color('#edc994'), new THREE.Color('#b9845f')],
  plaster: new THREE.Color('#f0d4aa'),
  shadow: new THREE.Color('#382f35'),
  teal: new THREE.Color('#168b88'),
  saffron: new THREE.Color('#efa83b'),
  coral: new THREE.Color('#e46c5a'),
  cream: new THREE.Color('#ffe4ad'),
  foliage: new THREE.Color('#356c59'),
  steel: new THREE.Color('#52656b'),
  warning: new THREE.Color('#f2c84b'),
}

function createSkyDome(): THREE.Group {
  const sky = new THREE.Group()
  const sunDirection = new THREE.Vector3(-0.42, 0.58, -0.7).normalize()
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      zenithColor: { value: new THREE.Color('#55b8ed') },
      horizonColor: { value: new THREE.Color('#f1c58a') },
      sunColor: { value: new THREE.Color('#fff1c3') },
      sunDirection: { value: sunDirection },
    },
    vertexShader: `
      varying vec3 vSkyDirection;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vSkyDirection = worldPosition.xyz - cameraPosition;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 zenithColor;
      uniform vec3 horizonColor;
      uniform vec3 sunColor;
      uniform vec3 sunDirection;
      varying vec3 vSkyDirection;
      void main() {
        vec3 direction = normalize(vSkyDirection);
        float height = smoothstep(-0.12, 0.78, direction.y);
        vec3 color = mix(horizonColor, zenithColor, height);
        float haze = 1.0 - smoothstep(0.0, 0.32, abs(direction.y));
        color = mix(color, horizonColor, haze * 0.28);
        float sunDot = max(dot(direction, normalize(sunDirection)), 0.0);
        float disc = pow(sunDot, 190.0);
        float halo = pow(sunDot, 12.0) * 0.18;
        color = mix(color, sunColor, clamp(disc * 1.3 + halo, 0.0, 0.9));
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const dome = new THREE.Mesh(new THREE.SphereGeometry(290, 32, 20), material)
  dome.name = 'procedural-sky-dome'
  dome.frustumCulled = false
  dome.renderOrder = -1000
  sky.add(dome)
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(5.8, 20, 14),
    new THREE.MeshBasicMaterial({ color: '#fff1c3', toneMapped: false, depthTest: false, depthWrite: false }),
  )
  sun.name = 'visible-sky-sun'
  sun.position.copy(sunDirection).multiplyScalar(220)
  sun.renderOrder = -999
  sky.add(sun)
  return sky
}

function flat(color: THREE.Color, roughness = 0.82): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.03 })
}

function lit(color: THREE.Color, intensity = 1.8): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.48 })
}

function rotateY(angle: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle)
}

function addMesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, position: THREE.Vector3, scale?: THREE.Vector3): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.copy(position)
  if (scale) mesh.scale.copy(scale)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function worldFrom(parent: THREE.Object3D, local: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(parent.position.x + local.x, parent.position.y + local.y, parent.position.z + local.z)
}

export function buildCity(physics: Physics, flagTexture?: THREE.Texture): CityEnvironment {
  const scene = new THREE.Scene()
  scene.background = palette.sky.clone()
  scene.fog = new THREE.Fog(palette.haze, 58, 155)
  scene.add(createSkyDome())

  const sun = new THREE.DirectionalLight('#ffe1b6', 2.35)
  sun.position.set(-32, 48, 26)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -70
  sun.shadow.camera.right = 70
  sun.shadow.camera.top = 70
  sun.shadow.camera.bottom = -70
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 140
  sun.shadow.bias = -0.00035
  sun.shadow.normalBias = 0.035
  scene.add(sun, sun.target)
  scene.add(new THREE.HemisphereLight('#ffe2c0', '#403a42', 1.35))
  const warmFill = new THREE.PointLight('#ffb47b', 18, 32, 2)
  warmFill.position.set(-18, 9, 8)
  scene.add(warmFill)

  const unitBox = new THREE.BoxGeometry(1, 1, 1)
  const columnGeo = new THREE.CylinderGeometry(1, 1, 1, 10)
  const roundGeo = new THREE.CylinderGeometry(1, 1, 1, 16)
  const coneGeo = new THREE.ConeGeometry(1, 1, 12)
  const domeGeo = new THREE.SphereGeometry(1, 12, 8)
  const archGeo = new THREE.TorusGeometry(0.5, 0.08, 6, 16, Math.PI)
  const ringGeo = new THREE.TorusGeometry(0.5, 0.055, 6, 18)
  const lanternGeo = new THREE.OctahedronGeometry(0.18, 0)
  const finialGeo = new THREE.ConeGeometry(0.12, 0.4, 6)

  const roadMat = flat(palette.cobble)
  const roadEdgeMat = flat(palette.cobbleEdge)
  const groundMat = flat(palette.ground)
  const plasterMat = flat(palette.plaster)
  const darkMat = flat(palette.shadow)
  const tealMat = flat(palette.teal)
  const saffronMat = flat(palette.saffron)
  const coralMat = flat(palette.coral)
  const creamMat = flat(palette.cream)
  const steelMat = flat(palette.steel, 0.55)
  const warningMat = flat(palette.warning)
  const lampMat = lit(new THREE.Color('#ffd985'), 2.2)

  // One level-sized walkable substrate; streets and plazas sit slightly above it as dressed surfaces.
  const ground = addMesh(scene, unitBox, groundMat, new THREE.Vector3(0, -0.35, 0), new THREE.Vector3(118, 0.7, 160))
  ground.receiveShadow = true
  physics.addStaticBox(ground.position, new THREE.Vector3(118, 0.7, 160))

  const addBox = (parent: THREE.Object3D, position: THREE.Vector3, size: THREE.Vector3, material: THREE.Material, collide = false, rotation = 0): THREE.Mesh => {
    const mesh = addMesh(parent, unitBox, material, position, size)
    if (rotation !== 0) mesh.quaternion.copy(rotateY(rotation))
    if (collide) physics.addStaticBox(worldFrom(parent, position), size, rotation === 0 ? undefined : rotateY(rotation))
    return mesh
  }

  const addCylinder = (parent: THREE.Object3D, position: THREE.Vector3, radius: number, height: number, material: THREE.Material, collide = false): THREE.Mesh => {
    const mesh = addMesh(parent, columnGeo, material, position, new THREE.Vector3(radius, height, radius))
    if (collide) physics.addStaticCylinder(worldFrom(parent, position), radius, height)
    return mesh
  }

  const addRoad = (a: THREE.Vector3, b: THREE.Vector3, width: number): void => {
    const dx = b.x - a.x
    const dz = b.z - a.z
    const length = Math.hypot(dx, dz)
    const angle = Math.atan2(dx, dz)
    const center = new THREE.Vector3((a.x + b.x) / 2, 0.035, (a.z + b.z) / 2)
    addBox(scene, center, new THREE.Vector3(width, 0.07, length), roadMat, false, angle)
    const curbOffset = width * 0.5 - 0.16
    for (const side of [-1, 1]) {
      const offset = new THREE.Vector3(Math.cos(angle) * curbOffset * side, 0.075, -Math.sin(angle) * curbOffset * side)
      addBox(scene, center.clone().add(offset), new THREE.Vector3(0.14, 0.08, length), roadEdgeMat, false, angle)
    }
    const cobbleCount = Math.max(2, Math.floor(length / 2.5))
    for (let i = 0; i < cobbleCount; i += 1) {
      const t = (i + 0.5) / cobbleCount
      const p = new THREE.Vector3(a.x + dx * t, 0.11, a.z + dz * t)
      addBox(scene, p, new THREE.Vector3(width * 0.72, 0.025, 0.06), roadEdgeMat, false, angle)
    }
  }

  const addPlaza = (x: number, z: number, radius: number, material = roadMat): void => {
    const mesh = addMesh(scene, new THREE.CylinderGeometry(radius, radius, 0.09, 20), material, new THREE.Vector3(x, 0.07, z))
    mesh.receiveShadow = true
  }

  const addWindow = (parent: THREE.Group, x: number, y: number, z: number, scale = 1, shutter = false): void => {
    addBox(parent, new THREE.Vector3(x, y, z), new THREE.Vector3(0.72 * scale, 0.98 * scale, 0.07), darkMat)
    const arch = addMesh(parent, archGeo, plasterMat, new THREE.Vector3(x, y + 0.38 * scale, z - 0.045), new THREE.Vector3(0.78 * scale, 0.78 * scale, 1))
    arch.rotation.x = 0
    if (shutter) {
      addBox(parent, new THREE.Vector3(x - 0.42 * scale, y, z - 0.08), new THREE.Vector3(0.17 * scale, 0.88 * scale, 0.09), flat(palette.terracotta[0]))
      addBox(parent, new THREE.Vector3(x + 0.42 * scale, y, z - 0.08), new THREE.Vector3(0.17 * scale, 0.88 * scale, 0.09), flat(palette.terracotta[1]))
    }
  }

  const addBalcony = (parent: THREE.Group, x: number, y: number, z: number, color: THREE.Material): void => {
    addBox(parent, new THREE.Vector3(x, y, z), new THREE.Vector3(2.0, 0.16, 0.62), color)
    for (const px of [-0.78, -0.26, 0.26, 0.78]) addBox(parent, new THREE.Vector3(x + px, y + 0.42, z - 0.22), new THREE.Vector3(0.08, 0.68, 0.08), color)
    addBox(parent, new THREE.Vector3(x, y + 0.76, z - 0.22), new THREE.Vector3(2.0, 0.09, 0.09), color)
    const jali = addBox(parent, new THREE.Vector3(x, y + 0.38, z - 0.28), new THREE.Vector3(1.46, 0.52, 0.045), tealMat)
    jali.castShadow = false
  }

  const addAwning = (parent: THREE.Group, x: number, y: number, z: number, color: THREE.Material): void => {
    const awning = addBox(parent, new THREE.Vector3(x, y, z), new THREE.Vector3(1.7, 0.11, 0.72), color)
    awning.rotation.x = -0.16
    for (const px of [-0.73, 0.73]) addBox(parent, new THREE.Vector3(x + px, y - 0.35, z + 0.12), new THREE.Vector3(0.07, 0.7, 0.07), steelMat)
  }

  const addTankAndLanterns = (parent: THREE.Group, w: number, d: number, h: number, accent: THREE.Material): void => {
    addCylinder(parent, new THREE.Vector3(w * 0.22, h + 0.55, -d * 0.17), 0.62, 0.72, steelMat)
    addBox(parent, new THREE.Vector3(w * 0.22, h + 0.94, -d * 0.17), new THREE.Vector3(0.9, 0.08, 0.9), darkMat)
    for (const x of [-w * 0.3, w * 0.3]) {
      const lantern = addMesh(parent, lanternGeo, lampMat, new THREE.Vector3(x, h * 0.62, -d * 0.52), new THREE.Vector3(0.8, 1.15, 0.8))
      lantern.userData.accent = accent
    }
  }

  const addLandmark = (parent: THREE.Group, kind: number, w: number, d: number, h: number, accent: THREE.Material): void => {
    if (kind === 0) {
      addCylinder(parent, new THREE.Vector3(0, h + 1.4, 0), Math.min(w, d) * 0.23, 1.8, accent)
      const dome = addMesh(parent, domeGeo, accent, new THREE.Vector3(0, h + 2.3, 0), new THREE.Vector3(Math.min(w, d) * 0.29, 0.8, Math.min(w, d) * 0.29))
      dome.scale.y = 0.75
      addMesh(parent, finialGeo, saffronMat, new THREE.Vector3(0, h + 3.2, 0), new THREE.Vector3(1, 1.3, 1))
      for (const sx of [-0.48, 0.48]) addCylinder(parent, new THREE.Vector3(sx * w, h + 0.35, 0), 0.16, 2.5, accent)
    } else if (kind === 1) {
      for (const sx of [-0.34, 0.34]) {
        addCylinder(parent, new THREE.Vector3(sx * w, h + 1.2, 0), 0.28, 2.4, accent)
        addMesh(parent, coneGeo, saffronMat, new THREE.Vector3(sx * w, h + 2.65, 0), new THREE.Vector3(0.52, 0.7, 0.52))
      }
      addBox(parent, new THREE.Vector3(0, h + 1.4, 0), new THREE.Vector3(w * 0.76, 2.1, d * 0.44), accent)
      addMesh(parent, domeGeo, coralMat, new THREE.Vector3(0, h + 2.5, 0), new THREE.Vector3(w * 0.32, 0.65, d * 0.3))
    } else if (kind === 2) {
      addBox(parent, new THREE.Vector3(0, h + 1.25, 0), new THREE.Vector3(w * 0.68, 2.3, d * 0.5), accent)
      addMesh(parent, archGeo, saffronMat, new THREE.Vector3(0, h + 1.35, -d * 0.27), new THREE.Vector3(0.96, 1.18, 1))
      addBox(parent, new THREE.Vector3(0, h + 2.7, 0), new THREE.Vector3(w * 0.86, 0.22, d * 0.62), tealMat)
      addMesh(parent, coneGeo, saffronMat, new THREE.Vector3(0, h + 3.18, 0), new THREE.Vector3(w * 0.26, 0.7, d * 0.25))
    } else {
      addCylinder(parent, new THREE.Vector3(0, h + 0.9, 0), Math.min(w, d) * 0.32, 1.8, accent)
      const halo = addMesh(parent, ringGeo, saffronMat, new THREE.Vector3(0, h + 1.05, -d * 0.3), new THREE.Vector3(1.8, 1.8, 0.9))
      halo.rotation.x = Math.PI / 2
      addBox(parent, new THREE.Vector3(0, h + 2.05, 0), new THREE.Vector3(w * 0.75, 0.2, d * 0.55), tealMat)
    }
  }

  const addBuilding = (x: number, z: number, w: number, d: number, h: number, index: number, landmark: boolean): void => {
    const group = new THREE.Group()
    group.position.set(x, 0, z)
    group.name = `district-building-${index}`
    const bodyMat = flat(palette.terracotta[index % palette.terracotta.length])
    const trimMat = flat(palette.sandstone[index % palette.sandstone.length])
    const accentMat = [tealMat, saffronMat, coralMat][index % 3]
    addBox(group, new THREE.Vector3(0, h / 2, 0), new THREE.Vector3(w, h, d), bodyMat, true)
    addBox(group, new THREE.Vector3(0, 0.18, -d * 0.03), new THREE.Vector3(w + 0.3, 0.35, d + 0.3), trimMat)
    addBox(group, new THREE.Vector3(0, h + 0.16, 0), new THREE.Vector3(w + 0.35, 0.3, d + 0.35), trimMat)
    addBox(group, new THREE.Vector3(0, h + 0.62, 0), new THREE.Vector3(w + 0.18, 0.6, 0.24), bodyMat)
    addBox(group, new THREE.Vector3(0, h + 0.56, -d * 0.53), new THREE.Vector3(w + 0.18, 0.18, 0.16), accentMat)
    for (const px of [-w * 0.34, 0, w * 0.34]) addBox(group, new THREE.Vector3(px, h + 0.48, -d * 0.54), new THREE.Vector3(0.1, 0.72, 0.18), trimMat)
    addWindow(group, -w * 0.29, h * 0.42, -d * 0.53, 0.9, index % 2 === 0)
    addWindow(group, w * 0.29, h * 0.42, -d * 0.53, 0.9, index % 2 === 1)
    addWindow(group, -w * 0.29, h * 0.73, -d * 0.53, 0.75, true)
    addWindow(group, w * 0.29, h * 0.73, -d * 0.53, 0.75, true)
    addBalcony(group, 0, h * 0.56, -d * 0.59, trimMat)
    addAwning(group, -w * 0.27, h * 0.2, -d * 0.58, accentMat)
    addAwning(group, w * 0.27, h * 0.2, -d * 0.58, accentMat)
    addTankAndLanterns(group, w, d, h, accentMat)
    if (landmark) addLandmark(group, index % 4, w, d, h, accentMat)
    scene.add(group)
  }

  // A connected sequence of dark roads makes every configured hub reachable without copying a real map.
  const hubPoints = LOCATIONS_TYPED.map(location => new THREE.Vector3(location.x, 0, location.z))
  const routeStart = new THREE.Vector3(-43, 0, -36)
  let previous = routeStart
  for (const point of hubPoints) {
    addRoad(previous, point, 4.25)
    previous = point
  }
  const secureCenter = new THREE.Vector3(FINAL_DESTINATION.x, 0, FINAL_DESTINATION.z)
  addRoad(previous, new THREE.Vector3(secureCenter.x, 0, secureCenter.z - 15), 5.2)
  addRoad(new THREE.Vector3(secureCenter.x, 0, secureCenter.z - 15), secureCenter, 5.2)

  // Each hub gets an open cobbled square and an asymmetrical dressed building cluster.
  for (let i = 0; i < hubPoints.length; i += 1) {
    const hub = hubPoints[i]
    addPlaza(hub.x, hub.z, 4.5 + (i % 3) * 0.45)
    const angles = [0.35, 2.3, 4.4]
    for (let b = 0; b < angles.length; b += 1) {
      const angle = angles[b] + i * 0.17
      const dist = 6.3 + b * 0.65
      const w = 3.3 + ((i + b) % 2) * 0.6
      const d = 3.5 + ((i + b) % 3) * 0.42
      addBuilding(hub.x + Math.cos(angle) * dist, hub.z + Math.sin(angle) * dist, w, d, 3.9 + ((i + b) % 3) * 0.7, i * 3 + b, b === 0)
    }
    for (let prop = 0; prop < 3; prop += 1) {
      const a = i * 0.8 + prop * 2.1
      const px = hub.x + Math.cos(a) * (2.6 + prop * 0.4)
      const pz = hub.z + Math.sin(a) * (2.6 + prop * 0.4)
      addBox(scene, new THREE.Vector3(px, 0.55, pz), new THREE.Vector3(0.9, 1.0, 0.75), [saffronMat, coralMat, tealMat][prop])
      addBox(scene, new THREE.Vector3(px, 1.11, pz), new THREE.Vector3(1.0, 0.08, 0.84), creamMat)
    }
  }

  // The four edge clusters establish a skyline and distinct silhouettes around the compact city.
  const skylineMat = flat(new THREE.Color('#754e55'))
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2
    const radius = 60 + (i % 3) * 4
    const width = 3 + (i % 4) * 0.8
    const height = 7 + (i % 5) * 1.9
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    addBox(scene, new THREE.Vector3(x, height / 2 - 0.1, z), new THREE.Vector3(width, height, width * 0.78), skylineMat, false, angle + 0.2)
    addBox(scene, new THREE.Vector3(x, height + 0.35, z), new THREE.Vector3(width * 0.66, 0.7, width * 0.58), [tealMat, saffronMat, coralMat][i % 3])
  }

  // Objective markers: a two-row stack of lantern discs gives a readable, unique silhouette for each id.
  const objectiveMarkers = new Map<string, ObjectiveMarker>()
  const markerColor = (state: MarkerState): THREE.Color => state === 'completed' ? palette.coral : state === 'discovered' ? palette.saffron : palette.teal
  const createMarker = (location: LocationRecord, index: number): ObjectiveMarker => {
    const root = new THREE.Group()
    root.name = `objective-marker-${location.id}`
    root.position.set(location.x, 0, location.z)
    const materials: MarkerMaterials = {
      ring: flat(palette.teal),
      lantern: lit(palette.teal, 1.25),
      trim: flat(palette.cream),
    }
    const base = addMesh(root, roundGeo, materials.trim, new THREE.Vector3(0, 0.11, 0), new THREE.Vector3(0.48, 0.22, 0.48))
    base.castShadow = false
    const ring = addMesh(root, ringGeo, materials.ring, new THREE.Vector3(0, 1.22, 0), new THREE.Vector3(0.78, 0.78, 0.78))
    ring.rotation.x = Math.PI / 2
    const stack = (index % 8) + 1
    for (let s = 0; s < stack; s += 1) {
      const x = s < 4 ? (s - 1.5) * 0.16 : (s - 5.5) * 0.16
      const y = 0.52 + (s < 4 ? 0 : 0.32)
      const lantern = addMesh(root, lanternGeo, materials.lantern, new THREE.Vector3(x, y, 0), new THREE.Vector3(0.72, 0.72, 0.72))
      lantern.userData.stackIndex = s
    }
    const pennant = addBox(root, new THREE.Vector3(0, 1.95, 0), new THREE.Vector3(0.08, 1.18, 0.08), materials.trim)
    addMesh(root, coneGeo, materials.lantern, new THREE.Vector3(0, 2.58, 0), new THREE.Vector3(0.23, 0.5, 0.23))
    const marker: ObjectiveMarker = {
      id: location.id,
      root,
      position: new THREE.Vector3(location.x, 0, location.z),
      state: 'undiscovered',
      setState: (state: MarkerState): void => {
        marker.state = state
        const color = markerColor(state)
        materials.ring.color.copy(color)
        materials.lantern.color.copy(color)
        materials.lantern.emissive.copy(color)
        materials.lantern.emissiveIntensity = state === 'completed' ? 3.4 : state === 'discovered' ? 2.25 : 1.25
        pennant.material = state === 'completed' ? coralMat : state === 'discovered' ? saffronMat : tealMat
        root.scale.setScalar(state === 'completed' ? 1.12 : state === 'discovered' ? 1.05 : 1)
      },
    }
    root.userData.locationName = location.name ?? location.title ?? location.label ?? location.id
    scene.add(root)
    return marker
  }
  LOCATIONS_TYPED.forEach((location, index) => {
    const marker = createMarker(location, index)
    objectiveMarkers.set(location.id, marker)
  })

  // Secure assembly ground is intentionally open and visually separate from the dense districts.
  const assembly = new THREE.Group()
  assembly.name = 'secure-assembly-ground'
  const assemblyFloor = addBox(assembly, new THREE.Vector3(0, 0.04, 0), new THREE.Vector3(26, 0.08, 26), flat(new THREE.Color('#9b9b88')))
  assemblyFloor.receiveShadow = true
  addPlaza(secureCenter.x, secureCenter.z, 11.5, flat(new THREE.Color('#6e7773')))
  addBox(assembly, new THREE.Vector3(0, 0.13, 0), new THREE.Vector3(21, 0.04, 0.16), roadEdgeMat)
  addBox(assembly, new THREE.Vector3(0, 0.13, 0), new THREE.Vector3(0.16, 0.04, 21), roadEdgeMat)
  assembly.position.copy(secureCenter)
  scene.add(assembly)

  const addFencePost = (position: THREE.Vector3): void => {
    addCylinder(scene, position, 0.12, 2.2, steelMat, true)
    addBox(scene, new THREE.Vector3(position.x, 1.02, position.z), new THREE.Vector3(0.18, 0.1, 0.18), warningMat)
  }
  const fenceY = 1.25
  for (let i = -12; i <= 12; i += 4) {
    if (Math.abs(i) > 4) {
      addFencePost(new THREE.Vector3(secureCenter.x + i, fenceY, secureCenter.z - 13))
      addFencePost(new THREE.Vector3(secureCenter.x + i, fenceY, secureCenter.z + 13))
    }
    addFencePost(new THREE.Vector3(secureCenter.x - 13, fenceY, secureCenter.z + i))
    addFencePost(new THREE.Vector3(secureCenter.x + 13, fenceY, secureCenter.z + i))
  }
  const gateWidth = 7.5
  const fenceTop = 2.45
  physics.addStaticBox(new THREE.Vector3(secureCenter.x, fenceTop / 2, secureCenter.z + 13), new THREE.Vector3(26, fenceTop, 0.16))
  physics.addStaticBox(new THREE.Vector3(secureCenter.x - 13, fenceTop / 2, secureCenter.z), new THREE.Vector3(0.16, fenceTop, 26))
  physics.addStaticBox(new THREE.Vector3(secureCenter.x + 13, fenceTop / 2, secureCenter.z), new THREE.Vector3(0.16, fenceTop, 26))
  const gateSideWidth = (26 - gateWidth) / 2
  for (const side of [-1, 1]) {
    const segmentCenter = side * (gateWidth / 2 + gateSideWidth / 2)
    physics.addStaticBox(new THREE.Vector3(secureCenter.x + segmentCenter, fenceTop / 2, secureCenter.z - 13), new THREE.Vector3(gateSideWidth, fenceTop, 0.16))
  }
  for (const y of [0.72, 1.54]) {
    addBox(scene, new THREE.Vector3(secureCenter.x, y, secureCenter.z + 13), new THREE.Vector3(26, 0.09, 0.09), steelMat, true)
    for (const side of [-1, 1]) {
      const segmentCenter = side * (gateWidth / 2 + gateSideWidth / 2)
      addBox(scene, new THREE.Vector3(secureCenter.x + segmentCenter, y, secureCenter.z - 13), new THREE.Vector3(gateSideWidth, 0.09, 0.09), steelMat, true)
    }
    addBox(scene, new THREE.Vector3(secureCenter.x - 13, y, secureCenter.z), new THREE.Vector3(0.09, 0.09, 26), steelMat, true)
    addBox(scene, new THREE.Vector3(secureCenter.x + 13, y, secureCenter.z), new THREE.Vector3(0.09, 0.09, 26), steelMat, true)
  }

  const addWarningPlacard = (x: number, z: number, rotation: number): void => {
    const placard = new THREE.Group()
    placard.position.set(x, 0, z)
    addBox(placard, new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(0.08, 2.2, 0.08), steelMat)
    const diamond = addBox(placard, new THREE.Vector3(0, 2.35, 0), new THREE.Vector3(0.72, 0.72, 0.07), warningMat)
    diamond.rotation.z = Math.PI / 4
    addBox(placard, new THREE.Vector3(0, 2.35, -0.055), new THREE.Vector3(0.36, 0.08, 0.08), coralMat)
    addBox(placard, new THREE.Vector3(0, 2.35, -0.055), new THREE.Vector3(0.08, 0.36, 0.08), coralMat)
    placard.rotation.y = rotation
    scene.add(placard)
  }
  addWarningPlacard(secureCenter.x - 9, secureCenter.z - 12.8, 0.2)
  addWarningPlacard(secureCenter.x + 9, secureCenter.z - 12.8, -0.2)
  addWarningPlacard(secureCenter.x + 12.8, secureCenter.z + 6, Math.PI / 2)

  const gateRoot = new THREE.Group()
  gateRoot.name = 'final-gate'
  const gateCenter = new THREE.Vector3(secureCenter.x, 1.55, secureCenter.z - 13)
  gateRoot.position.set(gateCenter.x, 0, gateCenter.z)
  addBox(gateRoot, new THREE.Vector3(-gateWidth / 2 - 0.65, 1.5, 0), new THREE.Vector3(1.1, 3, 0.9), terracottaMaterial(0), true)
  addBox(gateRoot, new THREE.Vector3(gateWidth / 2 + 0.65, 1.5, 0), new THREE.Vector3(1.1, 3, 0.9), terracottaMaterial(1), true)
  addBox(gateRoot, new THREE.Vector3(0, 3.0, 0), new THREE.Vector3(gateWidth + 1.6, 0.7, 0.9), saffronMat, true)
  addBox(gateRoot, new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(gateWidth, 3, 0.46), steelMat)
  for (const x of [-2.6, -1.3, 0, 1.3, 2.6]) addBox(gateRoot, new THREE.Vector3(x, 1.5, -0.28), new THREE.Vector3(0.16, 2.7, 0.16), warningMat)
  scene.add(gateRoot)
  if (typeof document !== 'undefined') {
    const signCanvas = document.createElement('canvas')
    signCanvas.width = 1024
    signCanvas.height = 192
    const signContext = signCanvas.getContext('2d')
    if (signContext) {
      signContext.fillStyle = '#173f49'
      signContext.fillRect(0, 0, signCanvas.width, signCanvas.height)
      signContext.strokeStyle = '#f2c84b'
      signContext.lineWidth = 10
      signContext.strokeRect(8, 8, signCanvas.width - 16, signCanvas.height - 16)
      signContext.textAlign = 'center'
      signContext.textBaseline = 'middle'
      signContext.fillStyle = '#fff4d2'
      signContext.font = '900 72px system-ui, sans-serif'
      signContext.fillText('DETENTION CENTER', 512, 76)
      signContext.fillStyle = '#ffd35c'
      signContext.font = '700 28px system-ui, sans-serif'
      signContext.fillText('SECURITY PERIMETER  ·  ENTRY CONTROL', 512, 146)
    }
    const signTexture = new THREE.CanvasTexture(signCanvas)
    signTexture.colorSpace = THREE.SRGBColorSpace
    const signPosition = new THREE.Vector3(secureCenter.x - 7, 4.08, secureCenter.z - 13.23)
    addBox(scene, new THREE.Vector3(signPosition.x, 4.08, secureCenter.z - 13.12), new THREE.Vector3(8.55, 1.28, 0.18), flat(new THREE.Color('#173f49')))
    const sign = addMesh(scene, new THREE.PlaneGeometry(8.25, 1.08), new THREE.MeshBasicMaterial({ map: signTexture, side: THREE.DoubleSide, toneMapped: false }), signPosition)
    sign.name = 'detention-center-sign'
    sign.rotation.y = Math.PI
    sign.renderOrder = 2
  }
  const gate: GateData = {
    root: gateRoot,
    center: gateCenter.clone(),
    width: gateWidth,
    collider: physics.addStaticBox(gateCenter, new THREE.Vector3(gateWidth, 3, 0.46)),
    open: false,
    openGate,
    closeGate,
  }

  function openGate(): void {
    if (gate.open) return
    gate.open = true
    physics.world.removeCollider(gate.collider, true)
    gate.root.visible = false
  }

  function closeGate(): void {
    if (!gate.open) return
    gate.collider = physics.addStaticBox(gate.center, new THREE.Vector3(gate.width, 3, 0.46))
    gate.open = false
    gate.root.visible = true
  }

  function terracottaMaterial(index: number): THREE.Material {
    return flat(palette.terracotta[index % palette.terracotta.length])
  }

  // Barricades, floodlights, and guard posts make the security boundary legible without text or logos.
  for (const side of [-1, 1]) {
    const barricadePos = new THREE.Vector3(secureCenter.x + side * 5.5, 0.62, secureCenter.z - 10.2)
    addBox(scene, barricadePos, new THREE.Vector3(3.1, 1.0, 0.36), coralMat, true, side * 0.18)
    addBox(scene, barricadePos.clone().setY(0.9), new THREE.Vector3(3.25, 0.08, 0.42), warningMat, false, side * 0.18)
  }
  for (const position of [new THREE.Vector3(secureCenter.x - 9.5, 0, secureCenter.z - 8), new THREE.Vector3(secureCenter.x + 9.5, 0, secureCenter.z + 7)]) {
    addBox(scene, position.clone().setY(2.1), new THREE.Vector3(1.8, 4.2, 1.8), sandstoneMaterial(position.x < secureCenter.x ? 0 : 1), true)
    addBox(scene, position.clone().setY(4.35), new THREE.Vector3(2.2, 0.15, 2.2), tealMat)
    const floodlight = new THREE.SpotLight('#fff1bd', 28, 28, 0.58, 0.4, 1)
    floodlight.position.copy(position).setY(4.85)
    floodlight.target.position.copy(position).setY(0)
    scene.add(floodlight, floodlight.target)
  }

  // Watchtower: four real stepped flights and landings wind around an open shaft to the top platform.
  const tower = new THREE.Group()
  tower.name = 'watchtower'
  // Offset it deeper and east within the secured compound so the entrance sign and gate remain legible.
  const towerCenter = secureCenter.clone().add(new THREE.Vector3(6, 0, 3))
  tower.position.copy(towerCenter)
  const towerHeight = 10.2
  for (const x of [-1.55, 1.55]) for (const z of [-1.55, 1.55]) addCylinder(tower, new THREE.Vector3(x, towerHeight / 2, z), 0.18, towerHeight, sandstoneMaterial(1), true)
  addBox(tower, new THREE.Vector3(0, 4.2, -1.75), new THREE.Vector3(3.6, 0.14, 0.14), tealMat)
  addBox(tower, new THREE.Vector3(0, 7.3, 1.75), new THREE.Vector3(3.6, 0.14, 0.14), coralMat)
  const platformCenter = new THREE.Vector3(towerCenter.x, towerHeight, towerCenter.z)
  // Three solid deck sections frame an open stairwell notch; the final flight can rise through
  // the opening and meet the top surface instead of colliding with the platform's vertical edge.
  const platformMaterial = sandstoneMaterial(0)
  const mainDeckPosition = new THREE.Vector3(1.35, towerHeight, 0)
  const mainDeckSize = new THREE.Vector3(7.3, 0.36, 10)
  const mainDeck = addBox(tower, mainDeckPosition, mainDeckSize, platformMaterial)
  mainDeck.receiveShadow = true
  const platformCollider = physics.addStaticBox(worldFrom(tower, mainDeckPosition), mainDeckSize)
  const westDeck = addBox(tower, new THREE.Vector3(-4.85, towerHeight, 0), new THREE.Vector3(0.3, 0.36, 10), platformMaterial, true)
  westDeck.receiveShadow = true
  const southwestDeck = addBox(tower, new THREE.Vector3(-3.5, towerHeight, -3.5), new THREE.Vector3(2.4, 0.36, 3.0), platformMaterial, true)
  southwestDeck.receiveShadow = true

  const addFlight = (start: THREE.Vector3, direction: THREE.Vector3, steps: number, rise: number, run: number, baseHeight: number): THREE.Vector3 => {
    const dir = direction.clone().normalize()
    const stepRun = run / steps
    for (let i = 0; i < steps; i += 1) {
      const h = rise * (i + 1)
      const center = start.clone().addScaledVector(dir, stepRun * (i + 0.5))
      const stepHeight = h
      const stepSize = new THREE.Vector3(Math.abs(dir.z) * 2.25 + Math.abs(dir.x) * stepRun, stepHeight, Math.abs(dir.x) * 2.25 + Math.abs(dir.z) * stepRun)
      // Keep each visible tread, but use one continuous, accurately sloped support collider below
      // the staircase. This avoids character-controller deadlocks against the first boxed riser.
      addBox(tower, new THREE.Vector3(center.x, baseHeight + stepHeight / 2, center.z), stepSize, sandstoneMaterial(2), false)
    }
    const slope = Math.atan2(rise, run)
    const rampRotation = new THREE.Quaternion()
    if (Math.abs(dir.x) > 0.5) rampRotation.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sign(dir.x) * slope)
    else rampRotation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.sign(dir.z) * slope)
    const rampCenter = start.clone().addScaledVector(dir, run / 2 - stepRun / 2 - 0.1)
    rampCenter.y = baseHeight + rise / 2
    const rampLength = Math.hypot(run, rise)
    const rampSize = Math.abs(dir.x) > 0.5
      ? new THREE.Vector3(rampLength, 0.08, 2.25)
      : new THREE.Vector3(2.25, 0.08, rampLength)
    const ramp = addMesh(tower, unitBox, sandstoneMaterial(2), rampCenter, rampSize)
    ramp.quaternion.copy(rampRotation)
    physics.addStaticBox(worldFrom(tower, rampCenter), rampSize, rampRotation)
    return start.clone().addScaledVector(dir, run)
  }
  const flightRise = 2.45
  const flightRun = 7.0
  let stairPoint = new THREE.Vector3(-3.5, 0, -3.5)
  stairPoint = addFlight(stairPoint, new THREE.Vector3(1, 0, 0), 10, flightRise, flightRun, 0)
  addBox(tower, new THREE.Vector3(stairPoint.x, flightRise - 0.12, stairPoint.z), new THREE.Vector3(0.9, 0.24, 2.5), tealMat, true)
  stairPoint = new THREE.Vector3(4.625, 0, -3.5)
  stairPoint = addFlight(stairPoint, new THREE.Vector3(0, 0, 1), 10, flightRise, flightRun, flightRise)
  addBox(tower, new THREE.Vector3(stairPoint.x, flightRise * 2 - 0.12, stairPoint.z), new THREE.Vector3(2.5, 0.24, 0.9), coralMat, true)
  stairPoint = new THREE.Vector3(4.625, 0, 4.625)
  stairPoint = addFlight(stairPoint, new THREE.Vector3(-1, 0, 0), 10, flightRise, flightRun, flightRise * 2)
  addBox(tower, new THREE.Vector3(stairPoint.x, flightRise * 3 - 0.12, stairPoint.z), new THREE.Vector3(0.9, 0.24, 2.5), saffronMat, true)
  stairPoint = new THREE.Vector3(-3.5, 0, 4.625)
  addFlight(stairPoint, new THREE.Vector3(0, 0, -1), 10, towerHeight - flightRise * 3, flightRun, flightRise * 3)
  addBox(tower, new THREE.Vector3(0, towerHeight + 0.42, 0), new THREE.Vector3(7.2, 0.12, 0.12), steelMat)
  addBox(tower, new THREE.Vector3(0, towerHeight + 0.42, 0), new THREE.Vector3(0.12, 0.12, 7.2), steelMat)
  const roof = addMesh(tower, coneGeo, terracottaMaterial(1), new THREE.Vector3(0, towerHeight + 1.65, 0), new THREE.Vector3(3.7, 2.5, 3.7))
  roof.scale.y = 0.7
  addMesh(tower, finialGeo, saffronMat, new THREE.Vector3(0, towerHeight + 3.0, 0), new THREE.Vector3(1.2, 1.6, 1.2))
  scene.add(tower)

  const poleHeight = 6.2
  const pole = addCylinder(tower, new THREE.Vector3(0, towerHeight + poleHeight / 2 + 0.25, 0), 0.07, poleHeight, steelMat)
  pole.castShadow = true
  const clothHeight = 1.45
  const clothWidth = clothHeight * (2350 / 1824)
  const clothMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', ...(flagTexture ? { map: flagTexture } : {}), roughness: 0.78, side: THREE.DoubleSide, transparent: true, alphaTest: 0.025 })
  const cloth = addMesh(tower, new THREE.PlaneGeometry(clothWidth, clothHeight, 24, 12), clothMaterial, new THREE.Vector3(clothWidth / 2, 0.7, 0))
  cloth.name = 'gyanu-flag-cloth'
  cloth.userData.startY = 0.7
  cloth.userData.targetY = towerHeight + poleHeight - 0.5
  const flagpolePosition = platformCenter.clone()
  const flag: FlagData = {
    root: tower,
    cloth,
    clothWidth,
    clothHeight,
    flagpolePosition,
    poleHeight,
    clothAnchor: new THREE.Vector3(platformCenter.x + clothWidth / 2, towerHeight + poleHeight - 0.5, platformCenter.z),
  }
  const towerData: TowerData = {
    root: tower,
    center: towerCenter.clone(),
    height: towerHeight,
    platformCenter: platformCenter.clone(),
    platformRadius: 5.0,
    stairFlights: 4,
    platformCollider,
  }

  const guardSpawns: GuardSpawn[] = [
    { id: 'gate-west', displayName: 'Asha Rao', designation: 'GATE WARDEN', position: new THREE.Vector3(secureCenter.x - 7.2, 0.95, secureCenter.z - 10.2), district: 'detention center', role: 'gate' },
    { id: 'gate-east', displayName: 'Imran Malik', designation: 'GATE WARDEN', position: new THREE.Vector3(secureCenter.x + 7.2, 0.95, secureCenter.z - 10.2), district: 'detention center', role: 'gate' },
    { id: 'tower-watch', displayName: 'Sana Dutta', designation: 'TOWER WATCH', position: new THREE.Vector3(secureCenter.x + 3.4, 0.95, secureCenter.z + 3.4), district: 'detention center', role: 'tower' },
    { id: 'market-patrol', displayName: 'Kiran Sen', designation: 'MARKET PATROL', position: new THREE.Vector3(hubPoints[2]?.x ?? 0, 0.95, hubPoints[2]?.z ?? 0), district: 'market', role: 'patrol' },
    { id: 'detention-watch', displayName: 'Vikram Bedi', designation: 'DETENTION WATCH', position: new THREE.Vector3(secureCenter.x - 5.2, 0.95, secureCenter.z + 4.2), district: 'detention center', role: 'detention' },
    { id: 'yard-watch', displayName: 'Nisha Qureshi', designation: 'YARD WATCH', position: new THREE.Vector3(secureCenter.x + 5.2, 0.95, secureCenter.z + 4.2), district: 'detention center', role: 'detention' },
    { id: 'perimeter-patrol', displayName: 'Arjun Das', designation: 'PERIMETER PATROL', position: new THREE.Vector3(secureCenter.x, 0.95, secureCenter.z + 10), district: 'detention center', role: 'patrol' },
  ]
  const guardRoutes: GuardRoute[] = [
    {
      id: 'market-loop',
      waypoints: [0, 1, 2, 3].map(i => hubPoints[i % Math.max(1, hubPoints.length)].clone().setY(0.95)),
      loop: true,
      speed: 2.4,
    },
    {
      id: 'assembly-perimeter',
      waypoints: [
        new THREE.Vector3(secureCenter.x - 10, 0.95, secureCenter.z - 10),
        new THREE.Vector3(secureCenter.x + 10, 0.95, secureCenter.z - 10),
        new THREE.Vector3(secureCenter.x + 10, 0.95, secureCenter.z + 10),
        new THREE.Vector3(secureCenter.x - 10, 0.95, secureCenter.z + 10),
      ],
      loop: true,
      speed: 2.1,
    },
  ]

  const spawn = new THREE.Vector3(routeStart.x, 1.2, routeStart.z)
  const setMarkerState = (id: string, state: MarkerState): boolean => {
    const marker = objectiveMarkers.get(id)
    if (!marker) return false
    marker.setState(state)
    return true
  }
  const updateMarkerDiscovered = (id: string, discovered = true): boolean => setMarkerState(id, discovered ? 'discovered' : 'undiscovered')
  const updateMarkerCompleted = (id: string, completed = true): boolean => setMarkerState(id, completed ? 'completed' : 'discovered')

  return {
    scene,
    spawn,
    objectiveMarkers,
    markerMap: objectiveMarkers,
    guardSpawns,
    guardRoutes,
    tower: towerData,
    flag,
    gate,
    get finalGateCollider(): Collider { return gate.collider },
    openGate,
    closeGate,
    setMarkerState,
    updateMarkerDiscovered,
    updateMarkerCompleted,
  }
}

function sandstoneMaterial(index: number): THREE.Material {
  return flat(palette.sandstone[index % palette.sandstone.length])
}
