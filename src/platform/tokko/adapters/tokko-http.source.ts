import { createLogger } from '@/shared/logging/root-logger'
import {
  TokkoDictionaries,
  TokkoLocationSummary,
  TokkoNamedItem,
  TokkoProperty,
  TokkoSourceError,
  TokkoSourcePort,
} from '../tokko-source.port'
import { mapTokkoProperty } from './tokko-mapper'

const BASE_URL = 'https://www.tokkobroker.com/api/v1'
/** Tokko limita duro la página (a veces 10-20); 20 es seguro (tokko_scraper.js). */
const PAGE_SIZE = 20
const REQUEST_TIMEOUT_MS = 20_000
const MAX_RETRIES = 3
/** Tope de seguridad: 2.000 páginas de 20 son 40.000 propiedades. */
const MAX_PAGES = 2000

export interface TokkoHttpOptions {
  /** Pausa entre páginas para no golpear la API. Default 400 ms. */
  pauseMs?: number
  /** Espera base del reintento (se duplica). Default 1000 ms. */
  retryBaseMs?: number
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * La API real de Tokko (`TOKKO_SOURCE=http`): la lógica de
 * `scripts/tokko_scraper.js` en TypeScript. Mismos endpoints, páginas de 20,
 * pausa entre páginas y reintento con backoff ante 429/5xx.
 *
 * La key viaja en la query (así lo exige Tokko) pero nunca se escribe en un
 * log ni en un mensaje de error: toda falla sale como `TokkoSourceError` con
 * un texto sin la URL.
 */
export class TokkoHttpSource extends TokkoSourcePort {
  readonly provider = 'http'
  private readonly logger = createLogger('TokkoHttpSource')
  private readonly pauseMs: number
  private readonly retryBaseMs: number
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>

  constructor(
    private readonly apiKey: string | null,
    options: TokkoHttpOptions = {},
  ) {
    super()
    this.pauseMs = options.pauseMs ?? 400
    this.retryBaseMs = options.retryBaseMs ?? 1000
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sleep = options.sleep ?? realSleep
  }

  async dictionaries(): Promise<TokkoDictionaries> {
    const [propertyTypes, propertyTags, operationTypes] = await Promise.all([
      this.dictionary('property_type'),
      this.dictionary('property_tags'),
      this.dictionary('operation_type'),
    ])
    return { propertyTypes, propertyTags, operationTypes }
  }

  async locationsSummary(): Promise<TokkoLocationSummary> {
    const data = encodeURIComponent(
      JSON.stringify({
        current_localization_id: 1,
        current_localization_type: 'country',
        price_from: 0,
        price_to: 999999999,
        operation_types: [1, 2, 3],
        property_types: [1, 2, 3, 4, 5, 6, 7],
        currency: 'ANY',
        filters: [],
        with_custom_tags: [],
      }),
    )
    const body = await this.get(
      `/property/get_search_summary/?lang=es_ar&format=json&data=${data}`,
    )
    const names: string[] = []
    const visit = (node: unknown) => {
      if (Array.isArray(node)) node.forEach(visit)
      else if (node && typeof node === 'object') {
        const record = node as Record<string, unknown>
        if (typeof record.name === 'string') names.push(record.name)
        Object.values(record).forEach(visit)
      }
    }
    visit(body)
    return { names: [...new Set(names)] }
  }

  async *properties(): AsyncIterable<TokkoProperty[]> {
    const data = encodeURIComponent(JSON.stringify({}))
    let offset = 0
    let previousFirstId: unknown
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const body = (await this.get(
        `/property/search/?format=json&limit=${PAGE_SIZE}&offset=${offset}&data=${data}`,
      )) as { objects?: unknown[] }
      const objects = Array.isArray(body?.objects) ? body.objects : []
      if (objects.length === 0) return
      // Si la API ignora `offset` devuelve siempre la misma página y el
      // recorrido no terminaría nunca (acumulando propiedades repetidas).
      const firstId = (objects[0] as { id?: unknown } | null)?.id
      if (firstId !== undefined && firstId === previousFirstId) return
      previousFirstId = firstId
      yield objects.flatMap((raw) => mapTokkoProperty(raw) ?? [])
      offset += objects.length
      await this.sleep(this.pauseMs)
    }
    throw new TokkoSourceError(
      `Tokko devolvió más de ${MAX_PAGES * PAGE_SIZE} propiedades: acotá el análisis o dividilo`,
    )
  }

  private async dictionary(endpoint: string): Promise<TokkoNamedItem[]> {
    const body = (await this.get(`/${endpoint}/?format=json&limit=500`)) as {
      objects?: { id?: unknown; name?: unknown }[]
    }
    return (Array.isArray(body?.objects) ? body.objects : []).flatMap((item) =>
      typeof item?.id === 'number' && typeof item?.name === 'string'
        ? [{ id: item.id, name: item.name }]
        : [],
    )
  }

  /** GET con la key, timeout y reintento ante 429/5xx. Devuelve el JSON. */
  private async get(path: string): Promise<unknown> {
    if (!this.apiKey) {
      throw new TokkoSourceError(
        'Falta configurar la API key de Tokko (TOKKO_API_KEY) en el servidor',
      )
    }
    const separator = path.includes('?') ? '&' : '?'
    const url = `${BASE_URL}${path}${separator}key=${encodeURIComponent(this.apiKey)}`

    for (let attempt = 0; ; attempt += 1) {
      let response: Response
      try {
        response = await this.fetchImpl(url, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      } catch {
        // El mensaje nativo puede traer la URL (con la key): no se reenvía.
        if (attempt < MAX_RETRIES) {
          await this.backoff(attempt)
          continue
        }
        throw new TokkoSourceError(
          'No se pudo conectar con Tokko: probá de nuevo en unos minutos',
        )
      }

      if (response.status === 401 || response.status === 403) {
        throw new TokkoSourceError(
          `Tokko respondió ${response.status}: revisá la API key`,
          response.status,
        )
      }
      const transient = response.status === 429 || response.status >= 500
      if (transient && attempt < MAX_RETRIES) {
        this.logger.warn(
          { status: response.status, attempt },
          'Tokko respondió un error transitorio; se reintenta',
        )
        await this.backoff(attempt)
        continue
      }
      if (!response.ok) {
        throw new TokkoSourceError(
          `Tokko respondió ${response.status}`,
          response.status,
        )
      }
      try {
        return await response.json()
      } catch {
        throw new TokkoSourceError(
          'La respuesta de Tokko no es JSON: la API cambió de formato',
        )
      }
    }
  }

  private backoff(attempt: number): Promise<void> {
    return this.sleep(this.retryBaseMs * 2 ** attempt)
  }
}
