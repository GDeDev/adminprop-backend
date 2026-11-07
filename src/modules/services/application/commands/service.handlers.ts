import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import { PropertyService } from '@/modules/services/domain/property-service'
import { ServiceNotFoundException } from '@/modules/services/domain/service.exceptions'
import { ServicePolicy } from '@/modules/services/domain/service.policy'
import {
  NewPropertyService,
  PropertyServiceChanges,
  PropertyServiceRepository,
} from '@/modules/services/domain/service.ports'
import { PersonPolicy } from '@/shared/people/person-policy'
import { ServiceReferences } from '../service-references'
import { PropertyServiceView, ServiceViews } from '../service.views'
import {
  CreateServiceCommand,
  DeleteServiceCommand,
  UpdateServiceCommand,
} from './service.commands'

export async function requireService(
  services: PropertyServiceRepository,
  id: string,
): Promise<PropertyService> {
  const service = await services.findById(id)
  if (!service) throw new ServiceNotFoundException(id)
  return service
}

/**
 * Alta (spec 3.1). La propiedad tiene que existir; el contrato, si viene,
 * ser de esa propiedad; el tipo, existir y estar activo. Sin contrato es un
 * servicio de la propiedad, que sus contratos heredan (D-66).
 */
@CommandHandler(CreateServiceCommand)
export class CreateServiceHandler implements ICommandHandler<
  CreateServiceCommand,
  PropertyServiceView
> {
  constructor(
    private readonly services: PropertyServiceRepository,
    private readonly references: ServiceReferences,
    private readonly views: ServiceViews,
  ) {}

  async execute(command: CreateServiceCommand): Promise<PropertyServiceView> {
    const { data } = command
    const schedule = ServicePolicy.normalizeSchedule(data)
    const property = await this.references.requireProperty(command.propertyId)
    if (data.contractId) {
      await this.references.requireContractOfProperty(
        data.contractId,
        property.id,
      )
    }
    await this.references.assertServiceTypeSelectable(data.serviceTypeId)

    const created = await this.services.create({
      ...schedule,
      propertyId: property.id,
      contractId: data.contractId,
      serviceTypeId: data.serviceTypeId,
      paidBy: data.paidBy,
      currency: data.currency,
      managedByAgency: data.managedByAgency,
      notes: PersonPolicy.normalizeNotes(data.notes),
    } satisfies NewPropertyService)
    return this.views.one(created)
  }
}

/**
 * Edición (spec 3.1): todo menos la propiedad. Las reglas del vencimiento y
 * los aumentos se evalúan sobre el servicio resultante: marcar "con
 * vencimiento" sin mandar la fecha es error aunque antes no la tuviera. Sólo
 * se valida lo que cambia: un servicio viejo conserva un tipo que después
 * se desactivó (Fase 5, 4).
 */
@CommandHandler(UpdateServiceCommand)
export class UpdateServiceHandler implements ICommandHandler<
  UpdateServiceCommand,
  PropertyServiceView
> {
  constructor(
    private readonly services: PropertyServiceRepository,
    private readonly references: ServiceReferences,
    private readonly views: ServiceViews,
  ) {}

  async execute(command: UpdateServiceCommand): Promise<PropertyServiceView> {
    const current = await requireService(this.services, command.id)
    const { changes } = command
    const next: PropertyServiceChanges = {}

    const scheduleTouched =
      changes.hasDueDate !== undefined ||
      changes.dueDate !== undefined ||
      changes.hasIncrease !== undefined ||
      changes.increaseFrequency !== undefined
    if (scheduleTouched) {
      Object.assign(
        next,
        ServicePolicy.normalizeSchedule({
          hasDueDate: changes.hasDueDate ?? current.hasDueDate,
          dueDate:
            changes.dueDate === undefined ? current.dueDate : changes.dueDate,
          hasIncrease: changes.hasIncrease ?? current.hasIncrease,
          increaseFrequency:
            changes.increaseFrequency === undefined
              ? current.increaseFrequency
              : changes.increaseFrequency,
        }),
      )
    }

    if (
      changes.contractId !== undefined &&
      changes.contractId !== current.contractId
    ) {
      if (changes.contractId) {
        await this.references.requireContractOfProperty(
          changes.contractId,
          current.propertyId,
        )
      }
      next.contractId = changes.contractId
    }
    if (
      changes.serviceTypeId !== undefined &&
      changes.serviceTypeId !== current.serviceTypeId
    ) {
      await this.references.assertServiceTypeSelectable(changes.serviceTypeId)
      next.serviceTypeId = changes.serviceTypeId
    }
    if (changes.paidBy !== undefined) next.paidBy = changes.paidBy
    if (changes.currency !== undefined) next.currency = changes.currency
    if (changes.managedByAgency !== undefined) {
      next.managedByAgency = changes.managedByAgency
    }
    if (changes.notes !== undefined) {
      next.notes = PersonPolicy.normalizeNotes(changes.notes)
    }

    const updated = await this.services.update(current.id, next)
    return this.views.one(updated)
  }
}

/** Spec 3.1: borrado lógico. Admin y empleado. */
@CommandHandler(DeleteServiceCommand)
export class DeleteServiceHandler implements ICommandHandler<
  DeleteServiceCommand,
  void
> {
  constructor(private readonly services: PropertyServiceRepository) {}

  async execute(command: DeleteServiceCommand): Promise<void> {
    const service = await requireService(this.services, command.id)
    await this.services.delete(service.id)
  }
}
