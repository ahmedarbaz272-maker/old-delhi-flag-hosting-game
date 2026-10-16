import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { initPhysics, Physics } from '../src/engine/physics'
import { Player, type PlayerIntent } from '../src/game/player'

describe('rendered player movement', () => {
  it('synchronizes the visible character transform with its Rapier body', async () => {
    await initPhysics()
    const physics = new Physics()
    physics.addStaticBox(new THREE.Vector3(0, -0.35, 0), new THREE.Vector3(30, 0.7, 30))
    const player = new Player(physics, new THREE.Vector3(0, 0.94, 0))
    const intent: PlayerIntent = { moveX: 1, moveY: 0, sprint: false, crouch: false, jumpPressed: false, jumpHeld: false }
    try {
      player.grounded = true
      for (let frame = 0; frame < 30; frame += 1) {
        player.step(1 / 60, intent, 0, [])
        physics.step(1 / 60)
      }
      const simulatedPosition = player.position
      expect(simulatedPosition.x).toBeGreaterThan(0.1)
      expect(player.root.position.x).toBeCloseTo(0)
      physics.sync(1)
      expect(player.root.position.x).toBeCloseTo(simulatedPosition.x, 5)
    } finally {
      physics.dispose()
    }
  })
})
