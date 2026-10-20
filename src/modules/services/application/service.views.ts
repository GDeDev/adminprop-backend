import { Injectable } from '@nestjs/common'

import {
  Catalog,
  MasterDataFacade,
  MasterDataRef,
} from '@/modules/master-data/public'
import { PropertiesFacade, PropertyRef } from '@/modules/properties/public'
import { IsoDate, todayIso } from '@/shared/dates/calendar-date'
import {
  Currency,
  IncreaseFrequency,
  PropertyService,
  ServicePayer,
  ServiceScope,
  ServiceStatus,
} from '../domain/property-service'
import { ServicePolicy } from '../domain/service.policy'

/** Un servicio tal como lo ve el cliente, con el estado calculado (D-64). */
export interface PropertyServiceView {
  id: string
  propertyId: string
  contractId: string | null
  /** Null sólo si el tipo desapareció del maestro (no debería pasar). */
  serviceType: MasterDataRef | null
  paidBy: ServicePayer
  currency: Currency
  hasDueDate: boolean
  dueDate: IsoDate | null
  hasIncrease: boolean
  increaseFrequency: IncreaseFrequency | null
  managedByAgency: boolean
  notes: string | null
  status: ServiceStatus
  /** Días desde el vencimiento; 0 si está al día. */
  daysOverdue: number
  createdAt: Date
  updatedAt: Date
}

/** Los servicios de un contrato: propios o heredados de la propiedad (D-66). */
export interface ContractServiceView extends PropertyServiceView {
  scope: ServiceScope
}

/** Para el dashboard de vencidos: con la propiedad a mano. */
export interface OverdueServiceView extends PropertyServiceView {
  property: PropertyRef
}

/**
 * Arma las vistas resolviendo el tipo de servicio y la propiedad por las
 * facades de sus módulos, en una consulta por módulo para toda la lista.
 */
@Injectable()
export class ServiceViews {
  constructor(
    private readonly masterData: MasterDataFacade,
    private readonly properties: PropertiesFacade,
  ) {}

  async one(service: PropertyService): Promise<PropertyServiceView> {
    const [view] = await this.many([service])
    return view
  }

  async many(services: PropertyService[]): Promise<PropertyServiceView[]> {
    if (services.length === 0) return []
    const types = await this.masterData.describeCatalog(
      Catalog.SERVICE_TYPES,
      services.map((s) => s.serviceTypeId),
    )
    const today = todayIso()
    return services.map((service) => toView(service, types, today))
  }

  async forContract(
    services: PropertyService[],
    contractId: string,
  ): Promise<ContractServiceView[]> {
    const views = await this.many(services)
    return views.map((view) => ({
      ...view,
      scope:
        view.contractId === contractId
          ? ServiceScope.CONTRACT
          : ServiceScope.PROPERTY,
    }))
  }

  /**
   * Vencidos con su propiedad. Los de una propiedad borrada se omiten (D-68):
   * propiedades no avisa a servicios cuando se borra una.
   */
  async overdue(services: PropertyService[]): Promise<OverdueServiceView[]> {
    const [views, properties] = await Promise.all([
      this.many(services),
      this.properties.describe(services.map((s) => s.propertyId)),
    ])
    return views.flatMap((view) => {
      const property = properties.get(view.propertyId)
      return property ? [{ ...view, property }] : []
    })
  }
}

function toView(
  service: PropertyService,
  types: Map<string, MasterDataRef>,
  today: IsoDate,
): PropertyServiceView {
  return {
    id: service.id,
    propertyId: service.propertyId,
    contractId: service.contractId,
    serviceType: types.get(service.serviceTypeId) ?? null,
    paidBy: service.paidBy,
    currency: service.currency,
    hasDueDate: service.hasDueDate,
    dueDate: service.dueDate,
    hasIncrease: service.hasIncrease,
    increaseFrequency: service.increaseFrequency,
    managedByAgency: service.managedByAgency,
    notes: service.notes,
    status: ServicePolicy.status(service.hasDueDate, service.dueDate, today),
    daysOverdue: ServicePolicy.daysOverdue(
      service.hasDueDate,
      service.dueDate,
      today,
    ),
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  }
}
