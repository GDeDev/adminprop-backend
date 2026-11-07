import { SendOutcome } from '@/platform/notifications/notifications.service'
import { JobExecutionStatus } from '../../domain/job-catalog'
import { JobOutcome } from '../job.types'

/** Cuenta cómo salieron los avisos de una corrida. */
export class NoticeTally {
  sent = 0
  /** Ya avisados antes (el `notification_log` los reconoció). */
  alreadySent = 0
  failed = 0

  add(outcome: SendOutcome): void {
    if (outcome === 'SENT') this.sent += 1
    else if (outcome === 'SKIPPED') this.alreadySent += 1
    else this.failed += 1
  }

  get total(): number {
    return this.sent + this.alreadySent + this.failed
  }

  /**
   * `PARTIAL` si alguno falló (se reintenta en la próxima corrida: la fila
   * del log queda `FAILED`); si no, `SUCCEEDED`.
   */
  outcome(
    what: string,
    details: Record<string, unknown> = {},
    extra = '',
  ): JobOutcome {
    const parts = [`${this.sent} ${what} enviados`]
    if (this.alreadySent > 0) parts.push(`${this.alreadySent} ya avisados`)
    if (this.failed > 0) parts.push(`${this.failed} fallaron`)
    return {
      status:
        this.failed > 0
          ? JobExecutionStatus.PARTIAL
          : JobExecutionStatus.SUCCEEDED,
      affected: this.sent,
      summary: parts.join(', ') + extra,
      details: {
        sent: this.sent,
        alreadySent: this.alreadySent,
        failed: this.failed,
        ...details,
      },
    }
  }
}

/** Una corrida que no corresponde hoy (todavía no es el día N, etc.). */
export function skipped(reason: string): JobOutcome {
  return {
    status: JobExecutionStatus.SKIPPED,
    affected: 0,
    summary: reason,
  }
}
