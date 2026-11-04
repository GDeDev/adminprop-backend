import { ContractRef, DepositReturnMode } from '@/modules/contracts/public'
import {
  firstDayOfPeriod,
  IsoDate,
  localDateOf,
  Period,
} from '@/shared/dates/calendar-date'
import {
  compareMoney,
  subtractMoney,
  sumMoney,
  toMoneyString,
} from '@/shared/money'
import {
  CollectionMode,
  CreditStatus,
  Currency,
  DepositReturn,
  FeeMode,
  Installment,
  InstallmentStatus,
  LateFeeAdjustmentKind,
  PaymentKind,
  PaymentReceiver,
  PaymentStatus,
  RenterCredit,
} from '../domain/billing'
import { InstallmentPolicy } from '../domain/installment.policy'
import { AccountMovementType } from './account-movement-type'
import { DepositReturnView } from './deposit-return.views'

export { AccountMovementType }

export interface ContractAccountMovementView {
  date: IsoDate
  type: AccountMovementType
  description: string
  /** Lo que el inquilino debe por este movimiento. */
  debit: string | null
  /** Lo que el inquilino pagó o se le reconoció. */
  credit: string | null
  /**
   * Importe informativo de los movimientos del depósito (recibido,
   * devuelto, deducción), en `amountCurrency`. No entra en el saldo: el
   * depósito no es deuda ni pago de alquiler.
   */
  amount: string | null
  amountCurrency: Currency | null
  /** Saldo acumulado después del movimiento (deuda positiva). */
  balance: string
  installmentId: string | null
  paymentId: string | null
}

export interface ContractAccountInstallmentView {
  id: string
  period: Period
  baseAmount: string
  chargesTotal: string
  lateFeeAccrued: string
  lateFeeBalance: string
  paidTotal: string
  totalDue: string
  status: InstallmentStatus
  graceEndDate: IsoDate
  paidAt: IsoDate | null
}

export interface ContractAccountTotalsView {
  accrued: string
  chargesTotal: string
  lateFeeAccrued: string
  lateFeeAdjusted: string
  collected: string
  collectedByAgency: string
  collectedByOwner: string
  pendingConfirmation: string
  balance: string
  creditsAvailable: string
  feeAccruedOnBase: string
  feeAccruedOnCollected: string
}

export interface ContractAccountDepositView {
  amount: string
  currency: Currency
  returnMode: DepositReturnMode
  /** FIXED: el depósito; FOLLOWS_RENT: el alquiler vigente; MANUAL: null (A-13). */
  suggestedReturn: string | null
  /** La devolución registrada (Fase 12), si ya se hizo. */
  returned: DepositReturnView | null
}

/** Cuenta corriente del contrato (Micaela #8). */
export interface ContractAccountView {
  contract: {
    id: string
    currency: Currency
    collectionMode: CollectionMode
    feeMode: FeeMode
    depositReturnMode: DepositReturnMode
  }
  totals: ContractAccountTotalsView
  /** Más viejas primero. */
  installments: ContractAccountInstallmentView[]
  /** Cronológico ascendente. */
  movements: ContractAccountMovementView[]
  deposit: ContractAccountDepositView
}

type Draft = Omit<
  ContractAccountMovementView,
  'balance' | 'amount' | 'amountCurrency'
> & {
  order: number
  amount?: string
  amountCurrency?: Currency
}

const PERIOD_LABEL = (period: Period) => `Cuota ${period}`

