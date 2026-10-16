export type Point2D = { x: number; z: number }

export type AudioProfile = {
  ambient: string
  approach: string
  completion: string
}

export type GatheringLocation = {
  readonly id: string
  readonly name: string
  readonly x: number
  readonly z: number
  readonly radius: number
  readonly target: number
  readonly difficulty: number
  readonly description: string
  readonly audioProfile: AudioProfile
  readonly district?: string
}

/** The 16 objective hubs. Keep this order stable: it is also the map/HUD order. */
export const LOCATIONS: readonly GatheringLocation[] = [
  { id: 'old-quarter-square', name: 'Old Quarter Square', x: -36, z: -36, radius: 6, target: 8, difficulty: 1, description: 'Gather allies in the historic square.', audioProfile: { ambient: 'square', approach: 'bells', completion: 'cheer' }, district: 'Old Quarter' },
  { id: 'lantern-market', name: 'Lantern Market', x: -12, z: -36, radius: 6, target: 10, difficulty: 2, description: 'Bring the market lanes together.', audioProfile: { ambient: 'market', approach: 'lanterns', completion: 'market-cheer' }, district: 'Old Quarter' },
  { id: 'bricklane-junction', name: 'Bricklane Junction', x: 12, z: -36, radius: 6, target: 7, difficulty: 2, description: 'Turn the busy junction into a meeting point.', audioProfile: { ambient: 'junction', approach: 'street-call', completion: 'junction-cheer' }, district: 'Bricklane' },
  { id: 'railway-yard', name: 'Railway Yard', x: 36, z: -36, radius: 6, target: 11, difficulty: 3, description: 'Find friends beside the old railway yard.', audioProfile: { ambient: 'rail-yard', approach: 'rail-bell', completion: 'yard-cheer' }, district: 'Bricklane' },
  { id: 'riverside-blocks', name: 'Riverside Blocks', x: -36, z: -12, radius: 6, target: 9, difficulty: 2, description: 'Unite the riverside blocks.', audioProfile: { ambient: 'river', approach: 'water-chime', completion: 'river-cheer' }, district: 'Riverside' },
  { id: 'clocktower-ward', name: 'Clocktower Ward', x: -12, z: -12, radius: 6, target: 12, difficulty: 3, description: 'Rally the ward beneath the clocktower.', audioProfile: { ambient: 'clocktower', approach: 'clock-chime', completion: 'ward-cheer' }, district: 'Riverside' },
  { id: 'foundry-street', name: 'Foundry Street', x: 12, z: -12, radius: 6, target: 10, difficulty: 3, description: 'Gather the workers along Foundry Street.', audioProfile: { ambient: 'foundry', approach: 'metal-clink', completion: 'foundry-cheer' }, district: 'Foundry' },
  { id: 'east-bazaar', name: 'East Bazaar', x: 36, z: -12, radius: 6, target: 13, difficulty: 3, description: 'Bring the east bazaar together.', audioProfile: { ambient: 'bazaar', approach: 'bazaar-call', completion: 'bazaar-cheer' }, district: 'East Bazaar' },
  { id: 'abandoned-depot', name: 'Abandoned Depot', x: -36, z: 12, radius: 6, target: 6, difficulty: 3, description: 'Make a safe meeting place at the depot.', audioProfile: { ambient: 'depot', approach: 'echo', completion: 'depot-cheer' }, district: 'Foundry' },
  { id: 'narrow-alley-quarter', name: 'Narrow Alley Quarter', x: -12, z: 12, radius: 5, target: 8, difficulty: 4, description: 'Navigate the alleys and find every ally.', audioProfile: { ambient: 'alley', approach: 'footsteps', completion: 'alley-cheer' }, district: 'Central Quarter' },
  { id: 'warehouse-row', name: 'Warehouse Row', x: 12, z: 12, radius: 6, target: 9, difficulty: 4, description: 'Fill Warehouse Row with friendly faces.', audioProfile: { ambient: 'warehouse', approach: 'rolling-door', completion: 'warehouse-cheer' }, district: 'Foundry' },
  { id: 'south-courtyard', name: 'South Courtyard', x: 36, z: 12, radius: 6, target: 10, difficulty: 2, description: 'Gather the courtyard neighbours.', audioProfile: { ambient: 'courtyard', approach: 'fountain', completion: 'courtyard-cheer' }, district: 'South Quarter' },
  { id: 'stonebridge', name: 'Stonebridge', x: -36, z: 36, radius: 6, target: 7, difficulty: 3, description: 'Meet the route at Stonebridge.', audioProfile: { ambient: 'bridge', approach: 'bridge-call', completion: 'bridge-cheer' }, district: 'South Quarter' },
  { id: 'industrial-edge', name: 'Industrial Edge', x: -12, z: 36, radius: 6, target: 12, difficulty: 4, description: 'Reach the friends at the city edge.', audioProfile: { ambient: 'industrial-edge', approach: 'engine-hum', completion: 'edge-cheer' }, district: 'Industrial Edge' },
  { id: 'outer-assembly-road', name: 'Outer Assembly Road', x: 12, z: 36, radius: 6, target: 14, difficulty: 4, description: 'Prepare the final road to the tower.', audioProfile: { ambient: 'assembly-road', approach: 'drum-roll', completion: 'road-cheer' }, district: 'Assembly District' },
  { id: 'central-gathering-district', name: 'Central Gathering District', x: 36, z: 36, radius: 6, target: 16, difficulty: 5, description: 'Complete the citywide gathering.', audioProfile: { ambient: 'central-district', approach: 'horn-call', completion: 'city-cheer' }, district: 'Assembly District' },
]

