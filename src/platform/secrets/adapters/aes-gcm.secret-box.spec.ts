import { randomBytes } from 'node:crypto'

import { AesGcmSecretBox } from './aes-gcm.secret-box'

const KEY = randomBytes(32).toString('base64')

describe('AesGcmSecretBox', () => {
  it('cifra y descifra', () => {
    const box = new AesGcmSecretBox(KEY)
    const sealed = box.seal('APP_USR-token')
    expect(sealed).not.toContain('APP_USR')
    expect(box.open(sealed)).toBe('APP_USR-token')
  })

  it('el mismo texto cifra distinto cada vez (IV aleatorio)', () => {
    const box = new AesGcmSecretBox(KEY)
    expect(box.seal('x')).not.toBe(box.seal('x'))
  })

  it('rechaza un texto manipulado o abierto con otra clave', () => {
    const box = new AesGcmSecretBox(KEY)
    const sealed = box.seal('secreto')
    const [v, iv, tag, body] = sealed.split('.')
    const tampered = [
      v,
      iv,
      tag,
      Buffer.from('zzzz').toString('base64url') + body,
    ]
    expect(() => box.open(tampered.join('.'))).toThrow()
    const other = new AesGcmSecretBox(randomBytes(32).toString('hex'))
    expect(() => other.open(sealed)).toThrow()
  })

  it('falla con una clave de largo incorrecto o sin clave', () => {
    expect(() => new AesGcmSecretBox('corta')).toThrow(/32 bytes/)
    expect(() => new AesGcmSecretBox(null).seal('x')).toThrow(
      /APP_ENCRYPTION_KEY/,
    )
  })
})
