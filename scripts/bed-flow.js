// Full bed flow: place bed ahead, screenshot it, sleep via NDC, verify bedSpawn + respawn
(() => {
  const en = window.__voxelEngine
  const fx = -Math.sin(en.yaw)
  const fz = -Math.cos(en.yaw)
  const bx = Math.floor(en.pos.x + fx * 2.2)
  const bz = Math.floor(en.pos.z + fz * 2.2)
  const gy = en.world.terrainHeight(bx, bz)
  en.world.setBlock(bx, gy + 1, bz, 24)
  en['markRemesh'](bx, gy + 1, bz)
  // look slightly down at the bed for the visual check
  const Vector3 = en.camera.position.constructor
  const vec = new Vector3(bx + 0.5, gy + 1.5, bz + 0.5)
  en.camera.updateMatrixWorld()
  const w = vec.clone()
  const dx = w.x - (en.pos.x)
  const dy = (gy + 1.2) - (en.pos.y + 1.62)
  const dz2 = w.z - (en.pos.z)
  en.yaw = Math.atan2(-dx, -dz2)
  en.pitch = Math.atan2(dy, Math.hypot(dx, dz2))
  // apply yaw/pitch to the camera NOW (engine normally does it each frame)
  en.camera.rotation.set(0, 0, 0)
  en.camera.rotateY(en.yaw)
  en.camera.rotateX(en.pitch)
  en.camera.updateMatrixWorld()
  vec.project(en.camera)
  window.__bedNdc = [vec.x, vec.y]
  window.__bedPos = [bx, gy + 1, bz]
  en.world.time = 0.78
  return JSON.stringify({ bed: window.__bedPos, ndc: [+vec.x.toFixed(2), +vec.y.toFixed(2)], ground: gy })
})()
