import { describe, expect, it } from 'vitest'
import {
  LOCATIONS,
  allObjectivesComplete,
  completeHosting,
  completeMission,
  createMissionState,
  discoverLocation,
  getMissionProgress,
  normalizeMissionState,
  recruitAtLocation,
  restartMission,
  startHosting,
  updateFlagState,
} from '../src/game/mission'

const allChecks = { allObjectivesComplete: true, onTowerPlatform: true, nearFlagpole: true }

function completeEveryObjective() {
  let state = createMissionState()
  for (const location of LOCATIONS) {
    state = discoverLocation(state, location.id)
    state = recruitAtLocation(state, location.id, location.target)
  }
  return state
}

describe('flag hosting mission', () => {
  it('defines the exact 16 sites in the approved order and a separate destination', () => {
    expect(LOCATIONS).toHaveLength(16)
    expect(LOCATIONS.map(location => location.name)).toEqual([
      'Old Quarter Square', 'Lantern Market', 'Bricklane Junction', 'Railway Yard',
      'Riverside Blocks', 'Clocktower Ward', 'Foundry Street', 'East Bazaar',
      'Abandoned Depot', 'Narrow Alley Quarter', 'Warehouse Row', 'South Courtyard',
      'Stonebridge', 'Industrial Edge', 'Outer Assembly Road', 'Central Gathering District',
    ])
    expect(new Set(LOCATIONS.map(location => location.id)).size).toBe(16)
    expect(LOCATIONS.every(location => location.radius > 0 && location.target > 0 && location.audioProfile.ambient)).toBe(true)
  })

  it('reveals sites, caps recruits, and de-duplicates completion progress', () => {
    const location = LOCATIONS[0]
    let state = createMissionState()
    state = discoverLocation(state, location.id)
    state = discoverLocation(state, location.id)
    state = recruitAtLocation(state, location.id, location.target + 100)
    state = recruitAtLocation(state, location.id, location.target)
    expect(state.discovered).toEqual([location.id])
    expect(state.recruits[location.id]).toBe(location.target)
    expect(state.completed).toEqual([location.id])
    expect(getMissionProgress(state).completed).toBe(1)
  })

  it('keeps tower access and hosting locked until all objectives are complete', () => {
    let state = createMissionState()
    state = updateFlagState(state, allChecks)
    expect(state.flagState).toBe('LOCKED')
    state = discoverLocation(state, LOCATIONS[0].id)
    state = recruitAtLocation(state, LOCATIONS[0].id, LOCATIONS[0].target)
    expect(startHosting(state, allChecks).flagState).toBe('LOCKED')

    state = completeEveryObjective()
    expect(allObjectivesComplete(state)).toBe(true)
    expect(updateFlagState(state, { ...allChecks, onTowerPlatform: false }).flagState).toBe('AVAILABLE')
    expect(startHosting(state, { ...allChecks, nearFlagpole: false }).flagState).toBe('APPROACHING')
  })

  it('cannot host remotely without the real tower and flagpole checks', () => {
    const state = completeEveryObjective()
    expect(startHosting(state, { allObjectivesComplete: true, onTowerPlatform: false, nearFlagpole: true }).flagState).toBe('AVAILABLE')
    expect(startHosting(state, { allObjectivesComplete: true, onTowerPlatform: true, nearFlagpole: false }).flagState).toBe('APPROACHING')
    expect(startHosting(state, allChecks).flagState).toBe('HOSTING_IN_PROGRESS')
  })

  it('interrupts an active hosting hold when a required check fails', () => {
    const state = startHosting(completeEveryObjective(), allChecks)
    const interrupted = completeHosting(state, { ...allChecks, onTowerPlatform: false })
    expect(interrupted.flagState).toBe('HOSTING_INTERRUPTED')
    expect(startHosting(interrupted, allChecks).flagState).toBe('HOSTING_IN_PROGRESS')
  })

  it('makes HOSTED and mission completion idempotent', () => {
    const hosting = startHosting(completeEveryObjective(), allChecks)
    const hosted = completeHosting(hosting, allChecks)
    expect(hosted.flagState).toBe('HOSTED')
    expect(completeHosting(hosted, allChecks)).toBe(hosted)
    const complete = completeMission(hosted)
    expect(complete.flagState).toBe('MISSION_COMPLETE')
    expect(completeMission(complete)).toBe(complete)
    expect(startHosting(complete, allChecks)).toBe(complete)
  })

  it('normalizes malformed saves without trusting unknown IDs or fake completion', () => {
    const valid = LOCATIONS[0]
    const raw = {
      discovered: [valid.id, valid.id, 'not-a-site', 42],
      completed: ['not-a-site', valid.id],
      recruits: { [valid.id]: valid.target + 999, 'not-a-site': 500, [LOCATIONS[1].id]: -4 },
      elapsed: -10,
      guardsCaught: 'many',
      flagState: 'MISSION_COMPLETE',
      missionComplete: true,
    }
    const state = normalizeMissionState(raw)
    expect(state.discovered).toEqual([valid.id])
    expect(state.completed).toEqual([valid.id])
    expect(state.recruits[valid.id]).toBe(valid.target)
    expect(state.recruits['not-a-site']).toBeUndefined()
    expect(state.recruits[LOCATIONS[1].id]).toBeUndefined()
    expect(state.elapsed).toBe(0)
    expect(state.guardsCaught).toBe(0)
    expect(state.flagState).toBe('LOCKED')
    expect(state.missionComplete).toBe(false)

    const preserved = restartMission(state, { preserveObjectiveIds: [valid.id] })
    expect(preserved.recruits[valid.id]).toBe(valid.target)
    expect(preserved.completed).toEqual([valid.id])
    expect(preserved.flagState).toBe('LOCKED')
  })
})
