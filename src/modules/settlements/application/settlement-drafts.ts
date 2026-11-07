import { Injectable } from '@nestjs/common'

import {
  BillingFacade,
  ChargeConcept,
  SettleablePayment,
} from '@/modules/billing/public'
import { ContractRef } from '@/modules/contracts/public'
import { PendingExpenseRef, ServicesFacade } from '@/modules/services/public'
import { Period, todayIso } from '@/shared/dates/calendar-date'
import { createLogger } from '@/shared/logging/root-logger'
import { addMoney, toMoneyString } from '@/shared/money'
import {
  CollectedPayment,
  Currency,
  FeeMode,
  PendingExpense,
  Settlement,
} from '../domain/settlement'
import {
  SettlementDraftExistsException,
  SettlementNotPendingException,
  SettlementNothingToSettleException,
} from '../domain/settlement.exceptions'
import { SettlementRepository } from '../domain/settlement.ports'
import {
  SettlementComputation,
  SettlementPolicy,
} from '../domain/settlement.policy'
import { SettlementReferences } from './settlement-references'

function toCollected(payment: SettleablePayment): CollectedPayment {
  const charges = payment.chargesApplied
  return {
    paymentId: payment.paymentId,
    installmentId: payment.installmentId,
    installmentPeriod: payment.installment.period,
    paidAt: payment.paidAt,
    rentApplied: payment.rentApplied,
    lateFeeApplied: payment.lateFeeApplied,
    // TERMINATION_PENALTY y OTHER van al propietario; SERVICE no (A-16).
    ownerChargesApplied: toMoneyString(
      addMoney(
        charges[ChargeConcept.TERMINATION_PENALTY],
        charges[ChargeConcept.OTHER],
      ),
    ),
    serviceChargesApplied: charges[ChargeConcept.SERVICE],
    terms: {
      feeMode: FeeMode[payment.installment.feeMode],
      feePercentage: payment.installment.feePercentage,
      feeAmount: payment.installment.feeAmount,
      baseAmount: payment.installment.baseAmount,
    },
  }
}

function toPending(expense: PendingExpenseRef): PendingExpense {
  return {
    expenseId: expense.id,
    description: expense.description,
    expenseDate: expense.expenseDate,
    amount: expense.amount,
    currency: Currency[expense.currency],
  }
}

/**
 * Arma, crea y recalcula liquidaciones pendientes (4.1): toma de cobros los
 * pagos liquidables, de servicios los gastos adelantados pendientes y del
 * propietario qué entra en la base del honorario, y deja los números a
 * `SettlementPolicy`. Lo usan el endpoint de alta, el de recálculo y los
 * listeners de la cola.
 */
@Injectable()
export class SettlementDrafts {
  private readonly logger = createLogger('SettlementDrafts')

  constructor(
    private readonly references: SettlementReferences,
    private readonly settlements: SettlementRepository,
    private readonly billing: BillingFacade,
    private readonly services: ServicesFacade,
  ) {}

  /** Lo que la liquidación de este contrato incluiría hoy. */
  async compute(contract: ContractRef): Promise<SettlementComputation> {
    const [payments, expenses, rules] = await Promise.all([
      this.billing.listSettleablePayments(contract.id),
      this.services.pendingExpensesByContract(contract.id),
      this.references.feeRules(contract.ownerId),
    ])
    return SettlementPolicy.compute(
      payments.map(toCollected),
      expenses.items.map(toPending),
      Currency[contract.currency],
      rules,
      {
        feeMode: FeeMode[contract.billingTerms.feeMode],
        feePercentage: contract.billingTerms.feePercentage,
      },
    )
  }

  /**
   * `POST /settlements`: una sola pendiente por contrato (409
   * `SETTLEMENT_DRAFT_EXISTS`); sin pagos ni gastos no hay nada que liquidar
   * (409 `SETTLEMENT_NOTHING_TO_SETTLE`).
   */
  async create(contract: ContractRef, period: Period): Promise<Settlement> {
    const existing = await this.settlements.findPendingByContract(contract.id)
    if (existing) throw new SettlementDraftExistsException(existing.id)
    const computed = await this.compute(contract)
    if (computed.payments.length === 0 && computed.expenses.length === 0) {
      throw new SettlementNothingToSettleException(contract.id)
    }
    return this.persist(contract, period, computed)
  }

