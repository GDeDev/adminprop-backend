import { inflateRawSync } from 'node:zlib'

import { InvalidXlsxException } from './migration.exceptions'
import { MAX_UNCOMPRESSED_BYTES, MAX_ZIP_ENTRIES } from './template-definition'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const STORED = 0
const DEFLATED = 8

const tooBig = () =>
  new InvalidXlsxException(
    'El archivo es demasiado grande una vez descomprimido: tiene que ser un Excel (.xlsx) armado con la plantilla',
  )
const corrupt = () =>
  new InvalidXlsxException(
    'No se pudo leer el archivo: tiene que ser un Excel (.xlsx) sin contraseña',
  )

/**
 * Corta una zip bomb antes de que `exceljs` infle el archivo entero en memoria.
 *
 * El tope de 10 MB del upload es del archivo comprimido, y un `.xlsx` de ese
 * tamaño puede inflarse a gigas. No alcanza con sumar los tamaños declarados
 * en el directorio central: quien arma el zip los puede falsear, y JSZip recién
 * compara el tamaño real al terminar de inflar. Por eso cada entrada se infla
 * acá con un tope (`maxOutputLength`) y se descarta; lo que cuenta es lo que
 * realmente sale, no lo que el archivo dice.
 */
export function assertSafeZip(buffer: Buffer): void {
  const eocd = findEndOfCentralDirectory(buffer)
  if (eocd < 0) throw corrupt()

  const entries = buffer.readUInt16LE(eocd + 10)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  // zip64: no lo genera Excel ni la plantilla, y habilita tamaños gigantes.
  if (entries === 0xffff || centralOffset === 0xffffffff) throw corrupt()
  if (entries > MAX_ZIP_ENTRIES) throw tooBig()

  let remaining = MAX_UNCOMPRESSED_BYTES
  let cursor = centralOffset
  for (let i = 0; i < entries; i += 1) {
    if (
      cursor + 46 > buffer.length ||
      buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE
    ) {
      throw corrupt()
    }
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    cursor += 46 + nameLength + extraLength + commentLength

    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw corrupt()
    }
    if (
      localOffset + 30 > buffer.length ||
      buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE
    ) {
      throw corrupt()
    }
    const dataStart =
      localOffset +
      30 +
      buffer.readUInt16LE(localOffset + 26) +
      buffer.readUInt16LE(localOffset + 28)
    const data = buffer.subarray(dataStart, dataStart + compressedSize)
    if (data.length !== compressedSize) throw corrupt()

    if (method === STORED) {
      remaining -= data.length
    } else if (method === DEFLATED) {
      try {
        // `+ 1`: pasarse por un byte ya lanza, y 0 no es un tope válido.
        remaining -= inflateRawSync(data, {
          maxOutputLength: Math.max(remaining, 0) + 1,
        }).length
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
          throw tooBig()
        }
        throw corrupt()
      }
    } else {
      throw corrupt()
    }
    if (remaining < 0) throw tooBig()
  }
}

/** El EOCD está en los últimos 22 bytes más un comentario de hasta 64 KB. */
function findEndOfCentralDirectory(buffer: Buffer): number {
  const lowest = Math.max(0, buffer.length - 22 - 0xffff)
  for (let at = buffer.length - 22; at >= lowest; at -= 1) {
    if (buffer.readUInt32LE(at) === EOCD_SIGNATURE) return at
  }
  return -1
}
