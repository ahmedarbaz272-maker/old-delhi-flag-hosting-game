import './styles/main.css'
import { Assets } from './engine/assets'
import { Audio } from './engine/audio'
import { I18n, resolveLocale } from './engine/i18n'
import { Input } from './engine/input'
import { GameLoop } from './engine/loop'
import { SAVE_KEY, SaveStore, type SaveData } from './engine/save'
import { Renderer, suggestQuality } from './engine/renderer'
import { initPhysics } from './engine/physics'
import { Game } from './game/game'
import { loadGyanuFlag, ModelLibrary } from './game/model-assets'
import { TouchControls } from './ui/touch'
import { Ui } from './ui/ui'

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!
  const uiRoot = document.getElementById('ui')!
  const firstRun = safeGet(SAVE_KEY) === null
  const save = new SaveStore()
  const i18n = new I18n(resolveLocale(save.data.locale, navigator.languages))
  const input = new Input(canvas)
  const audio = new Audio()
  let game: Game | undefined
  let loop: GameLoop | undefined
  let renderer: Renderer | undefined
  let touch: TouchControls | undefined
  let lockLostAt = 0
  let booting: Promise<void> | undefined

  const applySettings = (data: SaveData) => {
    input.sensitivity = data.sensitivity
    input.invertY = data.invertY
    audio.setVolumes(data.musicVolume, data.sfxVolume, data.muted)
    if (game) game.reducedMotion = data.reducedMotion
  }

  const pause = () => {
    if (game?.mode !== 'playing') return
    game.pause()
    ui.show('pause')
    input.unlockPointer()
    loop?.resetAccumulator()
  }
  const resume = () => {
    if (game?.mode !== 'paused') return
    game.resume()
    ui.show('hud')
    loop?.resetAccumulator()
    input.lockPointer()
  }
  const openMap = () => {
    if (!game || game.mode !== 'playing') return
    game.pause()
    ui.openMap()
    input.unlockPointer()
    loop?.resetAccumulator()
  }
  const closeMap = () => {
    if (game?.mode === 'paused') game.resume()
    ui.show('hud')
    loop?.resetAccumulator()
    input.lockPointer()
  }
  const startFresh = () => {
    if (!game) return
    audio.unlock(); audio.startMusic()
    game.startFresh()
    ui.show('hud')
    ui.updateHud(game.hudSnapshot())
    loop?.resetAccumulator()
    input.lockPointer()
  }
  const continueMission = () => {
    if (!game) return
    audio.unlock(); audio.startMusic()
    game.continueMission()
    if (game.mode === 'victory') ui.showVictory({
      completed: game.missionState.completed.length,
      elapsed: game.missionState.elapsed,
      guardsDetected: game.missionState.guardsCaught,
      followers: game.visibleFollowers,
    })
    else {
      ui.show('hud')
      ui.updateHud(game.hudSnapshot())
      input.lockPointer()
    }
    loop?.resetAccumulator()
  }

  const ui = new Ui(i18n, save, audio, input, {
    play: () => ui.show('briefing'),
    continueMission,
    beginMission: startFresh,
    resume,
    restart: () => {
      if (!game) return
      game.restartCurrentMission()
      ui.show('hud'); ui.updateHud(game.hudSnapshot())
      loop?.resetAccumulator(); input.lockPointer()
    },
    restartFull: () => {
      if (!game) return
      game.restartFullGame()
      ui.show('hud'); ui.updateHud(game.hudSnapshot())
      loop?.resetAccumulator(); input.lockPointer()
    },
    quit: () => {
      game?.toTitle()
      ui.show('title')
      input.unlockPointer()
    },
    openMap,
    closeMap,
    navigate: siteId => game?.setWaypoint(siteId),
    settings: patch => {
      const qualityChanged = patch.quality !== undefined && patch.quality !== save.data.quality
      save.update(patch)
      applySettings(save.data)
      if (patch.locale) i18n.set(patch.locale)
      if (qualityChanged) game?.setQuality(save.data.quality)
    },
    retryAssets: () => { void loadGame().catch(showBootError) },
  })
  ui.show('boot')
  applySettings(save.data)
  if (firstRun) {
    save.update({ quality: suggestQuality() })
    applySettings(save.data)
    ui.refreshSettings()
  }

  const showBootError = (error: unknown) => {
    console.error(error)
    const message = error instanceof Error ? error.message : String(error)
    ui.showBootError(message.slice(0, 360))
  }

  const loadGame = (): Promise<void> => {
    if (booting) return booting
    booting = (async () => {
      ui.clearBootError()
      ui.setBootProgress(0.08)
      if (!document.createElement('canvas').getContext('webgl2')) throw new Error(i18n.t('boot.webglUnavailable'))
      const assets = new Assets()
      const stopProgress = assets.onProgress(value => ui.setBootProgress(0.12 + Math.min(1, value) * 0.65))
      const [models, flagTexture] = await Promise.all([ModelLibrary.load(assets), loadGyanuFlag(assets)])
      stopProgress()
      ui.setBootProgress(0.82)
      await Promise.all([initPhysics(), document.fonts.ready])
      if (!renderer) renderer = new Renderer(canvas, save.data.quality)
      game = new Game(renderer, input, audio, i18n, save, models, flagTexture, {
        hud: hud => ui.updateHud(hud),
        popup: text => ui.popup(text),
        flashDetection: () => ui.hurt(),
        detained: stats => { input.unlockPointer(); ui.showFailure(stats) },
        victory: stats => { input.unlockPointer(); ui.showVictory(stats) },
      })
      game.reducedMotion = save.data.reducedMotion
      if (models.errors.length) ui.popup(i18n.t('boot.modelFallback'))

      if (import.meta.env.DEV) {
        try {
          const [{ registerGameTuning }, { tuning }] = await Promise.all([
            // @ts-expect-error Managed preview adapter is replaced by a standalone no-op shim.
            import('../scripts/manus-tuning/adapter.js'), import('./game/tuning'),
          ])
          await registerGameTuning(tuning)
        } catch (error) {
          console.warn('Preview tuning could not be registered; gameplay remains available.', error)
        }
      }

      if (!loop) {
        const activeGame = game
        loop = new GameLoop({
          beforeFrame: () => input.update(),
          step: dt => activeGame.step(dt),
          render: (alpha, frameSeconds) => {
            if (input.consume('pause') && performance.now() - lockLostAt > 300) {
              if (activeGame.mode === 'playing') pause()
              else if (activeGame.mode === 'paused' && ui.screen === 'pause') resume()
            }
            if (input.consume('map') && activeGame.mode === 'playing' && ui.screen === 'hud') openMap()
            ui.frame(frameSeconds)
            loop!.paused = ['paused', 'failure', 'victory'].includes(activeGame.mode)
            activeGame.render(alpha, frameSeconds)
          },
        })
        loop.start()
        document.addEventListener('pointerlockchange', () => {
          // Escape may release pointer lock without delivering a useful keyboard event.
          if (!document.pointerLockElement && activeGame.mode === 'playing' && input.method === 'keyboard') {
            lockLostAt = performance.now()
            pause()
          }
        })
        document.addEventListener('visibilitychange', () => { if (document.hidden) pause() })
        window.addEventListener('game:pause', pause)
        canvas.addEventListener('click', () => { if (activeGame.mode === 'playing') input.lockPointer() })
        touch = new TouchControls(uiRoot, input, () => activeGame.mode === 'playing')
        window.addEventListener('beforeunload', () => {
          touch?.dispose(); ui.dispose(); input.dispose(); audio.dispose(); loop?.stop()
        }, { once: true })
      }
      ui.setBootProgress(1)
      ui.show('title')
      ui.refreshTitle()
      ;(window as unknown as { __game: unknown }).__game = { game, ui, input, save }
    })().finally(() => { booting = undefined })
    return booting
  }

  await loadGame().catch(showBootError)
}

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

boot().catch(error => {
  console.error(error)
  const message = error instanceof Error ? error.message : String(error)
  const ui = document.getElementById('ui')
  if (ui) {
    const box = document.createElement('div')
    box.className = 'fatal'
    box.textContent = `Failed to start: ${message}`
    ui.replaceChildren(box)
  }
})
