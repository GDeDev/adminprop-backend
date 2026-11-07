import { Injectable } from '@nestjs/common'

import { IsoDate, nextPeriod, periodOf } from '@/shared/dates/calendar-date'
import { createLogger } from '@/shared/logging/root-logger'
import { InstallmentRepository } from '../domain/billing.ports'

/**
 * Al rescindir, las cuotas ya generadas de los meses posteriores al de la
 * rescisión dejan de deberse (revisión 2026-11-06, alto 7; D-262). Antes
 * seguían pendientes y corriendo punitorio, aunque la multa ya contaba esos
 * meses como canon futuro.
 *
 * Sólo se borran las que no tienen ningún movimiento (pagos, aun anulados,
 * cargos o ajustes): son una proyección que ya no corresponde y, si la
 * rescisión se deshiciera, generar el mes las vuelve a crear. Las que tienen
 * movimientos quedan como están y se avisan en el log para revisarlas a mano.
 * La del mes de la rescisión se debe entera, como hasta ahora. Idempotente.
 */
@Injectable()
export class InstallmentTerminationCloser {
  private readonly logger = createLogger('InstallmentTerminationCloser')

  constructor(private readonly installments: InstallmentRepository) {}

  async close(
    contractId: string,
    terminatedAt: IsoDate,
  ): Promise<{ removed: string[]; kept: string[] }> {
    const from = nextPeriod(periodOf(terminatedAt))
    const later = (
      await this.installments.listAll({ contractId, periodFrom: from })
    ).filter((installment) => installment.period >= from)
    const removed: string[] = []
    const kept: string[] = []
    for (const installment of later) {
      if (await this.installments.deleteIfUntouched(installment.id)) {
        removed.push(installment.period)
      } else {
        kept.push(installment.period)
      }
    }
    if (kept.length > 0) {
      this.logger.warn(
        { contractId, terminatedAt, kept },
        'Rescisión con cuotas posteriores que ya tienen movimientos: quedan para revisar a mano',
      )
    }
    this.logger.info(
      { contractId, terminatedAt, removed },
      'Cuotas posteriores a la rescisión cerradas',
    )
    return { removed, kept }
  }
}
