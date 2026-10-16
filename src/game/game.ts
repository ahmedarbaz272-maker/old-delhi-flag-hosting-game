import * as THREE from 'three'
import { RAPIER, Physics } from '../engine/physics'
import type { Audio } from '../engine/audio'
import type { I18n } from '../engine/i18n'
import type { Input } from '../engine/input'
import type { Renderer } from '../engine/renderer'
import type { Quality, SaveStore } from '../engine/save'
import { CONFIG } from './config'
import { buildCity, type CityEnvironment, type MarkerState } from './city-world'
import { FollowCamera } from './camera'
import { CrowdSystem } from './crowd'
import { ModelLibrary } from './model-assets'
import {
  FINAL_DESTINATION,
  LOCATIONS,
  TOTAL_OBJECTIVES,
  canAccessTower,
  completeHosting,
  completeMission,
  discoverLocation,
  findNearbyLocation,
  getLocationStatus,
  getMissionProgress,
  interruptHosting,
  normalizeMissionState,
  recordGuardCaught,
  restartMission,
  startHosting,
  tickMission,
  updateFlagState,
  type GatheringLocation,
  type HostingChecks,
  type MissionState,
  type Point2D,
} from './mission'
import { Player, type PlayerEvent } from './player'
import { SecuritySystem, type SecurityState } from './security'
import { tuning } from './tuning'
import type { MissionHud, MissionStats } from '../ui/ui'
import { recruitAtLocation as importRecruit } from './mission'

export type GameMode = 'attract' | 'playing' | 'paused' | 'failure' | 'victory'
export type GameHooks = {
  hud(hud: MissionHud): void
  popup(text: string): void
  flashDetection(): void
  detained(stats: MissionStats): void
  victory(stats: MissionStats): void
}

type Target = GatheringLocation | typeof FINAL_DESTINATION
const FLAG_RISE_SECONDS = 2.4
const HOST_STILL_RADIUS = 0.22
const MODEL_MARKET_POSITION = new THREE.Vector3(47, 0, -17)

/** Fixed-step, client-only mission runtime. One MissionState owns every progression decision. */
export class Game {
  mode: GameMode = 'attract'
  reducedMotion = false
  private readonly physics: Physics
  private readonly city: CityEnvironment
  private readonly player: Player
  private readonly camera: FollowCamera
  private readonly crowd: CrowdSystem
  private readonly security: SecuritySystem
  private readonly floorRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
  private state: MissionState
  private elapsedInSession = 0
  private flagLiftElapsed = 0
  private hostingAnchor = new THREE.Vector3()
  private simTime = 0
  private renderTime = 0
  private hudAccumulator = 0
  private saveAccumulator = 0
  private persistElapsed = -1
  private lastAlert = 0
  private routeOverride = ''
  private lastPrompt = ''
  private lastDetectionState: SecurityState = 'Patrol'
  private readonly baseFlagVertices: Float32Array

  constructor(
    private readonly renderer: Renderer,
    private readonly input: Input,
    private readonly audio: Audio,
    private readonly i18n: I18n,
    private readonly save: SaveStore,
    models: ModelLibrary,
    flagTexture: THREE.Texture,
    private readonly hooks: GameHooks,
  ) {
    this.physics = new Physics(CONFIG.player.gravity)
    this.city = buildCity(this.physics, flagTexture)
    this.player = new Player(this.physics, this.city.spawn)
    const runner = models.clone('runner')
    if (runner) this.player.setVisual(runner)
    this.camera = new FollowCamera(this.physics, this.player.collider)
    this.camera.setMode(save.data.cameraMode)
    this.player.setVisible(this.camera.mode === 'third')
    this.crowd = new CrowdSystem(this.city.scene, models)
    this.security = new SecuritySystem(this.city.scene, this.physics, this.city, this.player.collider, models, reason => this.onDetained(reason))
    this.city.scene.add(this.player.root, this.player.shadowMesh)
    this.placeBazaarModel(models)
    this.state = normalizeMissionState({
      discovered: save.data.discoveredLocations,
      completed: save.data.completedLocations,
      recruits: save.data.recruitCounts,
      elapsed: save.data.missionElapsed,
      guardsCaught: save.data.guardsDetected,
      flagState: save.data.flagState,
      hostingElapsed: save.data.hostingElapsed,
      missionComplete: save.data.missionComplete,
    })
    // A page refresh during a hold cancels the hold; it never resumes an unattended interaction.
    if (this.state.flagState === 'HOSTING_IN_PROGRESS') this.state = interruptHosting(this.state)
    this.applyMissionPresentation()
    this.restoreCrowd()
    const attributes = this.city.flag.cloth.geometry.attributes.position
    this.baseFlagVertices = Float32Array.from(attributes.array as ArrayLike<number>)
    this.resetFlagPose()
    this.camera.reset(this.player.position, 0)
    this.lastDetectionState = this.security.status.state
    this.persist(true)
  }

