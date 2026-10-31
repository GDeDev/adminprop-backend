import { isValidPeriod, Period } from '@/shared/dates/calendar-date'
import {
  IndexSourceResult,
  IndexSourceUnavailableError,
  IndexSourceValue,
} from '../index-source.port'
import { getJson } from './http-json'

const SOURCE = 'indec'
/**
 * Serie "IPC Nivel general nacional, base dic-2016" del INDEC, publicada por
 * la API de series de tiempo de datos.gob.ar. Mensual, un punto por mes con
 * fecha del primer día.
 */
const SERIES_ID = '148.3_INIVELNAL_DICI_M_26'
const BASE_URL = 'https://apis.datos.gob.ar/series/api/series/'

/**
 * IPC mensual (A-25): el índice del mes. Si el INDEC cambia el formato, falla
 * con un mensaje claro y queda la carga manual.
 */
export class IndecIpcAdapter {
  async fetch(periods: string[]): Promise<IndexSourceResult> {
    if (periods.length === 0) return { source: SOURCE, values: [] }
    const sorted = [...periods].sort()
    const body = await getJson(
      SOURCE,
      `${BASE_URL}?ids=${SERIES_ID}&format=json&start_date=${sorted[0]}` +
        `&end_date=${sorted[sorted.length - 1]}&limit=1000`,
    )
    const published = new Map(parsePoints(body))
    const values: IndexSourceValue[] = []
    for (const period of sorted) {
      const value = published.get(period)
      if (value !== undefined) values.push({ period, value })
    }
    return { source: SOURCE, values }
  }
}

/** `data: [["2026-09-01", 7123.45], ...]`; un mes sin dato viene `null`. */
export function parsePoints(body: unknown): [Period, string][] {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) throw formatError()
  const points: [Period, string][] = []
  for (const row of data) {
    if (!Array.isArray(row) || typeof row[0] !== 'string') throw formatError()
    const period = row[0].slice(0, 7)
    if (!isValidPeriod(period)) throw formatError()
    if (row[1] === null) continue
    if (typeof row[1] !== 'number' || !Number.isFinite(row[1]) || row[1] <= 0) {
      throw formatError()
    }
    points.push([period, String(row[1])])
  }
  return points
}

function formatError(): IndexSourceUnavailableError {
  return new IndexSourceUnavailableError(
    SOURCE,
    'la respuesta no tiene el formato esperado (data con [fecha, valor])',
  )
}
