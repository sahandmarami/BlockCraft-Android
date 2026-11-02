// Voxel world: chunk data generation, terrain, trees, caves, edits, persistence
import { B, isSolid } from './blocks'
import { Noise, hash2 } from './noise'

export const CHUNK_SX = 16
export const CHUNK_SZ = 16
export const CHUNK_SY = 80
export const WATER_LEVEL = 30

export interface WorldSaveData {
  seed: number
  time: number
  edits: [string, number][]
  player?: { x: number; y: number; z: number; yaw: number; pitch: number; fly: boolean }
}

export class World {
  seed: number
  time = 0.08 // day cycle [0,1): 0=dawn, 0.25=noon, 0.5=dusk, 0.75=midnight
  private noise: Noise
  private noise2: Noise
  private noise3: Noise
  /** player modifications: "x,y,z" → block id */
  edits = new Map<string, number>()
  private chunks = new Map<string, Uint8Array>()

  constructor(seed: number) {
    this.seed = seed | 0
    this.noise = new Noise(this.seed)
    this.noise2 = new Noise(this.seed ^ 0x5f356495)
    this.noise3 = new Noise(this.seed ^ 0x1b56c4e9)
  }

  static key(cx: number, cz: number): string {
    return cx + ',' + cz
  }

  /** terrain height for column (pure function of noise) */
  terrainHeight(x: number, z: number): number {
    const n = this.noise
    const base = n.fbm2(x * 0.008, z * 0.008, 4) * 20
    const detail = n.fbm2(x * 0.045 + 40, z * 0.045 - 20, 2) * 3.2
    const m = n.fbm2(x * 0.004 + 137, z * 0.004 - 91, 3)
    let h = 34 + base + detail
    if (m > 0.22) h += (m - 0.22) * 52 // mountains
    // deserts are flatter / dunes
    if (this.biomeAt(x, z) === 'desert') h = 34 + base * 0.55 + detail * 1.6
    return Math.max(5, Math.min(CHUNK_SY - 12, Math.round(h)))
  }

  /** biome for a column — large-scale temperature + humidity noise */
  biomeAt(x: number, z: number): 'desert' | 'snow' | 'forest' | 'plains' {
    const temp = this.noise3.fbm2(x * 0.0021 + 911, z * 0.0021 - 455, 2)
    const hum = this.noise3.fbm2(x * 0.0026 - 777, z * 0.0026 + 123, 2)
    if (temp > 0.3 && hum < 0.05) return 'desert'
    if (temp < -0.4) return 'snow'
    if (hum > 0.18) return 'forest'
    return 'plains'
  }

  private treeAt(x: number, z: number): { h: number; trunk: number } | null {
    const biome = this.biomeAt(x, z)
    const density = biome === 'forest' ? 0.034 : biome === 'snow' ? 0.006 : biome === 'desert' ? 0 : 0.006
    if (density === 0) return null
    if (hash2(x, z, this.seed ^ 0x9e3779b9) >= density) return null
    const h = this.terrainHeight(x, z)
    if (h <= WATER_LEVEL + 1 || h > 52) return null
    const trunk = (biome === 'snow' ? 5 : 4) + Math.floor(hash2(x, z, this.seed ^ 0x1234abcd) * 3)
    return { h, trunk }
  }

  private cactusAt(x: number, z: number): number {
    if (this.biomeAt(x, z) !== 'desert') return 0
    if (hash2(x, z, this.seed ^ 0xcafe12) >= 0.006) return 0
    const h = this.terrainHeight(x, z)
    if (h <= WATER_LEVEL + 2 || h > 52) return 0
    return 1 + Math.floor(hash2(x, z, this.seed ^ 0xcafe13) * 3) // 1..3 tall
  }

