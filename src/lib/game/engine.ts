// VoxelEngine — main game engine: rendering, chunks, physics, interaction
import * as THREE from 'three'
import { B, BLOCKS, isSolid, isReplaceable, DEFAULT_HOTBAR, dropOf } from './blocks'
import { World, CHUNK_SX, CHUNK_SY, CHUNK_SZ } from './world'
import { meshChunk } from './mesher'
import { getAtlasCanvas, makeCrackTexture, avgColorOfTile } from './textures'
import { SoundFX } from './sound'
import { SkySystem } from './sky'
import { ParticleSystem } from './particles'
import { HandView } from './hand'
import { MobManager, FOOD_VALUE } from './mobs'

export type GameMode = 'survival' | 'creative'

export interface EngineSettings {
  renderDistance: number
  sensitivity: number
  sound: boolean
  mobs: boolean
  mode: GameMode
}

export interface EngineCallbacks {
  onReady?: () => void
  onProgress?: (p: number) => void
  /** kind: 'chunk' (non-fatal, some chunks failed) | 'loop' (repeated frame crashes) | 'gpu' (WebGL context lost) */
  onError?: (kind: 'chunk' | 'loop' | 'gpu') => void
  onFps?: (fps: number) => void
  onUnderwater?: (b: boolean) => void
  onPause?: () => void
  onFly?: (b: boolean) => void
  onSlotChange?: (i: number) => void
  onToggleInventory?: () => void
  onHealth?: (hp: number) => void
  onAir?: (air: number) => void
  onDeath?: () => void
  onDamage?: () => void
  onHunger?: (v: number) => void
  /** black fade while sleeping (0..1) */
  onSleepFade?: (v: number) => void
  /** tapped a bed during the day */
  onSleepBlocked?: () => void
  /** hunted an animal in survival mode */
  onEat?: (mobType: string, amount: number) => void
  /** survival inventory changed (block collected / consumed) — carries hotbar too (auto-stacking) */
  onInventory?: (data: { inv: Record<number, number>; hotbar: number[]; selected: number }) => void
}

export interface SavedPlayer {
  x: number; y: number; z: number; yaw: number; pitch: number; fly: boolean
  hotbar: number[]; selected: number
  bed?: { x: number; y: number; z: number } | null
  /** survival item counts per block id (0/absent = none) */
  inv?: Record<number, number>
}

const PLAYER_HALF = 0.3
const PLAYER_HEIGHT = 1.8
const EYE = 1.62
const EPS = 0.001
const DAY_LENGTH = 560 // seconds
/** chunks within this distance must exist before the player enters the game; rest streams in background */
const ESSENTIAL_R = 2.3

interface ChunkMeshEntry {
  mesh: THREE.Mesh
  water: THREE.Mesh | null
  flora: THREE.Mesh | null
}

export class VoxelEngine {
  world: World
  sfx = new SoundFX()
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private canvas: HTMLCanvasElement
  private container: HTMLElement
  private cb: EngineCallbacks
  settings: EngineSettings

  private matOpaque: THREE.MeshBasicMaterial
  private matWater: THREE.MeshBasicMaterial
  private matFlora: THREE.MeshBasicMaterial
  private waterUniforms = { uTime: { value: 0 } }
  private floraUniforms = { uTime: { value: 0 } }
  private atlasTex: THREE.CanvasTexture

  private chunkMeshes = new Map<string, ChunkMeshEntry>()
  private remeshQueue = new Set<string>()
  private genQueue: { cx: number; cz: number; d: number }[] = []
  private lastPlayerChunk = { cx: 9999, cz: 9999 }
  private initialTotal = 1
  private essentialTotal = 1
  private buildFailures = 0
  private loopErrors = 0
  private contextLost = false
  private contextLostAt = 0
  private bgTimer: ReturnType<typeof setInterval> | null = null
  private lastRafAt = 0
  private onContextLost = (e: Event) => {
    e.preventDefault()
    this.contextLost = true
    this.contextLostAt = performance.now()
  }
  private onContextRestored = () => {
    this.contextLost = false
  }

  // player
  pos = new THREE.Vector3(0, 60, 0)
  private vel = new THREE.Vector3()
  yaw = 0
  pitch = 0
  onGround = false
  flying = false
  private inWaterBody = false
  private inWaterEye = false
  private walkDist = 0
  private bobCycle = 0
  private autoJumpCd = 0
  private wasInWater = false

  // input
  private keys = new Set<string>()
  private joyX = 0
  private joyZ = 0
  private joySprint = false
  private jumpHeld = false
  private flyUp = false
  private flyDown = false
  private mouseBreak = false
  private pointerLocked = false

