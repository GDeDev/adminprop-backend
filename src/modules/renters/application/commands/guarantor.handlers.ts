import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import { Guarantor } from '@/modules/renters/domain/guarantor'
import {
  GuarantorInUseException,
  GuarantorNationalIdTakenException,
  GuarantorNotFoundException,
} from '@/modules/renters/domain/guarantor.exceptions'
import { GuarantorPolicy } from '@/modules/renters/domain/guarantor.policy'
import {
  GuarantorData,
  GuarantorRepository,
} from '@/modules/renters/domain/guarantor.ports'
import { RenterRepository } from '@/modules/renters/domain/renter.ports'
import { GuarantorDetailView, RenterViews } from '../renter.views'
import {
  CreateGuarantorCommand,
  DeleteGuarantorCommand,
  UpdateGuarantorCommand,
} from './guarantor.commands'

async function requireGuarantor(
  guarantors: GuarantorRepository,
  id: string,
): Promise<Guarantor> {
  const guarantor = await guarantors.findById(id)
  if (!guarantor) throw new GuarantorNotFoundException(id)
  return guarantor
}

/** Chequeo previo al índice único parcial, como en inquilinos. */
async function assertNationalIdFree(
  guarantors: GuarantorRepository,
  nationalId: string,
  ownId?: string,
): Promise<void> {
  const holder = await guarantors.findByNationalId(nationalId)
  if (holder && holder.id !== ownId) {
    throw new GuarantorNationalIdTakenException(holder.id)
  }
}

function normalize(data: Partial<GuarantorData>): Partial<GuarantorData> {
  const result: Partial<GuarantorData> = {}
  if (data.firstName !== undefined)
    result.firstName = GuarantorPolicy.normalizeName(data.firstName)
  if (data.lastName !== undefined)
    result.lastName = GuarantorPolicy.normalizeName(data.lastName)
  if (data.nationalId !== undefined)
    result.nationalId = GuarantorPolicy.normalizeNationalId(data.nationalId)
  if (data.phone !== undefined) result.phone = GuarantorPolicy.clean(data.phone)
  if (data.email !== undefined)
    result.email = GuarantorPolicy.normalizeEmail(data.email)
  if (data.address !== undefined)
    result.address = GuarantorPolicy.clean(data.address)
  if (data.guaranteeType !== undefined)
    result.guaranteeType = data.guaranteeType
  if (data.guaranteeDetail !== undefined)
    result.guaranteeDetail = GuarantorPolicy.normalizeGuaranteeDetail(
      data.guaranteeDetail,
    )
  if (data.notes !== undefined)
    result.notes = GuarantorPolicy.normalizeNotes(data.notes)
  return result
}

/** Alta (spec 3.2). */
@CommandHandler(CreateGuarantorCommand)
export class CreateGuarantorHandler implements ICommandHandler<
  CreateGuarantorCommand,
  GuarantorDetailView
> {
  constructor(
    private readonly guarantors: GuarantorRepository,
    private readonly views: RenterViews,
  ) {}

  async execute(command: CreateGuarantorCommand): Promise<GuarantorDetailView> {
    const data = normalize(command.data) as GuarantorData
    await assertNationalIdFree(this.guarantors, data.nationalId)

    const guarantor = await this.guarantors.create(data)
    return this.views.guarantorDetail(guarantor)
  }
}

/** Edición (spec 3.2). */
@CommandHandler(UpdateGuarantorCommand)
export class UpdateGuarantorHandler implements ICommandHandler<
  UpdateGuarantorCommand,
  GuarantorDetailView
> {
  constructor(
    private readonly guarantors: GuarantorRepository,
    private readonly views: RenterViews,
  ) {}

  async execute(command: UpdateGuarantorCommand): Promise<GuarantorDetailView> {
    const guarantor = await requireGuarantor(this.guarantors, command.id)
    const changes = normalize(command.changes)
    if (changes.nationalId && changes.nationalId !== guarantor.nationalId) {
      await assertNationalIdFree(
        this.guarantors,
        changes.nationalId,
        guarantor.id,
      )
    }

    const updated = await this.guarantors.update(guarantor.id, changes)
    return this.views.guarantorDetail(updated)
  }
}

/**
 * Baja (spec 3.2): borrado lógico. La spec bloquea sólo con contrato activo;
 * se bloquea con cualquier inquilino que lo tenga de garante, para no dejar
 * inquilinos apuntando a un garante borrado (D-45, mismo criterio que D-38).
 */
@CommandHandler(DeleteGuarantorCommand)
export class DeleteGuarantorHandler implements ICommandHandler<
  DeleteGuarantorCommand,
  void
> {
  constructor(
    private readonly guarantors: GuarantorRepository,
    private readonly renters: RenterRepository,
  ) {}

  async execute(command: DeleteGuarantorCommand): Promise<void> {
    const guarantor = await requireGuarantor(this.guarantors, command.id)
    const count =
      (await this.renters.countByGuarantors([guarantor.id])).get(
        guarantor.id,
      ) ?? 0
    if (count > 0) throw new GuarantorInUseException(count)

    await this.guarantors.softDelete(guarantor.id)
  }
}
