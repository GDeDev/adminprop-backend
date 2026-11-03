import { Injectable } from '@nestjs/common'

import { ValuationFacade } from '@/modules/valuation/public'
import { JobExecutionStatus, JobName } from '../../domain/job-catalog'
import { AutomationJob, JobOutcome } from '../job.types'
import { skipped } from './notice-tally'

/**
 * Trae avisos de alquiler para la tasación (Fase 24, 4.1). Global: el caché de
 * comparables es del mercado. Una fuente bloqueada o con el parser roto no
 * frena a las demás; si todas fallan el job termina `FAILED`, y con alguna
 * fallando o 3 corridas seguidas sin datos, `PARTIAL`.
 */
@Injectable()
export class RefreshComparablesJob implements AutomationJob {
  readonly name = JobName.VALUATION_REFRESH_COMPARABLES

  constructor(private readonly valuation: ValuationFacade) {}

  async run(): Promise<JobOutcome> {
    const summary = await this.valuation.refreshComparables()
    const ran = summary.sources.filter((s) => s.result !== 'SKIPPED')
    if (summary.sources.length === 0) {
      return skipped(
        'No hay fuentes de comparables activas (COMPARABLES_SOURCES)',
      )
    }
    const failed = ran.filter(
      (s) => s.result === 'BLOCKED' || s.result === 'PARSE_ERROR',
    )
    const status =
      ran.length > 0 && failed.length === ran.length
        ? JobExecutionStatus.FAILED
        : failed.length > 0 || summary.staleSources.length > 0
          ? JobExecutionStatus.PARTIAL
          : JobExecutionStatus.SUCCEEDED

    const parts = summary.sources.map(
      (s) => `${s.source}: ${s.result}${s.detail ? ` (${s.detail})` : ''}`,
    )
    return {
      status,
      affected: summary.created + summary.updated,
      summary: `${summary.zones} zonas, ${summary.created} avisos nuevos, ${summary.updated} actualizados, ${summary.deactivated} dados de baja · ${parts.join(' · ')}`,
      details: summary as unknown as Record<string, unknown>,
    }
  }
}
