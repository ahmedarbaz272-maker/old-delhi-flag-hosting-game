import type { Audio } from '../engine/audio'
import type { I18n } from '../engine/i18n'
import type { Input } from '../engine/input'
import type { Quality, SaveData, SaveStore } from '../engine/save'
import { FINAL_DESTINATION, LOCATIONS } from '../game/mission'

export type Screen = 'boot' | 'title' | 'more' | 'briefing' | 'confirm-new' | 'hud' | 'pause' | 'settings' | 'map' | 'controls' | 'progress' | 'about' | 'privacy' | 'credits' | 'accessibility' | 'failure' | 'victory'
export type MissionHud = {
  completed: number
  discovered: number
  total: number
  objective: string
  district: string
  playerState: string
  securityState: string
  prompt: string
  distance: number | null
  bearing: number | null
  detection: number
  hostingProgress: number
  hosting: boolean
  cameraMode: 'first' | 'third'
  playerX: number
  playerZ: number
  targetX: number
  targetZ: number
  targetId: string
  completedIds: string[]
  discoveredIds: string[]
  recruitCounts: Record<string, number>
}
export type MissionStats = { completed: number; elapsed: number; guardsDetected: number; followers: number; reason?: string }
export type UiActions = {
  play(): void
  continueMission(): void
  beginMission(): void
  resume(): void
  restart(): void
  restartFull(): void
  quit(): void
  openMap(): void
  closeMap(): void
  navigate(siteId: string): void
  settings(patch: Partial<SaveData>): void
  retryAssets(): void
}

type MapPoint = { x: number; y: number }
const ICON = {
  flag: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M13 56V8m3 5c13-10 24 10 37 0v22c-13 10-24-10-37 0" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="5" height="16" rx="1.5" fill="currentColor"/><rect x="14" y="4" width="5" height="16" rx="1.5" fill="currentColor"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 20 20 12 15 4 20Z" fill="currentColor"/></svg>',
}

/** Accessible HTML/CSS screens over WebGL; dynamic player data is always inserted with textContent. */
export class Ui {
  screen: Screen = 'boot'
  private readonly root: HTMLElement
  private readonly stack: Screen[] = []
  private readonly listeners: Array<() => void> = []
  private readonly unlistenI18n: () => void
  private hud?: MissionHud
  private mapFocusId = ''
  private routeOverride = ''
  private pendingReset: 'begin' | 'restart' = 'begin'
  private navRepeat = 0
  private lastMethod = ''
  private mapZoom = 1
  private mapPan = { x: 0, y: 0 }
  private readonly mapPointers = new Map<number, MapPoint>()
  private mapPinchDistance = 0
  private hurtTimer = 0

  constructor(private readonly i18n: I18n, private readonly save: SaveStore, private readonly audio: Audio, private readonly input: Input, private readonly actions: UiActions) {
    this.root = document.getElementById('ui')!
    this.root.innerHTML = this.template()
    this.root.insertAdjacentHTML('beforeend', `<section class="screen screen-modal screen-confirm-new" data-screen="confirm-new"><div class="modal"><h2 class="modal-title" data-i18n="confirm.newTitle"></h2><p data-i18n="confirm.newBody"></p><nav class="menu"><button type="button" data-nav class="btn btn-primary" data-action="confirm-new-mission"><span data-i18n="confirm.start"></span></button><button type="button" data-nav class="btn" data-action="cancel-new-mission"><span data-i18n="confirm.cancel"></span></button></nav></div></section>`)
    this.on(this.root, 'click', e => this.onClick(e as MouseEvent))
    this.on(this.root, 'input', e => this.onInput(e as Event))
    this.on(this.root, 'focusin', e => { if ((e.target as HTMLElement).matches('.btn, .seg button, .toggle, .map-marker')) this.audio.play('ui') })
    this.on(window, 'keydown', e => this.onKey(e as KeyboardEvent))
    this.unlistenI18n = i18n.onChange(() => this.translate())
    this.installMapGestures()
    this.translate()
    this.refreshSettings()
    this.refreshTitle()
  }

  show(screen: Screen): void { this.stack.length = 0; this.setScreen(screen) }
  push(screen: Screen): void { this.stack.push(this.screen); this.setScreen(screen) }
  back(): void {
    if (this.screen === 'map') { this.actions.closeMap(); return }
    const previous = this.stack.pop()
    if (previous) this.setScreen(previous)
    else if (this.screen === 'pause') this.actions.resume()
    else this.setScreen('title')
  }

