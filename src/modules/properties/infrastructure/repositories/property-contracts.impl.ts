import { Injectable } from '@nestjs/common'

import {
  PropertyContracts,
  PropertyRepository,
} from '@/modules/properties/domain/property.ports'

/**
 * Responde con el vínculo que el módulo de contratos deja en la propiedad
 * (`activeContractId`, `lastContractId`) por `PropertiesFacade`. Así las
 * reglas de propiedades saben de contratos sin importar ese módulo (D-51).
 */
@Injectable()
export class PropertyContractsImpl extends PropertyContracts {
  constructor(private readonly properties: PropertyRepository) {
    super()
  }

  async hasActiveContract(propertyId: string): Promise<boolean> {
    const property = await this.properties.findById(propertyId)
    return property?.activeContractId != null
  }

  async hasContractHistory(propertyId: string): Promise<boolean> {
    const property = await this.properties.findById(propertyId)
    return property?.lastContractId != null
  }
}
