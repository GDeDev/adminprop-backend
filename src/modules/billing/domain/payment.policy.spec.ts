import {
  CollectionMode,
  CreditStatus,
  Currency,
  ExchangeRateSource,
  PaymentReceiver,
  PaymentStatus,
  RenterCredit,
} from './billing'
import {
  CreditCurrencyMismatchException,
  CreditNotAvailableException,
  ExchangeRateNotAllowedException,
  ExchangeRateRequiredException,
  InvalidAllocationException,
  InvalidPaymentAmountException,
  InvalidPaymentDateException,
  InvalidPaymentReceiptException,
} from './billing.exceptions'
import { PaymentPolicy } from './payment.policy'

const NO_RATE = { rate: null, source: null, date: null }
const BALANCES = {
  lateFeeBalance: '20000.00',
  rentBalance: '200000.00',
  chargesBalance: '30000.00',
}

function credit(overrides: Partial<RenterCredit> = {}): RenterCredit {
  return {
    id: 'credit-1',
    renterId: 'renter-1',
    contractId: 'contract-1',
    currency: Currency.ARS,
    amount: '50000.00',
    remaining: '50000.00',
    originPaymentId: 'pay-0',
    status: CreditStatus.AVAILABLE,
    refundedAt: null,
    refundMethod: null,
    refundedById: null,
    refundNotes: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  }
}

