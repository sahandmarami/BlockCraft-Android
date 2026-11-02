// Mob system: passive animals (sheep, cow, pig, chicken) + night zombies.
// All models are original box-builds with procedurally painted pixel skins.
// Heads use per-face materials so the face appears only on the front of the head.
import * as THREE from 'three'
import { B, isSolid } from './blocks'
import type { World } from './world'
import type { SoundFX, MobVoice } from './sound'
import type { ParticleSystem } from './particles'
import { mulberry32 } from './noise'

const GRAVITY = 22
const DESPAWN_DIST = 64
const MAX_PASSIVE = 14
const MAX_HOSTILE = 6
/** how far zombie arms point forward (radians) */
const ARM_BASE = 1.32

export type MobType = 'sheep' | 'cow' | 'pig' | 'chicken' | 'zombie'

interface MobConfig {
  voice: MobVoice
  hp: number
  speed: number
  width: number
  height: number
  hostile: boolean
  spawnDay: boolean
  name: string
}

const CONFIG: Record<MobType, MobConfig> = {
  sheep: { voice: 'sheep', hp: 8, speed: 1.15, width: 0.9, height: 1.15, hostile: false, spawnDay: true, name: 'گوسفند' },
  cow: { voice: 'cow', hp: 10, speed: 1.05, width: 0.9, height: 1.3, hostile: false, spawnDay: true, name: 'گاو' },
  pig: { voice: 'pig', hp: 10, speed: 1.2, width: 0.9, height: 0.9, hostile: false, spawnDay: true, name: 'خوک' },
  chicken: { voice: 'chicken', hp: 4, speed: 1.0, width: 0.5, height: 0.75, hostile: false, spawnDay: true, name: 'مرغ' },
  zombie: { voice: 'zombie', hp: 20, speed: 1.75, width: 0.6, height: 1.9, hostile: true, spawnDay: false, name: 'زامبی' },
}

/** hunger restored when the player hunts a passive animal (survival mode) */
export const FOOD_VALUE: Partial<Record<MobType, number>> = { sheep: 6, cow: 8, pig: 5, chicken: 3 }

// ---------- procedural pixel skins ----------
type SkinKind =
  | 'wool' | 'sheepHeadFront' | 'sheepHeadSide' | 'sheepHeadTop' | 'sheepLeg'
  | 'cowHide' | 'cowHeadFront' | 'cowHeadSide' | 'cowHeadTop' | 'cowLeg'
  | 'pigSkin' | 'pigHeadFront' | 'pigHeadSide' | 'pigHeadTop' | 'pigLeg'
  | 'feather' | 'chickenHeadFront' | 'chickenHeadSide' | 'chickenHeadTop' | 'chickenWing' | 'chickenLeg'
  | 'zombieSkin' | 'zombieHeadFront' | 'zombieHeadSide' | 'zombieHeadTop' | 'zombieShirt' | 'zombiePants' | 'zombieArm'

/** per-face texture set for head boxes (front is −Z, the direction the mob faces) */
interface HeadSkins {
  front: SkinKind
  side: SkinKind
  top: SkinKind
  back?: SkinKind
  bottom?: SkinKind
}
type SkinSpec = SkinKind | HeadSkins

type Ctx = CanvasRenderingContext2D

function px(ctx: Ctx, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c
  ctx.fillRect(x, y, w, h)
}

function noiseFill16(ctx: Ctx, rnd: () => number, shades: string[]) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      ctx.fillStyle = shades[Math.floor(rnd() * shades.length)]
      ctx.fillRect(x, y, 1, 1)
    }
  }
}

/** darken the border ring of the tile → fake bevel volume on flat-shaded boxes */
function bevel(ctx: Ctx) {
  const img = ctx.getImageData(0, 0, 16, 16)
  const d = img.data
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const edge = Math.min(x, y, 15 - x, 15 - y)
      if (edge > 1) continue
      const f = edge === 0 ? 0.72 : 0.88
      const i = (y * 16 + x) * 4
      d[i] = Math.round(d[i] * f)
      d[i + 1] = Math.round(d[i + 1] * f)
      d[i + 2] = Math.round(d[i + 2] * f)
    }
  }
  ctx.putImageData(img, 0, 0)
}

