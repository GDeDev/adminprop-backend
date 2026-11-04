import { Injectable, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'

import { Configuration } from '@/shared/config/configuration'
import { APP_TIME_ZONE } from '@/shared/dates/zoned-time'
import { createLogger } from '@/shared/logging/root-logger'
import { JobScheduler } from '../../application/job-scheduler'

/** Cuánto espera el servidor, al arrancar, antes de recuperar lo que se perdió. */
const CATCH_UP_DELAY_MS = 30_000

/**
 * El disparo de los jobs (Fase 13, 1): un solo `@Cron` en la zona horaria del
 * negocio, cada 10 minutos. No es "uno por job": cada tick le pregunta al
 * `JobScheduler` qué corridas de hoy faltan, y al arrancar el servidor hace
 * la misma pregunta una vez (recupera lo que se perdió estando apagado).
 *
 * ⚠️ Corre en cada instancia. Con varias réplicas todas lo intentan, y la
 * unicidad la da el índice `job_executions_scheduled_slot_key`: la fila de
 * cada corrida se reserva con INSERT ... ON CONFLICT DO NOTHING y sólo quien
 * la consigue publica. La `singletonKey` de pg-boss no alcanza por sí sola:
 * en una cola estándar no deduplica (sólo con `policy: 'short'`).
 */
@Injectable()
export class CronSchedulerTask implements OnApplicationBootstrap {
  private readonly logger = createLogger('CronScheduler')

  constructor(
    private readonly scheduler: JobScheduler,
    private readonly config: ConfigService<Configuration, true>,
  ) {}

  private get enabled(): boolean {
    return this.config.get('automations', { infer: true }).enabled
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.info('Automatizaciones apagadas (AUTOMATIONS_ENABLED=false)')
      return
    }
    setTimeout(() => void this.tick('arranque'), CATCH_UP_DELAY_MS).unref()
  }

  @Cron('*/10 * * * *', { timeZone: APP_TIME_ZONE })
  async everyTenMinutes(): Promise<void> {
    if (this.enabled) await this.tick('cron')
  }

  private async tick(origin: string): Promise<void> {
    try {
      const enqueued = await this.scheduler.enqueueDue()
      if (enqueued > 0) {
        this.logger.info({ origin, enqueued }, `Jobs encolados: ${enqueued}`)
      }
    } catch (error) {
      // Que falle un tick no puede tumbar la app: el próximo reintenta.
      this.logger.error({ err: error, origin }, 'Falló el disparo de los jobs')
    }
  }
}
