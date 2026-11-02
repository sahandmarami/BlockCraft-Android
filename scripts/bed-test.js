// Bed + sleep test v2: place bed ahead, set night, tap it via NDC ray, verify morning
(() => {
  const en = window.__voxelEngine
  const fx = -Math.sin(en.yaw)
  const fz = -Math.cos(en.yaw)
  const bx = Math.floor(en.pos.x + fx * 2.2)
  const bz = Math.floor(en.pos.z + fz * 2.2)
  const gy = en.world.terrainHeight(bx, bz)
  en.world.setBlock(bx, gy + 1, bz, 24) // BED
  en['markRemesh'](bx, gy + 1, bz)
  en.world.time = 0.75 // midnight
  const Vector3 = en.camera.position.constructor
  const vec = new Vector3(bx + 0.5, gy + 1.5, bz + 0.5)
  en.camera.updateMatrixWorld()
  vec.project(en.camera)
  const ndcX = vec.x
  const ndcY = vec.y
  en.hp = 13
  en['placeAtNDC'](ndcX, ndcY)
  return JSON.stringify({
    bed: [bx, gy + 1, bz],
    bedBlockNow: en.world.getBlock(bx, gy + 1, bz),
    ndc: [+ndcX.toFixed(2), +ndcY.toFixed(2)],
    sleepAnim: en.sleepAnim,
    bedSpawn: en.bedSpawn,
  })
})()
