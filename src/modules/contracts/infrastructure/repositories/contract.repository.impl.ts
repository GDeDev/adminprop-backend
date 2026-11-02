import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import {
  BillingTerms,
  CollectionMode,
  Contract,
  ContractStatus,
  Currency,
  DepositReturnMode,
  FeeMode,
  RentIndex,
  RentUpdate,
  RentUpdateFrequency,
  RentUpdateSource,
  RentUpdateType,
} from '@/modules/contracts/domain/contract'
import {
  BillingTermsChange,
  ContractChanges,
  ContractDocumentKind,
  ContractFilter,
  ContractRepository,
  NewContract,
  NewRentUpdate,
  TerminationData,
} from '@/modules/contracts/domain/contract.ports'
import { IsoDate } from '@/shared/dates/calendar-date'
import { PrismaService } from '@/shared/prisma/prisma.service'

/**
 * El historial del alquiler y el de los términos de cobro viajan siempre con
 * el contrato, el último primero.
 */
const WITH_RENT_UPDATES = {
  rentUpdates: {
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
  },
  billingTerms: {
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
  },
} satisfies Prisma.ContractInclude

type ContractRow = Prisma.ContractGetPayload<{
  include: typeof WITH_RENT_UPDATES
}>
type RentUpdateRow = ContractRow['rentUpdates'][number]
type BillingTermsRow = ContractRow['billingTerms'][number]

/**
 * Siempre `prisma.db`: tenant y auditoría se aplican solos, y dentro de
 * `PrismaService.transaction()` las escrituras se suman a ella (D-52).
 */