  private generateChunk(cx: number, cz: number): Uint8Array {
    const data = new Uint8Array(CHUNK_SX * CHUNK_SY * CHUNK_SZ)
    const idx = (x: number, y: number, z: number) => (y * CHUNK_SZ + z) * CHUNK_SX + x
    const ox = cx * CHUNK_SX
    const oz = cz * CHUNK_SZ

    for (let lx = 0; lx < CHUNK_SX; lx++) {
      for (let lz = 0; lz < CHUNK_SZ; lz++) {
        const wx = ox + lx
        const wz = oz + lz
        const h = this.terrainHeight(wx, wz)
        const biome = this.biomeAt(wx, wz)
        const beach = h <= WATER_LEVEL + 1
        const mountain = h > 50
        const snowcap = h > 56 + hash2(wx, wz, this.seed ^ 0x777) * 5
        const isDesert = biome === 'desert' && !beach
        const isSnowy = (biome === 'snow' || snowcap) && !beach

        for (let y = 0; y <= Math.max(h, WATER_LEVEL); y++) {
          let id: number = B.AIR
          if (y === 0) id = B.BEDROCK
          else if (y === 1 && hash2(wx * 3 + y, wz * 7, this.seed) < 0.5) id = B.BEDROCK
          else if (y <= h) {
            const depth = h - y
            if (depth === 0) {
              if (beach) id = hash2(wx, wz, this.seed ^ 0x22) < 0.25 ? B.GRAVEL : B.SAND
              else if (isSnowy) id = B.SNOW
              else if (isDesert) id = B.SAND
              else if (mountain) id = B.STONE
              else id = B.GRASS
            } else if (depth <= 2) {
              id = beach || isDesert ? B.SAND : isSnowy ? B.DIRT : mountain ? B.STONE : B.DIRT
            } else {
              id = B.STONE
              // ore veins in deep stone
              if (depth > 3) {
                const r = hash2(wx * 31 + y * 7, wz * 17 + y * 3, this.seed ^ 0x0be500)
                if (y < 15 && r < 0.0022) id = B.DIAMOND_ORE
                else if (y < 28 && r >= 0.01 && r < 0.015) id = B.GOLD_ORE
                else if (y < 48 && r >= 0.03 && r < 0.039) id = B.IRON_ORE
                else if (y < 64 && r >= 0.05 && r < 0.064) id = B.COAL_ORE
              }
            }
            // caves
            if (y > 2 && y < h - 3 && id !== B.BEDROCK) {
              const cave = this.noise2.noise3(wx * 0.074, y * 0.09, wz * 0.074)
              if (cave > 0.68) id = B.AIR
            }
          } else if (y <= WATER_LEVEL) {
            id = B.WATER
          }
          if (id !== B.AIR) data[idx(lx, y, lz)] = id
        }

        // plants on grass (not in desert / snow)
        if (!beach && !mountain && biome !== 'desert' && biome !== 'snow' && !snowcap && h > WATER_LEVEL && h < CHUNK_SY - 2) {
          const top = data[idx(lx, h, lz)]
          if (top === B.GRASS && data[idx(lx, Math.min(CHUNK_SY - 1, h + 1), lz)] === B.AIR) {
            const r = hash2(wx, wz, this.seed ^ 0x5150)
            if (r < 0.018) data[idx(lx, h + 1, lz)] = B.ROSE
            else if (r < 0.036) data[idx(lx, h + 1, lz)] = B.DANDELION
            else if (r < 0.16) data[idx(lx, h + 1, lz)] = B.TALLGRASS
          }
        }

        // cacti in desert
        if (isDesert) {
          const ch = this.cactusAt(wx, wz)
          if (ch > 0) {
            for (let cy = 1; cy <= ch; cy++) {
              if (h + cy < CHUNK_SY) data[idx(lx, h + cy, lz)] = B.CACTUS
            }
          }
        }
      }
    }

    // trees (scan margin so canopies cross chunk borders consistently)
    for (let tx = ox - 2; tx < ox + CHUNK_SX + 2; tx++) {
      for (let tz = oz - 2; tz < oz + CHUNK_SZ + 2; tz++) {
        const tree = this.treeAt(tx, tz)
        if (!tree) continue
        const baseY = tree.h + 1
        const topY = baseY + tree.trunk - 1
        // trunk
        for (let y = baseY; y <= topY; y++) {
          this.stamp(data, tx - ox, y, tz - oz, B.LOG)
        }
        // canopy
        for (let dy = -2; dy <= 1; dy++) {
          const ry = topY + dy
          const rad = dy < 0 ? 2 : 1
          for (let dx = -rad; dx <= rad; dx++) {
            for (let dz = -rad; dz <= rad; dz++) {
              if (dx === 0 && dz === 0 && dy <= 0) continue
              const corner = Math.abs(dx) === rad && Math.abs(dz) === rad
              if (corner && (dy >= 0 || hash2(tx + dx * 31, tz + dz * 17 + ry, this.seed) < 0.55)) continue
              this.stamp(data, tx - ox + dx, ry, tz - oz + dz, B.LEAVES)
            }
          }
        }
        this.stamp(data, tx - ox, topY + 1, tz - oz, B.LEAVES)
      }
    }

    return data
  }

