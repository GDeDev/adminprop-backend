import { Injectable } from '@nestjs/common'

import { ContractRef, ContractsFacade } from '@/modules/contracts/public'
import { Catalog, MasterDataFacade } from '@/modules/master-data/public'
import { PropertiesFacade, PropertyRef } from '@/modules/properties/public'
import {
  InvalidServiceContractException,
  InvalidServicePropertyException,
  InvalidServiceTypeException,
} from '../domain/service.exceptions'

/**
 * Valida por las facades de otros módulos lo que un servicio o un gasto
 * referencian: propiedad, contrato y tipo de servicio. Un id de otra
 * inmobiliaria es un id que no existe (D-44: 422 en un alta).
 */
@Injectable()
export class ServiceReferences {
  constructor(
    private readonly properties: PropertiesFacade,
    private readonly contracts: ContractsFacade,
    private readonly masterData: MasterDataFacade,
  ) {}

  async requireProperty(propertyId: string): Promise<PropertyRef> {
    const property = await this.properties.find(propertyId)
    if (!property) throw new InvalidServicePropertyException()
    return { id: property.id, address: property.address }
  }

  /**
   * El contrato existe y es de esa propiedad. Cualquier estado sirve: un
   * servicio puede cargarse sobre un contrato finalizado para dejar el
   * historial completo.
   */
  async requireContractOfProperty(
    contractId: string,
    propertyId: string,
  ): Promise<ContractRef> {
    const contract = await this.contracts.find(contractId)
    if (!contract || contract.propertyId !== propertyId) {
      throw new InvalidServiceContractException()
    }
    return contract
  }

  /** Como en propiedades (Fase 5, 4): un tipo desactivado no se elige en altas. */
  async assertServiceTypeSelectable(serviceTypeId: string): Promise<void> {
    const selectable = await this.masterData.areSelectable(
      Catalog.SERVICE_TYPES,
      [serviceTypeId],
    )
    if (!selectable) throw new InvalidServiceTypeException()
  }
}
