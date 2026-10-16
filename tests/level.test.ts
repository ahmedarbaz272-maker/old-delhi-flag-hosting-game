import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/game/config'
import { FINAL_DESTINATION, LOCATIONS, TOTAL_OBJECTIVES } from '../src/game/mission'

const expectedNames = [
  'Old Quarter Square', 'Lantern Market', 'Bricklane Junction', 'Railway Yard',
  'Riverside Blocks', 'Clocktower Ward', 'Foundry Street', 'East Bazaar',
  'Abandoned Depot', 'Narrow Alley Quarter', 'Warehouse Row', 'South Courtyard',
  'Stonebridge', 'Industrial Edge', 'Outer Assembly Road', 'Central Gathering District',
]

describe('city mission layout', () => {
  it('defines exactly the requested 16 unique, independently trackable objectives', () => {
    expect(TOTAL_OBJECTIVES).toBe(16)
    expect(LOCATIONS).toHaveLength(16)
    expect(LOCATIONS.map(site => site.name)).toEqual(expectedNames)
    expect(new Set(LOCATIONS.map(site => site.id)).size).toBe(16)
    for (const site of LOCATIONS) {
      expect(site.id).toBeTruthy()
      expect(site.radius).toBeGreaterThan(0)
      expect(site.target).toBeGreaterThan(0)
      expect(site.difficulty).toBeGreaterThanOrEqual(1)
      expect(site.difficulty).toBeLessThanOrEqual(5)
      expect(site.description.length).toBeGreaterThan(8)
      expect(site.audioProfile.ambient).toBeTruthy()
      expect(site.audioProfile.approach).toBeTruthy()
      expect(site.audioProfile.completion).toBeTruthy()
      expect(Math.abs(site.x)).toBeLessThanOrEqual(40)
      expect(Math.abs(site.z)).toBeLessThanOrEqual(40)
    }
  })

  it('keeps the tower beyond the city objective grid and aligns it with centralized tuning', () => {
    expect(FINAL_DESTINATION.id).toBe('flag-hosting-tower')
    expect(FINAL_DESTINATION.z).toBeGreaterThan(Math.max(...LOCATIONS.map(site => site.z)))
    expect(CONFIG.mission.towerZ).toBe(FINAL_DESTINATION.z)
    expect(CONFIG.mission.finalGateZ).toBeLessThan(FINAL_DESTINATION.z)
  })
})
