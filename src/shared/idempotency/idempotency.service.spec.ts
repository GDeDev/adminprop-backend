import { InvalidIdempotencyKeyException } from './idempotency.exceptions'
import { IdempotencyService } from './idempotency.service'

describe('IdempotencyService', () => {
  describe('normalizeKey', () => {
    it('sin header o vacío no hay idempotencia', () => {
      expect(IdempotencyService.normalizeKey(undefined)).toBeNull()
      expect(IdempotencyService.normalizeKey('')).toBeNull()
      expect(IdempotencyService.normalizeKey('   ')).toBeNull()
    })

    it('acepta UUID y claves con guiones, y recorta los bordes', () => {
      expect(IdempotencyService.normalizeKey(' pago-2026_10.a ')).toBe(
        'pago-2026_10.a',
      )
      const uuid = '5d1b0000-0000-4000-8000-000000000001'
      expect(IdempotencyService.normalizeKey(uuid)).toBe(uuid)
    })

    it('si el header llega repetido toma el primero', () => {
      expect(IdempotencyService.normalizeKey(['a', 'b'])).toBe('a')
    })

    it('rechaza espacios adentro, caracteres no imprimibles y más de 128', () => {
      for (const bad of ['con espacio', 'tab\tx', 'ñandú', 'x'.repeat(129)]) {
        expect(() => IdempotencyService.normalizeKey(bad)).toThrow(
          InvalidIdempotencyKeyException,
        )
      }
    })
  })

  describe('hashRequest', () => {
    it('es estable y distingue el contenido', () => {
      const a = IdempotencyService.hashRequest('inst', '{"amount":"1"}')
      expect(a).toMatch(/^[0-9a-f]{64}$/)
      expect(IdempotencyService.hashRequest('inst', '{"amount":"1"}')).toBe(a)
      expect(IdempotencyService.hashRequest('inst', '{"amount":"2"}')).not.toBe(
        a,
      )
    })

    it('no confunde cómo se parte el contenido entre partes', () => {
      expect(IdempotencyService.hashRequest('ab', 'c')).not.toBe(
        IdempotencyService.hashRequest('a', 'bc'),
      )
    })

    it('el comprobante cuenta: otro archivo es otro pedido', () => {
      expect(
        IdempotencyService.hashRequest('i', 'd', Buffer.from('uno')),
      ).not.toBe(IdempotencyService.hashRequest('i', 'd', Buffer.from('dos')))
    })
  })
})
