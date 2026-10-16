import * as THREE from 'three'
import { CONFIG } from './config'
import type { CityEnvironment, GuardRoute, GuardSpawn } from './city-world'
import { Physics, RAPIER } from '../engine/physics'
import type { ModelLibrary } from './model-assets'

/** The highest-priority qualitative security state currently active in the city. */
export type SecurityState =
  | 'Patrol'
  | 'Observe'
  | 'Suspicious'
  | 'Investigate'
  | 'Alert'
  | 'Pursue'
  | 'Search'
  | 'Detain'
  | 'ReturnToPatrol'

export interface SecurityStatus {
  /** Maximum normalized suspicion among active guards, clamped to [0, 1]. */
  readonly alert: number
  /** Horizontal distance to the nearest guard, in world units. */
  readonly nearestGuardDistance: number
  /** Highest-priority qualitative state among the guards. */
  readonly state: SecurityState
  /** True once a guard has detained the player; remains true until reset(). */
  readonly detained: boolean
}

type GuardRuntime = {
  readonly spawn: GuardSpawn
  readonly root: THREE.Group
  readonly nameplate?: THREE.Sprite
  readonly route?: GuardRoute
  readonly home: THREE.Vector3
  readonly leash: number
  routeIndex: number
  routeStep: 1 | -1
  yaw: number
  suspicion: number
  state: SecurityState
  lastSeen: THREE.Vector3
  lostTime: number
  searchTime: number
  phase: number
}

const STATE_PRIORITY: Record<SecurityState, number> = {
  Patrol: 0,
  ReturnToPatrol: 1,
  Observe: 2,
  Suspicious: 3,
  Search: 4,
  Investigate: 5,
  Alert: 6,
  Pursue: 7,
  Detain: 8,
}
const DETAIN_DISTANCE = 1.7
const GUARD_HEAD_HEIGHT = 1.3
const PLAYER_HEAD_OFFSET = 0.35
const PI2 = Math.PI * 2

