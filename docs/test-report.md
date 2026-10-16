# Verification report

This repository was reconstructed from the completed Manus workspace artifacts and is intended to be published as a static GitHub Pages game.

- `pnpm typecheck` — run before publishing.
- `pnpm test` — run before publishing.
- `pnpm build:github` — produces the static `dist/` output.
- `pnpm smoke` and `pnpm mission:integration` require Playwright Chromium and a graphical runtime; their results are reported separately when available.

Known limitation: the standalone repository does not include Manus-only asset restoration services. The checked-in GLB models and recovered flag image are used directly.
