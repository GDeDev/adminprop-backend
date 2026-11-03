import { readImageInfo } from './image-info'

const png = (w: number, h: number) => {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'latin1')
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  return b
}

const jpeg = (w: number, h: number) =>
  Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00, // APP0 de 4 bytes
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    h >> 8,
    h & 255,
    w >> 8,
    w & 255,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ])

const webpX = (w: number, h: number) => {
  const b = Buffer.alloc(30)
  b.write('RIFF', 0, 'latin1')
  b.write('WEBP', 8, 'latin1')
  b.write('VP8X', 12, 'latin1')
  b.writeUIntLE(w - 1, 24, 3)
  b.writeUIntLE(h - 1, 27, 3)
  return b
}

describe('readImageInfo', () => {
  it('reconoce PNG, JPEG y WebP y lee sus dimensiones', () => {
    expect(readImageInfo(png(800, 600))).toMatchObject({
      extension: 'png',
      width: 800,
      height: 600,
    })
    expect(readImageInfo(jpeg(1920, 1080))).toMatchObject({
      extension: 'jpg',
      width: 1920,
      height: 1080,
    })
    expect(readImageInfo(webpX(1200, 630))).toMatchObject({
      extension: 'webp',
      width: 1200,
      height: 630,
    })
  })

  it('rechaza SVG, PDF, HTML y basura aunque lleven extensión de imagen', () => {
    expect(
      readImageInfo(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      ),
    ).toBeNull()
    expect(readImageInfo(Buffer.from('%PDF-1.4 ...'))).toBeNull()
    expect(
      readImageInfo(Buffer.from('<html><script>1</script></html>')),
    ).toBeNull()
    expect(readImageInfo(Buffer.from('GIF89a'))).toBeNull()
    expect(readImageInfo(Buffer.alloc(0))).toBeNull()
  })
})
