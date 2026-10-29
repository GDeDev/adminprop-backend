import { Injectable } from '@nestjs/common'

import { IsoDate, Period, todayIso } from '@/shared/dates/calendar-date'
import {
  GenerationResult,
  InstallmentGenerator,
} from '../application/installment-generator'
import {
  InstallmentViews,
  RenterArrearsView,
  sumMoney,
} from '../application/installment.views'
import {
  CollectionMode,
  Currency,
  FeeMode,
  PaymentKind,
  PaymentReceiver,
  PaymentStatus,
} from '../domain/billing'
import { InstallmentRepository } from '../domain/billing.ports'
import { InstallmentPolicy } from '../domain/installment.policy'

/** Una cuota vencida, para los recordatorios de la Fase 13. */
export interface OverdueInstallmentRef {
  id: string
  contractId: string
  renterId: string
  propertyId: string
  ownerId: string
  period: Period
  currency: Currency
  daysOverdue: number
  totalDue: string
  lateFeeBalance: string
}

/** Lo cobrado de una cuota, para la liquidación (Fase 12). */
export interface InstallmentCollection {
  installmentId: string
  contractId: string
  ownerId: string
  period: Period
  currency: Currency
  baseAmount: string
  /** Alquiler cobrado por pagos confirmados, según quién lo recibió. */
  rentCollectedByAgency: string
  rentCollectedByOwner: string
  /** Alquiler cubierto con saldos a favor aplicados. */
  rentCollectedByCredit: string
  lateFeeCollected: string
  chargesCollected: string
  feeOnBase: string
  feeOnCollected: string
  feeMode: FeeMode
  collectionMode: CollectionMode
}

/**
 * Lo que otros módulos pueden pedirle a cobros. Dentro del tenant del
 * contexto; el cron de la Fase 13 entra por inmobiliaria con
 * `RequestContext.runInTenant`.
 */
@Injectable()
export class BillingFacade {
  constructor(
    private readonly generator: InstallmentGenerator,
    private readonly installments: InstallmentRepository,
    private readonly views: InstallmentViews,
  ) {}

  /** Las cuotas de un mes (sin período, el siguiente). Idempotente. */
  generateInstallments(period?: Period): Promise<GenerationResult> {
    return this.generator.generate(period ?? null)
  }

  /** Las cuotas con saldo y gracia vencida a esa fecha, las más atrasadas primero. */
  async listOverdue(
    today: IsoDate = todayIso(),
  ): Promise<OverdueInstallmentRef[]> {
    const unpaid = await this.installments.listAll({
      unpaidGraceEndBefore: today,
    })
    return unpaid
      .map((installment) => ({
        installment,
        balances: InstallmentPolicy.balances(installment, today),
      }))
      .filter((r) => Number(r.balances.totalDue) > 0)
      .map(({ installment, balances }) => ({
        id: installment.id,
        contractId: installment.contractId,
        renterId: installment.renterId,
        propertyId: installment.propertyId,
        ownerId: installment.ownerId,
        period: installment.period,
        currency: installment.currency,
        daysOverdue: InstallmentPolicy.daysOverdue(installment, today),
        totalDue: balances.totalDue,
        lateFeeBalance: balances.lateFeeBalance,
      }))
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
  }

  /** Lo cobrado (confirmado) de cada cuota, para liquidar (Micaela #5, #9, #10). */
  async collectionsByInstallment(
    ids: string[],
  ): Promise<Map<string, InstallmentCollection>> {
    if (ids.length === 0) return new Map()
    const installments = await this.installments.listAll({ ids })
    return new Map(
      installments.map((installment) => {
        const confirmed = installment.payments.filter(
          (p) => p.status === PaymentStatus.CONFIRMED,
        )
        const rentBy = (receiver: PaymentReceiver) =>
          sumMoney(
            confirmed
              .filter(
                (p) =>
                  p.kind === PaymentKind.CASH_IN && p.receivedBy === receiver,
              )
              .map((p) => p.rentApplied),
          )
        const fees = InstallmentPolicy.feeAccrual(installment)
        return [
          installment.id,
          {
            installmentId: installment.id,
            contractId: installment.contractId,
            ownerId: installment.ownerId,
            period: installment.period,
            currency: installment.currency,
            baseAmount: installment.baseAmount,
            rentCollectedByAgency: rentBy(PaymentReceiver.AGENCY),
            rentCollectedByOwner: rentBy(PaymentReceiver.OWNER),
            rentCollectedByCredit: sumMoney(
              confirmed
                .filter((p) => p.kind === PaymentKind.CREDIT_APPLICATION)
                .map((p) => p.rentApplied),
            ),
            lateFeeCollected: sumMoney(confirmed.map((p) => p.lateFeeApplied)),
            chargesCollected: sumMoney(confirmed.map((p) => p.chargesApplied)),
            feeOnBase: fees.feeOnBase,
            feeOnCollected: fees.feeOnCollected,
            feeMode: installment.feeMode,
            collectionMode: installment.collectionMode,
          },
        ]
      }),
    )
  }

  /** Mora por inquilino (portal, Fase 18; listados). */
  async arrearsByRenter(
    renterIds: string[],
    today: IsoDate = todayIso(),
  ): Promise<RenterArrearsView[]> {
    const ids = [...new Set(renterIds)]
    if (ids.length === 0) return []
    const unpaid = await this.installments.listAll({
      renterIds: ids,
      unpaid: true,
    })
    return this.views.arrears(ids, unpaid, today)
  }
}
