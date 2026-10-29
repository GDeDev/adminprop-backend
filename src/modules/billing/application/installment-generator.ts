import { Injectable } from '@nestjs/common'

import { ContractsFacade } from '@/modules/contracts/public'
import { Period, todayIso } from '@/shared/dates/calendar-date'
import { createLogger } from '@/shared/logging/root-logger'
import { CollectionMode, Currency, FeeMode } from '../domain/billing'
import { InstallmentRepository } from '../domain/billing.ports'
import { InstallmentPolicy } from '../domain/installment.policy'

export interface GenerationResult {
  period: Period
  /** Contratos activos que cubren el mes. */
  contracts: number
  created: number
  /** Ya tenían su cuota: no se duplica (spec 3.1). */
  skipped: number
}

/**
 * Genera las cuotas de un mes (spec 3.1, regla 1). Lo comparten el endpoint
 * manual y `BillingFacade.generateInstallments` (cron de la Fase 13).
 * Idempotente: el índice único (tenant, contrato, período) hace que correrlo
 * dos veces no duplique; la segunda vuelta cuenta todo como `skipped`.
 */
@Injectable()
export class InstallmentGenerator {
  private readonly logger = createLogger('InstallmentGenerator')

  constructor(
    private readonly installments: InstallmentRepository,
    private readonly contracts: ContractsFacade,
  ) {}

  async generate(requested: string | null): Promise<GenerationResult> {
    const period = requested
      ? InstallmentPolicy.normalizePeriod(requested)
      : InstallmentPolicy.defaultPeriod(todayIso())
    const contracts = await this.contracts.listActiveForPeriod(period)

    let created = 0
    let skipped = 0
    for (const contract of contracts) {
      // La base es el alquiler vigente al generar (D-72), mes entero (A-7);
      // los términos vigentes al mes quedan copiados en la cuota (D-71).
      const terms = contract.billingTerms
      const installment = await this.installments.createIfAbsent({
        contractId: contract.id,
        renterId: contract.renterId,
        ownerId: contract.ownerId,
        propertyId: contract.propertyId,
        period,
        baseAmount: InstallmentPolicy.baseFor(contract.currentRent),
        currency: Currency[contract.currency],
        graceEndDate: InstallmentPolicy.graceEndDate(
          period,
          terms.lateFeeGraceDays,
        ),
        lateFeePercentage: terms.lateFeePercentage,
        lateFeeGraceDays: terms.lateFeeGraceDays,
        collectionMode: CollectionMode[terms.collectionMode],
        feeMode: FeeMode[terms.feeMode],
        feePercentage: terms.feePercentage,
        feeAmount: terms.feeAmount,
      })
      if (installment) created += 1
      else skipped += 1
    }

    this.logger.info(
      { period, contracts: contracts.length, created, skipped },
      'Cuotas generadas',
    )
    return { period, contracts: contracts.length, created, skipped }
  }
}
