import { deflateSync } from 'node:zlib'

/**
 * Foto placeholder de las propiedades de demo: un PNG liso generado acá, sin
 * archivos binarios en el repo ni descargas. El color cambia con `index` para
 * que en la galería se distingan unas de otras.
 */
const SIZE = 96

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, checksum])
}

export function placeholderPng(index: number): Buffer {
  // Colores apagados, claramente "de relleno".
  const hue = (index * 47) % 360
  const [r, g, b] = hslToRgb(hue, 0.35, 0.72)

  const header = Buffer.alloc(13)
  header.writeUInt32BE(SIZE, 0)
  header.writeUInt32BE(SIZE, 4)
  header[8] = 8 // profundidad de bits
  header[9] = 2 // truecolor RGB
  // compresión, filtro y entrelazado en 0

  const row = Buffer.alloc(1 + SIZE * 3)
  for (let x = 0; x < SIZE; x += 1) {
    row[1 + x * 3] = r
    row[2 + x * 3] = g
    row[3 + x * 3] = b
  }
  const raw = Buffer.concat(Array.from({ length: SIZE }, () => row))

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function hslToRgb(
  hue: number,
  saturation: number,
  lightness: number,
): [number, number, number] {
  const k = (n: number) => (n + hue / 30) % 12
  const a = saturation * Math.min(lightness, 1 - lightness)
  const f = (n: number) =>
    lightness - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [
    Math.round(f(0) * 255),
    Math.round(f(8) * 255),
    Math.round(f(4) * 255),
  ]
}
