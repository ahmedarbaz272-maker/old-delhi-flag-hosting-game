import * as THREE from 'three'
import { FINAL_DESTINATION, LOCATIONS } from './mission'
import type { ModelLibrary } from './model-assets'

type ActorState = 'local' | 'follower'

type CrowdActor = {
  readonly root: THREE.Group
  readonly model: THREE.Group
  readonly locationId: string
  readonly phase: number
  state: ActorState
  completed: boolean
  runTime: number
}

const LOCATION_BY_ID = new Map(LOCATIONS.map(location => [location.id, location]))
const IDLE_POSITIONS: readonly (readonly [number, number])[] = [
  [-1.15, 0.15],
  [1.15, 0.35],
  [0.05, 1.55],
  [-1.25, 1.85],
  [1.25, 1.95],
]
const MAX_FOLLOWERS = 8
const LOCAL_PER_LOCATION = 3
const FOLLOWER_SPACING = 1.2
const TURN_RATE = 8
const MOVE_RATE = 4.2
const TOWER_HOLD_RADIUS = 12
const UP = new THREE.Vector3(0, 1, 0)

/**
 * Owns only the cloned character scene nodes it adds to `scene`. Geometry, materials,
 * and textures on gatherer clones remain shared with ModelLibrary and are never disposed here.
 */
export class CrowdSystem {
  private readonly actors: CrowdActor[] = []
  private readonly revealed = new Set<string>()
  private readonly completed = new Set<string>()
  private disposed = false
  private elapsed = 0

  constructor(private readonly scene: THREE.Scene, private readonly models: ModelLibrary) {}

  /** Reveal exactly one small, deterministic group at a known objective site. */
  revealLocation(id: string): void {
    if (this.disposed || this.revealed.has(id)) return
    const location = LOCATION_BY_ID.get(id)
    if (!location) return
    this.revealed.add(id)

    for (let i = 0; i < LOCAL_PER_LOCATION; i += 1) {
      const model = this.models.clone('gatherer')
      if (!model) continue
      const [offsetX, offsetZ] = IDLE_POSITIONS[i]
      const root = new THREE.Group()
      root.name = `crowd-${id}-${i}`
      root.position.set(location.x + offsetX, 0, location.z + offsetZ)
      const towardCenter = Math.atan2(-offsetX, -offsetZ)
      root.rotation.y = towardCenter
      root.add(model)
      this.scene.add(root)
      this.actors.push({
        root,
        model,
        locationId: id,
        phase: i * 1.7 + this.actors.length * 0.23,
        state: 'local',
        completed: this.completed.has(id),
        runTime: 0,
      })
    }
  }

  /** Promote nearby idle site characters into the procession; game counts remain MissionState-owned. */
  recruit(id: string, amount: number): void {
    if (this.disposed || !this.revealed.has(id) || !Number.isFinite(amount) || amount <= 0) return
    const local = this.actors.filter(actor => actor.locationId === id && actor.state === 'local')
    const openSlots = Math.max(0, MAX_FOLLOWERS - this.visibleFollowers)
    if (openSlots === 0 || local.length === 0) return
    const requested = Math.max(1, Math.floor(amount))
    for (const actor of local.slice(0, Math.min(requested, openSlots))) {
      actor.state = 'follower'
      actor.runTime = this.elapsed
    }
  }

  /** Mark the site's remaining visible civilians as celebrating without changing mission progress. */
  completeLocation(id: string): void {
    if (this.disposed || !LOCATION_BY_ID.has(id)) return
    this.completed.add(id)
    for (const actor of this.actors) {
      if (actor.locationId === id) actor.completed = true
    }
  }

  /** Move followers into a stable, ground-level trailing formation and idle locals in place. */
  update(dt: number, player: THREE.Vector3, facing: number, holdAtTower = false): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return
    const step = Math.min(dt, 0.1)
    this.elapsed += step
    const forward = new THREE.Vector3(-Math.sin(facing), 0, -Math.cos(facing))
    const right = new THREE.Vector3().crossVectors(forward, UP)
    const towerDx = player.x - FINAL_DESTINATION.x
    const towerDz = player.z - FINAL_DESTINATION.z
    const holdFollowers = holdAtTower && towerDx * towerDx + towerDz * towerDz <= TOWER_HOLD_RADIUS * TOWER_HOLD_RADIUS

    let followerIndex = 0
    for (const actor of this.actors) {
      if (actor.state === 'local') {
        this.updateLocal(actor)
        continue
      }

      const index = followerIndex
      followerIndex += 1
      if (!holdFollowers) {
        const row = Math.floor(index / 2) + 1
        const side = index % 2 === 0 ? -0.58 : 0.58
        const back = row * FOLLOWER_SPACING + 0.55
        const targetX = player.x - forward.x * back + right.x * side
        const targetZ = player.z - forward.z * back + right.z * side
        const dx = targetX - actor.root.position.x
        const dz = targetZ - actor.root.position.z
        const distance = Math.hypot(dx, dz)
        if (distance > 0.015) {
          const travel = Math.min(distance, MOVE_RATE * step)
          actor.root.position.x += (dx / distance) * travel
          actor.root.position.z += (dz / distance) * travel
          const targetAngle = Math.atan2(-dx, -dz)
          actor.root.rotation.y = dampAngle(actor.root.rotation.y, targetAngle, TURN_RATE, step)
          actor.runTime += step * (1.1 + Math.min(1, distance / 3))
        } else {
          actor.root.rotation.y = dampAngle(actor.root.rotation.y, facing, TURN_RATE * 0.5, step)
        }
      }
      // Crowd stays on the city ground plane: it never copies the player's jump or climbs steps.
      actor.root.position.y = 0
      actor.model.position.y = Math.abs(Math.sin(actor.runTime * 7 + actor.phase)) * 0.045
    }
  }

  /** Number of visible follower models (capped visual representatives, not recruited game units). */
  get visibleFollowers(): number {
    let count = 0
    for (const actor of this.actors) if (actor.state === 'follower' && actor.root.visible) count += 1
    return count
  }

  /** Number of unrecruited visual civilians still standing at this location. */
  localCount(id: string): number {
    let count = 0
    for (const actor of this.actors) if (actor.locationId === id && actor.state === 'local') count += 1
    return count
  }

  /** Remove owned scene nodes; shared ModelLibrary geometry/materials/textures are untouched. */
  reset(): void {
    if (this.disposed) return
    for (const actor of this.actors) this.scene.remove(actor.root)
    this.actors.length = 0
    this.revealed.clear()
    this.completed.clear()
    this.elapsed = 0
  }

  /** Permanently detach this system's cloned model nodes without disposing shared model resources. */
  dispose(): void {
    if (this.disposed) return
    this.reset()
    this.disposed = true
  }

  private updateLocal(actor: CrowdActor): void {
    actor.root.position.y = 0
    const amplitude = actor.completed ? 0.035 : 0.018
    const speed = actor.completed ? 2.7 : 1.65
    actor.model.position.y = Math.sin(this.elapsed * speed + actor.phase) * amplitude
    // Preserve the planted idle heading; there is no locomotion or terrain-following guesswork.
  }
}

function dampAngle(from: number, to: number, lambda: number, dt: number): number {
  let delta = (to - from) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return from + delta * (1 - Math.exp(-lambda * dt))
}