@Injectable()
export class ContractRepositoryImpl extends ContractRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: NewContract): Promise<Contract> {
    const { surety, startDate, endDate, billingTerms, ...rest } = data
    // Tres altas y no un `create` anidado: el `tenantId` lo completa la
    // extensión, y sólo lo hace en la operación de primer nivel.
    return this.prisma.transaction(async () => {
      const created = await this.prisma.db.contract.create({
        data: {
          ...rest,
          startDate: toDateColumn(startDate),
          endDate: toDateColumn(endDate),
          hasSurety: surety.hasSurety,
          insurerName: surety.insurerName,
          insurerAlertEmail: surety.insurerAlertEmail,
          policyNumber: surety.policyNumber,
          policyExpiresAt: toDateColumn(surety.policyExpiresAt),
        } as Prisma.ContractUncheckedCreateInput,
      })
      await this.prisma.db.contractRentUpdate.create({
        data: {
          contractId: created.id,
          effectiveFrom: toDateColumn(startDate),
          previousRent: null,
          newRent: data.initialRent,
          source: RentUpdateSource.INITIAL,
        } as Prisma.ContractRentUpdateUncheckedCreateInput,
      })
      await this.prisma.db.contractBillingTerms.create({
        data: {
          ...billingTerms,
          contractId: created.id,
          effectiveFrom: toDateColumn(startDate),
        } as Prisma.ContractBillingTermsUncheckedCreateInput,
      })
      return this.findOrThrow(created.id)
    })
  }

  async findById(id: string): Promise<Contract | null> {
    const row = await this.prisma.db.contract.findFirst({
      where: { id },
      include: WITH_RENT_UPDATES,
    })
    return row ? toDomain(row) : null
  }

  async findActiveByProperty(propertyId: string): Promise<Contract | null> {
    const row = await this.prisma.db.contract.findFirst({
      where: { propertyId, status: ContractStatus.ACTIVE },
      include: WITH_RENT_UPDATES,
    })
    return row ? toDomain(row) : null
  }

  async list(
    filter: ContractFilter,
    page: { skip: number; take: number },
  ): Promise<[Contract[], number]> {
    const where: Prisma.ContractWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.propertyId ? { propertyId: filter.propertyId } : {}),
      ...(filter.renterId ? { renterId: filter.renterId } : {}),
      ...(filter.ownerId ? { ownerId: filter.ownerId } : {}),
      ...(filter.endDateBetween
        ? {
            endDate: {
              gte: toDateColumn(filter.endDateBetween.from),
              lte: toDateColumn(filter.endDateBetween.to),
            },
          }
        : {}),
    }
    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.contract.findMany({
        where,
        include: WITH_RENT_UPDATES,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...page,
      }),
      this.prisma.db.contract.count({ where }),
    ])
    return [rows.map(toDomain), total]
  }

  async listAll(filter: ContractFilter): Promise<Contract[]> {
    const rows = await this.prisma.db.contract.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.propertyId ? { propertyId: filter.propertyId } : {}),
        ...(filter.renterId ? { renterId: filter.renterId } : {}),
        ...(filter.ownerId ? { ownerId: filter.ownerId } : {}),
      },
      include: WITH_RENT_UPDATES,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    })
    return rows.map(toDomain)
  }

  async listActive(
    options: { endingBefore?: IsoDate } = {},
  ): Promise<Contract[]> {
    const rows = await this.prisma.db.contract.findMany({
      where: {
        status: ContractStatus.ACTIVE,
        ...(options.endingBefore
          ? { endDate: { lt: toDateColumn(options.endingBefore) } }
          : {}),
      },
      include: WITH_RENT_UPDATES,
      orderBy: [{ endDate: 'asc' }, { id: 'asc' }],
    })
    return rows.map(toDomain)
  }

  async listActiveCovering(from: IsoDate, to: IsoDate): Promise<Contract[]> {
    const rows = await this.prisma.db.contract.findMany({
      where: {
        status: ContractStatus.ACTIVE,
        startDate: { lte: toDateColumn(to) },
        endDate: { gte: toDateColumn(from) },
      },
      include: WITH_RENT_UPDATES,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return rows.map(toDomain)
  }

  async update(id: string, changes: ContractChanges): Promise<Contract> {
    const { surety, ...rest } = changes
    const row = await this.prisma.db.contract.update({
      where: { id },
      data: {
        ...rest,
        ...(surety && {
          hasSurety: surety.hasSurety,
          insurerName: surety.insurerName,
          insurerAlertEmail: surety.insurerAlertEmail,
          policyNumber: surety.policyNumber,
          policyExpiresAt: toDateColumn(surety.policyExpiresAt),
        }),
      },
      include: WITH_RENT_UPDATES,
    })
    return toDomain(row)
  }

  async setDocument(
    id: string,
    kind: ContractDocumentKind,
    file: { key: string; url: string },
  ): Promise<Contract> {
    const row = await this.prisma.db.contract.update({
      where: { id },
      data:
        kind === 'contract'
          ? { contractPdfKey: file.key, contractPdfUrl: file.url }
          : { policyPdfKey: file.key, policyPdfUrl: file.url },
      include: WITH_RENT_UPDATES,
    })
    return toDomain(row)
  }

  async addRentUpdate(
    contractId: string,
    update: NewRentUpdate,
  ): Promise<Contract> {
    await this.prisma.db.contractRentUpdate.create({
      data: {
        ...update,
        contractId,
        effectiveFrom: toDateColumn(update.effectiveFrom),
      } as Prisma.ContractRentUpdateUncheckedCreateInput,
    })
    return this.findOrThrow(contractId)
  }

  async addBillingTerms(
    contractId: string,
    terms: BillingTermsChange,
  ): Promise<Contract> {
    await this.prisma.db.contractBillingTerms.create({
      data: {
        ...terms,
        contractId,
        effectiveFrom: toDateColumn(terms.effectiveFrom),
      } as Prisma.ContractBillingTermsUncheckedCreateInput,
    })
    return this.findOrThrow(contractId)
  }

  async attachTerminationPdf(
    id: string,
    file: { key: string; url: string },
  ): Promise<void> {
    await this.prisma.db.contract.update({
      where: { id },
      data: { terminationPdfKey: file.key, terminationPdfUrl: file.url },
    })
  }

  async terminate(id: string, data: TerminationData): Promise<Contract> {
    const row = await this.prisma.db.contract.update({
      where: { id },
      data: {
        status: ContractStatus.TERMINATED,
        terminatedAt: toDateColumn(data.terminatedAt),
        terminationNotifiedAt: toDateColumn(data.notifiedAt),
        terminationPenalty: data.penalty,
        terminationFutureRent: data.futureRent,
      },
      include: WITH_RENT_UPDATES,
    })
    return toDomain(row)
  }

  async setStatus(id: string, status: ContractStatus): Promise<Contract> {
    const row = await this.prisma.db.contract.update({
      where: { id },
      data: { status },
      include: WITH_RENT_UPDATES,
    })
    return toDomain(row)
  }

  private async findOrThrow(id: string): Promise<Contract> {
    const row = await this.prisma.db.contract.findFirstOrThrow({
      where: { id },
      include: WITH_RENT_UPDATES,
    })
    return toDomain(row)
  }
}

/**
 * Las columnas `DATE` se convierten en el borde (como en inquilinos, D-49):
 * el dominio sólo ve `AAAA-MM-DD`.
 */
function toDateColumn(value: IsoDate): Date
function toDateColumn(value: IsoDate | null): Date | null
function toDateColumn(value: IsoDate | null): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null
}

