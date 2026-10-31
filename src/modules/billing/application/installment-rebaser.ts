import { Injectable } from '@nestjs/common'

import { ContractsFacade } from '@/modules/contracts/public'
import { NotificationsService } from '@/platform/notifications/notifications.service'
import { RequestContext } from '@/shared/context/request-context'
import {
  firstDayOfPeriod,
  IsoDate,
  nextPeriod,
  Period,
  periodOf,
} from '@/shared/dates/calendar-date'
import { compareMoney, toMoneyString } from '@/shared/money'
import { InstallmentRepository } from '../domain/billing.ports'
import { InstallmentPolicy } from '../domain/installment.policy'

export interface RebasedInstallment {
  id: string
  period: Period
  previousBase: string
  newBase: string
}

export interface RebaseResult {
  contractId: string
  /** Cuotas pendientes sin pagos a las que se les corrigió la base. */
  rebased: RebasedInstallment[]
  /** Cuotas que ya tenían movimientos: se dejan como están y se avisa. */
  outdated: RebasedInstallment[]
}

/**
 * Corrige la base de las cuotas ya generadas cuando se aplica un aumento
 * (Fase 13, 2.1, A-24). Las cuotas del mes siguiente se generan el día 28 con
 * el alquiler vigente; un aumento que rige desde el 1 las deja con la base
 * vieja. Sólo se tocan las pendientes sin pagos; las demás se avisan.
 *
 * La base que le corresponde a cada cuota se lee del historial del alquiler
 * (el vigente al primer día del mes), no del evento: así no importa el orden
 * en que lleguen dos aumentos seguidos y correrlo dos veces da lo mismo.
 */
@Injectable()
export class InstallmentRebaser {
  constructor(
    private readonly installments: InstallmentRepository,
    private readonly contracts: ContractsFacade,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Primer mes que el aumento alcanza: el de `effectiveFrom` si rige desde el
   * 1, si no el siguiente (la cuota del mes entero se generó con el alquiler
   * de entonces, D-72).
   */
  static firstAffectedPeriod(effectiveFrom: IsoDate): Period {
    const period = periodOf(effectiveFrom)
    return effectiveFrom.endsWith('-01') ? period : nextPeriod(period)
  }

  async rebase(
    contractId: string,
    effectiveFrom: IsoDate,
  ): Promise<RebaseResult> {
    const result: RebaseResult = { contractId, rebased: [], outdated: [] }
    const history = await this.contracts.rentHistory(contractId)
    if (!history) return result

    const from = InstallmentRebaser.firstAffectedPeriod(effectiveFrom)
    const candidates = (await this.installments.listAll({ contractId })).filter(
      (installment) => installment.period >= from,
    )
    for (const installment of candidates) {
      // Del más nuevo al más viejo: el primero que ya regía el 1° del mes.
      const rent = history.find(
        (h) => h.effectiveFrom <= firstDayOfPeriod(installment.period),
      )
      if (!rent) continue
      const base = toMoneyString(rent.newRent)
      if (compareMoney(installment.baseAmount, base) === 0) continue

      const entry = {
        id: installment.id,
        period: installment.period,
        previousBase: installment.baseAmount,
        newBase: base,
      }
      if (InstallmentPolicy.canRebase(installment)) {
        await this.installments.update(installment.id, { baseAmount: base })
        result.rebased.push(entry)
      } else {
        result.outdated.push(entry)
      }
    }
    return result
  }

  /** Lo que hace el consumidor de la cola: corregir y avisar lo que quedó. */
  async handle(payload: {
    contractId: string
    effectiveFrom: IsoDate
  }): Promise<RebaseResult> {
    const result = await this.rebase(payload.contractId, payload.effectiveFrom)
    const tenantId = RequestContext.tenantId
    if (!tenantId) return result
    for (const outdated of result.outdated) {
      await this.notifications.notifyStaff({
        tenantId,
        type: 'INSTALLMENT_BASE_OUTDATED',
        title: 'Cuota con base desactualizada',
        body:
          `La cuota ${outdated.period} tiene base ${outdated.previousBase} y el ` +
          `alquiler vigente es ${outdated.newBase}. Ya tiene pagos: corregila a mano si corresponde.`,
        dedupeKey: `INSTALLMENT_BASE_OUTDATED:${outdated.id}:${outdated.newBase}`,
        entity: { type: 'INSTALLMENT', id: outdated.id },
        link: `/contratos/${payload.contractId}`,
      })
    }
    return result
  }
}