/** The tower is deliberately outside the 4×4 objective grid. */
export const FINAL_DESTINATION = { id: 'flag-hosting-tower', name: 'Flag Hosting Tower', x: 0, z: 72, radius: 5 } as const
export const TOTAL_OBJECTIVES = LOCATIONS.length

export type FlagState = 'LOCKED' | 'AVAILABLE' | 'APPROACHING' | 'READY_TO_HOST' | 'HOSTING_IN_PROGRESS' | 'HOSTING_INTERRUPTED' | 'HOSTED' | 'MISSION_COMPLETE'
export const FLAG_STATES: readonly FlagState[] = ['LOCKED', 'AVAILABLE', 'APPROACHING', 'READY_TO_HOST', 'HOSTING_IN_PROGRESS', 'HOSTING_INTERRUPTED', 'HOSTED', 'MISSION_COMPLETE']

export type MissionState = {
  readonly discovered: string[]
  readonly completed: string[]
  readonly recruits: Record<string, number>
  readonly elapsed: number
  readonly guardsCaught: number
  readonly flagState: FlagState
  readonly hostingElapsed: number
  readonly missionComplete: boolean
}

export type LocationStatus = {
  readonly id: string
  readonly name: string
  readonly discovered: boolean
  readonly recruits: number
  readonly target: number
  readonly remaining: number
  /** A normalized value from 0 to 1. `recruits` remains available for count displays. */
  readonly progress: number
  readonly percent: number
  readonly complete: boolean
}

export type MissionProgress = {
  readonly completed: number
  readonly total: number
  readonly completedObjectives: number
  readonly totalObjectives: number
  readonly recruits: number
  readonly recruitTarget: number
  readonly progress: number
  readonly percent: number
  readonly allObjectivesComplete: boolean
}

export type MissionCheck = boolean | (() => boolean)
export type HostingChecks = {
  readonly allObjectivesComplete: MissionCheck
  readonly onTowerPlatform: MissionCheck
  readonly nearFlagpole: MissionCheck
  /** Optional movement hint used to distinguish AVAILABLE from APPROACHING. */
  readonly approachingTower?: MissionCheck
}

