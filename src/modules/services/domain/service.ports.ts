import { IsoDate } from '@/shared/dates/calendar-date'
import {
  Currency,
  IncreaseFrequency,
  PropertyService,
  ServicePayer,
} from './property-service'

export interface NewPropertyService {
  propertyId: string
  contractId: string | null
  serviceTypeId: string
  paidBy: ServicePayer
  currency: Currency
  hasDueDate: boolean
  dueDate: IsoDate | null
  hasIncrease: boolean
  increaseFrequency: IncreaseFrequency | null
  managedByAgency: boolean
  notes: string | null
}

/** Todo es editable salvo la propiedad: un servicio no se muda de propiedad. */
export type PropertyServiceChanges = Partial<
  Omit<NewPropertyService, 'propertyId'>
>

export interface PageArgs {
  skip: number
  take: number
}

/**
 * Puerto del repositorio de servicios. Todo corre dentro del tenant del
 * contexto; el borrado es lógico (lo hace la extensión de Prisma).
 */
export abstract class PropertyServiceRepository {
  abstract create(data: NewPropertyService): Promise<PropertyService>

  abstract findById(id: string): Promise<PropertyService | null>

  /** Los de la propiedad, opcionalmente sólo los de un contrato. Por alta. */
  abstract listByProperty(
    propertyId: string,
    contractId?: string,
  ): Promise<PropertyService[]>

  /**
   * Los que aplican a un contrato: los suyos más los de la propiedad sin
   * contrato (D-66).
   */
  abstract listForContract(
    propertyId: string,
    contractId: string,
  ): Promise<PropertyService[]>

  /** Vencidos a esa fecha, los más atrasados primero. */
  abstract listOverdue(
    today: IsoDate,
    filter: { propertyId?: string },
    page?: PageArgs,
  ): Promise<[PropertyService[], number]>

  abstract countByProperty(propertyId: string): Promise<number>

  abstract update(
    id: string,
    changes: PropertyServiceChanges,
  ): Promise<PropertyService>

  abstract delete(id: string): Promise<void>
}