function fromDateColumn(value: Date): IsoDate
function fromDateColumn(value: Date | null): IsoDate | null
function fromDateColumn(value: Date | null): IsoDate | null {
  return value ? value.toISOString().slice(0, 10) : null
}

function money(value: Prisma.Decimal): string
function money(value: Prisma.Decimal | null): string | null
function money(value: Prisma.Decimal | null): string | null {
  return value ? value.toFixed(2) : null
}

function toDomain(row: ContractRow): Contract {
  return {
    id: row.id,
    propertyId: row.propertyId,
    ownerId: row.ownerId,
    renterId: row.renterId,
    guarantorId: row.guarantorId,
    startDate: fromDateColumn(row.startDate),
    endDate: fromDateColumn(row.endDate),
    initialRent: money(row.initialRent),
    // Mismos valores en los enums de Prisma y en los del dominio.
    currency: Currency[row.currency],
    rentUpdateType: RentUpdateType[row.rentUpdateType],
    rentUpdateFrequency: RentUpdateFrequency[row.rentUpdateFrequency],
    deposit: money(row.deposit),
    depositCurrency: Currency[row.depositCurrency],
    depositReturnMode: DepositReturnMode[row.depositReturnMode],
    fixedIncreasePercentage: money(row.fixedIncreasePercentage),
    feePercentage: money(row.feePercentage),
    status: ContractStatus[row.status],
    contractPdfKey: row.contractPdfKey,
    contractPdfUrl: row.contractPdfUrl,
    notes: row.notes,
    surety: {
      hasSurety: row.hasSurety,
      insurerName: row.insurerName,
      insurerAlertEmail: row.insurerAlertEmail,
      policyNumber: row.policyNumber,
      policyExpiresAt: fromDateColumn(row.policyExpiresAt),
      policyPdfKey: row.policyPdfKey,
      policyPdfUrl: row.policyPdfUrl,
    },
    termination:
      row.terminatedAt &&
      row.terminationNotifiedAt &&
      row.terminationPenalty &&
      row.terminationFutureRent
        ? {
            terminatedAt: fromDateColumn(row.terminatedAt),
            notifiedAt: fromDateColumn(row.terminationNotifiedAt),
            penalty: money(row.terminationPenalty),
            futureRent: money(row.terminationFutureRent),
          }
        : null,
    terminationPdfKey: row.terminationPdfKey,
    terminationPdfUrl: row.terminationPdfUrl,
    renewedFromId: row.renewedFromId,
    rentUpdates: row.rentUpdates.map(rentUpdateToDomain),
    billingTerms: row.billingTerms.map(billingTermsToDomain),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function rentUpdateToDomain(row: RentUpdateRow): RentUpdate {
  return {
    id: row.id,
    effectiveFrom: fromDateColumn(row.effectiveFrom),
    previousRent: money(row.previousRent),
    newRent: money(row.newRent),
    source: RentUpdateSource[row.source],
    indexType: row.indexType ? (row.indexType as RentIndex) : null,
    indexFromPeriod: row.indexFromPeriod,
    indexToPeriod: row.indexToPeriod,
    indexFromValue: row.indexFromValue ? row.indexFromValue.toFixed(6) : null,
    indexToValue: row.indexToValue ? row.indexToValue.toFixed(6) : null,
    fixedPercentage: money(row.fixedPercentage),
    appliedById: row.appliedById,
    createdAt: row.createdAt,
  }
}

function billingTermsToDomain(row: BillingTermsRow): BillingTerms {
  return {
    id: row.id,
    effectiveFrom: fromDateColumn(row.effectiveFrom),
    collectionMode: CollectionMode[row.collectionMode],
    feeMode: FeeMode[row.feeMode],
    feePercentage: money(row.feePercentage),
    feeAmount: money(row.feeAmount),
    lateFeePercentage: money(row.lateFeePercentage),
    lateFeeGraceDays: row.lateFeeGraceDays,
    notes: row.notes,
    changedById: row.changedById,
    createdAt: row.createdAt,
  }
}
