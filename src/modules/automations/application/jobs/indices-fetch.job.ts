import { Injectable } from '@nestjs/common'

import { ContractsFacade } from '@/modules/contracts/public'
import { IndexType, IndicesFacade } from '@/modules/indices/public'
import { TenantsFacade } from '@/modules/tenants/public'
import { NotificationsService } from '@/platform/notifications/notifications.service'
import { IndexSourcePort } from '@/platform/index-source/index-source.port'
import { RequestContext } from '@/shared/context/request-context'
import { errorMessage } from '@/shared/core/error-message'
import {
  daysBetween,
  IsoDate,
  lastDayOfPeriod,
} from '@/shared/dates/calendar-date'
import { createLogger } from '@/shared/logging/root-logger'
import {
  IndexFetchStatus,
  JobExecutionStatus,
  JobName,
} from '../../domain/job-catalog'
import { AutomationJob, JobContext, JobOutcome } from '../job.types'
import { skipped } from './notice-tally'

/** Cuántos meses hacia atrás se revisan. */
const LAST_MONTHS = 3
/**
 * Días después del fin de mes desde los que un índice sin publicar se
 * considera un problema (A-28): el INDEC publica el IPC a mediados del mes
 * siguiente, no hay que alarmar antes.
 */
const PUBLICATION_GRACE_DAYS = 20

interface TypeResult {
  status: IndexFetchStatus
  fetched: string[]
  stillMissing: string[]
  error: string | null
}

/**
 * Trae los índices de la fuente (Fase 13, 2.2). Global: corre una vez, no por
 * inmobiliaria. Un mes ya cargado no se pisa (D-54). El resultado por tipo
 * queda en `details` (lo lee `GET /indices/status`); si la fuente falla, o no
 * publicó un mes que ya debería estar, las inmobiliarias que usan ese índice
 * reciben un aviso, una vez por día y tipo.
 */
@Injectable()
export class IndicesFetchJob implements AutomationJob {
  readonly name = JobName.INDICES_FETCH
  private readonly logger = createLogger('IndicesFetchJob')

  constructor(
    private readonly source: IndexSourcePort,
    private readonly indices: IndicesFacade,
    private readonly tenants: TenantsFacade,
    private readonly contracts: ContractsFacade,
    private readonly notifications: NotificationsService,
  ) {}

  async run(context: JobContext): Promise<JobOutcome> {
    if (this.source.provider === 'manual') {
      return skipped(
        'La fuente de índices es manual (INDEX_SOURCE_PROVIDER=manual): se cargan a mano',
      )
    }

    const results: Record<string, TypeResult> = {}
    for (const type of [IndexType.ICL, IndexType.IPC]) {
      results[type] = await this.fetchType(type, context.today)
    }

    const statuses = Object.values(results).map((r) => r.status)
    const created = Object.values(results).reduce(
      (sum, r) => sum + r.fetched.length,
      0,
    )
    const failed = statuses.filter((s) => s === IndexFetchStatus.FAILED).length
    const partial = statuses.filter(
      (s) => s === IndexFetchStatus.PARTIAL,
    ).length

    await this.notifyProblems(results, context.today)

    const summary = Object.entries(results)
      .map(([type, r]) => {
        if (r.status === IndexFetchStatus.FAILED)
          return `${type}: falló (${r.error})`
        const parts = [`${r.fetched.length} cargados`]
        if (r.stillMissing.length > 0) {
          parts.push(`faltan ${r.stillMissing.join(', ')}`)
        }
        return `${type}: ${parts.join(', ')}`
      })
      .join(' · ')

    return {
      status:
        failed === statuses.length
          ? JobExecutionStatus.FAILED
          : failed + partial > 0
            ? JobExecutionStatus.PARTIAL
            : JobExecutionStatus.SUCCEEDED,
      affected: created,
      summary,
      details: results as unknown as Record<string, unknown>,
    }
  }

  private async fetchType(
    type: IndexType,
    today: IsoDate,
  ): Promise<TypeResult> {
    const missing = await this.indices.missingPeriods(type, LAST_MONTHS, today)
    if (missing.length === 0) {
      return {
        status: IndexFetchStatus.SUCCEEDED,
        fetched: [],
        stillMissing: [],
        error: null,
      }
    }
    try {
      const result = await this.source.fetch(type, missing)
      const fetched: string[] = []
      for (const { period, value } of result.values) {
        if (!missing.includes(period)) continue
        if (
          await this.indices.registerFromSource(
            type,
            period,
            value,
            result.source,
          )
        ) {
          fetched.push(period)
        }
      }
      const stillMissing = missing.filter(
        (p) => !result.values.some((v) => v.period === p),
      )
      return {
        status:
          stillMissing.length === 0
            ? IndexFetchStatus.SUCCEEDED
            : IndexFetchStatus.PARTIAL,
        fetched,
        stillMissing,
        error: null,
      }
    } catch (error) {
      this.logger.warn({ err: error, type }, 'La fuente de índices falló')
      return {
        status: IndexFetchStatus.FAILED,
        fetched: [],
        stillMissing: missing,
        error: errorMessage(error),
      }
    }
  }

  /** Avisa a quien usa ese índice, salvo que sea un mes que todavía puede no estar publicado. */
  private async notifyProblems(
    results: Record<string, TypeResult>,
    today: IsoDate,
  ): Promise<void> {
    const problems = Object.entries(results).filter(
      ([, r]) =>
        r.status === IndexFetchStatus.FAILED ||
        r.stillMissing.some(
          (period) =>
            daysBetween(lastDayOfPeriod(period), today) >=
            PUBLICATION_GRACE_DAYS,
        ),
    )
    if (problems.length === 0) return

    for (const tenant of await this.tenants.listActive()) {
      await RequestContext.runInTenant(tenant.id, async () => {
        const inUse = await this.contracts.indexTypesInUse()
        for (const [type, result] of problems) {
          if (!inUse.includes(type as 'ICL' | 'IPC')) continue
          await this.notifications.notifyStaff({
            tenantId: tenant.id,
            type: 'INDEX_FETCH_FAILED',
            title: `Índice ${type} no disponible`,
            body:
              result.status === IndexFetchStatus.FAILED
                ? `No se pudo traer el ${type} de la fuente oficial (${result.error}). Cargalo a mano si hace falta aplicar un aumento.`
                : `El ${type} de ${result.stillMissing.join(', ')} todavía no está publicado. Cargalo a mano si hace falta aplicar un aumento.`,
            dedupeKey: `INDEX_FETCH_FAILED:${type}:${today}`,
            link: '/configuracion/indices',
          })
        }
      })
    }
  }
}
