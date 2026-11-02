// Hunger flow test: stage a sheep in front, attack until dead, verify hunger gain
(() => {
  const en = window.__voxelEngine
  en.mobs.enabled = false // freeze other AI, keep our sheep static
  const fx = -Math.sin(en.yaw)
  const fz = -Math.cos(en.yaw)
  const gy = en.world.highestBlock(Math.floor(en.pos.x + fx * 2), Math.floor(en.pos.z + fz * 2))
  const sheep = en.mobs.spawnPassiveAt('sheep', en.pos.x + fx * 2, (gy || Math.floor(en.pos.y)) + 0.5, en.pos.z + fz * 2)
  sheep.group.position.copy(sheep.pos)
  en.hunger = 10
  en['cb'].onHunger?.(10)
  // attack straight ahead (center of screen)
  let kills = 0
  for (let i = 0; i < 6; i++) {
    en.attackCooldown = 0
    const hitMob = en['tryAttack'](0, 0)
    if (hitMob && sheep.dead) { kills = i + 1; break }
  }
  return JSON.stringify({ sheepDead: sheep.dead, hits: kills, hungerAfter: en.hunger, gain: en.hunger - 10 })
})()
