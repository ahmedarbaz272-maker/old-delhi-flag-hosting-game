/** Shared tuning values for player movement, camera, mission progression, and the city scene. */
export const DEFAULT_CONFIG = {
  run: {
    // Legacy score-rule values remain for the existing pure-rule tests; the city mission has no timer or lives.
    seconds: 150,
    lives: 3,
    invulnerable: 1.6,
    killY: -28,
  },
  score: { core: 100, comboWindow: 3.5, comboMax: 5, timeBonus: 25, lifeBonus: 500 },
  player: {
    radius: 0.38,
    halfHeight: 0.54,
    walkSpeed: 5.4,
    sprintSpeed: 8.4,
    crouchSpeed: 2.7,
    acceleration: 36,
    airControl: 0.45,
    jumpSpeed: 7.8,
    gravity: -24,
    lowJumpGravity: -42,
    maxFall: -36,
    coyoteTime: 0.12,
    jumpBuffer: 0.14,
    // Retained as unused starter fields for save/runtime compatibility.
    dashSpeed: 22,
    dashTime: 0.16,
    dashCooldown: 0.9,
    turnSpeed: 12,
  },
  camera: { distance: 6.2, height: 1.25, shoulder: 0.42, minPitch: -0.32, maxPitch: 1.0, follow: 10, fov: 64 },
  mission: { hostDuration: 7, discoveryRadius: 9, interactRadius: 7, finalGateZ: 59, towerZ: 72 },
  security: { detectionRadius: 13, fovCos: 0.42, detectionSeconds: 2.4, restrictedRadius: 17, pursuitSpeed: 4.3, patrolSpeed: 1.5 },
  drones: { speed: 3.2, radius: 0.7, rageSpeed: 5, rageAt: 45 },
} as const

type MutableConfig<T> = { -readonly [K in keyof T]: T[K] extends number ? number : T[K] extends object ? MutableConfig<T[K]> : T[K] }
export const CONFIG: MutableConfig<typeof DEFAULT_CONFIG> = structuredClone(DEFAULT_CONFIG)
