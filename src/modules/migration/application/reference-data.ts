import { Injectable } from '@nestjs/common'

import { Catalog, MasterDataFacade } from '@/modules/master-data/public'
import { normalizeText } from '../domain/import-normalizers'
import { LocationIndex } from '../domain/location-index'
import { ValidationContext } from '../domain/row-validators'

export interface ReferenceData {
  context: ValidationContext
  /** Nombres normalizados de los amenities existentes. */
  amenities: Set<string>
}

/** Los maestros del tenant, listos para validar filas sin tocar la base. */
@Injectable()
export class ReferenceDataLoader {
  constructor(private readonly masters: MasterDataFacade) {}

  async load(): Promise<ReferenceData> {
    const [locations, types, amenities] = await Promise.all([
      this.masters.listLocationNodes(),
      this.masters.listCatalogItems(Catalog.PROPERTY_TYPES),
      this.masters.listCatalogItems(Catalog.AMENITIES),
    ])
    return {
      context: {
        locations: new LocationIndex(locations),
        propertyTypes: new Map(types.map((t) => [normalizeText(t.name), t.id])),
      },
      amenities: new Set(amenities.map((a) => normalizeText(a.name))),
    }
  }
}
