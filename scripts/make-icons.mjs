// Generates Android PWA icons from an original pixel-art grass-block design
import sharp from 'sharp'
import { join } from 'path'

// 16x16 pixel-art block: grass top rows + dirt body (original design)
const GREEN = ['#59a83f', '#4f9c37', '#63b247', '#479231']
const DIRT = ['#7a5638', '#6e4c30', '#86603f', '#634426']
const DARK = '#523d22'

// deterministic pseudo-random
let seed = 42
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]

const px = []
for (let y = 0; y < 16; y++) {
  for (let x = 0; x < 16; x++) {
    let c
    if (y < 5) {
      c = pick(GREEN)
    } else if (y === 5) {
      c = rnd() > 0.5 ? pick(GREEN) : DARK
    } else {
      c = pick(DIRT)
    }
    px.push(`<rect x="${x}" y="${y}" width="1.05" height="1.05" fill="${c}"/>`)
  }
}

// dark border
const border = []
for (let i = 0; i < 16; i++) {
  border.push(`<rect x="${i}" y="0" width="1" height="1" fill="rgba(0,0,0,0.25)"/>`)
  border.push(`<rect x="${i}" y="15" width="1" height="1" fill="rgba(0,0,0,0.25)"/>`)
  border.push(`<rect x="0" y="${i}" width="1" height="1" fill="rgba(0,0,0,0.25)"/>`)
  border.push(`<rect x="15" y="${i}" width="1" height="1" fill="rgba(0,0,0,0.25)"/>`)
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 16 16" shape-rendering="crispEdges">
${px.join('\n')}
${border.join('\n')}
</svg>`

const out = '/home/z/my-project/public'
await sharp(Buffer.from(svg)).resize(512, 512, { kernel: 'nearest' }).png().toFile(join(out, 'icon-512.png'))
await sharp(Buffer.from(svg)).resize(192, 192, { kernel: 'nearest' }).png().toFile(join(out, 'icon-192.png'))
console.log('icons generated')
