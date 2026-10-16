import type { Action, Input } from '../engine/input'

/** Touch controls share the desktop action path and use pointer capture to avoid stuck buttons. */
export class TouchControls {
  private stickId: number | null = null
  private lookId: number | null = null
  private origin = { x: 0, y: 0 }
  private last = { x: 0, y: 0 }
  private readonly stick!: HTMLElement
  private readonly knob!: HTMLElement
  private readonly disposers: Array<() => void> = []
  private readonly radius = 58

  constructor(root: HTMLElement, private readonly input: Input, private readonly active: () => boolean) {
    const layer = root.querySelector<HTMLElement>('.touch')
    if (!layer) return
    this.stick = layer.querySelector<HTMLElement>('.touch-stick')!
    this.knob = this.stick.querySelector<HTMLElement>('i')!
    const on = (target: EventTarget, type: string, fn: EventListener, options?: AddEventListenerOptions) => {
      target.addEventListener(type, fn, options); this.disposers.push(() => target.removeEventListener(type, fn, options))
    }
    const enable = () => document.body.classList.add('has-touch')
    if (matchMedia('(pointer: coarse)').matches) { enable(); this.input.method = 'touch' }
    on(window, 'pointerdown', (e => { if ((e as PointerEvent).pointerType === 'touch') { enable(); this.input.method = 'touch' } }) as EventListener, { capture: true })

    const canvas = document.querySelector<HTMLCanvasElement>('#game')
    if (canvas) on(canvas, 'pointerdown', (event => {
      const e = event as PointerEvent
      if (e.pointerType !== 'touch' || !this.active()) return
      if (e.clientX < window.innerWidth * 0.45 && this.stickId === null) {
        this.stickId = e.pointerId; this.origin = { x: e.clientX, y: e.clientY }
        this.stick.style.left = `${e.clientX}px`; this.stick.style.top = `${e.clientY}px`; this.stick.classList.add('is-active')
      } else if (this.lookId === null) { this.lookId = e.pointerId; this.last = { x: e.clientX, y: e.clientY } }
    }) as EventListener)
    on(window, 'pointermove', (event => {
      const e = event as PointerEvent
      if (e.pointerId === this.stickId) {
        let dx = e.clientX - this.origin.x, dy = e.clientY - this.origin.y
        const len = Math.hypot(dx, dy)
        if (len > this.radius) { dx *= this.radius / len; dy *= this.radius / len }
        this.knob.style.transform = `translate(${dx}px, ${dy}px)`; this.input.setTouchMove(dx / this.radius, -dy / this.radius)
      } else if (e.pointerId === this.lookId) {
        this.input.addTouchLook(e.clientX - this.last.x, e.clientY - this.last.y); this.last = { x: e.clientX, y: e.clientY }
      }
    }) as EventListener)
    const end = (event: Event) => {
      const e = event as PointerEvent
      if (e.pointerId === this.stickId) { this.stickId = null; this.knob.style.transform = ''; this.stick.classList.remove('is-active'); this.input.setTouchMove(0, 0) }
      if (e.pointerId === this.lookId) this.lookId = null
    }
    on(window, 'pointerup', end as EventListener); on(window, 'pointercancel', end as EventListener)
    for (const btn of layer.querySelectorAll<HTMLButtonElement>('[data-touch]')) {
      const action = btn.dataset.touch as Action
      const down = (event: Event) => { event.preventDefault(); btn.setPointerCapture?.((event as PointerEvent).pointerId); btn.classList.add('is-down'); this.input.setTouchButton(action, true) }
      const up = () => { btn.classList.remove('is-down'); this.input.setTouchButton(action, false) }
      on(btn, 'pointerdown', down as EventListener); on(btn, 'pointerup', up as EventListener); on(btn, 'pointercancel', up as EventListener)
      on(btn, 'lostpointercapture', up as EventListener)
    }
  }
  dispose(): void { for (const off of this.disposers) off(); this.disposers.length = 0; this.input.clearHeld() }
}
