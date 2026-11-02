// Block registry — original voxel game block definitions
import { TILE } from './textures'

export const B = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  COBBLE: 4,
  SAND: 5,
  LOG: 6,
  PLANKS: 7,
  LEAVES: 8,
  GLASS: 9,
  WATER: 10,
  BRICKS: 11,
  BEDROCK: 12,
  SNOW: 13,
  GLOWSTONE: 14,
  ROSE: 15,
  DANDELION: 16,
  TALLGRASS: 17,
  GRAVEL: 18,
  CACTUS: 19,
  COAL_ORE: 20,
  IRON_ORE: 21,
  GOLD_ORE: 22,
  DIAMOND_ORE: 23,
  BED: 24,
} as const

export type SoundMat = 'stone' | 'dirt' | 'sand' | 'wood' | 'glass' | 'plant' | 'snow' | 'generic'

export interface BlockDef {
  id: number
  name: string
  /** [top, bottom, side] tile indices */
  tiles: [number, number, number]
  solid: boolean
  /** blocks light / causes AO / culls neighbor faces */
  opaque: boolean
  cross: boolean
  liquid: boolean
  /** seconds to break; -1 = unbreakable */
  hardness: number
  placeable: boolean
  /** can be replaced when placing a block into its cell */
  replaceable: boolean
  snd: SoundMat
}

function def(
  id: number,
  name: string,
  tiles: [number, number, number],
  opts: Partial<BlockDef> = {}
): BlockDef {
  return {
    id,
    name,
    tiles,
    solid: true,
    opaque: true,
    cross: false,
    liquid: false,
    hardness: 0.6,
    placeable: true,
    replaceable: false,
    snd: 'stone',
    ...opts,
  }
}

