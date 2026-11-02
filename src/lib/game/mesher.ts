// Chunk meshing: face culling + vertex AO + texture atlas UVs
import { B, BLOCKS, isOpaque, occludesAO } from './blocks'
import { CHUNK_SX, CHUNK_SY, CHUNK_SZ, World } from './world'
import { ATLAS_COLS, ATLAS_ROWS, TILE_PX } from './textures'

export interface MeshArrays {
  positions: Float32Array
  colors: Float32Array
  uvs: Float32Array
  indices: Uint32Array
  /** per-vertex sway weight (0 = fixed, 1 = sways with wind) — flora only */
  sway?: Float32Array
}

export interface ChunkMeshData {
  opaque: MeshArrays | null
  water: MeshArrays | null
  flora: MeshArrays | null
}

const AO_CURVE = [0.42, 0.62, 0.82, 1.0]
const FACE_SHADE = { py: 1.0, ny: 0.52, pz: 0.82, nz: 0.82, px: 0.66, nx: 0.66 }

interface FaceDef {
  // 4 corners in CCW order (texture space: bl, br, tr, tl)
  corners: [number, number, number][]
  uvs: [number, number][] // (u,v) in tile space per corner
  normal: [number, number, number]
  shade: number
  // tangent axes for AO
  t1: number
  t2: number
}

const FACES: FaceDef[] = [
  // +X
  {
    corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    normal: [1, 0, 0], shade: FACE_SHADE.px, t1: 2, t2: 1,
  },
  // -X
  {
    corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    normal: [-1, 0, 0], shade: FACE_SHADE.nx, t1: 2, t2: 1,
  },
  // +Y
  {
    corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    normal: [0, 1, 0], shade: FACE_SHADE.py, t1: 0, t2: 2,
  },
  // -Y
  {
    corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    normal: [0, -1, 0], shade: FACE_SHADE.ny, t1: 0, t2: 2,
  },
  // +Z
  {
    corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    normal: [0, 0, 1], shade: FACE_SHADE.pz, t1: 0, t2: 1,
  },
  // -Z
  {
    corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    normal: [0, 0, -1], shade: FACE_SHADE.nz, t1: 0, t2: 1,
  },
]

function tileUVRect(tile: number): [number, number, number, number] {
  const col = tile % ATLAS_COLS
  const row = Math.floor(tile / ATLAS_COLS)
  const u0 = col / ATLAS_COLS
  const u1 = (col + 1) / ATLAS_COLS
  // canvas y is flipped vs texture v
  const v1 = 1 - row / ATLAS_ROWS
  const v0 = 1 - (row + 1) / ATLAS_ROWS
  // tiny inset to avoid atlas bleeding
  const epsU = 0.02 / ATLAS_COLS
  const epsV = 0.02 / ATLAS_ROWS
  return [u0 + epsU, v0 + epsV, u1 - epsU, v1 - epsV]
}

class Buf {
  pos: number[] = []
  col: number[] = []
  uv: number[] = []
  idx: number[] = []
  sway: number[] | null = null
  vertCount = 0

  quad(
    corners: [number, number, number][],
    uvr: [number, number, number, number],
    uvs: [number, number][],
    shades: number[],
    flip: boolean,
    sway?: number[]
  ) {
    const [u0, v0, u1, v1] = uvr
    for (let i = 0; i < 4; i++) {
      const c = corners[i]
      this.pos.push(c[0], c[1], c[2])
      const s = shades[i]
      this.col.push(s, s, s)
      const [cu, cv] = uvs[i]
      this.uv.push(u0 + cu * (u1 - u0), v0 + cv * (v1 - v0))
    }
    if (sway) {
      if (!this.sway) this.sway = []
      while (this.sway.length < this.vertCount) this.sway.push(0)
      this.sway.push(...sway)
    }
    const b = this.vertCount
    if (flip) this.idx.push(b + 1, b + 2, b + 3, b + 1, b + 3, b + 0)
    else this.idx.push(b + 0, b + 1, b + 2, b + 0, b + 2, b + 3)
    this.vertCount += 4
  }

  build(): MeshArrays | null {
    if (this.idx.length === 0) return null
    return {
      positions: new Float32Array(this.pos),
      colors: new Float32Array(this.col),
      uvs: new Float32Array(this.uv),
      indices: new Uint32Array(this.idx),
      ...(this.sway ? { sway: new Float32Array(this.sway) } : {}),
    }
  }
}

