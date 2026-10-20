import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import {
  PortalAccountsFacade,
  PortalCredentials,
  Role,
} from '@/modules/auth/public'
import { PropertiesFacade } from '@/modules/properties/public/properties.facade'
import { Owner } from '@/modules/owners/domain/owner'
import {
  OwnerEmailRequiredException,
  OwnerHasPropertiesException,
  OwnerNationalIdTakenException,
  OwnerNotFoundException,
} from '@/modules/owners/domain/owner.exceptions'
import { OwnerPolicy } from '@/modules/owners/domain/owner.policy'
import {
  OwnerPersonalData,
  OwnerRepository,
} from '@/modules/owners/domain/owner.ports'
import { OwnerDetailView, OwnerViews } from '../owner.views'
import {
  CreateOwnerCommand,
  DeleteOwnerCommand,
  IssueOwnerPortalCredentialsCommand,
  UpdateOwnerBankAccountCommand,
  UpdateOwnerCommand,
} from './owner.commands'

async function requireOwner(
  owners: OwnerRepository,
  id: string,
): Promise<Owner> {
  const owner = await owners.findById(id)
  if (!owner) throw new OwnerNotFoundException(id)
  return owner
}

/**
 * Chequeo previo al índice único parcial: da un error con nombre propio. Si
 * dos altas simultáneas pasan las dos, el índice frena a la segunda (409
 * genérico).
 */
async function assertNationalIdFree(
  owners: OwnerRepository,
  nationalId: string,
  ownId?: string,
): Promise<void> {
  const holder = await owners.findByNationalId(nationalId)
  if (holder && holder.id !== ownId) {
    throw new OwnerNationalIdTakenException(holder.id)
  }
}

function normalizePersonal(
  data: Partial<OwnerPersonalData>,
): Partial<OwnerPersonalData> {
  const result: Partial<OwnerPersonalData> = {}
  if (data.firstName !== undefined)
    result.firstName = OwnerPolicy.normalizeName(data.firstName)
  if (data.lastName !== undefined)
    result.lastName = OwnerPolicy.normalizeName(data.lastName)
  if (data.nationalId !== undefined)
    result.nationalId = OwnerPolicy.normalizeNationalId(data.nationalId)
  if (data.phone !== undefined) result.phone = OwnerPolicy.clean(data.phone)
  if (data.email !== undefined)
    result.email = OwnerPolicy.normalizeEmail(data.email)
  if (data.address !== undefined)
    result.address = OwnerPolicy.clean(data.address)
  // Las notas conservan los saltos de línea.
  if (data.notes !== undefined) result.notes = data.notes?.trim() || null
  return result
}

/** Alta (spec 3.1). Los datos bancarios pueden venir o cargarse después. */
@CommandHandler(CreateOwnerCommand)
export class CreateOwnerHandler implements ICommandHandler<
  CreateOwnerCommand,
  OwnerDetailView
> {
  constructor(
    private readonly owners: OwnerRepository,
    private readonly views: OwnerViews,
  ) {}

  async execute(command: CreateOwnerCommand): Promise<OwnerDetailView> {
    const data = normalizePersonal(command.data) as OwnerPersonalData
    const bankAccount = OwnerPolicy.normalizeBankAccount(command.bankAccount)
    await assertNationalIdFree(this.owners, data.nationalId)

    const owner = await this.owners.create({ ...data, bankAccount })
    return this.views.detail(owner)
  }
}

/** Edición de los datos personales (spec 3.4). */
@CommandHandler(UpdateOwnerCommand)
export class UpdateOwnerHandler implements ICommandHandler<
  UpdateOwnerCommand,
  OwnerDetailView
> {
  constructor(
    private readonly owners: OwnerRepository,
    private readonly views: OwnerViews,
  ) {}

  async execute(command: UpdateOwnerCommand): Promise<OwnerDetailView> {
    const owner = await requireOwner(this.owners, command.id)
    const changes = normalizePersonal(command.changes)
    if (changes.nationalId && changes.nationalId !== owner.nationalId) {
      await assertNationalIdFree(this.owners, changes.nationalId, owner.id)
    }

    const updated = await this.owners.update(owner.id, changes)
    return this.views.detail(updated)
  }
}

/**
 * Cuenta bancaria (spec 3.5). Endpoint aparte para que un cambio de CBU —una
 * acción de riesgo de fraude— sea fácil de encontrar en la auditoría: queda
 * como su propio registro, sin mezclarse con un cambio de teléfono.
 */
@CommandHandler(UpdateOwnerBankAccountCommand)
export class UpdateOwnerBankAccountHandler implements ICommandHandler<
  UpdateOwnerBankAccountCommand,
  OwnerDetailView
> {
  constructor(
    private readonly owners: OwnerRepository,
    private readonly views: OwnerViews,
  ) {}

  async execute(
    command: UpdateOwnerBankAccountCommand,
  ): Promise<OwnerDetailView> {
    const owner = await requireOwner(this.owners, command.id)
    const account = OwnerPolicy.normalizeBankAccount(command.bankAccount)
    const updated = await this.owners.updateBankAccount(owner.id, account)
    return this.views.detail(updated)
  }
}

/**
 * Acceso al portal (spec 3.6). La primera vez crea el usuario; las
 * siguientes, le pone una contraseña nueva y la anterior deja de servir.
 */
@CommandHandler(IssueOwnerPortalCredentialsCommand)
export class IssueOwnerPortalCredentialsHandler implements ICommandHandler<
  IssueOwnerPortalCredentialsCommand,
  PortalCredentials
> {
  constructor(
    private readonly owners: OwnerRepository,
    private readonly portalAccounts: PortalAccountsFacade,
  ) {}

  async execute(
    command: IssueOwnerPortalCredentialsCommand,
  ): Promise<PortalCredentials> {
    const owner = await requireOwner(this.owners, command.id)
    if (!owner.email) throw new OwnerEmailRequiredException()

    const credentials = await this.portalAccounts.issue({
      role: Role.OWNER,
      email: owner.email,
      firstName: owner.firstName,
      lastName: owner.lastName,
      userId: owner.portalUserId,
    })
    if (credentials.userId !== owner.portalUserId) {
      await this.owners.setPortalUser(owner.id, credentials.userId)
    }
    return credentials
  }
}

/**
 * Baja (spec 3.7): borrado lógico, sin propiedades a cargo, y le corta el
 * acceso al portal.
 */
@CommandHandler(DeleteOwnerCommand)
export class DeleteOwnerHandler implements ICommandHandler<
  DeleteOwnerCommand,
  void
> {
  constructor(
    private readonly owners: OwnerRepository,
    private readonly properties: PropertiesFacade,
    private readonly portalAccounts: PortalAccountsFacade,
  ) {}

  async execute(command: DeleteOwnerCommand): Promise<void> {
    const owner = await requireOwner(this.owners, command.id)
    const portfolio = (await this.properties.portfolios([owner.id])).get(
      owner.id,
    )
    // La spec pide bloquear sólo con contratos activos. Se bloquea con
    // cualquier propiedad asignada: si no, quedarían propiedades apuntando a
    // un propietario borrado (D-38).
    if (portfolio && portfolio.total > 0) {
      throw new OwnerHasPropertiesException(portfolio.total)
    }

    await this.owners.softDelete(owner.id)
    if (owner.portalUserId)
      await this.portalAccounts.disable(owner.portalUserId)
  }
}
