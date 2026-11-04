import {
  CollectionMode as ContractCollectionMode,
  ContractRef,
  ContractStatus,
  Currency as ContractCurrency,
  DepositReturnMode,
  FeeMode as ContractFeeMode,
} from '@/modules/contracts/public'
import {
  CreditStatus,
  Currency,
  DepositDeductionConcept,
  DepositReturn,
  InstallmentStatus,
  LateFeeAdjustmentKind,
  PaymentKind,
  PaymentMethod,
  PaymentReceiver,
  PaymentStatus,
} from '../domain/billing'
import {
  at,
  makeAdjustment,
  makeCharge,
  makeCredit,
  makeInstallment,
  makePayment,
} from '../testing/billing.fixtures'
import {
  AccountMovementType,
  buildContractAccount,
  suggestedDepositReturn,
} from './contract-account.views'
import { DepositReturnView } from './deposit-return.views'

const TODAY = '2026-10-20'

function contract(overrides: Partial<ContractRef> = {}): ContractRef {
  return {
    id: 'contract-1',
    propertyId: 'property-1',
    ownerId: 'owner-1',
    renterId: 'renter-1',
    status: ContractStatus.ACTIVE,
    currency: ContractCurrency.ARS,
    startDate: '2026-09-01',
    endDate: '2028-08-31',
    currentRent: '200000.00',
    deposit: '200000.00',
    depositCurrency: ContractCurrency.ARS,
    depositReturnMode: DepositReturnMode.FIXED,
    billingTerms: {
      id: 'terms-1',
      effectiveFrom: '2026-09-01',
      collectionMode: ContractCollectionMode.AGENCY,
      feeMode: ContractFeeMode.DEDUCTED,
      feePercentage: '5.00',
      feeAmount: null,
      lateFeePercentage: '5.00',
      lateFeeGraceDays: 10,
      inheritedLateFeePercentage: false,
      inheritedLateFeeGraceDays: false,
      notes: null,
      changedById: null,
      createdAt: at('2026-09-01'),
    },
    ...overrides,
  }
}

const types = (account: ReturnType<typeof buildContractAccount>) =>
  account.movements.map((m) => m.type)

