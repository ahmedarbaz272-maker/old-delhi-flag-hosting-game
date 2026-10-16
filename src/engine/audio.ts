/** Optional Web Audio mixer. Missing browser audio never prevents the mission from starting. */
export type Sfx = 'pickup' | 'jump' | 'land' | 'hurt' | 'ui' | 'win' | 'lose' | 'dash' | 'gather' | 'alert' | 'host' | 'footstep'

export class Audio {
  readonly ctx: AudioContext | null
  private master?: GainNode
  private music?: GainNode
  private sfx?: GainNode
  private musicTimer = 0
  private musicOn = false
  private buffers = new Map<string, AudioBuffer>()

  constructor() {
    try {
      const Ctx = window.AudioContext
      if (!Ctx) { this.ctx = null; return }
      this.ctx = new Ctx()
      this.master = this.ctx.createGain(); this.music = this.ctx.createGain(); this.sfx = this.ctx.createGain()
      this.music.connect(this.master); this.sfx.connect(this.master); this.master.connect(this.ctx.destination)
    } catch { this.ctx = null }
  }
  unlock(): void { if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => undefined) }
  setVolumes(music: number, sfx: number, muted = false): void {
    if (!this.ctx || !this.music || !this.sfx) return
    const t = this.ctx.currentTime; this.music.gain.setTargetAtTime(muted ? 0 : music * 0.55, t, 0.05); this.sfx.gain.setTargetAtTime(muted ? 0 : sfx * 0.8, t, 0.05)
  }
  async load(url: string): Promise<AudioBuffer> {
    if (!this.ctx) throw new Error('Audio is unavailable in this browser')
    const cached = this.buffers.get(url); if (cached) return cached
    const data = await (await fetch(url)).arrayBuffer(), buffer = await this.ctx.decodeAudioData(data); this.buffers.set(url, buffer); return buffer
  }
  playBuffer(buffer: AudioBuffer, bus: 'music' | 'sfx' = 'sfx', loop = false): AudioBufferSourceNode | undefined {
    if (!this.ctx || !this[bus]) return undefined
    const src = this.ctx.createBufferSource(); src.buffer = buffer; src.loop = loop; src.connect(this[bus]!); src.start(); return src
  }
  play(name: Sfx): void {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running' || !this.sfx) return
    const t = ctx.currentTime
    const tone = (freq: number, end: number, dur: number, type: OscillatorType, vol: number, delay = 0) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t + delay); o.frequency.exponentialRampToValueAtTime(Math.max(end, 20), t + delay + dur)
      g.gain.setValueAtTime(0.0001, t + delay); g.gain.exponentialRampToValueAtTime(vol, t + delay + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur); o.connect(g).connect(this.sfx!); o.start(t + delay); o.stop(t + delay + dur + 0.05)
    }
    switch (name) {
      case 'pickup': tone(880, 1320, 0.12, 'triangle', 0.35); tone(1320, 1760, 0.16, 'sine', 0.25, 0.06); break
      case 'gather': tone(430, 660, 0.13, 'triangle', 0.22); tone(660, 990, 0.22, 'sine', 0.24, 0.08); break
      case 'host': [392, 494, 587, 784].forEach((f, i) => tone(f, f * 1.005, 0.3, 'triangle', 0.18, i * 0.1)); break
      case 'alert': tone(520, 880, 0.24, 'sawtooth', 0.12); tone(880, 440, 0.3, 'sine', 0.08, 0.2); break
      case 'footstep': tone(100, 60, 0.035, 'sine', 0.035); break
      case 'jump': tone(300, 620, 0.14, 'square', 0.12); break
      case 'land': tone(160, 70, 0.1, 'sine', 0.25); break
      case 'hurt': tone(220, 90, 0.28, 'sawtooth', 0.22); break
      case 'ui': tone(660, 700, 0.06, 'triangle', 0.18); break
      case 'dash': tone(500, 180, 0.18, 'sawtooth', 0.1); break
      case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, f * 1.01, 0.3, 'triangle', 0.25, i * 0.11)); break
      case 'lose': [392, 330, 262].forEach((f, i) => tone(f, f * 0.98, 0.38, 'sine', 0.25, i * 0.16)); break
    }
  }
  startMusic(): void {
    if (!this.ctx || !this.music || this.musicOn) return
    this.musicOn = true
    const chords = [[220, 277.2, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 261.6, 329.6]]
    let bar = 0
    const schedule = () => {
      if (!this.musicOn || !this.ctx || !this.music) return
      const t = this.ctx.currentTime + 0.05, chord = chords[bar % chords.length]
      for (const f of chord) for (const detune of [-6, 6]) {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = 'sine'; o.frequency.value = f / 2; o.detune.value = detune
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.025, t + 1.2); g.gain.linearRampToValueAtTime(0.0001, t + 4.2); o.connect(g).connect(this.music); o.start(t); o.stop(t + 4.4)
      }
      bar += 1; this.musicTimer = window.setTimeout(schedule, 3600)
    }
    schedule()
  }
  stopMusic(): void { this.musicOn = false; clearTimeout(this.musicTimer) }
  dispose(): void { this.stopMusic(); this.buffers.clear(); void this.ctx?.close().catch(() => undefined) }
}
