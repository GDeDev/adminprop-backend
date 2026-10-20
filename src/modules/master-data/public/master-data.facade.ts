import { Injectable } from '@nestjs/common'

import { Catalog } from '../domain/catalog'
import {
  CatalogRepository,
  LocationRepository,
} from '../domain/master-data.repositories'

/**
 * Lo que otros módulos pueden preguntarle a los maestros. La Fase 6
 * (Propiedades) lo usa para validar que el tipo, la ubicación y las amenities
 * elegidos en un alta existan y estén activos (spec 4: uno desactivado no se
 * puede elegir en altas nuevas, pero sigue valiendo en los registros viejos).
 *
 * Corre dentro del tenant del contexto: un id de otra inmobiliaria no existe.
 */
@Injectable()
export class MasterDataFacade {
  constructor(
    private readonly catalogs: CatalogRepository,
    private readonly locations: LocationRepository,
  ) {}

  /** Si todos los ids existen y están activos. Con lista vacía, `true`. */
  async areSelectable(catalog: Catalog, ids: string[]): Promise<boolean> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return true
    return (await this.catalogs.countActive(catalog, unique)) === unique.length
  }

  async isSelectableLocation(id: string): Promise<boolean> {
    const location = await this.locations.findById(id)
    return location?.isActive ?? false
  }
}
