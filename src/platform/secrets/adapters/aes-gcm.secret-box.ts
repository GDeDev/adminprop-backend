import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { SecretBoxPort } from '../secret-box.port'

const VERSION = 'v1'
const IV_BYTES = 12

/** Convierte la clave de entorno (64 hex o base64 de 32 bytes) en un Buffer de 32 bytes. */
export function parseEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim()
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64')
  if (key.length !== 32) {
    throw new Error(
      'APP_ENCRYPTION_KEY tiene que ser de 32 bytes (hex o base64)',
    )
  }
  return key
}

/**
 * AES-256-GCM con IV aleatorio por mensaje. Formato: `v1.<iv>.<tag>.<cifrado>`
 * en base64url. Rotar la clave invalida lo guardado (A-84).
 */
export class AesGcmSecretBox extends SecretBoxPort {
  private readonly key: Buffer | null

  constructor(rawKey: string | null) {
    super()
    this.key = rawKey ? parseEncryptionKey(rawKey) : null
  }

  seal(plain: string): string {
    const key = this.requireKey()
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    return [VERSION, iv, cipher.getAuthTag(), body]
      .map((part) =>
        typeof part === 'string' ? part : part.toString('base64url'),
      )
      .join('.')
  }

  open(sealed: string): string {
    const key = this.requireKey()
    const [version, iv, tag, body] = sealed.split('.')
    if (version !== VERSION || !iv || !tag || body === undefined) {
      throw new Error('Secreto cifrado con un formato desconocido')
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new Error('Falta configurar APP_ENCRYPTION_KEY en el servidor')
    }
    return this.key
  }
}
