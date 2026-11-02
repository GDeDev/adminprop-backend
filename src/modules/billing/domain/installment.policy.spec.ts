import {
  ChargeConcept,
  CollectionMode,
  Currency,
  FeeMode,
  Installment,
  InstallmentCharge,
  InstallmentStatus,
  LateFeeAdjustment,
  LateFeeAdjustmentKind,
  Payment,
  PaymentKind,
  PaymentMethod,
  PaymentReceiver,
  PaymentStatus,
} from './billing'
import {
  ChargeAlreadyVoidedException,
  ChargeHasAllocationsException,
  InvalidChargeAmountException,
  InvalidInstallmentPeriodException,
  InvalidLateFeeAdjustmentException,
} from './billing.exceptions'
import { InstallmentPolicy } from './installment.policy'

let seq = 0
const at = (iso: string) => new Date(`${iso}T12:00:00.000Z`)

/** Cuota de octubre de 2026: 200.000 ARS, 5 % diario, gracia 10 (Micaela #3). */
export function installment(overrides: Partial<Installment> = {}): Installment {
  return {
    id: 'inst-1',
    contractId: 'contract-1',
    renterId: 'renter-1',
    ownerId: 'owner-1',
    propertyId: 'property-1',
    period: '2026-10',
    baseAmount: '200000.00',
    currency: Currency.ARS,
    graceEndDate: '2026-10-10',
    lateFeePercentage: '5.00',
    lateFeeGraceDays: 10,
    collectionMode: CollectionMode.AGENCY,
    feeMode: FeeMode.DEDUCTED,
    feePercentage: '5.00',
    feeAmount: null,
    lateFeeWaived: false,
    status: InstallmentStatus.PENDING,
    paidAt: null,
    notes: null,
    charges: [],
    payments: [],
    adjustments: [],
    frozenFeeDays: [],
    createdAt: at('2026-09-28'),
    updatedAt: at('2026-09-28'),
    ...overrides,
  }
}

export function payment(overrides: Partial<Payment> = {}): Payment {
  seq += 1
  const rentApplied = overrides.rentApplied ?? '0.00'
  const lateFeeApplied = overrides.lateFeeApplied ?? '0.00'
  const chargesApplied = overrides.chargesApplied ?? '0.00'
  const total = (
    Number(rentApplied) +
    Number(lateFeeApplied) +
    Number(chargesApplied)
  ).toFixed(2)
  return {
    id: `pay-${seq}`,
    installmentId: 'inst-1',
    contractId: 'contract-1',
    renterId: 'renter-1',
    paidAt: '2026-10-15',
    paidCurrency: Currency.ARS,
    amount: total,
    exchangeRate: null,
    exchangeRateSource: null,
    exchangeRateDate: null,
    amountInContractCurrency: total,
    kind: PaymentKind.CASH_IN,
    method: PaymentMethod.TRANSFER,
    receivedBy: PaymentReceiver.AGENCY,
    status: PaymentStatus.CONFIRMED,
    lateFeeApplied,
    rentApplied,
    chargesApplied,
    creditGenerated: '0.00',
    creditId: null,
    receiptKey: null,
    receiptUrl: null,
    receiptNumber: null,
    receiptPdfKey: null,
    receiptPdfUrl: null,
    registeredById: 'user-1',
    notes: null,
    confirmedById: null,
    confirmedAt: null,
    voidedById: null,
    voidedAt: null,
    voidReason: null,
    settlementId: null,
    createdAt: at(overrides.paidAt ?? '2026-10-15'),
    ...overrides,
  }
}

export function charge(
  overrides: Partial<InstallmentCharge> = {},
): InstallmentCharge {
  seq += 1
  return {
    id: `charge-${seq}`,
    installmentId: 'inst-1',
    concept: ChargeConcept.SERVICE,
    description: 'Expensas',
    amount: '30000.00',
    createdById: 'user-1',
    createdAt: at('2026-10-02'),
    voidedAt: null,
    voidedById: null,
    voidReason: null,
    ...overrides,
  }
}

function adjustment(
  overrides: Partial<LateFeeAdjustment> = {},
): LateFeeAdjustment {
  seq += 1
  return {
    id: `adj-${seq}`,
    installmentId: 'inst-1',
    kind: LateFeeAdjustmentKind.REDUCE,
    amount: '10000.00',
    reason: 'Acuerdo con el inquilino',
    createdById: 'admin-1',
    createdAt: at('2026-10-16'),
    ...overrides,
  }
}

