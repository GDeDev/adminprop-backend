import { OAuthStateInvalidException } from '../domain/crm.exceptions'
import { ListingChannel } from '../domain/listing'
import { OAUTH_STATE_TTL_MS, OAuthStateSigner } from './oauth-state'

const PAYLOAD = {
  tenantId: 't1',
  userId: 'u1',
  channel: ListingChannel.MERCADOLIBRE,
}
const NOW = new Date('2026-11-05T12:00:00Z')

describe('OAuthStateSigner', () => {
  const signer = new OAuthStateSigner('secreto-de-prueba')

  it('firma y verifica tenant, usuario y canal', () => {
    expect(signer.verify(signer.sign(PAYLOAD, NOW), NOW)).toMatchObject(PAYLOAD)
  })

  it('rechaza un state vencido', () => {
    const state = signer.sign(PAYLOAD, NOW)
    const later = new Date(NOW.getTime() + OAUTH_STATE_TTL_MS + 1)
    expect(() => signer.verify(state, later)).toThrow(
      OAuthStateInvalidException,
    )
  })

  it('rechaza un payload manipulado (otro tenant) con la firma vieja', () => {
    const [body, signature] = signer.sign(PAYLOAD, NOW).split('.')
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body, 'base64url').toString()),
        tenantId: 'otro',
      }),
    ).toString('base64url')
    expect(() => signer.verify(`${forged}.${signature}`, NOW)).toThrow(
      OAuthStateInvalidException,
    )
  })

  it('rechaza la firma de otra clave y los formatos rotos', () => {
    const other = new OAuthStateSigner('otra-clave').sign(PAYLOAD, NOW)
    expect(() => signer.verify(other, NOW)).toThrow(OAuthStateInvalidException)
    for (const garbage of ['', 'abc', 'a.b.c', '.']) {
      expect(() => signer.verify(garbage, NOW)).toThrow(
        OAuthStateInvalidException,
      )
    }
  })

  // Cada state lleva su nonce: así el callback puede usarlo una sola vez (D-255).
  it('cada state lleva un nonce distinto', () => {
    const a = signer.verify(signer.sign(PAYLOAD, NOW), NOW)
    const b = signer.verify(signer.sign(PAYLOAD, NOW), NOW)
    expect(a.nonce).toEqual(expect.any(String))
    expect(a.nonce).not.toBe(b.nonce)
  })
})
