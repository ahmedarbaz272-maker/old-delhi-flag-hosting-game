import { CONFIG, DEFAULT_CONFIG } from './config'

type Mode = 'LIVE' | 'NEXT_ACTION' | 'NEXT_RUN'
type Boundary = 'jump' | 'run'
type Control = { id: string; type: 'number'; category: string; label: string; description: string; unit: string; default: number; min: number; max: number; step: number; applyMode: Mode; integrity: 'COSMETIC' | 'GAMEPLAY' }
type Binding = { control: Control; boundary?: Boundary; read(): number; write(value: number): void }
const bindings: Binding[] = []
function number<S extends keyof typeof CONFIG>(section: S, key: keyof typeof CONFIG[S] & string, label: string, min: number, max: number, step: number, unit: string, boundary?: Boundary): void {
  const values = CONFIG[section] as Record<string, number>, defaults = DEFAULT_CONFIG[section] as Record<string, number>
  bindings.push({ control: Object.freeze({ id: `${section}.${key}`, type: 'number', category: section === 'player' ? 'Movement' : section === 'camera' ? 'Camera' : section === 'mission' ? 'Mission' : 'Security', label,
    description: boundary === 'jump' ? 'Applies on the next jump.' : boundary === 'run' ? 'Applies when a new mission run starts.' : 'Updates the active preview immediately.', unit, default: defaults[key], min, max, step,
    applyMode: boundary === 'run' ? 'NEXT_RUN' : boundary ? 'NEXT_ACTION' : 'LIVE', integrity: section === 'camera' ? 'COSMETIC' : 'GAMEPLAY' }), boundary,
    read: () => values[key], write: value => { values[key] = value } })
}
number('player', 'walkSpeed', 'Walking speed', 1, 14, 0.5, 'm/s')
number('player', 'sprintSpeed', 'Sprint speed', 2, 20, 0.5, 'm/s')
number('player', 'crouchSpeed', 'Crouch speed', 1, 8, 0.25, 'm/s')
number('player', 'acceleration', 'Acceleration', 12, 120, 1, '')
number('player', 'airControl', 'Air control', 0, 1, 0.05, '')
number('player', 'jumpSpeed', 'Jump strength', 4, 16, 0.5, 'm/s', 'jump')
number('camera', 'fov', 'Field of view', 40, 100, 1, '°')
number('camera', 'distance', 'Third-person camera distance', 3, 12, 0.1, 'm')
number('camera', 'follow', 'Camera follow speed', 2, 20, 1, '')
number('mission', 'hostDuration', 'Flag-hosting duration', 2, 20, 0.5, 's', 'run')
number('security', 'detectionRadius', 'Security detection radius', 5, 25, 0.5, 'm')

const byId = new Map(bindings.map(binding => [binding.control.id, binding]))
let requested = Object.fromEntries(bindings.map(({ control }) => [control.id, control.default]))
const valid = (values: Record<string, number>) => values['player.walkSpeed'] <= values['player.sprintSpeed'] && values['player.crouchSpeed'] <= values['player.sprintSpeed']
let unranked = false
const gameplayModified = () => bindings.some(binding => binding.control.integrity === 'GAMEPLAY' && binding.read() !== binding.control.default)
export const tuning = {
  get unranked(): boolean { return unranked },
  controls: Object.freeze(bindings.map(binding => binding.control)),
  read() { return { requested: { ...requested }, active: Object.fromEntries(bindings.map(binding => [binding.control.id, binding.read()])) } },
  apply(patch: unknown): void {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid patch')
    const entries = Object.entries(patch)
    if (entries.length > bindings.length) throw new Error('Invalid patch')
    for (const [id, value] of entries) {
      const c = byId.get(id)?.control
      if (!c || typeof value !== 'number' || !Number.isFinite(value) || value < c.min || value > c.max) throw new Error('Invalid value')
      const steps = (value - c.min) / c.step
      if (value !== c.default && Math.abs(steps - Math.round(steps)) > 1e-7) throw new Error('Invalid increment')
    }
    const candidate = { ...requested, ...patch } as Record<string, number>, nextActive = this.read().active
    for (const [id, value] of entries) if (byId.get(id)!.control.applyMode === 'LIVE') nextActive[id] = value
    if (!valid(candidate) || !valid(nextActive)) throw new Error('Crouch and walk speeds must not exceed sprint speed')
    requested = candidate
    for (const [id, value] of entries) { const b = byId.get(id)!; if (b.control.applyMode === 'LIVE') b.write(value) }
    unranked ||= gameplayModified()
  },
  activate(boundary: Boundary): void {
    for (const b of bindings) if (b.boundary === boundary) b.write(requested[b.control.id])
    unranked = boundary === 'run' ? gameplayModified() : unranked || gameplayModified()
  },
}
