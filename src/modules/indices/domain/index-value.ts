/** Índices con los que se actualizan los alquileres (PRD 5.5, RN-15). */
export enum IndexType {
  /** Índice para Contratos de Locación, publicado por el BCRA. */
  ICL = 'ICL',
  /** Índice de Precios al Consumidor, publicado por el INDEC. */
  IPC = 'IPC',
}

/** El valor de un índice en un mes. Global: no pertenece a una inmobiliaria. */
export interface IndexValue {
  id: string
  indexType: IndexType
  /** `AAAA-MM`. */
  period: string
  /** Decimal como string, con hasta 6 decimales. Nunca `number`. */
  value: string
  /** De dónde salió: `manual`, `bcra`, `indec`... */
  source: string
  createdAt: Date
}

/** Fuente de los valores cargados a mano por `POST /indices`. */
export const MANUAL_SOURCE = 'manual'