export const BLOCKS: Record<number, BlockDef> = {
  [B.GRASS]: def(B.GRASS, 'بلوک چمن', [TILE.GRASS_TOP, TILE.DIRT, TILE.GRASS_SIDE], { hardness: 0.5, snd: 'dirt' }),
  [B.DIRT]: def(B.DIRT, 'خاک', [TILE.DIRT, TILE.DIRT, TILE.DIRT], { hardness: 0.45, snd: 'dirt' }),
  [B.STONE]: def(B.STONE, 'سنگ', [TILE.STONE, TILE.STONE, TILE.STONE], { hardness: 1.5 }),
  [B.COBBLE]: def(B.COBBLE, 'سنگ فرش', [TILE.COBBLE, TILE.COBBLE, TILE.COBBLE], { hardness: 1.6 }),
  [B.SAND]: def(B.SAND, 'شن', [TILE.SAND, TILE.SAND, TILE.SAND], { hardness: 0.4, snd: 'sand' }),
  [B.GRAVEL]: def(B.GRAVEL, 'سنگریزه', [TILE.GRAVEL, TILE.GRAVEL, TILE.GRAVEL], { hardness: 0.5, snd: 'sand' }),
  [B.LOG]: def(B.LOG, 'چوب درخت', [TILE.LOG_TOP, TILE.LOG_TOP, TILE.LOG_SIDE], { hardness: 0.9, snd: 'wood' }),
  [B.PLANKS]: def(B.PLANKS, 'چوب پرداخته', [TILE.PLANKS, TILE.PLANKS, TILE.PLANKS], { hardness: 0.9, snd: 'wood' }),
  [B.LEAVES]: def(B.LEAVES, 'برگ درخت', [TILE.LEAVES, TILE.LEAVES, TILE.LEAVES], { hardness: 0.2, opaque: false, snd: 'plant' }),
  [B.GLASS]: def(B.GLASS, 'شیشه', [TILE.GLASS, TILE.GLASS, TILE.GLASS], { hardness: 0.3, opaque: false, snd: 'glass' }),
  [B.WATER]: def(B.WATER, 'آب', [TILE.WATER, TILE.WATER, TILE.WATER], { solid: false, opaque: false, liquid: true, hardness: -1, placeable: false, replaceable: true, snd: 'generic' }),
  [B.BRICKS]: def(B.BRICKS, 'آجر', [TILE.BRICKS, TILE.BRICKS, TILE.BRICKS], { hardness: 1.6 }),
  [B.BEDROCK]: def(B.BEDROCK, 'سنگ بستر', [TILE.BEDROCK, TILE.BEDROCK, TILE.BEDROCK], { hardness: -1, placeable: false }),
  [B.SNOW]: def(B.SNOW, 'برف', [TILE.SNOW, TILE.SNOW, TILE.SNOW], { hardness: 0.35, snd: 'snow' }),
  [B.GLOWSTONE]: def(B.GLOWSTONE, 'سنگ درخشان', [TILE.GLOWSTONE, TILE.GLOWSTONE, TILE.GLOWSTONE], { hardness: 0.4, snd: 'glass' }),
  [B.ROSE]: def(B.ROSE, 'گل رز', [TILE.ROSE, TILE.ROSE, TILE.ROSE], { solid: false, opaque: false, cross: true, hardness: 0.05, snd: 'plant' }),
  [B.DANDELION]: def(B.DANDELION, 'گل قاصدک', [TILE.DANDELION, TILE.DANDELION, TILE.DANDELION], { solid: false, opaque: false, cross: true, hardness: 0.05, snd: 'plant' }),
  [B.TALLGRASS]: def(B.TALLGRASS, 'علف بلند', [TILE.TALLGRASS, TILE.TALLGRASS, TILE.TALLGRASS], { solid: false, opaque: false, cross: true, hardness: 0.05, replaceable: true, snd: 'plant' }),
  [B.CACTUS]: def(B.CACTUS, 'کاکتوس', [TILE.CACTUS_TOP, TILE.CACTUS_TOP, TILE.CACTUS_SIDE], { hardness: 0.45, snd: 'plant' }),
  [B.COAL_ORE]: def(B.COAL_ORE, 'سنگ زغال', [TILE.COAL_ORE, TILE.COAL_ORE, TILE.COAL_ORE], { hardness: 1.9 }),
  [B.IRON_ORE]: def(B.IRON_ORE, 'سنگ آهن', [TILE.IRON_ORE, TILE.IRON_ORE, TILE.IRON_ORE], { hardness: 2.2 }),
  [B.GOLD_ORE]: def(B.GOLD_ORE, 'سنگ طلا', [TILE.GOLD_ORE, TILE.GOLD_ORE, TILE.GOLD_ORE], { hardness: 2.4 }),
  [B.DIAMOND_ORE]: def(B.DIAMOND_ORE, 'سنگ الماس', [TILE.DIAMOND_ORE, TILE.DIAMOND_ORE, TILE.DIAMOND_ORE], { hardness: 2.6 }),
  [B.BED]: def(B.BED, 'تخت خواب', [TILE.BED_TOP, TILE.PLANKS, TILE.BED_SIDE], { hardness: 0.4, snd: 'wood' }),
}

export const DEFAULT_HOTBAR: number[] = [
  B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.PLANKS, B.LOG, B.GLASS, B.BRICKS, B.GLOWSTONE,
]

export const PLACEABLE: number[] = [
  B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.SAND, B.GRAVEL, B.LOG, B.PLANKS,
  B.LEAVES, B.GLASS, B.BRICKS, B.SNOW, B.GLOWSTONE, B.CACTUS,
  B.COAL_ORE, B.IRON_ORE, B.GOLD_ORE, B.DIAMOND_ORE,
  B.ROSE, B.DANDELION, B.TALLGRASS, B.BED,
]

/** what a broken block drops into the survival inventory (0 = nothing) */
export function dropOf(id: number): number {
  switch (id) {
    case B.GRASS: return B.DIRT
    case B.STONE: return B.COBBLE
    case B.LEAVES: return 0
    case B.GLASS: return 0
    case B.TALLGRASS: return 0
    case B.WATER:
    case B.AIR:
    case B.BEDROCK: return 0
    default: return id
  }
}

export function blockDef(id: number): BlockDef | undefined {
  return BLOCKS[id]
}

export function isSolid(id: number): boolean {
  const d = BLOCKS[id]
  return !!d && d.solid
}

export function isOpaque(id: number): boolean {
  const d = BLOCKS[id]
  return !!d && d.opaque
}

export function isReplaceable(id: number): boolean {
  return id === B.AIR || id === B.WATER || id === B.TALLGRASS || id === B.ROSE || id === B.DANDELION
}

/** blocks that occlude AO — opaque solids only */
export function occludesAO(id: number): boolean {
  const d = BLOCKS[id]
  return !!d && d.opaque && d.solid
}