function paintSkin(kind: SkinKind): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = 16
  cv.height = 16
  const ctx = cv.getContext('2d')!
  const rnd = mulberry32(kind.length * 7919 + kind.charCodeAt(0) * 131 + kind.charCodeAt(kind.length - 1) * 17)
  const fill = (colors: string[]) => noiseFill16(ctx, rnd, colors)

  switch (kind) {
    // ---------- sheep ----------
    case 'wool':
      fill(['#e8e8e8', '#dcdcdc', '#f2f2f2', '#d0d0d0'])
      break
    case 'sheepHeadFront':
      fill(['#e8e8e8', '#dcdcdc', '#f2f2f2'])
      px(ctx, 3, 3, 10, 10, '#d8c9b6')
      px(ctx, 3, 3, 10, 1, '#c9b8a8')
      px(ctx, 2, 5, 3, 3, '#2a2a2a') // eye sockets
      px(ctx, 11, 5, 3, 3, '#2a2a2a')
      px(ctx, 3, 6, 2, 2, '#0d0d0d')
      px(ctx, 11, 6, 2, 2, '#0d0d0d')
      px(ctx, 3, 6, 1, 1, '#ffffff')
      px(ctx, 11, 6, 1, 1, '#ffffff')
      px(ctx, 5, 11, 6, 4, '#e2b8a0') // muzzle
      px(ctx, 6, 12, 1, 2, '#c99580')
      px(ctx, 9, 12, 1, 2, '#c99580')
      break
    case 'sheepHeadSide':
      fill(['#e8e8e8', '#dcdcdc', '#f2f2f2'])
      px(ctx, 4, 4, 9, 9, '#d8c9b6')
      px(ctx, 10, 6, 2, 2, '#0d0d0d')
      px(ctx, 10, 6, 1, 1, '#ffffff')
      px(ctx, 6, 11, 6, 3, '#e2b8a0')
      break
    case 'sheepHeadTop':
      fill(['#dcdcdc', '#d0d0d0', '#e6e6e6'])
      px(ctx, 4, 4, 8, 8, '#d8c9b6')
      break
    case 'sheepLeg':
      fill(['#e6e0d4', '#d8d2c6', '#efe9dd'])
      px(ctx, 0, 13, 16, 3, '#c9b8a8')
      break

    // ---------- cow ----------
    case 'cowHide':
      fill(['#5d4032', '#54382c', '#66473a'])
      for (let i = 0; i < 4; i++) {
        const x = Math.floor(rnd() * 10), y = Math.floor(rnd() * 10)
        px(ctx, x, y, 4 + Math.floor(rnd() * 4), 3 + Math.floor(rnd() * 4), '#e8e2da')
      }
      break
    case 'cowHeadFront':
      fill(['#5d4032', '#54382c', '#66473a'])
      px(ctx, 1, 0, 3, 3, '#d8d0c0') // horns
      px(ctx, 12, 0, 3, 3, '#d8d0c0')
      px(ctx, 2, 4, 2, 2, '#0d0d0d') // eyes
      px(ctx, 12, 4, 2, 2, '#0d0d0d')
      px(ctx, 4, 7, 8, 9, '#e8e2da') // blaze
      px(ctx, 3, 12, 10, 4, '#f2b8b0') // muzzle
      px(ctx, 4, 13, 2, 2, '#3a2a20')
      px(ctx, 10, 13, 2, 2, '#3a2a20')
      break
    case 'cowHeadSide':
      fill(['#5d4032', '#54382c'])
      px(ctx, 0, 0, 4, 3, '#d8d0c0')
      px(ctx, 9, 5, 2, 2, '#0d0d0d')
      px(ctx, 5, 10, 8, 5, '#e8e2da')
      px(ctx, 6, 12, 7, 3, '#f2b8b0')
      break
    case 'cowHeadTop':
      fill(['#54382c', '#4d3227', '#5d4032'])
      px(ctx, 5, 6, 6, 5, '#e8e2da')
      break
    case 'cowLeg':
      fill(['#5d4032', '#54382c', '#66473a'])
      px(ctx, 0, 13, 16, 3, '#2e2118') // hoof
      break

    // ---------- pig ----------
    case 'pigSkin':
      fill(['#eda6a4', '#e29a98', '#f2b2b0'])
      break
    case 'pigHeadFront':
      fill(['#eda6a4', '#e29a98', '#f2b2b0'])
      px(ctx, 2, 4, 2, 3, '#0d0d0d') // eyes
      px(ctx, 12, 4, 2, 3, '#0d0d0d')
      px(ctx, 2, 4, 2, 1, '#ffffff')
      px(ctx, 12, 4, 2, 1, '#ffffff')
      px(ctx, 4, 7, 8, 6, '#d97f7d') // snout
      px(ctx, 4, 7, 8, 1, '#c96f6d')
      px(ctx, 5, 9, 2, 3, '#8c4a49') // nostrils
      px(ctx, 9, 9, 2, 3, '#8c4a49')
      break
    case 'pigHeadSide':
      fill(['#eda6a4', '#e29a98'])
      px(ctx, 10, 5, 2, 2, '#0d0d0d')
      px(ctx, 4, 0, 8, 3, '#d98a88') // ear shadow
      px(ctx, 8, 8, 6, 4, '#d97f7d')
      px(ctx, 12, 9, 2, 2, '#8c4a49')
      break
    case 'pigHeadTop':
      fill(['#eda6a4', '#e29a98'])
      px(ctx, 4, 2, 8, 4, '#d98a88')
      break
    case 'pigLeg':
      fill(['#eda6a4', '#e29a98'])
      px(ctx, 0, 14, 16, 2, '#b85f5e')
      break

    // ---------- chicken ----------
    case 'feather':
      fill(['#f4f4f4', '#e8e8e8', '#ffffff', '#dcdcdc'])
      break
    case 'chickenHeadFront':
      fill(['#f4f4f4', '#e8e8e8', '#ffffff'])
      px(ctx, 5, 0, 6, 2, '#c62828') // comb
      px(ctx, 6, 0, 1, 1, '#e53935')
      px(ctx, 3, 5, 2, 2, '#0d0d0d') // eyes
      px(ctx, 11, 5, 2, 2, '#0d0d0d')
      px(ctx, 3, 5, 1, 1, '#ffffff')
      px(ctx, 11, 5, 1, 1, '#ffffff')
      px(ctx, 5, 8, 6, 3, '#e8a03c') // beak
      px(ctx, 5, 8, 6, 1, '#f2b95c')
      px(ctx, 6, 11, 4, 3, '#c62828') // wattle
      break
    case 'chickenHeadSide':
      fill(['#f4f4f4', '#e8e8e8'])
      px(ctx, 4, 0, 6, 2, '#c62828')
      px(ctx, 10, 5, 2, 2, '#0d0d0d')
      px(ctx, 11, 8, 4, 3, '#e8a03c') // beak pointing out
      px(ctx, 5, 11, 4, 3, '#c62828')
      break
    case 'chickenHeadTop':
      fill(['#f4f4f4', '#e8e8e8'])
      px(ctx, 5, 5, 6, 6, '#c62828')
      break
    case 'chickenWing':
      fill(['#e8e8e8', '#dcdcdc', '#f0f0f0'])
      px(ctx, 0, 13, 16, 3, '#cfcfcf')
      break
    case 'chickenLeg':
      fill(['#e8a03c', '#dd9432', '#f2ae4a'])
      px(ctx, 0, 13, 16, 3, '#c9822c')
      break

    // ---------- zombie ----------
    case 'zombieSkin':
      fill(['#5f9e4a', '#558f42', '#6aa854'])
      px(ctx, 0, 13, 16, 3, '#478238') // darker hands/feet
      break
    case 'zombieHeadFront': {
      fill(['#4f8f3e', '#478238', '#579a46'])
      px(ctx, 0, 4, 16, 1, '#3a6b2c') // brow shadow
      px(ctx, 2, 5, 4, 3, '#2a4a20') // eye sockets
      px(ctx, 10, 5, 4, 3, '#2a4a20')
      px(ctx, 3, 6, 2, 2, '#0d0d0d') // eyes
      px(ctx, 11, 6, 2, 2, '#0d0d0d')
      px(ctx, 7, 9, 2, 1, '#33591f') // nose shadow
      px(ctx, 5, 11, 6, 2, '#16240f') // mouth
      px(ctx, 5, 10, 1, 1, '#16240f')
      px(ctx, 10, 10, 1, 1, '#16240f')
      px(ctx, 6, 11, 1, 1, '#8fae76') // teeth
      px(ctx, 9, 12, 1, 1, '#8fae76')
      break
    }
    case 'zombieHeadSide':
      fill(['#4f8f3e', '#478238'])
      px(ctx, 6, 6, 4, 5, '#3d7230') // ear
      px(ctx, 10, 6, 2, 2, '#0d0d0d')
      px(ctx, 2, 12, 5, 2, '#16240f')
      break
    case 'zombieHeadTop':
      fill(['#33591f', '#2c4d1a', '#3a6627']) // matted hair
      break
    case 'zombieShirt':
      fill(['#2e7ba6', '#2a7098', '#3486b2'])
      px(ctx, 3, 5, 2, 1, '#1c4a63') // rips
      px(ctx, 11, 9, 3, 1, '#1c4a63')
      px(ctx, 6, 13, 4, 1, '#1c4a63')
      px(ctx, 0, 14, 16, 2, '#245d7d')
      break
    case 'zombiePants':
      fill(['#3d3a8c', '#37348a', '#44409a'])
      px(ctx, 2, 6, 3, 1, '#2b2866')
      px(ctx, 10, 10, 3, 1, '#2b2866')
      px(ctx, 0, 13, 16, 3, '#2b2866') // feet
      break
    case 'zombieArm': {
      fill(['#2e7ba6', '#2a7098', '#3486b2'])
      // sleeve on the top 6 rows, green skin below (texture v runs along the arm)
      for (let y = 6; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          ctx.fillStyle = ['#5f9e4a', '#558f42', '#6aa854'][Math.floor(rnd() * 3)]
          ctx.fillRect(x, y, 1, 1)
        }
      }
      px(ctx, 0, 6, 16, 1, '#1c4a63') // sleeve edge
      px(ctx, 0, 14, 16, 2, '#478238') // hand shading
      break
    }
  }

  // bake subtle edge shading on every skin for a chunky 3D look
  bevel(ctx)
  return cv
}

