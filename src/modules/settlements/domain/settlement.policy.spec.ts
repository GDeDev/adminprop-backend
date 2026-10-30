import {
  CollectedPayment,
  Currency,
  FeeMode,
  PaymentMethod,
  SettlementAdjustmentConcept,
  SettlementStatus,
} from './settlement'
import {
  InvalidSettlementAmountException,
  InvalidSettlementDateException,
  InvalidSettlementPeriodException,
  InvalidSettlementReceiptException,
  SettlementNotConfirmedException,
  SettlementNotPendingException,
  SettlementTransferExceedsNetException,
} from './settlement.exceptions'
import { SettlementPolicy } from './settlement.policy'

const rules = { feeIncludesLateFees: false, feeIncludesCharges: false }
const fallback = { feeMode: FeeMode.DEDUCTED, feePercentage: '5.00' }

let seq = 0
function collected(
  overrides: Partial<CollectedPayment> = {},
): CollectedPayment {
  seq += 1
  return {
    paymentId: `pay-${seq}`,
    installmentId: 'inst-1',
    installmentPeriod: '2026-09',
    paidAt: '2026-10-05',
    rentApplied: '100000.00',
    lateFeeApplied: '0.00',
    ownerChargesApplied: '0.00',
    serviceChargesApplied: '0.00',
    terms: {
      feeMode: FeeMode.DEDUCTED,
      feePercentage: '5.00',
      feeAmount: null,
      baseAmount: '100000.00',
    },
    ...overrides,
  }
}

const expense = (amount: string, currency = Currency.ARS) => ({
  expenseId: `exp-${++seq}`,
  description: 'Plomero',
  expenseDate: '2026-10-02',
  amount,
  currency,
})

