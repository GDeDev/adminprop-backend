import {
  signSvix,
  SVIX_TOLERANCE_SECONDS,
  verifySvixSignature,
} from './svix-signature'

describe('verifySvixSignature', () => {
  const secret = `whsec_${Buffer.from('secreto-de-prueba').toString('base64')}`
  const now = new Date('2026-11-03T12:00:00Z')
  const timestamp = String(Math.floor(now.getTime() / 1000))
  const body = JSON.stringify({ type: 'email.delivered' })

  const headers = (signature: string, ts = timestamp) => ({
    id: 'msg_1',
    timestamp: ts,
    signature,
  })

  it('acepta una firma válida', () => {
    const signature = signSvix(secret, 'msg_1', timestamp, body)
    expect(verifySvixSignature(secret, headers(signature), body, now)).toBe(
      true,
    )
  })

  it('acepta si alguna de las firmas del header coincide (rotación de secreto)', () => {
    const signature = signSvix(secret, 'msg_1', timestamp, body)
    expect(
      verifySvixSignature(secret, headers(`v1,AAAA ${signature}`), body, now),
    ).toBe(true)
  })

  it('rechaza una firma de otro secreto', () => {
    const other = signSvix(
      `whsec_${Buffer.from('otro').toString('base64')}`,
      'msg_1',
      timestamp,
      body,
    )
    expect(verifySvixSignature(secret, headers(other), body, now)).toBe(false)
  })

  it('rechaza un cuerpo alterado', () => {
    const signature = signSvix(secret, 'msg_1', timestamp, body)
    expect(
      verifySvixSignature(secret, headers(signature), body + ' ', now),
    ).toBe(false)
  })

  it('rechaza un timestamp fuera de la tolerancia de 5 minutos', () => {
    const old = String(Number(timestamp) - SVIX_TOLERANCE_SECONDS - 1)
    const signature = signSvix(secret, 'msg_1', old, body)
    expect(
      verifySvixSignature(secret, headers(signature, old), body, now),
    ).toBe(false)
  })

  it('rechaza si faltan headers', () => {
    expect(
      verifySvixSignature(
        secret,
        { id: undefined, timestamp, signature: 'v1,x' },
        body,
        now,
      ),
    ).toBe(false)
  })
})