  private setScreen(screen: Screen): void {
    this.screen = screen
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-screen]')) {
      const active = el.dataset.screen === screen || (el.dataset.screen === 'hud' && ['pause', 'map', 'failure', 'victory', 'settings'].includes(screen))
      el.classList.toggle('is-active', active)
      el.setAttribute('aria-hidden', String(!active))
    }
    this.root.dataset.activeScreen = screen
    if (screen === 'map') this.renderMap()
    if (screen === 'progress') this.renderProgress()
    if (screen === 'title') this.refreshTitle()
    requestAnimationFrame(() => {
      const first = this.navItems()[0]
      if (first && this.input.method !== 'touch') first.focus({ preventScroll: true })
      else (document.activeElement as HTMLElement | null)?.blur?.()
    })
  }

  setBootProgress(progress: number): void {
    const bar = this.q<HTMLElement>('.boot-bar i')
    if (bar) bar.style.transform = `scaleX(${Math.max(0.04, Math.min(1, progress))})`
  }
  showBootError(message: string): void {
    this.text('.boot-label', this.i18n.t('boot.failed'))
    const error = this.q<HTMLElement>('.boot-error')
    error.textContent = message
    error.hidden = false
    this.q('.boot-retry').hidden = false
    this.setBootProgress(0.04)
    this.show('boot')
  }
  clearBootError(): void {
    this.q('.boot-error').hidden = true
    this.q('.boot-retry').hidden = true
    this.text('.boot-label', this.i18n.t('boot.loading'))
    this.setBootProgress(0.08)
  }

  updateHud(hud: MissionHud): void {
    this.hud = hud
    if (this.routeOverride && (hud.completedIds.includes(this.routeOverride) || (this.routeOverride === 'flag-hosting-tower' && hud.completed < hud.total))) this.routeOverride = ''
    if (!this.routeOverride) this.routeOverride = hud.targetId
    this.text('.hud-progress', `${hud.completed} / ${hud.total}`)
    this.text('.hud-discovered', `${hud.discovered} ${this.i18n.t('hud.discovered')}`)
    this.text('.hud-objective', hud.objective)
    this.text('.hud-district', hud.district)
    this.text('.hud-player-state', hud.playerState)
    this.text('.hud-security-state', this.i18n.t(`security.${hud.securityState}`))
    this.text('.interaction-prompt', hud.prompt)
    this.text('.hud-distance', hud.distance === null ? '—' : `${Math.round(hud.distance)} m`)
    this.root.dataset.cameraMode = hud.cameraMode
    const arrow = this.q<HTMLElement>('.hud-compass-arrow')
    if (arrow && hud.bearing !== null) arrow.style.transform = `rotate(${hud.bearing}rad)`
    const signal = this.q<HTMLElement>('.detection-meter i')
    if (signal) signal.style.transform = `scaleX(${Math.max(0, Math.min(1, hud.detection))})`
    const meter = this.q<HTMLElement>('.detection-meter')
    meter.classList.toggle('is-alert', hud.detection > 0.5)
    meter.setAttribute('aria-valuenow', String(Math.round(hud.detection * 100)))
    const bar = this.q<HTMLElement>('.host-progress i')
    if (bar) bar.style.transform = `scaleX(${Math.max(0, Math.min(1, hud.hostingProgress))})`
    const host = this.q<HTMLElement>('.host-progress')
    host.classList.toggle('is-active', hud.hosting)
    this.text('.host-progress-label', hud.hosting ? this.i18n.t('hud.hosting') : '')
    this.updateMinimap(hud)
  }

  popup(text: string): void {
    const el = this.q<HTMLElement>('.mission-toast')
    el.textContent = text
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show')
  }
  hurt(): void {
    this.root.classList.add('detected-flash')
    window.clearTimeout(this.hurtTimer)
    this.hurtTimer = window.setTimeout(() => this.root.classList.remove('detected-flash'), 450)
  }
  openMap(): void { this.push('map'); this.renderMap() }
  showFailure(stats: MissionStats): void {
    this.text('.failure-reason', stats.reason || this.i18n.t('failure.reason'))
    this.text('.failure-progress', `${stats.completed} / 16`)
    this.text('.failure-followers', String(stats.followers))
    this.text('.failure-time', formatTime(stats.elapsed))
    this.text('.failure-guards', String(stats.guardsDetected))
    this.show('failure')
  }
  showVictory(stats: MissionStats): void {
    this.text('.victory-progress', `${stats.completed} / 16`)
    this.text('.victory-followers', String(stats.followers))
    this.text('.victory-guards', String(stats.guardsDetected))
    this.text('.victory-time', formatTime(stats.elapsed))
    this.show('victory')
  }
  refreshSettings(): void {
    const d = this.save.data
    for (const key of ['musicVolume', 'sfxVolume', 'sensitivity'] as const) {
      const input = this.q<HTMLInputElement>(`[name="${key}"]`)
      if (input) { input.value = String(d[key]); this.setRange(input) }
    }
    for (const key of ['muted', 'invertY', 'reducedMotion', 'subtitles'] as const) {
      const toggle = this.q<HTMLButtonElement>(`.toggle[data-setting="${key}"]`)
      if (toggle) {
        const on = d[key] === true
        toggle.setAttribute('aria-pressed', String(on))
        const label = toggle.querySelector('span')
        if (label) label.textContent = this.i18n.t(on ? 'settings.on' : 'settings.off')
      }
    }
    for (const button of this.qa<HTMLButtonElement>('.seg button')) {
      const key = button.parentElement?.dataset.setting
      const current = key === 'quality' ? d.quality : key === 'locale' ? this.i18n.locale : ''
      button.setAttribute('aria-pressed', String(button.dataset.value === current))
    }
  }
  refreshTitle(): void {
    const count = this.save.data.completedLocations.length
    const hasProgress = count > 0 || this.save.data.discoveredLocations.length > 0 || Object.keys(this.save.data.recruitCounts).length > 0
    this.text('.title-progress', hasProgress ? this.i18n.t('menu.progress', { count }) : this.i18n.t('menu.newMission'))
    const progressButton = this.q<HTMLSpanElement>('[data-action="progress"] span')
    if (progressButton) progressButton.textContent = this.i18n.t('menu.progressButton')
    this.q<HTMLButtonElement>('[data-action="continue"]').classList.toggle('is-hidden', !hasProgress)
  }
  frame(frameSeconds: number): void {
    if (this.input.method !== this.lastMethod) { this.lastMethod = this.input.method; this.renderPrompts() }
    if (this.screen === 'hud' || this.screen === 'boot') return
    if (this.input.method !== 'gamepad') { this.input.consume('confirm'); this.input.consume('back'); return }
    const y = this.input.move.y, x = this.input.move.x
    this.navRepeat = Math.max(0, this.navRepeat - frameSeconds)
    const active = document.activeElement as HTMLElement | null
    if (Math.abs(y) > 0.6 && this.navRepeat <= 0) { this.moveFocus(y < 0 ? 1 : -1); this.navRepeat = 0.22 }
    else if (Math.abs(x) > 0.6 && this.navRepeat <= 0 && active?.matches('input[type="range"]')) {
      const r = active as HTMLInputElement
      r.value = String(Number(r.value) + Math.sign(x) * Number(r.step || 0.1))
      r.dispatchEvent(new Event('input', { bubbles: true })); this.navRepeat = 0.12
    } else if (Math.abs(y) < 0.3 && Math.abs(x) < 0.3) this.navRepeat = 0
    if (this.input.consume('confirm')) active?.click()
    if (this.input.consume('back') && this.screen !== 'title') this.back()
  }
  dispose(): void {
    for (const off of this.listeners) off()
    this.listeners.length = 0
    this.unlistenI18n()
    window.clearTimeout(this.hurtTimer)
  }

  private installMapGestures(): void {
    const frame = this.q<HTMLElement>('.map-frame')
    this.on(frame, 'wheel', event => {
      const e = event as WheelEvent
      if (this.screen !== 'map') return
      e.preventDefault(); this.zoomMap(e.deltaY < 0 ? 1.12 : 0.89)
    }, { passive: false })
    this.on(frame, 'pointerdown', event => {
      const e = event as PointerEvent
      if (this.screen !== 'map' || (e.target as HTMLElement).closest('.map-marker')) return
      frame.setPointerCapture(e.pointerId)
      this.mapPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (this.mapPointers.size >= 2) this.mapPinchDistance = pointerDistance([...this.mapPointers.values()])
    })
    this.on(frame, 'pointermove', event => {
      const e = event as PointerEvent
      const previous = this.mapPointers.get(e.pointerId)
      if (!previous) return
      const dx = e.clientX - previous.x, dy = e.clientY - previous.y
      if (this.mapPointers.size === 1) { this.mapPan.x += dx; this.mapPan.y += dy }
      this.mapPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (this.mapPointers.size >= 2) {
        const next = pointerDistance([...this.mapPointers.values()])
        if (this.mapPinchDistance > 0) this.zoomMap(next / this.mapPinchDistance)
        this.mapPinchDistance = next
      } else this.applyMapTransform()
    })
    const end = (event: Event) => {
      this.mapPointers.delete((event as PointerEvent).pointerId)
      this.mapPinchDistance = this.mapPointers.size >= 2 ? pointerDistance([...this.mapPointers.values()]) : 0
    }
    this.on(frame, 'pointerup', end); this.on(frame, 'pointercancel', end); this.on(frame, 'lostpointercapture', end)
  }
  private zoomMap(factor: number): void {
    this.mapZoom = Math.max(0.72, Math.min(2.4, this.mapZoom * factor))
    this.applyMapTransform()
  }
  private applyMapTransform(): void {
    const transform = `translate(${this.mapPan.x}px, ${this.mapPan.y}px) scale(${this.mapZoom})`
    for (const el of [this.q<HTMLElement>('.map-plane'), this.q<HTMLElement>('.map-roads')]) el.style.transform = transform
  }

  private onClick(e: MouseEvent): void {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action], .toggle, .seg button, [data-site]')
    if (!target) return
    this.audio.unlock()
    if (target.hasAttribute('data-site')) {
      const id = target.dataset.site!
      this.mapFocusId = id; this.routeOverride = id
      this.actions.navigate(id); this.renderMap(); return
    }
    if (target.matches('.toggle')) {
      const key = target.dataset.setting as 'muted' | 'invertY' | 'reducedMotion' | 'subtitles'
      this.actions.settings({ [key]: !this.save.data[key] }); this.refreshSettings(); this.audio.play('ui'); return
    }
    if (target.matches('.seg button')) {
      const key = target.parentElement?.dataset.setting
      if (key === 'quality') this.actions.settings({ quality: target.dataset.value as Quality })
      if (key === 'locale') this.actions.settings({ locale: target.dataset.value as SaveData['locale'] })
      this.refreshSettings(); this.audio.play('ui'); return
    }
    switch (target.dataset.action) {
      case 'play': this.actions.play(); break
      case 'continue': this.actions.continueMission(); break
      case 'begin-mission':
        if (this.hasMissionProgress()) { this.pendingReset = 'begin'; this.push('confirm-new') }
        else this.actions.beginMission()
        break
      case 'confirm-new-mission':
        if (this.pendingReset === 'restart') this.actions.restartFull()
        else this.actions.beginMission()
        break
      case 'cancel-new-mission': this.back(); break
      case 'resume': this.actions.resume(); break
      case 'restart': this.actions.restart(); break
      case 'restart-full':
        if (this.hasMissionProgress()) { this.pendingReset = 'restart'; this.push('confirm-new') }
        else this.actions.restartFull()
        break
      case 'quit': case 'main-menu': this.actions.quit(); break
      case 'settings': this.push('settings'); this.refreshSettings(); break
      case 'controls': this.push('controls'); break
      case 'progress': this.push('progress'); break
      case 'more': this.push('more'); break
      case 'about': this.push('about'); break
      case 'privacy': this.push('privacy'); break
      case 'credits': this.push('credits'); break
      case 'accessibility': this.push('accessibility'); break
      case 'map': this.actions.openMap(); break
      case 'close-map': this.actions.closeMap(); break
      case 'map-zoom-in': this.zoomMap(1.2); break
      case 'map-zoom-out': this.zoomMap(0.83); break
      case 'back': this.back(); break
      case 'pause': window.dispatchEvent(new CustomEvent('game:pause')); break
      case 'retry-assets': this.actions.retryAssets(); break
    }
  }
  private onInput(e: Event): void {
    const el = e.target as HTMLInputElement
    if (el.type !== 'range') return
    this.setRange(el); this.actions.settings({ [el.name]: Number(el.value) } as Partial<SaveData>)
  }
  private setRange(el: HTMLInputElement): void {
    const min = Number(el.min), max = Number(el.max), value = Number(el.value)
    el.style.setProperty('--fill', `${((value - min) / (max - min)) * 100}%`)
  }
  private onKey(e: KeyboardEvent): void {
    if (this.screen === 'hud' || this.screen === 'boot') return
    const typing = (e.target as HTMLElement).matches?.('input[type="text"]')
    if ((e.code === 'Escape' || (e.code === 'Backspace' && !typing)) && !['title', 'pause', 'failure', 'victory'].includes(this.screen)) {
      e.preventDefault(); this.input.consume('pause'); this.back(); return
    }
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') { e.preventDefault(); this.moveFocus(e.code === 'ArrowDown' ? 1 : -1) }
  }
  private navItems(): HTMLElement[] {
    const screen = this.q(`[data-screen="${this.screen}"]`)
    return [...screen.querySelectorAll<HTMLElement>('[data-nav]')].filter(el => el.offsetParent !== null && !el.closest('.is-hidden'))
  }
  private moveFocus(dir: 1 | -1): void {
    const items = this.navItems(); if (!items.length) return
    const i = items.indexOf(document.activeElement as HTMLElement)
    items[(i + dir + items.length) % items.length].focus()
  }

  private renderMap(): void {
    const plane = this.q<HTMLElement>('.map-plane')
    if (!plane || !this.hud) return
    plane.replaceChildren()
    const xs = [...LOCATIONS.map(site => site.x), FINAL_DESTINATION.x], zs = [...LOCATIONS.map(site => site.z), FINAL_DESTINATION.z]
    const minX = Math.min(...xs) - 18, maxX = Math.max(...xs) + 18
    const minZ = Math.min(...zs) - 20, maxZ = Math.max(...zs) + 20
    const px = (x: number) => ((x - minX) / (maxX - minX)) * 100
    const py = (z: number) => ((maxZ - z) / (maxZ - minZ)) * 100
    const targetId = this.routeOverride || this.hud.targetId
    const routeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    routeSvg.setAttribute('viewBox', '0 0 1000 600'); routeSvg.setAttribute('preserveAspectRatio', 'none'); routeSvg.classList.add('map-route')
    const routeLine = document.createElementNS(routeSvg.namespaceURI, 'line')
    routeLine.setAttribute('x1', String(px(this.hud.playerX) * 10)); routeLine.setAttribute('y1', String(py(this.hud.playerZ) * 6))
    const target = targetId === 'flag-hosting-tower' ? FINAL_DESTINATION : LOCATIONS.find(site => site.id === targetId)
    if (target) {
      routeLine.setAttribute('x2', String(px(target.x) * 10)); routeLine.setAttribute('y2', String(py(target.z) * 6))
      routeLine.classList.add('route-line'); routeSvg.append(routeLine); plane.append(routeSvg)
    }
    for (const [index, site] of LOCATIONS.entries()) {
      const complete = this.hud.completedIds.includes(site.id)
      const discovered = this.hud.discoveredIds.includes(site.id)
      const count = this.hud.recruitCounts[site.id] ?? 0
      const state = complete ? 'complete' : count > 0 ? 'in-progress' : discovered ? 'discovered' : 'unknown'
      const button = document.createElement('button')
      button.type = 'button'; button.className = 'map-marker'; button.dataset.site = site.id; button.dataset.state = state
      button.style.left = `${px(site.x)}%`; button.style.top = `${py(site.z)}%`
      if (site.id === targetId || site.id === this.mapFocusId) button.classList.add('is-selected')
      const stateLabel = this.i18n.t(state === 'complete' ? 'map.complete' : state === 'in-progress' ? 'map.inProgress' : state === 'discovered' ? 'map.discovered' : 'map.undiscovered')
      button.setAttribute('aria-label', `${index + 1}. ${site.name}: ${stateLabel}`)
      button.textContent = complete ? '✓' : state === 'in-progress' ? '●' : discovered ? String(index + 1) : '?'
      plane.append(button)
    }
    const final = document.createElement('button')
    final.type = 'button'; final.className = 'map-final'; final.dataset.site = 'flag-hosting-tower'
    final.dataset.state = this.hud.completed === this.hud.total ? 'available' : 'locked'
    final.style.left = `${px(FINAL_DESTINATION.x)}%`; final.style.top = `${py(FINAL_DESTINATION.z)}%`
    final.textContent = this.i18n.t('map.flagZone')
    final.setAttribute('aria-label', `${this.i18n.t('map.flagZone')}: ${this.i18n.t(this.hud.completed === this.hud.total ? 'map.available' : 'map.locked')}`)
    if (targetId === 'flag-hosting-tower') final.classList.add('is-selected')
    plane.append(final)
    const player = document.createElement('i')
    player.className = 'map-player'
    player.setAttribute('aria-label', this.i18n.t('map.player'))
    plane.append(player)
    player.style.left = `${px(this.hud.playerX)}%`; player.style.top = `${py(this.hud.playerZ)}%`
    this.text('.map-count', `${this.hud.completed} / ${this.hud.total} ${this.i18n.t('map.objectives')}`)
    const routeName = targetId === FINAL_DESTINATION.id ? this.i18n.t('map.flagZone') : LOCATIONS.find(site => site.id === targetId)?.name ?? this.i18n.t('hud.explore')
    const modal = plane.closest<HTMLElement>('.modal-map')
    let routeLabel = modal?.querySelector<HTMLElement>('.map-route-label')
    if (!routeLabel && modal) {
      routeLabel = document.createElement('div')
      routeLabel.className = 'map-route-label'
      this.q('.map-legend').before(routeLabel)
    }
    if (routeLabel) routeLabel.textContent = `${this.i18n.t('map.route')}: ${routeName}`
    this.applyMapTransform()
  }
  private renderProgress(): void {
    const list = this.q<HTMLOListElement>('.progress-list')
    list.replaceChildren()
    for (const [index, site] of LOCATIONS.entries()) {
      const complete = this.save.data.completedLocations.includes(site.id)
      const discovered = this.save.data.discoveredLocations.includes(site.id)
      const count = this.save.data.recruitCounts[site.id] ?? 0
      const state = complete ? 'complete' : count > 0 ? 'inProgress' : discovered ? 'discovered' : 'unknown'
      const li = document.createElement('li'); li.dataset.state = state
      const number = document.createElement('b'); number.textContent = String(index + 1).padStart(2, '0')
      const name = document.createElement('span'); name.textContent = site.name
      const status = document.createElement('span'); status.textContent = this.i18n.t(`progress.${state}`)
      li.append(number, name, status); list.append(li)
    }
    const all = document.createElement('li'); all.className = 'progress-final'
    const star = document.createElement('b'); star.textContent = '★'
    const flagLabel = document.createElement('span'); flagLabel.textContent = this.i18n.t('map.flagZone')
    const finalState = document.createElement('span'); finalState.textContent = this.save.data.completedLocations.length === LOCATIONS.length ? this.i18n.t('progress.complete') : this.i18n.t('progress.unknown')
    all.append(star, flagLabel, finalState)
    list.append(all)
    this.text('.progress-count', `${this.save.data.completedLocations.length} / ${LOCATIONS.length}`)
  }
  private updateMinimap(hud: MissionHud): void {
    const marker = this.q<HTMLElement>('.minimap-player')
    marker.style.left = `${THREE_PERCENT(hud.playerX, -54, 54)}%`
    marker.style.top = `${THREE_PERCENT(hud.playerZ, 92, -60)}%`
  }
  private hasMissionProgress(): boolean {
    return this.save.data.completedLocations.length > 0 || this.save.data.discoveredLocations.length > 0 || Object.keys(this.save.data.recruitCounts).length > 0
  }
  private renderPrompts(): void {
    const el = this.q<HTMLElement>('.controls-inline')
    if (el) el.textContent = this.input.method === 'touch' ? this.i18n.t('prompt.touch') : this.i18n.t('prompt.desktop')
  }
  private translate(): void {
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = this.i18n.t(el.dataset.i18n!)
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-i18n-label]')) el.setAttribute('aria-label', this.i18n.t(el.dataset.i18nLabel!))
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) el.setAttribute('placeholder', this.i18n.t(el.dataset.i18nPlaceholder!))
    this.renderPrompts(); document.title = this.i18n.t('game.fullTitle')
    if (this.hud) this.updateHud(this.hud)
    if (this.screen === 'map') this.renderMap()
    if (this.screen === 'progress') this.renderProgress()
    this.refreshTitle()
  }
  private text(selector: string, value: string): void { const el = this.q<HTMLElement>(selector); if (el) el.textContent = value }
  private q<T extends HTMLElement = HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)! }
  private qa<T extends HTMLElement = HTMLElement>(selector: string): T[] { return [...this.root.querySelectorAll<T>(selector)] }
  private on(target: EventTarget, type: string, fn: EventListener, options?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, options)
    this.listeners.push(() => target.removeEventListener(type, fn, options))
  }

  private template(): string {
    const range = (name: string, key: string, min: number, max: number, step: number) => `<label class="row"><span data-i18n="${key}"></span><input data-nav type="range" name="${name}" min="${min}" max="${max}" step="${step}"></label>`
    const toggle = (name: string, key: string) => `<div class="row"><span data-i18n="${key}"></span><button data-nav class="toggle" data-setting="${name}" aria-pressed="false"><i></i><span></span></button></div>`
    const btn = (action: string, key: string, primary = false) => `<button type="button" data-nav class="btn ${primary ? 'btn-primary' : ''}" data-action="${action}"><span data-i18n="${key}"></span></button>`
    return `
<section class="screen screen-boot is-active" data-screen="boot"><div class="boot-logo" data-i18n="game.title"></div><div class="boot-bar"><i></i></div><div class="boot-label" data-i18n="boot.loading"></div><pre class="boot-error" hidden></pre><button class="btn btn-primary boot-retry" data-action="retry-assets" data-nav hidden><span data-i18n="boot.retry"></span></button></section>
<section class="screen screen-title" data-screen="title"><div class="title-vignette"></div><div class="title-block"><div class="logo"><span class="logo-gem">${ICON.flag}</span><div><h1 class="logo-text" data-i18n="game.title"></h1><div class="logo-subtitle" data-i18n="game.subtitle"></div></div></div><p class="tagline" data-i18n="game.tagline"></p><p class="title-progress"></p><nav class="menu">${btn('play','menu.play',true)}${btn('continue','menu.continue')}${btn('progress','menu.progress')}${btn('more','menu.more')}</nav></div><footer class="bottom-bar"><div class="controls-inline"></div><small data-i18n="credits.fonts"></small></footer></section>
<section class="screen screen-modal screen-more" data-screen="more"><div class="modal"><h2 class="modal-title" data-i18n="menu.more"></h2><nav class="menu">${btn('controls','menu.controls')}${btn('settings','menu.settings')}${btn('accessibility','menu.accessibility')}${btn('about','menu.about')}${btn('privacy','menu.privacy')}${btn('credits','menu.credits')}${btn('back','menu.back')}</nav></div></section>
<section class="screen screen-modal screen-briefing" data-screen="briefing"><div class="modal modal-wide"><h2 class="modal-title" data-i18n="briefing.title"></h2><p class="briefing-copy" data-i18n="briefing.body"></p><div class="briefing-goal"><span class="goal-number">16</span><span data-i18n="briefing.goal"></span></div><nav class="menu menu-row">${btn('begin-mission','briefing.start',true)}${btn('back','menu.back')}</nav></div></section>
<section class="screen screen-hud" data-screen="hud"><div class="hud-top-left"><div class="hud-panel"><span data-i18n="hud.locations"></span><b class="hud-progress">0 / 16</b></div><div class="hud-discovered"></div></div><div class="hud-top-center"><div class="hud-district"></div><div class="hud-objective"></div><div class="hud-player-state"></div></div><div class="hud-top-right"><div class="hud-compass"><span class="hud-compass-arrow">${ICON.arrow}</span><b class="hud-distance">—</b></div><div class="detection-meter" role="meter" aria-label="Security awareness" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i><span data-i18n="hud.awareness"></span><b class="hud-security-state"></b></div><button class="hud-pause" data-action="pause" data-i18n-label="touch.pause">${ICON.pause}</button></div><div class="host-progress"><span class="host-progress-label"></span><div><i></i></div></div><div class="interaction-prompt" aria-live="polite"></div><div class="mission-toast" role="status" aria-live="polite"></div><div class="reticle" aria-hidden="true"></div><div class="minimap" aria-hidden="true"><div class="minimap-roads"></div><i class="minimap-player"></i></div><div class="orientation-warning" data-i18n="mobile.landscape"></div><div class="touch"><div class="touch-stick"><i></i></div><div class="touch-actions"><button class="touch-btn touch-sprint" data-touch="sprint"><span data-i18n="touch.sprint"></span></button><button class="touch-btn touch-crouch" data-touch="crouch"><span data-i18n="touch.crouch"></span></button><button class="touch-btn touch-jump" data-touch="jump"><span data-i18n="touch.jump"></span></button><button class="touch-btn touch-interact" data-touch="interact"><span data-i18n="touch.interact"></span></button><button class="touch-btn touch-camera" data-touch="camera"><span data-i18n="touch.camera"></span></button><button class="touch-btn touch-map" data-touch="map"><span data-i18n="touch.map"></span></button><button class="touch-btn touch-pause" data-touch="pause"><span data-i18n="touch.pause"></span></button></div></div></section>
<section class="screen screen-modal screen-pause" data-screen="pause"><div class="modal"><h2 class="modal-title" data-i18n="pause.title"></h2><nav class="menu">${btn('resume','menu.resume',true)}${btn('restart','menu.restart')}${btn('restart-full','menu.restartFull')}${btn('settings','menu.settings')}${btn('quit','menu.mainMenu')}</nav></div></section>
<section class="screen screen-modal screen-settings" data-screen="settings"><div class="modal modal-wide"><h2 class="modal-title" data-i18n="settings.title"></h2><div class="settings-grid"><fieldset><legend data-i18n="settings.audio"></legend>${range('musicVolume','settings.music',0,1,0.05)}${range('sfxVolume','settings.sfx',0,1,0.05)}${toggle('muted','settings.mute')}</fieldset><fieldset><legend data-i18n="settings.controls"></legend>${range('sensitivity','settings.sensitivity',0.2,3,0.1)}${toggle('invertY','settings.invertY')}</fieldset><fieldset><legend data-i18n="settings.display"></legend><div class="row"><span data-i18n="settings.quality"></span><div class="seg" data-setting="quality"><button data-nav data-value="low" data-i18n="settings.quality.low"></button><button data-nav data-value="medium" data-i18n="settings.quality.medium"></button><button data-nav data-value="high" data-i18n="settings.quality.high"></button></div></div>${toggle('reducedMotion','settings.reducedMotion')}${toggle('subtitles','settings.subtitles')}<div class="row"><span data-i18n="settings.language"></span><div class="seg" data-setting="locale"><button data-nav data-value="en" lang="en">English</button><button data-nav data-value="zh-CN" lang="zh-CN">简体中文</button></div></div></fieldset></div><nav class="menu menu-row">${btn('back','menu.back')}</nav></div></section>
<section class="screen screen-modal screen-map" data-screen="map"><div class="modal modal-map"><div class="map-heading"><h2 class="modal-title" data-i18n="map.title"></h2><div class="map-count">0 / 16</div></div><div class="map-frame" role="region" aria-label="Interactive city map"><div class="map-roads"></div><div class="map-plane"><i class="map-player"></i></div></div><div class="map-legend"><span class="legend-player" data-i18n="map.player"></span><span class="legend-unknown" data-i18n="map.undiscovered"></span><span class="legend-active" data-i18n="map.discovered"></span><span class="legend-progress" data-i18n="map.inProgress"></span><span class="legend-complete" data-i18n="map.complete"></span></div><div class="map-controls"><button data-nav class="map-zoom" data-action="map-zoom-in" data-i18n-label="map.zoomIn">+</button><button data-nav class="map-zoom" data-action="map-zoom-out" data-i18n-label="map.zoomOut">−</button></div><nav class="menu menu-row">${btn('close-map','map.close',true)}</nav><footer class="map-help" data-i18n="map.help"></footer></div></section>
<section class="screen screen-modal screen-controls" data-screen="controls"><div class="modal modal-wide"><h2 class="modal-title" data-i18n="controls.title"></h2><div class="controls-grid"><p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span data-i18n="controls.move"></span></p><p><kbd>Mouse</kbd><span data-i18n="controls.look"></span></p><p><kbd>Shift</kbd><span data-i18n="controls.sprint"></span></p><p><kbd>Ctrl</kbd><span data-i18n="controls.crouch"></span></p><p><kbd>Space</kbd><span data-i18n="controls.jump"></span></p><p><kbd>E</kbd><span data-i18n="controls.interact"></span></p><p><kbd>C</kbd><span data-i18n="controls.camera"></span></p><p><kbd>M</kbd><span data-i18n="controls.map"></span></p><p><kbd>Esc</kbd><span data-i18n="controls.pause"></span></p></div><nav class="menu menu-row">${btn('back','menu.back')}</nav></div></section>
<section class="screen screen-modal screen-progress" data-screen="progress"><div class="modal modal-wide"><h2 class="modal-title" data-i18n="progress.title"></h2><p data-i18n="progress.body"></p><div class="progress-count"></div><ol class="progress-list"></ol><nav class="menu menu-row">${btn('back','menu.back')}</nav></div></section>
<section class="screen screen-modal screen-about" data-screen="about"><div class="modal"><h2 class="modal-title" data-i18n="about.title"></h2><p data-i18n="about.body"></p><nav class="menu menu-row">${btn('back','menu.back')}</nav></div></section>
<section class="screen screen-modal screen-privacy" data-screen="privacy"><div class="modal"><h2 class="modal-title" data-i18n="privacy.title"></h2><p data-i18n="privacy.body"></p><nav class="menu menu-row">${btn('back','menu.back')}</nav></div></section>
<section class="screen screen-modal screen-credits" data-screen="credits"><div class="modal"><h2 class="modal-title" data-i18n="credits.title"></h2><p data-i18n="credits.body"></p><nav class="menu menu-row">${btn('back','menu.back')}</nav></div></section>
<section class="screen screen-modal screen-accessibility" data-screen="accessibility"><div class="modal"><h2 class="modal-title" data-i18n="accessibility.title"></h2><p data-i18n="accessibility.body"></p>${toggle('reducedMotion','settings.reducedMotion')}${toggle('subtitles','settings.subtitles')}${range('sensitivity','settings.sensitivity',0.2,3,0.1)}<nav class="menu menu-row">${btn('back','menu.back')}</nav></div></section>
<section class="screen screen-modal screen-failure" data-screen="failure"><div class="modal"><h2 class="modal-title" data-i18n="failure.title"></h2><p class="failure-reason"></p><dl class="results-table"><div><dt data-i18n="failure.progress"></dt><dd class="failure-progress"></dd></div><div><dt data-i18n="failure.followersLabel"></dt><dd class="failure-followers"></dd></div><div><dt data-i18n="failure.timeLabel"></dt><dd class="failure-time"></dd></div><div><dt data-i18n="failure.guardsLabel"></dt><dd class="failure-guards"></dd></div></dl><nav class="menu">${btn('restart','menu.restart',true)}${btn('restart-full','menu.restartFull')}${btn('quit','menu.mainMenu')}</nav></div></section>
<section class="screen screen-modal screen-victory" data-screen="victory"><div class="modal"><div class="victory-flag">${ICON.flag}</div><h2 class="modal-title" data-i18n="victory.title"></h2><p class="victory-hosted" data-i18n="victory.hosted"></p><dl class="results-table"><div><dt data-i18n="victory.progressLabel"></dt><dd class="victory-progress"></dd></div><div><dt data-i18n="victory.timeLabel"></dt><dd class="victory-time"></dd></div><div><dt data-i18n="victory.followersLabel"></dt><dd class="victory-followers"></dd></div><div><dt data-i18n="victory.guardsLabel"></dt><dd class="victory-guards"></dd></div></dl><nav class="menu">${btn('restart-full','menu.playAgain',true)}${btn('quit','menu.mainMenu')}</nav></div></section>`
  }
}

function formatTime(seconds: number): string { const s = Math.max(0, Math.floor(seconds)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
function pointerDistance(points: MapPoint[]): number { return points.length < 2 ? 0 : Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) }
function THREE_PERCENT(value: number, min: number, max: number): number { return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) }
