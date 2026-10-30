import { FeePolicy } from './fee.policy'
import {
  Currency,
  FeeMode,
  FeePayer,
  FeePayment,
  FeeReceivable,
  FeeReceivableSource,
  FeeReceivableStatus,
  PaymentMethod,
} from './settlement'
import { InvalidFeePaymentAmountException } from './settlement.exceptions'

const terms = {
  feeMode: FeeMode.DEDUCTED,
  feePercentage: '5.00',
  feeAmount: null,
  baseAmount: '200000.00',
}
const rules = { feeIncludesLateFees: false, feeIncludesCharges: false }
const collected = {
  rentApplied: '200000.00',
  lateFeeApplied: '50000.00',
  ownerChargesApplied: '10000.00',
}

let seq = 0
function receivable(overrides: Partial<FeeReceivable> = {}): FeeReceivable {
  seq += 1
  return {
    id: `r-${seq}`,
    ownerId: 'o1',
    contractId: 'c1',
    installmentId: null,
    period: '2026-10',
    currency: Currency.ARS,
    source: FeeReceivableSource.SETTLEMENT_NOT_DEDUCTED,
    payer: FeePayer.OWNER,
    originPaymentId: null,
    originSettlementId: null,
    amount: '10000.00',
    paidAmount: '0.00',
    status: FeeReceivableStatus.PENDING,
    feePercentage: '5.00',
    feeAmountFixed: null,
    baseAmount: '200000.00',
    needsReview: false,
    voidedAt: null,
    createdAt: new Date(`2026-10-${String(seq).padStart(2, '0')}T12:00:00Z`),
    ...overrides,
  }
}

function payment(overrides: Partial<FeePayment> = {}): FeePayment {
  seq += 1
  return {
    id: `p-${seq}`,
    ownerId: 'o1',
    contractId: null,
    paidAt: '2026-10-20',
    amount: '10000.00',
    currency: Currency.ARS,
    method: PaymentMethod.TRANSFER,
    paidBy: FeePayer.OWNER,
    unallocatedAmount: '0.00',
    receiptKey: null,
    receiptUrl: null,
    notes: null,
    registeredById: 'u1',
    voidedAt: null,
    voidedById: null,
    voidReason: null,
    allocations: [],
    createdAt: new Date('2026-10-20T12:00:00Z'),
    ...overrides,
  }
}

