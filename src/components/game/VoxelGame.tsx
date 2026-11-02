'use client'

// Block Craft — mobile-first voxel building game UI (Persian)
import { useCallback, useEffect, useRef, useState } from 'react'
import { VoxelEngine, type EngineSettings, type SavedPlayer } from '@/lib/game/engine'
import { World, type WorldSaveData } from '@/lib/game/world'
import { BLOCKS, DEFAULT_HOTBAR, PLACEABLE } from '@/lib/game/blocks'
import { blockIconDataURL, dirtBackgroundDataURL } from '@/lib/game/textures'

const SAVE_KEY = 'blockcraft.world.v1'
const SETTINGS_KEY = 'blockcraft.settings.v2'

/** weak phones get a smaller default view distance so the world loads fast */
const defaultRenderDistance = (): number => {
  try {
    const nav = navigator as Navigator & { deviceMemory?: number }
    const mem = nav.deviceMemory ?? 8
    const cores = nav.hardwareConcurrency ?? 8
    if (mem <= 3 || cores <= 4) return 2
  } catch { /* ignore */ }
  return 3
}

const DEFAULT_SETTINGS: EngineSettings = { renderDistance: defaultRenderDistance(), sensitivity: 1, sound: true, mobs: true, mode: 'survival' }

const MOB_NAME_FA: Record<string, string> = { sheep: 'گوسفند', cow: 'گاو', pig: 'خوک', chicken: 'مرغ' }

function loadSettings(): EngineSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
    // migrate v1 settings
    const raw1 = localStorage.getItem('blockcraft.settings.v1')
    if (raw1) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw1) }
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS
}

function loadSave(): { world: WorldSaveData; player: SavedPlayer } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as { world: WorldSaveData; player: SavedPlayer }
    if (!data?.world?.seed && data?.world?.seed !== 0) return null
    return data
  } catch {
    return null
  }
}

const isTouchDevice = () =>
  typeof window !== 'undefined' && (('ontouchstart' in window) || window.matchMedia('(pointer: coarse)').matches)

const hasWebGL = (): boolean => {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'))
  } catch {
    return false
  }
}

type Phase = 'menu' | 'loading' | 'playing' | 'error'

const LOAD_TIPS = [
  'در حال ساخت کوه‌ها و دره‌ها…',
  'کاشتن جنگل‌ها و گل‌ها…',
  'بیدار کردن حیوانات…',
  'آماده‌سازی غارها و معدن…',
  'تنظیم آسمان و ابرها…',
]

const ERR_TEXT: Record<string, string> = {
  loop: 'بازی چند بار خطای داخلی داد و متوقف شد. معمولاً با یک تلاش دوباره یا بستن برنامه‌های دیگر درست می‌شود.',
  gpu: 'کارت گرافیک گوشی قطع شد (حافظه کم بود). بازی را دوباره اجرا کنید؛ اگر تکرار شد فاصله دید را در تنظیمات کم کنید.',
  init: 'راه‌اندازی موتور بازی ممکن نشد. مرورگر شما احتمالاً از WebGL پشتیبانی نمی‌کند — با کروم یا فایرفاکس امتحان کنید و شتاب سخت‌افزاری را روشن کنید.',
}