describe('SettlementPolicy', () => {
  describe('compute (4.1, 4.2)', () => {
    it('suma lo cobrado por concepto, calcula el honorario por cuota y toma los gastos en la moneda del contrato', () => {
      const result = SettlementPolicy.compute(
        [
          collected({
            lateFeeApplied: '5000.00',
            ownerChargesApplied: '2000.00',
            serviceChargesApplied: '3000.00',
          }),
          collected({
            installmentId: 'inst-2',
            installmentPeriod: '2026-10',
            rentApplied: '40000.00',
          }),
        ],
        [expense('1500.00'), expense('20.00', Currency.USD)],
        Currency.ARS,
        rules,
        fallback,
      )
      expect(result).toMatchObject({
        rentTotal: '140000.00',
        lateFeeTotal: '5000.00',
        ownerChargesTotal: '2000.00',
        serviceChargesTotal: '3000.00',
        feeBase: '140000.00',
        feePercentage: '5.00',
        feeAmountFixed: null,
        feeTotal: '7000.00',
        feeMode: FeeMode.DEDUCTED,
        feeDeducted: true,
        mixedFeeTerms: false,
        expensesTotal: '1500.00',
      })
      expect(result.expenses).toHaveLength(1)
      expect(result.skippedExpenses).toHaveLength(1)
      expect(result.skippedExpenses[0].currency).toBe('USD')
    })

    it('con cuotas de términos distintos, calcula por cuota, guarda la modalidad de la más reciente y avisa', () => {
      const result = SettlementPolicy.compute(
        [
          collected({
            installmentPeriod: '2026-08',
            terms: {
              feeMode: FeeMode.DEDUCTED,
              feePercentage: '5.00',
              feeAmount: null,
              baseAmount: '100000.00',
            },
          }),
          collected({
            installmentId: 'inst-2',
            installmentPeriod: '2026-09',
            rentApplied: '50000.00',
            terms: {
              feeMode: FeeMode.OWNER_PAYS,
              feePercentage: '3.00',
              feeAmount: '8000.00',
              baseAmount: '100000.00',
            },
          }),
        ],
        [],
        Currency.ARS,
        rules,
        fallback,
      )
      // 5 % de 100.000 = 5.000; fijo 8.000 prorrateado por 50 % = 4.000 (A-15).
      expect(result).toMatchObject({
        feeTotal: '9000.00',
        feeMode: FeeMode.OWNER_PAYS,
        feeDeducted: false,
        feePercentage: '3.00',
        feeAmountFixed: '8000.00',
        mixedFeeTerms: true,
      })
    })

    it('sin pagos usa los términos del contrato como referencia', () => {
      const result = SettlementPolicy.compute(
        [],
        [expense('500.00')],
        Currency.ARS,
        rules,
        { feeMode: FeeMode.OWNER_PAYS, feePercentage: '4.00' },
      )
      expect(result).toMatchObject({
        rentTotal: '0.00',
        feeTotal: '0.00',
        feeMode: FeeMode.OWNER_PAYS,
        feePercentage: '4.00',
        feeDeducted: false,
        expensesTotal: '500.00',
      })
    })
  })

  describe('neto y ajustes (4.3, A-16, A-20)', () => {
    const totals = {
      rentTotal: '100000.00',
      lateFeeTotal: '5000.00',
      ownerChargesTotal: '2000.00',
      feeTotal: '5000.00',
      feeDeducted: true,
      expensesTotal: '1500.00',
    }

    it('los cargos SERVICE no entran; los honorarios sólo si se descuentan; los ajustes llevan signo', () => {
      const adjustments = [
        {
          concept: SettlementAdjustmentConcept.WITHHOLDING,
          amount: '1000.00',
          voidedAt: null,
        },
        {
          concept: SettlementAdjustmentConcept.OTHER_CREDIT,
          amount: '300.00',
          voidedAt: null,
        },
        {
          concept: SettlementAdjustmentConcept.OWNER_ADVANCE,
          amount: '99999.00',
          voidedAt: new Date(),
        },
      ]
      expect(SettlementPolicy.adjustmentsTotal(adjustments)).toBe('-700.00')
      expect(SettlementPolicy.net(totals, '-700.00')).toBe('99800.00')
      expect(
        SettlementPolicy.net({ ...totals, feeDeducted: false }, '0.00'),
      ).toBe('105500.00')
    })

    it('el neto puede ser negativo', () => {
      expect(
        SettlementPolicy.net(
          {
            ...totals,
            rentTotal: '0.00',
            lateFeeTotal: '0.00',
            ownerChargesTotal: '0.00',
            feeTotal: '0.00',
          },
          '0.00',
        ),
      ).toBe('-1500.00')
    })
  })

  describe('transferencias (4.5)', () => {
    const settlement = {
      id: 's1',
      status: SettlementStatus.CONFIRMED,
      netAmount: '100000.00',
      transfers: [
        {
          id: 't1',
          transferredAt: '2026-10-10',
          amount: '60000.00',
          method: PaymentMethod.TRANSFER,
          receiptKey: null,
          receiptUrl: null,
          notes: null,
          registeredById: 'u1',
          voidedAt: null,
          voidedById: null,
          voidReason: null,
          createdAt: new Date(),
        },
        {
          id: 't2',
          transferredAt: '2026-10-11',
          amount: '50000.00',
          method: PaymentMethod.CASH,
          receiptKey: null,
          receiptUrl: null,
          notes: null,
          registeredById: 'u1',
          voidedAt: new Date(),
          voidedById: 'u1',
          voidReason: 'error',
          createdAt: new Date(),
        },
      ],
    }

    it('la suma vigente no puede superar el neto; al cubrirlo pasa a TRANSFERRED', () => {
      expect(SettlementPolicy.transferredTotal(settlement)).toBe('60000.00')
      expect(() =>
        SettlementPolicy.assertTransferFits(settlement, '40000.00'),
      ).not.toThrow()
      expect(() =>
        SettlementPolicy.assertTransferFits(settlement, '40000.01'),
      ).toThrow(SettlementTransferExceedsNetException)
      expect(
        SettlementPolicy.statusAfterTransfers(settlement, '100000.00'),
      ).toBe(SettlementStatus.TRANSFERRED)
      expect(
        SettlementPolicy.statusAfterTransfers(settlement, '60000.00'),
      ).toBe(SettlementStatus.CONFIRMED)
    })

    it('un neto ≤ 0 no admite transferencias', () => {
      expect(() =>
        SettlementPolicy.assertTransferFits(
          { ...settlement, netAmount: '-10.00', transfers: [] },
          '1.00',
        ),
      ).toThrow(SettlementTransferExceedsNetException)
    })
  })

  describe('estados y normalizaciones', () => {
    it('pendiente para recalcular y ajustar; confirmada para transferir', () => {
      expect(() =>
        SettlementPolicy.assertPending({
          id: 's',
          status: SettlementStatus.CONFIRMED,
        }),
      ).toThrow(SettlementNotPendingException)
      expect(() =>
        SettlementPolicy.assertConfirmed({
          id: 's',
          status: SettlementStatus.PENDING,
        }),
      ).toThrow(SettlementNotConfirmedException)
      expect(() =>
        SettlementPolicy.assertConfirmed({
          id: 's',
          status: SettlementStatus.TRANSFERRED,
        }),
      ).not.toThrow()
    })

    it('período default el mes de hoy (A-21); secuencia siguiente; montos, fechas y comprobante', () => {
      expect(SettlementPolicy.normalizePeriod(undefined, '2026-10-29')).toBe(
        '2026-10',
      )
      expect(SettlementPolicy.normalizePeriod(' 2026-11 ', '2026-10-29')).toBe(
        '2026-11',
      )
      expect(() =>
        SettlementPolicy.normalizePeriod('2026-13', '2026-10-29'),
      ).toThrow(InvalidSettlementPeriodException)
      expect(SettlementPolicy.nextSequence(null)).toBe(1)
      expect(SettlementPolicy.nextSequence(2)).toBe(3)
      expect(SettlementPolicy.normalizeAmount('10.005')).toBe('10.01')
      expect(() => SettlementPolicy.normalizeAmount('0')).toThrow(
        InvalidSettlementAmountException,
      )
      expect(() =>
        SettlementPolicy.normalizeDate('2026-10-30', '2026-10-29'),
      ).toThrow(InvalidSettlementDateException)
      expect(SettlementPolicy.receiptKind(Buffer.alloc(0))).toBeNull()
      expect(
        SettlementPolicy.receiptKind(Buffer.from('%PDF-1.4'))?.extension,
      ).toBe('pdf')
      expect(() => SettlementPolicy.receiptKind(Buffer.from('hola'))).toThrow(
        InvalidSettlementReceiptException,
      )
    })

    it('el ajuste automático por un pago anulado descuenta lo que el pago le había dado al propietario (A-19)', () => {
      expect(
        SettlementPolicy.voidedPaymentAmount({
          rentApplied: '100000.00',
          lateFeeApplied: '5000.00',
          ownerChargesApplied: '1000.00',
        }),
      ).toBe('106000.00')
      expect(
        SettlementPolicy.voidedPaymentDescription({
          paidAt: '2026-10-05',
          period: '2026-09',
          reason: 'Transferencia rechazada',
        }),
      ).toBe(
        'Pago anulado del 2026-10-05 (cuota 2026-09) ya liquidado: Transferencia rechazada',
      )
    })
  })

  describe('consolidado (4.7)', () => {
    it('suma las liquidaciones por moneda sin mezclar', () => {
      const base = {
        rentTotal: '100000.00',
        lateFeeTotal: '1000.00',
        ownerChargesTotal: '500.00',
        feeTotal: '5000.00',
        expensesTotal: '200.00',
        adjustmentsTotal: '-100.00',
        netAmount: '96200.00',
        transferredTotal: '96200.00',
      }
      expect(
        SettlementPolicy.statementTotals([
          { currency: Currency.ARS, ...base },
          {
            currency: Currency.ARS,
            ...base,
            netAmount: '-5.00',
            transferredTotal: '0.00',
          },
          { currency: Currency.USD, ...base, rentTotal: '1000.00' },
        ]),
      ).toEqual([
        {
          currency: 'ARS',
          rentTotal: '200000.00',
          lateFeeTotal: '2000.00',
          chargesTotal: '1000.00',
          feeTotal: '10000.00',
          expensesTotal: '400.00',
          adjustmentsTotal: '-200.00',
          netTotal: '96195.00',
          transferredTotal: '96200.00',
        },
        expect.objectContaining({ currency: 'USD', rentTotal: '1000.00' }),
      ])
    })
  })
})