describe('FeePolicy', () => {
  describe('feeForInstallment (4.2, Micaela #5)', () => {
    it('ejemplo de Micaela: 200.000 de alquiler y 50.000 de punitorio al 5 % → 10.000', () => {
      expect(FeePolicy.feeForInstallment(terms, collected, rules)).toEqual({
        base: '200000.00',
        amount: '10000.00',
      })
    })

    it('el propietario puede incluir punitorios y cargos en la base; los SERVICE nunca entran', () => {
      expect(
        FeePolicy.feeForInstallment(terms, collected, {
          feeIncludesLateFees: true,
          feeIncludesCharges: true,
        }),
      ).toEqual({ base: '260000.00', amount: '13000.00' })
    })

    it('A-15: el fijo se prorratea por el alquiler cobrado y la suma de las partes da el fijo', () => {
      const fixed = { ...terms, feeAmount: '15000.00' }
      const first = FeePolicy.feeForInstallment(
        fixed,
        {
          rentApplied: '120000.00',
          lateFeeApplied: '0.00',
          ownerChargesApplied: '0.00',
        },
        rules,
      )
      const second = FeePolicy.feeForInstallment(
        fixed,
        {
          rentApplied: '80000.00',
          lateFeeApplied: '0.00',
          ownerChargesApplied: '0.00',
        },
        rules,
      )
      expect(first.amount).toBe('9000.00')
      expect(second.amount).toBe('6000.00')
      expect(FeePolicy.fixedFeeFor('15000.00', '0.00', '200000.00')).toBe(
        '0.00',
      )
      expect(FeePolicy.fixedFeeFor('15000.00', '100.00', '0.00')).toBe('0.00')
    })

    it('quién paga y si se descuenta salen de la modalidad', () => {
      expect(FeePolicy.payerFor(FeeMode.RENTER_PAYS_ON_BEHALF)).toBe(
        FeePayer.RENTER,
      )
      expect(FeePolicy.payerFor(FeeMode.OWNER_PAYS)).toBe(FeePayer.OWNER)
      expect(FeePolicy.isDeducted(FeeMode.DEDUCTED)).toBe(true)
      expect(FeePolicy.isDeducted(FeeMode.OWNER_PAYS)).toBe(false)
    })
  })

  describe('imputación de pagos de honorarios (3.3)', () => {
    it('va a los más viejos primero, cada uno hasta lo que le falta; el exceso queda sin imputar', () => {
      const old = receivable({ amount: '10000.00', paidAmount: '4000.00' })
      const paid = receivable({
        amount: '5000.00',
        paidAmount: '5000.00',
        status: FeeReceivableStatus.PAID,
      })
      const voided = receivable({ status: FeeReceivableStatus.VOIDED })
      const recent = receivable({ amount: '8000.00' })
      expect(
        FeePolicy.allocate('15000.00', [old, paid, voided, recent]),
      ).toEqual({
        allocations: [
          { receivableId: old.id, amount: '6000.00' },
          { receivableId: recent.id, amount: '8000.00' },
        ],
        unallocated: '1000.00',
      })
      expect(FeePolicy.allocate('1000.00', [old, recent])).toEqual({
        allocations: [{ receivableId: old.id, amount: '1000.00' }],
        unallocated: '0.00',
      })
    })

    it('el estado sigue a lo cobrado y el monto tiene que ser > 0', () => {
      expect(FeePolicy.receivableStatus('100.00', '0.00')).toBe('PENDING')
      expect(FeePolicy.receivableStatus('100.00', '40.00')).toBe('PARTIAL')
      expect(FeePolicy.receivableStatus('100.00', '100.00')).toBe('PAID')
      expect(FeePolicy.normalizeAmount('12.345')).toBe('12.35')
      expect(() => FeePolicy.normalizeAmount('0')).toThrow(
        InvalidFeePaymentAmountException,
      )
      expect(() => FeePolicy.normalizeAmount('abc')).toThrow(
        InvalidFeePaymentAmountException,
      )
    })
  })

  describe('cuenta de honorarios (4.8)', () => {
    it('totales por moneda: devengado, cobrado, pendiente y sin imputar; los anulados no cuentan', () => {
      const receivables = [
        receivable({ amount: '10000.00', paidAmount: '10000.00' }),
        receivable({ amount: '5000.00', paidAmount: '2000.00' }),
        receivable({ amount: '7000.00', status: FeeReceivableStatus.VOIDED }),
        receivable({ amount: '100.00', currency: Currency.USD }),
      ]
      const payments = [
        payment({ amount: '12000.00' }),
        payment({ amount: '3000.00', unallocatedAmount: '3000.00' }),
        payment({
          amount: '9.00',
          unallocatedAmount: '9.00',
          voidedAt: new Date(),
        }),
      ]
      expect(FeePolicy.accountTotals(receivables, payments)).toEqual([
        {
          currency: 'ARS',
          accrued: '15000.00',
          collected: '12000.00',
          pending: '3000.00',
          unallocated: '3000.00',
        },
        {
          currency: 'USD',
          accrued: '100.00',
          collected: '0.00',
          pending: '100.00',
          unallocated: '0.00',
        },
      ])
    })

    it('movimientos cronológicos con saldo acumulado por moneda', () => {
      const r = receivable({
        amount: '10000.00',
        createdAt: new Date('2026-10-05T10:00:00Z'),
      })
      const p = payment({
        amount: '4000.00',
        paidAt: '2026-10-10',
        voidedAt: new Date('2026-10-12T10:00:00Z'),
        voidReason: 'rebotó',
      })
      const movements = FeePolicy.movements([r], [p], {
        receivable: () => 'Honorario',
        payment: () => 'Pago',
      })
      expect(
        movements.map((m) => [m.date, m.type, m.debit, m.credit, m.balance]),
      ).toEqual([
        ['2026-10-05', 'ACCRUED', '10000.00', null, '10000.00'],
        ['2026-10-10', 'PAYMENT', null, '4000.00', '6000.00'],
        ['2026-10-12', 'PAYMENT_VOIDED', '4000.00', null, '10000.00'],
      ])
    })
  })
})
