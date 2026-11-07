import { Injectable } from '@nestjs/common'

import { UserRef, UsersFacade } from '@/modules/auth/public'
import { ContractsFacade } from '@/modules/contracts/public'
import { OwnerRef, OwnersFacade } from '@/modules/owners/public'
import { PropertiesFacade, PropertyRef } from '@/modules/properties/public'
import { IsoDate, Period } from '@/shared/dates/calendar-date'
import { FeeAccountTotals, FeeMovement, FeePolicy } from '../domain/fee.policy'
import {
  Currency,
  FeePayer,
  FeePayment,
  FeeReceivable,
  FeeReceivableSource,
  FeeReceivableStatus,
  PaymentMethod,
} from '../domain/settlement'

export interface FeeReceivableView {
  id: string
  owner: OwnerRef | null
  contract: { id: string }
  property: PropertyRef | null
  installmentPeriod: Period
  currency: Currency
  source: FeeReceivableSource
  payer: FeePayer
  amount: string
  paidAmount: string
  status: FeeReceivableStatus
  feePercentage: string
  feeAmountFixed: string | null
  baseAmount: string
  needsReview: boolean
  createdAt: Date
}

export interface FeePaymentView {
  id: string
  ownerId: string
  contractId: string | null
  paidAt: IsoDate
  amount: string
  currency: Currency
  method: PaymentMethod
  paidBy: FeePayer
  unallocatedAmount: string
  receiptUrl: string | null
  notes: string | null
  registeredBy: UserRef | null
  voidedAt: Date | null
  voidReason: string | null
  allocations: { feeReceivableId: string; amount: string }[]
  createdAt: Date
}

/** `GET /owners/:ownerId/fee-account` (4.8). */
export interface OwnerFeeAccountView {
  ownerId: string
  totals: FeeAccountTotals[]
  /** Más nuevos primero. */
  receivables: FeeReceivableView[]
  /** Más nuevos primero. */
  payments: FeePaymentView[]
  /** Cronológicos. */
  movements: FeeMovement[]
}

export function describeReceivable(receivable: FeeReceivable): string {
  const origin =
    receivable.source === FeeReceivableSource.OWNER_DIRECT_PAYMENT
      ? 'cobro directo del propietario'
      : 'liquidación sin descuento'
  return `Honorarios ${receivable.period} (${origin})`
}

export function describeFeePayment(payment: FeePayment): string {
  const payer = payment.paidBy === FeePayer.OWNER ? 'propietario' : 'inquilino'
  return `Pago de honorarios (${payer}, ${payment.method})`
}

export function toFeePaymentView(
  payment: FeePayment,
  users: Map<string, UserRef>,
): FeePaymentView {
  return {
    id: payment.id,
    ownerId: payment.ownerId,
    contractId: payment.contractId,
    paidAt: payment.paidAt,
    amount: payment.amount,
    currency: payment.currency,
    method: payment.method,
    paidBy: payment.paidBy,
    unallocatedAmount: payment.unallocatedAmount,
    receiptUrl: payment.receiptUrl,
    notes: payment.notes,
    registeredBy: users.get(payment.registeredById) ?? null,
    voidedAt: payment.voidedAt,
    voidReason: payment.voidReason,
    allocations: payment.allocations.map((a) => ({
      feeReceivableId: a.feeReceivableId,
      amount: a.amount,
    })),
    createdAt: payment.createdAt,
  }
}

/** Arma las vistas de la cuenta de honorarios resolviendo nombres por las facades. */
@Injectable()
export class FeeViews {
  constructor(
    private readonly owners: OwnersFacade,
    private readonly contracts: ContractsFacade,
    private readonly properties: PropertiesFacade,
    private readonly users: UsersFacade,
  ) {}

  async receivables(
    receivables: FeeReceivable[],
  ): Promise<FeeReceivableView[]> {
    if (receivables.length === 0) return []
    const contractIds = [...new Set(receivables.map((r) => r.contractId))]
    const [owners, contracts] = await Promise.all([
      this.owners.describe(receivables.map((r) => r.ownerId)),
      Promise.all(contractIds.map((id) => this.contracts.find(id))),
    ])
    const propertyByContract = new Map(
      contracts.flatMap((c) => (c ? [[c.id, c.propertyId] as const] : [])),
    )
    const properties = await this.properties.describe([
      ...propertyByContract.values(),
    ])
    return receivables.map((r) => {
      const propertyId = propertyByContract.get(r.contractId)
      return {
        id: r.id,
        owner: owners.get(r.ownerId) ?? null,
        contract: { id: r.contractId },
        property: propertyId ? (properties.get(propertyId) ?? null) : null,
        installmentPeriod: r.period,
        currency: r.currency,
        source: r.source,
        payer: r.payer,
        amount: r.amount,
        paidAmount: r.paidAmount,
        status: r.status,
        feePercentage: r.feePercentage,
        feeAmountFixed: r.feeAmountFixed,
        baseAmount: r.baseAmount,
        needsReview: r.needsReview,
        createdAt: r.createdAt,
      }
    })
  }

  async payment(payment: FeePayment): Promise<FeePaymentView> {
    const users = await this.users.describe([payment.registeredById])
    return toFeePaymentView(payment, users)
  }

  async account(
    ownerId: string,
    receivables: FeeReceivable[],
    payments: FeePayment[],
  ): Promise<OwnerFeeAccountView> {
    const [receivableViews, users] = await Promise.all([
      this.receivables(
        [...receivables].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        ),
      ),
      this.users.describe(payments.map((p) => p.registeredById)),
    ])
    return {
      ownerId,
      totals: FeePolicy.accountTotals(receivables, payments),
      receivables: receivableViews,
      payments: payments.map((p) => toFeePaymentView(p, users)),
      movements: FeePolicy.movements(receivables, payments, {
        receivable: describeReceivable,
        payment: describeFeePayment,
      }),
    }
  }
}