export type RestartOptions = boolean | {
  readonly preserveObjectiveProgress?: boolean
  readonly preserveAllObjectives?: boolean
  readonly preserveObjectiveIds?: readonly string[]
  readonly preserveSelectedObjectives?: readonly string[]
}

const LOCATION_BY_ID = new Map(LOCATIONS.map(location => [location.id, location]))

function locationFor(id: string): GatheringLocation | undefined {
  return LOCATION_BY_ID.get(id)
}

function uniqueKnownIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const id of value) {
    if (typeof id === 'string' && LOCATION_BY_ID.has(id) && !result.includes(id)) result.push(id)
  }
  return result
}

function finiteNonNegative(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback
}

function check(value: MissionCheck): boolean {
  return typeof value === 'function' ? value() : value
}

function objectiveCompletion(recruits: Record<string, number>): string[] {
  return LOCATIONS.filter(location => recruits[location.id] >= location.target).map(location => location.id)
}

function isComplete(state: MissionState): boolean {
  return objectiveCompletion(state.recruits).length === TOTAL_OBJECTIVES
}

function accessState(state: MissionState, flagState: FlagState): FlagState {
  if (!isComplete(state)) return 'LOCKED'
  if (flagState === 'LOCKED') return 'AVAILABLE'
  return flagState
}

export function createMissionState(): MissionState {
  return {
    discovered: [],
    completed: [],
    recruits: {},
    elapsed: 0,
    guardsCaught: 0,
    flagState: 'LOCKED',
    hostingElapsed: 0,
    missionComplete: false,
  }
}

export const initialMissionState = createMissionState

/** Returns the nearest configured site whose interaction radius contains the point. */
export function findNearbyLocation(position: Point2D, locations: readonly GatheringLocation[] = LOCATIONS): GatheringLocation | undefined {
  let nearest: GatheringLocation | undefined
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const location of locations) {
    const dx = position.x - location.x
    const dz = position.z - location.z
    const distanceSquared = dx * dx + dz * dz
    if (distanceSquared <= location.radius * location.radius && distanceSquared < nearestDistance) {
      nearest = location
      nearestDistance = distanceSquared
    }
  }
  return nearest
}

export const detectNearbySite = findNearbyLocation

export function discoverLocation(state: MissionState, id: string): MissionState {
  if (!locationFor(id) || state.discovered.includes(id)) return state
  return { ...state, discovered: [...state.discovered, id] }
}

export const revealLocation = discoverLocation

export function discoverNearbyLocation(state: MissionState, position: Point2D): { state: MissionState; location?: GatheringLocation } {
  const location = findNearbyLocation(position)
  return { state: location ? discoverLocation(state, location.id) : state, location }
}

/** Adds friendly recruits only to a revealed, known site and completes it at its configured target. */
export function recruitAtLocation(state: MissionState, id: string, amount = 1): MissionState {
  const location = locationFor(id)
  if (!location || !state.discovered.includes(id) || !Number.isFinite(amount) || amount <= 0) return state
  const recruits = { ...state.recruits, [id]: Math.min(location.target, Math.max(0, state.recruits[id] ?? 0) + Math.floor(amount)) }
  const completed = objectiveCompletion(recruits)
  const next: MissionState = { ...state, recruits, completed, flagState: accessState(state, state.flagState) }
  return completed.length === TOTAL_OBJECTIVES && state.flagState === 'LOCKED' ? { ...next, flagState: 'AVAILABLE' } : next
}

export const incrementFriendlyRecruits = recruitAtLocation
export const gatherFriends = recruitAtLocation

export function getLocationStatus(state: MissionState, id: string): LocationStatus | undefined {
  const location = locationFor(id)
  if (!location) return undefined
  const recruits = Math.min(location.target, Math.max(0, state.recruits[id] ?? 0))
  const progress = location.target === 0 ? 1 : recruits / location.target
  return { id, name: location.name, discovered: state.discovered.includes(id), recruits, target: location.target, remaining: location.target - recruits, progress, percent: Math.round(progress * 100), complete: recruits >= location.target }
}

