// Stage all 4 passive animals in a row, day light, AI frozen
(() => {
  const en = window.__voxelEngine
  en.mobs.enabled = false
  // clear existing mobs so the row is clean
  for (let i = en.mobs.mobs.length - 1; i >= 0; i--) {
    const m = en.mobs.mobs[i]
    en.scene.remove(m.group)
    en.mobs.mobs.splice(i, 1)
  }
  en.world.time = 0.25 // noon
  const fx = -Math.sin(en.yaw)
  const fz = -Math.cos(en.yaw)
  const rx = -fz // right vector
  const rz = fx
  const types = ['sheep', 'cow', 'pig', 'chicken']
  const cx = en.pos.x + fx * 4.2
  const cz = en.pos.z + fz * 4.2
  const gy = en.world.terrainHeight(Math.floor(cx), Math.floor(cz))
  types.forEach((t, i) => {
    const off = (i - 1.5) * 1.5
    const m = en.mobs.spawnPassiveAt(t, cx + rx * off, gy + 1.02, cz + rz * off)
    m.yaw = Math.atan2(fx, fz) + Math.PI // face camera
    m.group.position.copy(m.pos)
    m.group.rotation.y = m.yaw
  })
  // stand player a bit higher to see the row
  en.pos.y = gy + 2.2
  en.vel.set(0, 0, 0)
  en.setSettings({ ...en.settings, mode: 'creative' })
  en.flying = true
  en.pitch = -0.38
  return 'row staged at ground y=' + gy
})()
