// Block-break particle system (pooled Points)
import * as THREE from 'three'

const MAX = 360

export class ParticleSystem {
  private points: THREE.Points
  private pos: Float32Array
  private col: Float32Array
  private vel: Float32Array
  private life: Float32Array
  private count = 0 // active high-water mark
  private cursor = 0

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(MAX * 3)
    this.col = new Float32Array(MAX * 3)
    this.vel = new Float32Array(MAX * 3)
    this.life = new Float32Array(MAX)
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -9999
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3))
    const mat = new THREE.PointsMaterial({
      size: 0.14,
      vertexColors: true,
      sizeAttenuation: true,
      depthWrite: false,
    })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
    scene.add(this.points)
  }

  spawnBurst(x: number, y: number, z: number, rgb: [number, number, number], n = 18) {
    for (let i = 0; i < n; i++) {
      const idx = this.cursor
      this.cursor = (this.cursor + 1) % MAX
      this.pos[idx * 3] = x + (Math.random() - 0.5) * 0.8
      this.pos[idx * 3 + 1] = y + (Math.random() - 0.5) * 0.8
      this.pos[idx * 3 + 2] = z + (Math.random() - 0.5) * 0.8
      const s = 0.7 + Math.random() * 0.5
      const jitter = 0.85 + Math.random() * 0.3
      this.col[idx * 3] = Math.min(1, rgb[0] * s * jitter)
      this.col[idx * 3 + 1] = Math.min(1, rgb[1] * s * jitter)
      this.col[idx * 3 + 2] = Math.min(1, rgb[2] * s * jitter)
      this.vel[idx * 3] = (Math.random() - 0.5) * 3.2
      this.vel[idx * 3 + 1] = 2 + Math.random() * 3
      this.vel[idx * 3 + 2] = (Math.random() - 0.5) * 3.2
      this.life[idx] = 0.5 + Math.random() * 0.35
      this.count = Math.max(this.count, idx + 1)
    }
  }

  update(dt: number) {
    let any = false
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue
      any = true
      this.life[i] -= dt
      this.vel[i * 3 + 1] -= 12 * dt
      this.pos[i * 3] += this.vel[i * 3] * dt
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -9999
    }
    if (any) {
      ;(this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
      ;(this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true
    }
  }

  dispose() {
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
    this.points.parent?.remove(this.points)
  }
}
