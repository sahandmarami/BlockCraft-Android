// First-person held-block view with swing + bob animations.
// Empty hand shows a pixel-arm (like the original game).
import * as THREE from 'three'
import { buildBlockGeometry } from './mesher'
import type { MeshArrays } from './mesher'

function arraysToGeometry(a: MeshArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(a.positions, 3))
  g.setAttribute('color', new THREE.BufferAttribute(a.colors, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(a.uvs, 2))
  g.setIndex(new THREE.BufferAttribute(a.indices, 1))
  return g
}

/** build a flat-colored box with per-face shading (fake volume) */
function shadedBox(w: number, h: number, d: number, base: { r: number; g: number; b: number }): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d)
  const faceShade = [0.78, 0.78, 1.0, 0.55, 0.9, 0.7] // +x,-x,+y,-y,+z,-z
  const count = g.attributes.position.count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    // BoxGeometry vertex order: 4 verts per face, faces in the order above
    const f = Math.floor(i / 4)
    const s = faceShade[f]
    colors[i * 3] = base.r * s
    colors[i * 3 + 1] = base.g * s
    colors[i * 3 + 2] = base.b * s
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return g
}

export class HandView {
  readonly group = new THREE.Group()
  private mesh: THREE.Mesh | null = null
  private arm: THREE.Mesh
  private mat: THREE.MeshBasicMaterial
  private armMat: THREE.MeshBasicMaterial
  private swingT = 1 // 1 = idle
  private walkCycle = 0
  private currentId = -1

  constructor(atlasMaterial: THREE.MeshBasicMaterial) {
    this.mat = atlasMaterial
    this.armMat = new THREE.MeshBasicMaterial({ vertexColors: true })
    this.arm = new THREE.Mesh(shadedBox(0.24, 0.62, 0.24, { r: 0.85, g: 0.63, b: 0.42 }), this.armMat)
    this.arm.position.set(0.06, -0.1, 0.04)
    this.arm.rotation.set(-0.35, 0, 0.55)
    this.group.add(this.arm)
    this.group.position.set(0.52, -0.44, -0.82)
    this.group.rotation.set(0.1, -0.5, 0.05)
    this.group.renderOrder = 100
  }

  setBlock(id: number) {
    if (id === this.currentId) return
    this.currentId = id
    if (this.mesh) {
      this.group.remove(this.mesh)
      this.mesh.geometry.dispose()
      this.mesh = null
    }
    const built = id ? buildBlockGeometry(id) : null
    this.arm.visible = !built
    if (!built) return
    const geo = arraysToGeometry(built.arrays)
    this.mesh = new THREE.Mesh(geo, this.mat)
    const s = built.cross ? 0.46 : 0.36
    this.mesh.scale.setScalar(s)
    this.mesh.rotation.y = Math.PI / 5
    this.group.add(this.mesh)
  }

  swing() {
    if (this.swingT >= 0.55) this.swingT = 0 // allow re-trigger mid-swing
  }

  update(dt: number, speedXZ: number, onGround: boolean) {
    if (this.swingT < 1) {
      this.swingT = Math.min(1, this.swingT + dt / 0.24)
    }
    const t = this.swingT
    const sw = t < 1 ? Math.sin(t * Math.PI) : 0

    // walk bob
    if (onGround && speedXZ > 0.4) this.walkCycle += dt * speedXZ * 1.9
    const bobY = Math.sin(this.walkCycle * 2) * 0.018 * Math.min(1, speedXZ / 4)
    const bobX = Math.cos(this.walkCycle) * 0.012 * Math.min(1, speedXZ / 4)

    this.group.position.set(
      0.52 + bobX - sw * 0.1,
      -0.44 + bobY - sw * 0.22,
      -0.82 - sw * 0.08
    )
    this.group.rotation.set(0.1 - sw * 0.9, -0.5 + sw * 0.25, 0.05)
  }

  dispose() {
    if (this.mesh) this.mesh.geometry.dispose()
    this.arm.geometry.dispose()
    this.armMat.dispose()
  }
}
