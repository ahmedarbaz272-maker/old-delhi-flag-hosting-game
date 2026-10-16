// End-to-end smoke test for Gyanu — the Flag Hosting Mission.
// Requires a successful pnpm build; screenshots are written to ./shots/.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const port = 4300 + Math.floor(Math.random() * 500)
const url = `http://127.0.0.1:${port}/`
const out = process.env.SHOTS_DIR ?? 'shots'
mkdirSync(out, { recursive: true })
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: false })
let browser
const errors = []
const responses = []
const guard = setTimeout(() => fail('timed out'), 240_000)

function cleanup() {
  clearTimeout(guard)
  try { server.kill('SIGTERM') } catch {}
}
async function fail(message) {
  console.error(`smoke: FAIL — ${message}`)
  await browser?.close().catch(() => {})
  cleanup()
  process.exit(1)
}
function assert(value, message) { if (!value) throw new Error(message) }
async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(url)).ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('preview server did not start')
}
async function openGame(context) {
  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  page.on('console', message => message.type() === 'error' && errors.push(message.text()))
  page.on('pageerror', error => errors.push(String(error)))
  page.on('response', response => {
    responses.push({ status: response.status(), url: response.url() })
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`)
  })
  await page.goto(url)
  await page.waitForSelector('[data-screen="title"].is-active', { timeout: 30_000 })
  await page.evaluate(async () => {
    await document.fonts.ready
    const expected = document.documentElement.lang === 'zh-CN' ? 'ManusCC0 Sans CJK SC' : 'ManusCC0'
    for (const selector of ['.logo-text', '.tagline']) {
      const family = getComputedStyle(document.querySelector(selector)).fontFamily
      if (!family.includes(expected) || !family.includes('system-ui')) throw new Error(`Unexpected game font fallback: ${family}`)
    }
  })
  await page.waitForTimeout(500)
  return page
}
const readGame = page => page.evaluate(() => {
  const { game, save } = window.__game
  const p = game.playerPosition
  return { mode: game.mode, elapsed: game.missionState.elapsed, x: p.x, y: p.y, z: p.z, rootX: game['player'].root.position.x, completed: [...game.missionState.completed], recruits: { ...game.missionState.recruits }, saved: [...save.data.completedLocations] }
})

try {
  await waitForServer()
  const args = ['--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader']
  browser = await chromium.launch({ args }).catch(() => chromium.launch({ args, channel: 'chrome' }))

  console.log('smoke: desktop/menu/map/objective')
  const en = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US' })
  const page = await openGame(en)
  assert(await page.title() === 'Gyanu — The Flag Hosting Mission', 'game title metadata is incorrect')
  await page.screenshot({ path: `${out}/01-title-en.png` })
  const assets = await page.evaluate(() => {
    const { game } = window.__game
    const flag = game['city'].flag.cloth.material.map.image
    const city = game['city']
    const guards = game['security']['guards']
    return { flagWidth: flag?.naturalWidth ?? flag?.width ?? 0, flagHeight: flag?.naturalHeight ?? flag?.height ?? 0, modelErrors: city.scene.children.length,
      sky: Boolean(city.scene.getObjectByName('procedural-sky-dome') && city.scene.getObjectByName('visible-sky-sun')),
      detentionSign: Boolean(city.scene.getObjectByName('detention-center-sign')),
      guardNames: city.guardSpawns.map(spawn => spawn.displayName),
      namedNameplates: guards.filter(guard => guard.nameplate?.userData.displayName === guard.spawn.displayName).length,
      playerVisible: game['player'].visual.children.length > 0,
      visibleGuards: guards.filter(guard => guard.root.children.length > 0).length,
      guardCount: guards.length }
  })
  assert(assets.flagWidth === 2350 && assets.flagHeight === 1824, `exact flag image did not load at 2350×1824 (${assets.flagWidth}×${assets.flagHeight})`)
  assert(assets.sky, 'visible procedural sky dome or sun is missing')
  assert(assets.detentionSign, 'detention center has no visible facility sign')
  assert(assets.guardNames.length >= 6 && new Set(assets.guardNames).size === assets.guardNames.length, 'security mobs do not have distinct names')
  assert(assets.namedNameplates === assets.guardCount, `expected a nameplate per guard, found ${assets.namedNameplates}/${assets.guardCount}`)
  const modelNames = [...new Set(responses.filter(item => item.url.includes('gyanu-') && item.url.endsWith('.glb') && item.status === 200).map(item => item.url.match(/gyanu-[^/]+?\.glb/)?.[0]).filter(Boolean))]
  assert(modelNames.length === 4 || (assets.playerVisible && assets.visibleGuards === assets.guardCount), `expected all four generated GLBs or visible procedural player/security fallbacks; found ${modelNames.length} GLBs and ${assets.visibleGuards}/${assets.guardCount} guards`)

  await page.click('[data-action="play"]')
  await page.waitForSelector('[data-screen="briefing"].is-active')
  await page.screenshot({ path: `${out}/02-briefing.png` })
  await page.click('[data-screen="briefing"] [data-action="begin-mission"]')
  await page.waitForSelector('[data-screen="hud"].is-active')
  const beforeMove = await readGame(page)
  const renderedBeforeMove = await page.evaluate(() => { const p = window.__game.game['player'].root.position; return { x: p.x, z: p.z } })
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(650)
  await page.keyboard.up('KeyW')
  await page.waitForTimeout(180)
  const afterMove = await readGame(page)
  const renderedAfterMove = await page.evaluate(() => { const p = window.__game.game['player'].root.position; return { x: p.x, z: p.z } })
  const moved = Math.hypot(afterMove.x - beforeMove.x, afterMove.z - beforeMove.z)
  const renderedMoved = Math.hypot(renderedAfterMove.x - renderedBeforeMove.x, renderedAfterMove.z - renderedBeforeMove.z)
  assert(afterMove.mode === 'playing', `expected playing, got ${afterMove.mode}`)
  assert(moved > 0.5, `player barely moved (${moved.toFixed(2)} m)`)
  assert(renderedMoved > 0.5, `rendered character stayed still while its physics body moved (${renderedMoved.toFixed(2)} m)`)
  assert(afterMove.elapsed > beforeMove.elapsed, 'mission clock did not advance')
  await page.keyboard.press('KeyC')
  await page.waitForFunction(() => window.__game.game.hudSnapshot().cameraMode === 'first', null, { timeout: 8_000 })
  const cameraMode = await page.evaluate(() => window.__game.game.hudSnapshot().cameraMode)
  assert(cameraMode === 'first', `camera did not toggle from third to first person (${cameraMode})`)
  await page.keyboard.press('KeyC')
  await page.waitForFunction(() => window.__game.game.hudSnapshot().cameraMode === 'third', null, { timeout: 8_000 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${out}/03-gameplay.png` })

  await page.keyboard.press('KeyM')
  await page.waitForSelector('[data-screen="map"].is-active')
  const markers = await page.locator('[data-screen="map"] .map-marker').count()
  assert(markers === 16, `map should have 16 real location markers; found ${markers}`)
  const finalMarker = page.locator('[data-screen="map"] .map-final')
  assert(await finalMarker.getAttribute('data-state') === 'locked', 'flag-hosting zone should be locked before 16/16')
  assert((await finalMarker.getAttribute('aria-label')).includes('Locked'), 'locked zone state is missing from the accessible label')
  const finalTop = Number.parseFloat(await finalMarker.evaluate(element => element.style.top))
  assert(finalTop >= 0 && finalTop <= 100, `tower destination is outside the map frame (${finalTop}%)`)
  assert((await page.locator('.map-route-label').textContent()).includes('CURRENT ROUTE'), 'map does not show the current route')
  await page.click('[data-site="lantern-market"]')
  assert((await page.locator('.map-route-label').textContent()).includes('Lantern Market'), 'selecting a map marker did not update the route')
  await page.click('[data-action="map-zoom-in"]')
  assert((await page.locator('.map-plane').getAttribute('style')).includes('scale(1.2)'), 'map zoom button did not transform the map')
  const mapFrame = await page.locator('.map-frame').boundingBox()
  await page.mouse.move(mapFrame.x + mapFrame.width / 2, mapFrame.y + mapFrame.height / 2)
  await page.mouse.down()
  await page.mouse.move(mapFrame.x + mapFrame.width / 2 + 26, mapFrame.y + mapFrame.height / 2 + 12)
  await page.mouse.up()
  const pan = await page.evaluate(() => window.__game.ui['mapPan'])
  assert(Math.abs(pan.x) > 5 && Math.abs(pan.y) > 5, `map drag did not pan (${pan.x}, ${pan.y})`)
  await page.screenshot({ path: `${out}/04-map.png` })
  await page.click('[data-action="close-map"]')
  await page.waitForSelector('[data-screen="hud"].is-active')

  // Exercise one objective through actual input and the live Rapier-backed player controller.
  await page.evaluate(() => {
    const { game } = window.__game
    const point = game.playerPosition
    game['player'].teleport(new point.constructor(-36, 1.1, -36))
  })
  await page.waitForTimeout(180)
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('KeyE')
    await page.waitForTimeout(280)
  }
  await page.waitForTimeout(180)
  const gathered = await readGame(page)
  assert(gathered.completed.includes('old-quarter-square'), `the Old Quarter objective did not complete after reaching its real interaction radius: ${JSON.stringify(gathered)}`)
  assert(gathered.recruits['old-quarter-square'] === 8, `objective count was not capped at its exact target (${gathered.recruits['old-quarter-square']})`)
  await page.keyboard.press('KeyE')
  await page.waitForTimeout(120)
  const noDoubleCount = await readGame(page)
  assert(noDoubleCount.recruits['old-quarter-square'] === 8, 'completed objective double-counted an additional interaction')
  await page.screenshot({ path: `${out}/05-first-objective.png` })

  // A new run must explicitly confirm before the current local save is discarded.
  await page.evaluate(() => { const { game, ui, input } = window.__game; game.toTitle(); input.unlockPointer(); ui.show('title') })
  await page.click('[data-action="play"]')
  await page.click('[data-screen="briefing"] [data-action="begin-mission"]')
  await page.waitForSelector('[data-screen="confirm-new"].is-active')
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${out}/06-reset-confirmation.png` })
  await page.click('[data-action="cancel-new-mission"]')
  await page.waitForSelector('[data-screen="briefing"].is-active')
  assert((await readGame(page)).saved.includes('old-quarter-square'), 'canceling reset removed the saved objective')
  await page.click('[data-screen="briefing"] [data-action="begin-mission"]')
  await page.click('[data-action="confirm-new-mission"]')
  await page.waitForSelector('[data-screen="hud"].is-active')
  assert((await readGame(page)).completed.length === 0, 'confirmed fresh mission did not reset mission progress')

  // Visit every key menu/panel and verify the result overlays render from the same UI.
  await page.evaluate(() => { const { game, ui, input } = window.__game; input.unlockPointer(); game.mode = 'failure'; ui.showFailure({ completed: 0, elapsed: 12, guardsDetected: 1, followers: 3, reason: 'Smoke-test detention' }) })
  await page.waitForSelector('[data-screen="failure"].is-active')
  assert(await page.locator('[data-screen="failure"] .failure-reason').textContent() === 'Smoke-test detention', 'failure reason is not surfaced')
  await page.click('[data-screen="failure"] [data-action="restart"]')
  await page.waitForSelector('[data-screen="hud"].is-active')
  await page.evaluate(() => { const { game, ui } = window.__game; game.mode = 'victory'; ui.showVictory({ completed: 16, elapsed: 123, guardsDetected: 0, followers: 12 }) })
  await page.waitForSelector('[data-screen="victory"].is-active')
  assert((await page.locator('.victory-progress').textContent()).includes('16 / 16'), 'victory screen does not show 16/16')
  await page.waitForTimeout(450)
  await page.screenshot({ path: `${out}/07-victory-screen.png` })
  await page.evaluate(() => { const { game, input, ui } = window.__game; game.mode = 'attract'; input.unlockPointer(); ui.show('title') })
  await page.click('[data-action="more"]')
  await page.click('[data-screen="more"] [data-action="controls"]')
  await page.waitForSelector('[data-screen="controls"].is-active')
  await page.click('[data-screen="controls"] [data-action="back"]')
  await page.click('[data-screen="more"] [data-action="settings"]')
  await page.waitForSelector('[data-screen="settings"].is-active')
  assert(await page.locator('[data-screen="settings"] [name="sensitivity"]').count() === 1, 'look-sensitivity control is missing')
  await page.click('[data-screen="settings"] [data-action="back"]')
  await page.click('[data-screen="more"] [data-action="accessibility"]')
  await page.waitForSelector('[data-screen="accessibility"].is-active')
  await page.screenshot({ path: `${out}/08-accessibility.png` })
  await page.click('[data-screen="accessibility"] [data-action="back"]')
  await page.click('[data-screen="more"] [data-action="privacy"]')
  await page.waitForSelector('[data-screen="privacy"].is-active')

  console.log('smoke: results/menus/localization')
  console.log('smoke: return to title for locale setting')
  await page.evaluate(() => window.__game.ui.show('title'))
  console.log('smoke: open settings for locale')
  await page.click('[data-action="more"]')
  await page.click('[data-screen="more"] [data-action="settings"]')
  console.log('smoke: choose Simplified Chinese')
  await page.click('[data-screen="settings"] [data-setting="locale"] [data-value="zh-CN"]')
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN')
  await page.evaluate(() => document.fonts.ready)
  const cjkFont = await page.evaluate(() => ({ family: getComputedStyle(document.querySelector('.logo-text')).fontFamily }))
  assert(cjkFont.family.includes('ManusCC0 Sans CJK SC') && cjkFont.family.includes('system-ui'), `CJK locale did not retain its declared system-font fallback (${cjkFont.family})`)
  await page.evaluate(() => window.__game.ui.show('title'))
  await page.screenshot({ path: `${out}/09-title-zh.png` })
  await en.close()

  console.log('smoke: landscape mobile')
  const phone = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US' })
  const phonePage = await openGame(phone)
  await phonePage.click('[data-action="play"]')
  await phonePage.click('[data-screen="briefing"] [data-action="begin-mission"]')
  await phonePage.waitForSelector('[data-screen="hud"].is-active')
  assert(await phonePage.locator('.touch-stick').isVisible(), 'mobile joystick is not visible in landscape')
  assert(await phonePage.locator('.touch-interact').isVisible(), 'mobile interaction control is missing')
  const phoneInput = await phonePage.evaluate(() => ({ method: window.__game.input.method, pointerLocked: Boolean(document.pointerLockElement) }))
  assert(phoneInput.method === 'touch', `coarse-pointer device did not enter shared touch input (${phoneInput.method})`)
  assert(!phoneInput.pointerLocked, 'mobile play must not request desktop pointer lock')
  console.log('smoke: touch joystick movement')
  const stickBox = await phonePage.locator('.touch-stick').boundingBox()
  const beforeTouchMove = await readGame(phonePage)
  await phonePage.evaluate(({ x, y }) => {
    const stick = document.querySelector('.touch-stick')
    const pointerId = 77
    stick.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId, clientX: x, clientY: y }))
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId, clientX: x - 44, clientY: y }))
  }, { x: stickBox.x + stickBox.width / 2, y: stickBox.y + stickBox.height / 2 })
  await phonePage.waitForTimeout(600)
  const afterTouchMove = await readGame(phonePage)
  await phonePage.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 77 })))
  await phonePage.waitForTimeout(100)
  assert(afterTouchMove.x < beforeTouchMove.x - 0.35, `visible mobile joystick did not move the player (${(afterTouchMove.x - beforeTouchMove.x).toFixed(2)} m)`)
  assert(Math.abs(afterTouchMove.rootX - afterTouchMove.x) < 0.2, `rendered mobile character did not follow joystick movement in the same frame (root ${afterTouchMove.rootX.toFixed(2)}, physics ${afterTouchMove.x.toFixed(2)})`)
  const releasedInput = await phonePage.evaluate(() => window.__game.input.move)
  assert(Math.hypot(releasedInput.x, releasedInput.y) < 0.03, `mobile joystick stayed pressed after pointer cancellation (${releasedInput.x.toFixed(2)}, ${releasedInput.y.toFixed(2)})`)
  await phonePage.evaluate(() => { const { game } = window.__game; const point = game.playerPosition; game['player'].teleport(new point.constructor(-36, 1.1, -36)) })
  await phonePage.waitForTimeout(180)
  console.log('smoke: touch interaction')
  await phonePage.tap('.touch-interact')
  await phonePage.waitForFunction(() => (window.__game.game.missionState.recruits['old-quarter-square'] ?? 0) === 3, null, { timeout: 8_000 })
  const mobileRecruits = await phonePage.evaluate(() => window.__game.game.missionState.recruits['old-quarter-square'] ?? 0)
  assert(mobileRecruits === 3, `touch interaction did not use shared mission input (${mobileRecruits})`)
  await phonePage.screenshot({ path: `${out}/10-phone-landscape.png` })
  console.log('smoke: portrait orientation')
  await phonePage.setViewportSize({ width: 390, height: 844 })
  await phonePage.waitForTimeout(250)
  assert(!(await phonePage.locator('.orientation-warning').isVisible()), 'portrait guidance banner should not obscure the playable HUD')
  assert(await phonePage.locator('.touch-stick').isVisible(), 'touch joystick is hidden in portrait')
  assert(await phonePage.locator('.touch-interact').isVisible(), 'touch interaction button is hidden in portrait')
  const portraitBounds = await phonePage.evaluate(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom } }
    return { width: innerWidth, height: innerHeight, left: rect('.hud-top-left'), center: rect('.hud-top-center'), right: rect('.hud-top-right'), stick: rect('.touch-stick'), actions: rect('.touch-actions'), prompt: rect('.interaction-prompt') }
  })
  assert(portraitBounds.left.right < portraitBounds.right.x && portraitBounds.center.y >= Math.max(portraitBounds.left.bottom, portraitBounds.right.bottom), 'portrait HUD sections overlap')
  assert(portraitBounds.stick.x >= 0 && portraitBounds.stick.right <= portraitBounds.width && portraitBounds.stick.bottom <= portraitBounds.height, 'portrait joystick extends beyond the viewport')
  assert(portraitBounds.actions.x >= 0 && portraitBounds.actions.right <= portraitBounds.width && portraitBounds.actions.bottom <= portraitBounds.height, 'portrait action buttons extend beyond the viewport')
  assert(portraitBounds.prompt.bottom < portraitBounds.actions.y, 'portrait interaction prompt overlaps the touch action buttons')
  await phonePage.screenshot({ path: `${out}/11-phone-portrait.png` })
  await phone.close()

  const failedModels = responses.filter(item => item.url.includes('gyanu-') && item.url.endsWith('.glb') && item.status >= 400)
  assert(failedModels.length === 0, `generated models failed to load: ${failedModels.map(item => item.url).join(', ')}`)
  if (errors.length) throw new Error(`browser console/page/network errors:\n  ${errors.join('\n  ')}`)
  await browser.close()
  cleanup()
  console.log(`smoke: OK — ${modelNames.length} GLBs (procedural fallbacks supported), exact 2350×1824 flag, objective/map/reset/menu/mobile checks; ${Math.round(moved * 10) / 10} m moved; screenshots in ${out}/`)
} catch (error) {
  await fail(error?.message ?? String(error))
}