  get cameraView(): THREE.PerspectiveCamera { return this.camera.camera }
  get missionState(): MissionState { return this.state }
  get playerPosition(): THREE.Vector3 { return this.player.position }
  get visibleFollowers(): number { return this.crowd.visibleFollowers }

  /** A new run intentionally clears all gathering progress. */
  startFresh(): void {
    this.state = restartMission(this.state, false)
    this.beginAtSpawn()
    this.save.clearMission()
    this.persist(true)
  }

  /** Continue saved objective progress; terminal hosted saves open the results screen directly. */
  continueMission(): void {
    this.beginAtSpawn()
    if (this.state.flagState === 'HOSTED' || this.state.flagState === 'MISSION_COMPLETE') {
      this.flagLiftElapsed = FLAG_RISE_SECONDS
      this.updateFlagPose()
      this.state = completeMission(this.state)
      this.mode = 'victory'
      this.persist(true)
      this.hooks.victory(this.stats())
      return
    }
    this.persist(true)
  }

  /** Retry this mission from its start while preserving completed/discovered locations. */
  restartCurrentMission(): void {
    this.state = restartMission(this.state, { preserveAllObjectives: true })
    this.beginAtSpawn()
    this.persist(true)
  }

  /** Reset every location and return to a genuinely fresh game. */
  restartFullGame(): void {
    this.state = restartMission(this.state, false)
    this.beginAtSpawn()
    this.save.clearMission()
    this.persist(true)
  }

  pause(): void { if (this.mode === 'playing') this.mode = 'paused' }
  resume(): void {
    if (this.mode !== 'paused') return
    this.mode = 'playing'
    this.input.endFrame(); this.input.takeLook()
  }
  toTitle(): void {
    this.mode = 'attract'
    this.input.clearHeld(); this.input.endFrame(); this.input.takeLook()
  }