const skinCache = new Map<SkinKind, THREE.CanvasTexture>()
function skin(kind: SkinKind): THREE.CanvasTexture {
  let t = skinCache.get(kind)
  if (!t) {
    t = new THREE.CanvasTexture(paintSkin(kind))
    t.magFilter = THREE.NearestFilter
    t.minFilter = THREE.NearestFilter
    t.generateMipmaps = false
    t.colorSpace = THREE.SRGBColorSpace
    skinCache.set(kind, t)
  }
  return t
}

interface Part {
  mesh: THREE.Mesh
  baseY: number
  swingPhase: number
  isLeg: boolean
  isHead: boolean
  isArm: boolean
}

export interface Mob {
  type: MobType
  group: THREE.Group
  pos: THREE.Vector3
  vel: THREE.Vector3
  yaw: number
  hp: number
  onGround: boolean
  state: 'idle' | 'walk' | 'chase'
  stateT: number
  walkPhase: number
  parts: Part[]
  mats: THREE.MeshBasicMaterial[]
  hurtT: number
  voiceCd: number
  attackCd: number
  burning: boolean
  dead: boolean
}

export interface MobRayHit {
  mob: Mob
  dist: number
}

export class MobManager {
  mobs: Mob[] = []
  private scene: THREE.Scene
  private world: World
  private sfx: SoundFX
  private particles: ParticleSystem
  private spawnTimer = 2
  private tmpBox = new THREE.Box3()
  private light = new THREE.Color(1, 1, 1)
  enabled = true

