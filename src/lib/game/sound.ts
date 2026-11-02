// Procedural audio engine — all sounds are synthesized at runtime (WebAudio), fully original.
// Buses: sfx / ambience / music → master. A generated convolver adds a light sense of space.
import type { SoundMat } from './blocks'

export type MobVoice = 'sheep' | 'cow' | 'pig' | 'chicken' | 'zombie'

interface EnvState {
  dayF: number // 0 = night, 1 = full day
  underground: boolean
  desert: boolean
}

export class SoundFX {
  private ctx: AudioContext | null = null
  private noiseBuf: AudioBuffer | null = null
  private master: GainNode | null = null
  private sfxBus: GainNode | null = null
  private ambBus: GainNode | null = null
  private musBus: GainNode | null = null
  private reverb: ConvolverNode | null = null
  private reverbGain: GainNode | null = null
  enabled = true

  // ambient scheduling
  private env: EnvState = { dayF: 1, underground: false, desert: false }
  private ambTimer: ReturnType<typeof setTimeout> | null = null
  private musicTimer: ReturnType<typeof setTimeout> | null = null
  private cricketTimer: ReturnType<typeof setTimeout> | null = null
  private paused = false

  resume() {
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        this.ctx = new AC()
        this.buildGraph()
      } catch {
        this.ctx = null
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume()
    if (this.ctx) {
      this.paused = false
      this.startAmbience()
      this.startMusic()
    }
  }

