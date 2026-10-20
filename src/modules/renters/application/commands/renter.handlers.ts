import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import {
  PortalAccountsFacade,
  PortalCredentials,
  Role,
} from '@/modules/auth/public'
import { GuarantorRepository } from '@/modules/renters/domain/guarantor.ports'
import { Renter } from '@/modules/renters/domain/renter'
import {
  InvalidGuarantorReferenceException,
  RenterEmailRequiredException,
  RenterHasActiveContractException,
  RenterNationalIdTakenException,
  RenterNotFoundException,
} from '@/modules/renters/domain/renter.exceptions'
import { RenterPolicy } from '@/modules/renters/domain/renter.policy'
import {
  RenterContracts,
  RenterPersonalData,
  RenterRepository,
} from '@/modules/renters/domain/renter.ports'
import { RenterDetailView, RenterViews } from '../renter.views'
import {
  CreateRenterCommand,
  DeleteRenterCommand,
  IssueRenterPortalCredentialsCommand,
  UpdateRenterCommand,
} from './renter.commands'

async function requireRenter(
  renters: RenterRepository,
  id: string,
): Promise<Renter> {
  const renter = await renters.findById(id)
  if (!renter) throw new RenterNotFoundException(id)
  return renter
}

/**
 * Chequeo previo al índice único parcial: da un error con nombre propio. Si
 * dos altas simultáneas pasan las dos, el índice frena a la segunda (409
 * genérico).
 */
async function assertNationalIdFree(
  renters: RenterRepository,
  nationalId: string,
  ownId?: string,
): Promise<void> {
  const holder = await renters.findByNationalId(nationalId)
  if (holder && holder.id !== ownId) {
    throw new RenterNationalIdTakenException(holder.id)
  }
}

/** Un garante sólo se asigna si existe en esta inmobiliaria (D-44). */
async function assertGuarantorExists(
  guarantors: GuarantorRepository,
  guarantorId: string | null | undefined,
): Promise<void> {
  if (guarantorId && !(await guarantors.findById(guarantorId))) {
    throw new InvalidGuarantorReferenceException()
  }
}

function normalizePersonal(
  data: Partial<RenterPersonalData>,
): Partial<RenterPersonalData> {
  const result: Partial<RenterPersonalData> = {}
  if (data.firstName !== undefined)
    result.firstName = RenterPolicy.normalizeName(data.firstName)
  if (data.lastName !== undefined)
    result.lastName = RenterPolicy.normalizeName(data.lastName)
  if (data.nationalId !== undefined)
    result.nationalId = RenterPolicy.normalizeNationalId(data.nationalId)
  if (data.phone !== undefined) result.phone = RenterPolicy.clean(data.phone)
  if (data.email !== undefined)
    result.email = RenterPolicy.normalizeEmail(data.email)
  if (data.address !== undefined)
    result.address = RenterPolicy.clean(data.address)
  if (data.moveInDate !== undefined)
    result.moveInDate = RenterPolicy.normalizeMoveInDate(data.moveInDate)
  if (data.notes !== undefined)
    result.notes = RenterPolicy.normalizeNotes(data.notes)
  if (data.guarantorId !== undefined) result.guarantorId = data.guarantorId
  return result
}

/** Alta (spec 3.1). El garante es opcional (spec 7). */
@CommandHandler(CreateRenterCommand)
export class CreateRenterHandler implements ICommandHandler<
  CreateRenterCommand,
  RenterDetailView
> {
  constructor(
    private readonly renters: RenterRepository,
    private readonly guarantors: GuarantorRepository,
    private readonly views: RenterViews,
  ) {}

  async execute(command: CreateRenterCommand): Promise<RenterDetailView> {
    const data = normalizePersonal(command.data) as RenterPersonalData
    await assertNationalIdFree(this.renters, data.nationalId)
    await assertGuarantorExists(this.guarantors, data.guarantorId)

    const renter = await this.renters.create(data)
    return this.views.detail(renter)
  }
}

/**
 * Edición (spec 3.1). Cambiar el garante es sensible (spec 7): queda en la
 * auditoría como cualquier otro cambio de columna, con el antes y el después.
 */
@CommandHandler(UpdateRenterCommand)
export class UpdateRenterHandler implements ICommandHandler<
  UpdateRenterCommand,
  RenterDetailView
> {
  constructor(
    private readonly renters: RenterRepository,
    private readonly guarantors: GuarantorRepository,
    private readonly views: RenterViews,
  ) {}

  async execute(command: UpdateRenterCommand): Promise<RenterDetailView> {
    const renter = await requireRenter(this.renters, command.id)
    const changes = normalizePersonal(command.changes)
    if (changes.nationalId && changes.nationalId !== renter.nationalId) {
      await assertNationalIdFree(this.renters, changes.nationalId, renter.id)
    }
    if (changes.guarantorId && changes.guarantorId !== renter.guarantorId) {
      await assertGuarantorExists(this.guarantors, changes.guarantorId)
    }

    const updated = await this.renters.update(renter.id, changes)
    return this.views.detail(updated)
  }
}

/**
 * Acceso al portal (spec 3.1), mismo patrón que propietarios: la primera vez
 * crea el usuario; las siguientes, le pone una contraseña nueva y la
 * anterior deja de servir.
 */
@CommandHandler(IssueRenterPortalCredentialsCommand)
export class IssueRenterPortalCredentialsHandler implements ICommandHandler<
  IssueRenterPortalCredentialsCommand,
  PortalCredentials
> {
  constructor(
    private readonly renters: RenterRepository,
    private readonly portalAccounts: PortalAccountsFacade,
  ) {}

  async execute(
    command: IssueRenterPortalCredentialsCommand,
  ): Promise<PortalCredentials> {
    const renter = await requireRenter(this.renters, command.id)
    if (!renter.email) throw new RenterEmailRequiredException()

    const credentials = await this.portalAccounts.issue({
      role: Role.RENTER,
      email: renter.email,
      firstName: renter.firstName,
      lastName: renter.lastName,
      userId: renter.portalUserId,
    })
    if (credentials.userId !== renter.portalUserId) {
      await this.renters.setPortalUser(renter.id, credentials.userId)
    }
    return credentials
  }
}

/**
 * Baja (spec 3.1): borrado lógico, sin contrato activo, y le corta el acceso
 * al portal.
 */
@CommandHandler(DeleteRenterCommand)
export class DeleteRenterHandler implements ICommandHandler<
  DeleteRenterCommand,
  void
> {
  constructor(
    private readonly renters: RenterRepository,
    private readonly contracts: RenterContracts,
    private readonly portalAccounts: PortalAccountsFacade,
  ) {}

  async execute(command: DeleteRenterCommand): Promise<void> {
    const renter = await requireRenter(this.renters, command.id)
    if (await this.contracts.hasActiveContract(renter.id)) {
      throw new RenterHasActiveContractException()
    }

    await this.renters.softDelete(renter.id)
    if (renter.portalUserId)
      await this.portalAccounts.disable(renter.portalUserId)
  }
}
