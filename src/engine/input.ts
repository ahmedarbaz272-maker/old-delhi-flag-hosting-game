/** Unified input: keyboard/mouse, gamepad and touch all feed the same mission action state. */
export type Action = 'jump' | 'sprint' | 'crouch' | 'pause' | 'confirm' | 'back' | 'interact' | 'camera' | 'map'
export type InputMethod = 'keyboard' | 'gamepad' | 'touch'

const KEY_BINDINGS: Record<Action, string[]> = {
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['ControlLeft', 'ControlRight'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'NumpadEnter'],
  back: [],
  interact: ['KeyE'],
  camera: ['KeyC'],
  map: ['KeyM'],
}
const MOVE_KEYS = { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'] }
// Standard mapping: A jump, B camera, X interact, Y map, LB sprint, L3 crouch, Start pause.
const PAD_BINDINGS: Record<Action, number[]> = {
  jump: [0], sprint: [4], crouch: [10], pause: [9], confirm: [0], back: [1], interact: [2], camera: [1], map: [3],
}

export class Input {
  readonly move = { x: 0, y: 0 }
  readonly look = { x: 0, y: 0 }
  method: InputMethod = 'keyboard'
  sensitivity = 1
  invertY = false

  private keys = new Set<string>()
  private held_ = new Set<Action>()
  private pressed_ = new Set<Action>()
  private touchMove = { x: 0, y: 0 }
  private touchButtons = new Set<Action>()
  private padPrev = new Set<Action>()
  private listeners: Array<() => void> = []

  constructor(private readonly canvas: HTMLCanvasElement) {
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts)
      this.listeners.push(() => target.removeEventListener(type, fn as EventListener, opts))
    }
    on(window, 'keydown', e => {
      if (e.repeat) return
      this.keys.add(e.code)
      this.method = 'keyboard'
      for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) if (codes.includes(e.code)) this.pressed_.add(action)
      const typing = (e.target as HTMLElement | null)?.matches?.('input, textarea, select')
      if (!typing && (e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault()
    })
    on(window, 'keyup', e => this.keys.delete(e.code))
    on(window, 'blur', () => this.clearHeld())
    on(window, 'mousedown', e => {
      if (document.pointerLockElement === canvas && e.button === 0) this.pressed_.add('interact')
    })
    on(window, 'mousemove', e => {
      if (document.pointerLockElement !== canvas) return
      this.look.x += e.movementX * 0.0022
      this.look.y += e.movementY * 0.0022
    })
  }

  lockPointer(): void {
    if (this.method !== 'touch' && document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock?.()?.catch?.(() => undefined)
  }
  unlockPointer(): void { if (document.pointerLockElement) document.exitPointerLock() }
  setTouchMove(x: number, y: number): void {
    this.method = 'touch'; this.touchMove.x = x; this.touchMove.y = y
    this.refreshMoveVector()
  }
  addTouchLook(dx: number, dy: number): void { this.method = 'touch'; this.look.x += dx * 0.006; this.look.y += dy * 0.006 }
  setTouchButton(action: Action, down: boolean): void {
    this.method = 'touch'
    if (down && !this.touchButtons.has(action)) this.pressed_.add(action)
    if (down) this.touchButtons.add(action); else this.touchButtons.delete(action)
  }
  update(): void {
    const has = (codes: string[]) => codes.some(code => this.keys.has(code))
    let x = (has(MOVE_KEYS.right) ? 1 : 0) - (has(MOVE_KEYS.left) ? 1 : 0)
    let y = (has(MOVE_KEYS.up) ? 1 : 0) - (has(MOVE_KEYS.down) ? 1 : 0)
    this.held_.clear()
    for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) if (has(codes)) this.held_.add(action)
    for (const action of this.touchButtons) this.held_.add(action)
    if (this.touchMove.x !== 0 || this.touchMove.y !== 0) { x = this.touchMove.x; y = this.touchMove.y }
    const pad = navigator.getGamepads?.().find(p => p && p.connected)
    if (pad) {
      const dead = (v: number) => Math.abs(v) < 0.18 ? 0 : v
      const lx = dead(pad.axes[0] ?? 0), ly = dead(pad.axes[1] ?? 0), rx = dead(pad.axes[2] ?? 0), ry = dead(pad.axes[3] ?? 0)
      const active = lx !== 0 || ly !== 0 || rx !== 0 || ry !== 0 || pad.buttons.some(b => b.pressed)
      if (active) this.method = 'gamepad'
      if (lx !== 0 || ly !== 0) { x = lx; y = -ly }
      this.look.x += rx * 0.045; this.look.y += ry * 0.045
      const now = new Set<Action>()
      for (const [action, buttons] of Object.entries(PAD_BINDINGS) as [Action, number[]][]) if (buttons.some(i => pad.buttons[i]?.pressed)) now.add(action)
      for (const action of now) { this.held_.add(action); if (!this.padPrev.has(action)) this.pressed_.add(action) }
      this.padPrev = now
    }
    this.applyMoveVector(x, y)
  }
  private refreshMoveVector(): void {
    const has = (codes: string[]) => codes.some(code => this.keys.has(code))
    let x = (has(MOVE_KEYS.right) ? 1 : 0) - (has(MOVE_KEYS.left) ? 1 : 0)
    let y = (has(MOVE_KEYS.up) ? 1 : 0) - (has(MOVE_KEYS.down) ? 1 : 0)
    if (this.touchMove.x !== 0 || this.touchMove.y !== 0) { x = this.touchMove.x; y = this.touchMove.y }
    const pad = navigator.getGamepads?.().find(p => p && p.connected)
    if (pad) {
      const dead = (v: number) => Math.abs(v) < 0.18 ? 0 : v
      const lx = dead(pad.axes[0] ?? 0), ly = dead(pad.axes[1] ?? 0)
      if (lx !== 0 || ly !== 0) { x = lx; y = -ly }
    }
    this.applyMoveVector(x, y)
  }
  private applyMoveVector(x: number, y: number): void {
    const len = Math.hypot(x, y)
    this.move.x = len > 1 ? x / len : x; this.move.y = len > 1 ? y / len : y
  }
  held(action: Action): boolean { return this.held_.has(action) }
  pressed(action: Action): boolean { return this.pressed_.has(action) }
  consume(action: Action): boolean { return this.pressed_.delete(action) }
  takeLook(): { x: number; y: number } {
    const out = { x: this.look.x * this.sensitivity, y: this.look.y * this.sensitivity * (this.invertY ? -1 : 1) }
    this.look.x = 0; this.look.y = 0; return out
  }
  endFrame(): void { this.pressed_.clear() }
  clearHeld(): void {
    this.keys.clear(); this.touchButtons.clear(); this.touchMove.x = 0; this.touchMove.y = 0
    this.held_.clear(); this.pressed_.clear(); this.padPrev.clear(); this.look.x = 0; this.look.y = 0
    this.move.x = 0; this.move.y = 0
  }
  dispose(): void { for (const off of this.listeners) off(); this.listeners = [] }
}
