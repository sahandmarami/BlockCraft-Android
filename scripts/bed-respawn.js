// Bed respawn verification: respawn, place bed right in front on same ground level, tap it
(() => {
  const en = window.__voxelEngine
  if (en.dead) {
    en.respawn()
    window.__reactDead && null
  }
  // dispatch respawn click if the death screen is open (React state)
  const respawnBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('تولد دوباره'))
  if (respawnBtn) respawnBtn.click()
  const px = Math.floor(en.pos.x)
  const pz = Math.floor(en.pos.z)
  const gy = en.world.highestBlock(px, pz) // ground under the player
  const fx = -Math.sin(en.yaw)
  const fz = -Math.cos(en.yaw)
  const bx = px + (Math.abs(fx) > Math.abs(fz) ? Math.sign(fx) : 0)
  const bz = pz + (Math.abs(fx) > Math.abs(fz) ? 0 : Math.sign(fz))
  en.world.setBlock(bx, gy + 1, bz, 24)
  en['markRemesh'](bx, gy + 1, bz)
  // aim at the bed and project
  const Vector3 = en.camera.position.constructor
  const vec = new Vector3(bx + 0.5, gy + 1.5, bz + 0.5)
  const dx = bx + 0.5 - en.pos.x
  const dy = gy + 1.4 - (en.pos.y + 1.62)
  const dz2 = bz + 0.5 - en.pos.z
  en.yaw = Math.atan2(-dx, -dz2)
  en.pitch = Math.max(-1.2, Math.min(1.2, Math.atan2(dy, Math.hypot(dx, dz2))))
  en.camera.rotation.set(0, 0, 0)
  en.camera.rotateY(en.yaw)
  en.camera.rotateX(en.pitch)
  en.camera.updateMatrixWorld()
  vec.project(en.camera)
  en.world.time = 0.8
  const r = en['rayFromNDC'](vec.x, vec.y)
  const hit = en['raycastVoxel'](r.origin, r.dir, 6)
  en.hp = 9
  en['placeAtNDC'](vec.x, vec.y)
  return JSON.stringify({
    player: [px, +en.pos.y.toFixed(1), pz],
    bed: [bx, gy + 1, bz],
    rayHit: hit ? { id: hit.id, x: hit.x, y: hit.y, z: hit.z } : null,
    ndc: [+vec.x.toFixed(2), +vec.y.toFixed(2)],
    sleepAnim: en.sleepAnim,
    bedSpawn: en.bedSpawn,
  })
})()
