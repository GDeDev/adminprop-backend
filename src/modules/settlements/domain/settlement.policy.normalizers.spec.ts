import { SettlementAdjustmentConcept } from './settlement'
import {
  InvalidSettlementAmountException,
  InvalidSettlementDateException,
  InvalidSettlementReceiptException,
  InvalidSettlementTextException,
} from './settlement.exceptions'
import { MAX_RECEIPT_BYTES, SettlementPolicy } from './settlement.policy'

describe('SettlementPolicy: entrada de datos', () => {
  describe('normalizeAmount', () => {
    it('redondea a 2 decimales con ROUND_HALF_UP', () => {
      expect(SettlementPolicy.normalizeAmount('0.005')).toBe('0.01')
      expect(SettlementPolicy.normalizeAmount('1234.564')).toBe('1234.56')
    })

    it('rechaza montos negativos, en cero o que no son un número, nombrando el campo', () => {
      for (const value of ['-1', '0.00', '0.004', 'abc', '']) {
        expect(() => SettlementPolicy.normalizeAmount(value, 'monto')).toThrow(
          InvalidSettlementAmountException,
        )
      }
      expect.assertions(6)
      try {
        SettlementPolicy.normalizeAmount('-5', 'monto')
      } catch (error) {
        expect((error as InvalidSettlementAmountException).metadata).toEqual({
          field: 'monto',
        })
      }
    })
  })

  describe('normalizeDate', () => {
    it('acepta hoy y fechas pasadas, sin espacios', () => {
      expect(SettlementPolicy.normalizeDate(' 2026-10-29 ', '2026-10-29')).toBe(
        '2026-10-29',
      )
      expect(SettlementPolicy.normalizeDate('2026-01-01', '2026-10-29')).toBe(
        '2026-01-01',
      )
    })

    it('rechaza texto que no es una fecha', () => {
      for (const value of ['', 'ayer', '2026-02-30', '29/10/2026']) {
        expect(() =>
          SettlementPolicy.normalizeDate(value, '2026-10-29'),
        ).toThrow(InvalidSettlementDateException)
      }
    })

    it('rechaza una fecha futura y avisa el campo', () => {
      expect.assertions(2)
      try {
        SettlementPolicy.normalizeDate('2026-10-30', '2026-10-29', 'paidAt')
      } catch (error) {
        const exception = error as InvalidSettlementDateException
        expect(exception.message).toContain('no puede ser futura')
        expect(exception.metadata).toEqual({ field: 'paidAt' })
      }
    })
  })

  describe('textos', () => {
    it('la descripción colapsa espacios y se corta en 300 caracteres', () => {
      expect(
        SettlementPolicy.normalizeDescription('  Pago   de\n sellado '),
      ).toBe('Pago de sellado')
      expect(
        SettlementPolicy.normalizeDescription('a'.repeat(400)),
      ).toHaveLength(300)
    })

    it('la descripción vacía o de puros espacios se rechaza', () => {
      expect(() => SettlementPolicy.normalizeDescription('   ')).toThrow(
        InvalidSettlementTextException,
      )
    })

    it('el motivo colapsa espacios y se corta en 500 caracteres', () => {
      expect(SettlementPolicy.normalizeReason(' Error   de carga ')).toBe(
        'Error de carga',
      )
      expect(SettlementPolicy.normalizeReason('b'.repeat(600))).toHaveLength(
        500,
      )
    })

    it('el motivo vacío se rechaza', () => {
      expect(() => SettlementPolicy.normalizeReason('')).toThrow(
        InvalidSettlementTextException,
      )
    })

    it('las notas vacías, nulas o indefinidas quedan en null; el resto se normaliza', () => {
      expect(SettlementPolicy.normalizeNotes(undefined)).toBeNull()
      expect(SettlementPolicy.normalizeNotes(null)).toBeNull()
      expect(SettlementPolicy.normalizeNotes('  \n ')).toBeNull()
      expect(SettlementPolicy.normalizeNotes(' una   nota ')).toBe('una nota')
    })
  })

  describe('receiptKind', () => {
    it('sin archivo no hay comprobante', () => {
      expect(SettlementPolicy.receiptKind(null)).toBeNull()
      expect(SettlementPolicy.receiptKind(undefined)).toBeNull()
    })

    it('rechaza un archivo de más de 10 MB', () => {
      expect(() =>
        SettlementPolicy.receiptKind(Buffer.alloc(MAX_RECEIPT_BYTES + 1)),
      ).toThrow(InvalidSettlementReceiptException)
    })
  })

  describe('signedAmount', () => {
    it('los rubros que restan salen negativos y el crédito positivo, redondeados', () => {
      const { WITHHOLDING, OWNER_ADVANCE, OTHER_DEDUCTION, OTHER_CREDIT } =
        SettlementAdjustmentConcept
      expect(SettlementPolicy.signedAmount(WITHHOLDING, '10.005')).toBe(
        '-10.01',
      )
      expect(SettlementPolicy.signedAmount(OWNER_ADVANCE, '5')).toBe('-5.00')
      expect(SettlementPolicy.signedAmount(OTHER_DEDUCTION, '1.10')).toBe(
        '-1.10',
      )
      expect(SettlementPolicy.signedAmount(OTHER_CREDIT, '1.10')).toBe('1.10')
    })
  })

  describe('descripción de un pago anulado', () => {
    it('se corta en 300 caracteres y colapsa los saltos de línea del motivo', () => {
      const text = SettlementPolicy.voidedPaymentDescription({
        paidAt: '2026-10-05',
        period: '2026-09',
        reason: `uno\n\ndos ${'x'.repeat(400)}`,
      })
      expect(text).toHaveLength(300)
      expect(text).toContain('ya liquidado: uno dos ')
    })
  })
})
