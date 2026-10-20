import {
  AdvanceExpensePolicy,
  MAX_RECEIPT_BYTES,
} from './advance-expense.policy'
import {
  ExpenseAlreadySettledException,
  ExpenseReceiptRequiredException,
  InvalidExpenseAmountException,
  InvalidExpenseDateException,
  InvalidExpenseReceiptException,
} from './service.exceptions'

const PDF = Buffer.from('%PDF-1.4 prueba')
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x10, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
])

describe('AdvanceExpensePolicy', () => {
  describe('monto', () => {
    it('acepta un monto positivo y lo deja con dos decimales', () => {
      expect(AdvanceExpensePolicy.normalizeAmount('15000')).toBe('15000.00')
      expect(AdvanceExpensePolicy.normalizeAmount(' 15000.5 ')).toBe('15000.50')
    })

    it('rechaza cero, negativos y lo que no es un número', () => {
      expect(() => AdvanceExpensePolicy.normalizeAmount('0')).toThrow(
        InvalidExpenseAmountException,
      )
      expect(() => AdvanceExpensePolicy.normalizeAmount('-10')).toThrow(
        InvalidExpenseAmountException,
      )
      expect(() => AdvanceExpensePolicy.normalizeAmount('abc')).toThrow(
        InvalidExpenseAmountException,
      )
    })
  })

  it('la fecha tiene que existir en el calendario', () => {
    expect(AdvanceExpensePolicy.normalizeDate(' 2026-10-05 ')).toBe(
      '2026-10-05',
    )
    expect(() => AdvanceExpensePolicy.normalizeDate('2026-02-30')).toThrow(
      InvalidExpenseDateException,
    )
  })

  it('la descripción se recorta y compacta', () => {
    expect(
      AdvanceExpensePolicy.normalizeDescription('  Arreglo   de   canilla '),
    ).toBe('Arreglo de canilla')
  })

  describe('comprobante (spec 6)', () => {
    it('sin archivo es obligatorio', () => {
      expect(() => AdvanceExpensePolicy.receiptKind(undefined)).toThrow(
        ExpenseReceiptRequiredException,
      )
      expect(() => AdvanceExpensePolicy.receiptKind(Buffer.alloc(0))).toThrow(
        ExpenseReceiptRequiredException,
      )
    })

    it.each([
      ['PDF', PDF, 'pdf', 'application/pdf'],
      ['JPG', JPG, 'jpg', 'image/jpeg'],
      ['PNG', PNG, 'png', 'image/png'],
      ['WebP', WEBP, 'webp', 'image/webp'],
    ])('reconoce un %s por sus primeros bytes', (_, file, ext, type) => {
      expect(AdvanceExpensePolicy.receiptKind(file)).toEqual({
        extension: ext,
        contentType: type,
      })
    })

    it('rechaza otro formato o un archivo de más de 10 MB', () => {
      expect(() =>
        AdvanceExpensePolicy.receiptKind(Buffer.from('#!/bin/sh')),
      ).toThrow(InvalidExpenseReceiptException)
      expect(() =>
        AdvanceExpensePolicy.receiptKind(Buffer.alloc(MAX_RECEIPT_BYTES + 1)),
      ).toThrow(InvalidExpenseReceiptException)
    })
  })

  it('descontado en una liquidación, el gasto es inmutable (spec 4)', () => {
    expect(() =>
      AdvanceExpensePolicy.assertMutable({ settlementId: null }),
    ).not.toThrow()
    expect(() =>
      AdvanceExpensePolicy.assertMutable({
        settlementId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toThrow(ExpenseAlreadySettledException)
  })
})