/** Lightweight, caller-driven guard awareness and movement; mission progression remains caller-owned. */
export class SecuritySystem {
  private readonly guards: GuardRuntime[] = []
  private detained = false
  private lastStatus: SecurityStatus = {
    alert: 0,
    nearestGuardDistance: Number.POSITIVE_INFINITY,
    state: 'Patrol',
    detained: false,
  }

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: Physics,
    private readonly city: CityEnvironment,
    private readonly exclude: RAPIER.Collider,
    private readonly models: ModelLibrary,
    private readonly onDetain: (reason: string) => void,
  ) {
    for (let index = 0; index < city.guardSpawns.length; index += 1) {
      const spawn = city.guardSpawns[index]
      const root = this.createGuardModel()
      root.name = `security-guard-${spawn.id}`
      root.position.copy(spawn.position)
      root.userData.displayName = spawn.displayName
      root.userData.designation = spawn.designation
      root.userData.securityRole = spawn.role
      const nameplate = this.createNameplate(spawn)
      if (nameplate) root.add(nameplate)
      root.castShadow = true
      const route = this.routeFor(spawn)
      const routeIndex = route ? this.closestWaypoint(route, spawn.position) : 0
      const yaw = this.initialYaw(spawn, route, routeIndex)
      root.rotation.y = yaw
      scene.add(root)
      this.guards.push({
        spawn,
        root,
        nameplate,
        route,
        home: spawn.position.clone(),
        leash: spawn.role === 'patrol' ? 10 : 4,
        routeIndex,
        routeStep: 1,
        yaw,
        suspicion: 0,
        state: 'Patrol',
        lastSeen: spawn.position.clone(),
        lostTime: 0,
        searchTime: 0,
        phase: index * 2.17,
      })
    }
    this.lastStatus = this.makeStatus(city.spawn)
  }

  get status(): SecurityStatus { return this.lastStatus }

  /** Advance awareness and eased guard movement. Disabled security is fully paused. */
  update(
    dt: number,
    player: THREE.Vector3,
    speed: number,
    crouched: boolean,
    sprinting: boolean,
    restricted: boolean,
    enabled: boolean,
  ): SecurityStatus {
    if (!enabled || this.detained) {
      this.lastStatus = this.makeStatus(player)
      return this.lastStatus
    }
    if (!Number.isFinite(dt) || dt <= 0) {
      this.lastStatus = this.makeStatus(player)
      return this.lastStatus
    }

    // A bounded step prevents long frames from teleporting guards or skipping suspicion stages.
    const step = Math.min(dt, 0.1)
    const safeSpeed = Number.isFinite(speed) ? Math.max(0, speed) : 0

    for (const guard of this.guards) {
      const detection = this.detect(guard, player, safeSpeed, crouched, sprinting, restricted)
      if (guard.nameplate) guard.nameplate.visible = this.distanceXZ(guard.root.position, player) <= 32
      if (detection.visible) {
        guard.lastSeen.copy(player)
        guard.lostTime = 0
        guard.searchTime = 0
        guard.suspicion = Math.min(1, guard.suspicion + step * detection.rate / CONFIG.security.detectionSeconds)
        guard.state = guard.suspicion >= 0.99
          ? 'Pursue'
          : guard.suspicion >= 0.76
            ? 'Alert'
            : guard.suspicion >= 0.4
              ? 'Investigate'
              : guard.suspicion >= 0.16
                ? 'Suspicious'
                : 'Observe'
      } else {
        guard.lostTime += step
        guard.suspicion = Math.max(0, guard.suspicion - step * (guard.lostTime < 2 ? 0.035 : 0.13))
        this.advanceLostTarget(guard, step)
      }

      this.moveGuard(guard, step)
      if (
        !this.detained
        && guard.suspicion >= 0.76
        && (guard.state === 'Alert' || guard.state === 'Pursue')
        && this.distanceXZ(guard.root.position, player) <= DETAIN_DISTANCE
      ) {
        this.detained = true
        guard.state = 'Detain'
        this.onDetain(`Detained by ${guard.spawn.displayName}`)
      }
      if (this.detained) break
    }

    this.lastStatus = this.makeStatus(player)
    return this.lastStatus
  }

  /** Restore every guard to its configured spawn/route and re-arm the one-shot detention callback. */
  reset(): void {
    this.detained = false
    for (const guard of this.guards) {
      guard.root.position.copy(guard.home)
      guard.routeIndex = guard.route ? this.closestWaypoint(guard.route, guard.home) : 0
      guard.routeStep = 1
      guard.yaw = this.initialYaw(guard.spawn, guard.route, guard.routeIndex)
      guard.root.rotation.y = guard.yaw
      guard.suspicion = 0
      guard.state = 'Patrol'
      guard.lastSeen.copy(guard.home)
      guard.lostTime = 0
      guard.searchTime = 0
    }
    this.lastStatus = this.makeStatus(this.city.spawn)
  }

  /** Remove guard objects from the scene without disposing shared cloned model materials. */
  dispose(): void {
    for (const guard of this.guards) this.scene.remove(guard.root)
    this.guards.length = 0
    this.detained = false
    this.lastStatus = {
      alert: 0,
      nearestGuardDistance: Number.POSITIVE_INFINITY,
      state: 'Patrol',
      detained: false,
    }
  }

  private createGuardModel(): THREE.Group {
    const model = this.models.clone('guard')
    if (model) return model

    // Keep the simulation robust if an asset failed to load; normally the generated guard clone is used.
    const fallback = new THREE.Group()
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.34, 0.85, 3, 6),
      new THREE.MeshStandardMaterial({ color: '#425159', roughness: 0.82 }),
    )
    body.position.y = 0.9
    body.castShadow = true
    fallback.add(body)
    return fallback
  }

  private createNameplate(spawn: GuardSpawn): THREE.Sprite | undefined {
    if (typeof document === 'undefined') return undefined
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 128
    const context = canvas.getContext('2d')
    if (!context) return undefined
    context.fillStyle = 'rgba(23, 24, 36, 0.9)'
    context.fillRect(6, 6, 500, 116)
    context.strokeStyle = '#ffd35c'
    context.lineWidth = 8
    context.strokeRect(8, 8, 496, 112)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = '#fff7e8'
    context.font = '800 44px system-ui, sans-serif'
    context.fillText(spawn.displayName.toUpperCase(), 256, 48, 470)
    context.fillStyle = '#7ef9ff'
    context.font = '800 22px system-ui, sans-serif'
    context.fillText(spawn.designation, 256, 91, 470)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, alphaTest: 0.02 }))
    sprite.name = `security-nameplate-${spawn.id}`
    sprite.userData.displayName = spawn.displayName
    sprite.position.set(0, 2.45, 0)
    sprite.scale.set(3.25, 0.82, 1)
    sprite.renderOrder = 5
    return sprite
  }

  private routeFor(spawn: GuardSpawn): GuardRoute | undefined {
    if (this.city.guardRoutes.length === 0) return undefined
    // Patrols select the nearest configured loop; posts keep that loop as their orientation reference.
    let selected: GuardRoute | undefined
    let best = Number.POSITIVE_INFINITY
    for (const route of this.city.guardRoutes) {
      const distance = route.waypoints.reduce((nearest, point) => Math.min(nearest, this.distanceXZ(spawn.position, point)), Number.POSITIVE_INFINITY)
      if (distance < best) {
        best = distance
        selected = route
      }
    }
    return selected
  }

  private closestWaypoint(route: GuardRoute, position: THREE.Vector3): number {
    let bestIndex = 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < route.waypoints.length; index += 1) {
      const distance = this.distanceXZ(position, route.waypoints[index])
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = index
      }
    }
    return bestIndex
  }

  private initialYaw(spawn: GuardSpawn, route?: GuardRoute, routeIndex = 0): number {
    if (spawn.role === 'gate') {
      const facingX = spawn.id.endsWith('west') ? 1 : -1
      return Math.atan2(facingX, 0.45)
    }
    if (spawn.role === 'tower') return Math.PI
    if (route && route.waypoints.length > 1) {
      const next = route.waypoints[(routeIndex + 1) % route.waypoints.length]
      return Math.atan2(next.x - spawn.position.x, next.z - spawn.position.z)
    }
    return 0
  }

  private detect(
    guard: GuardRuntime,
    player: THREE.Vector3,
    speed: number,
    crouched: boolean,
    sprinting: boolean,
    restricted: boolean,
  ): { visible: boolean; rate: number } {
    const dx = player.x - guard.root.position.x
    const dz = player.z - guard.root.position.z
    const distance = Math.hypot(dx, dz)
    let radius = CONFIG.security.detectionRadius
    if (crouched) radius *= 0.68
    if (sprinting) radius *= 1.18
    if (restricted) radius *= 1.1
    if (distance > radius) return { visible: false, rate: 0 }

    const horizontalDistance = Math.max(distance, 0.001)
    const forwardX = Math.sin(guard.yaw)
    const forwardZ = Math.cos(guard.yaw)
    const headingDot = (dx * forwardX + dz * forwardZ) / horizontalDistance
    if (headingDot < CONFIG.security.fovCos) return { visible: false, rate: 0 }

    const origin = new THREE.Vector3(guard.root.position.x, guard.root.position.y + GUARD_HEAD_HEIGHT, guard.root.position.z)
    const target = new THREE.Vector3(player.x, player.y + PLAYER_HEAD_OFFSET, player.z)
    const rayDelta = target.sub(origin)
    const rayDistance = rayDelta.length()
    if (rayDistance < 0.01) return { visible: true, rate: this.detectionRate(speed, crouched, sprinting, restricted) }
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: rayDelta.x / rayDistance, y: rayDelta.y / rayDistance, z: rayDelta.z / rayDistance },
    )
    // The player capsule is excluded, while every static city collider (including walls) can occlude.
    const hit = this.physics.world.castRay(ray, rayDistance, true, undefined, undefined, this.exclude)
    return {
      visible: hit === null || hit.timeOfImpact >= rayDistance - 0.08,
      rate: this.detectionRate(speed, crouched, sprinting, restricted),
    }
  }

  private detectionRate(speed: number, crouched: boolean, sprinting: boolean, restricted: boolean): number {
    let rate = speed > 0.3 ? 1 : 0.55
    if (sprinting) rate *= 1.7
    if (crouched) rate *= 0.38
    if (restricted) rate *= 1.35
    return rate
  }

  private advanceLostTarget(guard: GuardRuntime, dt: number): void {
    if (guard.lostTime < 1.5 && guard.suspicion >= 0.72) {
      guard.state = 'Pursue'
    } else if (guard.lostTime < 3.2 && guard.suspicion >= 0.35) {
      guard.state = 'Investigate'
    } else if (guard.lostTime < 5.8 && guard.suspicion >= 0.1) {
      guard.state = 'Search'
      guard.searchTime += dt
    } else if (guard.suspicion >= 0.12 && guard.lostTime < 6.2) {
      guard.state = 'Suspicious'
    } else if (this.distanceXZ(guard.root.position, guard.home) > 0.75) {
      guard.state = 'ReturnToPatrol'
    } else {
      guard.state = 'Patrol'
    }
  }

  private moveGuard(guard: GuardRuntime, dt: number): void {
    let target: THREE.Vector3 | undefined
    let moveSpeed = 0
    if (guard.spawn.role === 'patrol' && guard.state === 'Patrol' && guard.route?.waypoints.length) {
      const waypoint = guard.route.waypoints[guard.routeIndex]
      if (this.distanceXZ(guard.root.position, waypoint) < 0.55) this.advanceRoute(guard)
      target = guard.route.waypoints[guard.routeIndex]
      moveSpeed = Math.min(3.2, Math.max(0.6, guard.route.speed))
    } else if (guard.state === 'Investigate' || guard.state === 'Alert' || guard.state === 'Pursue') {
      target = guard.lastSeen
      moveSpeed = guard.state === 'Pursue' ? CONFIG.security.pursuitSpeed : CONFIG.security.patrolSpeed * 1.45
    } else if (guard.state === 'Search') {
      const angle = guard.phase + guard.searchTime * 1.65
      const radius = 1.6 + 0.55 * Math.sin(guard.searchTime * 1.25 + guard.phase)
      target = guard.lastSeen.clone().add(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius))
      moveSpeed = CONFIG.security.patrolSpeed * 0.85
    } else if (guard.state === 'ReturnToPatrol') {
      target = guard.home
      moveSpeed = CONFIG.security.patrolSpeed * 1.15
    } else if (guard.state === 'Observe' || guard.state === 'Suspicious') {
      target = guard.lastSeen
    }

    // Guards can investigate locally but never chase arbitrarily across the entire city.
    if (target && moveSpeed > 0) {
      const boundedTarget = this.clampToLeash(guard, target)
      const dx = boundedTarget.x - guard.root.position.x
      const dz = boundedTarget.z - guard.root.position.z
      const distance = Math.hypot(dx, dz)
      if (distance > 0.08) {
        const facing = Math.atan2(dx, dz)
        guard.yaw = this.easeAngle(guard.yaw, facing, dt, 6)
        const easedSpeed = moveSpeed * Math.min(1, distance / 0.7)
        const stepDistance = Math.min(distance, easedSpeed * dt)
        guard.root.position.x += (dx / distance) * stepDistance
        guard.root.position.z += (dz / distance) * stepDistance
      }
    } else if (guard.spawn.role !== 'patrol' && guard.route?.waypoints.length && guard.state === 'Patrol') {
      // Station guards remain at their posts, but keep a route-informed watch direction.
      const waypoint = guard.route.waypoints[(guard.routeIndex + 1) % guard.route.waypoints.length]
      const facing = Math.atan2(waypoint.x - guard.root.position.x, waypoint.z - guard.root.position.z)
      guard.yaw = this.easeAngle(guard.yaw, facing, dt, 0.75)
    }
    guard.root.rotation.y = guard.yaw
    if (guard.state === 'Patrol' && guard.spawn.role === 'patrol' && guard.route && this.distanceXZ(guard.root.position, guard.route.waypoints[guard.routeIndex]) < 0.55) {
      this.advanceRoute(guard)
    }
  }

  private advanceRoute(guard: GuardRuntime): void {
    const route = guard.route
    if (!route || route.waypoints.length < 2) return
    const next = guard.routeIndex + guard.routeStep
    if (route.loop) {
      guard.routeIndex = (next + route.waypoints.length) % route.waypoints.length
    } else if (next < 0 || next >= route.waypoints.length) {
      guard.routeStep = guard.routeStep === 1 ? -1 : 1
      guard.routeIndex += guard.routeStep
    } else {
      guard.routeIndex = next
    }
  }

  private clampToLeash(guard: GuardRuntime, target: THREE.Vector3): THREE.Vector3 {
    const dx = target.x - guard.home.x
    const dz = target.z - guard.home.z
    const distance = Math.hypot(dx, dz)
    if (distance <= guard.leash || distance === 0) return target
    return new THREE.Vector3(guard.home.x + dx / distance * guard.leash, guard.home.y, guard.home.z + dz / distance * guard.leash)
  }

  private easeAngle(current: number, target: number, dt: number, response: number): number {
    const difference = ((target - current + Math.PI) % PI2 + PI2) % PI2 - Math.PI
    return current + difference * (1 - Math.exp(-response * dt))
  }

  private distanceXZ(a: THREE.Vector3, b: THREE.Vector3): number {
    return Math.hypot(a.x - b.x, a.z - b.z)
  }

  private makeStatus(player: THREE.Vector3): SecurityStatus {
    let alert = 0
    let nearestGuardDistance = Number.POSITIVE_INFINITY
    let state: SecurityState = 'Patrol'
    for (const guard of this.guards) {
      alert = Math.max(alert, guard.suspicion)
      nearestGuardDistance = Math.min(nearestGuardDistance, this.distanceXZ(guard.root.position, player))
      if (STATE_PRIORITY[guard.state] > STATE_PRIORITY[state]) state = guard.state
    }
    if (this.detained) state = 'Detain'
    return { alert: Math.max(0, Math.min(1, alert)), nearestGuardDistance, state, detained: this.detained }
  }
}