  constructor(scene: THREE.Scene, world: World, sfx: SoundFX, particles: ParticleSystem) {
    this.scene = scene
    this.world = world
    this.sfx = sfx
    this.particles = particles
  }

  /** scene light tint (day/night) applied to all mob materials */
  setLight(c: THREE.Color) {
    this.light.copy(c)
  }

  /** distance-limited positional voice */
  private voice(mob: Mob, playerPos: THREE.Vector3, base = 1) {
    const dx = mob.pos.x - playerPos.x
    const dy = mob.pos.y - playerPos.y
    const dz = mob.pos.z - playerPos.z
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (d > 26) return
    const vol = base * Math.max(0, 1 - d / 26)
    // pan relative to player facing (approx via world x)
    const pan = Math.max(-1, Math.min(1, dx / 12))
    this.sfx.mobVoice(CONFIG[mob.type].voice, vol, pan)
  }

  // ---------- building models ----------
  private makePart(
    w: number, h: number, d: number,
    tex: SkinSpec,
    x: number, y: number, z: number,
    mats: THREE.MeshBasicMaterial[],
    swingPhase = 0,
    isLeg = false,
    isHead = false
  ): Part {
    let list: THREE.MeshBasicMaterial[]
    if (typeof tex === 'string') {
      list = [new THREE.MeshBasicMaterial({ map: skin(tex) })]
    } else {
      // BoxGeometry face order: +x, −x, +y, −y, +z, −z → face texture on −z (index 5)
      const order: SkinKind[] = [
        tex.side, tex.side, tex.top, tex.bottom ?? tex.side, tex.back ?? tex.side, tex.front,
      ]
      list = order.map((k) => new THREE.MeshBasicMaterial({ map: skin(k) }))
    }
    for (const m of list) mats.push(m)
    const geo = new THREE.BoxGeometry(w, h, d)
    const mesh = new THREE.Mesh(geo, list)
    mesh.position.set(x, y, z)
    return { mesh, baseY: y, swingPhase, isLeg, isHead, isArm: false }
  }

