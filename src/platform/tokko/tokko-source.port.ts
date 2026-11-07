/**
 * Fuente de datos de Tokko Broker (Fase 21, 4.1). El importador de Tokko sólo
 * conoce este puerto: no sabe si los datos vienen de la API real o de las
 * fixtures de los tests.
 *
 * Clase abstracta y no interface para poder usarla como token de inyección.
 *
 * La API key de Tokko es un secreto: vive en `TOKKO_API_KEY` (Doppler), nunca
 * se guarda en la base, no se loguea y no sale en ningún mensaje de error.
 */
export abstract class TokkoSourcePort {
  /** `http` o `fixture`. Lo ve el log de arranque, no el cliente. */
  abstract readonly provider: string

  /**
   * Si esta inmobiliaria puede leer de la fuente. La key de Tokko es UNA y de
   * una cuenta concreta (D-253): con la API real sólo la inmobiliaria dueña de
   * la key puede importar; cualquier otra se traería el stock ajeno.
   */
  abstract isAvailableFor(tenantId: string | undefined): boolean

  /**
   * Los diccionarios de Tokko (tipos, tags, operaciones). Además de servir
   * para el análisis, es la primera llamada: una key inválida falla acá, antes
   * de recorrer nada.
   *
   * @throws TokkoSourceError si la fuente no responde o rechaza la key.
   */
  abstract dictionaries(): Promise<TokkoDictionaries>

  /** Las divisiones/localidades donde la inmobiliaria tiene stock. */
  abstract locationsSummary(): Promise<TokkoLocationSummary>

  /**
   * Todas las propiedades, de a páginas. Quien consume corta el recorrido
   * cuando junta las que necesita (`break` en el `for await`).
   *
   * @throws TokkoSourceError si la fuente falla a mitad de camino.
   */
  abstract properties(): AsyncIterable<TokkoProperty[]>
}

export interface TokkoNamedItem {
  id: number
  name: string
}

export interface TokkoDictionaries {
  propertyTypes: TokkoNamedItem[]
  propertyTags: TokkoNamedItem[]
  operationTypes: TokkoNamedItem[]
}

export interface TokkoLocationSummary {
  /** Nombres de las localidades con stock, para mostrar. */
  names: string[]
}

export interface TokkoPrice {
  currency: string
  /** Como llega de Tokko, convertido a texto decimal (nunca `number`). */
  price: string
}

export interface TokkoOperation {
  /** "Rent", "Sale", "Alquiler"... tal como lo manda Tokko. */
  type: string
  prices: TokkoPrice[]
}

export interface TokkoPhoto {
  url: string
  isFrontCover: boolean
  order: number
}

/** Una propiedad de Tokko ya normalizada por el adapter. */
export interface TokkoProperty {
  id: string
  address: string | null
  fakeAddress: string | null
  title: string | null
  description: string | null
  typeName: string | null
  /** Ej. "Argentina | Capital Federal | Palermo". */
  fullLocation: string | null
  operations: TokkoOperation[]
  /** Nombres de los tags (amenities). */
  tags: string[]
  /** Ordenadas: la portada primero. */
  photos: TokkoPhoto[]
}

/** Falla de la fuente, con un mensaje en español listo para mostrar. */
export class TokkoSourceError extends Error {
  constructor(
    message: string,
    /** Status HTTP si lo hubo; sirve para tests y logs, no para el usuario. */
    readonly status?: number,
  ) {
    super(message)
    this.name = 'TokkoSourceError'
  }
}
