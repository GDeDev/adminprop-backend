import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { randomUUID } from 'node:crypto'

import {
  Contract,
  ContractStatus,
  currentRentOf,
  RentUpdateSource,
  RentUpdateType,
} from '@/modules/contracts/domain/contract'
import {
  ContractNotActiveException,
  ContractNotFoundException,
  IndexMissingException,
  InvalidContractDocumentException,
  RentUpdateNotDueException,
} from '@/modules/contracts/domain/contract.exceptions'
import { ContractPolicy } from '@/modules/contracts/domain/contract.policy'
import {
  ContractRepository,
  NewContract,
  SuretyData,
} from '@/modules/contracts/domain/contract.ports'
import { IndexType, IndicesFacade } from '@/modules/indices/public'
import { PropertiesFacade } from '@/modules/properties/public'
import { RentersFacade } from '@/modules/renters/public'
import { StoragePort } from '@/platform/storage/storage.port'
import { RequestContext } from '@/shared/context/request-context'
import { errorMessage } from '@/shared/core/error-message'
import { periodOf, todayIso } from '@/shared/dates/calendar-date'
import { createLogger } from '@/shared/logging/root-logger'
import { toMoneyString } from '@/shared/money'
import { PersonPolicy } from '@/shared/people/person-policy'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { ContractParties } from '../contract-parties'
import {
  ContractDetailView,
  ContractTerminationView,
  ContractViews,
} from '../contract.views'
import {
  ApplyRentUpdateCommand,
  ContractTerms,
  CreateContractCommand,
  RenewContractCommand,
  TerminateContractCommand,
  UpdateContractCommand,
  UploadContractDocumentCommand,
} from './contract.commands'

export async function requireContract(
  contracts: ContractRepository,
  id: string,
): Promise<Contract> {
  const contract = await contracts.findById(id)
  if (!contract) throw new ContractNotFoundException(id)
  return contract
}

function requireActive(contract: Contract): void {
  if (contract.status !== ContractStatus.ACTIVE) {
    throw new ContractNotActiveException(contract.status)
  }
}

/** Limpia la caución y aplica la regla del email (spec 3.1). */
function normalizeSurety(surety: SuretyData): SuretyData {
  const result: SuretyData = {
    hasSurety: surety.hasSurety,
    insurerName: PersonPolicy.clean(surety.insurerName),
    insurerAlertEmail: PersonPolicy.normalizeEmail(surety.insurerAlertEmail),
    policyNumber: PersonPolicy.clean(surety.policyNumber),
    policyExpiresAt: surety.policyExpiresAt
      ? ContractPolicy.normalizeDate(surety.policyExpiresAt, 'policyExpiresAt')
      : null,
  }
  ContractPolicy.assertSurety(result.hasSurety, result.insurerAlertEmail)
  return result
}

/** Las condiciones económicas y las fechas, validadas y normalizadas. */
function normalizeTerms(terms: ContractTerms) {
  const startDate = ContractPolicy.normalizeDate(terms.startDate, 'startDate')
  const endDate = ContractPolicy.normalizeDate(terms.endDate, 'endDate')
  ContractPolicy.assertDates(startDate, endDate)
  return {
    startDate,
    endDate,
    initialRent: toMoneyString(terms.initialRent),
    currency: terms.currency,
    rentUpdateType: terms.rentUpdateType,
    rentUpdateFrequency: terms.rentUpdateFrequency,
    deposit: toMoneyString(terms.deposit),
    notes: PersonPolicy.normalizeNotes(terms.notes),
    surety: normalizeSurety(terms.surety),
  }
}

/**
 * Alta (spec 3.1). El propietario sale de la propiedad, el garante del
 * inquilino si no se indica otro, y los honorarios del estado del
 * propietario en este momento. Crear el contrato, su canon inicial y marcar
 * propiedad e inquilino es una sola transacción (D-52).
 */
@CommandHandler(CreateContractCommand)
export class CreateContractHandler implements ICommandHandler<
  CreateContractCommand,
  ContractDetailView