  // touch interaction
  private lookPointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number; moved: number; breaking: boolean }>()
  private breakingPointerId: number | null = null
  private holdTimer: ReturnType<typeof setTimeout> | null = null
  private holdTimerPointerId: number | null = null

  // interaction state
  private breaking = { key: '', progress: 0, stage: -1 }
  private crackMeshes: THREE.Mesh[] = []
  private crackTexs: THREE.CanvasTexture[] = []
  private outline: THREE.LineSegments

  private sky: SkySystem
  private particles: ParticleSystem
  private hand: HandView

  hotbar: number[] = [...DEFAULT_HOTBAR]
  selected = 0
  /** survival inventory counts per block id (stack cap 64) */
  inv: Record<number, number> = {}

  // mobs
  mobs: MobManager

  // player health
  hp = 20
  readonly maxHp = 20
  dead = false
  private air = 1
  private lastAirSent = 1
  private lastDamageT = 99
  private regenTick = 0
  private drownTick = 0
  private attackCooldown = 0
  private envTimer = 0
  private lastBrightness = 1
  private lastDayF = 1

  // survival: hunger 0..20 (10 drumsticks), exhaustion accumulates into hunger loss
  hunger = 20
  private exhaustion = 0
  private starveTick = 4

  // sleeping in a bed → skips to morning
  private sleepAnim = -1
  private sleepFrom = 0
  private sleepSpan = 0
  bedSpawn: { x: number; y: number; z: number } | null = null

  private raf = 0
  private lastT = 0
  private acc = 0
  private paused = false
  private disposed = false
  private fpsAcc = 0
  private fpsFrames = 0
  private saveTimer: ReturnType<typeof setInterval> | null = null
  private ready = false
  private fogNear = 0
  private fogFar = 0

  private onResize = () => this.resize()
  private onKeyDown = (e: KeyboardEvent) => this.keyDown(e)
  private onKeyUp = (e: KeyboardEvent) => this.keyUp(e)
  private onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.canvas
    if (!this.pointerLocked && !this.paused && this.isDesktopUser()) {
      // user pressed Esc → pause
      this.cb.onPause?.()
    }
  }

  constructor(
    canvas: HTMLCanvasElement,
    container: HTMLElement,
    opts: {
      settings: EngineSettings
      world?: World
      player?: SavedPlayer
      callbacks?: EngineCallbacks
    }
  ) {
    this.canvas = canvas
    this.container = container
    this.cb = opts.callbacks ?? {}
    this.settings = { ...opts.settings }
    this.sfx.enabled = opts.settings.sound

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    })
    // low-end devices get a lower pixel cap → faster loading + better FPS
    const lowEnd = (navigator.hardwareConcurrency ?? 8) <= 4
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowEnd ? 1.4 : 1.75))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    canvas.addEventListener('webglcontextlost', this.onContextLost)
    canvas.addEventListener('webglcontextrestored', this.onContextRestored)

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 900)
    this.scene.add(this.camera)

    // atlas texture
    const atlas = getAtlasCanvas()
    this.atlasTex = new THREE.CanvasTexture(atlas)
    this.atlasTex.magFilter = THREE.NearestFilter
    this.atlasTex.minFilter = THREE.NearestFilter
    this.atlasTex.generateMipmaps = false
    this.atlasTex.colorSpace = THREE.SRGBColorSpace

    this.matOpaque = new THREE.MeshBasicMaterial({
      map: this.atlasTex,
      vertexColors: true,
      alphaTest: 0.5,
      side: THREE.FrontSide,
    })
    this.matWater = new THREE.MeshBasicMaterial({
      map: this.atlasTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    // animated water waves (vertex shader)
    this.matWater.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.waterUniforms.uTime
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float wTop = step(0.6, fract(position.y));
          if (wTop > 0.5) {
            vec4 wwp = modelMatrix * vec4(position, 1.0);
            transformed.y += sin(uTime * 1.8 + wwp.x * 1.1) * cos(uTime * 1.45 + wwp.z * 0.9) * 0.05;
          }`)
    }
    // flora (cross plants) with wind sway
    this.matFlora = new THREE.MeshBasicMaterial({
      map: this.atlasTex,
      vertexColors: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    })
    this.matFlora.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.floraUniforms.uTime
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          if (sway > 0.5) {
            vec4 fwp = modelMatrix * vec4(position, 1.0);
            transformed.x += sin(uTime * 1.7 + fwp.x * 0.9 + fwp.z * 0.6) * 0.05;
            transformed.z += cos(uTime * 1.3 + fwp.x * 0.7 + fwp.z * 0.8) * 0.04;
          }`)
    }

    // crack textures
    for (let s = 0; s < 8; s++) {
      const tex = new THREE.CanvasTexture(makeCrackTexture(s))
      tex.magFilter = THREE.NearestFilter
      tex.minFilter = THREE.NearestFilter
      tex.generateMipmaps = false
      this.crackTexs.push(tex)
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(1.003, 1.003, 1.003),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
      )
      m.visible = false
      m.renderOrder = 50
      this.scene.add(m)
      this.crackMeshes.push(m)
    }

    // selection outline
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004))
    this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.75 }))
    this.outline.visible = false
    this.scene.add(this.outline)

    this.sky = new SkySystem()
    this.scene.add(this.sky.group)
    this.particles = new ParticleSystem(this.scene)
    this.hand = new HandView(this.matOpaque)
    this.camera.add(this.hand.group)

    // world
    this.world = opts.world ?? new World((Math.random() * 0x7fffffff) | 0)
    this.mobs = new MobManager(this.scene, this.world, this.sfx, this.particles)
    this.mobs.enabled = opts.settings.mobs ?? true
    if (opts.player) {
      this.pos.set(opts.player.x, opts.player.y, opts.player.z)
      this.yaw = opts.player.yaw
      this.pitch = opts.player.pitch
      this.flying = opts.player.fly
      this.hotbar = [...opts.player.hotbar]
      this.selected = opts.player.selected
      this.bedSpawn = opts.player.bed ?? null
      this.inv = { ...(opts.player.inv ?? {}) }
      // back-compat: saves made before the inventory system had infinite hotbar blocks
      if (!opts.player.inv && this.settings.mode === 'survival') {
        for (const id of this.hotbar) if (id && (this.inv[id] ?? 0) === 0) this.inv[id] = 64
      }
      if (this.settings.mode === 'survival' && this.flying) this.flying = false
    } else {
      const s = this.world.findSpawn()
      this.pos.set(s.x, s.y, s.z)
      if (this.settings.mode === 'survival') this.hotbar = Array(9).fill(0) // punch blocks to collect, like the original
    }

    this.scene.fog = new THREE.Fog(0x9fc8ff, 20, 100)
    this.updateFogRange()
    this.hand.setBlock(this.hotbar[this.selected])

    this.bindEvents()
    // debug hook for automated testing
    ;(window as unknown as { __voxelEngine?: VoxelEngine }).__voxelEngine = this
  }

  // ---------- lifecycle ----------
  start() {
    this.lastT = performance.now()
    this.resize()
    this.requestChunkReload()
    this.loop(this.lastT)
    this.saveTimer = setInterval(() => this.save(), 20000)
    // background pump: keeps chunk loading going when rAF is throttled
    // (hidden tab, in-app browsers, heavy GPU load) so loading never stalls
    this.bgTimer = setInterval(() => {
      if (this.disposed || this.paused) return
      const starved = performance.now() - this.lastRafAt > 1200
      if (document.hidden || starved) {
        try { this.processChunkQueues() } catch { /* ignore */ }
      }
    }, 250)
    window.addEventListener('resize', this.onResize)
    window.addEventListener('orientationchange', this.onResize)
  }

  private isDesktopUser(): boolean {
    return window.matchMedia('(pointer: fine)').matches && !('ontouchstart' in window)
  }

  setPaused(p: boolean) {
    this.paused = p
    if (p) {
      this.stopBreaking()
      if (this.pointerLocked) document.exitPointerLock()
      this.save()
    } else {
      this.lastT = performance.now()
      this.sfx.resume()
    }
    this.sfx.setPaused(p)
  }

  save() {
    this.cbSave()
  }

  private cbSave: () => void = () => {}

  setSaveHandler(fn: () => void) {
    this.cbSave = fn
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    if (this.saveTimer) clearInterval(this.saveTimer)
    if (this.bgTimer) clearInterval(this.bgTimer)
    if (this.holdTimer) clearTimeout(this.holdTimer)
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    window.removeEventListener('resize', this.onResize)
    window.removeEventListener('orientationchange', this.onResize)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    for (const [, e] of this.chunkMeshes) {
      e.mesh.geometry.dispose()
      e.water?.geometry.dispose()
    }
    this.chunkMeshes.clear()
    this.crackTexs.forEach((t) => t.dispose())
    this.crackMeshes.forEach((m) => {
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
    })
    this.outline.geometry.dispose()
    ;(this.outline.material as THREE.Material).dispose()
    this.sky.dispose()
    this.particles.dispose()
    this.hand.dispose()
    this.mobs.dispose()
    this.matOpaque.dispose()
    this.matWater.dispose()
    this.matFlora.dispose()
    this.atlasTex.dispose()
    this.sfx.dispose()
    this.world.dispose()
    this.renderer.dispose()
  }

  // ---------- settings / player state ----------
  setSettings(s: EngineSettings) {
    const rdChanged = s.renderDistance !== this.settings.renderDistance
    const modeChanged = s.mode !== this.settings.mode
    this.settings = { ...s }
    this.sfx.enabled = s.sound
    this.sfx.setEnabled(s.sound)
    this.mobs.enabled = s.mobs ?? true
    if (!this.mobs.enabled) this.mobs.clearAll()
    if (modeChanged) {
      if (this.settings.mode === 'survival' && this.flying) {
        this.flying = false
        this.vel.y = 0
        this.cb.onFly?.(false)
      }
      // moving from creative to survival: keep the placed hotbar blocks but make them finite
      if (this.settings.mode === 'survival') {
        for (const id of this.hotbar) if (id && (this.inv[id] ?? 0) === 0) this.inv[id] = 64
        this.cb.onInventory?.({ inv: { ...this.inv }, hotbar: [...this.hotbar], selected: this.selected })
      }
      this.hunger = 20
      this.exhaustion = 0
      this.starveTick = 4
      this.cb.onHunger?.(this.hunger)
    }
    if (rdChanged) {
      this.updateFogRange()
      this.requestChunkReload()
    }
  }

  setSelected(i: number) {
    this.selected = i
    this.hand.setBlock(this.hotbar[this.selected])
    this.hand.swing()
  }

  setHotbarSlot(i: number, id: number) {
    if (this.settings.mode === 'survival') return // survival slots are filled by collecting blocks
    this.hotbar[i] = id
    if (i === this.selected) this.hand.setBlock(id)
  }

  /** add collected items; auto-stacks into the hotbar (one 64-stack per id). Returns amount stored */
  private addToInv(id: number, n: number): number {
    if (!id || n <= 0) return 0
    const STACK = 64
    let left = n
    // 1) top up the existing stack
    if ((this.inv[id] ?? 0) > 0 && (this.inv[id] ?? 0) < STACK) {
      const take = Math.min(STACK - (this.inv[id] ?? 0), left)
      this.inv[id] = (this.inv[id] ?? 0) + take
      left -= take
    }
    // 2) rest into the first empty hotbar slot
    if (left > 0 && (this.inv[id] ?? 0) < STACK) {
      for (let i = 0; i < 9; i++) {
        if (!this.hotbar[i]) {
          this.hotbar[i] = id
          const take = Math.min(STACK - (this.inv[id] ?? 0), left)
          this.inv[id] = (this.inv[id] ?? 0) + take
          left -= take
          break
        }
      }
    }
    if (left === n) return 0 // inventory full
    if (this.hotbar[this.selected]) this.hand.setBlock(this.hotbar[this.selected])
    this.cb.onInventory?.({ inv: { ...this.inv }, hotbar: [...this.hotbar], selected: this.selected })
    return n - left
  }

  toggleFly() {
    if (this.settings.mode === 'survival') {
      if (this.flying) {
        this.flying = false
        this.cb.onFly?.(false)
      }
      return
    }
    this.flying = !this.flying
    this.vel.y = 0
    this.cb.onFly?.(this.flying)
  }

  /** enter the game immediately: stop waiting for remaining chunks (they stream in later) */
  forceReady() {
    if (this.ready) return
    this.genQueue.length = 0
    this.ready = true
    this.seedAnimals()
    this.cb.onReady?.()
  }

  private seedAnimals() {
    try {
      for (let i = 0; i < 40; i++) {
        const ang = Math.random() * Math.PI * 2
        const dist = 6 + Math.random() * 17
        const x = Math.floor(this.pos.x + Math.cos(ang) * dist)
        const z = Math.floor(this.pos.z + Math.sin(ang) * dist)
        const gy = this.world.highestBlock(x, z)
        const g = this.world.getBlock(x, gy, z)
        if ((g === B.GRASS || g === B.SNOW || g === B.SAND) && gy > 1) {
          const types: Array<'sheep' | 'cow' | 'pig' | 'chicken'> = ['sheep', 'cow', 'pig', 'chicken']
          this.mobs.spawnPassiveAt(types[Math.floor(Math.random() * types.length)], x + 0.5, gy + 1.05, z + 0.5)
        }
      }
    } catch { /* never block ready on seeding */ }
  }

  setJoystick(x: number, z: number, sprint: boolean) {
    this.joyX = x
    this.joyZ = z
    this.joySprint = sprint
  }

  setJump(down: boolean) {
    this.jumpHeld = down
  }

  setFlyControls(up: boolean, down: boolean) {
    this.flyUp = up
    this.flyDown = down
  }

  newWorld() {
    this.world.dispose()
    this.world = new World((Math.random() * 0x7fffffff) | 0)
    this.mobs.dispose()
    this.mobs = new MobManager(this.scene, this.world, this.sfx, this.particles)
    this.mobs.enabled = this.settings.mobs ?? true
    for (const [, e] of this.chunkMeshes) {
      e.mesh.geometry.dispose()
      e.water?.geometry.dispose()
      e.flora?.geometry.dispose()
      this.scene.remove(e.mesh)
      if (e.water) this.scene.remove(e.water)
      if (e.flora) this.scene.remove(e.flora)
    }
    this.chunkMeshes.clear()
    const s = this.world.findSpawn()
    this.pos.set(s.x, s.y, s.z)
    this.vel.set(0, 0, 0)
    this.world.time = 0.08
    this.flying = false
    this.hp = this.maxHp
    this.air = 1
    this.dead = false
    this.hunger = 20
    this.exhaustion = 0
    this.starveTick = 4
    this.bedSpawn = null
    this.sleepAnim = -1
    this.inv = {}
    if (this.settings.mode === 'survival') this.hotbar = Array(9).fill(0)
    else this.hotbar = [...DEFAULT_HOTBAR]
    this.hand.setBlock(this.hotbar[this.selected])
    this.ready = false
    this.requestChunkReload()
  }

  getWorld(): World {
    return this.world
  }

  getPlayerState(): SavedPlayer {
    return {
      x: this.pos.x, y: this.pos.y, z: this.pos.z,
      yaw: this.yaw, pitch: this.pitch, fly: this.flying,
      hotbar: [...this.hotbar], selected: this.selected,
      bed: this.bedSpawn,
      inv: { ...this.inv },
    }
  }

  // ---------- events ----------
  private bindEvents() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    this.canvas.addEventListener('pointerdown', this.canvasPointerDown)
    window.addEventListener('pointermove', this.canvasPointerMove)
    window.addEventListener('pointerup', this.canvasPointerUp)
    window.addEventListener('pointercancel', this.canvasPointerUp)
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
  }

  private onWheel = (e: WheelEvent) => {
    if (!this.pointerLocked) return
    e.preventDefault()
    const dir = e.deltaY > 0 ? 1 : -1
    const next = (this.selected + dir + 9) % 9
    this.setSelected(next)
    this.cb.onSlotChange?.(next)
  }

  private keyDown(e: KeyboardEvent) {
    if (e.repeat) return
    const k = e.code
    this.keys.add(k)
    if (k === 'Escape') return // handled by pointerlockchange / React
    if (k === 'KeyE') {
      this.cb.onToggleInventory?.()
      return
    }
    if (k >= 'Digit1' && k <= 'Digit9') {
      const i = k.charCodeAt(4) - 49
      this.setSelected(i)
      this.cb.onSlotChange?.(i)
    }
    if (k === 'KeyF') this.toggleFly()
    if (k === 'Space') {
      // double-tap space toggles fly
      const now = performance.now()
      if (now - this.lastSpaceTap < 280) {
        this.toggleFly()
        this.lastSpaceTap = now + 999 // avoid triple
      }
      this.lastSpaceTap = now
    }
  }

  private lastSpaceTap = 0

  private keyUp(e: KeyboardEvent) {
    this.keys.delete(e.code)
  }

  private canvasPointerDown = (e: PointerEvent) => {
    if (this.paused) return
    this.sfx.resume()
    if (e.pointerType === 'mouse') {
      if (!this.pointerLocked) {
        this.canvas.requestPointerLock?.()
        return
      }
      if (e.button === 0) this.mouseBreak = true
      else if (e.button === 2) this.placeAtNDC(0, 0)
      return
    }
    // touch
    try {
      this.canvas.setPointerCapture?.(e.pointerId)
    } catch {
      // synthetic pointer (automation) or already-released pointer — safe to ignore
    }
    const p = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: 0, breaking: false }
    this.lookPointers.set(e.pointerId, p)
    if (this.breakingPointerId === null && this.holdTimer === null) {
      this.holdTimerPointerId = e.pointerId
      this.holdTimer = setTimeout(() => {
        const pt = this.lookPointers.get(e.pointerId)
        if (pt && this.lookPointers.size >= 1) {
          pt.breaking = true
          this.breakingPointerId = e.pointerId
          this.holdTimer = null
        }
      }, 220)
    }
  }

  private canvasPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      if (this.pointerLocked) {
        const s = 0.0023 * this.settings.sensitivity
        this.yaw -= e.movementX * s
        this.pitch -= e.movementY * s
        this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch))
      }
      return
    }
    const p = this.lookPointers.get(e.pointerId)
    if (!p || this.paused) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    p.moved += Math.abs(dx) + Math.abs(dy)
    p.x = e.clientX
    p.y = e.clientY
    const s = 0.0042 * this.settings.sensitivity
    this.yaw -= dx * s
    this.pitch -= dy * s
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch))
  }

  private canvasPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) this.mouseBreak = false
      return
    }
    const p = this.lookPointers.get(e.pointerId)
    if (!p) return
    this.lookPointers.delete(e.pointerId)
    if (this.breakingPointerId === e.pointerId) {
      this.breakingPointerId = null
      this.stopBreaking()
    } else if (this.holdTimer && this.holdTimerPointerId === e.pointerId) {
      clearTimeout(this.holdTimer)
      this.holdTimer = null
      this.holdTimerPointerId = null
    }
    const dt = performance.now() - p.t
    if (!p.breaking && dt < 230 && p.moved < 14 && !this.paused) {
      // quick tap → attack a mob if one is targeted, otherwise place
      const rect = this.canvas.getBoundingClientRect()
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1)
      if (!this.tryAttack(ndcX, ndcY)) {
        this.placeAtNDC(ndcX, ndcY)
      }
    }
  }

  // ---------- interaction ----------
  private stopBreaking() {
    this.breaking.key = ''
    this.breaking.progress = 0
    this.breaking.stage = -1
    this.crackMeshes.forEach((m) => (m.visible = false))
  }

  private rayFromNDC(ndcX: number, ndcY: number): { origin: THREE.Vector3; dir: THREE.Vector3 } {
    const origin = new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z)
    const dir = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(this.camera).sub(origin).normalize()
    return { origin, dir }
  }

  private raycastVoxel(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { x: number; y: number; z: number; nx: number; ny: number; nz: number; id: number } | null {
    let x = Math.floor(origin.x)
    let y = Math.floor(origin.y)
    let z = Math.floor(origin.z)
    const stepX = dir.x > 0 ? 1 : -1
    const stepY = dir.y > 0 ? 1 : -1
    const stepZ = dir.z > 0 ? 1 : -1
    const tDeltaX = Math.abs(1 / (dir.x || 1e-9))
    const tDeltaY = Math.abs(1 / (dir.y || 1e-9))
    const tDeltaZ = Math.abs(1 / (dir.z || 1e-9))
    const fracX = dir.x > 0 ? x + 1 - origin.x : origin.x - x
    const fracY = dir.y > 0 ? y + 1 - origin.y : origin.y - y
    const fracZ = dir.z > 0 ? z + 1 - origin.z : origin.z - z
    let tMaxX = tDeltaX * fracX
    let tMaxY = tDeltaY * fracY
    let tMaxZ = tDeltaZ * fracZ
    let nx = 0, ny = 0, nz = 0
    let t = 0
    for (let i = 0; i < 128; i++) {
      const id = this.world.getBlock(x, y, z)
      if (id !== B.AIR && id !== B.WATER) {
        return { x, y, z, nx, ny, nz, id }
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0
      } else if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ
      }
      if (t > maxDist) return null
    }
    return null
  }

  private currentTargetNDC(): { ndcX: number; ndcY: number } | null {
    if (this.pointerLocked) return { ndcX: 0, ndcY: 0 }
    if (this.breakingPointerId !== null) {
      const p = this.lookPointers.get(this.breakingPointerId)
      if (p) {
        const rect = this.canvas.getBoundingClientRect()
        return {
          ndcX: ((p.x - rect.left) / rect.width) * 2 - 1,
          ndcY: -(((p.y - rect.top) / rect.height) * 2 - 1),
        }
      }
    }
    return null
  }

  private shouldShowOutline(): boolean {
    return this.pointerLocked || this.breakingPointerId !== null
  }

  private updateInteraction(dt: number) {
    const active = this.pointerLocked ? { ndcX: 0, ndcY: 0 } : this.currentTargetNDC()
    if (!active) {
      this.stopBreaking()
      this.outline.visible = false
      return
    }
    const { origin, dir } = this.rayFromNDC(active.ndcX, active.ndcY)
    const hit = this.raycastVoxel(origin, dir, 6)

    // outline
    if (this.shouldShowOutline() && hit) {
      this.outline.visible = true
      this.outline.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5)
    } else {
      this.outline.visible = false
    }

    const wantsBreak = this.pointerLocked ? this.mouseBreak : this.breakingPointerId !== null
    if (!wantsBreak || !hit) {
      this.stopBreaking()
      return
    }

    // attacking a mob takes priority over breaking the block behind it
    if (this.tryAttackFromRay(origin, dir, hit)) {
      this.stopBreaking()
      return
    }

    const def = BLOCKS[hit.id]
    if (!def || def.hardness < 0) {
      this.stopBreaking()
      return
    }
    const key = hit.x + ',' + hit.y + ',' + hit.z
    if (this.breaking.key !== key) {
      this.breaking.key = key
      this.breaking.progress = 0
      this.breaking.stage = -1
    }
    this.breaking.progress += dt / Math.max(0.06, def.hardness)
    const stage = Math.min(7, Math.floor(this.breaking.progress * 8))
    if (stage !== this.breaking.stage) {
      this.breaking.stage = stage
      this.crackMeshes.forEach((m, i) => (m.visible = i === stage))
      this.crackMeshes[stage].position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5)
      this.sfx.dig(def.snd)
      this.hand.swing()
    }
    if (this.breaking.progress >= 1) {
      // destroy
      const rgb = avgColorOfTile(def.tiles[2])
      this.particles.spawnBurst(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, rgb, 20)
      this.world.setBlock(hit.x, hit.y, hit.z, B.AIR)
      this.markRemesh(hit.x, hit.y, hit.z)
      this.sfx.break_(def.snd)
      if (navigator.vibrate) navigator.vibrate(24)
      if (this.settings.mode === 'survival') {
        this.exhaustion += 0.03
        // collect the block, like the original game (grass→dirt, stone→cobble…)
        this.addToInv(dropOf(hit.id), 1)
      }
      this.breaking.progress = 0
      this.breaking.key = ''
      this.stopBreaking()
    }
  }

  private placeAtNDC(ndcX: number, ndcY: number) {
    const { origin, dir } = this.rayFromNDC(ndcX, ndcY)
    const hit = this.raycastVoxel(origin, dir, 6)
    if (!hit) return
    this.hand.swing()
    const hitDef = BLOCKS[hit.id]
    if (!hitDef) return

    // sleeping in a bed
    if (hit.id === B.BED) {
      const ok = this.sleep()
      if (ok) {
        // sleeping here sets the respawn point (like the original game)
        this.bedSpawn = { x: hit.x, y: hit.y + 1, z: hit.z }
      } else {
        this.cb.onSleepBlocked?.()
      }
      return
    }

    let px: number, py: number, pz: number
    if (hitDef.replaceable) {
      px = hit.x; py = hit.y; pz = hit.z
    } else {
      px = hit.x + hit.nx; py = hit.y + hit.ny; pz = hit.z + hit.nz
    }
    if (py < 0 || py >= CHUNK_SY) return
    const existing = this.world.getBlock(px, py, pz)
    if (!isReplaceable(existing)) return

    const newId = this.hotbar[this.selected]
    const newDef = BLOCKS[newId]
    if (!newDef) return
    // survival: need items in the stack to build
    if (this.settings.mode === 'survival' && (this.inv[newId] ?? 0) <= 0) return

    // plants need solid ground below
    if (newDef.cross) {
      const below = this.world.getBlock(px, py - 1, pz)
      if (below !== B.GRASS && below !== B.DIRT && below !== B.SAND) return
    }
    // don't place solid block inside player
    if (newDef.solid) {
      const overlapX = px + 1 > this.pos.x - PLAYER_HALF && px < this.pos.x + PLAYER_HALF
      const overlapY = py + 1 > this.pos.y && py < this.pos.y + PLAYER_HEIGHT
      const overlapZ = pz + 1 > this.pos.z - PLAYER_HALF && pz < this.pos.z + PLAYER_HALF
      if (overlapX && overlapY && overlapZ) return
    }
    this.world.setBlock(px, py, pz, newId)
    this.markRemesh(px, py, pz)
    this.sfx.place(newDef.snd)
    if (navigator.vibrate) navigator.vibrate(12)
    // survival: consume one item from the stack
    if (this.settings.mode === 'survival') {
      const left = (this.inv[newId] ?? 0) - 1
      if (left <= 0) {
        delete this.inv[newId]
        this.hotbar[this.selected] = 0
        this.hand.setBlock(0)
      } else {
        this.inv[newId] = left
      }
      this.cb.onInventory?.({ inv: { ...this.inv }, hotbar: [...this.hotbar], selected: this.selected })
    }
  }

  // ---------- combat / health ----------
  /** quick tap attack via NDC — returns true if a mob was (or recently was) targeted */
  private tryAttack(ndcX: number, ndcY: number): boolean {
    const { origin, dir } = this.rayFromNDC(ndcX, ndcY)
    const blockHit = this.raycastVoxel(origin, dir, 3.8)
    return this.tryAttackFromRay(origin, dir, blockHit)
  }

  /** attack the nearest mob along the ray if it is closer than the block hit */
  private tryAttackFromRay(origin: THREE.Vector3, dir: THREE.Vector3, blockHit: { x: number; y: number; z: number } | null): boolean {
    const mobHit = this.mobs.raycast(origin, dir, 3.4)
    if (!mobHit) return false
    if (blockHit) {
      const bd = origin.distanceTo(new THREE.Vector3(blockHit.x + 0.5, blockHit.y + 0.5, blockHit.z + 0.5))
      if (bd < mobHit.dist - 0.15) return false // block is clearly in front
    }
    if (this.attackCooldown > 0) return true
    this.attackCooldown = 0.32
    this.hand.swing()
    this.sfx.swing()
    const knock = new THREE.Vector3(dir.x, 0, dir.z).normalize()
    const killed = this.mobs.damage(mobHit.mob, 4, knock)
    const dx = mobHit.mob.pos.x - origin.x
    this.sfx.thud(1, Math.max(-1, Math.min(1, dx / 10)))
    if (killed) {
      const col: [number, number, number] =
        mobHit.mob.type === 'zombie' ? [0.35, 0.6, 0.3] :
        mobHit.mob.type === 'sheep' ? [0.9, 0.9, 0.9] :
        mobHit.mob.type === 'cow' ? [0.4, 0.28, 0.2] :
        mobHit.mob.type === 'pig' ? [0.93, 0.65, 0.64] : [0.95, 0.95, 0.95]
      this.particles.spawnBurst(mobHit.mob.pos.x, mobHit.mob.pos.y + 0.6, mobHit.mob.pos.z, col, 16)
      // survival: hunted animals restore hunger
      const food = FOOD_VALUE[mobHit.mob.type]
      if (food && this.settings.mode === 'survival') {
        this.hunger = Math.min(20, this.hunger + food)
        this.cb.onHunger?.(this.hunger)
        this.cb.onEat?.(mobHit.mob.type, food)
      }
    }
    return true
  }

  damagePlayer(dmg: number, knockFrom?: THREE.Vector3) {
    if (this.dead || dmg <= 0) return
    if (this.settings.mode === 'creative') return // creative: invulnerable
    this.hp = Math.max(0, this.hp - dmg)
    this.lastDamageT = 0
    this.regenTick = 0
    this.cb.onHealth?.(this.hp)
    this.cb.onDamage?.()
    this.sfx.hurt()
    if (navigator.vibrate) navigator.vibrate(55)
    if (knockFrom) {
      const d = this.pos.clone().sub(knockFrom)
      d.y = 0
      if (d.lengthSq() > 0.001) {
        d.normalize()
        this.vel.x += d.x * 6.5
        this.vel.z += d.z * 6.5
        this.vel.y = Math.max(this.vel.y, 4.2)
        this.onGround = false
      }
    }
    if (this.hp <= 0) this.die()
  }

  private die() {
    if (this.dead) return
    this.dead = true
    this.stopBreaking()
    this.cb.onDeath?.()
  }

  /** try to sleep in a bed — only works at night; skips to morning and heals */
  sleep(): boolean {
    if (this.dead) return false
    if (this.sleepAnim >= 0) return true
    const t = this.world.time
    if (!(t > 0.52 && t < 0.98)) return false
    this.sleepFrom = t
    this.sleepSpan = ((1.02 - t) % 1 + 1) % 1
    this.sleepAnim = 0
    if (navigator.vibrate) navigator.vibrate(30)
    return true
  }

  respawn() {
    let s = this.world.findSpawn()
    if (this.bedSpawn && this.world.getBlock(this.bedSpawn.x, this.bedSpawn.y - 1, this.bedSpawn.z) === B.BED) {
      s = { x: this.bedSpawn.x + 0.5, y: this.bedSpawn.y, z: this.bedSpawn.z + 0.5 }
    }
    this.pos.set(s.x, s.y, s.z)
    this.vel.set(0, 0, 0)
    this.hp = this.maxHp
    this.air = 1
    this.lastAirSent = 1
    this.dead = false
    this.lastDamageT = 99
    this.hunger = Math.max(this.hunger, 10)
    this.exhaustion = 0
    this.starveTick = 4
    this.cb.onHealth?.(this.hp)
    this.cb.onAir?.(1)
    this.cb.onHunger?.(this.hunger)
  }

  // ---------- physics ----------
  private isSolidAt(x: number, y: number, z: number): boolean {
    return isSolid(this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)))
  }

  private collideAxis(axis: 0 | 1 | 2, delta: number): boolean {
    if (delta === 0) return false
    const p = this.pos
    if (axis === 0) p.x += delta
    else if (axis === 1) p.y += delta
    else p.z += delta

    const minX = Math.floor(p.x - PLAYER_HALF)
    const maxX = Math.floor(p.x + PLAYER_HALF)
    const minY = Math.floor(p.y)
    const maxY = Math.floor(p.y + PLAYER_HEIGHT)
    const minZ = Math.floor(p.z - PLAYER_HALF)
    const maxZ = Math.floor(p.z + PLAYER_HALF)

    let hit = false
    for (let bx = minX; bx <= maxX; bx++) {
      for (let by = minY; by <= maxY; by++) {
        for (let bz = minZ; bz <= maxZ; bz++) {
          if (!isSolid(this.world.getBlock(bx, by, bz))) continue
          hit = true
          if (axis === 1) {
            if (delta < 0) {
              p.y = by + 1 + EPS
              const impact = -this.vel.y
              if (impact > 11) this.sfx.step(this.groundMat())
              if (!this.flying && !this.inWaterBody && impact > 14) {
                this.damagePlayer(Math.min(18, Math.round((impact - 14) * 0.9)))
              }
              this.vel.y = 0
              this.onGround = true
            } else {
              p.y = by - PLAYER_HEIGHT - EPS
              this.vel.y = 0
            }
          } else if (axis === 0) {
            p.x = delta > 0 ? bx - PLAYER_HALF - EPS : bx + 1 + PLAYER_HALF + EPS
            this.vel.x = 0
          } else {
            p.z = delta > 0 ? bz - PLAYER_HALF - EPS : bz + 1 + PLAYER_HALF + EPS
            this.vel.z = 0
          }
        }
      }
    }
    return hit
  }

  private groundMat(): 'stone' | 'dirt' | 'sand' | 'wood' | 'snow' | 'plant' | 'glass' | 'generic' {
    const id = this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.5), Math.floor(this.pos.z))
    const d = BLOCKS[id]
    if (!d) return 'generic'
    if (d.snd === 'stone' || d.snd === 'dirt' || d.snd === 'sand' || d.snd === 'wood' || d.snd === 'snow' || d.snd === 'plant' || d.snd === 'glass') return d.snd
    return 'generic'
  }

  private stepPhysics(dt: number) {
    const p = this.pos
    // water state
    const bodyId = this.world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.6), Math.floor(p.z))
    this.inWaterBody = bodyId === B.WATER
    const eyeId = this.world.getBlock(Math.floor(p.x), Math.floor(p.y + EYE), Math.floor(p.z))
    const wasEye = this.inWaterEye
    this.inWaterEye = eyeId === B.WATER
    if (this.inWaterEye !== wasEye) this.cb.onUnderwater?.(this.inWaterEye)
    if (this.inWaterBody && !this.wasInWater && Math.abs(this.vel.y) > 5) this.sfx.splash()
    this.wasInWater = this.inWaterBody

    // drowning / air
    if (this.inWaterEye && !this.dead) {
      this.air -= dt / 12
      if (this.air <= 0) {
        this.air = 0
        this.drownTick -= dt
        if (this.drownTick <= 0) {
          this.drownTick = 1.2
          this.damagePlayer(2)
        }
        if (Math.random() < dt * 2.5) this.sfx.bubble()
      }
    } else if (!this.dead) {
      this.air = Math.min(1, this.air + dt / 2.5)
    }
    if (Math.abs(this.air - this.lastAirSent) > 0.055 || (this.air === 1 && this.lastAirSent !== 1)) {
      this.lastAirSent = this.air
      this.cb.onAir?.(this.air)
    }

    // wish direction
    let wx = this.joyX
    let wz = this.joyZ
    if (this.dead) {
      wx = 0
      wz = 0
      this.joyX = 0
      this.joyZ = 0
      this.jumpHeld = false
    }
    if (!this.dead) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) wz -= 1
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) wz += 1
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) wx -= 1
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) wx += 1
    }
    const keysSprint = this.keys.has('ShiftLeft') && !this.flying
    let sprint = this.joySprint || keysSprint
    const mag = Math.hypot(wx, wz)
    if (mag > 1) { wx /= mag; wz /= mag }
    const moveMag = Math.min(1, mag)
    sprint = sprint && moveMag > 0.6

    // camera-relative basis (yaw only)
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    // forward = (-sin, -cos) in xz for yaw around Y
    const dirX = -sin * -wz + cos * wx
    const dirZ = -cos * -wz + sin * wx

    const speedBase = this.flying ? (sprint ? 13 : 8.5) : this.inWaterBody ? 2.7 : sprint ? 5.9 : 4.35
    const targetVx = dirX * speedBase * moveMag
    const targetVz = dirZ * speedBase * moveMag

    const accel = this.flying ? 40 : this.onGround ? 55 : this.inWaterBody ? 22 : 18
    this.vel.x += (targetVx - this.vel.x) * Math.min(1, accel * dt)
    this.vel.z += (targetVz - this.vel.z) * Math.min(1, accel * dt)

    if (this.flying) {
      let vy = 0
      const keyUp = this.keys.has('Space')
      const keyDown = this.keys.has('ShiftLeft')
      if (this.jumpHeld || keyUp) vy += 8.5
      if (this.flyDown || keyDown) vy -= 8.5
      this.vel.y += (vy - this.vel.y) * Math.min(1, 30 * dt)
    } else if (this.inWaterBody) {
      this.vel.y -= 7 * dt
      if (this.jumpHeld || this.keys.has('Space')) this.vel.y += 26 * dt
      this.vel.y = Math.max(-3.2, Math.min(3.4, this.vel.y))
    } else {
      this.vel.y -= 27 * dt
      this.vel.y = Math.max(-42, this.vel.y)
      if ((this.jumpHeld || this.keys.has('Space')) && this.onGround) {
        this.vel.y = 8.6
        this.onGround = false
        this.sfx.jump()
        if (this.settings.mode === 'survival') this.exhaustion += 0.1
      }
    }

    this.onGround = false
    const hitX = this.collideAxis(0, this.vel.x * dt)
    const hitZ = this.collideAxis(2, this.vel.z * dt)
    this.collideAxis(1, this.vel.y * dt)

    // auto-jump (mobile-friendly) — only when walking into a 1-high step
    if (!this.flying && (hitX || hitZ) && moveMag > 0.4 && this.autoJumpCd <= 0) {
      const stepX = p.x + dirX * 0.7
      const stepZ = p.z + dirZ * 0.7
      const feetBlocked = this.isSolidAt(stepX, p.y + 0.4, stepZ)
      const clear1 = !this.isSolidAt(stepX, p.y + 1.4, stepZ)
      const clear2 = !this.isSolidAt(stepX, p.y + 2.4, stepZ)
      if (feetBlocked && clear1 && clear2) {
        this.vel.y = 7.4
        this.onGround = false
        this.autoJumpCd = 0.35
      }
    }
    this.autoJumpCd = Math.max(0, this.autoJumpCd - dt)

    // safety: fell out of the world
    if (p.y < -8) {
      const s = this.world.findSpawn()
      p.set(s.x, s.y, s.z)
      this.vel.set(0, 0, 0)
    }

    // walk bob + footsteps
    const speedXZ = Math.hypot(this.vel.x, this.vel.z)
    if (this.onGround && speedXZ > 0.6) {
      this.walkDist += speedXZ * dt
      this.bobCycle += dt * speedXZ * 1.85
      if (this.walkDist > 2.1) {
        this.walkDist = 0
        this.sfx.step(this.groundMat())
      }
    }

    // survival: activity drains hunger
    if (this.settings.mode === 'survival' && !this.dead) {
      this.exhaustion += (sprint ? 0.1 : speedXZ > 0.5 ? 0.016 : 0.004) * dt
    }

    return { speedXZ, sprint }
  }

  // ---------- chunks ----------
  private updateFogRange() {
    const far = this.settings.renderDistance * CHUNK_SX
    this.fogFar = Math.max(40, far + 6)
    this.fogNear = this.fogFar * 0.45
    this.camera.far = Math.max(300, this.fogFar + 220)
    this.camera.updateProjectionMatrix()
  }

  private requestChunkReload() {
    const cx = Math.floor(this.pos.x / CHUNK_SX)
    const cz = Math.floor(this.pos.z / CHUNK_SZ)
    this.lastPlayerChunk = { cx, cz }
    this.world.setCenter(cx, cz)
    this.genQueue = []
    const rd = this.settings.renderDistance
    for (let dx = -rd; dx <= rd; dx++) {
      for (let dz = -rd; dz <= rd; dz++) {
        const d = Math.hypot(dx, dz)
        if (d > rd + 0.4) continue
        this.genQueue.push({ cx: cx + dx, cz: cz + dz, d })
      }
    }
    this.genQueue.sort((a, b) => a.d - b.d)
    this.initialTotal = Math.max(1, this.genQueue.length)
    this.essentialTotal = Math.max(1, this.genQueue.filter((i) => i.d <= ESSENTIAL_R).length)
  }

  private buildChunkMesh(cx: number, cz: number) {
    const key = World.key(cx, cz)
    // ensure neighbor data exists (AO reads across borders)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) this.world.getChunkData(cx + dx, cz + dz)
    }
    const data = meshChunk(this.world, cx, cz)
    const old = this.chunkMeshes.get(key)
    if (old) {
      this.scene.remove(old.mesh)
      old.mesh.geometry.dispose()
      if (old.water) {
        this.scene.remove(old.water)
        old.water.geometry.dispose()
      }
      if (old.flora) {
        this.scene.remove(old.flora)
        old.flora.geometry.dispose()
      }
      this.chunkMeshes.delete(key)
    }
    const makeMesh = (arr: NonNullable<ReturnType<typeof meshChunk>['opaque']>, mat: THREE.Material, renderOrder: number) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(arr.positions, 3))
      g.setAttribute('color', new THREE.BufferAttribute(arr.colors, 3))
      g.setAttribute('uv', new THREE.BufferAttribute(arr.uvs, 2))
      g.setIndex(new THREE.BufferAttribute(arr.indices, 1))
      g.computeBoundingSphere()
      const m = new THREE.Mesh(g, mat)
      m.position.set(cx * CHUNK_SX, 0, cz * CHUNK_SZ)
      m.matrixAutoUpdate = false
      m.updateMatrix()
      m.renderOrder = renderOrder
      this.scene.add(m)
      return m
    }
    let waterMesh: THREE.Mesh | null = null
    let floraMesh: THREE.Mesh | null = null
    const entry: ChunkMeshEntry = { mesh: null as unknown as THREE.Mesh, water: null, flora: null }
    if (data.opaque) {
      entry.mesh = makeMesh(data.opaque, this.matOpaque, 0)
    }
    if (data.water) {
      waterMesh = makeMesh(data.water, this.matWater, 10)
      entry.water = waterMesh
    }
    if (data.flora) {
      floraMesh = makeMesh(data.flora, this.matFlora, 5)
      entry.flora = floraMesh
    }
    if (!data.opaque && !data.water && !data.flora) {
      // empty chunk — store placeholder mesh removed
      this.chunkMeshes.set(key, { mesh: new THREE.Mesh(new THREE.BufferGeometry(), this.matOpaque), water: null, flora: null })
      this.scene.remove(this.chunkMeshes.get(key)!.mesh)
    } else {
      this.chunkMeshes.set(key, entry)
    }
  }

  private markRemesh(x: number, y: number, z: number) {
    const cx = Math.floor(x / CHUNK_SX)
    const cz = Math.floor(z / CHUNK_SZ)
    const lx = x - cx * CHUNK_SX
    const lz = z - cz * CHUNK_SZ
    const keys = new Set<string>()
    keys.add(World.key(cx, cz))
    if (lx === 0) keys.add(World.key(cx - 1, cz))
    if (lx === CHUNK_SX - 1) keys.add(World.key(cx + 1, cz))
    if (lz === 0) keys.add(World.key(cx, cz - 1))
    if (lz === CHUNK_SZ - 1) keys.add(World.key(cx, cz + 1))
    for (const k of keys) {
      if (this.chunkMeshes.has(k)) this.buildChunkMesh(
        Number(k.split(',')[0]), Number(k.split(',')[1])
      )
    }
  }

  private processChunkQueues() {
    const cx = Math.floor(this.pos.x / CHUNK_SX)
    const cz = Math.floor(this.pos.z / CHUNK_SZ)
    if (cx !== this.lastPlayerChunk.cx || cz !== this.lastPlayerChunk.cz) {
      this.requestChunkReload()
    }
    const start = performance.now()
    const budget = this.ready ? 6 : 14
    while (this.genQueue.length > 0 && performance.now() - start < budget) {
      const item = this.genQueue[0]
      const key = World.key(item.cx, item.cz)
      try {
        if (!this.chunkMeshes.has(key)) {
          this.buildChunkMesh(item.cx, item.cz)
          // stop if we blew the budget on this chunk
          if (performance.now() - start > budget) {
            this.genQueue.shift()
            break
          }
        }
      } catch (err) {
        // never let one bad chunk hang loading forever — skip it
        console.error('chunk build failed', item.cx, item.cz, err)
        this.buildFailures++
        if (this.buildFailures > 6) {
          this.cb.onError?.('chunk')
          this.buildFailures = 0
          if (!this.ready) {
            // give up on the rest of the queue and enter the game
            this.genQueue.length = 0
          }
        }
      }
      this.genQueue.shift()
    }
    if (!this.ready) {
      // ready as soon as all essential (near) chunks are built — the rest streams in background
      let remaining = 0
      for (const item of this.genQueue) {
        if (item.d <= ESSENTIAL_R && !this.chunkMeshes.has(World.key(item.cx, item.cz))) remaining++
      }
      const done = Math.max(0, this.essentialTotal - remaining)
      this.cb.onProgress?.(Math.min(1, done / this.essentialTotal))
      if (remaining === 0) {
        this.ready = true
        this.cb.onReady?.()
        this.seedAnimals()
      }
    }
    // unload distant meshes occasionally
    if (Math.random() < 0.02) {
      const rd = this.settings.renderDistance + 2
      for (const [key, e] of this.chunkMeshes) {
        const [kx, kz] = key.split(',').map(Number)
        if (Math.abs(kx - cx) > rd || Math.abs(kz - cz) > rd) {
          e.mesh.geometry.dispose()
          e.water?.geometry.dispose()
          e.flora?.geometry.dispose()
          this.scene.remove(e.mesh)
          if (e.water) this.scene.remove(e.water)
          if (e.flora) this.scene.remove(e.flora)
          this.chunkMeshes.delete(key)
        }
      }
    }
  }

  // ---------- loop ----------
  private loop = (t: number) => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    this.lastRafAt = performance.now()
    try {
      this.frame(t)
      this.loopErrors = 0
    } catch (err) {
      // a crashing frame must never kill the game loop or hang loading
      console.error('frame error', err)
      this.loopErrors++
      if (this.loopErrors > 8) {
        this.loopErrors = 0
        this.cb.onError?.('loop')
      }
    }
  }

  private frame(t: number) {
    const dtRaw = (t - this.lastT) / 1000
    this.lastT = t
    const dt = Math.min(0.1, Math.max(0.0001, dtRaw))

    // WebGL context lost (GPU reset / backgrounded low-memory device):
    // keep building chunks so loading can finish, skip all GPU work
    if (this.contextLost) {
      try { this.processChunkQueues() } catch { /* ignore */ }
      if (!this.ready && performance.now() - this.contextLostAt > 8000) {
        this.cb.onError?.('gpu')
      }
      return
    }

    if (!this.paused) {
      // fixed-step physics
      this.acc += dt
      let speedXZ = 0
      let sprint = false
      const STEP = 1 / 60
      let steps = 0
      while (this.acc >= STEP && steps < 5) {
        const r = this.stepPhysics(STEP)
        speedXZ = r.speedXZ
        sprint = r.sprint
        this.acc -= STEP
        steps++
      }
      // day/night — sleeping fast-forwards the clock with a black fade
      if (this.sleepAnim >= 0) {
        this.sleepAnim = Math.min(1, this.sleepAnim + dt / 2.6)
        const p = this.sleepAnim
        this.world.time = (this.sleepFrom + this.sleepSpan * p) % 1
        const fade = p < 0.32 ? p / 0.32 : p > 0.84 ? Math.max(0, (1 - p) / 0.16) : 1
        this.cb.onSleepFade?.(fade)
        if (p >= 1) {
          this.sleepAnim = -1
          this.cb.onSleepFade?.(0)
          this.hp = this.maxHp
          this.cb.onHealth?.(this.hp)
          if (this.settings.mode === 'survival' && this.hunger < 14) {
            this.hunger = Math.min(20, this.hunger + 4)
            this.cb.onHunger?.(this.hunger)
          }
        }
      } else {
        this.world.time = (this.world.time + dt / DAY_LENGTH) % 1
      }

      // combat cooldowns + regen
      this.attackCooldown = Math.max(0, this.attackCooldown - dt)
      this.lastDamageT += dt

      // survival hunger cycle
      if (this.settings.mode === 'survival' && !this.dead) {
        if (this.exhaustion >= 4) {
          this.exhaustion -= 4
          if (this.hunger > 0) {
            this.hunger--
            this.cb.onHunger?.(this.hunger)
          }
        }
        if (this.hunger <= 0) {
          this.starveTick -= dt
          if (this.starveTick <= 0) {
            this.starveTick = 4
            if (this.hp > 2) this.damagePlayer(1) // starving hurts but never kills
          }
        }
      }

      if (!this.dead && this.hp > 0 && this.hp < this.maxHp && this.lastDamageT > 8) {
        const canRegen = this.settings.mode !== 'survival' || this.hunger >= 18
        if (canRegen) {
          this.regenTick += dt
          if (this.regenTick >= 2.2) {
            this.regenTick = 0
            this.hp = Math.min(this.maxHp, this.hp + 1)
            if (this.settings.mode === 'survival') this.exhaustion += 0.5
            this.cb.onHealth?.(this.hp)
          }
        }
      }

      this.updateInteraction(dt)
      this.processChunkQueues()
      this.particles.update(dt)

      // mobs
      {
        this.mobs.update(dt, this.pos, this.lastDayF, !this.dead && this.sleepAnim < 0, (dmg, from) => {
          this.damagePlayer(dmg, from)
        })
      }

      // ambient sound environment (2 Hz)
      this.envTimer -= dt
      if (this.envTimer <= 0) {
        this.envTimer = 0.5
        const surface = this.world.terrainHeight(Math.floor(this.pos.x), Math.floor(this.pos.z))
        const underground = this.pos.y < surface - 5
        const biome = this.world.biomeAt(Math.floor(this.pos.x), Math.floor(this.pos.z))
        this.sfx.setEnv({ dayF: this.lastDayF, underground, desert: biome === 'desert' })
        this.sfx.updateAmbience()
      }

      // camera
      const bobY = this.onGround ? Math.sin(this.bobCycle * 2) * 0.05 * Math.min(1, speedXZ / 4) : 0
      const bobRoll = this.onGround ? Math.cos(this.bobCycle) * 0.004 * Math.min(1, speedXZ / 4) : 0
      this.camera.position.set(this.pos.x, this.pos.y + EYE + bobY, this.pos.z)
      this.camera.rotation.set(0, 0, 0)
      this.camera.rotateY(this.yaw)
      this.camera.rotateX(this.pitch)
      this.camera.rotateZ(bobRoll)

      const targetFov = sprint ? 82 : 75
      if (Math.abs(this.camera.fov - targetFov) > 0.2) {
        this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 8)
        this.camera.updateProjectionMatrix()
      }

      this.hand.update(dt, speedXZ, this.onGround)

      // sky + fog + tint
      const camPos = this.camera.position
      const { sky, brightness, tint } = this.sky.update(this.world.time, camPos, this.scene, dt)
      const fog = this.scene.fog as THREE.Fog
      if (this.inWaterEye) {
        fog.color.setRGB(0.05 * brightness + 0.02, 0.15 * brightness + 0.03, 0.4 * brightness + 0.06)
        fog.near = 2
        fog.far = 22
      } else {
        fog.color.copy(sky)
        fog.near = this.fogNear
        fog.far = this.fogFar
      }
      this.scene.background = this.inWaterEye ? fog.color : sky
      this.matOpaque.color.copy(tint)
      this.matWater.color.copy(tint)
      this.matFlora.color.copy(tint)
      // mobs get their own slightly-boosted light so animals stay readable at night
      this.mobs.setLight(
        new THREE.Color(
          Math.min(1, tint.r * 1.25 + 0.05),
          Math.min(1, tint.g * 1.25 + 0.05),
          Math.min(1, tint.b * 1.25 + 0.09)
        )
      )
      this.lastBrightness = brightness
      this.lastDayF = Math.max(0, Math.min(1, (brightness - 0.1) / 0.9))
      this.waterUniforms.uTime.value += dt
      this.floraUniforms.uTime.value += dt

      // fps
      this.fpsAcc += dt
      this.fpsFrames++
      if (this.fpsAcc >= 0.5) {
        this.cb.onFps?.(Math.round(this.fpsFrames / this.fpsAcc))
        this.fpsAcc = 0
        this.fpsFrames = 0
      }
    }

    this.renderer.render(this.scene, this.camera)
  }

  private resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }
}