describe('buildContractAccount', () => {
  describe('cuota saldada con cargo y punitorio', () => {
    // Alquiler 200.000 + cargo 30.000 + 5 días de punitorio (10.000 por día)
    // = 280.000, pagados completos el 15.
    const paid = makeInstallment({
      status: InstallmentStatus.PAID,
      paidAt: '2026-10-15',
      charges: [makeCharge({ amount: '30000.00' })],
      payments: [
        makePayment({
          paidAt: '2026-10-15',
          rentApplied: '200000.00',
          lateFeeApplied: '50000.00',
          chargesApplied: '30000.00',
        }),
      ],
    })

    it('ordena los movimientos por fecha y el saldo corrido cierra en cero', () => {
      const account = buildContractAccount(contract(), [paid], [], TODAY)
      expect(types(account)).toEqual([
        AccountMovementType.DEPOSIT_RECEIVED,
        AccountMovementType.INSTALLMENT,
        AccountMovementType.CHARGE,
        AccountMovementType.LATE_FEE_ACCRUED,
        AccountMovementType.PAYMENT,
      ])
      expect(account.movements.map((m) => m.balance)).toEqual([
        '0.00',
        '200000.00',
        '230000.00',
        '280000.00',
        '0.00',
      ])
      expect(account.totals.balance).toBe('0.00')
    })

    it('el depósito recibido es informativo: ni debe ni haber', () => {
      const [deposit] = buildContractAccount(
        contract(),
        [],
        [],
        TODAY,
      ).movements
      expect(deposit).toMatchObject({
        type: AccountMovementType.DEPOSIT_RECEIVED,
        date: '2026-09-01',
        debit: null,
        credit: null,
        balance: '0.00',
      })
    })

    it('los totales suman devengado, cargos, punitorio y cobrado', () => {
      const { totals, installments } = buildContractAccount(
        contract(),
        [paid],
        [],
        TODAY,
      )
      expect(totals).toMatchObject({
        accrued: '200000.00',
        chargesTotal: '30000.00',
        lateFeeAccrued: '50000.00',
        lateFeeAdjusted: '0.00',
        collected: '280000.00',
        collectedByAgency: '280000.00',
        collectedByOwner: '0.00',
        pendingConfirmation: '0.00',
        creditsAvailable: '0.00',
      })
      expect(installments[0]).toMatchObject({
        status: InstallmentStatus.PAID,
        totalDue: '0.00',
        paidTotal: '280000.00',
      })
    })

    it('el depósito sugerido sigue el modo de devolución', () => {
      const { deposit } = buildContractAccount(contract(), [paid], [], TODAY)
      expect(deposit).toMatchObject({
        amount: '200000.00',
        currency: Currency.ARS,
        returnMode: DepositReturnMode.FIXED,
        suggestedReturn: '200000.00',
        returned: null,
      })
    })
  })

  describe('cuota impaga', () => {
    it('suma el punitorio devengado a la deuda y el saldo corrido coincide con el total', () => {
      const unpaid = makeInstallment()
      const account = buildContractAccount(
        contract(),
        [unpaid],
        [],
        '2026-10-15',
      )
      const last = account.movements[account.movements.length - 1]
      expect(last.type).toBe(AccountMovementType.LATE_FEE_ACCRUED)
      expect(last.description).toContain('punitorio por 5 días')
      expect(last.balance).toBe('250000.00')
      expect(account.totals.balance).toBe('250000.00')
      expect(account.installments[0].status).toBe(InstallmentStatus.OVERDUE)
    })

    it('dentro de la gracia no devenga punitorio', () => {
      const account = buildContractAccount(
        contract(),
        [makeInstallment()],
        [],
        '2026-10-10',
      )
      expect(types(account)).not.toContain(AccountMovementType.LATE_FEE_ACCRUED)
      expect(account.totals.balance).toBe('200000.00')
    })

    it('una reducción de punitorio es un crédito y baja el saldo', () => {
      const reduced = makeInstallment({
        adjustments: [
          makeAdjustment({
            kind: LateFeeAdjustmentKind.REDUCE,
            amount: '10000.00',
            createdAt: at('2026-10-12'),
          }),
        ],
      })
      const account = buildContractAccount(
        contract(),
        [reduced],
        [],
        '2026-10-15',
      )
      const adjustment = account.movements.find(
        (m) => m.type === AccountMovementType.LATE_FEE_ADJUSTMENT,
      )
      expect(adjustment).toMatchObject({ credit: '10000.00', debit: null })
      expect(adjustment?.description).toContain('reducción')
      expect(account.totals.lateFeeAdjusted).toBe('10000.00')
      // 200.000 + 50.000 − 10.000.
      expect(account.totals.balance).toBe('240000.00')
      expect(account.movements[account.movements.length - 1].balance).toBe(
        '240000.00',
      )
    })

    it('la condonación no devenga punitorio y su movimiento no suma ni resta', () => {
      const waived = makeInstallment({
        lateFeeWaived: true,
        adjustments: [
          makeAdjustment({
            kind: LateFeeAdjustmentKind.WAIVE,
            amount: '50000.00',
          }),
        ],
      })
      const account = buildContractAccount(
        contract(),
        [waived],
        [],
        '2026-10-20',
      )
      expect(types(account)).not.toContain(AccountMovementType.LATE_FEE_ACCRUED)
      const adjustment = account.movements.find(
        (m) => m.type === AccountMovementType.LATE_FEE_ADJUSTMENT,
      )
      expect(adjustment).toMatchObject({ credit: null, debit: null })
      expect(adjustment?.description).toContain('condonación')
      expect(account.totals.balance).toBe('200000.00')
    })

    it('un cargo anulado no figura ni suma', () => {
      const withVoided = makeInstallment({
        graceEndDate: '2026-10-31',
        charges: [
          makeCharge({ amount: '1000.00' }),
          makeCharge({
            amount: '9999.00',
            voidedAt: at('2026-10-03'),
            voidReason: 'error',
          }),
        ],
      })
      const account = buildContractAccount(
        contract(),
        [withVoided],
        [],
        '2026-10-05',
      )
      expect(
        account.movements.filter((m) => m.type === AccountMovementType.CHARGE),
      ).toHaveLength(1)
      expect(account.totals.balance).toBe('201000.00')
    })
  })

  describe('pagos', () => {
    it('distingue quién cobró y marca el pago sin confirmar', () => {
      const installment = makeInstallment({
        graceEndDate: '2026-10-31',
        status: InstallmentStatus.PARTIAL,
        payments: [
          makePayment({
            paidAt: '2026-10-05',
            rentApplied: '50000.00',
            receivedBy: PaymentReceiver.OWNER,
          }),
          makePayment({
            paidAt: '2026-10-06',
            rentApplied: '30000.00',
            status: PaymentStatus.PENDING_CONFIRMATION,
          }),
        ],
      })
      const account = buildContractAccount(
        contract(),
        [installment],
        [],
        '2026-10-07',
      )
      const payments = account.movements.filter(
        (m) => m.type === AccountMovementType.PAYMENT,
      )
      expect(payments.map((p) => p.description)).toEqual([
        'Cuota 2026-10: pago al propietario',
        'Cuota 2026-10: pago a la inmobiliaria (sin confirmar)',
      ])
      expect(account.totals).toMatchObject({
        collected: '80000.00',
        collectedByOwner: '50000.00',
        collectedByAgency: '30000.00',
        pendingConfirmation: '30000.00',
        balance: '120000.00',
      })
    })

    it('un pago anulado revierte el crédito con un débito y la deuda vuelve', () => {
      const voided = makeInstallment({
        payments: [
          makePayment({
            paidAt: '2026-10-15',
            rentApplied: '200000.00',
            status: PaymentStatus.VOIDED,
            voidedAt: at('2026-10-16'),
            voidReason: 'Transferencia rechazada',
          }),
        ],
      })
      const account = buildContractAccount(contract(), [voided], [], TODAY)
      expect(types(account)).toEqual([
        AccountMovementType.DEPOSIT_RECEIVED,
        AccountMovementType.INSTALLMENT,
        AccountMovementType.PAYMENT,
        AccountMovementType.PAYMENT_VOIDED,
        AccountMovementType.LATE_FEE_ACCRUED,
      ])
      const reversal = account.movements[3]
      expect(reversal.debit).toBe('200000.00')
      expect(reversal.description).toContain('Transferencia rechazada')
      expect(reversal.balance).toBe('200000.00')
      // 200.000 de alquiler + 10 días de punitorio (11 al 20) sobre 200.000.
      expect(account.totals.balance).toBe('300000.00')
      expect(account.movements[account.movements.length - 1].balance).toBe(
        '300000.00',
      )
      expect(account.totals.collected).toBe('0.00')
    })

    it('el exceso de un pago se informa como saldo a favor generado', () => {
      const installment = makeInstallment({
        graceEndDate: '2026-10-31',
        status: InstallmentStatus.PAID,
        paidAt: '2026-10-05',
        payments: [
          makePayment({
            paidAt: '2026-10-05',
            rentApplied: '200000.00',
            amount: '205000.00',
            amountInContractCurrency: '205000.00',
            creditGenerated: '5000.00',
          }),
        ],
      })
      const account = buildContractAccount(contract(), [installment], [], TODAY)
      const generated = account.movements.find(
        (m) => m.type === AccountMovementType.CREDIT_GENERATED,
      )
      expect(generated).toMatchObject({ debit: '5000.00', credit: null })
      // El pago acredita 205.000, pero el exceso se debita como saldo a favor
      // generado: la cuenta del contrato queda en cero y el excedente vive
      // en el crédito del inquilino.
      expect(account.movements[account.movements.length - 1].balance).toBe(
        '0.00',
      )
      expect(account.totals.balance).toBe('0.00')
    })

    it('aplicar un saldo a favor figura como CREDIT_APPLIED', () => {
      const installment = makeInstallment({
        graceEndDate: '2026-10-31',
        payments: [
          makePayment({
            paidAt: '2026-10-05',
            rentApplied: '5000.00',
            kind: PaymentKind.CREDIT_APPLICATION,
            method: PaymentMethod.CREDIT,
          }),
        ],
      })
      const account = buildContractAccount(
        contract(),
        [installment],
        [],
        '2026-10-06',
      )
      expect(types(account)).toContain(AccountMovementType.CREDIT_APPLIED)
      expect(account.totals.collectedByAgency).toBe('0.00')
      expect(account.totals.balance).toBe('195000.00')
    })
  })

  describe('saldos a favor y depósito', () => {
    it('los créditos disponibles se suman sólo en la moneda del contrato', () => {
      const account = buildContractAccount(
        contract(),
        [],
        [
          makeCredit({ remaining: '100.10' }),
          makeCredit({ remaining: '0.20' }),
          makeCredit({ remaining: '77.00', currency: Currency.USD }),
          makeCredit({ remaining: '500.00', status: CreditStatus.APPLIED }),
        ],
        TODAY,
      )
      expect(account.totals.creditsAvailable).toBe('100.30')
    })

    it('un saldo devuelto aparece como movimiento informativo en su fecha', () => {
      const account = buildContractAccount(
        contract(),
        [],
        [
          makeCredit({
            status: CreditStatus.REFUNDED,
            refundedAt: '2026-10-10',
            amount: '3000.00',
            remaining: '0.00',
          }),
        ],
        TODAY,
      )
      const refund = account.movements.find(
        (m) => m.type === AccountMovementType.CREDIT_REFUNDED,
      )
      expect(refund).toMatchObject({
        date: '2026-10-10',
        debit: null,
        credit: null,
      })
      expect(refund?.description).toBe('Saldo a favor devuelto: 3000.00 ARS')
    })

    it('la devolución del depósito y sus deducciones son informativas', () => {
      const record: DepositReturn = {
        id: 'ret-1',
        contractId: 'contract-1',
        returnedAt: '2028-09-05',
        depositAmount: '200000.00',
        depositCurrency: Currency.ARS,
        returnedAmount: '150000.00',
        method: PaymentMethod.TRANSFER,
        notes: null,
        registeredById: 'user-1',
        deductions: [
          {
            id: 'ded-1',
            concept: DepositDeductionConcept.DAMAGE,
            description: 'Pintura',
            amount: '50000.00',
            installmentId: null,
            paymentId: null,
          },
        ],
        createdAt: at('2028-09-05'),
      }
      const view = { id: 'ret-1' } as DepositReturnView
      const account = buildContractAccount(contract(), [], [], TODAY, {
        record,
        view,
      })
      const returned = account.movements.find(
        (m) => m.type === AccountMovementType.DEPOSIT_RETURNED,
      )
      const deduction = account.movements.find(
        (m) => m.type === AccountMovementType.DEPOSIT_DEDUCTION,
      )
      expect(returned?.description).toBe(
        'Depósito devuelto: 150000.00 ARS de 200000.00',
      )
      expect(deduction?.description).toContain('Pintura')
      expect(returned).toMatchObject({ debit: null, credit: null })
      expect(deduction).toMatchObject({ debit: null, credit: null })
      expect(account.totals.balance).toBe('0.00')
      expect(account.deposit.returned).toBe(view)
    })
  })

  describe('suggestedDepositReturn (A-13)', () => {
    it('FIXED devuelve lo recibido, FOLLOWS_RENT el alquiler vigente y MANUAL nada', () => {
      const base = contract({ deposit: '150000.00', currentRent: '230000.00' })
      expect(
        suggestedDepositReturn({
          ...base,
          depositReturnMode: DepositReturnMode.FIXED,
        }),
      ).toBe('150000.00')
      expect(
        suggestedDepositReturn({
          ...base,
          depositReturnMode: DepositReturnMode.FOLLOWS_RENT,
        }),
      ).toBe('230000.00')
      expect(
        suggestedDepositReturn({
          ...base,
          depositReturnMode: DepositReturnMode.MANUAL,
        }),
      ).toBeNull()
    })
  })

  it('las cuotas salen ordenadas por período aunque lleguen desordenadas', () => {
    const november = makeInstallment({
      id: 'inst-nov',
      period: '2026-11',
      graceEndDate: '2026-11-10',
    })
    const october = makeInstallment()
    const account = buildContractAccount(
      contract(),
      [november, october],
      [],
      '2026-10-05',
    )
    expect(account.installments.map((i) => i.period)).toEqual([
      '2026-10',
      '2026-11',
    ])
  })

  it('expone los términos de cobro del contrato', () => {
    const account = buildContractAccount(contract(), [], [], TODAY)
    expect(account.contract).toEqual({
      id: 'contract-1',
      currency: Currency.ARS,
      collectionMode: 'AGENCY',
      feeMode: 'DEDUCTED',
      depositReturnMode: DepositReturnMode.FIXED,
    })
  })
})
