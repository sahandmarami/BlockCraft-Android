// Staging script: find dry flat land, teleport player, stage zombie for texture check
(() => {
  const en = window.__voxelEngine
  const w = en.world
  const px = Math.floor(en.pos.x)
  const pz = Math.floor(en.pos.z)
  let best = null
  for (let r = 6; r < 90 && !best; r += 3) {
    for (let a = 0; a < 20 && !best; a++) {
      const x = px + Math.round(Math.cos((a * Math.PI) / 10) * r)
      const z = pz + Math.round(Math.sin((a * Math.PI) / 10) * r)
      let mn = 99
      let mx = -99
      let dry = true
      for (let dx = -2; dx <= 2 && dry; dx++) {
        for (let dz = -2; dz <= 2 && dry; dz++) {
          const h = w.highestBlock(x + dx, z + dz)
          const g = w.getBlock(x + dx, h, z + dz)
          const above = w.getBlock(x + dx, h + 1, z + dz)
          if (h < 3 || g === 10 || above !== 0) { dry = false; break }
          mn = Math.min(mn, h)
          mx = Math.max(mx, h)
        }
      }
      if (dry && mx - mn <= 1 && mn > 2) best = { x, z, h: mn }
    }
  }
  if (!best) return 'no dry flat spot'
  en.mobs.enabled = false
  en.pos.set(best.x + 0.5, best.h + 2.6, best.z + 0.5)
  en.vel.set(0, 0, 0)
  en.setSettings({ ...en.settings, mode: 'creative' })
  en.flying = true
  w.time = 0.25
  let z = en.mobs.mobs.find((m) => m.type === 'zombie')
  if (!z) z = en.mobs.spawnAt('zombie', best.x, best.h, best.z)
  const fx = -Math.sin(en.yaw)
  const fz = -Math.cos(en.yaw)
  z.pos.set(best.x + 0.5 + fx * 3.4, best.h + 1.02, best.z + 0.5 + fz * 3.4)
  z.yaw = Math.atan2(fx, fz) + Math.PI
  z.group.position.copy(z.pos)
  z.group.rotation.y = z.yaw
  en.pitch = -0.28
  return 'dry flat @' + best.x + ',' + best.z + ' h=' + best.h
})()
