(() => {
  const en = window.__voxelEngine
  const z = en.mobs.mobs.find((m) => m.type === 'zombie')
  const dx = z.pos.x - en.pos.x
  const dz = z.pos.z - en.pos.z
  en.yaw = Math.atan2(-dx, -dz) + 1.15
  en.pitch = -0.05
  return 'side view ok'
})()