describe('InstallmentPolicy', () => {
  describe('período y gracia', () => {
    it('normaliza el período y rechaza meses inválidos', () => {
      expect(InstallmentPolicy.normalizePeriod(' 2026-10 ')).toBe('2026-10')
      expect(() => InstallmentPolicy.normalizePeriod('2026-13')).toThrow(
        InvalidInstallmentPeriodException,
      )
    })

    it('sin período se generan las cuotas del mes siguiente', () => {
      expect(InstallmentPolicy.defaultPeriod('2026-10-28')).toBe('2026-11')
      expect(InstallmentPolicy.defaultPeriod('2026-12-28')).toBe('2027-01')
    })

    it('el último día sin punitorio es el día N de la gracia (RN-02)', () => {
      expect(InstallmentPolicy.graceEndDate('2026-10', 10)).toBe('2026-10-10')
      expect(InstallmentPolicy.graceEndDate('2026-10', 0)).toBe('2026-09-30')
    })

    it('la base es el alquiler vigente, mes entero (A-7)', () => {
      expect(InstallmentPolicy.baseFor('150333.333')).toBe('150333.33')
    })

    it('un aumento sólo corrige cuotas pendientes sin pagos vigentes (A-24)', () => {
      expect(InstallmentPolicy.canRebase(installment())).toBe(true)
      expect(
        InstallmentPolicy.canRebase(
          installment({
            status: InstallmentStatus.PARTIAL,
            payments: [payment({ rentApplied: '10.00' })],
          }),
        ),
      ).toBe(false)
      expect(
        InstallmentPolicy.canRebase(
          installment({ status: InstallmentStatus.PAID }),
        ),
      ).toBe(false)
      // Un pago anulado no cuenta.
      expect(
        InstallmentPolicy.canRebase(
          installment({
            payments: [payment({ status: PaymentStatus.VOIDED })],
          }),
        ),
      ).toBe(true)
    })
  })

  describe('punitorio diario sobre el saldo impago (regla 3, A-3)', () => {
    it('ejemplo de Micaela: 200.000 al 5 %, gracia 10, pago el 15 → 5 días, 50.000', () => {
      const paid = installment({
        paidAt: '2026-10-15',
        payments: [payment({ paidAt: '2026-10-15', rentApplied: '200000.00' })],
      })
      const days = InstallmentPolicy.lateFeeDays(paid, '2026-10-31')
      expect(days).toHaveLength(5)
      expect(days[0]).toEqual({
        day: '2026-10-11',
        dayNumber: 1,
        outstandingBase: '200000.00',
        dailyPercentage: '5.00',
        amount: '10000.00',
      })
      expect(days[4].day).toBe('2026-10-15')
      const balances = InstallmentPolicy.balances(paid, '2026-10-31')
      expect(balances.feeDays).toBe(5)
      expect(balances.lateFeeAccrued).toBe('50000.00')
      expect(balances.rentBalance).toBe('0.00')
      expect(balances.lateFeeBalance).toBe('50000.00')
      expect(balances.totalDue).toBe('50000.00')
    })

    it('dentro de la gracia no hay punitorio; crece día a día mientras no se paga', () => {
      const unpaid = installment()
      expect(InstallmentPolicy.lateFeeDays(unpaid, '2026-10-10')).toEqual([])
      expect(
        InstallmentPolicy.balances(unpaid, '2026-10-11').lateFeeAccrued,
      ).toBe('10000.00')
      expect(
        InstallmentPolicy.balances(unpaid, '2026-10-20').lateFeeAccrued,
      ).toBe('100000.00')
      // Sigue corriendo al mes siguiente.
      expect(InstallmentPolicy.balances(unpaid, '2026-11-09').feeDays).toBe(30)
    })

    it('un pago parcial de alquiler baja el punitorio de los días siguientes', () => {
      const partial = installment({
        payments: [payment({ paidAt: '2026-10-13', rentApplied: '100000.00' })],
      })
      const days = InstallmentPolicy.lateFeeDays(partial, '2026-10-15')
      expect(days.map((d) => [d.day, d.outstandingBase, d.amount])).toEqual([
        ['2026-10-11', '200000.00', '10000.00'],
        ['2026-10-12', '200000.00', '10000.00'],
        // El día del pago cuenta con el saldo previo.
        ['2026-10-13', '200000.00', '10000.00'],
        ['2026-10-14', '100000.00', '5000.00'],
        ['2026-10-15', '100000.00', '5000.00'],
      ])
      expect(
        InstallmentPolicy.balances(partial, '2026-10-15').lateFeeAccrued,
      ).toBe('40000.00')
    })

    it('un pago informado por el propietario cuenta como pagado a su fecha (A-11)', () => {
      const informed = installment({
        payments: [
          payment({
            paidAt: '2026-10-12',
            rentApplied: '200000.00',
            status: PaymentStatus.PENDING_CONFIRMATION,
            receivedBy: PaymentReceiver.OWNER,
          }),
        ],
      })
      const balances = InstallmentPolicy.balances(informed, '2026-10-20')
      expect(balances.rentBalance).toBe('0.00')
      expect(balances.pendingConfirmationTotal).toBe('200000.00')
      // Sin paidAt fijado todavía, los días siguen contando hasta hoy pero
      // con saldo cero no devengan.
      expect(balances.feeDays).toBe(2)
      expect(balances.lateFeeAccrued).toBe('20000.00')
    })

    it('un pago anulado no cuenta para nada', () => {
      const voided = installment({
        payments: [
          payment({
            paidAt: '2026-10-05',
            rentApplied: '200000.00',
            status: PaymentStatus.VOIDED,
          }),
        ],
      })
      const balances = InstallmentPolicy.balances(voided, '2026-10-12')
      expect(balances.rentBalance).toBe('200000.00')
      expect(balances.paidTotal).toBe('0.00')
      expect(balances.lateFeeAccrued).toBe('20000.00')
    })

    it('los cargos no devengan punitorio (A-10) pero sí suman al saldo', () => {
      const withCharge = installment({ charges: [charge()] })
      const balances = InstallmentPolicy.balances(withCharge, '2026-10-12')
      expect(balances.chargesTotal).toBe('30000.00')
      expect(balances.chargesBalance).toBe('30000.00')
      expect(balances.lateFeeAccrued).toBe('20000.00')
      expect(balances.totalDue).toBe('250000.00')

      const voidedCharge = installment({
        charges: [charge({ voidedAt: at('2026-10-03') })],
      })
      expect(
        InstallmentPolicy.balances(voidedCharge, '2026-10-05').chargesTotal,
      ).toBe('0.00')
    })

    it('la condonación deja el punitorio en cero y la reducción lo descuenta', () => {
      const waived = installment({ lateFeeWaived: true })
      const b = InstallmentPolicy.balances(waived, '2026-10-20')
      expect(b.lateFeeAccrued).toBe('0.00')
      expect(b.lateFeeBalance).toBe('0.00')
      expect(b.days).toEqual([])

      const reduced = installment({ adjustments: [adjustment()] })
      const r = InstallmentPolicy.balances(reduced, '2026-10-12')
      expect(r.lateFeeAccrued).toBe('20000.00')
      expect(r.lateFeeAdjusted).toBe('10000.00')
      expect(r.lateFeeBalance).toBe('10000.00')
      expect(r.totalDue).toBe('210000.00')
    })

    it('el punitorio ya pagado baja el saldo de punitorio, nunca a negativo', () => {
      const paidFee = installment({
        payments: [
          payment({
            paidAt: '2026-10-12',
            lateFeeApplied: '20000.00',
            rentApplied: '200000.00',
          }),
        ],
        paidAt: '2026-10-12',
      })
      const b = InstallmentPolicy.balances(paidFee, '2026-12-01')
      expect(b.lateFeeAccrued).toBe('20000.00')
      expect(b.lateFeePaid).toBe('20000.00')
      expect(b.lateFeeBalance).toBe('0.00')
      expect(b.totalDue).toBe('0.00')
      expect(b.paidTotal).toBe('220000.00')
    })
  })

  describe('estado (regla 6, D-71)', () => {
    it('PENDING sin pagos, PARTIAL con pago y saldo, PAID sin saldo', () => {
      const pending = installment()
      expect(
        InstallmentPolicy.storedStatus(
          pending,
          InstallmentPolicy.balances(pending, '2026-10-05'),
        ),
      ).toBe(InstallmentStatus.PENDING)

      const partial = installment({
        payments: [payment({ paidAt: '2026-10-05', rentApplied: '50000.00' })],
      })
      expect(
        InstallmentPolicy.storedStatus(
          partial,
          InstallmentPolicy.balances(partial, '2026-10-05'),
        ),
      ).toBe(InstallmentStatus.PARTIAL)

      const paid = installment({
        payments: [payment({ paidAt: '2026-10-05', rentApplied: '200000.00' })],
      })
      expect(
        InstallmentPolicy.storedStatus(
          paid,
          InstallmentPolicy.balances(paid, '2026-10-05'),
        ),
      ).toBe(InstallmentStatus.PAID)
      expect(InstallmentPolicy.paidAtOf(paid)).toBe('2026-10-05')
      expect(InstallmentPolicy.paidAtOf(partial)).toBeNull()
    })

    it('OVERDUE se calcula al leer: con saldo y la gracia vencida, aunque haya pagos parciales', () => {
      const pending = installment()
      const balances = InstallmentPolicy.balances(pending, '2026-10-11')
      expect(
        InstallmentPolicy.displayStatus(pending, balances, '2026-10-10'),
      ).toBe(InstallmentStatus.PENDING)
      expect(
        InstallmentPolicy.displayStatus(pending, balances, '2026-10-11'),
      ).toBe(InstallmentStatus.OVERDUE)
      expect(
        InstallmentPolicy.displayStatus(
          { ...pending, status: InstallmentStatus.PARTIAL },
          balances,
          '2026-10-11',
        ),
      ).toBe(InstallmentStatus.OVERDUE)
      expect(
        InstallmentPolicy.displayStatus(
          { ...pending, status: InstallmentStatus.PAID },
          { totalDue: '0.00' },
          '2026-12-01',
        ),
      ).toBe(InstallmentStatus.PAID)
      expect(InstallmentPolicy.daysOverdue(pending, '2026-10-15')).toBe(5)
      expect(InstallmentPolicy.daysOverdue(pending, '2026-10-05')).toBe(0)
    })

    it('el alquiler se da por saldado en la fecha del pago que completó la base', () => {
      const twoPayments = installment({
        payments: [
          payment({ paidAt: '2026-10-20', rentApplied: '100000.00' }),
          payment({ paidAt: '2026-10-05', rentApplied: '100000.00' }),
        ],
      })
      expect(InstallmentPolicy.paidAtOf(twoPayments)).toBe('2026-10-20')
    })
  })

  describe('honorarios devengados (regla 9, A-12)', () => {
    it('sobre la base y sobre el alquiler cobrado confirmado; con importe fijo, el fijo', () => {
      const partial = installment({
        payments: [
          payment({ paidAt: '2026-10-05', rentApplied: '100000.00' }),
          payment({
            paidAt: '2026-10-06',
            rentApplied: '50000.00',
            status: PaymentStatus.PENDING_CONFIRMATION,
          }),
        ],
      })
      expect(InstallmentPolicy.feeAccrual(partial)).toEqual({
        feeOnBase: '10000.00',
        feeOnCollected: '5000.00',
      })
      expect(
        InstallmentPolicy.feeAccrual({ ...partial, feeAmount: '25000.00' }),
      ).toEqual({ feeOnBase: '25000.00', feeOnCollected: '25000.00' })
      expect(
        InstallmentPolicy.feeAccrual(installment({ feeAmount: '25000.00' })),
      ).toEqual({ feeOnBase: '25000.00', feeOnCollected: '0.00' })
    })
  })

  describe('cargos', () => {
    it('monto mayor que cero y descripción obligatoria', () => {
      expect(InstallmentPolicy.normalizeChargeAmount('1500')).toBe('1500.00')
      expect(() => InstallmentPolicy.normalizeChargeAmount('0')).toThrow(
        InvalidChargeAmountException,
      )
      expect(() => InstallmentPolicy.normalizeDescription('  ')).toThrow(
        InvalidChargeAmountException,
      )
      expect(
        InstallmentPolicy.normalizeDescription(' Expensas  octubre '),
      ).toBe('Expensas octubre')
    })

    it('un cargo se anula sólo si nada se le imputó', () => {
      const first = charge()
      const second = charge({ amount: '10000.00' })
      const clean = installment({ charges: [first, second] })
      expect(() =>
        InstallmentPolicy.assertChargeVoidable(
          first,
          InstallmentPolicy.balances(clean, '2026-10-05'),
        ),
      ).not.toThrow()

      const allocated = installment({
        charges: [first, second],
        payments: [
          payment({ paidAt: '2026-10-05', chargesApplied: '15000.00' }),
        ],
      })
      const balances = InstallmentPolicy.balances(allocated, '2026-10-05')
      expect(() =>
        InstallmentPolicy.assertChargeVoidable(first, balances),
      ).toThrow(ChargeHasAllocationsException)
      // Anular el chico deja 30.000 de cargos y 15.000 imputados: entra.
      expect(() =>
        InstallmentPolicy.assertChargeVoidable(second, balances),
      ).not.toThrow()
      expect(() =>
        InstallmentPolicy.assertChargeVoidable(
          charge({ voidedAt: at('2026-10-03') }),
          balances,
        ),
      ).toThrow(ChargeAlreadyVoidedException)
    })
  })

  describe('ajustes del punitorio (3.5)', () => {
    it('REDUCE exige un monto positivo hasta el saldo; WAIVE registra el devengado', () => {
      const overdue = installment()
      const balances = InstallmentPolicy.balances(overdue, '2026-10-12')
      expect(
        InstallmentPolicy.lateFeeAdjustment(
          overdue,
          balances,
          LateFeeAdjustmentKind.REDUCE,
          '5000',
        ),
      ).toEqual({ amount: '5000.00', waive: false })
      expect(() =>
        InstallmentPolicy.lateFeeAdjustment(
          overdue,
          balances,
          LateFeeAdjustmentKind.REDUCE,
          '20000.01',
        ),
      ).toThrow(InvalidLateFeeAdjustmentException)
      expect(() =>
        InstallmentPolicy.lateFeeAdjustment(
          overdue,
          balances,
          LateFeeAdjustmentKind.REDUCE,
          null,
        ),
      ).toThrow(InvalidLateFeeAdjustmentException)
      expect(
        InstallmentPolicy.lateFeeAdjustment(
          overdue,
          balances,
          LateFeeAdjustmentKind.WAIVE,
          null,
        ),
      ).toEqual({ amount: '20000.00', waive: true })
      expect(() =>
        InstallmentPolicy.lateFeeAdjustment(
          installment({ lateFeeWaived: true }),
          balances,
          LateFeeAdjustmentKind.WAIVE,
          null,
        ),
      ).toThrow(InvalidLateFeeAdjustmentException)
    })
  })

  describe('chargesAppliedByConcept (Fase 12, A-16)', () => {
    it('reparte lo imputado a cargos de cada pago entre los cargos vigentes, en orden', () => {
      const service = charge({ amount: '3000.00', createdAt: at('2026-10-02') })
      const penalty = charge({
        concept: ChargeConcept.TERMINATION_PENALTY,
        amount: '10000.00',
        createdAt: at('2026-10-03'),
      })
      const first = payment({ paidAt: '2026-10-05', chargesApplied: '5000.00' })
      const second = payment({
        paidAt: '2026-10-06',
        chargesApplied: '8000.00',
      })
      const voided = payment({
        paidAt: '2026-10-04',
        chargesApplied: '13000.00',
        status: PaymentStatus.VOIDED,
      })
      const split = InstallmentPolicy.chargesAppliedByConcept({
        charges: [penalty, service],
        payments: [second, first, voided],
      })
      // El primero cubre las expensas (3.000) y 2.000 de la multa; el
      // segundo, el resto de la multa. El anulado no cuenta.
      expect(split.get(first.id)).toEqual({
        SERVICE: '3000.00',
        TERMINATION_PENALTY: '2000.00',
        OTHER: '0.00',
      })
      expect(split.get(second.id)).toEqual({
        SERVICE: '0.00',
        TERMINATION_PENALTY: '8000.00',
        OTHER: '0.00',
      })
      expect(split.has(voided.id)).toBe(false)
    })

    it('lo que no alcanza a ningún cargo vigente cae en OTHER', () => {
      const paid = payment({ chargesApplied: '500.00' })
      const split = InstallmentPolicy.chargesAppliedByConcept({
        charges: [charge({ voidedAt: at('2026-10-20') })],
        payments: [paid],
      })
      expect(split.get(paid.id)).toEqual({
        SERVICE: '0.00',
        TERMINATION_PENALTY: '0.00',
        OTHER: '500.00',
      })
    })
  })
})
