import { Injectable } from '@nestjs/common'

import { BillingFacade } from '@/modules/billing/public'
import { TenantsFacade } from '@/modules/tenants/public'
import { nextPeriod, periodOf } from '@/shared/dates/calendar-date'
import { JobName } from '../../domain/job-catalog'
import { AutomationJob, JobContext, JobOutcome } from '../job.types'

/**
 * Genera las cuotas (Fase 13, 2). No pregunta "¿es el día 28?" sino "¿falta
 * algo?": siempre completa el mes en curso (contratos nuevos, servidor caído)
 * y, desde `installmentGenerationDay`, también el mes siguiente. Un servidor
 * apagado el 28 las genera el 29. La idempotencia es el índice único
 * (contrato, período).
 */
@Injectable()
export class GenerateInstallmentsJob implements AutomationJob {
  readonly name = JobName.INSTALLMENTS_GENERATE

  constructor(
    private readonly billing: BillingFacade,
    private readonly tenants: TenantsFacade,
  ) {}

  async run(context: JobContext): Promise<JobOutcome> {
    const periods = await this.periodsToGenerate(context)

    let created = 0
    let skipped = 0
    const perPeriod: Record<string, { created: number; skipped: number }> = {}
    for (const period of periods) {
      const result = await this.billing.generateInstallments(period)
      created += result.created
      skipped += result.skipped
      perPeriod[period] = { created: result.created, skipped: result.skipped }
    }
    return {
      affected: created,
      summary:
        `${created} cuotas creadas, ${skipped} ya existían ` +
        `(${periods.join(', ')})`,
      details: { periods: perPeriod },
    }
  }

  private async periodsToGenerate(context: JobContext): Promise<string[]> {
    // A mano con un mes, sólo ese mes.
    if (context.period) return [context.period]
    const current = periodOf(context.today)
    const { installmentGenerationDay } = await this.tenants.getBillingSettings(
      context.tenantId!,
    )
    const dayOfMonth = Number(context.today.slice(8, 10))
    return dayOfMonth >= installmentGenerationDay
      ? [current, nextPeriod(current)]
      : [current]
  }
}