  /** zombie arm: pivot at the shoulder, rotated forward like the classic monster */
  private makeArm(
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    mats: THREE.MeshBasicMaterial[],
    swingPhase: number
  ): Part {
    const mat = new THREE.MeshBasicMaterial({ map: skin('zombieArm') })
    mats.push(mat)
    const geo = new THREE.BoxGeometry(w, h, d)
    geo.translate(0, -h / 2 + 0.07, 0) // pivot at shoulder end
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, y, z)
    mesh.rotation.x = ARM_BASE
    return { mesh, baseY: y, swingPhase, isLeg: false, isHead: false, isArm: true }
  }

  private build(type: MobType): Mob {
    const group = new THREE.Group()
    const parts: Part[] = []
    const mats: THREE.MeshBasicMaterial[] = []
    const cfg = CONFIG[type]

    if (type === 'sheep') {
      parts.push(this.makePart(0.9, 0.7, 1.2, 'wool', 0, 0.75, 0, mats))
      parts.push(this.makePart(0.55, 0.55, 0.55, { front: 'sheepHeadFront', side: 'sheepHeadSide', top: 'sheepHeadTop', back: 'sheepHeadSide' }, 0, 1.05, -0.75, mats, 0, false, true))
      for (const [x, z, ph] of [[-0.28, -0.42, 0], [0.28, -0.42, Math.PI], [-0.28, 0.42, Math.PI], [0.28, 0.42, 0]] as const) {
        parts.push(this.makePart(0.24, 0.5, 0.24, 'sheepLeg', x, 0.25, z, mats, ph, true, false))
      }
    } else if (type === 'cow') {
      parts.push(this.makePart(0.95, 0.75, 1.35, 'cowHide', 0, 0.85, 0, mats))
      parts.push(this.makePart(0.55, 0.55, 0.55, { front: 'cowHeadFront', side: 'cowHeadSide', top: 'cowHeadTop', back: 'cowHeadSide' }, 0, 1.2, -0.85, mats, 0, false, true))
      for (const [x, z, ph] of [[-0.3, -0.48, 0], [0.3, -0.48, Math.PI], [-0.3, 0.48, Math.PI], [0.3, 0.48, 0]] as const) {
        parts.push(this.makePart(0.26, 0.6, 0.26, 'cowLeg', x, 0.3, z, mats, ph, true, false))
      }
    } else if (type === 'pig') {
      parts.push(this.makePart(0.85, 0.65, 1.15, 'pigSkin', 0, 0.55, 0, mats))
      parts.push(this.makePart(0.55, 0.5, 0.5, { front: 'pigHeadFront', side: 'pigHeadSide', top: 'pigHeadTop', back: 'pigHeadSide' }, 0, 0.65, -0.72, mats, 0, false, true))
      for (const [x, z, ph] of [[-0.26, -0.38, 0], [0.26, -0.38, Math.PI], [-0.26, 0.38, Math.PI], [0.26, 0.38, 0]] as const) {
        parts.push(this.makePart(0.24, 0.35, 0.24, 'pigLeg', x, 0.18, z, mats, ph, true, false))
      }
    } else if (type === 'chicken') {
      parts.push(this.makePart(0.45, 0.45, 0.6, 'feather', 0, 0.45, 0, mats))
      parts.push(this.makePart(0.4, 0.45, 0.4, { front: 'chickenHeadFront', side: 'chickenHeadSide', top: 'chickenHeadTop', back: 'chickenHeadSide' }, 0, 0.85, -0.28, mats, 0, false, true))
      // wings
      parts.push(this.makePart(0.1, 0.35, 0.5, 'chickenWing', -0.28, 0.5, 0, mats))
      parts.push(this.makePart(0.1, 0.35, 0.5, 'chickenWing', 0.28, 0.5, 0, mats))
      for (const [x, ph] of [[-0.12, 0], [0.12, Math.PI]] as const) {
        parts.push(this.makePart(0.12, 0.3, 0.12, 'chickenLeg', x, 0.15, 0, mats, ph, true, false))
      }
    } else {
      // zombie — classic green humanoid with outstretched arms
      parts.push(this.makePart(0.55, 0.75, 0.32, 'zombieShirt', 0, 1.15, 0, mats))
      parts.push(this.makePart(0.5, 0.5, 0.5, { front: 'zombieHeadFront', side: 'zombieHeadSide', top: 'zombieHeadTop', back: 'zombieHeadSide' }, 0, 1.75, 0, mats, 0, false, true))
      parts.push(this.makeArm(0.2, 0.72, 0.2, -0.39, 1.66, 0, mats, 0))
      parts.push(this.makeArm(0.2, 0.72, 0.2, 0.39, 1.66, 0, mats, Math.PI))
      for (const [x, ph] of [[-0.14, 0], [0.14, Math.PI]] as const) {
        parts.push(this.makePart(0.24, 0.78, 0.24, 'zombiePants', x, 0.39, 0, mats, ph, true, false))
      }
    }

    for (const p of parts) group.add(p.mesh)
    group.userData.height = cfg.height
    return {
      type, group,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0,
      hp: cfg.hp, onGround: false, state: 'idle', stateT: 1 + Math.random() * 2,
      walkPhase: 0, parts, mats, hurtT: 0, voiceCd: 2 + Math.random() * 8,
      attackCd: 0, burning: false, dead: false,
    }
  }

  private spawnAt(type: MobType, x: number, y: number, z: number): Mob {
    const mob = this.build(type)
    mob.pos.set(x, y, z)
    mob.yaw = Math.random() * Math.PI * 2
    mob.group.position.copy(mob.pos)
    this.scene.add(mob.group)
    this.mobs.push(mob)
    return mob
  }

  /** public spawn used by the engine for initial seeding (passive animals only) */
  spawnPassiveAt(type: 'sheep' | 'cow' | 'pig' | 'chicken', x: number, y: number, z: number): Mob {
    return this.spawnAt(type, x, y, z)
  }

  private trySpawn(playerPos: THREE.Vector3, dayF: number) {
    let passive = 0
    let hostile = 0
    for (const m of this.mobs) {
      if (CONFIG[m.type].hostile) hostile++
      else passive++
    }
    const wantZombie = dayF < 0.35 && hostile < MAX_HOSTILE
    const wantPassive = passive < MAX_PASSIVE
    if (!wantZombie && !wantPassive) return

    for (let attempt = 0; attempt < 10; attempt++) {
      const ang = Math.random() * Math.PI * 2
      const dist = 10 + Math.random() * 18
      const x = Math.floor(playerPos.x + Math.cos(ang) * dist)
      const z = Math.floor(playerPos.z + Math.sin(ang) * dist)
      const type: MobType = wantZombie && (!wantPassive || Math.random() < 0.45) ? 'zombie'
        : (['sheep', 'cow', 'pig', 'chicken'] as MobType[])[Math.floor(Math.random() * 4)]
      // find ground
      const gy = this.world.highestBlock(x, z)
      if (gy <= 1) continue
      const groundId = this.world.getBlock(x, gy, z)
      if (!isSolid(groundId) || groundId === B.WATER) continue
      if (CONFIG[type].hostile) {
        // zombies anywhere at night, but not right next to player
        this.spawnAt(type, x + 0.5, gy + 1.05, z + 0.5)
        return
      }
      // passive animals prefer grass
      if (groundId !== B.GRASS && groundId !== B.SNOW && Math.random() < 0.7) continue
      this.spawnAt(type, x + 0.5, gy + 1.05, z + 0.5)
      return
    }
  }

  // ---------- collision ----------
  private collide(mob: Mob, dt: number) {
    const cfg = CONFIG[mob.type]
    const half = cfg.width / 2
    // gravity / buoyancy
    const inWater = this.world.getBlock(Math.floor(mob.pos.x), Math.floor(mob.pos.y + 0.3), Math.floor(mob.pos.z)) === B.WATER
    if (inWater) {
      mob.vel.y += 14 * dt
      mob.vel.y = Math.min(2.2, mob.vel.y)
    } else if (mob.type === 'chicken') {
      mob.vel.y -= GRAVITY * 0.35 * dt
      mob.vel.y = Math.max(-2.4, mob.vel.y)
    } else {
      mob.vel.y -= GRAVITY * dt
    }

    // horizontal moves with block collision
    const moveAxis = (axis: 'x' | 'z') => {
      const delta = mob.vel[axis] * dt
      if (delta === 0) return false
      mob.pos[axis] += delta
      const p = mob.pos
      const minX = Math.floor(p.x - half)
      const maxX = Math.floor(p.x + half)
      const minY = Math.floor(p.y)
      const maxY = Math.floor(p.y + cfg.height - 0.05)
      const minZ = Math.floor(p.z - half)
      const maxZ = Math.floor(p.z + half)
      let hit = false
      for (let bx = minX; bx <= maxX; bx++) {
        for (let by = minY; by <= maxY; by++) {
          for (let bz = minZ; bz <= maxZ; bz++) {
            if (!isSolid(this.world.getBlock(bx, by, bz))) continue
            hit = true
            if (axis === 'x') {
              mob.pos.x = delta > 0 ? bx - half - 0.001 : bx + 1 + half + 0.001
              mob.vel.x = 0
            } else {
              mob.pos.z = delta > 0 ? bz - half - 0.001 : bz + 1 + half + 0.001
              mob.vel.z = 0
            }
          }
        }
      }
      return hit
    }
    const hitX = moveAxis('x')
    const hitZ = moveAxis('z')

    // vertical
    mob.pos.y += mob.vel.y * dt
    mob.onGround = false
    {
      const p = mob.pos
      const minX = Math.floor(p.x - half)
      const maxX = Math.floor(p.x + half)
      const minZ = Math.floor(p.z - half)
      const maxZ = Math.floor(p.z + half)
      if (mob.vel.y <= 0) {
        const fy = Math.floor(p.y)
        for (let bx = minX; bx <= maxX; bx++) {
          for (let bz = minZ; bz <= maxZ; bz++) {
            if (!isSolid(this.world.getBlock(bx, fy, bz))) continue
            mob.pos.y = fy + 1
            mob.vel.y = 0
            mob.onGround = true
          }
        }
      } else {
        const hy = Math.floor(p.y + cfg.height)
        for (let bx = minX; bx <= maxX; bx++) {
          for (let bz = minZ; bz <= maxZ; bz++) {
            if (!isSolid(this.world.getBlock(bx, hy, bz))) continue
            mob.vel.y = 0
          }
        }
      }
    }

    // auto-jump 1-high steps
    if ((hitX || hitZ) && mob.onGround) {
      const aheadX = Math.floor(mob.pos.x - Math.sin(mob.yaw) * 0.8)
      const aheadZ = Math.floor(mob.pos.z - Math.cos(mob.yaw) * 0.8)
      const feet = isSolid(this.world.getBlock(aheadX, Math.floor(mob.pos.y), aheadZ))
      const head = isSolid(this.world.getBlock(aheadX, Math.floor(mob.pos.y) + 1, aheadZ))
      const head2 = isSolid(this.world.getBlock(aheadX, Math.floor(mob.pos.y) + 2, aheadZ))
      if (feet && !head && (cfg.height < 1.5 || !head2)) {
        mob.vel.y = 7
        mob.onGround = false
      } else {
        // turn away from wall
        mob.yaw += Math.PI * (0.5 + Math.random() * 0.5)
      }
    }
    return hitX || hitZ
  }

  // ---------- per-frame update ----------
  update(dt: number, playerPos: THREE.Vector3, dayF: number, playerAlive: boolean, onPlayerHit: (dmg: number, from: THREE.Vector3) => void) {
    if (!this.enabled) return

    // spawn cycle
    this.spawnTimer -= dt
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 3
      this.trySpawn(playerPos, dayF)
    }

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i]
      const cfg = CONFIG[mob.type]
      const dx = playerPos.x - mob.pos.x
      const dz = playerPos.z - mob.pos.z
      const distXZ = Math.hypot(dx, dz)

      // despawn far or dead
      if (mob.dead || distXZ > DESPAWN_DIST || Math.abs(playerPos.y - mob.pos.y) > 40) {
        this.scene.remove(mob.group)
        for (const p of mob.parts) p.mesh.geometry.dispose()
        for (const m of mob.mats) m.dispose()
        this.mobs.splice(i, 1)
        continue
      }

      // zombie burns in daylight
      if (mob.type === 'zombie' && dayF > 0.6) {
        const sky = this.world.highestBlock(Math.floor(mob.pos.x), Math.floor(mob.pos.z))
        if (sky <= Math.floor(mob.pos.y)) {
          mob.burning = true
          mob.hurtT = 0.3
          if (Math.random() < dt * 2.2) {
            this.damage(mob, 1, null)
            if (mob.dead) {
              this.particles.spawnBurst(mob.pos.x, mob.pos.y + 1, mob.pos.z, [0.9, 0.55, 0.2], 12)
              continue
            }
          }
        }
      } else if (mob.type === 'zombie') {
        mob.burning = false
      }

      // voice cooldown
      mob.voiceCd -= dt
      if (mob.voiceCd <= 0) {
        mob.voiceCd = 6 + Math.random() * 10
        if (distXZ < 22) this.voice(mob, playerPos)
      }

      // AI state machine
      mob.stateT -= dt
      if (mob.type === 'zombie' && playerAlive && distXZ < 15 && Math.abs(playerPos.y - mob.pos.y) < 6) {
        mob.state = 'chase'
      } else if (mob.state === 'chase' && (distXZ > 20 || !playerAlive)) {
        mob.state = 'idle'
        mob.stateT = 1 + Math.random() * 2
      }
      if (mob.state !== 'chase' && mob.stateT <= 0) {
        if (mob.state === 'idle') {
          mob.state = 'walk'
          mob.stateT = 2 + Math.random() * 3.5
          mob.yaw = Math.random() * Math.PI * 2
        } else {
          mob.state = 'idle'
          mob.stateT = 1.5 + Math.random() * 4
        }
      }

      // movement
      let speed = 0
      if (mob.state === 'walk') {
        speed = cfg.speed
      } else if (mob.state === 'chase') {
        speed = cfg.speed * 1.5
        // face and run toward the player (mob front = local −Z)
        mob.yaw = Math.atan2(-dx, -dz)
      }
      if (speed > 0) {
        // avoid walking into water / off tall cliffs (passive only)
        if (!cfg.hostile && mob.onGround) {
          const ax = Math.floor(mob.pos.x - Math.sin(mob.yaw) * 1.2)
          const az = Math.floor(mob.pos.z - Math.cos(mob.yaw) * 1.2)
          const aheadId = this.world.getBlock(ax, Math.floor(mob.pos.y) - 1, az)
          if (aheadId === B.WATER || aheadId === B.AIR) {
            // check it is not just a 1-step down
            const deep = this.world.getBlock(ax, Math.floor(mob.pos.y) - 3, az)
            if (deep === B.WATER || deep === B.AIR) mob.yaw += Math.PI * (0.6 + Math.random() * 0.6)
          }
        }
        mob.vel.x = -Math.sin(mob.yaw) * speed
        mob.vel.z = -Math.cos(mob.yaw) * speed
      } else {
        mob.vel.x *= 0.8
        mob.vel.z *= 0.8
      }

      this.collide(mob, dt)

      // zombie attack
      if (mob.type === 'zombie' && playerAlive) {
        mob.attackCd -= dt
        const dy = Math.abs(playerPos.y - mob.pos.y)
        if (distXZ < 1.35 && dy < 2 && mob.attackCd <= 0) {
          mob.attackCd = 1.1
          const from = new THREE.Vector3(mob.pos.x, mob.pos.y, mob.pos.z)
          onPlayerHit(3, from)
          this.voice(mob, playerPos, 1.2)
        }
      }

      // hurt flash decay + day/night shading on all materials
      if (mob.hurtT > 0) mob.hurtT -= dt
      const hurt = mob.hurtT > 0
      const lc = this.light
      for (const m of mob.mats) {
        if (hurt) m.color.setRGB(lc.r, lc.g * 0.35, lc.b * 0.35)
        else m.color.copy(lc)
      }

      // apply transform + animation
      mob.group.position.copy(mob.pos)
      mob.group.rotation.y = mob.yaw
      const moving = Math.hypot(mob.vel.x, mob.vel.z) > 0.15
      if (moving) mob.walkPhase += dt * 9
      for (const p of mob.parts) {
        if (p.isLeg) {
          p.mesh.rotation.x = moving ? Math.sin(mob.walkPhase + p.swingPhase) * 0.7 : 0
        } else if (p.isArm) {
          p.mesh.rotation.x = ARM_BASE + Math.sin(mob.walkPhase * 0.5 + p.swingPhase) * 0.12
        } else if (p.isHead) {
          // look toward player when close (passive mobs)
          if (!cfg.hostile && distXZ < 6) {
            // player direction in the group's local frame
            const cosY = Math.cos(mob.yaw)
            const sinY = Math.sin(mob.yaw)
            const lx = dx * cosY - dz * sinY
            const lz = dx * sinY + dz * cosY
            const want = Math.atan2(-lx, -lz)
            let w = want
            while (w > Math.PI) w -= Math.PI * 2
            while (w < -Math.PI) w += Math.PI * 2
            p.mesh.rotation.y = Math.max(-1, Math.min(1, w)) * 0.6
            p.mesh.position.y = p.baseY + (mob.state === 'idle' ? Math.sin(performance.now() * 0.002 + mob.walkPhase) * 0.02 : 0)
          } else {
            p.mesh.rotation.y = 0
          }
        }
      }
      // chicken wing flap while falling
      if (mob.type === 'chicken' && !mob.onGround) {
        for (const p of mob.parts) {
          if (p.isLeg) p.mesh.rotation.x = Math.sin(performance.now() * 0.04) * 0.9
        }
      }
    }
  }

  /** apply damage; knockDir nullable. Returns true if killed. */
  damage(mob: Mob, amount: number, knockDir: THREE.Vector3 | null): boolean {
    if (mob.dead) return true
    mob.hp -= amount
    mob.hurtT = 0.28
    if (knockDir) {
      mob.vel.x = knockDir.x * 6.5
      mob.vel.z = knockDir.z * 6.5
      mob.vel.y = 4.6
      mob.onGround = false
    }
    if (mob.hp <= 0) {
      mob.dead = true
      this.sfx.pop()
      return true
    }
    return false
  }

  /** ray vs mob AABBs — returns nearest hit within maxDist */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): MobRayHit | null {
    let best: MobRayHit | null = null
    for (const mob of this.mobs) {
      if (mob.dead) continue
      const cfg = CONFIG[mob.type]
      const half = cfg.width / 2
      this.tmpBox.min.set(mob.pos.x - half, mob.pos.y, mob.pos.z - half)
      this.tmpBox.max.set(mob.pos.x + half, mob.pos.y + cfg.height, mob.pos.z + half)
      const ray = new THREE.Ray(origin, dir)
      const point = ray.intersectBox(this.tmpBox, new THREE.Vector3())
      if (!point) continue
      const dist = origin.distanceTo(point)
      if (dist <= maxDist && (!best || dist < best.dist)) {
        best = { mob, dist }
      }
    }
    return best
  }

  passiveCount(): number {
    let n = 0
    for (const m of this.mobs) if (!CONFIG[m.type].hostile) n++
    return n
  }

  clearAll() {
    for (const mob of this.mobs) {
      this.scene.remove(mob.group)
      for (const p of mob.parts) p.mesh.geometry.dispose()
      for (const m of mob.mats) m.dispose()
    }
    this.mobs = []
  }

  dispose() {
    this.clearAll()
  }
}