> {
  constructor(
    private readonly contracts: ContractRepository,
    private readonly parties: ContractParties,
    private readonly properties: PropertiesFacade,
    private readonly renters: RentersFacade,
    private readonly prisma: PrismaService,
    private readonly views: ContractViews,
  ) {}

  async execute(command: CreateContractCommand): Promise<ContractDetailView> {
    const terms = normalizeTerms(command.terms)
    const property = await this.parties.requireProperty(command.propertyId)
    const renter = await this.parties.requireRenter(command.renterId)
    const guarantorId = await this.parties.resolveGuarantor(
      command.guarantorId,
      renter,
    )
    // El propietario ya se validó: la propiedad no tiene uno sin propietario.
    const ownerId = property.ownerId as string
    const feePercentage = await this.parties.feePercentage(ownerId, false)

    const data: NewContract = {
      ...terms,
      propertyId: property.id,
      ownerId,
      renterId: renter.id,
      guarantorId,
      feePercentage,
      renewedFromId: null,
    }
    const contract = await this.prisma.transaction(async () => {
      const created = await this.contracts.create(data)
      await this.properties.attachContract(property.id, created.id)
      await this.renters.attachContract(renter.id, created.id)
      return created
    })
    return this.views.detail(contract)
  }
}

/**
 * Edición (D-55): sólo notas, caución y garante. Fechas, montos, partes y
 * estado no se editan: cambian por un aumento, una rescisión o una
 * renovación, que dejan su propio registro.
 */
@CommandHandler(UpdateContractCommand)
export class UpdateContractHandler implements ICommandHandler<
  UpdateContractCommand,
  ContractDetailView
> {
  constructor(
    private readonly contracts: ContractRepository,
    private readonly parties: ContractParties,
    private readonly renters: RentersFacade,
    private readonly views: ContractViews,
  ) {}

  async execute(command: UpdateContractCommand): Promise<ContractDetailView> {
    const contract = await requireContract(this.contracts, command.id)
    const { changes } = command
    const next: Parameters<ContractRepository['update']>[1] = {}

    if (changes.notes !== undefined) {
      next.notes = PersonPolicy.normalizeNotes(changes.notes)
    }
    if (
      changes.guarantorId !== undefined &&
      changes.guarantorId !== contract.guarantorId
    ) {
      const renter = await this.renters.find(contract.renterId)
      next.guarantorId = await this.parties.resolveGuarantor(
        changes.guarantorId,
        renter ?? {
          id: contract.renterId,
          fullName: '',
          guarantorId: null,
          activeContractId: null,
        },
      )
    }
    if (changes.surety) {
      // La regla del email se evalúa sobre la caución resultante, no sólo
      // sobre lo que vino: sacar el email de un contrato con caución es error.
      next.surety = normalizeSurety({ ...contract.surety, ...changes.surety })
    }

    const updated = await this.contracts.update(contract.id, next)
    return this.views.detail(updated)
  }
}

/** 10 MB: un contrato escaneado entero entra, y frena abusos. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
const PDF_MAGIC = '%PDF'

/**
 * PDF del contrato o de la póliza (spec 3.4, 3.5). Se valida por contenido
 * (los primeros bytes), no por la extensión ni el mimetype que mandó el
 * cliente. Reemplaza al anterior: se sube el nuevo, se guarda, y recién
 * después se borra el viejo, así nunca queda un contrato sin su archivo.
 */
@CommandHandler(UploadContractDocumentCommand)
export class UploadContractDocumentHandler implements ICommandHandler<
  UploadContractDocumentCommand,
  ContractDetailView
> {
  private readonly logger = createLogger('UploadContractDocumentHandler')

  constructor(
    private readonly contracts: ContractRepository,
    private readonly storage: StoragePort,
    private readonly views: ContractViews,
  ) {}

  async execute(
    command: UploadContractDocumentCommand,
  ): Promise<ContractDetailView> {
    const contract = await requireContract(this.contracts, command.id)
    if (command.file.length === 0 || command.file.length > MAX_DOCUMENT_BYTES) {
      throw new InvalidContractDocumentException('tiene que pesar hasta 10 MB')
    }
    if (command.file.subarray(0, PDF_MAGIC.length).toString() !== PDF_MAGIC) {
      throw new InvalidContractDocumentException('tiene que ser un PDF')
    }

    const stored = await this.storage.upload(
      command.file,
      `contracts/${contract.id}/${command.kind}-${randomUUID()}.pdf`,
      { contentType: 'application/pdf' },
    )
    const previousKey =
      command.kind === 'contract'
        ? contract.contractPdfKey
        : contract.surety.policyPdfKey
    const updated = await this.contracts.setDocument(
      contract.id,
      command.kind,
      stored,
    )
    if (previousKey) await this.discard(previousKey)

    return this.views.detail(updated)
  }

  private async discard(key: string): Promise<void> {
    try {
      await this.storage.delete(key)
    } catch (error) {
      // El nuevo ya está guardado; un archivo huérfano no justifica un error.
      this.logger.warn(
        { key, error: errorMessage(error) },
        'No se pudo borrar el documento anterior de un contrato',
      )
    }
  }
}

