import {
  Currency,
  IncreaseFrequency,
  ServicePayer,
} from '@/modules/services/domain/property-service'

/** Un servicio tal como lo manda el cliente. */
export interface ServiceData {
  contractId: string | null
  serviceTypeId: string
  paidBy: ServicePayer
  currency: Currency
  hasDueDate: boolean
  dueDate: string | null
  hasIncrease: boolean
  increaseFrequency: IncreaseFrequency | null
  managedByAgency: boolean
  notes: string | null
}

export class CreateServiceCommand {
  constructor(
    public readonly propertyId: string,
    public readonly data: ServiceData,
  ) {}
}

export class UpdateServiceCommand {
  constructor(
    public readonly id: string,
    public readonly changes: Partial<ServiceData>,
  ) {}
}

export class DeleteServiceCommand {
  constructor(public readonly id: string) {}
}
