// generate launcher mipmaps from public/icon-512.png
import sharp from 'sharp'
import { mkdirSync } from 'fs'
const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
for (const [dpi, px] of Object.entries(sizes)) {
  const dir = `/home/z/my-project/android/app/src/main/res/mipmap-${dpi}`
  mkdirSync(dir, { recursive: true })
  await sharp('/home/z/my-project/public/icon-512.png').resize(px, px).png().toFile(`${dir}/ic_launcher.png`)
  console.log('ic_launcher', dpi, px)
}
