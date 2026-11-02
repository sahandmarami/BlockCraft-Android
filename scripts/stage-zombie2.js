// One-shot zombie side-view staging: AI frozen, fresh zombie at eye level, side camera
(() => {
  const en = window.__voxelEngine
  en.mobs.enabled = false // freeze AI (no burning, no movement)
  // remove any dead/leftover zombies
  for (let i = en.mobs.mobs.length - 1; i >= 0; i--) {
    if (en.mobs.mobs[i].type === 'zombie') {
      const m = en.mobs.mobs[i]
      en.mobs.scene_remove?.(m)
      en.mobs.mobs.splice(i, 1)
    }
  }
  const fx = -Math.sin(en.yaw)
  const fz = -Math.cos(en.yaw)
  const z = en.mobs.spawnAt('zombie', en.pos.x + fx * 2.4, en.pos.y + 0.15, en.pos.z + fz * 2.4)
  z.yaw = Math.atan2(fx, fz) + Math.PI // face the camera
  z.group.position.copy(z.pos)
  z.group.rotation.y = z.yaw
  en.pitch = 0
  return 'staged fresh zombie 2.4m ahead, AI frozen, mobs=' + en.mobs.mobs.length
})()