/**
 * Aplica el próximo aumento programado (spec 3.8, RN-15). La fecha es la
 * del último aumento más la frecuencia; antes de esa fecha no se aplica
 * (409), y si cae después del fin del contrato no queda ninguno. Con ICL o
 * IPC, el nuevo alquiler sale de la variación del índice entre el mes del
 * aumento anterior y el del nuevo; falta alguno → 422 con el período. Con
 * "Fijo" u "Otro", el monto viene a mano. Cada llamada aplica un solo
 * aumento: si hay varios atrasados, se llama varias veces (el cron de la
 * Fase 13 hace lo mismo).
 */
@CommandHandler(ApplyRentUpdateCommand)
export class ApplyRentUpdateHandler implements ICommandHandler<
  ApplyRentUpdateCommand,
  ContractDetailView
> {
  constructor(
    private readonly contracts: ContractRepository,
    private readonly indices: IndicesFacade,
    private readonly views: ContractViews,
  ) {}

  async execute(command: ApplyRentUpdateCommand): Promise<ContractDetailView> {
    const contract = await requireContract(this.contracts, command.id)
    requireActive(contract)

    const latest = contract.rentUpdates[0]
    const effectiveFrom = ContractPolicy.nextRentUpdateOn(
      latest.effectiveFrom,
      contract.rentUpdateFrequency,
    )
    if (effectiveFrom > contract.endDate)
      throw new RentUpdateNotDueException(null)
    if (todayIso() < effectiveFrom) {
      throw new RentUpdateNotDueException(effectiveFrom)
    }

    const currentRent = currentRentOf(contract)
    const indexed =
      contract.rentUpdateType === RentUpdateType.ICL ||
      contract.rentUpdateType === RentUpdateType.IPC

    const updated = indexed
      ? await this.applyIndex(contract, latest.effectiveFrom, effectiveFrom)
      : await this.contracts.addRentUpdate(contract.id, {
          effectiveFrom,
          previousRent: currentRent,
          newRent: ContractPolicy.normalizeNewRent(command.newRent),
          source: RentUpdateSource.MANUAL,
          indexType: null,
          indexFromPeriod: null,
          indexToPeriod: null,
          indexFromValue: null,
          indexToValue: null,
          appliedById: RequestContext.userId ?? null,
        })
    return this.views.detail(updated)
  }

  private async applyIndex(
    contract: Contract,
    previousEffectiveFrom: string,
    effectiveFrom: string,
  ): Promise<Contract> {
    const indexType = IndexType[contract.rentUpdateType as 'ICL' | 'IPC']
    const fromPeriod = periodOf(previousEffectiveFrom)
    const toPeriod = periodOf(effectiveFrom)
    const [fromValue, toValue] = await Promise.all([
      this.indices.getValue(indexType, fromPeriod),
      this.indices.getValue(indexType, toPeriod),
    ])
    if (!fromValue) throw new IndexMissingException(indexType, fromPeriod)
    if (!toValue) throw new IndexMissingException(indexType, toPeriod)

    const currentRent = currentRentOf(contract)
    return this.contracts.addRentUpdate(contract.id, {
      effectiveFrom,
      previousRent: currentRent,
      newRent: ContractPolicy.indexedRent(currentRent, fromValue, toValue),
      source: RentUpdateSource.INDEX,
      indexType,
      indexFromPeriod: fromPeriod,
      indexToPeriod: toPeriod,
      indexFromValue: fromValue,
      indexToValue: toValue,
      appliedById: RequestContext.userId ?? null,
    })
  }
}

export interface TerminationResult extends ContractTerminationView {
  remainingMonths: number
  remainingDays: number
  contract: ContractDetailView
}

/**
 * Rescisión anticipada (spec 3.6, RN-09). Guarda el desglose, cierra el
 * contrato y libera la propiedad y al inquilino en una transacción. La multa
 * queda registrada como dato del contrato; cobrarla es de la Fase 11.
 */
@CommandHandler(TerminateContractCommand)
export class TerminateContractHandler implements ICommandHandler<
  TerminateContractCommand,
  TerminationResult
