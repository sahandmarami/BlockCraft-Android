// Sky system: gradient dome, day/night cycle, sun + glow, moon, stars, clouds
// All visuals are original procedural artwork.
import * as THREE from 'three'

const DAY_TOP = new THREE.Color(0.32, 0.6, 0.98)
const DAY_HORIZON = new THREE.Color(0.72, 0.85, 0.99)
const NIGHT_TOP = new THREE.Color(0.008, 0.014, 0.04)
const NIGHT_HORIZON = new THREE.Color(0.03, 0.05, 0.1)
const SUNSET = new THREE.Color(0.99, 0.48, 0.2)
const SUNSET_SOFT = new THREE.Color(0.99, 0.66, 0.38)

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function radialGlowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 128
  cv.height = 128
  const ctx = cv.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64)
  g.addColorStop(0, inner)
  g.addColorStop(0.28, inner)
  g.addColorStop(0.45, outer)
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function moonTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 64
  cv.height = 64
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#e8ecf4'
  ctx.fillRect(0, 0, 64, 64)
  // craters (original arrangement)
  const craters: [number, number, number][] = [
    [16, 20, 6], [40, 14, 4], [46, 40, 7], [24, 44, 5], [34, 30, 3], [12, 34, 3],
  ]
  for (const [x, y, r] of craters) {
    ctx.fillStyle = '#c6ccd8'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#b4bac8'
    ctx.beginPath()
    ctx.arc(x + r * 0.15, y + r * 0.15, r * 0.7, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const DOME_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const DOME_FRAG = `
uniform vec3 topColor;
uniform vec3 horizonColor;
varying vec3 vDir;
void main() {
  float h = clamp(vDir.y * 1.35 + 0.12, 0.0, 1.0);
  vec3 col = mix(horizonColor, topColor, pow(h, 0.75));
  gl_FragColor = vec4(col, 1.0);
}
`

export class SkySystem {
  readonly group = new THREE.Group()
  private dome: THREE.Mesh
  private domeUniforms: { topColor: { value: THREE.Color }; horizonColor: { value: THREE.Color } }
  private sun: THREE.Mesh
  private sunGlow: THREE.Sprite
  private moon: THREE.Mesh
  private stars: THREE.Points
  private starBase: Float32Array
  private clouds: THREE.Group
  private clouds2: THREE.Group
  private cloudMat: THREE.MeshBasicMaterial
  private cloudMat2: THREE.MeshBasicMaterial
  private disposables: { dispose(): void }[] = []

  constructor() {
    // gradient sky dome
    this.domeUniforms = {
      topColor: { value: DAY_TOP.clone() },
      horizonColor: { value: DAY_HORIZON.clone() },
    }
    const domeMat = new THREE.ShaderMaterial({
      uniforms: this.domeUniforms,
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(230, 24, 14), domeMat)
    this.dome.renderOrder = -12
    this.group.add(this.dome)
    this.disposables.push(domeMat, this.dome.geometry)

    // sun disc + glow halo
    this.sun = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshBasicMaterial({ color: 0xfff3c2, fog: false, transparent: true, depthWrite: false })
    )
    const glowTex = radialGlowTexture('rgba(255,238,170,0.9)', 'rgba(255,190,90,0.35)')
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex, fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    this.sunGlow = new THREE.Sprite(glowMat)
    this.sunGlow.scale.setScalar(120)
    this.sun.renderOrder = -10
    this.sunGlow.renderOrder = -10
    this.group.add(this.sun, this.sunGlow)
    this.disposables.push(glowTex, glowMat, this.sun.geometry, this.sun.material as THREE.Material)

    // moon
    this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 24),
      new THREE.MeshBasicMaterial({ map: moonTexture(), fog: false, transparent: true, depthWrite: false })
    )
    this.moon.renderOrder = -10
    this.group.add(this.moon)
    this.disposables.push(this.moon.geometry, this.moon.material as THREE.Material)

    // stars
    const N = 500
    const pos = new Float32Array(N * 3)
    const rnd = () => Math.random()
    for (let i = 0; i < N; i++) {
      const u = rnd() * 2 - 1
      const th = rnd() * Math.PI * 2
      const r = Math.sqrt(1 - u * u)
      pos[i * 3] = Math.cos(th) * r * 210
      pos[i * 3 + 1] = Math.abs(u) * 210
      pos[i * 3 + 2] = Math.sin(th) * r * 210
    }
    this.starBase = new Float32Array(N)
    for (let i = 0; i < N; i++) this.starBase[i] = rnd()
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.stars = new THREE.Points(
      sg,
      new THREE.PointsMaterial({ color: 0xffffff, size: 1.9, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false })
    )
    this.stars.renderOrder = -11
    this.group.add(this.stars)
    this.disposables.push(sg, this.stars.material as THREE.Material)

    // clouds — two drifting layers of soft slabs
    this.clouds = new THREE.Group()
    this.clouds2 = new THREE.Group()
    this.cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.62, fog: false, depthWrite: false })
    this.cloudMat2 = new THREE.MeshBasicMaterial({ color: 0xdfe9ff, transparent: true, opacity: 0.42, fog: false, depthWrite: false })
    const geo = new THREE.BoxGeometry(1, 1, 1)
    for (let i = 0; i < 30; i++) {
      const w = 12 + rnd() * 22
      const d = 9 + rnd() * 18
      const m = new THREE.Mesh(geo, this.cloudMat)
      m.scale.set(w, 1.8, d)
      m.position.set((rnd() - 0.5) * 380, 78 + rnd() * 5, (rnd() - 0.5) * 380)
      this.clouds.add(m)
    }
    for (let i = 0; i < 18; i++) {
      const w = 16 + rnd() * 26
      const d = 12 + rnd() * 20
      const m = new THREE.Mesh(geo, this.cloudMat2)
      m.scale.set(w, 1.4, d)
      m.position.set((rnd() - 0.5) * 400, 88 + rnd() * 8, (rnd() - 0.5) * 400)
      this.clouds2.add(m)
    }
    this.clouds.renderOrder = -5
    this.clouds2.renderOrder = -5
    this.group.add(this.clouds, this.clouds2)
    this.disposables.push(geo, this.cloudMat, this.cloudMat2)
  }

  /** returns sky (horizon) color used for fog */
  update(
    time01: number,
    cameraPos: THREE.Vector3,
    _scene: THREE.Scene,
    dt: number
  ): { sky: THREE.Color; brightness: number; tint: THREE.Color } {
    this.group.position.copy(cameraPos)

    const angle = time01 * Math.PI * 2 // 0=dawn, .25=noon, .5=dusk
    const elevation = Math.sin(angle)
    const dir = new THREE.Vector3(Math.cos(angle), elevation, 0.22).normalize()

    this.sun.position.copy(dir).multiplyScalar(200)
    this.sun.lookAt(cameraPos)
    this.sunGlow.position.copy(this.sun.position)
    this.moon.position.copy(dir).multiplyScalar(-200)
    this.moon.lookAt(cameraPos)

    const k = smoothstep(-0.14, 0.26, elevation)
    const sunsetAmt = Math.exp(-Math.pow(elevation / 0.18, 2)) * 0.55

    // dome colors
    const top = NIGHT_TOP.clone().lerp(DAY_TOP, k)
    const horizon = NIGHT_HORIZON.clone().lerp(DAY_HORIZON, k)
    horizon.lerp(SUNSET, sunsetAmt * 0.8)
    top.lerp(SUNSET_SOFT, sunsetAmt * 0.18)
    this.domeUniforms.topColor.value.copy(top)
    this.domeUniforms.horizonColor.value.copy(horizon)

    // stars with subtle twinkle
    const starsMat = this.stars.material as THREE.PointsMaterial
    const tw = 0.82 + 0.18 * Math.sin(performance.now() * 0.0023)
    starsMat.opacity = (1 - k) * tw

    // moonlit night is DARK — full daylight only near noon
    const brightness = 0.1 + 0.9 * k
    // deep blue moonlight tint; terrain reads clearly but clearly night
    const tint = new THREE.Color(0.2, 0.24, 0.44).lerp(new THREE.Color(1, 1, 1), k)
    tint.lerp(new THREE.Color(1.03, 0.9, 0.8), sunsetAmt * 0.4)

    this.cloudMat.color.setScalar(0.14 + 0.86 * k)
    this.cloudMat2.color.setScalar(0.12 + 0.88 * k)
    this.clouds.position.x += dt * 0.9
    if (this.clouds.position.x > 190) this.clouds.position.x = -190
    this.clouds2.position.x -= dt * 0.55
    if (this.clouds2.position.x < -190) this.clouds2.position.x = 190

    const sunMat = this.sun.material as THREE.MeshBasicMaterial
    sunMat.opacity = Math.min(1, k * 0.95 + sunsetAmt)
    ;(this.sunGlow.material as THREE.SpriteMaterial).opacity = 0.25 + 0.5 * k
    const moonMat = this.moon.material as THREE.MeshBasicMaterial
    moonMat.opacity = (1 - k) * 0.95

    // fog = horizon color (slightly lifted so terrain blends smoothly)
    const fogCol = horizon.clone().lerp(top, 0.25)
    return { sky: fogCol, brightness, tint }
  }

  dispose() {
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }
}