export default function VoxelGame() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<VoxelEngine | null>(null)

  const [phase, setPhase] = useState<Phase>('menu')
  const [paused, setPaused] = useState(false)
  const [invOpen, setInvOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [fps, setFps] = useState(0)
  const [underwater, setUnderwater] = useState(false)
  const [flying, setFlying] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [progress, setProgress] = useState(0)
  const [settings, setSettings] = useState<EngineSettings>(DEFAULT_SETTINGS)
  const [isTouch, setIsTouch] = useState(() => isTouchDevice())
  const [hasSave, setHasSave] = useState(false)
  const [toast, setToast] = useState('')
  const [slots, setSlots] = useState<number[]>([...DEFAULT_HOTBAR])
  const [counts, setCounts] = useState<Record<number, number>>({})
  const [sel, setSel] = useState(0)
  const [hp, setHp] = useState(20)
  const [air, setAir] = useState(1)
  const [dead, setDead] = useState(false)
  const [dmgFlash, setDmgFlash] = useState(false)
  const [showBlockName, setShowBlockName] = useState(false)
  const [pickerForSlot, setPickerForSlot] = useState<number | null>(null)
  const [errMsg, setErrMsg] = useState('')
  const [stalled, setStalled] = useState(false)
  const [loadSecs, setLoadSecs] = useState(0)
  const [hunger, setHunger] = useState(20)
  const [sleepFade, setSleepFade] = useState(0)
  const [dirtBg, setDirtBg] = useState('')
  const [mounted, setMounted] = useState(false)

  const lastModeRef = useRef<'continue' | 'new'>('new')
  const lastProgChangeRef = useRef(0)
  const lastPctRef = useRef(-1)

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blockNameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dmgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const slotPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const slotPressedRef = useRef(false)
  const sleepFadeRef = useRef(0)
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 1800)
  }, [])

  // D-pad state (DOM refs to avoid re-renders) — Minecraft pocket-edition style
  const dpadRef = useRef<HTMLDivElement>(null)
  const dpadIdRef = useRef<number | null>(null)
  const dpadActiveRef = useRef('')
  const dpadSprintRef = useRef(false)
  const lastFwdTapRef = useRef(0)
  const dpadArrowRefs = useRef<Array<HTMLDivElement | null>>([null, null, null, null]) // up, right, down, left
  const lastJumpTapRef = useRef(0)
  const flyUpRef = useRef(false)
  const flyDownRef = useRef(false)

  const applyFlyControls = useCallback(() => {
    engineRef.current?.setFlyControls(flyUpRef.current, flyDownRef.current)
  }, [])

  const saveAll = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    try {
      const data = { world: engine.getWorld().exportSave(), player: engine.getPlayerState() }
      localStorage.setItem(SAVE_KEY, JSON.stringify(data))
      setHasSave(true)
    } catch { /* storage full */ }
  }, [])

  const stopGame = useCallback(() => {
    saveAll()
    engineRef.current?.dispose()
    engineRef.current = null
    setPaused(false)
    setPhase('menu')
    setHasSave(!!loadSave())
  }, [saveAll])

  const enterNow = useCallback(() => {
    const eng = engineRef.current
    if (!eng) { stopGame(); return }
    try { eng.forceReady() } catch { /* ignore */ }
    setStalled(false)
    setPhase('playing')
    setPaused(false)
  }, [stopGame])

  const startGame = useCallback((mode: 'continue' | 'new') => {
    if (!canvasRef.current || !wrapRef.current) return
    lastModeRef.current = mode
    // detect missing WebGL early (some in-app browsers) → clear error instead of infinite loading
    if (!hasWebGL()) {
      setErrMsg(ERR_TEXT.init)
      setPhase('error')
      return
    }
    engineRef.current?.dispose()
    engineRef.current = null
    const s = loadSettings()
    setSettings(s)
    const saved = mode === 'continue' ? loadSave() : null

    try {
      const world = new World(saved ? saved.world.seed : (Math.random() * 0x7fffffff) | 0)
      if (saved) world.applySave(saved.world)

      const engine = new VoxelEngine(canvasRef.current, wrapRef.current, {
        settings: s,
        world,
        player: saved ? saved.player : undefined,
        callbacks: {
          onReady: () => {
            setStalled(false)
            setPhase('playing')
            setPaused(false)
            setHunger(20)
          },
          onProgress: (p) => {
            // only react to real percent changes — the engine reports every frame,
            // and re-rendering React 60×/s during loading slows weak phones badly.
            // This also makes the 15s-stall watchdog meaningful.
            const pct = Math.round(Math.max(0, Math.min(1, p)) * 100)
            if (pct !== lastPctRef.current) {
              lastPctRef.current = pct
              lastProgChangeRef.current = performance.now()
              setProgress(pct / 100)
            }
          },
          onError: (kind) => {
            if (kind === 'chunk') {
              showToast('چند بخش از دنیا ساخته نشد — ممکن است حفره‌هایی ببینید')
              return
            }
            setErrMsg(ERR_TEXT[kind] ?? ERR_TEXT.init)
            setPhase('error')
          },
          onFps: (f) => setFps(f),
          onUnderwater: (b) => setUnderwater(b),
          onFly: (b) => setFlying(b),
          onSlotChange: (i) => setSel(i),
          onToggleInventory: () => {
            if (s.mode === 'creative') setInvOpen((v) => !v)
          },
          onHealth: (v) => setHp(v),
          onAir: (v) => setAir(v),
          onHunger: (v) => setHunger(v),
          onSleepFade: (v) => {
            const q = Math.round(v * 20) / 20
            if (q !== sleepFadeRef.current) {
              sleepFadeRef.current = q
              setSleepFade(q)
            }
          },
          onSleepBlocked: () => showToast('فقط وقتی شب است می‌توان خوابید — تا غروب صبر کن!'),
          onEat: (mobType, amount) => showToast(`${MOB_NAME_FA[mobType] ?? mobType} شکار شد! +${amount} گرسنگی`),
          onInventory: (d) => {
            setCounts({ ...d.inv })
            setSlots([...d.hotbar])
            setSel(d.selected)
          },
          onDeath: () => setDead(true),
          onDamage: () => {
            setDmgFlash(true)
            if (dmgTimer.current) clearTimeout(dmgTimer.current)
            dmgTimer.current = setTimeout(() => setDmgFlash(false), 280)
          },
          onPause: () => {
            setPaused(true)
          },
        },
      })
      engineRef.current = engine
      engine.setSaveHandler(saveAll)
      // switch UI to loading BEFORE the engine starts — onReady may fire on the first frame
      setSlots([...engine.hotbar])
      setCounts({ ...engine.inv })
      setSel(engine.selected)
      setPhase('loading')
      setProgress(0)
      lastPctRef.current = -1
      lastProgChangeRef.current = performance.now()
      setLoadSecs(0)
      setStalled(false)
      try { engine.sfx.resume() } catch { /* audio is optional */ }
      engine.start()
    } catch (err) {
      console.error('failed to start game', err)
      try { engineRef.current?.dispose() } catch { /* ignore */ }
      engineRef.current = null
      setErrMsg(ERR_TEXT.init)
      setPhase('error')
    }
  }, [saveAll, showToast])

  // loading watchdog: if progress stalls or takes too long, offer "enter now / retry"
  useEffect(() => {
    if (phase !== 'loading') return
    const startedAt = performance.now()
    const iv = setInterval(() => {
      const now = performance.now()
      const elapsed = (now - startedAt) / 1000
      setLoadSecs(Math.floor(elapsed))
      if (now - lastProgChangeRef.current > 15000 || elapsed > 75) {
        setStalled(true)
      }
    }, 1000)
    return () => clearInterval(iv)
  }, [phase])

  // pause on tab hidden
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && phase === 'playing' && !paused) {
        saveAll()
        setPaused(true)
      }
    }
    document.addEventListener('visibilitychange', onHide)
    const onBeforeUnload = () => saveAll()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [phase, paused, saveAll])

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  useEffect(() => () => {
    engineRef.current?.dispose()
    engineRef.current = null
  }, [])

  // game is interactive-ready → remove the static pre-hydration loading shell
  useEffect(() => {
    document.getElementById('bc-shell')?.remove()
    // browser-only state loads AFTER hydration so server/client markup stays identical:
    // block icons (canvas → dataURL), dirt menu background, saved world + settings
    const raf = requestAnimationFrame(() => {
      setMounted(true)
      setDirtBg(dirtBackgroundDataURL())
      setHasSave(!!loadSave())
      setSettings(loadSettings())
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  const togglePause = useCallback((p: boolean) => {
    engineRef.current?.setPaused(p)
    setPaused(p)
    if (p) saveAll()
  }, [saveAll])

  const applySettings = useCallback((s: EngineSettings) => {
    setSettings(s)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
    engineRef.current?.setSettings(s)
  }, [])

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await wrapRef.current?.requestFullscreen()
        try {
          // best-effort landscape lock on Android
          const so = screen.orientation as unknown as { lock?: (o: string) => Promise<void> }
          await so?.lock?.('landscape')
        } catch { /* not supported */ }
      } else {
        await document.exitFullscreen()
      }
    } catch { /* not supported */ }
  }, [])

  const selectSlot = useCallback((i: number) => {
    setSel(i)
    engineRef.current?.setSelected(i)
    if (navigator.vibrate) navigator.vibrate(8)
    // brief block-name label above hotbar
    setShowBlockName(true)
    if (blockNameTimer.current) clearTimeout(blockNameTimer.current)
    blockNameTimer.current = setTimeout(() => setShowBlockName(false), 1400)
  }, [])

  const cycleSlot = useCallback((dir: 1 | -1) => {
    setSel((prev) => {
      const next = (prev + dir + 9) % 9
      engineRef.current?.setSelected(next)
      return next
    })
    if (navigator.vibrate) navigator.vibrate(6)
    setShowBlockName(true)
    if (blockNameTimer.current) clearTimeout(blockNameTimer.current)
    blockNameTimer.current = setTimeout(() => setShowBlockName(false), 1400)
  }, [])

  const onSlotPointerDown = useCallback((i: number) => {
    slotPressedRef.current = false
    selectSlot(i)
    if (settings.mode !== 'creative') return // survival slots fill by collecting — no picker
    if (slotPressTimer.current) clearTimeout(slotPressTimer.current)
    slotPressTimer.current = setTimeout(() => {
      // long press → open picker for this slot
      slotPressedRef.current = true
      setPickerForSlot(i)
      setInvOpen(true)
      if (navigator.vibrate) navigator.vibrate(18)
    }, 420)
  }, [selectSlot, settings.mode])

  const onSlotPointerUp = useCallback(() => {
    if (slotPressTimer.current) {
      clearTimeout(slotPressTimer.current)
      slotPressTimer.current = null
    }
  }, [])

  const assignBlock = useCallback((id: number) => {
    const slot = pickerForSlot ?? sel
    engineRef.current?.setHotbarSlot(slot, id)
    engineRef.current?.setSelected(slot)
    setSlots((prev) => {
      const next = [...prev]
      next[slot] = id
      return next
    })
    setSel(slot)
    setInvOpen(false)
    setPickerForSlot(null)
    showToast(`${BLOCKS[id]?.name ?? ''} انتخاب شد`)
  }, [sel, pickerForSlot, showToast])

  // ---------- D-pad handlers (8-direction, corners = diagonal) ----------
  const DPAD_NAMES = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right']
  const DPAD_VEC: Record<string, [number, number]> = {
    up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
    'up-right': [0.707, -0.707], 'up-left': [-0.707, -0.707],
    'down-right': [0.707, 0.707], 'down-left': [-0.707, 0.707],
  }

  const setDpadVisual = (active: string) => {
    const names = ['up', 'right', 'down', 'left']
    dpadArrowRefs.current.forEach((el, i) => {
      if (!el) return
      const on = active.includes(names[i])
      el.style.background = on ? 'rgba(255,255,255,0.28)' : 'rgba(20,20,20,0.42)'
      el.style.borderColor = on ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.38)'
    })
  }

  const applyDpad = (name: string) => {
    if (name === dpadActiveRef.current) return
    dpadActiveRef.current = name
    setDpadVisual(name)
    if (!name) {
      engineRef.current?.setJoystick(0, 0, false)
      return
    }
    const vec = DPAD_VEC[name] ?? [0, 0]
    const fwd = name === 'up' || name === 'up-left' || name === 'up-right'
    engineRef.current?.setJoystick(vec[0], vec[1], dpadSprintRef.current && fwd)
  }

  const dpadDirFromPoint = (clientX: number, clientY: number): string => {
    const el = dpadRef.current
    if (!el) return ''
    const r = el.getBoundingClientRect()
    const dx = clientX - (r.left + r.width / 2)
    const dy = clientY - (r.top + r.height / 2)
    if (Math.hypot(dx, dy) < r.width * 0.14) return dpadActiveRef.current // dead zone → keep last
    const oct = Math.round(Math.atan2(dy, dx) / (Math.PI / 4))
    return DPAD_NAMES[((oct % 8) + 8) % 8]
  }

  const onDpadDown = (e: React.PointerEvent) => {
    if (dpadIdRef.current !== null) return
    dpadIdRef.current = e.pointerId
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* ignore */ }
    const dir = dpadDirFromPoint(e.clientX, e.clientY)
    if (dir === 'up') {
      // double-tap forward = sprint (like the pocket edition)
      const now = performance.now()
      if (now - lastFwdTapRef.current < 300) dpadSprintRef.current = true
      lastFwdTapRef.current = now
    }
    applyDpad(dir)
  }

  const onDpadMove = (e: React.PointerEvent) => {
    if (dpadIdRef.current !== e.pointerId) return
    applyDpad(dpadDirFromPoint(e.clientX, e.clientY))
  }

  const onDpadUp = (e: React.PointerEvent) => {
    if (dpadIdRef.current !== e.pointerId) return
    dpadIdRef.current = null
    dpadSprintRef.current = false
    applyDpad('')
  }

  // ---------- jump button (double-tap → fly) ----------
  const onJumpDown = useCallback(() => {
    const now = performance.now()
    if (now - lastJumpTapRef.current < 300) {
      engineRef.current?.toggleFly()
      lastJumpTapRef.current = 0
    } else {
      lastJumpTapRef.current = now
    }
    engineRef.current?.setJump(true)
  }, [])

  const onJumpUp = useCallback(() => {
    engineRef.current?.setJump(false)
  }, [])

  const flyBtnDown = useCallback((which: 'up' | 'down') => {
    if (which === 'up') flyUpRef.current = true
    else flyDownRef.current = true
    applyFlyControls()
  }, [applyFlyControls])

  const flyBtnUp = useCallback((which: 'up' | 'down') => {
    if (which === 'up') flyUpRef.current = false
    else flyDownRef.current = false
    applyFlyControls()
  }, [applyFlyControls])

  const icon = useCallback((id: number) => {
    if (!mounted) return '' // icons need the DOM — render after mount to avoid hydration mismatch
    const d = BLOCKS[id]
    if (!d) return ''
    return blockIconDataURL(id, [d.tiles[0], d.tiles[2]], d.cross)
  }, [mounted])

  return (
    <div
      ref={wrapRef}
      dir="ltr"
      className="relative h-[100dvh] w-full overflow-hidden bg-[#6ea7d8] select-none"
      style={{ touchAction: 'none' }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* subtle vignette for depth */}
      <div
        className="pointer-events-none absolute inset-0 z-[5]"
        style={{ background: 'radial-gradient(ellipse at center, transparent 62%, rgba(0,0,0,0.28) 100%)' }}
      />

      {/* underwater tint */}
      {underwater && phase === 'playing' && (
        <div className="pointer-events-none absolute inset-0 bg-[#1a4db3]/35" />
      )}

      {/* damage flash */}
      {dmgFlash && phase === 'playing' && (
        <div className="pointer-events-none absolute inset-0 z-[15] bg-red-600/30 transition-opacity" />
      )}

      {/* sleeping fade → morning */}
      {sleepFade > 0 && phase === 'playing' && (
        <>
          <div className="pointer-events-none absolute inset-0 z-[45] bg-black transition-opacity duration-150" style={{ opacity: sleepFade }} />
          {sleepFade > 0.55 && (
            <div dir="rtl" className="pointer-events-none absolute inset-0 z-[46] flex flex-col items-center justify-center gap-2">
              <div className="text-2xl font-black text-white/90 drop-shadow-[0_2px_0_rgba(0,0,0,0.8)]">صبح می‌شود…</div>
              <div className="text-xs text-white/60">خوابیدی و انرژی گرفتی</div>
            </div>
          )}
        </>
      )}

      {/* ---------- HUD ---------- */}
      {phase === 'playing' && !paused && !invOpen && (
        <>
          {/* crosshair */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
            <div className="relative h-5 w-5 opacity-80">
              <div className="absolute left-1/2 top-0 h-5 w-0.5 -translate-x-1/2 bg-white/90 mix-blend-difference" />
              <div className="absolute top-1/2 left-0 h-0.5 w-5 -translate-y-1/2 bg-white/90 mix-blend-difference" />
            </div>
          </div>

          {/* FPS */}
          {fps > 0 && (
            <div className="pointer-events-none absolute right-2 top-2 z-10 rounded bg-black/35 px-1.5 py-0.5 font-mono text-[10px] text-white/80">
              {fps} FPS
            </div>
          )}

          {/* hearts + hunger (survival only — creative mode hides them like the original game) */}
          {settings.mode === 'survival' && (
          <div dir="ltr" className="pointer-events-none absolute left-2 top-2 z-10 flex flex-col items-start gap-1">
            <div className="flex gap-[2px] rounded bg-black/30 px-1 py-0.5">
              {Array.from({ length: 10 }, (_, i) => {
                const heartHp = hp - i * 2
                return (
                  <span key={i} className="relative inline-block h-4 w-4">
                    {/* empty heart */}
                    <svg viewBox="0 0 16 16" className="absolute inset-0 h-4 w-4" shapeRendering="crispEdges">
                      <path d="M4 2h3v1h2V2h3v1h2v2h1v4h-1v2h-1v1h-1v1h-1v1h-1v1h-2v-1H7v-1H6v-1H5v-1H4V9H3V5h1z" fill="rgba(40,40,40,0.75)" />
                    </svg>
                    {/* full/half heart via clip */}
                    {heartHp >= 2 && (
                      <svg viewBox="0 0 16 16" className="absolute inset-0 h-4 w-4" shapeRendering="crispEdges">
                        <path d="M4 2h3v1h2V2h3v1h2v2h1v4h-1v2h-1v1h-1v1h-1v1h-2v-1H7v-1H6v-1H5v-1H4V9H3V5h1z" fill="#e53935" />
                        <path d="M6 4h2v1h1v2H8V6H7V5H6z" fill="#ff8a80" />
                      </svg>
                    )}
                    {heartHp === 1 && (
                      <span className="absolute inset-0 overflow-hidden" style={{ width: '50%' }}>
                        <svg viewBox="0 0 16 16" className="h-4 w-4" shapeRendering="crispEdges">
                          <path d="M4 2h3v1h2V2h3v1h2v2h1v4h-1v2h-1v1h-1v1h-1v1h-2v-1H7v-1H6v-1H5v-1H4V9H3V5h1z" fill="#e53935" />
                          <path d="M6 4h2v1h1v2H8V6H7V5H6z" fill="#ff8a80" />
                        </svg>
                      </span>
                    )}
                  </span>
                )
              })}
            </div>
            {/* hunger drumsticks */}
            <div className="flex gap-[2px] rounded bg-black/30 px-1 py-0.5">
              {Array.from({ length: 10 }, (_, i) => {
                const food = hunger - i * 2
                return (
                  <span key={i} className="relative inline-block h-4 w-4">
                    <svg viewBox="0 0 16 16" className="absolute inset-0 h-4 w-4" shapeRendering="crispEdges">
                      <path d="M6 2h6v1h2v1h1v2h1v3h-1v2h-2v1H9v1H8v1H6v1H4v1H2v-2h1v-2h1v-1h1v-2h1z" fill="rgba(30,30,30,0.8)" />
                    </svg>
                    {food >= 1 && (
                      <span className="absolute inset-0 overflow-hidden" style={food === 1 ? { width: '50%' } : undefined}>
                        <svg viewBox="0 0 16 16" className="h-4 w-4" shapeRendering="crispEdges">
                          <path d="M6 2h6v1h2v1h1v2h1v3h-1v2h-2v1H9v1H8v1H6v1H4v1H2v-2h1v-2h1v-1h1v-2h1z" fill="#b0613f" />
                          <path d="M8 3h3v1h2v3h-1v1h-2v1H9V8h1V6H9V4H8z" fill="#cf8256" />
                          <path d="M4 10h1v1H4zM3 11h2v2H3zM2 12h2v2H2z" fill="#efe6d6" />
                        </svg>
                      </span>
                    )}
                  </span>
                )
              })}
            </div>
            {/* air bubbles */}
            {air < 0.999 && (
              <div className="flex gap-[2px] rounded bg-black/30 px-1 py-0.5">
                {Array.from({ length: 10 }, (_, i) => {
                  const filled = air * 10 - i
                  return (
                    <span key={i} className="relative inline-block h-3 w-3 rounded-full border border-cyan-200/70" style={{ background: filled >= 1 ? 'rgba(103,232,249,0.9)' : filled > 0 ? 'rgba(103,232,249,0.4)' : 'transparent' }} />
                  )
                })}
              </div>
            )}
          </div>
          )}

          {/* pause button */}
          <button
            aria-label="توقف بازی"
            className="absolute right-2 top-9 z-20 flex h-11 w-11 items-center justify-center rounded-lg bg-black/40 text-xl text-white active:bg-black/60"
            onPointerDown={(e) => { e.stopPropagation(); togglePause(true) }}
          >⏸</button>

          {/* fullscreen button */}
          <button
            aria-label="تمام صفحه"
            className="absolute right-14 top-9 z-20 flex h-11 w-11 items-center justify-center rounded-lg bg-black/40 text-lg text-white active:bg-black/60"
            onPointerDown={(e) => { e.stopPropagation(); void toggleFullscreen() }}
          >{fullscreen ? '⛶' : '⛶'}</button>

          {/* D-pad (Minecraft pocket-edition style) — whole pad is one touch surface,
              corners give diagonal movement, double-tap ▲ = sprint */}
          <div
            ref={dpadRef}
            className="absolute bottom-[78px] left-3 z-20 grid grid-cols-3 gap-1"
            style={{ touchAction: 'none', width: 'clamp(126px, 31vw, 168px)', height: 'clamp(126px, 31vw, 168px)' }}
            onPointerDown={onDpadDown}
            onPointerMove={onDpadMove}
            onPointerUp={onDpadUp}
            onPointerCancel={onDpadUp}
          >
            <div />
            <div
              ref={(el) => { dpadArrowRefs.current[0] = el }}
              className="flex items-center justify-center rounded-md border-2 font-black text-white"
              style={{ background: 'rgba(20,20,20,0.42)', borderColor: 'rgba(255,255,255,0.38)', fontSize: 'clamp(14px, 3.2vw, 20px)', textShadow: '0 2px 0 rgba(0,0,0,0.6)' }}
            >▲</div>
            <div />
            <div
              ref={(el) => { dpadArrowRefs.current[3] = el }}
              className="flex items-center justify-center rounded-md border-2 font-black text-white"
              style={{ background: 'rgba(20,20,20,0.42)', borderColor: 'rgba(255,255,255,0.38)', fontSize: 'clamp(14px, 3.2vw, 20px)', textShadow: '0 2px 0 rgba(0,0,0,0.6)' }}
            >◀</div>
            <div className="flex items-center justify-center">
              <div className="h-2.5 w-2.5 rounded-full bg-white/35" />
            </div>
            <div
              ref={(el) => { dpadArrowRefs.current[1] = el }}
              className="flex items-center justify-center rounded-md border-2 font-black text-white"
              style={{ background: 'rgba(20,20,20,0.42)', borderColor: 'rgba(255,255,255,0.38)', fontSize: 'clamp(14px, 3.2vw, 20px)', textShadow: '0 2px 0 rgba(0,0,0,0.6)' }}
            >▶</div>
            <div />
            <div
              ref={(el) => { dpadArrowRefs.current[2] = el }}
              className="flex items-center justify-center rounded-md border-2 font-black text-white"
              style={{ background: 'rgba(20,20,20,0.42)', borderColor: 'rgba(255,255,255,0.38)', fontSize: 'clamp(14px, 3.2vw, 20px)', textShadow: '0 2px 0 rgba(0,0,0,0.6)' }}
            >▼</div>
            <div />
          </div>

          {/* jump / fly buttons (right) */}
          <div className="absolute bottom-[92px] right-3 z-20 flex flex-col items-center gap-2">
            {flying && settings.mode === 'creative' && (
              <div className="flex flex-col gap-2">
                <button
                  aria-label="بالا"
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-black/40 text-2xl text-white active:bg-black/60"
                  onPointerDown={(e) => { e.stopPropagation(); flyBtnDown('up') }}
                  onPointerUp={(e) => { e.stopPropagation(); flyBtnUp('up') }}
                  onPointerCancel={() => flyBtnUp('up')}
                >▲</button>
                <button
                  aria-label="پایین"
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-black/40 text-2xl text-white active:bg-black/60"
                  onPointerDown={(e) => { e.stopPropagation(); flyBtnDown('down') }}
                  onPointerUp={(e) => { e.stopPropagation(); flyBtnUp('down') }}
                  onPointerCancel={() => flyBtnUp('down')}
                >▼</button>
              </div>
            )}
            <button
              aria-label="پرش"
              className={`flex h-[74px] w-[74px] items-center justify-center rounded-full border-2 text-3xl ${flying ? 'border-emerald-300/70 bg-emerald-600/40' : 'border-white/50 bg-black/35'} text-white active:bg-black/55`}
              onPointerDown={(e) => { e.stopPropagation(); onJumpDown() }}
              onPointerUp={(e) => { e.stopPropagation(); onJumpUp() }}
              onPointerCancel={onJumpUp}
            >⤒</button>
          </div>

          {/* hotbar — Minecraft-style beveled slots + cycle arrows + picker */}
          <div
            className="absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-lg border-2 border-black bg-black/55 p-1.5"
            style={{ boxShadow: 'inset 2px 2px 0 rgba(255,255,255,0.18), inset -2px -2px 0 rgba(0,0,0,0.6)' }}
          >
            <button
              aria-label="بلوک قبلی"
              onPointerDown={(e) => { e.stopPropagation(); cycleSlot(-1) }}
              className="mc-btn mc-plain flex h-10 w-9 shrink-0 items-center justify-center !p-0 text-lg font-black"
              style={{ width: 36 }}
            >‹</button>
            {slots.map((id, i) => {
              const cnt = settings.mode === 'survival' && id ? (counts[id] ?? 0) : 0
              return (
                <button
                  key={i}
                  aria-label={`اسلات ${i + 1}`}
                  onPointerDown={(e) => { e.stopPropagation(); onSlotPointerDown(i) }}
                  onPointerUp={onSlotPointerUp}
                  onPointerCancel={onSlotPointerUp}
                  onPointerLeave={onSlotPointerUp}
                  style={{ width: 'clamp(36px, 8.4vw, 54px)', height: 'clamp(36px, 8.4vw, 54px)' }}
                  className={`mc-slot relative shrink-0 transition-transform ${i === sel ? 'mc-slot-active scale-[1.06] bg-white/15' : ''}`}
                >
                  {id ? (
                    <img src={icon(id) || undefined} alt="" className="absolute inset-0 m-auto h-[86%] w-[86%] object-contain [image-rendering:pixelated] drop-shadow-[1px_2px_0_rgba(0,0,0,0.5)]" draggable={false} />
                  ) : null}
                  {cnt > 1 && (
                    <span className="absolute bottom-0 right-0.5 text-[11px] font-black leading-none text-white" style={{ textShadow: '1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000' }}>{cnt}</span>
                  )}
                  <span className="absolute -top-0.5 right-0.5 text-[9px] font-bold text-white/55">{i + 1}</span>
                </button>
              )
            })}
            <button
              aria-label="بلوک بعدی"
              onPointerDown={(e) => { e.stopPropagation(); cycleSlot(1) }}
              className="mc-btn mc-plain flex h-10 w-9 shrink-0 items-center justify-center !p-0 text-lg font-black"
              style={{ width: 36 }}
            >›</button>
            {settings.mode === 'creative' && (
              <button
                aria-label="همه بلوک‌ها"
                onPointerDown={(e) => { e.stopPropagation(); setPickerForSlot(null); setInvOpen(true) }}
                className="mc-btn mc-green ml-0.5 flex h-10 shrink-0 items-center justify-center !p-0 text-xl"
                style={{ width: 42 }}
              >⊞</button>
            )}
          </div>

          {/* selected block name */}
          {showBlockName && (
            <div dir="rtl" className="pointer-events-none absolute bottom-[104px] left-1/2 z-20 -translate-x-1/2 rounded-lg bg-black/55 px-3 py-1 text-sm font-bold text-white">
              {slots[sel] ? (BLOCKS[slots[sel]]?.name ?? '') : 'اسلات خالی — بلوکی جمع کن!'}
            </div>
          )}

          {/* toast */}
          {toast && (
            <div dir="rtl" className="pointer-events-none absolute bottom-[110px] left-1/2 z-30 -translate-x-1/2 rounded-lg bg-black/60 px-3 py-1.5 text-sm text-white">
              {toast}
            </div>
          )}
        </>
      )}

      {/* ---------- death screen ---------- */}
      {dead && phase === 'playing' && (
        <div dir="rtl" className="absolute inset-0 z-50 flex items-center justify-center bg-red-950/75 p-4">
          <div className="mc-panel w-full max-w-sm p-6 text-center" style={{ background: 'rgba(30,8,8,0.96)' }}>
            <h2 className="mb-1 text-3xl font-black text-red-300 drop-shadow-[0_2px_0_rgba(0,0,0,0.8)]">مُردی!</h2>
            <p className="mb-5 text-sm text-white/70">{settings.mode === 'survival' ? 'حواست به زامبی‌ها، گرسنگی و سقوط باشه…' : 'حواست به سقوط باشه…'}</p>
            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => {
                  engineRef.current?.respawn()
                  setDead(false)
                  setHp(20)
                  setAir(1)
                  setHunger(20)
                }}
                className="mc-btn mc-green py-3.5 text-lg"
              >تولد دوباره{settings.mode === 'survival' ? ' (روی تخت/اسپاون)' : ''}</button>
              <button onClick={stopGame} className="mc-btn mc-plain py-3">ذخیره و خروج به منو</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- inventory (Minecraft creative-style block box) ---------- */}
      {invOpen && phase === 'playing' && (
        <div dir="rtl" className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-3" onPointerDown={() => { setInvOpen(false); setPickerForSlot(null) }}>
          <div className="mc-panel w-full max-w-md p-4" onPointerDown={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between border-b-2 border-black/70 pb-2.5">
              <h2 className="text-base font-black text-white drop-shadow-[1px_1px_0_rgba(0,0,0,0.7)]">
                صندوق بلوک‌ها
                <span className="mr-2 text-xs font-bold text-emerald-300/90">اسلات {(pickerForSlot ?? sel) + 1}</span>
              </h2>
              <button
                aria-label="بستن"
                onClick={() => { setInvOpen(false); setPickerForSlot(null) }}
                className="mc-btn mc-red !w-auto !px-3 !py-1 text-sm"
                style={{ width: 'auto' }}
              >✕</button>
            </div>
            <p className="mb-2.5 text-[11px] text-white/55">روی یک بلوک بزن تا در اسلات انتخاب‌شده قرار بگیرد</p>
            <div className="grid max-h-[52vh] grid-cols-4 gap-1.5 overflow-y-auto pl-1 sm:grid-cols-5">
              {PLACEABLE.map((id) => {
                const active = slots[pickerForSlot ?? sel] === id
                return (
                  <button
                    key={id}
                    onClick={() => assignBlock(id)}
                    className={`mc-slot flex flex-col items-center gap-1 p-1.5 active:brightness-150 ${active ? 'mc-slot-active' : ''}`}
                  >
                    <img src={icon(id) || undefined} alt={BLOCKS[id]?.name} className="h-11 w-11 [image-rendering:pixelated] drop-shadow-[1px_2px_0_rgba(0,0,0,0.5)]" draggable={false} />
                    <span className="text-center text-[10px] leading-3 text-white/80">{BLOCKS[id]?.name}</span>
                  </button>
                )
              })}
            </div>
            <div className="mt-3 border-t-2 border-black/70 pt-2.5 text-center text-[11px] text-white/45">
              {PLACEABLE.length} بلوک — کانه‌ها را از زیر زمین بیاب!
            </div>
          </div>
        </div>
      )}

      {/* ---------- pause menu ---------- */}
      {paused && phase === 'playing' && !settingsOpen && (
        <div dir="rtl" className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="mc-panel w-full max-w-sm p-5">
            <h2 className="mb-4 text-center text-xl font-black text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.7)]">بازی متوقف شد</h2>
            <div className="flex flex-col gap-2.5">
              <button onClick={() => togglePause(false)} className="mc-btn mc-green py-3">ادامه بازی</button>
              <button onClick={() => { setSettingsOpen(true) }} className="mc-btn py-3">تنظیمات</button>
              <button onClick={() => void toggleFullscreen()} className="mc-btn mc-plain py-3">
                {fullscreen ? 'خروج از تمام‌صفحه' : 'حالت تمام‌صفحه'}
              </button>
              <button onClick={stopGame} className="mc-btn mc-red py-3">ذخیره و خروج به منو</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- settings ---------- */}
      {settingsOpen && (
        <div dir="rtl" className="absolute inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="mc-panel max-h-[88vh] w-full max-w-sm overflow-y-auto p-5">
            <h2 className="mb-4 text-center text-xl font-black text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.7)]">تنظیمات</h2>
            <div className="mb-4">
              <span className="mb-1.5 block text-sm text-white/80">حالت بازی</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => applySettings({ ...settings, mode: 'survival' })}
                  className={`mc-btn py-2.5 text-sm ${settings.mode === 'survival' ? 'mc-green' : 'mc-plain'}`}
                >بقا{settings.mode === 'survival' ? ' ✓' : ''}</button>
                <button
                  onClick={() => applySettings({ ...settings, mode: 'creative' })}
                  className={`mc-btn py-2.5 text-sm ${settings.mode === 'creative' ? 'mc-green' : 'mc-plain'}`}
                >خلاقانه{settings.mode === 'creative' ? ' ✓' : ''}</button>
              </div>
              <p className="mt-1.5 text-[11px] leading-5 text-white/50">
                {settings.mode === 'survival' ? 'گرسنگی، صدمه و زامبی‌ها — مثل بازی اصلی' : 'پرواز آزاد و بی‌مرگی — برای ساختن آرام'}
              </p>
            </div>
            <label className="mb-4 block">
              <span className="mb-1.5 block text-sm text-white/80">فاصله دید: {['نزدیک', 'متوسط', 'دور', 'خیلی دور'][settings.renderDistance - 2] ?? settings.renderDistance}</span>
              <input
                type="range" min={2} max={5} step={1} value={settings.renderDistance}
                onChange={(e) => applySettings({ ...settings, renderDistance: Number(e.target.value) })}
                className="w-full accent-emerald-500"
              />
            </label>
            <label className="mb-4 block">
              <span className="mb-1.5 block text-sm text-white/80">حساسیت نگاه: {settings.sensitivity.toFixed(1)}×</span>
              <input
                type="range" min={0.4} max={2.2} step={0.1} value={settings.sensitivity}
                onChange={(e) => applySettings({ ...settings, sensitivity: Number(e.target.value) })}
                className="w-full accent-emerald-500"
              />
            </label>
            <button
              onClick={() => applySettings({ ...settings, sound: !settings.sound })}
              className="mc-btn mc-plain mb-3 flex w-full items-center justify-between px-4 py-3 text-sm"
            >
              <span>صدا و موسیقی</span>
              <span className={`rounded-full px-3 py-1 text-xs ${settings.sound ? 'bg-emerald-600' : 'bg-white/20'}`}>{settings.sound ? 'روشن' : 'خاموش'}</span>
            </button>
            <button
              onClick={() => applySettings({ ...settings, mobs: !settings.mobs })}
              className="mc-btn mc-plain mb-5 flex w-full items-center justify-between px-4 py-3 text-sm"
            >
              <span>حیوانات و زامبی‌ها</span>
              <span className={`rounded-full px-3 py-1 text-xs ${settings.mobs ? 'bg-emerald-600' : 'bg-white/20'}`}>{settings.mobs ? 'روشن' : 'خاموش'}</span>
            </button>
            <button onClick={() => setSettingsOpen(false)} className="mc-btn mc-green w-full py-3">ذخیره و بستن</button>
          </div>
        </div>
      )}

      {/* ---------- loading ---------- */}
      {phase === 'loading' && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4">
          <div
            className="mc-dirt-bg absolute inset-0"
            style={{ backgroundImage: dirtBg ? `url(${dirtBg})` : undefined, backgroundColor: dirtBg ? undefined : '#3a2a1a' }}
          />
          <div className="relative flex flex-col items-center gap-4">
            <div className="text-2xl font-black text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.8)]">در حال ساختن دنیا…</div>
            <div className="mc-progress w-64">
              <div style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <div className="text-sm font-bold text-emerald-300/90">{Math.round(progress * 100)}٪</div>
            <div dir="rtl" className="text-xs text-white/65">{LOAD_TIPS[Math.floor(loadSecs / 3) % LOAD_TIPS.length]}</div>
            <div dir="rtl" className="text-[11px] text-white/40">{loadSecs} ثانیه — اگر طولانی شد، راه میان‌بر نشان داده می‌شود</div>
          </div>
        </div>
      )}

      {/* ---------- loading too slow → offer fast entry ---------- */}
      {phase === 'loading' && stalled && (
        <div dir="rtl" className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="mc-panel w-full max-w-sm p-5 text-center">
            <h2 className="mb-1 text-lg font-black text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.7)]">ساخت دنیا بیشتر از حد معمول طول کشید</h2>
            <p className="mb-4 text-xs leading-6 text-white/60">
              دستگاه شما کندتر از حد معمول است یا مرورگر محدودیت دارد. می‌توانید همین حالا وارد شوید —
              بقیه‌ی دنیا در پس‌زمینه ساخته می‌شود.
            </p>
            <div className="flex flex-col gap-2.5">
              <button onClick={enterNow} className="mc-btn mc-green py-3 text-lg">ورود به بازی</button>
              <button onClick={() => startGame(lastModeRef.current)} className="mc-btn mc-plain py-2.5">تلاش دوباره</button>
              <button onClick={stopGame} className="mc-btn mc-plain py-2.5">بازگشت به منو</button>
            </div>
          </div>
        </div>
      )}

      {/* toast during loading (e.g. partial chunk failures) */}
      {phase === 'loading' && toast && (
        <div dir="rtl" className="absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-black/60 px-3 py-1.5 text-sm text-white">
          {toast}
        </div>
      )}

      {/* ---------- error ---------- */}
      {phase === 'error' && (
        <div dir="rtl" className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="mc-panel w-full max-w-sm p-5 text-center" style={{ background: 'rgba(30,12,12,0.96)' }}>
            <h2 className="mb-2 text-lg font-black text-red-300 drop-shadow-[0_2px_0_rgba(0,0,0,0.8)]">خطا در اجرای بازی</h2>
            <p className="mb-4 text-xs leading-6 text-white/75">{errMsg}</p>
            <div className="flex flex-col gap-2.5">
              <button onClick={() => startGame(lastModeRef.current)} className="mc-btn mc-green py-3 text-lg">تلاش دوباره</button>
              <button onClick={stopGame} className="mc-btn mc-plain py-2.5">بازگشت به منو</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- main menu (Minecraft-style dirt + logo + splash) ---------- */}
      {phase === 'menu' && (
        <div className="absolute inset-0 z-40 overflow-y-auto">
          <div
            className="mc-dirt-bg min-h-full w-full"
            style={{ backgroundImage: dirtBg ? `url(${dirtBg})` : undefined, backgroundColor: dirtBg ? undefined : '#3a2a1a' }}
          >
            <div dir="rtl" className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center gap-5 px-6 py-10">
              <div className="relative mt-8 text-center">
                <h1 className="mc-logo text-5xl font-black text-white sm:text-6xl">بلاک کرَفت</h1>
                <span className="mc-splash absolute -bottom-6 right-2 whitespace-nowrap text-sm font-black text-yellow-300">
                  ۱۰۰٪ رویه‌ای و فارسی!
                </span>
              </div>

              {/* decorative pixel blocks */}
              <div className="mt-6 flex items-end gap-2 opacity-95 drop-shadow-[0_3px_0_rgba(0,0,0,0.5)]">
                {[1, 3, 6, 7, 24, 14].map((id) => (
                  <img key={id} src={icon(id) || undefined} alt="" className="h-9 w-9 [image-rendering:pixelated] sm:h-11 sm:w-11" draggable={false} />
                ))}
              </div>

              {/* game mode selector */}
              <div className="w-full">
                <div className="mb-1.5 text-center text-xs font-bold text-white/70">حالت بازی را انتخاب کن</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => applySettings({ ...settings, mode: 'survival' })}
                    className={`mc-btn py-3 text-sm ${settings.mode === 'survival' ? 'mc-green' : 'mc-plain'}`}
                  >
                    بقا{settings.mode === 'survival' ? ' ✓' : ''}
                    <span className="mt-0.5 block text-[10px] font-normal text-white/80">جمع‌آوری بلوک، گرسنگی، زامبی</span>
                  </button>
                  <button
                    onClick={() => applySettings({ ...settings, mode: 'creative' })}
                    className={`mc-btn py-3 text-sm ${settings.mode === 'creative' ? 'mc-green' : 'mc-plain'}`}
                  >
                    خلاقانه{settings.mode === 'creative' ? ' ✓' : ''}
                    <span className="mt-0.5 block text-[10px] font-normal text-white/80">پرواز آزاد، بی‌مرگ</span>
                  </button>
                </div>
              </div>

              <div className="flex w-full flex-col gap-3">
                {hasSave && (
                  <button onClick={() => startGame('continue')} className="mc-btn mc-green py-4 text-lg">ادامه بازی</button>
                )}
                {hasSave && (
                  <button
                    onClick={() => {
                      localStorage.removeItem(SAVE_KEY)
                      setHasSave(false)
                      startGame('new')
                    }}
                    className="mc-btn mc-amber py-3.5"
                  >دنیای جدید (حذف دنیای قبلی)</button>
                )}
                {!hasSave && (
                  <button onClick={() => startGame('new')} className="mc-btn mc-green py-4 text-lg">شروع بازی</button>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setHelpOpen(true)} className="mc-btn py-3">راهنما</button>
                  <button onClick={() => setSettingsOpen(true)} className="mc-btn py-3">تنظیمات</button>
                </div>
              </div>

              <p className="mt-auto pt-7 text-center text-[11px] leading-5 text-white/45">
                نسخه ۴ — کنترل ماینکرافتی، مقادیر بلوک، حیوانات بیشتر
                <br />
                همه گرافیک‌ها و صداها به‌صورت رویه‌ای تولید می‌شوند
                <br />
                برای بهترین تجربه روی اندروید: از کروم استفاده کنید و بازی را به صفحه اصلی اضافه کنید
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ---------- help ---------- */}
      {helpOpen && (
        <div dir="rtl" className="absolute inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="mc-panel max-h-[85vh] w-full max-w-md overflow-y-auto p-5">
            <h2 className="mb-3 text-center text-xl font-black text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.7)]">راهنمای بازی</h2>
            {isTouch ? (
              <ul className="space-y-2.5 text-sm leading-6 text-white/85">
                <li>🎮 <b>حرکت:</b> دی‌پد پایین-چپ (مثل ماینکرافت موبایل). گوشه‌ها = حرکت مورب. <b>دو ضربه سریع روی ▲ = دویدن</b>.</li>
                <li>👆 <b>چرخش دوربین:</b> انگشت را روی صفحه (بیرون دی‌پد) بکشید.</li>
                <li>⬆️ <b>پرش:</b> دکمه گرد سمت راست. در حالت خلاقانه دو ضربه = پرواز.</li>
                <li>⛏️ <b>شکستن بلوک:</b> انگشت را روی بلوک <b>نگه دارید</b> تا ترک بیفتد و بشکند — و بلوک به مقادیرت اضافه می‌شود!</li>
                <li>🧱 <b>مقادیر:</b> چمن → خاک، سنگ → سنگ فرش. بلوکی که می‌شکنی مال توست؛ با گذاشتن، یکی کم می‌شود (مثل ماینکرافت).</li>
                <li>🧱 <b>گذاشتن بلوک:</b> یک <b>ضربه کوتاه</b> روی زمین یا دیوار بزنید.</li>
                <li>⚔️ <b>حمله:</b> ضربه کوتاه روی حیوان/زامبی! زامبی‌ها شب‌ها ظاهر می‌شوند؛ صبح می‌سوزند. شکار = سیر شدن.</li>
                <li>🛏️ <b>تخت و خواب:</b> تخت را بساز (یا در حالت خلاقانه بردار) و شب رویش ضربه بزن تا صبح شود — نقطه تولد دوباره‌ات همان‌جا می‌شود!</li>
                <li>🧱 <b>تغییر بلوک:</b> با دکمه‌های ‹ › اسلات‌ها را عوض کن. در حالت خلاقانه، لمس طولانی روی اسلات = صندوق همه بلوک‌ها.</li>
                <li>💎 <b>کشف:</b> زیر زمین زغال، آهن، طلا و الماس پنهان است! بیابان، جنگل، برف و دشت‌ها را بگرد.</li>
              </ul>
            ) : (
              <ul className="space-y-2.5 text-sm leading-6 text-white/85">
                <li>🎮 <b>قفل ماوس:</b> روی صفحه کلیک کنید.</li>
                <li>🅆🄰🅂🄳 <b>حرکت:</b> کلیدهای WASD (Shift = دویدن).</li>
                <li>🖱️ <b>شکستن:</b> کلیک چپ (نگه دارید) — <b>گذاشتن:</b> کلیک راست — <b>حمله:</b> کلیک چپ روی حیوان/زامبی.</li>
                <li>␣ <b>پرش:</b> Space — دو بار سریع: پرواز (فقط خلاقانه؛ Space/Shift بالا و پایین، F هم پرواز).</li>
                <li>1-9 انتخاب اسلات، چرخ ماوس تغییر اسلات، E صندوق بلوک‌ها، Esc توقف.</li>
                <li>🛏️ <b>تخت:</b> شب روی تخت کلیک راست کنید تا صبح شود و نقطه تولد عوض شود.</li>
                <li>🍖 <b>بقا:</b> گرسنگی را با شکار حیوانات پر کنید؛ با شکم سیر (بیش از ۹ برگ) جان برمی‌گردد.</li>
              </ul>
            )}
            <button onClick={() => setHelpOpen(false)} className="mc-btn mc-green mt-4 py-3">فهمیدم!</button>
          </div>
        </div>
      )}
    </div>
  )
}