  /** `POST /settlements/:id/recalculate`: vuelve a tomar pagos y gastos; los ajustes quedan. */
  async recalculate(snapshot: Settlement): Promise<Settlement> {
    SettlementPolicy.assertPending(snapshot)
    // Lock y relectura dentro de la transacción del llamador. Antes un
    // recálculo que leyó "pendiente" podía reescribir líneas y totales de una
    // liquidación que otro request acababa de confirmar (C4).
    if (!(await this.settlements.lockPending(snapshot.id))) {
      const current = await this.settlements.findById(snapshot.id)
      throw new SettlementNotPendingException(
        snapshot.id,
        current?.status ?? 'UNKNOWN',
      )
    }
    const settlement =
      (await this.settlements.findById(snapshot.id)) ?? snapshot
    const contract = await this.references.requireContract(
      settlement.contractId,
    )
    const computed = await this.compute(contract)
    const {
      payments,
      expenses,
      skippedExpenses: _skipped,
      ...totals
    } = computed
    const adjustmentsTotal = SettlementPolicy.adjustmentsTotal(
      settlement.adjustments,
    )
    await this.settlements.replaceLines(
      settlement.id,
      payments.map(toPaymentLine),
      expenses.map(toExpenseLine),
    )
    return this.settlements.update(settlement.id, {
      ...totals,
      adjustmentsTotal,
      netAmount: SettlementPolicy.net(totals, adjustmentsTotal),
    })
  }

  /**
   * Listener de `installment-paid` (4.1, automático): recalcula la pendiente
   * del contrato o crea una si hay pagos cobrados por la inmobiliaria. Con
   * modalidad OWNER_DIRECT y sin pagos AGENCY no crea nada. Idempotente.
   */
  async ensureDraft(contractId: string): Promise<Settlement | null> {
    const contract = await this.contractOrNull(contractId)
    if (!contract) return null
    const existing = await this.settlements.findPendingByContract(contract.id)
    if (existing) {
      try {
        return await this.recalculate(existing)
      } catch (error) {
        // Se confirmó (o canceló) mientras tanto: el pago nuevo va a una
        // pendiente nueva, como si no hubiera habido ninguna.
        if (!(error instanceof SettlementNotPendingException)) throw error
      }
    }
    const computed = await this.compute(contract)
    if (computed.payments.length === 0) return null
    return this.persist(
      contract,
      SettlementPolicy.normalizePeriod(null, todayIso()),
      computed,
    )
  }

  /**
   * La pendiente del contrato, creada vacía si no existe: ahí cae el ajuste
   * por un pago anulado después de confirmar (4.6, A-19).
   */
  async draftForAdjustment(contractId: string): Promise<Settlement | null> {
    const contract = await this.contractOrNull(contractId)
    if (!contract) return null
    const existing = await this.settlements.findPendingByContract(contract.id)
    if (existing) return existing
    return this.persist(
      contract,
      SettlementPolicy.normalizePeriod(null, todayIso()),
      await this.compute(contract),
    )
  }

  private async contractOrNull(
    contractId: string,
  ): Promise<ContractRef | null> {
    try {
      return await this.references.requireContract(contractId)
    } catch {
      this.logger.warn(
        { contractId },
        'Llegó un evento de un contrato que no existe: se ignora',
      )
      return null
    }
  }

  private async persist(
    contract: ContractRef,
    period: Period,
    computed: SettlementComputation,
  ): Promise<Settlement> {
    const {
      payments,
      expenses,
      skippedExpenses: _skipped,
      ...totals
    } = computed
    const sequence = SettlementPolicy.nextSequence(
      await this.settlements.maxSequence(contract.id, period),
    )
    const adjustmentsTotal = toMoneyString('0')
    return this.settlements.create({
      contractId: contract.id,
      propertyId: contract.propertyId,
      ownerId: contract.ownerId,
      renterId: contract.renterId,
      currency: Currency[contract.currency],
      period,
      sequence,
      ...totals,
      adjustmentsTotal,
      netAmount: SettlementPolicy.net(totals, adjustmentsTotal),
      payments: payments.map(toPaymentLine),
      expenses: expenses.map(toExpenseLine),
    })
  }
}

function toPaymentLine(payment: CollectedPayment) {
  return {
    paymentId: payment.paymentId,
    installmentId: payment.installmentId,
    installmentPeriod: payment.installmentPeriod,
    paidAt: payment.paidAt,
    rentApplied: payment.rentApplied,
    lateFeeApplied: payment.lateFeeApplied,
    ownerChargesApplied: payment.ownerChargesApplied,
    serviceChargesApplied: payment.serviceChargesApplied,
  }
}

function toExpenseLine(expense: PendingExpense) {
  return {
    expenseId: expense.expenseId,
    description: expense.description,
    expenseDate: expense.expenseDate,
    amount: expense.amount,
  }
}
