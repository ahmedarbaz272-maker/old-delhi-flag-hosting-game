import * as THREE from 'three'
import { RAPIER, type Physics } from '../engine/physics'
import { CONFIG } from './config'

export type CameraMode = 'first' | 'third'
const UP = new THREE.Vector3(0, 1, 0)

/** Orbit camera with a stable eye-level first-person mode and a collision-shortened third-person boom. */
export class FollowCamera {
  readonly camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.08, 320)
  yaw = 0
  pitch = 0.12
  mode: CameraMode = 'third'
  private distance = CONFIG.camera.distance
  private readonly focus = new THREE.Vector3()

  constructor(private readonly physics: Physics, private readonly exclude: RAPIER.Collider) {}
  setMode(mode: CameraMode): void { this.mode = mode }
  toggleMode(): CameraMode { this.mode = this.mode === 'third' ? 'first' : 'third'; return this.mode }
  reset(target: THREE.Vector3, yaw = this.yaw): void {
    this.yaw = yaw; this.focus.copy(target); this.distance = CONFIG.camera.distance
    this.update(target, { x: 0, y: 0 }, 1, true)
  }
  update(target: THREE.Vector3, look: { x: number; y: number }, frameSeconds: number, snap = false, reducedMotion = false): void {
    const c = CONFIG.camera
    if (this.camera.fov !== c.fov) { this.camera.fov = c.fov; this.camera.updateProjectionMatrix() }
    this.yaw = wrapAngle(this.yaw - look.x)
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.y, c.minPitch, c.maxPitch)
    if (this.mode === 'first') {
      const eye = target.clone().add(new THREE.Vector3(0, 0.56, 0))
      const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch))
      this.camera.position.copy(eye); this.camera.up.copy(UP); this.camera.lookAt(eye.clone().addScaledVector(dir, 10)); return
    }
    const aim = target.clone().add(new THREE.Vector3(0, c.height, 0))
    if (snap) this.focus.copy(aim)
    else {
      const k = 1 - Math.exp(-c.follow * frameSeconds), kv = 1 - Math.exp(-c.follow * 0.58 * frameSeconds)
      this.focus.x += (aim.x - this.focus.x) * k; this.focus.z += (aim.z - this.focus.z) * k; this.focus.y += (aim.y - this.focus.y) * kv
    }
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch))
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
    const boomOrigin = this.focus.clone().addScaledVector(right, c.shoulder)
    let wanted = c.distance
    const hit = this.physics.world.castRay(new RAPIER.Ray(boomOrigin, dir), c.distance, true, undefined, undefined, this.exclude)
    if (hit) wanted = Math.max(1.15, hit.timeOfImpact - 0.3)
    this.distance = wanted < this.distance || snap ? wanted : THREE.MathUtils.damp(this.distance, wanted, 4, frameSeconds)
    this.camera.position.copy(boomOrigin).addScaledVector(dir, this.distance); this.camera.up.copy(UP); this.camera.lookAt(this.focus)
    if (reducedMotion) this.camera.position.y = Math.max(this.camera.position.y, target.y + 0.5)
  }
}
function wrapAngle(a: number): number { return Math.atan2(Math.sin(a), Math.cos(a)) }
