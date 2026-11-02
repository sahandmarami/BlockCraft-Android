// Hunger flow test v2: aim at the sheep precisely, then attack
(() => {
  const en = window.__voxelEngine
  const sheep = en.mobs.mobs.find((m) => m.type === 'sheep' && !m.dead)
  if (!sheep) return 'no sheep'
  const dx = sheep.pos.x - en.pos.x
  const dz = sheep.pos.z - en.pos.z
  const dy = (sheep.pos.y + 0.6) - (en.pos.y + 1.62)
  en.yaw = Math.atan2(-dx, -dz)
  en.pitch = Math.max(-1.2, Math.min(1.2, Math.atan2(dy, Math.hypot(dx, dz))))
  en.camera.rotation.set(0, 0, 0)
  en.camera.rotateY(en.yaw)
  en.camera.rotateX(en.pitch)
  en.camera.updateMatrixWorld()
  let kills = -1
  for (let i = 0; i < 8; i++) {
    en.attackCooldown = 0
    en['tryAttack'](0, 0)
    if (sheep.dead) { kills = i + 1; break }
  }
  return JSON.stringify({ sheepDead: sheep.dead, hits: kills, hp: sheep.hp, hungerAfter: en.hunger, gain: en.hunger - 10 })
})()
