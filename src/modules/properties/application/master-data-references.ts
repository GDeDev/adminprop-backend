import { Injectable } from '@nestjs/common'

import {
  Catalog,
  LocationLevel,
  MasterDataFacade,
} from '@/modules/master-data/public'
import { InvalidMasterDataReferenceException } from '../domain/property.exceptions'

/**
 * Una propiedad apunta al nivel más específico (PRD 5.1: "generalmente Barrio
 * o Localidad"). Un país o una provincia no dicen dónde está.
 */
const PROPERTY_LOCATION_LEVELS = [
  LocationLevel.CITY,
  LocationLevel.NEIGHBORHOOD,
]

/**
 * Valida contra los maestros lo que se elige en un alta o un cambio: que
 * exista (en esta inmobiliaria) y esté activo. Sólo se valida lo que cambia:
 * una propiedad vieja puede conservar un maestro que después se desactivó.
 */
@Injectable()
export class MasterDataReferences {
  constructor(private readonly masterData: MasterDataFacade) {}

  async assertSelectable(refs: {
    locationId?: string
    propertyTypeId?: string
    amenityIds?: string[]
  }): Promise<void> {
    if (refs.locationId !== undefined) {
      const location = await this.masterData.getLocation(refs.locationId)
      if (!location?.isActive) {
        throw new InvalidMasterDataReferenceException(
          'locationId',
          'La ubicación no existe o está desactivada',
        )
      }
      if (!PROPERTY_LOCATION_LEVELS.includes(location.level)) {
        throw new InvalidMasterDataReferenceException(
          'locationId',
          'Elegí una localidad o un barrio',
        )
      }
    }

    if (
      refs.propertyTypeId !== undefined &&
      !(await this.masterData.areSelectable(Catalog.PROPERTY_TYPES, [
        refs.propertyTypeId,
      ]))
    ) {
      throw new InvalidMasterDataReferenceException(
        'propertyTypeId',
        'El tipo de propiedad no existe o está desactivado',
      )
    }

    if (
      refs.amenityIds !== undefined &&
      !(await this.masterData.areSelectable(Catalog.AMENITIES, refs.amenityIds))
    ) {
      throw new InvalidMasterDataReferenceException(
        'amenityIds',
        'Alguna amenity no existe o está desactivada',
      )
    }
  }
}
