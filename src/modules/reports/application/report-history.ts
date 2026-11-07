import type { ReportRentTotalRef } from '@/modules/billing/public'
import { Period } from '@/shared/dates/calendar-date'
import { sumByCurrency } from '../domain/report-calculations'
import { DashboardReport } from '../domain/reports'

/**
 * Devengado (alquiler base) y cobrado (alquiler imputado) de cada mes, a
 * partir de los totales que ya sumó la base (`reportRentTotals`). Da lo mismo
 * que `buildHistory` sobre todas las cuotas hidratadas; el dashboard usa éste
 * para no cargar las cuotas de seis meses sólo para sumar dos columnas.
 */
export function buildHistoryFromTotals(
  periods: Period[],
  totals: ReportRentTotalRef[],
): DashboardReport['history'] {
  return periods.map((period) => {
    const ofPeriod = totals.filter((row) => row.period === period)
    return {
      period,
      accrued: sumByCurrency(
        ofPeriod.map((row) => ({
          currency: row.currency,
          amount: row.baseAmount,
        })),
      ),
      collected: sumByCurrency(
        ofPeriod.map((row) => ({
          currency: row.currency,
          amount: row.rentPaid,
        })),
      ),
    }
  })
}
