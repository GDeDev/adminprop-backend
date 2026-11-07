import {
  addDays,
  IsoDate,
  isValidIsoDate,
  lastDayOfPeriod,
  periodOf,
  todayIso,
} from '@/shared/dates/calendar-date'
import {
  IndexSourceResult,
  IndexSourceUnavailableError,
  IndexSourceValue,
} from '../index-source.port'
import { getJson } from './http-json'

const SOURCE = 'bcra'
/** Estadísticas del BCRA, variable "ICL - Base 30.6.20 = 1". */
const BASE_URL = 'https://api.bcra.gob.ar/estadisticas/v3.0/monetarias/40'
/** Cuántos días antes del fin de mes se acepta el último dato publicado. */
const TOLERANCE_DAYS = 4

interface IclPoint {
  fecha: IsoDate
  valor: number
}

/**
 * ICL desde la API pública de estadísticas del BCRA (A-25): el contrato usa
 * el valor del **último día del mes**. Un mes sólo se informa cuando ya
 * terminó y hay un dato dentro de los últimos días; si no, no aparece y el
 * job lo vuelve a pedir en la próxima corrida.
 */
export class BcraIclAdapter {
  constructor(private readonly today: () => IsoDate = todayIso) {}

  async fetch(periods: string[]): Promise<IndexSourceResult> {
    if (periods.length === 0) return { source: SOURCE, values: [] }
    const sorted = [...periods].sort()
    const from = addDays(`${sorted[0]}-01`, -TOLERANCE_DAYS)
    const to = lastDayOfPeriod(sorted[sorted.length - 1])
    const body = await getJson(
      SOURCE,
      `${BASE_URL}?desde=${from}&hasta=${to}&limit=3000`,
    )
    const points = parsePoints(body)

    const currentPeriod = periodOf(this.today())
    const values: IndexSourceValue[] = []
    for (const period of sorted) {
      // El mes en curso no tiene "último día" todavía.
      if (period >= currentPeriod) continue
      const lastDay = lastDayOfPeriod(period)
      const floor = addDays(lastDay, -TOLERANCE_DAYS)
      const latest = points
        .filter((p) => p.fecha <= lastDay && p.fecha >= floor)
        .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))[0]
      if (latest) values.push({ period, value: String(latest.valor) })
    }
    return { source: SOURCE, values }
  }
}

/**
 * Acepta las dos formas que tuvo la API: v3 (`results[0].detalle[]`) y v2
 * (`results[]` con `fecha` y `valor`). Cualquier otra cosa es un cambio de
 * formato.
 */
export function parsePoints(body: unknown): IclPoint[] {
  const results = (body as { results?: unknown } | null)?.results
  if (!Array.isArray(results)) throw formatError()
  const rows: unknown[] =
    results.length > 0 &&
    Array.isArray((results[0] as { detalle?: unknown }).detalle)
      ? results.flatMap((r) => (r as { detalle: unknown[] }).detalle)
      : results

  return rows.map((row) => {
    const { fecha, valor } = (row ?? {}) as { fecha?: unknown; valor?: unknown }
    if (
      typeof fecha !== 'string' ||
      !isValidIsoDate(fecha) ||
      typeof valor !== 'number' ||
      !Number.isFinite(valor) ||
      valor <= 0
    ) {
      throw formatError()
    }
    return { fecha, valor }
  })
}

function formatError(): IndexSourceUnavailableError {
  return new IndexSourceUnavailableError(
    SOURCE,
    'la respuesta no tiene el formato esperado (results/detalle con fecha y valor)',
  )
}
