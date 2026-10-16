# Gyanu — The Flag Hosting Mission

A colorful, stylized 3D single-player city mission for desktop and mobile browsers. Explore an original fictional Old Delhi–inspired city, gather friendly crowds at **16 distinct locations**, evade patrols, unlock a secured assembly ground, climb a watchtower and **host the exact supplied Gyanu flag**. Hosting the flag—not capturing or retrieving it—is the sole terminal victory.

The art direction uses bright, readable arcade-runner color and energetic character presentation as a high-level reference. The project does not copy Subway Surfers characters, logos, maps, or artwork. The city layout is fictional and built from original Three.js geometry, with four project-specific GLB models for the runner, friendly gatherers, a guard, and a bazaar frontage.

## Mission locations

1. Old Quarter Square
2. Lantern Market
3. Bricklane Junction
4. Railway Yard
5. Riverside Blocks
6. Clocktower Ward
7. Foundry Street
8. East Bazaar
9. Abandoned Depot
10. Narrow Alley Quarter
11. Warehouse Row
12. South Courtyard
13. Stonebridge
14. Industrial Edge
15. Outer Assembly Road
16. Central Gathering District

Each site tracks discovery and recruitment progress separately. The final zone remains locked until the city objectives are complete. Security detention is non-graphic and ends the current attempt.

## Controls

### Desktop

| Action | Default |
| --- | --- |
| Move | `W` `A` `S` `D` |
| Look | Mouse (click the game to capture the pointer) |
| Sprint | `Shift` |
| Crouch | `Ctrl` |
| Jump | `Space` |
| Interact / gather / host | `E` |
| Map | `M` |
| First-/third-person camera | `C` |
| Pause / release pointer | `Esc` |

### Mobile

Use the on-screen movement stick and touch-look area; the large action buttons provide sprint, crouch, jump, interact, camera, map, and pause. The game works without pointer lock on touch devices. Landscape is recommended; portrait guidance is shown when needed. Touch targets account for device safe areas.

## Run locally

The source uses **Node.js 22** and the pinned package manager **pnpm 10.18.0**. The standalone build uses the checked-in model files under `assets/models/` and the supplied flag at `public/assets/flags/gyanu.png`.

```bash
pnpm install --frozen-lockfile
pnpm dev:github       # http://localhost:3000
pnpm build:github     # type-check + Vite build + size report + sharing metadata
pnpm test             # unit tests
pnpm smoke            # production browser smoke test (Playwright Chromium)
```

To preview a production build locally:

```bash
pnpm build:github
pnpm preview          # http://localhost:4173
```

The initialized Manus workspace also retains its managed asset-restore commands (`pnpm dev` / `pnpm build`). The standalone GitHub commands intentionally do not require Manus credentials or asset-storage access.

## GitHub Pages deployment

The project repository is [`AuraKareSollutions/old-delhi-flag-hosting-game`](https://github.com/AuraKareSollutions/old-delhi-flag-hosting-game). The GitHub Actions workflow builds the production Vite output and deploys the `dist/` directory to GitHub Pages. Vite uses relative asset URLs (`base: './'`) so models, the exact flag texture, CSS, and scripts load beneath the repository subpath. HTTPS is supplied by GitHub Pages.

For a fork, update the repository-specific canonical URL in `index.html` and workflow metadata, then enable **Settings → Pages → GitHub Actions**. GLB models and the supplied flag are served as static files; the build does not need a custom MIME configuration on GitHub Pages.

## Saves, privacy, and hosting limits

- Mission progress and preferences are stored locally in the browser. There is no account, sign-in, database, analytics, multiplayer, payment, or game-data backend.
- No personal, identity, or payment information is requested or transmitted by the game.
- GitHub Pages is static hosting; it does not provide a server-side save, cross-device progress, or an online scoreboard.
- This release is free to play. It depends on HTTPS and downloads the game assets on first visit; no offline/PWA claim is made.
- The local production build is about **22.6 MB of initial assets** (including the four GLBs and supplied flag). First load can be slow on a constrained mobile connection.

## Verification and known limits

See [`docs/test-report.md`](docs/test-report.md) for the exact commands/results and remaining unverified scenarios. Unit tests and the production browser smoke test cover mission rules, UI/map states, a real gathering interaction, failure/result panels, restart confirmation, desktop/mobile layout, and touch interaction. The scripted smoke is not a full human playthrough of every city route: the complete 16-site travel path, guard line-of-sight pursuit/detention, and physical end-to-end stair-climb/flag-host interaction still require a manual live playthrough.

## Asset and library notes

- `assets/models/gyanu-runner.glb`, `gyanu-gatherer.glb`, `gyanu-guard.glb`, and `gyanu-bazaar-building.glb` are project-specific generated models.
- `public/assets/flags/gyanu.png` is the supplied transparent artwork. The game uses it unchanged as the cloth texture on the watchtower flagpole.
- City architecture, landmarks, barriers, props, and the tower are assembled from original procedural Three.js geometry. No third-party city map or Subway Surfers content is included.
- Three.js is MIT-licensed; Rapier is Apache-2.0. The bundled ManusCC0 fonts include their CC0 notice in `public/fonts/ManusCC0-LICENSE.txt`.
- The project does not add a separate software or asset license. Users should retain the asset provenance and respect the rights applicable to the supplied flag and generated models.