> {
  constructor(
    private readonly contracts: ContractRepository,
    private readonly properties: PropertiesFacade,
    private readonly renters: RentersFacade,
    private readonly prisma: PrismaService,
    private readonly views: ContractViews,
  ) {}

  async execute(command: TerminateContractCommand): Promise<TerminationResult> {
    const contract = await requireContract(this.contracts, command.id)
    requireActive(contract)
    const notifiedAt = ContractPolicy.normalizeDate(
      command.notifiedAt,
      'notifiedAt',
    )
    ContractPolicy.assertTerminationDate(
      notifiedAt,
      contract.startDate,
      contract.endDate,
    )
    const breakdown = ContractPolicy.termination(
      currentRentOf(contract),
      notifiedAt,
      contract.endDate,
    )

    const terminated = await this.prisma.transaction(async () => {
      const result = await this.contracts.terminate(contract.id, {
        terminatedAt: notifiedAt,
        notifiedAt,
        penalty: breakdown.penalty,
        futureRent: breakdown.futureRent,
      })
      await this.properties.detachContract(contract.propertyId)
      await this.renters.detachContract(contract.renterId)
      return result
    })

    return {
      terminatedAt: notifiedAt,
      notifiedAt,
      penalty: breakdown.penalty,
      futureRent: breakdown.futureRent,
      remainingMonths: breakdown.remainingMonths,
      remainingDays: breakdown.remainingDays,
      contract: await this.views.detail(terminated),
    }
  }
}

/**
 * Renovación (spec 3.7). Un contrato nuevo, activo, precargado con el
 * original salvo lo que se indique (el inquilino puede cambiar, spec 7); los
 * honorarios se fijan de nuevo. El original queda finalizado y propiedad e
 * inquilino pasan a apuntar al nuevo, todo en una transacción.
 */
@CommandHandler(RenewContractCommand)
export class RenewContractHandler implements ICommandHandler<
  RenewContractCommand,
  ContractDetailView
> {
  constructor(
    private readonly contracts: ContractRepository,
    private readonly parties: ContractParties,
    private readonly properties: PropertiesFacade,
    private readonly renters: RentersFacade,
    private readonly prisma: PrismaService,
    private readonly views: ContractViews,
  ) {}

  async execute(command: RenewContractCommand): Promise<ContractDetailView> {
    const original = await requireContract(this.contracts, command.id)
    requireActive(original)
    const { overrides } = command

    const terms = normalizeTerms({
      startDate: command.startDate,
      endDate: command.endDate,
      initialRent: overrides.initialRent ?? currentRentOf(original),
      currency: overrides.currency ?? original.currency,
      rentUpdateType: overrides.rentUpdateType ?? original.rentUpdateType,
      rentUpdateFrequency:
        overrides.rentUpdateFrequency ?? original.rentUpdateFrequency,
      deposit: overrides.deposit ?? original.deposit,
      notes: overrides.notes === undefined ? original.notes : overrides.notes,
      surety: { ...original.surety, ...overrides.surety },
    })
    ContractPolicy.assertRenewalStart(terms.startDate, original.startDate)

    const renterId = overrides.renterId ?? original.renterId
    const renter = await this.parties.requireRenter(renterId, original.id)
    const guarantorId =
      overrides.guarantorId === undefined && renterId === original.renterId
        ? original.guarantorId
        : await this.parties.resolveGuarantor(overrides.guarantorId, renter)
    // La propiedad ya cuenta como activa por el contrato original.
    const feePercentage = await this.parties.feePercentage(
      original.ownerId,
      true,
    )

    const data: NewContract = {
      ...terms,
      propertyId: original.propertyId,
      ownerId: original.ownerId,
      renterId,
      guarantorId,
      feePercentage,
      renewedFromId: original.id,
    }
    const renewed = await this.prisma.transaction(async () => {
      // Primero se cierra el original: el índice único de "un activo por
      // propiedad" no deja crear el nuevo mientras el viejo siga activo.
      await this.contracts.setStatus(original.id, ContractStatus.FINISHED)
      const created = await this.contracts.create(data)
      await this.properties.attachContract(original.propertyId, created.id)
      if (renterId !== original.renterId) {
        await this.renters.detachContract(original.renterId)
      }
      await this.renters.attachContract(renterId, created.id)
      return created
    })
    return this.views.detail(renewed)
  }
}
