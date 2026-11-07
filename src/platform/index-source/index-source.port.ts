/**
 * Fuente de los índices de actualización de alquileres (Fase 13, 2.2).
 *
 * El job `indices.fetch` le pide los meses que faltan y guarda lo que
 * devuelva; no sabe si viene del BCRA, del INDEC o de otro lado. Si una
 * fuente cambia de formato, falla con un mensaje claro y queda la carga
 * manual (`POST /indices`).
 *
 * Clase abstracta y no interface para poder usarla como token de inyección.
 */
export abstract class IndexSourcePort {
  /** `bcra-indec` o `manual`. Lo muestra `GET /indices/status`. */
  abstract readonly provider: string

  /** Si esta fuente sabe traer ese índice (la manual no trae ninguno). */
  abstract supports(indexType: SourceIndexType): boolean

  /**
   * Los valores publicados de esos meses (`AAAA-MM`). Un mes que la fuente
   * todavía no publicó simplemente no aparece en el resultado.
   *
   * @throws IndexSourceUnavailableError si la fuente no responde o cambió de
   *   formato.
   */
  abstract fetch(
    indexType: SourceIndexType,
    periods: string[],
  ): Promise<IndexSourceResult>
}

export type SourceIndexType = 'ICL' | 'IPC'

export interface IndexSourceValue {
  /** `AAAA-MM`. */
  period: string
  /** Decimal como string. */
  value: string
}

export interface IndexSourceResult {
  /** Nombre que queda en `index_values.source`: `bcra`, `indec`. */
  source: string
  values: IndexSourceValue[]
}

/** La fuente no respondió, devolvió un error o cambió el formato. */
export class IndexSourceUnavailableError extends Error {
  constructor(
    public readonly source: string,
    reason: string,
  ) {
    super(`${source}: ${reason}`)
    this.name = 'IndexSourceUnavailableError'
  }
}
