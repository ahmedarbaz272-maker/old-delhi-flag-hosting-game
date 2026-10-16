import { afterEach, describe, expect, it } from 'vitest'
import { initPhysics, Physics } from '../src/engine/physics'
import { buildCity } from '../src/game/city-world'

let physics: Physics | undefined
afterEach(() => { physics?.dispose(); physics = undefined })

describe('city presentation and security roster', () => {
  it('includes a real sky dome and multiple individually named detention-center mobs', async () => {
    await initPhysics()
    physics = new Physics()
    const city = buildCity(physics)
    expect(city.scene.getObjectByName('procedural-sky-dome')).toBeDefined()
    expect(city.scene.getObjectByName('visible-sky-sun')).toBeDefined()
    expect(city.guardSpawns.length).toBeGreaterThanOrEqual(6)
    const names = city.guardSpawns.map(spawn => spawn.displayName)
    expect(new Set(names).size).toBe(names.length)
    expect(city.guardSpawns.every(spawn => spawn.designation.trim().length > 0)).toBe(true)
    expect(city.guardSpawns.filter(spawn => spawn.district === 'detention center')).toHaveLength(6)
  })
})