/** Pura: arma la cuenta corriente a partir de las cuotas y los créditos del contrato. */
export function buildContractAccount(
  contract: ContractRef,
  installments: Installment[],
  credits: RenterCredit[],
  today: IsoDate,
  depositReturn: {
    record: DepositReturn
    view: DepositReturnView
  } | null = null,
): ContractAccountView {
  const rows = [...installments]
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((installment) => ({
      installment,
      balances: InstallmentPolicy.balances(installment, today),
      fees: InstallmentPolicy.feeAccrual(installment),
    }))
  const drafts: Draft[] = []

  drafts.push({
    date: contract.startDate,
    type: AccountMovementType.DEPOSIT_RECEIVED,
    description: `Depósito recibido: ${contract.deposit} ${contract.depositCurrency}`,
    amount: contract.deposit,
    amountCurrency: Currency[contract.depositCurrency],
    debit: null,
    credit: null,
    installmentId: null,
    paymentId: null,
    order: 0,
  })

  for (const { installment, balances } of rows) {
    drafts.push({
      date: firstDayOfPeriod(installment.period),
      type: AccountMovementType.INSTALLMENT,
      description: `${PERIOD_LABEL(installment.period)}: alquiler`,
      debit: balances.baseAmount,
      credit: null,
      installmentId: installment.id,
      paymentId: null,
      order: 1,
    })
    for (const charge of installment.charges) {
      if (charge.voidedAt !== null) continue
      drafts.push({
        date: localDateOf(charge.createdAt),
        type: AccountMovementType.CHARGE,
        description: `${PERIOD_LABEL(installment.period)}: ${charge.description}`,
        debit: charge.amount,
        credit: null,
        installmentId: installment.id,
        paymentId: null,
        order: 2,
      })
    }
    if (compareMoney(balances.lateFeeAccrued, '0') > 0) {
      const lastDay = balances.days[balances.days.length - 1]
      drafts.push({
        date: lastDay.day,
        type: AccountMovementType.LATE_FEE_ACCRUED,
        description: `${PERIOD_LABEL(installment.period)}: punitorio por ${balances.feeDays} días`,
        debit: balances.lateFeeAccrued,
        credit: null,
        installmentId: installment.id,
        paymentId: null,
        order: 3,
      })
    }
    for (const adjustment of installment.adjustments) {
      const reduce = adjustment.kind === LateFeeAdjustmentKind.REDUCE
      drafts.push({
        date: localDateOf(adjustment.createdAt),
        type: AccountMovementType.LATE_FEE_ADJUSTMENT,
        description: `${PERIOD_LABEL(installment.period)}: ${
          reduce ? 'reducción' : 'condonación'
        } del punitorio (${adjustment.reason})`,
        debit: null,
        credit: reduce ? adjustment.amount : null,
        installmentId: installment.id,
        paymentId: null,
        order: 4,
      })
    }
    for (const payment of installment.payments) {
      const applied = sumMoney([
        payment.lateFeeApplied,
        payment.rentApplied,
        payment.chargesApplied,
      ])
      const credit = payment.kind === PaymentKind.CREDIT_APPLICATION
      drafts.push({
        date: payment.paidAt,
        type: credit
          ? AccountMovementType.CREDIT_APPLIED
          : AccountMovementType.PAYMENT,
        description: credit
          ? `${PERIOD_LABEL(installment.period)}: saldo a favor aplicado`
          : `${PERIOD_LABEL(installment.period)}: pago ${
              payment.receivedBy === PaymentReceiver.OWNER
                ? 'al propietario'
                : 'a la inmobiliaria'
            }${
              payment.status === PaymentStatus.PENDING_CONFIRMATION
                ? ' (sin confirmar)'
                : ''
            }`,
        debit: null,
        credit: payment.amountInContractCurrency,
        installmentId: installment.id,
        paymentId: payment.id,
        order: 5,
      })
      if (compareMoney(payment.creditGenerated, '0') > 0) {
        drafts.push({
          date: payment.paidAt,
          type: AccountMovementType.CREDIT_GENERATED,
          description: `${PERIOD_LABEL(installment.period)}: exceso pasa a saldo a favor`,
          debit: payment.creditGenerated,
          credit: null,
          installmentId: installment.id,
          paymentId: payment.id,
          order: 6,
        })
      }
      if (payment.status === PaymentStatus.VOIDED && payment.voidedAt) {
        drafts.push({
          date: localDateOf(payment.voidedAt),
          type: AccountMovementType.PAYMENT_VOIDED,
          description: `${PERIOD_LABEL(installment.period)}: pago anulado (${payment.voidReason ?? ''})`,
          debit: applied,
          credit: null,
          installmentId: installment.id,
          paymentId: payment.id,
          order: 7,
        })
      }
    }
  }
  if (depositReturn) {
    const ret = depositReturn.record
    // Informativos (sin débito ni crédito): la deuda cubierta con el
    // depósito ya aparece como PAYMENT con `method: DEPOSIT`; lo demás
    // (daños, otros) no es deuda del inquilino en la cuenta del contrato.
    drafts.push({
      date: ret.returnedAt,
      type: AccountMovementType.DEPOSIT_RETURNED,
      description: `Depósito devuelto: ${ret.returnedAmount} ${ret.depositCurrency} de ${ret.referenceAmount} a devolver (recibido: ${ret.depositAmount})`,
      amount: ret.returnedAmount,
      amountCurrency: ret.depositCurrency,
      debit: null,
      credit: null,
      installmentId: null,
      paymentId: null,
      order: 9,
    })
    for (const deduction of ret.deductions) {
      drafts.push({
        date: ret.returnedAt,
        type: AccountMovementType.DEPOSIT_DEDUCTION,
        description: `Deducción del depósito (${deduction.concept}): ${deduction.description} — ${deduction.amount} ${ret.depositCurrency}`,
        amount: deduction.amount,
        amountCurrency: ret.depositCurrency,
        debit: null,
        credit: null,
        installmentId: deduction.installmentId,
        paymentId: deduction.paymentId,
        order: 10,
      })
    }
  }
  for (const credit of credits) {
    if (credit.status === CreditStatus.REFUNDED && credit.refundedAt) {
      drafts.push({
        date: credit.refundedAt,
        type: AccountMovementType.CREDIT_REFUNDED,
        description: `Saldo a favor devuelto: ${credit.amount} ${credit.currency}`,
        debit: null,
        credit: null,
        installmentId: null,
        paymentId: null,
        order: 8,
      })
    }
  }

  drafts.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)
  let running = toMoneyString('0')
  const movements = drafts.map(({ order: _order, ...draft }) => {
    running = toMoneyString(
      subtractMoney(
        sumMoney([running, draft.debit ?? '0']),
        draft.credit ?? '0',
      ),
    )
    return {
      ...draft,
      amount: draft.amount ?? null,
      amountCurrency: draft.amountCurrency ?? null,
      balance: running,
    }
  })

  const collectedBy = (receiver: PaymentReceiver) =>
    sumMoney(
      installments.flatMap((i) =>
        i.payments
          .filter(
            (p) =>
              p.status !== PaymentStatus.VOIDED &&
              p.kind === PaymentKind.CASH_IN &&
              p.receivedBy === receiver,
          )
          .map((p) =>
            sumMoney([p.lateFeeApplied, p.rentApplied, p.chargesApplied]),
          ),
      ),
    )

  return {
    contract: {
      id: contract.id,
      currency: Currency[contract.currency],
      collectionMode: CollectionMode[contract.billingTerms.collectionMode],
      feeMode: FeeMode[contract.billingTerms.feeMode],
      depositReturnMode: contract.depositReturnMode,
    },
    totals: {
      accrued: sumMoney(rows.map((r) => r.balances.baseAmount)),
      chargesTotal: sumMoney(rows.map((r) => r.balances.chargesTotal)),
      lateFeeAccrued: sumMoney(rows.map((r) => r.balances.lateFeeAccrued)),
      lateFeeAdjusted: sumMoney(rows.map((r) => r.balances.lateFeeAdjusted)),
      collected: sumMoney(rows.map((r) => r.balances.paidTotal)),
      collectedByAgency: collectedBy(PaymentReceiver.AGENCY),
      collectedByOwner: collectedBy(PaymentReceiver.OWNER),
      pendingConfirmation: sumMoney(
        rows.map((r) => r.balances.pendingConfirmationTotal),
      ),
      balance: sumMoney(rows.map((r) => r.balances.totalDue)),
      creditsAvailable: sumMoney(
        credits
          .filter(
            (c) =>
              c.status === CreditStatus.AVAILABLE &&
              c.currency === Currency[contract.currency],
          )
          .map((c) => c.remaining),
      ),
      feeAccruedOnBase: sumMoney(rows.map((r) => r.fees.feeOnBase)),
      feeAccruedOnCollected: sumMoney(rows.map((r) => r.fees.feeOnCollected)),
    },
    installments: rows.map(({ installment, balances }) => ({
      id: installment.id,
      period: installment.period,
      baseAmount: balances.baseAmount,
      chargesTotal: balances.chargesTotal,
      lateFeeAccrued: balances.lateFeeAccrued,
      lateFeeBalance: balances.lateFeeBalance,
      paidTotal: balances.paidTotal,
      totalDue: balances.totalDue,
      status: InstallmentPolicy.displayStatus(installment, balances, today),
      graceEndDate: installment.graceEndDate,
      paidAt: installment.paidAt,
    })),
    movements,
    deposit: {
      amount: contract.deposit,
      currency: Currency[contract.depositCurrency],
      returnMode: contract.depositReturnMode,
      suggestedReturn: suggestedDepositReturn(contract),
      returned: depositReturn?.view ?? null,
    },
  }
}

/** Monto de referencia que sugiere el modo (D-226); `null` si hay que indicarlo a mano. */
export function suggestedDepositReturn(contract: ContractRef): string | null {
  switch (contract.depositReturnMode) {
    case DepositReturnMode.FIXED:
      return contract.deposit
    case DepositReturnMode.FOLLOWS_RENT:
      // Sin cotización en la devolución: en otra moneda no se sugiere nada.
      return contract.currency === contract.depositCurrency
        ? contract.currentRent
        : null
    default:
      return null
  }
}
