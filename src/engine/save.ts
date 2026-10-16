/** Versioned, local-only save. Unknown IDs, corrupt JSON, and impossible mission unlocks fail closed. */
import { FLAG_STATES, normalizeMissionState, type FlagState } from '../game/mission'

export type Locale = 'en' | 'zh-CN'
export type Quality = 'low' | 'medium' | 'high'
export type CameraMode = 'first' | 'third'
export type ScoreEntry = { name: string; score: number; seconds: number; at: number }
export type SaveData = {
  version: 2
  locale: Locale | ''
  musicVolume: number
  sfxVolume: number
  muted: boolean
  sensitivity: number
  invertY: boolean
  quality: Quality
  reducedMotion: boolean
  subtitles: boolean
  tutorialDone: boolean
  playerName: string
  leaderboard: ScoreEntry[]
  completedLocations: string[]
  discoveredLocations: string[]
  recruitCounts: Record<string, number>
  missionElapsed: number
  guardsDetected: number
  flagState: FlagState
  hostingElapsed: number
  missionComplete: boolean
  cameraMode: CameraMode
  currentObjective: string
}
export const SAVE_KEY = 'game3d.save'
export const LEADERBOARD_SIZE = 10

export function defaultSave(): SaveData {
  return {
    version: 2, locale: '', musicVolume: 0.7, sfxVolume: 0.8, muted: false, sensitivity: 1, invertY: false,
    quality: 'high', reducedMotion: false, subtitles: true, tutorialDone: false, playerName: 'PLAYER', leaderboard: [],
    completedLocations: [], discoveredLocations: [], recruitCounts: {}, missionElapsed: 0, guardsDetected: 0,
    flagState: 'LOCKED', hostingElapsed: 0, missionComplete: false, cameraMode: 'third', currentObjective: '',
  }
}
const clamp = (v: unknown, min: number, max: number, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

/** Parse v1 and v2 records, migrate defaults, and run mission data through its authoritative validator. */
export function parseSave(raw: string | null): SaveData {
  const base = defaultSave()
  if (!raw) return base
  let data: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return base
    data = parsed as Record<string, unknown>
  } catch { return base }
  if (data.version !== 1 && data.version !== 2) return base
  const board = Array.isArray(data.leaderboard) ? data.leaderboard : []
  const recruits = data.recruitCounts && typeof data.recruitCounts === 'object' && !Array.isArray(data.recruitCounts) ? data.recruitCounts : {}
  const candidate = normalizeMissionState({
    discovered: data.discoveredLocations,
    completed: data.completedLocations,
    recruits,
    elapsed: data.missionElapsed,
    guardsCaught: data.guardsDetected,
    flagState: FLAG_STATES.includes(data.flagState as FlagState) ? data.flagState : 'LOCKED',
    hostingElapsed: data.hostingElapsed,
    missionComplete: data.missionComplete,
  })
  const currentObjective = typeof data.currentObjective === 'string' && data.currentObjective.length < 80 ? data.currentObjective : ''
  return {
    version: 2,
    locale: data.locale === 'en' || data.locale === 'zh-CN' ? data.locale : '',
    musicVolume: clamp(data.musicVolume, 0, 1, base.musicVolume),
    sfxVolume: clamp(data.sfxVolume, 0, 1, base.sfxVolume),
    muted: data.muted === true,
    sensitivity: clamp(data.sensitivity, 0.2, 3, base.sensitivity),
    invertY: data.invertY === true,
    quality: data.quality === 'low' || data.quality === 'medium' || data.quality === 'high' ? data.quality : base.quality,
    reducedMotion: data.reducedMotion === true,
    subtitles: typeof data.subtitles === 'boolean' ? data.subtitles : base.subtitles,
    tutorialDone: data.tutorialDone === true,
    playerName: typeof data.playerName === 'string' && data.playerName.trim() ? data.playerName.trim().slice(0, 16) : base.playerName,
    leaderboard: board.filter((e): e is ScoreEntry => !!e && typeof e === 'object' && typeof (e as ScoreEntry).name === 'string' && Number.isFinite((e as ScoreEntry).score))
      .map(e => ({ name: e.name.slice(0, 16), score: Math.max(0, Math.floor(e.score)), seconds: Number.isFinite(e.seconds) ? e.seconds : 0, at: Number.isFinite(e.at) ? e.at : 0 })).slice(0, LEADERBOARD_SIZE),
    completedLocations: candidate.completed,
    discoveredLocations: candidate.discovered,
    recruitCounts: candidate.recruits,
    missionElapsed: candidate.elapsed,
    guardsDetected: candidate.guardsCaught,
    flagState: candidate.flagState,
    hostingElapsed: candidate.hostingElapsed,
    missionComplete: candidate.missionComplete,
    cameraMode: data.cameraMode === 'first' || data.cameraMode === 'third' ? data.cameraMode : base.cameraMode,
    currentObjective,
  }
}

export function insertScore(board: ScoreEntry[], entry: ScoreEntry): { board: ScoreEntry[]; rank: number } {
  const next = [...board, entry].sort((a, b) => b.score - a.score || a.seconds - b.seconds || a.at - b.at).slice(0, LEADERBOARD_SIZE)
  return { board: next, rank: next.indexOf(entry) }
}

export class SaveStore {
  data: SaveData
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage) {
    let raw: string | null = null
    try { raw = this.storage?.getItem(SAVE_KEY) ?? null } catch { raw = null }
    this.data = parseSave(raw)
  }
  update(patch: Partial<SaveData>): void {
    try { this.data = parseSave(JSON.stringify({ ...this.data, ...patch, version: 2 })) }
    catch { this.data = { ...this.data, ...patch, version: 2 } }
    try { this.storage?.setItem(SAVE_KEY, JSON.stringify(this.data)) } catch { /* In-memory play continues if storage is denied or full. */ }
  }
  clearMission(): void {
    this.update({ completedLocations: [], discoveredLocations: [], recruitCounts: {}, missionElapsed: 0, guardsDetected: 0, flagState: 'LOCKED', hostingElapsed: 0, missionComplete: false, currentObjective: '' })
  }
}