describe('PaymentPolicy', () => {
  it('el monto es mayor que cero (regla 10)', () => {
    expect(PaymentPolicy.normalizeAmount('1500.5')).toBe('1500.50')
    expect(() => PaymentPolicy.normalizeAmount('0')).toThrow(
      InvalidPaymentAmountException,
    )
    expect(() => PaymentPolicy.normalizeAmount('abc')).toThrow(
      InvalidPaymentAmountException,
    )
  })

  it('la fecha del pago no es futura; un pago anticipado vale (regla 10, A-14)', () => {
    expect(PaymentPolicy.normalizePaidAt('2026-10-15', '2026-10-20')).toBe(
      '2026-10-15',
    )
    // Cobrar en octubre la cuota de noviembre.
    expect(PaymentPolicy.normalizePaidAt('2026-10-28', '2026-10-29')).toBe(
      '2026-10-28',
    )
    expect(() =>
      PaymentPolicy.normalizePaidAt('2026-10-21', '2026-10-20'),
    ).toThrow(InvalidPaymentDateException)
    expect(() =>
      PaymentPolicy.normalizePaidAt('2026-02-30', '2026-10-20'),
    ).toThrow(InvalidPaymentDateException)
  })

  describe('cotización (A-9)', () => {
    it('misma moneda: sin cotización, el equivalente es el monto', () => {
      expect(
        PaymentPolicy.convert('1000.00', Currency.ARS, Currency.ARS, NO_RATE),
      ).toEqual({ exchangeRate: null, amountInContractCurrency: '1000.00' })
      expect(() =>
        PaymentPolicy.convert('1000.00', Currency.ARS, Currency.ARS, {
          rate: '1500',
          source: ExchangeRateSource.MEP,
          date: '2026-10-15',
        }),
      ).toThrow(ExchangeRateNotAllowedException)
    })

    it('otra moneda: cotización completa obligatoria; ARS a USD divide, USD a ARS multiplica', () => {
      expect(() =>
        PaymentPolicy.convert('1500000', Currency.ARS, Currency.USD, NO_RATE),
      ).toThrow(ExchangeRateRequiredException)
      expect(() =>
        PaymentPolicy.convert('1500000', Currency.ARS, Currency.USD, {
          rate: '1500',
          source: null,
          date: '2026-10-15',
        }),
      ).toThrow(ExchangeRateRequiredException)
      expect(() =>
        PaymentPolicy.convert('1500000', Currency.ARS, Currency.USD, {
          rate: '0',
          source: ExchangeRateSource.MEP,
          date: '2026-10-15',
        }),
      ).toThrow(ExchangeRateRequiredException)

      // 1.500.000 ARS a 1.487,5 por dólar → 1.008,4033… → 1.008,40
      expect(
        PaymentPolicy.convert('1500000.00', Currency.ARS, Currency.USD, {
          rate: '1487.5',
          source: ExchangeRateSource.MEP,
          date: '2026-10-15',
        }),
      ).toEqual({
        exchangeRate: {
          rate: '1487.5000',
          source: ExchangeRateSource.MEP,
          date: '2026-10-15',
        },
        amountInContractCurrency: '1008.40',
      })
      expect(
        PaymentPolicy.convert('100.00', Currency.USD, Currency.ARS, {
          rate: '1487.5',
          source: ExchangeRateSource.OFFICIAL,
          date: '2026-10-15',
        }).amountInContractCurrency,
      ).toBe('148750.00')
    })
  })

  it('quién recibe y con qué estado nace el pago (3.3, A-11)', () => {
    expect(PaymentPolicy.receiver(null, CollectionMode.AGENCY)).toBe(
      PaymentReceiver.AGENCY,
    )
    expect(PaymentPolicy.receiver(null, CollectionMode.OWNER_DIRECT)).toBe(
      PaymentReceiver.OWNER,
    )
    expect(
      PaymentPolicy.receiver(
        PaymentReceiver.AGENCY,
        CollectionMode.OWNER_DIRECT,
      ),
    ).toBe(PaymentReceiver.AGENCY)
    expect(PaymentPolicy.initialStatus(PaymentReceiver.AGENCY)).toBe(
      PaymentStatus.CONFIRMED,
    )
    expect(PaymentPolicy.initialStatus(PaymentReceiver.OWNER)).toBe(
      PaymentStatus.PENDING_CONFIRMATION,
    )
  })

  describe('imputación (regla 4, A-8)', () => {
    it('por defecto punitorio → alquiler → cargos, y el exceso es crédito (A-6)', () => {
      expect(PaymentPolicy.allocate('15000.00', BALANCES, null)).toEqual({
        lateFeeApplied: '15000.00',
        rentApplied: '0.00',
        chargesApplied: '0.00',
        creditGenerated: '0.00',
      })
      expect(PaymentPolicy.allocate('120000.00', BALANCES, null)).toEqual({
        lateFeeApplied: '20000.00',
        rentApplied: '100000.00',
        chargesApplied: '0.00',
        creditGenerated: '0.00',
      })
      expect(PaymentPolicy.allocate('300000.00', BALANCES, null)).toEqual({
        lateFeeApplied: '20000.00',
        rentApplied: '200000.00',
        chargesApplied: '30000.00',
        creditGenerated: '50000.00',
      })
    })

    it('manual: cada concepto hasta su saldo, la suma igual al monto salvo todo cubierto', () => {
      expect(
        PaymentPolicy.allocate('100000.00', BALANCES, {
          lateFee: '0',
          rent: '100000',
          charges: '0',
        }),
      ).toEqual({
        lateFeeApplied: '0.00',
        rentApplied: '100000.00',
        chargesApplied: '0.00',
        creditGenerated: '0.00',
      })
      expect(() =>
        PaymentPolicy.allocate('100000.00', BALANCES, {
          lateFee: '0',
          rent: '250000',
          charges: '0',
        }),
      ).toThrow(InvalidAllocationException)
      expect(() =>
        PaymentPolicy.allocate('100000.00', BALANCES, {
          lateFee: '0',
          rent: '50000',
          charges: '0',
        }),
      ).toThrow(InvalidAllocationException)
      expect(() =>
        PaymentPolicy.allocate('100000.00', BALANCES, {
          lateFee: '-1',
          rent: '100001',
          charges: '0',
        }),
      ).toThrow(InvalidAllocationException)
      expect(() =>
        PaymentPolicy.allocate('100000.00', BALANCES, {
          lateFee: '60000',
          rent: '60000',
          charges: '0',
        }),
      ).toThrow(InvalidAllocationException)
      // Todo cubierto: el resto es crédito.
      expect(
        PaymentPolicy.allocate('260000.00', BALANCES, {
          lateFee: '20000',
          rent: '200000',
          charges: '30000',
        }).creditGenerated,
      ).toBe('10000.00')
    })

    it('parsea la imputación del multipart y descuenta lo imputado de los saldos', () => {
      expect(PaymentPolicy.parseAllocation(undefined)).toBeNull()
      expect(PaymentPolicy.parseAllocation('')).toBeNull()
      expect(PaymentPolicy.parseAllocation('{"rent":"100000"}')).toEqual({
        lateFee: '0.00',
        rent: '100000',
        charges: '0.00',
      })
      expect(() => PaymentPolicy.parseAllocation('{')).toThrow(
        InvalidAllocationException,
      )
      expect(() => PaymentPolicy.parseAllocation('{"rent":[1]}')).toThrow(
        InvalidAllocationException,
      )
      expect(
        PaymentPolicy.remainingAfter(BALANCES, {
          lateFeeApplied: '20000.00',
          rentApplied: '100000.00',
          chargesApplied: '0.00',
          creditGenerated: '0.00',
        }),
      ).toEqual({
        lateFeeBalance: '0.00',
        rentBalance: '100000.00',
        chargesBalance: '30000.00',
      })
    })
  })

  describe('saldos a favor (regla 5)', () => {
    it('aplica del más viejo al más nuevo, cada uno hasta su remanente, hasta cubrir la deuda', () => {
      const older = credit({ id: 'old', remaining: '30000.00' })
      const newer = credit({ id: 'new', remaining: '50000.00' })
      expect(
        PaymentPolicy.planCreditApplications(
          [older, newer],
          '60000.00',
          Currency.ARS,
        ),
      ).toEqual([
        { credit: older, amount: '30000.00' },
        { credit: newer, amount: '30000.00' },
      ])
      expect(
        PaymentPolicy.planCreditApplications([older], '10000.00', Currency.ARS),
      ).toEqual([{ credit: older, amount: '10000.00' }])
      expect(
        PaymentPolicy.planCreditApplications([], '10000.00', Currency.ARS),
      ).toEqual([])
      // Otra moneda no se mezcla.
      expect(
        PaymentPolicy.planCreditApplications(
          [credit({ currency: Currency.USD })],
          '10000.00',
          Currency.ARS,
        ),
      ).toEqual([])
    })

    it('a mano: un crédito puntual y un monto, con sus controles', () => {
      const chosen = credit({ id: 'chosen', remaining: '50000.00' })
      expect(
        PaymentPolicy.planCreditApplications(
          [chosen],
          '60000.00',
          Currency.ARS,
          {
            creditId: 'chosen',
            amount: '20000',
          },
        ),
      ).toEqual([{ credit: chosen, amount: '20000.00' }])
      expect(() =>
        PaymentPolicy.planCreditApplications(
          [chosen],
          '60000.00',
          Currency.ARS,
          {
            creditId: 'other',
          },
        ),
      ).toThrow(CreditNotAvailableException)
      expect(() =>
        PaymentPolicy.planCreditApplications(
          [chosen],
          '10000.00',
          Currency.ARS,
          {
            amount: '20000',
          },
        ),
      ).toThrow(CreditNotAvailableException)
      expect(() =>
        PaymentPolicy.planCreditApplications(
          [credit({ id: 'usd', currency: Currency.USD })],
          '10000.00',
          Currency.ARS,
          { creditId: 'usd' },
        ),
      ).toThrow(CreditCurrencyMismatchException)
    })
  })

  it('el comprobante es opcional; si viene, imagen o PDF de hasta 10 MB (D-74)', () => {
    expect(PaymentPolicy.receiptKind(null)).toBeNull()
    expect(PaymentPolicy.receiptKind(Buffer.alloc(0))).toBeNull()
    expect(PaymentPolicy.receiptKind(Buffer.from('%PDF-1.4 x'))).toEqual({
      extension: 'pdf',
      contentType: 'application/pdf',
    })
    expect(() => PaymentPolicy.receiptKind(Buffer.from('hola'))).toThrow(
      InvalidPaymentReceiptException,
    )
  })
})
