import { Injectable } from '@nestjs/common'

import { Catalog, MasterDataFacade } from '@/modules/master-data/public'
import { Property } from '../domain/property'

/**
 * Nombre del tipo de cada propiedad (portal, Fase 18). Aparte de
 * `PropertyViews` para que la facade no dependa de propietarios.
 */
@Injectable()
export class PropertyTypeNames {
  constructor(private readonly masterData: MasterDataFacade) {}

  async of(properties: Property[]): Promise<Map<string, string>> {
    const types = await this.masterData.describeCatalog(
      Catalog.PROPERTY_TYPES,
      properties.map((p) => p.propertyTypeId),
    )
    return new Map(
      properties.flatMap((property) => {
        const type = types.get(property.propertyTypeId)
        return type ? [[property.id, type.name] as [string, string]] : []
      }),
    )
  }
}