export function meshChunk(world: World, cx: number, cz: number): ChunkMeshData {
  const solidBuf = new Buf()
  const waterBuf = new Buf()
  const floraBuf = new Buf()
  const ox = cx * CHUNK_SX
  const oz = cz * CHUNK_SZ

  // neighbor sampling helper (works across chunk borders)
  const get = (x: number, y: number, z: number) => world.getBlock(ox + x, y, oz + z)

  for (let y = 0; y < CHUNK_SY; y++) {
    for (let z = 0; z < CHUNK_SZ; z++) {
      for (let x = 0; x < CHUNK_SX; x++) {
        const id = get(x, y, z)
        if (id === B.AIR) continue
        const def = BLOCKS[id]
        if (!def) continue

        if (def.cross) {
          // two crossed quads, both windings — top vertices sway in the wind
          const uvr = tileUVRect(def.tiles[2])
          const a = 0.15, b = 0.85
          const quads: [number, number, number][][] = [
            [[x + a, y, z + a], [x + b, y, z + b], [x + b, y + 1, z + b], [x + a, y + 1, z + a]],
            [[x + b, y, z + b], [x + a, y, z + a], [x + a, y + 1, z + a], [x + b, y + 1, z + b]],
            [[x + b, y, z + a], [x + a, y, z + b], [x + a, y + 1, z + b], [x + b, y + 1, z + a]],
            [[x + a, y, z + b], [x + b, y, z + a], [x + b, y + 1, z + a], [x + a, y + 1, z + b]],
          ]
          const s = 0.95
          for (const q of quads) floraBuf.quad(q as [number, number, number][], uvr, [[0, 0], [1, 0], [1, 1], [0, 1]], [s, s, s, s], false, [0, 0, 1, 1])
          continue
        }

        if (def.liquid) {
          const above = get(x, y + 1, z)
          const topOpen = above !== B.WATER
          const hgt = topOpen ? 0.875 : 1
          // top face
          if (topOpen) {
            const uvr = tileUVRect(def.tiles[0])
            const s = 1.0
            waterBuf.quad(
              [[x, y + hgt, z + 1], [x + 1, y + hgt, z + 1], [x + 1, y + hgt, z], [x, y + hgt, z]],
              uvr, [[0, 0], [1, 0], [1, 1], [0, 1]], [s, s, s, s], false
            )
          }
          // side faces where neighbor is not water & not opaque
          for (let f = 0; f < FACES.length; f++) {
            if (f === 2 || f === 3) continue // top/bottom handled above / skip bottom
            const face = FACES[f]
            const n = get(x + face.normal[0], y + face.normal[1], z + face.normal[2])
            if (n === B.WATER || isOpaque(n)) continue
            const corners = face.corners.map((c) => {
              const cc: [number, number, number] = [x + c[0], y + c[1] * hgt, z + c[2]]
              return cc
            })
            const uvr = tileUVRect(def.tiles[2])
            const s = face.shade
            waterBuf.quad(corners, uvr, face.uvs, [s, s, s, s], false)
          }
          continue
        }

        // regular cube
        for (let f = 0; f < FACES.length; f++) {
          const face = FACES[f]
          const nx = x + face.normal[0], ny = y + face.normal[1], nz = z + face.normal[2]
          const nid = get(nx, ny, nz)
          // cull: neighbor opaque, or same transparent type (glass/glass, leaves/leaves)
          if (isOpaque(nid)) continue
          if (nid === id && !def.opaque) continue
          if (id === B.GLASS && nid === B.GLASS) continue

          const tile = f === 2 ? def.tiles[0] : f === 3 ? def.tiles[1] : def.tiles[2]
          const uvr = tileUVRect(tile)

          // AO per vertex
          const shades: number[] = []
          for (let vi = 0; vi < 4; vi++) {
            const c = face.corners[vi]
            // offsets in tangent directions based on corner position (0→-1, 1→+1)
            const o1 = c[face.t1] === 1 ? 1 : -1
            const o2 = c[face.t2] === 1 ? 1 : -1
            const s1: [number, number, number] = [nx, ny, nz]
            const s2: [number, number, number] = [nx, ny, nz]
            const cn: [number, number, number] = [nx, ny, nz]
            s1[face.t1] += o1
            s2[face.t2] += o2
            cn[face.t1] += o1
            cn[face.t2] += o2
            const b1 = occludesAO(get(s1[0], s1[1], s1[2])) ? 1 : 0
            const b2 = occludesAO(get(s2[0], s2[1], s2[2])) ? 1 : 0
            const bc = occludesAO(get(cn[0], cn[1], cn[2])) ? 1 : 0
            const ao = b1 && b2 ? 0 : 3 - (b1 + b2 + bc)
            shades.push(face.shade * AO_CURVE[ao])
          }
          const flip = shades[0] + shades[2] < shades[1] + shades[3]
          const corners = face.corners.map((c) => [x + c[0], y + c[1], z + c[2]] as [number, number, number])
          solidBuf.quad(corners, uvr, face.uvs, shades, flip)
        }
      }
    }
  }

  return { opaque: solidBuf.build(), water: waterBuf.build(), flora: floraBuf.build() }
}

/** single-block geometry (for the held item in hand) */
export function buildBlockGeometry(id: number): { arrays: MeshArrays; cross: boolean } | null {
  const def = BLOCKS[id]
  if (!def) return null
  const buf = new Buf()
  if (def.cross) {
    const uvr = tileUVRect(def.tiles[2])
    const quads: [number, number, number][][] = [
      [[0.1, 0, 0.1], [0.9, 0, 0.9], [0.9, 1, 0.9], [0.1, 1, 0.1]],
      [[0.9, 0, 0.9], [0.1, 0, 0.1], [0.1, 1, 0.1], [0.9, 1, 0.9]],
    ]
    for (const q of quads) buf.quad(q, uvr, [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1, 1], false)
    return { arrays: buf.build()!, cross: true }
  }
  for (let f = 0; f < FACES.length; f++) {
    const face = FACES[f]
    const tile = f === 2 ? def.tiles[0] : f === 3 ? def.tiles[1] : def.tiles[2]
    const uvr = tileUVRect(tile)
    const s = face.shade
    const corners = face.corners.map((c) => [c[0] - 0.5, c[1] - 0.5, c[2] - 0.5] as [number, number, number])
    buf.quad(corners, uvr, face.uvs, [s, s, s, s], false)
  }
  return { arrays: buf.build()!, cross: false }
}

export function tilePixelSize(): number {
  return TILE_PX
}
