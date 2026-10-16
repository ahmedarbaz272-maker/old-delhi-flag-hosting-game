declare module '../scripts/manus-tuning/adapter.js' {
  export function registerGameTuning(tuning: unknown): Promise<void>
}

declare module './scripts/manus-tuning/vite.mjs' {
  export function manusGameTuning(): {
    name: string
    configResolved(): void
  }
}