  private buildGraph() {
    const ctx = this.ctx!
    const len = ctx.sampleRate * 2
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    this.noiseBuf = buf

    this.master = ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(ctx.destination)

    this.sfxBus = ctx.createGain()
    this.sfxBus.gain.value = 1
    this.sfxBus.connect(this.master)

    this.ambBus = ctx.createGain()
    this.ambBus.gain.value = 0.85
    this.ambBus.connect(this.master)

    this.musBus = ctx.createGain()
    this.musBus.gain.value = 0.5
    this.musBus.connect(this.master)

    // simple generated impulse reverb
    try {
      const rev = ctx.createConvolver()
      const rl = Math.floor(ctx.sampleRate * 1.4)
      const ir = ctx.createBuffer(2, rl, ctx.sampleRate)
      for (let c = 0; c < 2; c++) {
        const ch = ir.getChannelData(c)
        for (let i = 0; i < rl; i++) {
          ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 2.6) * 0.5
        }
      }
      rev.buffer = ir
      this.reverbGain = ctx.createGain()
      this.reverbGain.gain.value = 0.16
      this.reverb = rev
      rev.connect(this.reverbGain).connect(this.master)
      // send music + ambience lightly into reverb
      this.musBus.connect(rev)
      this.ambBus.connect(rev)
    } catch {
      this.reverb = null
    }
  }

  setPaused(p: boolean) {
    this.paused = p
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const target = p ? 0.0001 : 0.9
    try {
      this.master!.gain.cancelScheduledValues(t)
      this.master!.gain.setTargetAtTime(target, t, 0.25)
    } catch { /* ignore */ }
    if (!p) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      this.startAmbience()
      this.startMusic()
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on
    if (!this.ctx) return
    const t = this.ctx.currentTime
    try {
      this.master!.gain.setTargetAtTime(on ? 0.9 : 0.0001, t, 0.1)
    } catch { /* ignore */ }
    if (on) {
      this.startAmbience()
      this.startMusic()
    }
  }

  private out(bus: GainNode | null, pan: number): AudioNode {
    const ctx = this.ctx!
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner()
      p.pan.value = Math.max(-1, Math.min(1, pan))
      p.connect(bus ?? ctx.destination)
      return p
    }
    return bus ?? ctx.destination
  }

  // ---------- core material sounds ----------
  private matFreq(m: SoundMat): { f: number; q: number; dur: number; gain: number } {
    switch (m) {
      case 'stone': return { f: 720, q: 1.1, dur: 0.09, gain: 0.5 }
      case 'dirt': return { f: 420, q: 0.8, dur: 0.1, gain: 0.45 }
      case 'sand': return { f: 300, q: 0.6, dur: 0.12, gain: 0.4 }
      case 'wood': return { f: 520, q: 2.2, dur: 0.09, gain: 0.5 }
      case 'glass': return { f: 2400, q: 3, dur: 0.08, gain: 0.35 }
      case 'plant': return { f: 900, q: 0.7, dur: 0.07, gain: 0.3 }
      case 'snow': return { f: 380, q: 0.5, dur: 0.1, gain: 0.35 }
      default: return { f: 600, q: 1, dur: 0.09, gain: 0.4 }
    }
  }

  /** short filtered noise burst — digging/steps */
  dig(m: SoundMat, vol = 1) {
    if (!this.enabled || !this.ctx || !this.noiseBuf) return
    const ctx = this.ctx
    const p = this.matFreq(m)
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    src.playbackRate.value = 0.9 + Math.random() * 0.25
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = p.f * (0.85 + Math.random() * 0.3)
    filter.Q.value = p.q
    const g = ctx.createGain()
    const t = ctx.currentTime
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.24 * p.gain * vol, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + p.dur)
    src.connect(filter).connect(g).connect(this.out(this.sfxBus, 0))
    src.start(t)
    src.stop(t + p.dur + 0.02)
  }

  /** placed block: thock */
  place(m: SoundMat) {
    if (!this.enabled || !this.ctx || !this.noiseBuf) return
    this.dig(m, 1.2)
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    const t = ctx.currentTime
    osc.frequency.setValueAtTime(m === 'stone' ? 190 : 150, t)
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.09)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.18, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1)
    osc.connect(g).connect(this.out(this.sfxBus, 0))
    osc.start(t)
    osc.stop(t + 0.12)
  }

  /** block destroyed: pop + crunch */
  break_(m: SoundMat) {
    if (!this.enabled || !this.ctx || !this.noiseBuf) return
    this.dig(m, 1.6)
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.type = 'square'
    const t = ctx.currentTime
    osc.frequency.setValueAtTime(340, t)
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.11)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.1, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
    osc.connect(g).connect(this.out(this.sfxBus, 0))
    osc.start(t)
    osc.stop(t + 0.14)
  }

  step(m: SoundMat) {
    this.dig(m, 0.35)
  }

  splash() {
    if (!this.enabled || !this.ctx || !this.noiseBuf) return
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    const t = ctx.currentTime
    filter.frequency.setValueAtTime(2600, t)
    filter.frequency.exponentialRampToValueAtTime(300, t + 0.3)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.3, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32)
    src.connect(filter).connect(g).connect(this.out(this.sfxBus, 0))
    src.start(t)
    src.stop(t + 0.35)
    // droplets
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      const dt = t + 0.05 + i * 0.07
      o.frequency.setValueAtTime(700 + Math.random() * 500, dt)
      o.frequency.exponentialRampToValueAtTime(250, dt + 0.06)
      const og = ctx.createGain()
      og.gain.setValueAtTime(0.05, dt)
      og.gain.exponentialRampToValueAtTime(0.0001, dt + 0.07)
      o.connect(og).connect(this.out(this.sfxBus, 0))
      o.start(dt)
      o.stop(dt + 0.08)
    }
  }

  jump() {
    if (!this.enabled || !this.ctx) return
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    const t = ctx.currentTime
    osc.frequency.setValueAtTime(160, t)
    osc.frequency.exponentialRampToValueAtTime(240, t + 0.08)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.06, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1)
    osc.connect(g).connect(this.out(this.sfxBus, 0))
    osc.start(t)
    osc.stop(t + 0.12)
  }

  click() {
    if (!this.enabled || !this.ctx) return
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.type = 'square'
    const t = ctx.currentTime
    osc.frequency.setValueAtTime(660, t)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.05, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
    osc.connect(g).connect(this.out(this.sfxBus, 0))
    osc.start(t)
    osc.stop(t + 0.06)
  }

  /** player takes damage — low thud + grunt */
  hurt() {
    if (!this.enabled || !this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'square'
    o.frequency.setValueAtTime(210, t)
    o.frequency.exponentialRampToValueAtTime(95, t + 0.12)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.14, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    o.connect(g).connect(this.out(this.sfxBus, 0))
    o.start(t)
    o.stop(t + 0.18)
    if (this.noiseBuf) {
      const src = ctx.createBufferSource()
      src.buffer = this.noiseBuf
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = 500
      const ng = ctx.createGain()
      ng.gain.setValueAtTime(0.12, t)
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.1)
      src.connect(f).connect(ng).connect(this.out(this.sfxBus, 0))
      src.start(t)
      src.stop(t + 0.12)
    }
  }

  /** air bubble */
  bubble() {
    if (!this.enabled || !this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(320 + Math.random() * 250, t)
    o.frequency.exponentialRampToValueAtTime(750 + Math.random() * 300, t + 0.09)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.05, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1)
    o.connect(g).connect(this.out(this.sfxBus, 0))
    o.start(t)
    o.stop(t + 0.12)
  }

  /** mob death puff */
  pop() {
    if (!this.enabled || !this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(380, t)
    o.frequency.exponentialRampToValueAtTime(900, t + 0.08)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.1, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
    o.connect(g).connect(this.out(this.sfxBus, 0))
    o.start(t)
    o.stop(t + 0.14)
  }

  /** whoosh when swinging at a mob */
  swing() {
    if (!this.enabled || !this.ctx || !this.noiseBuf) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 1.4
    f.frequency.setValueAtTime(500, t)
    f.frequency.exponentialRampToValueAtTime(2100, t + 0.12)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.03)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14)
    src.connect(f).connect(g).connect(this.out(this.sfxBus, 0))
    src.start(t)
    src.stop(t + 0.16)
  }

  /** generic mob hit thud */
  thud(vol = 1, pan = 0) {
    if (!this.enabled || !this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'triangle'
    o.frequency.setValueAtTime(160, t)
    o.frequency.exponentialRampToValueAtTime(60, t + 0.09)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.16 * vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11)
    o.connect(g).connect(this.out(this.sfxBus, pan))
    o.start(t)
    o.stop(t + 0.13)
  }

  // ---------- mob voices (distance volume + stereo pan) ----------
  mobVoice(type: MobVoice, vol = 1, pan = 0) {
    if (!this.enabled || !this.ctx || vol <= 0.02) return
    switch (type) {
      case 'sheep': this.voiceSheep(vol, pan); break
      case 'cow': this.voiceCow(vol, pan); break
      case 'pig': this.voicePig(vol, pan); break
      case 'chicken': this.voiceChicken(vol, pan); break
      case 'zombie': this.voiceZombie(vol, pan); break
    }
  }

  private voiceSheep(vol: number, pan: number) {
    const ctx = this.ctx!
    const t0 = ctx.currentTime
    const dest = this.out(this.sfxBus, pan)
    // "baa" — two saw segments with vibrato + lowpass
    const segments = [0, 0.22]
    for (const off of segments) {
      const t = t0 + off
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      const base = 400 + Math.random() * 80
      o.frequency.setValueAtTime(base, t)
      o.frequency.linearRampToValueAtTime(base * 0.88, t + 0.2)
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 7
      const lfoG = ctx.createGain()
      lfoG.gain.value = 22
      lfo.connect(lfoG).connect(o.frequency)
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = 1100
      f.Q.value = 2
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.09 * vol, t + 0.04)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2)
      o.connect(f).connect(g).connect(dest)
      o.start(t); lfo.start(t)
      o.stop(t + 0.24); lfo.stop(t + 0.24)
    }
  }

  private voiceCow(vol: number, pan: number) {
    const ctx = this.ctx!
    const t = ctx.currentTime
    const dest = this.out(this.sfxBus, pan)
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(165, t)
    o.frequency.linearRampToValueAtTime(118, t + 0.55)
    o.frequency.linearRampToValueAtTime(95, t + 0.8)
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 5
    const lfoG = ctx.createGain()
    lfoG.gain.value = 9
    lfo.connect(lfoG).connect(o.frequency)
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(600, t)
    f.frequency.linearRampToValueAtTime(320, t + 0.8)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.13 * vol, t + 0.12)
    g.gain.setValueAtTime(0.13 * vol, t + 0.55)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85)
    o.connect(f).connect(g).connect(dest)
    o.start(t); lfo.start(t)
    o.stop(t + 0.9); lfo.stop(t + 0.9)
  }

  private voicePig(vol: number, pan: number) {
    const ctx = this.ctx!
    const t0 = ctx.currentTime
    const dest = this.out(this.sfxBus, pan)
    const bursts = [0, 0.16]
    for (const off of bursts) {
      const t = t0 + off
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(230 + Math.random() * 60, t)
      o.frequency.exponentialRampToValueAtTime(90, t + 0.1)
      const f = ctx.createBiquadFilter()
      f.type = 'bandpass'
      f.frequency.value = 480
      f.Q.value = 1.2
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.11 * vol, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
      o.connect(f).connect(g).connect(dest)
      o.start(t)
      o.stop(t + 0.14)
      if (this.noiseBuf) {
        const src = ctx.createBufferSource()
        src.buffer = this.noiseBuf
        const nf = ctx.createBiquadFilter()
        nf.type = 'bandpass'
        nf.frequency.value = 700
        const ng = ctx.createGain()
        ng.gain.setValueAtTime(0.05 * vol, t)
        ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
        src.connect(nf).connect(ng).connect(dest)
        src.start(t)
        src.stop(t + 0.1)
      }
    }
  }

  private voiceChicken(vol: number, pan: number) {
    const ctx = this.ctx!
    const t0 = ctx.currentTime
    const dest = this.out(this.sfxBus, pan)
    const n = 2 + Math.floor(Math.random() * 2)
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.14 + Math.random() * 0.05)
      const o = ctx.createOscillator()
      o.type = 'square'
      const f0 = 620 + Math.random() * 180
      o.frequency.setValueAtTime(f0, t)
      o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + 0.07)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.055 * vol, t + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = 1800
      o.connect(f).connect(g).connect(dest)
      o.start(t)
      o.stop(t + 0.11)
    }
  }

  private voiceZombie(vol: number, pan: number) {
    const ctx = this.ctx!
    const t = ctx.currentTime
    const dest = this.out(this.sfxBus, pan)
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(96 + Math.random() * 14, t)
    o.frequency.linearRampToValueAtTime(72, t + 0.7)
    o.frequency.linearRampToValueAtTime(82, t + 0.95)
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 3.4
    const lfoG = ctx.createGain()
    lfoG.gain.value = 7
    lfo.connect(lfoG).connect(o.frequency)
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 340
    f.Q.value = 3
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.12 * vol, t + 0.18)
    g.gain.setValueAtTime(0.12 * vol, t + 0.7)
    g.gain.linearRampToValueAtTime(0.0001, t + 1.0)
    o.connect(f).connect(g).connect(dest)
    o.start(t); lfo.start(t)
    o.stop(t + 1.05); lfo.stop(t + 1.05)
    // breathy attack
    if (this.noiseBuf) {
      const src = ctx.createBufferSource()
      src.buffer = this.noiseBuf
      const nf = ctx.createBiquadFilter()
      nf.type = 'bandpass'
      nf.frequency.value = 260
      nf.Q.value = 0.8
      const ng = ctx.createGain()
      ng.gain.setValueAtTime(0.0001, t)
      ng.gain.linearRampToValueAtTime(0.05 * vol, t + 0.25)
      ng.gain.linearRampToValueAtTime(0.0001, t + 0.9)
      src.connect(nf).connect(ng).connect(dest)
      src.start(t)
      src.stop(t + 0.95)
    }
  }

  // ---------- environment ambience ----------
  setEnv(env: Partial<EnvState>) {
    this.env = { ...this.env, ...env }
  }

  private startAmbience() {
    if (!this.ctx || this.ambTimer !== null) return
    const tick = () => {
      this.ambTimer = setTimeout(() => {
        if (!this.paused && this.enabled && this.ctx) {
          const e = this.env
          const r = Math.random()
          if (e.underground) {
            if (r < 0.55) this.caveDrip()
            else if (r < 0.7) this.caveRumble()
          } else if (e.desert) {
            if (r < 0.5) this.windGust(0.05)
            else if (r < 0.62 && e.dayF > 0.5) this.desertBird()
          } else {
            if (e.dayF > 0.55 && r < 0.5) this.birdChirp()
            else if (e.dayF > 0.55 && r < 0.68) this.birdChirp(true)
            else if (e.dayF <= 0.4 && r < 0.55) this.cricketBurst(1)
            else if (r < 0.75) this.windGust(0.04)
          }
        }
        this.ambTimer = null
        tick()
      }, (this.env.underground ? 2500 : 3800) + Math.random() * 6000)
    }
    tick()
  }

  private startCrickets() {
    if (this.cricketTimer !== null) return
    const loop = () => {
      this.cricketTimer = setTimeout(() => {
        if (!this.paused && this.enabled && this.ctx && this.env.dayF <= 0.45 && !this.env.underground) {
          this.cricketBurst(0.4)
        }
        this.cricketTimer = null
        loop()
      }, 900 + Math.random() * 1400)
    }
    loop()
  }

  /** called by engine every frame (throttled internally) */
  updateAmbience() {
    this.startCrickets()
  }

  private birdChirp(fancy = false) {
    const ctx = this.ctx
    if (!ctx) return
    const t0 = ctx.currentTime
    const dest = this.out(this.ambBus, (Math.random() - 0.5) * 1.4)
    const n = fancy ? 4 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 2)
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.09 + Math.random() * 0.1)
      const o = ctx.createOscillator()
      o.type = 'sine'
      const f0 = 2100 + Math.random() * 1600
      o.frequency.setValueAtTime(f0, t)
      o.frequency.exponentialRampToValueAtTime(f0 * (1.2 + Math.random() * 0.5), t + 0.05)
      o.frequency.exponentialRampToValueAtTime(f0 * 0.9, t + 0.1)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.035, t + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11)
      o.connect(g).connect(dest)
      o.start(t)
      o.stop(t + 0.13)
    }
  }

  private desertBird() {
    const ctx = this.ctx
    if (!ctx) return
    const t0 = ctx.currentTime
    const dest = this.out(this.ambBus, (Math.random() - 0.5) * 1.2)
    for (let i = 0; i < 2; i++) {
      const t = t0 + i * 0.16
      const o = ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.setValueAtTime(1400, t)
      o.frequency.exponentialRampToValueAtTime(900, t + 0.12)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.028, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14)
      o.connect(g).connect(dest)
      o.start(t)
      o.stop(t + 0.16)
    }
  }

  private cricketBurst(vol: number) {
    const ctx = this.ctx
    if (!ctx || !this.noiseBuf) return
    const t0 = ctx.currentTime
    const dest = this.out(this.ambBus, (Math.random() - 0.5) * 1.6)
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.07
      const src = ctx.createBufferSource()
      src.buffer = this.noiseBuf
      src.playbackRate.value = 1.4
      const f = ctx.createBiquadFilter()
      f.type = 'bandpass'
      f.frequency.value = 4300
      f.Q.value = 14
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.02 * vol, t + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
      src.connect(f).connect(g).connect(dest)
      src.start(t)
      src.stop(t + 0.06)
    }
  }

  private windGust(vol: number) {
    const ctx = this.ctx
    if (!ctx || !this.noiseBuf) return
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    src.loop = true
    src.playbackRate.value = 0.5 + Math.random() * 0.3
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.setValueAtTime(280, t)
    f.frequency.linearRampToValueAtTime(650, t + 1.6)
    f.frequency.linearRampToValueAtTime(240, t + 3.4)
    f.Q.value = 0.5
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(vol, t + 1.4)
    g.gain.linearRampToValueAtTime(0.0001, t + 3.6)
    src.connect(f).connect(g).connect(this.out(this.ambBus, 0))
    src.start(t)
    src.stop(t + 3.8)
  }

  private caveDrip() {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(900 + Math.random() * 700, t)
    o.frequency.exponentialRampToValueAtTime(280, t + 0.07)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.06, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1)
    o.connect(g).connect(this.out(this.ambBus, (Math.random() - 0.5) * 1.6))
    o.start(t)
    o.stop(t + 0.12)
    if (this.reverb) g.connect(this.reverb)
  }

  private caveRumble() {
    const ctx = this.ctx
    if (!ctx || !this.noiseBuf) return
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    src.playbackRate.value = 0.24
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 130
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.08, t + 0.5)
    g.gain.linearRampToValueAtTime(0.0001, t + 2.2)
    src.connect(f).connect(g).connect(this.ambBus ?? ctx.destination)
    if (this.reverb) g.connect(this.reverb)
    src.start(t)
    src.stop(t + 2.4)
  }

  // ---------- generative calm music ----------
  private startMusic() {
    if (!this.ctx || this.musicTimer !== null) return
    // C major pentatonic across two octaves (original generative composition)
    const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.26, 784.0, 880.0]
    const CHORDS = [
      [130.81, 196.0, 261.63], // C
      [146.83, 220.0, 293.66], // Dm
      [174.61, 261.63, 349.23], // F
      [196.0, 246.94, 392.0],  // G
    ]
    let chordIdx = 0
    const playPluck = (freq: number, vol: number, t: number) => {
      const ctx = this.ctx!
      const o = ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = freq
      const o2 = ctx.createOscillator()
      o2.type = 'sine'
      o2.frequency.value = freq * 2
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(vol, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4)
      const g2 = ctx.createGain()
      g2.gain.setValueAtTime(0.0001, t)
      g2.gain.exponentialRampToValueAtTime(vol * 0.25, t + 0.02)
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.8)
      o.connect(g).connect(this.musBus ?? ctx.destination)
      o2.connect(g2).connect(this.musBus ?? ctx.destination)
      o.start(t); o2.start(t)
      o.stop(t + 1.5); o2.stop(t + 0.9)
    }
    const playPad = (freqs: number[], t: number) => {
      const ctx = this.ctx!
      for (const fr of freqs) {
        const o = ctx.createOscillator()
        o.type = 'sine'
        o.frequency.value = fr
        o.detune.value = (Math.random() - 0.5) * 8
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t)
        g.gain.linearRampToValueAtTime(0.022, t + 2.4)
        g.gain.setValueAtTime(0.022, t + 6.5)
        g.gain.linearRampToValueAtTime(0.0001, t + 10)
        o.connect(g).connect(this.musBus ?? ctx.destination)
        o.start(t)
        o.stop(t + 10.2)
      }
    }
    const tick = () => {
      this.musicTimer = setTimeout(() => {
        if (!this.paused && this.enabled && this.ctx) {
          const t = this.ctx.currentTime + 0.05
          const r = Math.random()
          if (r < 0.6) {
            const n = 1 + Math.floor(Math.random() * 2)
            for (let i = 0; i < n; i++) {
              const freq = SCALE[Math.floor(Math.random() * SCALE.length)]
              playPluck(freq, 0.05 + Math.random() * 0.03, t + i * (0.3 + Math.random() * 0.4))
            }
          }
          if (Math.random() < 0.3) {
            playPad(CHORDS[chordIdx % CHORDS.length], t)
            chordIdx++
          }
        }
        this.musicTimer = null
        tick()
      }, 1600 + Math.random() * 2400)
    }
    tick()
  }

  dispose() {
    if (this.ambTimer) clearTimeout(this.ambTimer)
    if (this.musicTimer) clearTimeout(this.musicTimer)
    if (this.cricketTimer) clearTimeout(this.cricketTimer)
    this.ambTimer = null
    this.musicTimer = null
    this.cricketTimer = null
    if (this.ctx) void this.ctx.close()
    this.ctx = null
    this.noiseBuf = null
    this.master = null
    this.sfxBus = null
    this.ambBus = null
    this.musBus = null
    this.reverb = null
    this.reverbGain = null
  }
}