export const getObjectiveStatus = getLocationStatus

export function getMissionProgress(state: MissionState): MissionProgress {
  const recruits = LOCATIONS.reduce((sum, location) => sum + Math.min(location.target, Math.max(0, state.recruits[location.id] ?? 0)), 0)
  const recruitTarget = LOCATIONS.reduce((sum, location) => sum + location.target, 0)
  const completed = objectiveCompletion(state.recruits).length
  const progress = TOTAL_OBJECTIVES === 0 ? 1 : completed / TOTAL_OBJECTIVES
  return { completed, total: TOTAL_OBJECTIVES, completedObjectives: completed, totalObjectives: TOTAL_OBJECTIVES, recruits, recruitTarget, progress, percent: Math.round(progress * 100), allObjectivesComplete: completed === TOTAL_OBJECTIVES }
}

export const missionProgress = getMissionProgress

export function areAllObjectivesComplete(state: MissionState): boolean {
  return isComplete(state)
}

export const allObjectivesComplete = areAllObjectivesComplete

export function tickMission(state: MissionState, seconds: number): MissionState {
  if (!Number.isFinite(seconds) || seconds <= 0) return state
  return { ...state, elapsed: state.elapsed + seconds, hostingElapsed: state.flagState === 'HOSTING_IN_PROGRESS' ? state.hostingElapsed + seconds : state.hostingElapsed }
}

export function recordGuardCaught(state: MissionState, count = 1): MissionState {
  if (!Number.isFinite(count) || count <= 0) return state
  const flagState = state.flagState === 'HOSTING_IN_PROGRESS' ? 'HOSTING_INTERRUPTED' : state.flagState
  return { ...state, guardsCaught: state.guardsCaught + Math.floor(count), flagState }
}

export const guardCaught = recordGuardCaught

export function canAccessTower(state: MissionState): boolean {
  return isComplete(state)
}

function evaluatedFlagState(state: MissionState, checks: HostingChecks): FlagState {
  if (!check(checks.allObjectivesComplete) || !isComplete(state)) return 'LOCKED'
  if (state.flagState === 'MISSION_COMPLETE' || state.flagState === 'HOSTED') return state.flagState
  if (!check(checks.onTowerPlatform)) return check(checks.approachingTower ?? false) ? 'APPROACHING' : 'AVAILABLE'
  if (!check(checks.nearFlagpole)) return 'APPROACHING'
  return 'READY_TO_HOST'
}

/** Re-evaluates access without starting hosting; all three checks remain caller-owned. */
export function updateFlagState(state: MissionState, checks: HostingChecks): MissionState {
  const flagState = evaluatedFlagState(state, checks)
  if (flagState === state.flagState) return state
  return { ...state, flagState, missionComplete: flagState === 'HOSTED' || flagState === 'MISSION_COMPLETE' }
}

export const evaluateFlagState = updateFlagState

export function canHostFlag(state: MissionState, checks: HostingChecks): boolean {
  return isComplete(state) && check(checks.allObjectivesComplete) && check(checks.onTowerPlatform) && check(checks.nearFlagpole) && state.flagState !== 'HOSTED' && state.flagState !== 'MISSION_COMPLETE'
}

export function startHosting(state: MissionState, checks: HostingChecks): MissionState {
  if (state.flagState === 'HOSTED' || state.flagState === 'MISSION_COMPLETE' || state.flagState === 'HOSTING_IN_PROGRESS') return state
  if (!canHostFlag(state, checks)) return updateFlagState(state, checks)
  return { ...state, flagState: 'HOSTING_IN_PROGRESS', hostingElapsed: 0, missionComplete: false }
}

export const beginHosting = startHosting

/** Movement, detention, or any other caller-owned interruption cancels the active hold. */
export function interruptHosting(state: MissionState): MissionState {
  if (state.flagState !== 'HOSTING_IN_PROGRESS') return state
  return { ...state, flagState: 'HOSTING_INTERRUPTED' }
}

