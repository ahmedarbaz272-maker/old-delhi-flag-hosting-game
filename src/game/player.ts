import * as THREE from 'three'
import { RAPIER, type Physics } from '../engine/physics'
import { CONFIG } from './config'
import { tuning } from './tuning'

export type PlayerIntent = { moveX: number; moveY: number; sprint: boolean; crouch: boolean; jumpPressed: boolean; jumpHeld: boolean }
export type PlayerEvent = { type: 'jump' } | { type: 'land'; impact: number }
const UP = new THREE.Vector3(0, 1, 0)

/** Rapier character controller for grounded exploration through the city and climbable tower. */
export class Player {
  readonly root = new THREE.Group()
  readonly body: RAPIER.RigidBody
  readonly collider: RAPIER.Collider
  readonly velocity = new THREE.Vector3()
  grounded = false
  facing = 0
  crouched = false
  private readonly controller: RAPIER.KinematicCharacterController
  private readonly model = new THREE.Group()
  private readonly shadow: THREE.Mesh
  private coyote = 0
  private jumpBuffer = 0
  private jumping = false
  private runCycle = 0
  private safeTimer = 0
  readonly safe = new THREE.Vector3()

  constructor(private readonly physics: Physics, spawn: THREE.Vector3) {
    const p = CONFIG.player
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z))
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(p.halfHeight, p.radius).setFriction(0), this.body)
    this.controller = physics.world.createCharacterController(0.025)
    this.controller.enableAutostep(0.62, 0.18, false)
    this.controller.enableSnapToGround(0.36)
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(52))
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(38))
    this.root.position.copy(spawn); this.root.add(this.model); physics.bind(this.body, this.root); this.safe.copy(spawn)
    this.buildFallbackModel()
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(p.radius * 1.55, 24), new THREE.MeshBasicMaterial({ color: '#1d2030', transparent: true, opacity: 0.28, depthWrite: false }))
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.renderOrder = 1
  }
  get shadowMesh(): THREE.Mesh { return this.shadow }
  get position(): THREE.Vector3 { const t = this.body.translation(); return new THREE.Vector3(t.x, t.y, t.z) }
  get visual(): THREE.Group { return this.model }
  setVisual(object: THREE.Object3D): void {
    this.model.clear(); this.model.add(object); object.traverse(child => { const mesh = child as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true } })
  }
  setVisible(visible: boolean): void { this.model.visible = visible }

  step(dt: number, intent: PlayerIntent, cameraYaw: number, events: PlayerEvent[]): void {
    const p = CONFIG.player
    this.crouched = intent.crouch
    const forward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw))
    const right = new THREE.Vector3().crossVectors(forward, UP)
    const wish = new THREE.Vector3().addScaledVector(right, intent.moveX).addScaledVector(forward, intent.moveY)
    const wishLen = Math.min(1, wish.length()); if (wishLen > 0.01) wish.normalize()
    this.coyote = this.grounded ? p.coyoteTime : Math.max(0, this.coyote - dt)
    this.jumpBuffer = intent.jumpPressed ? p.jumpBuffer : Math.max(0, this.jumpBuffer - dt)
    const speed = intent.crouch ? p.crouchSpeed : intent.sprint ? p.sprintSpeed : p.walkSpeed
    const target = wish.clone().multiplyScalar(speed * wishLen)
    const horizontal = new THREE.Vector3(this.velocity.x, 0, this.velocity.z)
    horizontal.lerp(target, 1 - Math.exp(-(p.acceleration / 6) * (this.grounded ? 1 : p.airControl) * dt))
    this.velocity.x = horizontal.x; this.velocity.z = horizontal.z
    if (this.jumpBuffer > 0 && this.coyote > 0 && !intent.crouch) {
      tuning.activate('jump'); this.velocity.y = p.jumpSpeed; this.jumping = true; this.jumpBuffer = 0; this.coyote = 0; this.grounded = false; events.push({ type: 'jump' })
    }
    const rising = this.velocity.y > 0
    this.velocity.y = Math.max(p.maxFall, this.velocity.y + (rising && this.jumping && !intent.jumpHeld ? p.lowJumpGravity : p.gravity) * dt)
    if (wishLen > 0.12) this.facing = dampAngle(this.facing, Math.atan2(-wish.x, -wish.z), p.turnSpeed, dt)
    const desired = this.velocity.clone().multiplyScalar(dt)
    this.controller.computeColliderMovement(this.collider, desired)
    const moved = this.controller.computedMovement(), wasGrounded = this.grounded
    this.grounded = this.controller.computedGrounded()
    if (this.velocity.y > 0 && moved.y < desired.y - 1e-3) this.velocity.y = 0
    if (this.grounded) {
      if (!wasGrounded && this.velocity.y < -6) events.push({ type: 'land', impact: Math.min(1, -this.velocity.y / 30) })
      if (this.velocity.y < 0) this.velocity.y = -1
      this.jumping = false
    }
    const cur = this.body.translation(), next = { x: cur.x + moved.x, y: cur.y + moved.y, z: cur.z + moved.z }
    this.body.setNextKinematicTranslation(next)
    if (this.grounded) { this.safeTimer += dt; if (this.safeTimer > 0.4) this.safe.set(next.x, next.y + 0.15, next.z) } else this.safeTimer = 0
  }

  animate(dt: number, ground: number | null): void {
    const speed = Math.hypot(this.velocity.x, this.velocity.z)
    this.model.rotation.y = this.facing
    if (this.grounded && speed > 0.4) this.runCycle += dt * speed * 1.6
    const bob = this.grounded ? Math.abs(Math.sin(this.runCycle)) * 0.045 * Math.min(1, speed / 4) : 0
    this.model.position.y = bob + (this.crouched ? -0.22 : 0)
    this.model.rotation.x = -Math.min(0.16, speed / 60)
    if (ground === null) this.shadow.visible = false
    else {
      const feet = this.root.position.y - CONFIG.player.halfHeight - CONFIG.player.radius, height = Math.max(0, feet - ground)
      this.shadow.visible = height < 8; this.shadow.position.set(this.root.position.x, ground + 0.025, this.root.position.z)
      const k = THREE.MathUtils.clamp(1 - height / 8, 0.2, 1); this.shadow.scale.setScalar(k); (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.28 * k
    }
  }

  teleport(to: THREE.Vector3): void {
    this.body.setTranslation(to, true); this.body.setNextKinematicTranslation(to); this.velocity.set(0, 0, 0); this.root.position.copy(to); this.physics.snap(this.body); this.safe.copy(to); this.safeTimer = 0; this.jumping = false
  }

  private buildFallbackModel(): void {
    const shell = new THREE.MeshStandardMaterial({ color: '#13bfc5', roughness: 0.8 })
    const trim = new THREE.MeshStandardMaterial({ color: '#ff8e47', roughness: 0.7 })
    const skin = new THREE.MeshStandardMaterial({ color: '#9a5a3d', roughness: 0.82 })
    const dark = new THREE.MeshStandardMaterial({ color: '#242c42', roughness: 0.8 })
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.31, 0.38, 4, 10), shell); torso.position.y = 0.02
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.34, 0.34), trim); vest.position.set(0, 0.04, -0.005)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), skin); head.position.y = 0.58
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.245, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.52), dark); hair.position.y = 0.63
    const legs = [-1, 1].map((side) => { const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.39, 4, 8), dark); leg.position.set(side * 0.14, -0.48, 0); return leg })
    const shoes = [-1, 1].map(side => { const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.33), trim); shoe.position.set(side * 0.14, -0.78, -0.07); return shoe })
    const arms = [-1, 1].map(side => { const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.36, 4, 8), shell); arm.position.set(side * 0.36, 0.01, 0); arm.rotation.z = side * -0.13; return arm })
    for (const m of [torso, vest, head, hair, ...legs, ...shoes, ...arms]) { m.castShadow = true; this.model.add(m) }
  }
}
function dampAngle(from: number, to: number, lambda: number, dt: number): number {
  let delta = (to - from) % (Math.PI * 2); if (delta > Math.PI) delta -= Math.PI * 2; if (delta < -Math.PI) delta += Math.PI * 2
  return from + delta * (1 - Math.exp(-lambda * dt))
}