  setQuality(quality: Quality): void {
    this.renderer.applyQuality(quality)
    const light = this.city.scene.children.find(child => (child as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight | undefined
    if (light?.shadow) {
      light.shadow.map?.dispose(); light.shadow.map = null
      light.shadow.mapSize.set(this.renderer.shadowMapSize, this.renderer.shadowMapSize)
    }
    this.city.scene.traverse(object => {
      const item = object as THREE.Mesh
      if (!item.isMesh) return
      for (const material of Array.isArray(item.material) ? item.material : [item.material]) material.needsUpdate = true
    })
  }

  setWaypoint(id: string): void {
    if (LOCATIONS.some(site => site.id === id) || id === FINAL_DESTINATION.id) this.routeOverride = id
  }

  toggleCamera(): 'first' | 'third' {
    const mode = this.camera.toggleMode()
    this.player.setVisible(mode === 'third')
    this.save.update({ cameraMode: mode })
    this.audio.play('ui')
    return mode
  }

  step(dt: number): void {
    if (this.mode !== 'playing' || !Number.isFinite(dt) || dt <= 0) return
    const step = Math.min(dt, 1 / 20)
    this.simTime += step
    this.elapsedInSession += step
    const jumpPressed = this.input.consume('jump')
    const interactPressed = this.input.consume('interact')
    if (this.input.consume('camera')) this.toggleCamera()
    const events: PlayerEvent[] = []
    this.player.step(step, {
      moveX: this.input.move.x,
      moveY: this.input.move.y,
      sprint: this.input.held('sprint'),
      crouch: this.input.held('crouch'),
      jumpPressed,
      jumpHeld: this.input.held('jump'),
    }, this.camera.yaw, events)
    this.physics.step(step)
    const position = this.player.position
    for (const event of events) this.onPlayerEvent(event)
    this.updateDiscovery(position)
    if (interactPressed) this.interact(position)
    this.updateGate()

    const moveDistance = Math.hypot(position.x - this.hostingAnchor.x, position.z - this.hostingAnchor.z)
    const checks = this.hostingChecks(position)
    if (this.state.flagState === 'HOSTING_IN_PROGRESS') {
      if (moveDistance > HOST_STILL_RADIUS || !this.hostingValid(position)) {
        this.state = interruptHosting(this.state)
        this.state = updateFlagState(this.state, checks)
        this.audio.play('alert')
        this.hooks.popup(this.i18n.t('hud.hostInterrupted'))
      } else {
        this.state = tickMission(this.state, step)
        if (this.state.hostingElapsed >= CONFIG.mission.hostDuration) {
          this.state = completeHosting(this.state, checks)
          if (this.state.flagState === 'HOSTED') {
            this.flagLiftElapsed = 0
            this.audio.play('host')
            this.hooks.popup(this.i18n.t('hud.hosted'))
          }
        }
      }
    } else {
      this.state = tickMission(this.state, step)
      this.state = updateFlagState(this.state, checks)
    }

    if (this.state.flagState === 'HOSTED') {
      this.flagLiftElapsed = Math.min(FLAG_RISE_SECONDS, this.flagLiftElapsed + step)
      if (this.flagLiftElapsed >= FLAG_RISE_SECONDS) {
        this.state = completeMission(this.state)
        if (this.state.flagState === 'MISSION_COMPLETE') {
          this.mode = 'victory'
          this.audio.play('win')
          this.persist(true)
          this.hooks.victory(this.stats())
        }
      }
    }

    const movementSpeed = Math.hypot(this.player.velocity.x, this.player.velocity.z)
    const restricted = this.isInsideAssembly(position)
    const security = this.security.update(step, position, movementSpeed, this.player.crouched, this.input.held('sprint'), restricted, true)
    if (security.alert > 0.68 && this.lastAlert <= 0.68) this.hooks.flashDetection()
    this.lastAlert = security.alert
    if (security.state !== this.lastDetectionState && ['Alert', 'Pursue', 'Detain'].includes(security.state)) this.audio.play('alert')
    this.lastDetectionState = security.state

    this.crowd.update(step, position, this.player.facing, this.state.flagState === 'HOSTED' || this.state.flagState === 'MISSION_COMPLETE')
    this.updateFlagPose()
    this.updatePrompt(position)
    this.saveAccumulator += step
    if (this.saveAccumulator >= 1) { this.saveAccumulator = 0; this.persist(false) }
    this.hudAccumulator += step
    if (this.hudAccumulator >= 0.1) { this.hudAccumulator = 0; this.hooks.hud(this.hudSnapshot(position, security)) }
  }

  render(_alpha: number, frameSeconds: number): void {
    this.renderTime += frameSeconds
    const dt = Math.min(Math.max(frameSeconds, 0), 0.05)
    this.physics.sync(_alpha)
    if (this.mode === 'attract') {
      const angle = this.renderTime * 0.035 + 0.5
      this.camera.camera.position.set(20 + Math.sin(angle) * 62, 31 + Math.sin(this.renderTime * 0.11) * 3, 20 + Math.cos(angle) * 62)
      this.camera.camera.lookAt(0, 2.2, -2)
    } else {
      const look = this.mode === 'playing' ? this.input.takeLook() : { x: 0, y: 0 }
      this.camera.update(this.player.root.position, look, dt, false, this.reducedMotion)
    }
    this.player.animate(dt, this.groundBelow(this.player.root.position))
    this.renderer.render(this.city.scene, this.camera.camera)
  }

  hudSnapshot(position = this.player.position, security = this.security.status): MissionHud {
    const target = this.currentTarget(position)
    const dx = target.x - position.x, dz = target.z - position.z
    let bearing = Math.atan2(-dx, -dz) - this.camera.yaw
    bearing = Math.atan2(Math.sin(bearing), Math.cos(bearing))
    const nearest = findNearbyLocation(position)
    const playerState = this.player.crouched
      ? this.i18n.t('hud.playerCrouching')
      : this.input.held('sprint') && Math.hypot(this.player.velocity.x, this.player.velocity.z) > 2.2
        ? this.i18n.t('hud.playerSprinting')
        : Math.hypot(this.player.velocity.x, this.player.velocity.z) > 0.25
          ? this.i18n.t('hud.playerWalking')
          : this.i18n.t('hud.playerStanding')
    const progress = getMissionProgress(this.state)
    return {
      completed: progress.completed,
      discovered: this.state.discovered.length,
      total: TOTAL_OBJECTIVES,
      objective: this.i18n.t('hud.target', { name: target.name }),
      district: this.i18n.t('district.label', { name: this.isInsideAssembly(position) ? this.i18n.t('district.assemblyGround') : nearest?.district ?? this.i18n.t('district.city') }),
      playerState,
      securityState: security.state,
      prompt: this.currentPrompt,
      distance: Math.hypot(dx, dz),
      bearing,
      detection: security.alert,
      hostingProgress: this.state.flagState === 'HOSTING_IN_PROGRESS' ? Math.min(1, this.state.hostingElapsed / Math.max(0.1, CONFIG.mission.hostDuration)) : 0,
      hosting: this.state.flagState === 'HOSTING_IN_PROGRESS',
      cameraMode: this.camera.mode,
      playerX: position.x,
      playerZ: position.z,
      targetX: target.x,
      targetZ: target.z,
      targetId: target.id,
      completedIds: [...this.state.completed],
      discoveredIds: [...this.state.discovered],
      recruitCounts: { ...this.state.recruits },
    }
  }

  get currentPrompt(): string { return this.lastPrompt }

  private beginAtSpawn(): void {
    tuning.activate('run')
    this.mode = 'playing'
    this.elapsedInSession = 0
    this.flagLiftElapsed = 0
    this.hostingAnchor.copy(this.city.spawn)
    this.lastAlert = 0
    this.lastPrompt = ''
    this.lastDetectionState = 'Patrol'
    this.input.clearHeld(); this.input.endFrame(); this.input.takeLook()
    this.player.teleport(this.city.spawn)
    this.player.facing = 0
    this.camera.pitch = 0.12
    this.camera.setMode(this.save.data.cameraMode)
    this.player.setVisible(this.camera.mode === 'third')
    this.camera.reset(this.city.spawn, 0)
    this.security.reset()
    this.crowd.reset()
    this.restoreCrowd()
    this.city.closeGate()
    this.resetFlagPose()
    this.applyMissionPresentation()
    this.updateGate()
    if (this.state.flagState === 'HOSTING_IN_PROGRESS') this.state = interruptHosting(this.state)
    this.persist(true)
  }

  private restoreCrowd(): void {
    for (const id of this.state.discovered) {
      this.crowd.revealLocation(id)
      const count = this.state.recruits[id] ?? 0
      if (count > 0) this.crowd.recruit(id, count)
      if (this.state.completed.includes(id)) this.crowd.completeLocation(id)
    }
  }

  private applyMissionPresentation(): void {
    for (const location of LOCATIONS) {
      const state: MarkerState = this.state.completed.includes(location.id)
        ? 'completed'
        : this.state.discovered.includes(location.id) ? 'discovered' : 'undiscovered'
      this.city.setMarkerState(location.id, state)
    }
  }

  private updateDiscovery(position: THREE.Vector3): void {
    let nearest: GatheringLocation | undefined
    let best = CONFIG.mission.discoveryRadius * CONFIG.mission.discoveryRadius
    for (const location of LOCATIONS) {
      if (this.state.discovered.includes(location.id)) continue
      const dx = position.x - location.x, dz = position.z - location.z
      const d2 = dx * dx + dz * dz
      if (d2 <= best) { nearest = location; best = d2 }
    }
    if (!nearest) return
    this.state = discoverLocation(this.state, nearest.id)
    this.crowd.revealLocation(nearest.id)
    this.city.updateMarkerDiscovered(nearest.id)
    this.audio.play('gather')
    this.hooks.popup(this.i18n.t('hud.discoveredSite', { name: nearest.name }))
    this.persist(true)
  }

  private updateGate(): void {
    if (!this.city.gate.open && canAccessTower(this.state)) {
      this.city.openGate()
      this.hooks.popup(this.i18n.t('hud.allComplete'))
    }
  }

  private hostingChecks(position: THREE.Vector3): HostingChecks {
    const all = canAccessTower(this.state)
    const tower = this.city.tower
    const xz = horizontalDistance(position, tower.platformCenter)
    const onPlatform = xz <= tower.platformRadius - 0.55 && position.y >= tower.height + 0.65 && position.y <= tower.height + 3.2
    const nearFlag = horizontalDistance(position, this.city.flag.flagpolePosition) <= CONFIG.mission.interactRadius * 0.42
    const approaching = horizontalDistance(position, FINAL_DESTINATION) < 17
    return { allObjectivesComplete: all, onTowerPlatform: onPlatform, nearFlagpole: nearFlag, approachingTower: approaching }
  }

  private hostingValid(position: THREE.Vector3): boolean {
    return canAccessTower(this.state)
      && horizontalDistance(position, this.city.tower.platformCenter) <= this.city.tower.platformRadius - 0.55
      && position.y >= this.city.tower.height + 0.65
      && position.y <= this.city.tower.height + 3.2
      && horizontalDistance(position, this.city.flag.flagpolePosition) <= CONFIG.mission.interactRadius * 0.42
  }

  private interact(position: THREE.Vector3): void {
    const site = findNearbyLocation(position)
    if (site) {
      const status = getLocationStatus(this.state, site.id)
      if (!status) return
      if (status.complete) { this.hooks.popup(this.i18n.t('hud.siteAlreadyComplete', { name: site.name })); this.audio.play('ui'); return }
      if (!this.state.discovered.includes(site.id)) {
        this.hooks.popup(this.i18n.t('hud.discoverFirst')); this.audio.play('ui'); return
      }
      const amount = Math.min(3, status.remaining)
      this.state = this.state.flagState === 'HOSTING_IN_PROGRESS' ? interruptHosting(this.state) : this.state
      const next = this.state
      // MissionState caps each objective at its configured requirement; one press cannot double-count.
      this.state = importRecruit(this.state, site.id, amount)
      this.crowd.recruit(site.id, amount)
      this.audio.play('gather')
      if (!next.completed.includes(site.id) && this.state.completed.includes(site.id)) {
        this.crowd.completeLocation(site.id)
        this.city.updateMarkerCompleted(site.id)
        this.hooks.popup(this.i18n.t('hud.siteComplete', { name: site.name }))
      } else {
        this.hooks.popup(this.i18n.t('hud.recruited', { name: site.name }))
      }
      this.updateGate()
      this.persist(true)
      return
    }

    const checks = this.hostingChecks(position)
    if (!canAccessTower(this.state)) {
      if (this.isInsideAssembly(position) || horizontalDistance(position, FINAL_DESTINATION) < 21) this.hooks.popup(this.i18n.t('hud.gateLocked'))
      else this.hooks.popup(this.i18n.t('hud.explore'))
      this.audio.play('ui'); return
    }
    if (!checks.onTowerPlatform) {
      this.hooks.popup(this.i18n.t('hud.climb')); this.audio.play('ui'); return
    }
    if (!checks.nearFlagpole) {
      this.hooks.popup(this.i18n.t('hud.flagNearPole')); this.audio.play('ui'); return
    }
    const before = this.state.flagState
    this.state = startHosting(this.state, checks)
    if (this.state.flagState === 'HOSTING_IN_PROGRESS' && before !== 'HOSTING_IN_PROGRESS') {
      this.hostingAnchor.copy(position)
      this.hooks.popup(this.i18n.t('hud.hostingStarted'))
      this.audio.play('host')
    } else if (before === 'HOSTING_IN_PROGRESS') {
      this.state = interruptHosting(this.state)
      this.hooks.popup(this.i18n.t('hud.hostInterrupted'))
      this.audio.play('alert')
    }
    this.persist(true)
  }

  private updatePrompt(position: THREE.Vector3): void {
    const site = findNearbyLocation(position)
    let prompt: string
    if (this.state.flagState === 'HOSTING_IN_PROGRESS') {
      prompt = this.i18n.t('hud.holdStill')
    } else if (site) {
      const status = getLocationStatus(this.state, site.id)
      prompt = status?.complete
        ? this.i18n.t('hud.siteDone')
        : this.i18n.t('hud.gatherPrompt', { count: status?.remaining ?? site.target })
    } else if (this.isInsideAssembly(position) && !canAccessTower(this.state)) {
      prompt = this.i18n.t('hud.gateLocked')
    } else if (canAccessTower(this.state) && horizontalDistance(position, this.city.tower.platformCenter) < 12 && !this.hostingValid(position)) {
      prompt = this.i18n.t('hud.climb')
    } else if (this.hostingValid(position) && this.state.flagState !== 'HOSTED' && this.state.flagState !== 'MISSION_COMPLETE') {
      prompt = this.i18n.t(this.input.method === 'touch' ? 'hud.flagPromptTouch' : 'hud.flagPrompt')
    } else if (canAccessTower(this.state) && horizontalDistance(position, FINAL_DESTINATION) < 17) {
      prompt = this.i18n.t('hud.climb')
    } else {
      prompt = this.i18n.t('hud.explore')
    }
    if (prompt !== this.lastPrompt) this.lastPrompt = prompt
  }

  private currentTarget(position: THREE.Vector3): Target {
    if (this.state.completed.length === TOTAL_OBJECTIVES) return FINAL_DESTINATION
    const override = LOCATIONS.find(site => site.id === this.routeOverride && !this.state.completed.includes(site.id))
    if (override) return override
    let nearest: GatheringLocation | undefined
    let distance = Infinity
    for (const location of LOCATIONS) {
      if (this.state.completed.includes(location.id)) continue
      const d = horizontalDistance(position, location)
      if (d < distance) { nearest = location; distance = d }
    }
    return nearest ?? FINAL_DESTINATION
  }

  private onPlayerEvent(event: PlayerEvent): void {
    if (event.type === 'jump') this.audio.play('jump')
    else if (event.type === 'land') this.audio.play('land')
  }

  private onDetained(reason: string): void {
    if (this.mode !== 'playing') return
    this.state = recordGuardCaught(this.state, 1)
    this.state = this.state.flagState === 'HOSTING_IN_PROGRESS' ? interruptHosting(this.state) : this.state
    this.mode = 'failure'
    this.audio.play('lose')
    this.persist(true)
    this.hooks.detained({ ...this.stats(), reason: this.i18n.t('failure.detainedBy', { guard: reason.replace(/^Detained by /, '') }) })
  }

  private stats(): MissionStats {
    return {
      completed: getMissionProgress(this.state).completed,
      elapsed: this.state.elapsed,
      guardsDetected: this.state.guardsCaught,
      followers: this.crowd.visibleFollowers,
    }
  }

  private isInsideAssembly(position: THREE.Vector3): boolean {
    return Math.abs(position.x - this.city.tower.center.x) <= 13.5 && Math.abs(position.z - this.city.tower.center.z) <= 13.5
  }

  private updateFlagPose(): void {
    const cloth = this.city.flag.cloth
    const attr = cloth.geometry.attributes.position
    const lift = this.state.flagState === 'HOSTED' || this.state.flagState === 'MISSION_COMPLETE'
      ? Math.min(1, this.flagLiftElapsed / FLAG_RISE_SECONDS)
      : 0
    const startY = Number(cloth.userData.startY)
    const targetY = Number(cloth.userData.targetY)
    const ease = lift * lift * (3 - 2 * lift)
    cloth.position.y = startY + (targetY - startY) * ease
    const geometry = cloth.geometry
    const width = this.city.flag.clothWidth
    const height = this.city.flag.clothHeight
    for (let i = 0; i < attr.count; i += 1) {
      const baseX = this.baseFlagVertices[i * 3]
      const baseY = this.baseFlagVertices[i * 3 + 1]
      const baseZ = this.baseFlagVertices[i * 3 + 2]
      const u = Math.max(0, Math.min(1, (baseX + width / 2) / width))
      const v = (baseY + height / 2) / height
      const waving = lift >= 1 && !this.reducedMotion
      attr.setY(i, baseY + (waving ? Math.sin(this.renderTime * 2.8 + u * 4.2 + v * 1.4) * 0.075 * u : 0))
      attr.setZ(i, baseZ + (waving ? Math.sin(this.renderTime * 2.2 + u * 3.4 + v) * 0.055 * u : 0))
    }
    attr.needsUpdate = true
    geometry.computeVertexNormals()
    cloth.visible = true
  }

  private resetFlagPose(): void {
    const cloth = this.city.flag.cloth
    cloth.position.y = Number(cloth.userData.startY)
    const attr = cloth.geometry.attributes.position
    for (let i = 0; i < attr.count; i += 1) {
      attr.setXYZ(i, this.baseFlagVertices[i * 3], this.baseFlagVertices[i * 3 + 1], this.baseFlagVertices[i * 3 + 2])
    }
    attr.needsUpdate = true
    cloth.geometry.computeVertexNormals()
    cloth.visible = true
  }

  private groundBelow(position: THREE.Vector3): number | null {
    this.floorRay.origin = { x: position.x, y: position.y, z: position.z }
    const hit = this.physics.world.castRay(this.floorRay, 35, true, undefined, undefined, this.player.collider)
    return hit ? position.y - hit.timeOfImpact : null
  }

  private persist(force: boolean): void {
    if (!force && this.state.elapsed - this.persistElapsed < 1) return
    this.persistElapsed = this.state.elapsed
    const target = this.currentTarget(this.player.position)
    this.save.update({
      completedLocations: [...this.state.completed],
      discoveredLocations: [...this.state.discovered],
      recruitCounts: { ...this.state.recruits },
      missionElapsed: this.state.elapsed,
      guardsDetected: this.state.guardsCaught,
      flagState: this.state.flagState,
      hostingElapsed: this.state.hostingElapsed,
      missionComplete: this.state.missionComplete,
      currentObjective: target.id,
      cameraMode: this.camera.mode,
    })
    this.applyMissionPresentation()
  }

  private placeBazaarModel(models: ModelLibrary): void {
    const bazaar = models.clone('bazaar')
    if (!bazaar) return
    bazaar.name = 'generated-east-bazaar-frontage'
    bazaar.position.copy(MODEL_MARKET_POSITION)
    bazaar.rotation.y = Math.PI
    const bounds = new THREE.Box3().setFromObject(bazaar)
    const size = bounds.getSize(new THREE.Vector3())
    const footprint = Math.max(size.x, size.z)
    if (footprint > 10) bazaar.scale.multiplyScalar(10 / footprint)
    bazaar.updateMatrixWorld(true)
    const finalBounds = new THREE.Box3().setFromObject(bazaar)
    const center = finalBounds.getCenter(new THREE.Vector3())
    const finalSize = finalBounds.getSize(new THREE.Vector3())
    this.city.scene.add(bazaar)
    this.physics.addStaticBox(center, new THREE.Vector3(Math.max(1, finalSize.x * 0.9), Math.max(2, finalSize.y), Math.max(1, finalSize.z * 0.9)))
  }
}

function horizontalDistance(a: Point2D, b: Point2D): number { return Math.hypot(a.x - b.x, a.z - b.z) }
