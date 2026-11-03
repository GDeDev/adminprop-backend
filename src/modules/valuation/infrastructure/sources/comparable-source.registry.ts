import { ConfigService } from '@nestjs/config'

import { Configuration } from '@/shared/config/configuration'
import {
  ComparableSourcePort,
  ComparableSourceRegistry,
} from '../../domain/valuation.ports'
import { FakeComparableSource } from './fake.source'
import { PageFetcher } from './page-fetcher'
import {
  ArgenpropSource,
  MercadoLibreSource,
  ZonapropSource,
} from './portal.sources'

/** Las fuentes que pide `COMPARABLES_SOURCES`, en ese orden. */
export class ConfiguredSourceRegistry extends ComparableSourceRegistry {
  private readonly sources: ComparableSourcePort[]

  constructor(config: ConfigService<Configuration, true>) {
    super()
    const { sources, scraperContact } = config.get('valuation', { infer: true })
    const fetcher = new PageFetcher({ contact: scraperContact })
    const byName: Record<string, () => ComparableSourcePort> = {
      fake: () => new FakeComparableSource(),
      zonaprop: () => new ZonapropSource(fetcher),
      argenprop: () => new ArgenpropSource(fetcher),
      mercadolibre: () => new MercadoLibreSource(fetcher),
    }
    this.sources = sources.flatMap((name) =>
      byName[name] ? [byName[name]()] : [],
    )
  }

  list(): ComparableSourcePort[] {
    return this.sources
  }
}