  /** write block into chunk-local data if inside bounds */
  private stamp(data: Uint8Array, lx: number, y: number, lz: number, id: number) {
    if (lx < 0 || lx >= CHUNK_SX || lz < 0 || lz >= CHUNK_SZ) return
    if (y < 0 || y >= CHUNK_SY) return
    const i = (y * CHUNK_SZ + lz) * CHUNK_SX + lx
    if (id === B.LEAVES && data[i] !== B.AIR) return
    data[i] = id
  }

  getChunkData(cx: number, cz: number): Uint8Array {
    const key = World.key(cx, cz)
    let d = this.chunks.get(key)
    if (!d) {
      d = this.generateChunk(cx, cz)
      // apply player edits
      if (this.edits.size > 0) {
        const ox = cx * CHUNK_SX
        const oz = cz * CHUNK_SZ
        for (const [k, id] of this.edits) {
          const [ex, ey, ez] = k.split(',').map(Number)
          if (ex >= ox && ex < ox + CHUNK_SX && ez >= oz && ez < oz + CHUNK_SZ) {
            const li = (ey * CHUNK_SZ + (ez - oz)) * CHUNK_SX + (ex - ox)
            if (ey >= 0 && ey < CHUNK_SY) d[li] = id
          }
        }
      }
      this.chunks.set(key, d)
      if (this.chunks.size > 600) {
        // drop farthest cached data chunk
        let farKey = ''
        let far = -1
        const px = this.lastCenterX, pz = this.lastCenterZ
        for (const ck of this.chunks.keys()) {
          const [ccx, ccz] = ck.split(',').map(Number)
          const dist = (ccx - px) * (ccx - px) + (ccz - pz) * (ccz - pz)
          if (dist > far) { far = dist; farKey = ck }
        }
        if (farKey) this.chunks.delete(farKey)
      }
    }
    return d
  }

  private lastCenterX = 0
  private lastCenterZ = 0
  setCenter(cx: number, cz: number) {
    this.lastCenterX = cx
    this.lastCenterZ = cz
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= CHUNK_SY) return B.AIR
    const cx = Math.floor(x / CHUNK_SX)
    const cz = Math.floor(z / CHUNK_SZ)
    const d = this.getChunkData(cx, cz)
    const lx = x - cx * CHUNK_SX
    const lz = z - cz * CHUNK_SZ
    return d[(y * CHUNK_SZ + lz) * CHUNK_SX + lx]
  }

  setBlock(x: number, y: number, z: number, id: number, record = true) {
    if (y < 0 || y >= CHUNK_SY) return
    const cx = Math.floor(x / CHUNK_SX)
    const cz = Math.floor(z / CHUNK_SZ)
    const d = this.getChunkData(cx, cz)
    const lx = x - cx * CHUNK_SX
    const lz = z - cz * CHUNK_SZ
    d[(y * CHUNK_SZ + lz) * CHUNK_SX + lx] = id
    if (record) this.edits.set(x + ',' + y + ',' + z, id)
  }

  highestBlock(x: number, z: number): number {
    for (let y = CHUNK_SY - 1; y >= 0; y--) {
      if (isSolid(this.getBlock(x, y, z))) return y
    }
    return 0
  }

  /** find a dry spawn point near origin */
  findSpawn(): { x: number; y: number; z: number } {
    for (let r = 0; r < 40; r++) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2
        const x = Math.round(Math.cos(ang) * r * 3)
        const z = Math.round(Math.sin(ang) * r * 3)
        const h = this.terrainHeight(x, z)
        if (h > WATER_LEVEL + 1 && h < 55) {
          return { x: x + 0.5, y: h + 2.2, z: z + 0.5 }
        }
      }
    }
    return { x: 0.5, y: this.terrainHeight(0, 0) + 2.2, z: 0.5 }
  }

  exportSave(): WorldSaveData {
    return { seed: this.seed, time: this.time, edits: Array.from(this.edits.entries()) }
  }

  applySave(s: WorldSaveData) {
    this.time = s.time ?? 0.08
    this.edits = new Map(s.edits)
  }

  dispose() {
    this.chunks.clear()
    this.edits.clear()
  }
}
