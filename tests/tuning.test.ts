import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CONFIG, DEFAULT_CONFIG } from '../src/game/config'
import { tuning } from '../src/game/tuning'
import { initPhysics, Physics } from '../src/engine/physics'
import { Player, type PlayerIntent } from '../src/game/player'
import { FollowCamera } from '../src/game/camera'

const defaults = Object.fromEntries(tuning.controls.map(control => [control.id, control.default]))
afterEach(() => { tuning.apply(defaults); tuning.activate('jump'); tuning.activate('run') })

describe('Three.js tuning', () => {
  it('validates a complete patch before committing and preserves source defaults', () => {
    const before = tuning.read()
    for (const patch of [{ 'player.walkSpeed': 8, 'camera.fov': 999 }, { 'player.walkSpeed': 12 }, { 'player.walkSpeed': 7.1 }, { 'player.walkSpeed': '8' }, { 'camera.fov': Infinity }, { unknown: 4 }]) {
      expect(() => tuning.apply(patch)).toThrow(); expect(tuning.read()).toEqual(before)
    }
    tuning.apply({ 'player.walkSpeed': 6, 'player.sprintSpeed': 9 })
    expect(CONFIG.player.walkSpeed).toBe(6); expect(CONFIG.player.sprintSpeed).toBe(9); expect(DEFAULT_CONFIG.player.walkSpeed).toBe(5.4)
  })
  it('latches jump and new-mission values only at their matching boundaries', () => {
    tuning.apply({ 'player.jumpSpeed': 14, 'mission.hostDuration': 9 })
    expect(CONFIG.player.jumpSpeed).toBe(DEFAULT_CONFIG.player.jumpSpeed); expect(CONFIG.mission.hostDuration).toBe(DEFAULT_CONFIG.mission.hostDuration)
    tuning.activate('jump'); expect(CONFIG.player.jumpSpeed).toBe(14); expect(CONFIG.mission.hostDuration).toBe(DEFAULT_CONFIG.mission.hostDuration)
    tuning.activate('run'); expect(CONFIG.mission.hostDuration).toBe(9)
  })
  it('changes real player movement and the next jump without replacing Rapier physics', async () => {
    await initPhysics(); const physics = new Physics(); const player = new Player(physics, new THREE.Vector3(0, 2, 0))
    const intent: PlayerIntent = { moveX: 1, moveY: 0, sprint: false, crouch: false, jumpPressed: false, jumpHeld: true }
    try {
      player.grounded = true; player.step(1 / 60, intent, 0, []); const oldSpeed = player.velocity.x
      player.teleport(new THREE.Vector3(0, 2, 0)); player.grounded = true; tuning.apply({ 'player.walkSpeed': 10, 'player.sprintSpeed': 12 }); player.step(1 / 60, intent, 0, [])
      expect(player.velocity.x).toBeGreaterThan(oldSpeed); player.grounded = true; tuning.apply({ 'player.jumpSpeed': 14 })
      player.step(1 / 60, { ...intent, moveX: 0, jumpPressed: true }, 0, []); expect(player.velocity.y).toBeCloseTo(14 + CONFIG.player.gravity / 60)
    } finally { physics.dispose() }
  })
  it('updates the active camera projection without replacing the camera', async () => {
    await initPhysics(); const physics = new Physics(); const player = new Player(physics, new THREE.Vector3(0, 2, 0)); const camera = new FollowCamera(physics, player.collider)
    try {
      const before = camera.camera.projectionMatrix.clone(); tuning.apply({ 'camera.fov': 90, 'camera.distance': 9 })
      camera.update(new THREE.Vector3(0, 2, 0), { x: 0, y: 0 }, 1, true)
      expect(camera.camera.fov).toBe(90); expect(camera.camera.projectionMatrix.equals(before)).toBe(false)
      expect(camera.camera.position.distanceTo(new THREE.Vector3(0, 2 + CONFIG.camera.height, 0))).toBeCloseTo(9, 1)
      camera.setMode('first'); camera.update(new THREE.Vector3(0, 2, 0), { x: 0, y: 0 }, 1, true); expect(camera.mode).toBe('first')
    } finally { physics.dispose() }
  })
})
