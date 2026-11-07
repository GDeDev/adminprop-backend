import { Injectable } from '@nestjs/common'

import { ContractsFacade, RentUpdateOutcome } from '@/modules/contracts/public'
import { PropertiesFacade } from '@/modules/properties/public'
import { NotificationsService } from '@/platform/notifications/notifications.service'
import { JobName } from '../../domain/job-catalog'
import { AutomationJob, JobContext, JobOutcome } from '../job.types'

/** Tope de aumentos atrasados que se aplican de una vez a un contrato. */
const MAX_UPDATES_PER_CONTRACT = 24

type ManualRequired = Extract<RentUpdateOutcome, { status: 'MANUAL_REQUIRED' }>

/**
 * Aplica los aumentos que tocan (Fase 13, 2): ICL/IPC con índices cargados y
 * FIXED con porcentaje, con `appliedById` nulo. Si falta el índice o el
 * aumento es manual, avisa al personal una vez por contrato y fecha. Sólo
 * aplica "al día" (D-60): nunca adelanta. Un contrato con varios aumentos
 * atrasados los aplica en orden. La corrección de las cuotas ya generadas la
 * hace cobros al recibir el evento de cada aumento (D-99).
 */
@Injectable()
export class RentUpdatesJob implements AutomationJob {
  readonly name = JobName.RENT_UPDATES_APPLY

  constructor(
    private readonly contracts: ContractsFacade,
    private readonly properties: PropertiesFacade,
    private readonly notifications: NotificationsService,
  ) {}

  async run(context: JobContext): Promise<JobOutcome> {
    const due = await this.contracts.listDueForRentUpdate(context.today)
    let applied = 0
    const pending: ManualRequired[] = []

    for (const contractId of due) {
      for (let i = 0; i < MAX_UPDATES_PER_CONTRACT; i += 1) {
        const outcome = await this.contracts.applyDueRentUpdate(
          contractId,
          context.today,
        )
        if (outcome.status === 'APPLIED') {
          applied += 1
          continue
        }
        if (outcome.status === 'MANUAL_REQUIRED') pending.push(outcome)
        break
      }
    }

    for (const outcome of pending) {
      await this.alertPending(context.tenantId!, outcome)
    }

    return {
      affected: applied,
      summary:
        `${applied} aumentos aplicados` +
        (pending.length > 0
          ? `, ${pending.length} requieren carga manual`
          : ''),
      details: {
        applied,
        pending: pending.map((p) => ({
          contractId: p.contractId,
          effectiveFrom: p.effectiveFrom,
          reason: p.reason,
          missingPeriod: p.missingPeriod,
        })),
      },
    }
  }

  private async alertPending(
    tenantId: string,
    outcome: ManualRequired,
  ): Promise<void> {
    const contract = await this.contracts.find(outcome.contractId)
    const property = contract
      ? (await this.properties.describe([contract.propertyId])).get(
          contract.propertyId,
        )
      : undefined
    const where = property ? ` de ${property.address}` : ''
    const reason =
      outcome.reason === 'MISSING_INDEX'
        ? `falta el índice ${outcome.rentUpdateType} de ${outcome.missingPeriod}`
        : 'la actualización es manual'
    await this.notifications.notifyStaff({
      tenantId,
      type: 'RENT_UPDATE_PENDING',
      title: 'Aumento de alquiler pendiente',
      body:
        `El aumento del contrato${where} desde ${outcome.effectiveFrom} ` +
        `no se pudo aplicar solo: ${reason}.`,
      dedupeKey: `RENT_UPDATE_PENDING:${outcome.contractId}:${outcome.effectiveFrom}`,
      entity: { type: 'CONTRACT', id: outcome.contractId },
      link: `/contratos/${outcome.contractId}`,
    })
  }
}
