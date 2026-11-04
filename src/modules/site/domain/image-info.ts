import { detectFileKind } from '@/shared/files/file-signature'

export interface ImageInfo {
  extension: 'jpg' | 'png' | 'webp'
  contentType: string
  width: number | null
  height: number | null
}

/** Tope por lado: más que eso no es una foto web, es un error (o un abuso). */
export const MAX_IMAGE_SIDE = 12_000

/**
 * Reconoce JPG, PNG o WebP por sus primeros bytes (no por la extensión ni el
 * mimetype del cliente) y lee sus dimensiones sin decodificar la imagen. SVG y
 * PDF no entran: un SVG puede llevar scripts y el sitio no los necesita.
 */
export function readImageInfo(file: Buffer): ImageInfo | null {
  const kind = detectFileKind(file)
  if (!kind || kind.extension === 'pdf') return null
  const size =
    kind.extension === 'png'
      ? pngSize(file)
      : kind.extension === 'jpg'
        ? jpegSize(file)
        : webpSize(file)
  return {
    extension: kind.extension,
    contentType: kind.contentType,
    width: size?.[0] ?? null,
    height: size?.[1] ?? null,
  }
}

type Size = [number, number] | null

function pngSize(b: Buffer): Size {
  return b.length >= 24 ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null
}

function jpegSize(b: Buffer): Size {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1
      continue
    }
    const marker = b[i + 1]
    if (marker === 0xff) {
      i += 1
      continue
    }
    // Marcadores sin largo: relleno, SOI, EOI, RSTn.
    if (
      marker === 0x00 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd9)
    ) {
      i += 2
      continue
    }
    const length = b.readUInt16BE(i + 2)
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isFrame) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]
    i += 2 + length
  }
  return null
}

function webpSize(b: Buffer): Size {
  if (b.length < 30) return null
  const chunk = b.subarray(12, 16).toString('latin1')
  if (chunk === 'VP8 ') {
    return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]
  }
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21)
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1]
  }
  if (chunk === 'VP8X') {
    return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1]
  }
  return null
}
