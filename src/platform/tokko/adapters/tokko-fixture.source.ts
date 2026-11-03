import {
  TOKKO_FIXTURE_DICTIONARIES,
  TOKKO_FIXTURE_LOCATIONS,
  TOKKO_FIXTURE_PROPERTIES,
} from '../fixtures/tokko-fixture-data'
import {
  TokkoDictionaries,
  TokkoLocationSummary,
  TokkoProperty,
  TokkoSourcePort,
} from '../tokko-source.port'
import { mapTokkoProperty } from './tokko-mapper'

const PAGE_SIZE = 20

/**
 * `TOKKO_SOURCE=fixture`: sirve la muestra incluida, pasada por el mismo
 * mapper que la API real, así los tests ejercitan el mapeo de verdad.
 */
export class TokkoFixtureSource extends TokkoSourcePort {
  readonly provider = 'fixture'

  constructor(private readonly raw: unknown[] = TOKKO_FIXTURE_PROPERTIES) {
    super()
  }

  dictionaries(): Promise<TokkoDictionaries> {
    return Promise.resolve({
      propertyTypes: TOKKO_FIXTURE_DICTIONARIES.property_type,
      propertyTags: TOKKO_FIXTURE_DICTIONARIES.property_tags,
      operationTypes: TOKKO_FIXTURE_DICTIONARIES.operation_type,
    })
  }

  locationsSummary(): Promise<TokkoLocationSummary> {
    return Promise.resolve({ names: TOKKO_FIXTURE_LOCATIONS })
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async *properties(): AsyncIterable<TokkoProperty[]> {
    for (let offset = 0; offset < this.raw.length; offset += PAGE_SIZE) {
      yield this.raw
        .slice(offset, offset + PAGE_SIZE)
        .flatMap((item) => mapTokkoProperty(item) ?? [])
    }
  }
}