/** Finishes an active hold only while all objective, platform, and flagpole checks still pass. */
export function completeHosting(state: MissionState, checks: HostingChecks): MissionState {
  if (state.flagState === 'HOSTED' || state.flagState === 'MISSION_COMPLETE') return state
  if (state.flagState !== 'HOSTING_IN_PROGRESS') return updateFlagState(state, checks)
  if (!canHostFlag(state, checks) && !(isComplete(state) && check(checks.allObjectivesComplete) && check(checks.onTowerPlatform) && check(checks.nearFlagpole))) return interruptHosting(state)
  return { ...state, flagState: 'HOSTED', missionComplete: true }
}

export const finishHosting = completeHosting

/** Promotes HOSTED to the explicit terminal state; repeated calls are idempotent. */
export function completeMission(state: MissionState): MissionState {
  if (state.flagState === 'MISSION_COMPLETE') return state
  if (state.flagState !== 'HOSTED') return state
  return { ...state, flagState: 'MISSION_COMPLETE', missionComplete: true }
}

export function isMissionComplete(state: MissionState): boolean {
  return state.flagState === 'HOSTED' || state.flagState === 'MISSION_COMPLETE'
}

/** Accepts unknown JSON safely. Completion is derived from capped recruit counts, never trusted from save flags. */
export function normalizeMissionState(input: unknown): MissionState {
  const base = createMissionState()
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base
  const raw = input as Record<string, unknown>
  const recruits: Record<string, number> = {}
  const rawRecruits = raw.recruits
  if (rawRecruits && typeof rawRecruits === 'object' && !Array.isArray(rawRecruits)) {
    for (const location of LOCATIONS) {
      const value = (rawRecruits as Record<string, unknown>)[location.id]
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) recruits[location.id] = Math.min(location.target, Math.floor(value))
    }
  }
  const completed = objectiveCompletion(recruits)
  const allComplete = completed.length === TOTAL_OBJECTIVES
  const rawFlag = raw.flagState
  const requestedFlag = typeof rawFlag === 'string' && FLAG_STATES.includes(rawFlag as FlagState) ? rawFlag as FlagState : 'LOCKED'
  const flagState: FlagState = allComplete ? requestedFlag : 'LOCKED'
  const missionComplete = allComplete && (flagState === 'HOSTED' || flagState === 'MISSION_COMPLETE')
  return {
    discovered: uniqueKnownIds(raw.discovered),
    completed,
    recruits,
    elapsed: finiteNonNegative(raw.elapsed),
    guardsCaught: Math.floor(finiteNonNegative(raw.guardsCaught)),
    flagState,
    hostingElapsed: flagState === 'HOSTING_IN_PROGRESS' ? finiteNonNegative(raw.hostingElapsed) : 0,
    missionComplete,
  }
}

export const validateMissionSave = normalizeMissionState

/** Starts a clean run, optionally preserving only explicitly selected objective progress. */
export function restartMission(state: MissionState, options: RestartOptions = false): MissionState {
  const preserveAll = options === true || (typeof options === 'object' && (options.preserveObjectiveProgress === true || options.preserveAllObjectives === true))
  const selectedValues = typeof options === 'object' ? (options.preserveObjectiveIds ?? options.preserveSelectedObjectives ?? []) : []
  const selected = new Set(preserveAll ? LOCATIONS.map(location => location.id) : uniqueKnownIds(selectedValues))
  const recruits: Record<string, number> = {}
  for (const location of LOCATIONS) {
    if (selected.has(location.id)) {
      const count = Math.min(location.target, Math.max(0, Math.floor(state.recruits[location.id] ?? 0)))
      if (count > 0) recruits[location.id] = count
    }
  }
  const completed = objectiveCompletion(recruits)
  const next: MissionState = { ...createMissionState(), discovered: state.discovered.filter(id => selected.has(id)), recruits, completed }
  return completed.length === TOTAL_OBJECTIVES ? { ...next, flagState: 'AVAILABLE' } : next
}
