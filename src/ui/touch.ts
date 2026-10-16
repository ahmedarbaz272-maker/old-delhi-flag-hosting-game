import type { Action, Input } from '../engine/input'

/** Touch controls share the desktop action path and use pointer capture to avoid stuck buttons. */
export class TouchControls {
  private stickId: number | null = null
  private lookId: number | null = null
  private origin = { x: 0, y: 0 }
  private last = { x: 0, y: 0 }
  private activeRadius = 58
  private readonly stick!: HTMLElement
  private readonly knob!: HTMLElement
  private readonly disposers: Array<() => void> = []

  constructor(root: HTMLElement, private readonly input: Input, private readonly active: () => boolean) {
    const layer = root.querySelector<HTMLElement>('.touch')
    if (!layer) return
    this.stick = layer.querySelector<HTMLElement>('.touch-stick')!
    this.knob = this.stick.querySelector<HTMLElement>('i')!
    const on = (target: EventTarget, type: string, fn: EventListener, options?: AddEventListenerOptions) => {
      target.addEventListener(type, fn, options)
      this.disposers.push(() => target.removeEventListener(type, fn, options))
    }
    const enable = () => document.body.classList.add('has-touch')
    if (matchMedia('(pointer: coarse)').matches) { enable(); this.input.method = 'touch' }
    on(window, 'pointerdown', (event => {
      const e = event as PointerEvent
      if (e.pointerType !== 'mouse') { enable(); this.input.method = 'touch' }
    }) as EventListener, { capture: true })

    const beginStick = (event: PointerEvent, fixed: boolean): void => {
      if (event.pointerType === 'mouse' || !this.active() || this.stickId !== null) return
      event.preventDefault()
      this.stickId = event.pointerId
      if (fixed) {
        const rect = this.stick.getBoundingClientRect()
        this.origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        this.activeRadius = Math.max(34, Math.min(58, Math.min(rect.width, rect.height) * 0.42))
      } else {
        this.origin = { x: event.clientX, y: event.clientY }
        const rect = this.stick.getBoundingClientRect()
        this.stick.style.left = `${event.clientX - rect.width / 2}px`
        this.stick.style.top = `${event.clientY - rect.height / 2}px`
        this.stick.style.bottom = 'auto'
        this.activeRadius = Math.max(34, Math.min(58, Math.min(rect.width, rect.height) * 0.42))
      }
      this.stick.classList.add('is-active')
      try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) } catch { /* Window listeners remain a fallback. */ }
      this.input.setTouchMove(0, 0)
    }

    // The fixed, visible joystick owns its pointer events; it cannot receive events via the canvas.
    on(this.stick, 'pointerdown', (event => beginStick(event as PointerEvent, true)) as EventListener, { passive: false })
    const canvas = document.querySelector<HTMLCanvasElement>('#game')
    if (canvas) on(canvas, 'pointerdown', (event => {
      const e = event as PointerEvent
      if (e.pointerType === 'mouse' || !this.active()) return
      if (e.clientX < window.innerWidth * 0.45 && this.stickId === null) beginStick(e, false)
      else if (this.lookId === null) {
        e.preventDefault()
        this.lookId = e.pointerId
        this.last = { x: e.clientX, y: e.clientY }
        try { canvas.setPointerCapture(e.pointerId) } catch { /* Window listeners remain a fallback. */ }
      }
    }) as EventListener, { passive: false })

    on(window, 'pointermove', (event => {
      const e = event as PointerEvent
      if (e.pointerId === this.stickId) {
        let dx = e.clientX - this.origin.x
        let dy = e.clientY - this.origin.y
        const length = Math.hypot(dx, dy)
        if (length > this.activeRadius) { dx *= this.activeRadius / length; dy *= this.activeRadius / length }
        if (Math.hypot(dx, dy) < 7) { dx = 0; dy = 0 }
        this.knob.style.transform = `translate(${dx}px, ${dy}px)`
        this.input.setTouchMove(dx / this.activeRadius, -dy / this.activeRadius)
      } else if (e.pointerId === this.lookId) {
        this.input.addTouchLook(e.clientX - this.last.x, e.clientY - this.last.y)
        this.last = { x: e.clientX, y: e.clientY }
      }
    }) as EventListener, { passive: false })

    const end = (event: Event): void => {
      const e = event as PointerEvent
      if (e.pointerId === this.stickId) {
        this.stickId = null
        this.knob.style.transform = ''
        this.stick.classList.remove('is-active')
        this.stick.style.left = ''
        this.stick.style.top = ''
        this.stick.style.bottom = ''
        this.input.setTouchMove(0, 0)
      }
      if (e.pointerId === this.lookId) this.lookId = null
    }
    on(window, 'pointerup', end as EventListener)
    on(window, 'pointercancel', end as EventListener)
    on(this.stick, 'lostpointercapture', end as EventListener)

    for (const btn of layer.querySelectorAll<HTMLButtonElement>('[data-touch]')) {
      const action = btn.dataset.touch as Action
      const down = (event: Event): void => {
        event.preventDefault()
        try { btn.setPointerCapture((event as PointerEvent).pointerId) } catch { /* Window listeners remain a fallback. */ }
        btn.classList.add('is-down')
        this.input.setTouchButton(action, true)
      }
      const up = (): void => {
        btn.classList.remove('is-down')
        this.input.setTouchButton(action, false)
      }
      on(btn, 'pointerdown', down as EventListener)
      on(btn, 'pointerup', up as EventListener)
      on(btn, 'pointercancel', up as EventListener)
      on(btn, 'lostpointercapture', up as EventListener)
    }
  }

  dispose(): void {
    for (const off of this.disposers) off()
    this.disposers.length = 0
    this.input.clearHeld()
  }
}
